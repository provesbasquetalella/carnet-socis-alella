-- =====================================================================
-- CB Alella · Validesa del QR en temps real (executar DESPRÉS de 01 i 02)
--
-- Un QR es considera ACTIU només si, en el moment d'escanejar-lo:
--   1) el soci té estat 'activo'                    (socios.estado)
--   2) i està al corrent de pagament: la data "vence" de socios_admin
--      és avui o posterior                           (socios_admin.vence)
-- Es calcula a cada escaneig, així que si el club canvia l'estat o la data,
-- el QR ho reflecteix a l'instant. La targeta no mostra res d'això.
-- Qui escaneja només veu ACTIU / NO ACTIU (mai el motiu).
-- =====================================================================

-- A) NOMÉS PER A PROVES: dona de data de venciment 30/06/2027 (final de temporada 26/27)
--    a tots els socis que ara no en tenen. Als socis reals, la data la posa el club
--    quan es paga la quota. (L'script d'alta també la crea: opció --vence.)
insert into public.socios_admin(socio_id, vence)
select id, date '2027-06-30' from public.socios
on conflict (socio_id) do nothing;

update public.socios_admin set vence = date '2027-06-30' where vence is null;

-- B) Funció de verificació (substitueix la de 02_verificacio.sql)
create or replace function public.verificar_token(p_token text, p_ip text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  s record;
  n int;
  avui date := (now() at time zone 'Europe/Madrid')::date;
begin
  delete from public.verif_fallits where creat < now() - interval '1 day';

  select count(*) into n from public.verif_fallits
   where ip = p_ip and creat > now() - interval '10 minutes';
  if n >= 20 then
    return jsonb_build_object('valid', false, 'limited', true);
  end if;

  select so.numero_socio, so.nombre, so.apellidos, so.foto_path
    into s
    from public.qr_tokens t
    join public.socios so on so.id = t.socio_id
    join public.socios_admin sa on sa.socio_id = so.id
   where t.token = p_token
     and t.activo
     and so.estado = 'activo'
     and sa.vence is not null
     and sa.vence >= avui;

  if not found then
    insert into public.verif_fallits(ip) values (p_ip);
    return jsonb_build_object('valid', false);   -- sense cap dada ni motiu
  end if;

  return jsonb_build_object(
    'valid', true,
    'numero_socio', s.numero_socio,
    'nombre', s.nombre,
    'apellidos', s.apellidos,
    'foto_path', s.foto_path
  );
end $$;

revoke all on function public.verificar_token(text, text) from public, anon, authenticated;
grant execute on function public.verificar_token(text, text) to service_role;

-- =====================================================================
-- GESTIÓ DIÀRIA (exemples; executar quan calgui, canviant el número de soci)
-- =====================================================================
-- Soci ha pagat la temporada 26/27:
--   update public.socios_admin set vence = date '2027-06-30'
--    where socio_id = (select id from public.socios where numero_socio = '0011');
--
-- Soci amb pagament pendent (el QR passa a NO ACTIU a l'instant):
--   update public.socios_admin set vence = current_date - 1
--    where socio_id = (select id from public.socios where numero_socio = '0011');
--
-- Suspendre un soci:
--   update public.socios set estado = 'suspendido' where numero_socio = '0011';
--
-- Veure l'estat de tots els socis:
--   select s.numero_socio, s.nombre, s.apellidos, s.estado, a.vence,
--          (s.estado = 'activo' and a.vence >= current_date) as qr_actiu
--     from public.socios s left join public.socios_admin a on a.socio_id = s.id
--    order by s.numero_socio;
