(function () {
'use strict';
const C = window.CONFIG, L = window.Lib, esc = L.esc;
const id = new URLSearchParams(location.search).get('id') || '';
const $ = i => document.getElementById(i);
const CADUCA = 90000, REFRESCA_VISIBLE = 30000, TIMEOUT = 12000;
let seq = 0, ultima = 0, clock = null, caducaT = null;

const SVG = {ok: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>', ko: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>', av: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6M12 17h.01"/></svg>'};
function pinta(cls, html, ambHora, ico) {
  clearInterval(clock); clearTimeout(caducaT);
  const r = $('r'); r.className = 'res ' + cls;
  r.innerHTML = `<div class="estat-ico">${SVG[ico || cls]}</div>` + html + (ambHora ? '<div class="hora"><span class="live"><i></i>Comprovat en directe a les <b id="h"></b></span><br>Ara són les <b id="ara"></b></div>' : '') + '<button type="button" id="rep">Tornar a comprovar</button>';
  $('rep').addEventListener('click', comprova);
  if (ambHora) {
    $('h').textContent = new Date().toLocaleTimeString('ca-ES');
    const tic = () => { const e = $('ara'); if (e) e.textContent = new Date().toLocaleTimeString('ca-ES'); };
    tic(); clock = setInterval(tic, 1000);
  }
  caducaT = setTimeout(comprova, CADUCA);   // el resultat no es pot reutilitzar: es torna a comprovar sol
}
function fotoSegura(u) { return typeof u === 'string' && u.startsWith(C.SUPABASE_URL + '/storage/') ? u : null; }

async function comprova() {
  const mi = ++seq; ultima = Date.now();
  if (!L.tokenValid(id)) return pinta('ko', '<h1>✖ QR NO VÀLID</h1><p>Aquest enllaç no correspon a cap carnet de soci.</p>', false, 'av');
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(C.SUPABASE_URL + '/functions/v1/verificar', {method: 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal,
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token: id})});
    const d = await r.json().catch(() => ({}));
    if (mi !== seq) return;   // ha arribat una resposta antiga
    if (d && d.valid === true) {
      const u = fotoSegura(d.foto_url);
      const foto = u ? `<img src="${esc(u)}" alt="Foto del soci">` : `<div class="ph" aria-hidden="true">${esc(L.iniciais(d.nombre, d.apellidos))}</div>`;
      return pinta('ok', `<h1>✔ SOCI ACTIU</h1>${foto}<div class="n">${esc(d.numero_socio)}</div><div class="nom">${esc(d.nombre)} ${esc(d.apellidos)}</div><p>Comprova que la foto coincideix amb la persona.</p>`, true);
    }
    if (r.status === 429) return pinta('ko', '<h1>Massa intents</h1><p>Torna-ho a provar d’aquí uns minuts.</p>', false, 'av');
    if (r.status >= 400 || (d && d.error)) return pinta('ko', '<h1>No s’ha pogut comprovar</h1><p>Torna-ho a provar.</p>', false, 'av');
    pinta('ko', '<h1>✖ NO ACTIU</h1>', true);
  } catch (e) {
    if (mi === seq) pinta('ko', '<h1>Sense connexió</h1><p>No s’ha pogut comprovar. Revisa internet i torna-ho a provar.</p>', false, 'av');
  } finally { clearTimeout(to); }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - ultima > REFRESCA_VISIBLE) comprova(); });
window.addEventListener('pageshow', e => { if (e.persisted) comprova(); });
comprova();
})();
