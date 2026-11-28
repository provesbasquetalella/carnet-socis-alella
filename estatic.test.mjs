// Auditoria estàtica: busca secrets, males pràctiques al codi web i errors de seguretat a l'SQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ARREL = new URL('..', import.meta.url).pathname;
const llegeix = f => readFileSync(join(ARREL, f), 'utf8');
function fitxers(dir = ARREL, out = []) {
  for (const n of readdirSync(dir)) {
    if (['node_modules', '.git', 'captures', '__pycache__'].includes(n)) continue;
    const p = join(dir, n); statSync(p).isDirectory() ? fitxers(p, out) : out.push(p);
  }
  return out;
}
const textuals = fitxers().filter(f => /\.(js|mjs|ts|html|css|sql|md|py|json|csv|txt|example|gitignore)$|\/\.[a-z.]+$/.test(f));

test('cap secret al repositori (claus sb_secret_, JWT, contrasenyes)', () => {
  for (const f of textuals) {
    const t = readFileSync(f, 'utf8'), n = relative(ARREL, f);
    assert.ok(!/sb_secret_[A-Za-z0-9_-]{12,}/.test(t), `clau secreta a ${n}`);
    assert.ok(!/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/.test(t), `JWT a ${n}`);
    assert.ok(!/(SERVICE_ROLE_KEY|SECRET_KEY)\s*=\s*[A-Za-z0-9_-]{20,}/.test(t), `clau assignada a ${n}`);
  }
});
test('.gitignore protegeix claus, fotos i fitxers privats', () => {
  const g = llegeix('.gitignore');
  for (const x of ['.env', 'claus_inicials_', 'fotos/', 'socis_privats']) assert.ok(g.includes(x), x);
});
test('config.js només porta dades públiques', () => {
  const c = llegeix('config.js');
  assert.ok(!/sb_secret|service_role|eyJ/.test(c));
});

for (const pagina of ['index.html', 'verificar.html']) {
  test(`${pagina}: CSP estricta, sense scripts/estils/handlers en línia`, () => {
    const h = llegeix(pagina);
    const csp = (h.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
    assert.ok(csp, 'falta la CSP');
    assert.match(csp, /default-src 'none'/); assert.match(csp, /script-src 'self'(;|$)/); assert.match(csp, /style-src 'self'(;|$)/);
    assert.ok(!/unsafe-inline|unsafe-eval/.test(csp), 'la CSP no pot tenir unsafe-*');
    assert.match(csp, /object-src 'none'/); assert.match(csp, /base-uri 'none'/); assert.match(csp, /form-action 'none'/);
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(h), 'script en línia');
    assert.ok(!/\son[a-z]+\s*=/i.test(h), 'handler en línia (onclick…)');
    assert.ok(!/\sstyle\s*=/i.test(h), 'estil en línia');
    assert.match(h, /name="referrer" content="no-referrer"/);
    assert.match(h, /name="viewport" content="[^"]*viewport-fit=cover/);
    assert.ok(!/https?:\/\/(?!www\.w3\.org)[a-z0-9.-]+\//i.test(h.replace(csp, '')), 'recurs extern a l’HTML');
  });
}
test('el JS no fa servir eval, document.write, localStorage ni plantilles amb handlers', () => {
  for (const f of ['app.js', 'verificar.js', 'lib.js']) {
    const t = llegeix(f);
    for (const mal of [/\beval\(/, /new Function\(/, /document\.write/, /localStorage/, /insertAdjacentHTML\(.*\+/, /\son[a-z]+\s*=\s*["'\\]/])
      assert.ok(!mal.test(t), `${f}: ${mal}`);
  }
});
test('dades de la base de dades sempre passen per esc() abans d’entrar al HTML', () => {
  const taint = /\$\{[^}]*(\.nombre|\.apellidos|\.numero_socio|\.estado|\.foto_url|\.nom\b|\.oferta|\.categoria|\.detalls)[^}]*\}/;
  for (const f of ['app.js', 'verificar.js']) {
    llegeix(f).split('\n').forEach((l, i) => {
      if (l.includes('${') && taint.test(l) && !l.includes('esc(') && !/\.map\(|\.tabs|hooks/.test(l))
        assert.fail(`${f}:${i + 1} interpolació sense esc(): ${l.trim().slice(0, 100)}`);
    });
  }
});
test('la funció Edge no registra el token ni retorna el camí de la foto', () => {
  const t = llegeix('supabase/functions/verificar/index.ts');
  assert.ok(!/console\.(log|error|warn)\([^)]*\btoken\b/i.test(t));
  assert.ok(!/foto_path:\s*data\.foto_path/.test(t));
  assert.match(t, /cf-connecting-ip/); assert.match(t, /MAX_BODY/);
});

/* ---------- SQL ---------- */
const sql = ['01_esquema', '02_verificacio', '03_pagament_i_temporada', '04_enduriment'].map(n => llegeix(`supabase/${n}.sql`)).join('\n').replace(/--.*$/gm, '');
test('SQL: totes les taules públiques tenen RLS activada', () => {
  const taules = [...sql.matchAll(/create table public\.(\w+)/g)].map(m => m[1]);
  assert.ok(taules.length >= 5, taules.join());
  for (const t of taules) assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), t);
});
test('SQL: les funcions security definer fixen search_path', () => {
  const fns = sql.split(/create or replace function/i).slice(1).filter(b => /security definer/i.test(b.split(/\$\$/)[0]));
  assert.ok(fns.length >= 4);
  for (const b of fns) assert.match(b.split(/\$\$/)[0], /set search_path = ''/i, b.slice(0, 60));
});
test('SQL: verificar_token només s’executa amb service_role', () => {
  assert.match(sql, /revoke all on function public\.verificar_token\(text, text\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.verificar_token\(text, text\) to service_role/);
  assert.ok(!/grant execute on function public\.verificar_token[^;]*(anon|authenticated|public)/i.test(sql));
});
test('SQL: els tokens només els poden demanar usuaris amb sessió', () => {
  assert.match(sql, /revoke all on function public\.obtener_mi_token\(\) from public, anon/);
  assert.match(sql, /grant execute on function public\.obtener_mi_token\(\) to authenticated/);
  assert.match(sql, /if auth\.uid\(\) is null then raise exception/i);
});
test('SQL: cap política per a anon/public i el soci només edita foto, telèfon i email', () => {
  assert.ok(!/create policy[^;]*\bto (anon|public)\b/i.test(sql));
  assert.match(sql, /grant update \(foto_path, telefono, email\) on public\.socios to authenticated/);
  assert.match(sql, /revoke update on public\.socios from authenticated/);
});
test('SQL: les fotos només es poden escriure a <id>/foto.jpg', () => {
  const finals = sql.split('drop policy if exists fotos_select')[1] || '';
  assert.ok((finals.match(/name = \(select auth\.uid\(\)\)::text \|\| '\/foto\.jpg'/g) || []).length >= 4);
});
test('SQL: la verificació valida estat actiu i pagament al dia a cada escaneig', () => {
  const v = sql.split('create or replace function public.verificar_token').pop();
  assert.match(v, /so\.estado = 'activo'/); assert.match(v, /sa\.vence >= avui/); assert.match(v, /Europe\/Madrid/);
  assert.match(v, /return jsonb_build_object\('valid', false\);/);
  assert.ok(!/'valid', false,\s*'(motiu|reason|pagament)/.test(v), 'no s’ha de revelar el motiu');
});

test('totes les imatges referenciades existeixen', () => {
  for (const f of ['index.html', 'verificar.html', 'app.js', 'style.css', 'manifest.webmanifest']) {
    for (const m of llegeix(f).matchAll(/(?:src=\\?["']|url\(|["'])((?:img\/)[\w.-]+\.(?:png|svg))/g))
      assert.ok(textuals.concat(fitxers()).some(p => p.endsWith(m[1])), `${f} referencia ${m[1]} que no existeix`);
  }
  assert.ok(fitxers().some(p => p.endsWith('fons.svg')));
});
