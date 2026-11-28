-- =====================================================================
-- CB Alella · Verificació pública del QR (executar DESPRÉS de 01_esquema.sql)
--
-- Opció A: qualsevol persona (comerços) pot comprovar un QR sense login.
-- Només es retorna el MÍNIM: número, nom, cognoms i foto (si està actiu).
-- La funció NO és accessible directament des del navegador: només la crida
-- la Edge Function "verificar" (amb la clau de servei), que a més genera
-- l'enllaç temporal de la foto.
-- =====================================================================

-- Registre d'INTENTS FALLITS (per limitar abusos). No es guarda cap dada de socis.
create table public.verif_fallits (
  id bigserial primary key,
  ip text not null,
  creat timestamptz not null default now()
);
create index verif_fallits_ip_creat on public.verif_fallits(ip, creat);
alter table public.verif_fallits enable row level security;  -- sense polítiques: inaccessible des de la web

create or replace function public.verificar_token(p_token text, p_ip text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  s record;
  n int;
begin
  -- Neteja d'intents antics (més d'1 dia)
  delete from public.verif_fallits where creat < now() - interval '1 day';

  -- Límit: 20 intents fallits per IP cada 10 minuts
  select count(*) into n from public.verif_fallits
   where ip = p_ip and creat > now() - interval '10 minutes';
  if n >= 20 then
    return jsonb_build_object('valid', false, 'limited', true);
  end if;

  select so.numero_socio, so.nombre, so.apellidos, so.foto_path
    into s
    from public.qr_tokens t
    join public.socios so on so.id = t.socio_id
   where t.token = p_token and t.activo and so.estado = 'activo';

  if not found then
    insert into public.verif_fallits(ip) values (p_ip);
    return jsonb_build_object('valid', false);   -- sense cap dada
  end if;

  return jsonb_build_object(
    'valid', true,
    'numero_socio', s.numero_socio,
    'nombre', s.nombre,
    'apellidos', s.apellidos,
    'foto_path', s.foto_path
  );
end $$;

-- Només la clau de servei (Edge Function) pot executar-la
revoke all on function public.verificar_token(text, text) from public, anon, authenticated;
grant execute on function public.verificar_token(text, text) to service_role;
