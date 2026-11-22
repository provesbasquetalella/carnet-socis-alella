// Edge Function "verificar": comprova un token de QR i retorna les dades mínimes.
// Desplegar amb:  supabase functions deploy verificar --no-verify-jwt
// Secrets: CLAU_SECRETA=sb_secret_...  i  ALLOWED_ORIGIN (adreça de la web)
// Exemple: supabase secrets set ALLOWED_ORIGIN=https://EL_TEU_USUARI.github.io
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ valid: false }, 405);

  let token = "";
  try {
    ({ token } = await req.json());
  } catch {
    return json({ valid: false }, 400);
  }

  // Els tokens són 64 caràcters hexadecimals. Qualsevol altra cosa es descarta.
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) {
    return json({ valid: false });
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "desconeguda").split(",")[0].trim();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    // Clau secreta pròpia (supabase secrets set CLAU_SECRETA=sb_secret_...) o, si no, la clàssica
    Deno.env.get("CLAU_SECRETA") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase.rpc("verificar_token", { p_token: token, p_ip: ip });
  if (error || !data) return json({ valid: false, error: true }, 500);
  if (!data.valid) return json({ valid: false, limited: data.limited ?? false }, data.limited ? 429 : 200);

  // Enllaç temporal (60 s) a la foto privada
  let foto_url: string | null = null;
  if (data.foto_path) {
    const { data: signed } = await supabase.storage.from("fotos").createSignedUrl(data.foto_path, 60);
    foto_url = signed?.signedUrl ?? null;
  }

  return json({
    valid: true,
    numero_socio: data.numero_socio,
    nombre: data.nombre,
    apellidos: data.apellidos,
    foto_url,
  });
});
