-- =====================================================================
-- CB Alella · Enduriment de seguretat (executar DESPRÉS de 01, 02 i 03)
-- Es pot executar més d'un cop sense problemes.
-- =====================================================================

-- 1) Privilegis mínims (a més de les regles RLS): la web pública (anon) no toca cap taula
revoke all on table public.socios, public.socios_admin, public.admins, public.qr_tokens, public.verif_fallits from anon;
revoke all on table public.verif_fallits from authenticated;
revoke insert, delete, truncate, references, trigger on table public.socios from authenticated;
revoke insert, update, delete, truncate on table public.qr_tokens from authenticated;
revoke all on table public.admins from authenticated;
grant select on table public.admins to authenticated;
alter default privileges in schema public revoke all on tables from anon;

-- 2) Límits de mida i format a les dades que el soci pot editar
alter table public.socios
  drop constraint if exists socios_noms_len,
  drop constraint if exists socios_email_fmt,
  drop constraint if exists socios_tel_fmt;
alter table public.socios
  add constraint socios_noms_len check (length(nombre) <= 80 and length(apellidos) <= 80),
  add constraint socios_email_fmt check (email is null or (length(email) <= 254 and email like '%_@_%.__%')),
  add constraint socios_tel_fmt check (telefono is null or (length(telefono) <= 30 and telefono ~ '^[0-9+() .-]*$'));

-- 3) Fotos: cada soci només pot escriure/llegir EXACTAMENT <el-seu-id>/foto.jpg (res d'altres noms)
drop policy if exists fotos_select on storage.objects;
drop policy if exists fotos_insert on storage.objects;
drop policy if exists fotos_update on storage.objects;
create policy fotos_select on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and name = (select auth.uid())::text || '/foto.jpg');
create policy fotos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and name = (select auth.uid())::text || '/foto.jpg');
create policy fotos_update on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and name = (select auth.uid())::text || '/foto.jpg')
  with check (bucket_id = 'fotos' and name = (select auth.uid())::text || '/foto.jpg');

-- 4) Tokens del QR: exigir sessió, limitar regeneracions i netejar tokens vells
create or replace function public.obtener_mi_token()
returns text language plpgsql security definer set search_path = ''
as $$
declare t text;
begin
  if auth.uid() is null then raise exception 'No autoritzat'; end if;
  select token into t from public.qr_tokens where socio_id = auth.uid() and activo;
  if t is null then
    t := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into public.qr_tokens(token, socio_id) values (t, auth.uid());
  end if;
  return t;
end $$;

create or replace function public.regenerar_mi_token()
returns text language plpgsql security definer set search_path = ''
as $$
declare t text; n int;
begin
  if auth.uid() is null then raise exception 'No autoritzat'; end if;
  select count(*) into n from public.qr_tokens where socio_id = auth.uid() and creado > now() - interval '1 hour';
  if n >= 10 then raise exception 'Massa regeneracions seguides. Torna-ho a provar d''aquí una hora.'; end if;
  delete from public.qr_tokens where socio_id = auth.uid() and not activo and creado < now() - interval '30 days';
  update public.qr_tokens set activo = false where socio_id = auth.uid() and activo;
  t := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.qr_tokens(token, socio_id) values (t, auth.uid());
  return t;
end $$;

-- 5) Comprovació: totes les taules han de dir true a "rls_activa"
select c.relname as taula, c.relrowsecurity as rls_activa
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by c.relname;
