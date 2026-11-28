import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const Lib = createRequire(import.meta.url)('../lib.js');

test('esc neutralitza HTML i cometes', () => {
  assert.equal(Lib.esc('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;');
  assert.equal(Lib.esc(`'"\`&`), '&#39;&quot;&#96;&amp;');
  assert.equal(Lib.esc(null), ''); assert.equal(Lib.esc(undefined), ''); assert.equal(Lib.esc(42), '42');
});
test('tokenValid només accepta 64 caràcters hexadecimals en minúscula', () => {
  assert.ok(Lib.tokenValid('a'.repeat(64)));
  assert.ok(Lib.tokenValid('0123456789abcdef'.repeat(4)));
  for (const mal of ['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), null, undefined, 123, {}, [], "' or 1=1 --", 'a'.repeat(32) + '-' + 'a'.repeat(31), '../'.repeat(22)])
    assert.equal(Lib.tokenValid(mal), false, String(mal));
});
test('numeroValid: 4 xifres', () => {
  assert.ok(Lib.numeroValid('0001')); assert.ok(Lib.numeroValid('9999'));
  for (const mal of ['001', '00011', 'abcd', '00 1', '', null, 1, '0001\n']) assert.equal(Lib.numeroValid(mal), false, String(mal));
});
test('fotoPathValid només accepta <uuid>/foto.jpg', () => {
  const u = '123e4567-e89b-12d3-a456-426614174000';
  assert.ok(Lib.fotoPathValid(u + '/foto.jpg'));
  for (const mal of ['../' + u + '/foto.jpg', u + '/altra.jpg', u + '/foto.jpg/..', u + '/../foto.jpg', 'x/foto.jpg', '', null, u + '/foto.jpg?x=1', '//evil.com/foto.jpg'])
    assert.equal(Lib.fotoPathValid(mal), false, String(mal));
});
test('validaClau', () => {
  assert.match(Lib.validaClau('curta', '0001'), /Mínim 10/);
  assert.match(Lib.validaClau('1234567890', '0001'), /lletres/);
  assert.match(Lib.validaClau('aaaaaaaaaaaa', '0001'), /repetit/);
  assert.match(Lib.validaClau('abc0001defgh', '0001'), /número de soci/);
  assert.match(Lib.validaClau('Password2027x', '0001'), /previsible/);
  assert.match(Lib.validaClau('provisional1', '0001'), /previsible/);
  assert.match(Lib.validaClau('a'.repeat(80), '0001'), /Màxim 72/);
  assert.match(Lib.validaClau('é'.repeat(40), '0001'), /Màxim 72/);   // 72 bytes, no caràcters
  assert.equal(Lib.validaClau('Camp-Basquet-2027', '0001'), '');
  assert.equal(Lib.validaClau('una frase llarga i curiosa', '0001'), '');
});
test('vigent: estat actiu + pagament al dia (inclòs el mateix dia)', () => {
  const avui = '2026-11-27';
  assert.equal(Lib.vigent('activo', '2027-06-30', avui), true);
  assert.equal(Lib.vigent('activo', avui, avui), true);
  assert.equal(Lib.vigent('activo', '2026-11-26', avui), false);
  assert.equal(Lib.vigent('suspendido', '2027-06-30', avui), false);
  assert.equal(Lib.vigent('baja', '2027-06-30', avui), false);
  assert.equal(Lib.vigent('activo', null, avui), false);
  assert.equal(Lib.vigent('activo', undefined, avui), false);
  assert.match(Lib.avui(), /^\d{4}-\d{2}-\d{2}$/);
});
test('bloqueig després de 5 intents fallits', () => {
  let f = {n: 0, until: 0}; const t0 = 1_000_000;
  for (let i = 0; i < 4; i++) { f = Lib.registraFallada(f, t0); assert.equal(Lib.segonsBloqueig(f, t0), 0); }
  f = Lib.registraFallada(f, t0);
  assert.equal(Lib.segonsBloqueig(f, t0), 60);
  assert.equal(Lib.segonsBloqueig(f, t0 + 30_000), 30);
  assert.equal(Lib.segonsBloqueig(f, t0 + 61_000), 0);
  assert.equal(f.n, 0);
});
test('iniciais', () => { assert.equal(Lib.iniciais('marta', 'puig'), 'MP'); assert.equal(Lib.iniciais('', ''), '?'); assert.equal(Lib.iniciais(null, null), '?'); });
