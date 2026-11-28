// Edge Function "verificar": comprova un token de QR i retorna les dades mínimes.
// Desplegar amb:  supabase functions deploy verificar --no-verify-jwt   (o des de l'editor del panell)
// Secrets: CLAU_SECRETA=sb_secret_...  i  ALLOWED_ORIGIN=https://EL_TEU_USUARI.github.io  (només el domini)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const MAX_BODY = 1024;

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });

// IP del client per al límit d'intents. Es prefereix la capçalera que posa el proxy (no falsificable pel client).
function clientIp(req: Request) {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim().slice(0, 64);
  const xff = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return (xff.length ? xff[xff.length - 1] : "desconeguda").slice(0, 64);
}

let supabase = null;
function client() {
  if (!supabase) {
    supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("CLAU_SECRETA") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return supabase;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (ALLOWED_ORIGIN !== "*" && origin && origin !== ALLOWED_ORIGIN) return json({ valid: false }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ valid: false }, 405);

  let token = "";
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ valid: false }, 413);
    token = JSON.parse(raw).token;
  } catch {
    return json({ valid: false }, 400);
  }

  // Els tokens són 64 caràcters hexadecimals. Qualsevol altra cosa es descarta sense tocar la base de dades.
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return json({ valid: false });

  const db = client();
  const { data, error } = await db.rpc("verificar_token", { p_token: token, p_ip: clientIp(req) });
  if (error || !data) {
    console.error("verificar_token ha fallat:", error ? error.message : "sense dades");   // mai es registra el token
    return json({ valid: false, error: true }, 500);
  }
  if (!data.valid) return json({ valid: false, limited: data.limited ?? false }, data.limited ? 429 : 200);

  // Enllaç temporal (60 s) a la foto privada
  let foto_url = null;
  if (data.foto_path) {
    const { data: signed } = await db.storage.from("fotos").createSignedUrl(data.foto_path, 60);
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
