// Prova la Edge Function "verificar" sense Supabase: s'executa el codi real amb una base de dades simulada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const TOKEN = 'ab12'.repeat(16);
function carrega({ env = {}, rpc } = {}) {
  let src = readFileSync(new URL('../supabase/functions/verificar/index.ts', import.meta.url), 'utf8');
  src = src.replace(/^import .*createClient.*$/m, '').replace(/: Request/g, '').replace(/: unknown/g, '');
  let handler; const calls = []; const logs = [];
  const Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
  const createClient = () => ({
    rpc: async (n, a) => { calls.push([n, a]); return rpc(a); },
    storage: { from: () => ({ createSignedUrl: async (p) => ({ data: { signedUrl: 'https://x.supabase.co/storage/v1/object/sign/fotos/' + p + '?token=t' } }) }) },
  });
  new Function('Deno', 'createClient', 'console', src)(Deno, createClient, { error: (...a) => logs.push(a.join(' ')) });
  return { handler, calls, logs };
}
const post = (body, headers = {}) => new Request('https://f.supabase.co/functions/v1/verificar', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const actiu = async () => ({ data: { valid: true, numero_socio: '0001', nombre: 'Marta', apellidos: 'Puig', foto_path: 'u/foto.jpg' } });

test('OPTIONS respon amb CORS i GET es rebutja', async () => {
  const { handler } = carrega({ rpc: actiu });
  const o = await handler(new Request('https://f/x', { method: 'OPTIONS' }));
  assert.equal(o.status, 204); assert.ok(o.headers.get('access-control-allow-methods').includes('POST'));
  assert.equal((await handler(new Request('https://f/x'))).status, 405);
});
test('un origen no permès és rebutjat (403) i no toca la base de dades', async () => {
  const { handler, calls } = carrega({ env: { ALLOWED_ORIGIN: 'https://a.github.io' }, rpc: actiu });
  const r = await handler(post({ token: TOKEN }, { origin: 'https://evil.example' }));
  assert.equal(r.status, 403); assert.equal(calls.length, 0);
  const ok = await handler(post({ token: TOKEN }, { origin: 'https://a.github.io' }));
  assert.equal(ok.status, 200);
});
test('tokens mal formats no arriben mai a la base de dades', async () => {
  const { handler, calls } = carrega({ rpc: actiu });
  for (const t of ['', 'abc', 'A'.repeat(64), 'a'.repeat(65), "' or 1=1 --", 42, null, {}, [TOKEN], undefined]) {
    const r = await handler(post({ token: t }));
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { valid: false });
  }
  assert.equal(calls.length, 0);
});
test('cos invàlid o massa gran', async () => {
  const { handler, calls } = carrega({ rpc: actiu });
  assert.equal((await handler(post('{no json'))).status, 400);
  assert.equal((await handler(post(''))).status, 400);
  assert.equal((await handler(post({ token: 'a'.repeat(5000) }))).status, 413);
  assert.equal(calls.length, 0);
});
test('soci actiu: retorna només les dades mínimes i una URL de foto temporal', async () => {
  const { handler } = carrega({ rpc: actiu });
  const r = await handler(post({ token: TOKEN })); const d = await r.json();
  assert.equal(r.status, 200); assert.equal(d.valid, true);
  assert.deepEqual(Object.keys(d).sort(), ['apellidos', 'foto_url', 'nombre', 'numero_socio', 'valid']);
  assert.ok(d.foto_url.includes('/sign/fotos/')); assert.ok(!('foto_path' in d));
  assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});
test('soci sense foto: foto_url null', async () => {
  const { handler } = carrega({ rpc: async () => ({ data: { valid: true, numero_socio: '0002', nombre: 'J', apellidos: 'S', foto_path: null } }) });
  assert.equal((await (await handler(post({ token: TOKEN }))).json()).foto_url, null);
});
test('no actiu: cap dada ni motiu', async () => {
  const { handler } = carrega({ rpc: async () => ({ data: { valid: false } }) });
  const r = await handler(post({ token: TOKEN }));
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { valid: false, limited: false });
});
test('límit d’intents: 429', async () => {
  const { handler } = carrega({ rpc: async () => ({ data: { valid: false, limited: true } }) });
  const r = await handler(post({ token: TOKEN })); assert.equal(r.status, 429); assert.equal((await r.json()).limited, true);
});
test('error de base de dades: 500 i el token no es registra', async () => {
  const { handler, logs } = carrega({ rpc: async () => ({ error: { message: 'boom' } }) });
  const r = await handler(post({ token: TOKEN }));
  assert.equal(r.status, 500); assert.deepEqual(await r.json(), { valid: false, error: true });
  assert.ok(logs.length === 1 && !logs.join().includes(TOKEN));
});
test('IP del client: prefereix cf-connecting-ip i no es deixa enganyar per X-Forwarded-For', async () => {
  const a = carrega({ rpc: actiu });
  await a.handler(post({ token: TOKEN }, { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1, 9.9.9.9' }));
  assert.equal(a.calls[0][1].p_ip, '203.0.113.7');
  const b = carrega({ rpc: actiu });
  await b.handler(post({ token: TOKEN }, { 'x-forwarded-for': '1.1.1.1, 9.9.9.9' }));
  assert.equal(b.calls[0][1].p_ip, '9.9.9.9');
  const c = carrega({ rpc: actiu });
  await c.handler(post({ token: TOKEN }));
  assert.equal(c.calls[0][1].p_ip, 'desconeguda');
});
