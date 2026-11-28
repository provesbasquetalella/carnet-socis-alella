-- =====================================================================
-- CB Alella · Carnet de soci · Esquema (executar PRIMER)
-- Executar al SQL Editor de Supabase. Provar abans en un projecte de PROVES.
-- (Els noms de columnes es mantenen en castellà, com al document original.)
-- =====================================================================

-- Taules
create table public.socios (
  id uuid primary key references auth.users(id) on delete cascade,
  numero_socio text not null unique check (numero_socio ~ '^[0-9]{4}$'),
  nombre text not null,
  apellidos text not null,
  foto_path text,
  estado text not null default 'activo' check (estado in ('activo','suspendido','baja')),
  fecha_alta date not null default current_date,
  email text,
  telefono text,
  -- La foto només pot apuntar a la carpeta del propi soci (evita veure fotos d'altri)
  constraint foto_path_propia check (foto_path is null or foto_path = id::text || '/foto.jpg')
);

create table public.socios_admin (
  socio_id uuid primary key references public.socios(id) on delete cascade,
  notas text, cuota text, vence date
);

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table public.qr_tokens (
  token text primary key,
  socio_id uuid not null references public.socios(id) on delete cascade,
  activo boolean not null default true,
  creado timestamptz not null default now()
);
create unique index qr_un_token_activo on public.qr_tokens(socio_id) where activo;

-- Funció auxiliar
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;

-- Regles d'accés (RLS)
alter table public.socios enable row level security;
alter table public.socios_admin enable row level security;
alter table public.admins enable row level security;
alter table public.qr_tokens enable row level security;

create policy socios_select on public.socios for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
create policy socios_update on public.socios for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke update on public.socios from authenticated;
grant update (foto_path, telefono, email) on public.socios to authenticated;

create policy socios_admin_all on public.socios_admin for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy admins_select on public.admins for select to authenticated
  using (public.is_admin());
create policy qr_select on public.qr_tokens for select to authenticated
  using (socio_id = (select auth.uid()));

-- Token del QR: obtenir i regenerar
create or replace function public.obtener_mi_token()
returns text language plpgsql security definer set search_path = ''
as $$
declare t text;
begin
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
declare t text;
begin
  update public.qr_tokens set activo = false where socio_id = auth.uid() and activo;
  t := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.qr_tokens(token, socio_id) values (t, auth.uid());
  return t;
end $$;

revoke all on function public.obtener_mi_token() from public, anon;
revoke all on function public.regenerar_mi_token() from public, anon;
grant execute on function public.obtener_mi_token() to authenticated;
grant execute on function public.regenerar_mi_token() to authenticated;

-- Fotos (bucket privat, JPEG/WebP, màx. 500 KB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 524288, array['image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy fotos_select on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy fotos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy fotos_update on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
