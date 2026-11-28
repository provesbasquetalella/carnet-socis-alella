(function () {
'use strict';
const C = window.CONFIG, L = window.Lib, T = C.TEMPORADA, esc = L.esc;
// Anti-clickjacking: la pàgina no s'ha de poder incrustar dins d'un altre web.
if (!C.PREVIEW && window.top !== window.self) { try { window.top.location = window.self.location; } catch (e) {} document.documentElement.textContent = ''; return; }

const $ = id => document.getElementById(id);
const st = {S: null, tab: 'carnet', socio: null, token: null, foto: null, loading: false, fail: {n: 0, until: 0}, avis: '', filtre: 'tots'};
const hooks = {api: null, panell: null, tabs: [], accions: {}};
const IMG = {};   // escut del club per a la targeta (es carreguen una vegada i es repinta)
[['logo', 'img/logo-crema.png'], ['marca', 'img/logo-taronja.png']].forEach(([k, src]) => { const i = new Image(); i.onload = () => { IMG[k] = i; paint(); }; i.src = src; });
const TIMEOUT = 15000, INACTIU = 20 * 60 * 1000;
let idleT = null, refrescant = null, toastT = null, confT = null;

/* ---------- xarxa ---------- */
async function net(path, o) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    return await fetch(C.SUPABASE_URL + path, {...o, signal: ctl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
  } catch (e) {
    throw Object.assign(new Error(e.name === 'AbortError' ? 'El servidor triga massa a respondre. Torna-ho a provar.' : 'Sense connexió. Revisa internet i torna-ho a provar.'), {xarxa: true});
  } finally { clearTimeout(to); }
}
async function assegura() {
  if (st.S.expires_at - Date.now() / 1000 > 60) return;
  if (!refrescant) {
    refrescant = (async () => {
      const r = await net('/auth/v1/token?grant_type=refresh_token', {method: 'POST', headers: {apikey: C.PUBLISHABLE_KEY, 'Content-Type': 'application/json'}, body: JSON.stringify({refresh_token: st.S.refresh_token})});
      if (!r.ok) throw Object.assign(new Error('caducada'), {caducada: true});
      desaSessio(await r.json());
    })().finally(() => { refrescant = null; });
  }
  try { await refrescant; } catch (e) {
    if (e.caducada) { surt('La sessió ha caducat. Torna a entrar.'); throw new Error('La sessió ha caducat. Torna a entrar.'); }
    throw e;
  }
}
async function realCall(path, o = {}) {
  const {method = 'GET', body, headers = {}, jwt = true, raw = false} = o;
  const h = {apikey: C.PUBLISHABLE_KEY, ...headers};
  if (jwt && st.S) { await assegura(); h.Authorization = 'Bearer ' + st.S.access_token; }
  let b = body;
  if (b !== undefined && !(b instanceof Blob)) { h['Content-Type'] = 'application/json'; b = JSON.stringify(b); }
  let r;
  try { r = await net(path, {method, headers: h, body: b}); }
  catch (e) { if (method === 'GET' && e.xarxa) r = await net(path, {method, headers: h, body: b}); else throw e; }
  if (raw) return r;
  const t = await r.text(); let d = null;
  try { d = t ? JSON.parse(t) : null; } catch (e) { d = t; }
  if (!r.ok) {
    if (r.status === 401 && jwt && st.S) { surt('La sessió ha caducat. Torna a entrar.'); }
    throw Object.assign(new Error((d && (d.msg || d.message || d.error_description || d.error)) || ('Error ' + r.status)), {status: r.status});
  }
  return d;
}
const call = (p, o) => (hooks.api || realCall)(p, o);

/* ---------- sessió ---------- */
function desaSessio(d) {
  st.S = {access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (d.expires_in || 3600), user: d.user};
  try { sessionStorage.setItem('sess', JSON.stringify(st.S)); } catch (e) {}
}
function surt(msg) {
  const tk = st.S && st.S.access_token;
  if (tk && !hooks.api) { try { fetch(C.SUPABASE_URL + '/auth/v1/logout?scope=local', {method: 'POST', headers: {apikey: C.PUBLISHABLE_KEY, Authorization: 'Bearer ' + tk}, keepalive: true, credentials: 'omit'}).catch(() => {}); } catch (e) {} }
  st.S = null; st.socio = null; st.token = null; st.foto = null; st.loading = false; st.tab = 'carnet'; st.avis = msg || '';
  try { sessionStorage.removeItem('sess'); } catch (e) {}
  clearTimeout(idleT); render();
}
function reiniciaInactivitat() {
  if (!st.S) return;
  clearTimeout(idleT); idleT = setTimeout(() => surt('Sessió tancada per inactivitat.'), INACTIU);
}
const mustChange = () => !!(st.S && st.S.user && st.S.user.user_metadata && st.S.user.user_metadata.must_change_password === true);
function notifica(msg, ko) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast' + (ko ? ' ko' : ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 7000);
}
function err(m) { const e = $('e'); if (e) e.textContent = m; }
async function amb(btn, fn) {
  if (btn) btn.disabled = true;
  try { await fn(); } finally { if (btn && btn.isConnected) btn.disabled = false; }
}

/* ---------- accions ---------- */
const FORM = {
  async login(f) {
    const num = $('num').value.trim(), pw = $('pw').value, btn = $('go');
    const seg = L.segonsBloqueig(st.fail, Date.now());
    if (seg > 0) return err('Massa intents fallits. Espera ' + seg + ' segons.');
    if (!L.numeroValid(num)) return err('El número de soci té 4 xifres.');
    if (!pw) return err('Escriu la clau.');
    await amb(btn, async () => {
      try {
        desaSessio(await call('/auth/v1/token?grant_type=password', {method: 'POST', jwt: false, body: {email: num + '@' + C.DOMINI, password: pw}}));
        st.fail = {n: 0, until: 0}; st.avis = '';
        await inici();
      } catch (e) {
        st.S = null;
        if (e.status === 400 || e.status === 401) { st.fail = L.registraFallada(st.fail, Date.now()); err('Número de soci o clau incorrectes.'); }
        else if (e.status === 429) err('Massa intents. Espera uns minuts i torna-ho a provar.');
        else err(e.message);
      }
    });
  },
  async canvi(f) {
    const a = $('n1').value, b = $('n2').value, num = ((st.S.user && st.S.user.email) || '').slice(0, 4);
    const v = L.validaClau(a, num); if (v) return err(v);
    if (a !== b) return err('Les dues claus no coincideixen.');
    await amb($('gc'), async () => {
      try {
        st.S.user = await call('/auth/v1/user', {method: 'PUT', body: {password: a, data: {must_change_password: false}}});
        desaSessio({access_token: st.S.access_token, refresh_token: st.S.refresh_token, expires_in: st.S.expires_at - Math.floor(Date.now() / 1000), user: st.S.user});
        await inici();
      } catch (e) { err(/different|same/i.test(e.message) ? 'La clau nova ha de ser diferent de l’actual.' : e.message); }
    });
  }
};
const ACT = {
  tab(b) { st.tab = b.dataset.tab; render(); window.scrollTo(0, 0); },
  filtre(b) { st.filtre = b.dataset.f; pintaCupons(); },
  surt() { surt(); },
  async regen(b) {
    if (!b.dataset.conf) {
      const sp = b.querySelector('span'); b.dataset.conf = '1'; b.dataset.text = sp.textContent; sp.textContent = 'Confirma: el QR actual deixarà de funcionar'; b.classList.add('conf');
      clearTimeout(confT); confT = setTimeout(() => { if (b.isConnected) { delete b.dataset.conf; b.querySelector('span').textContent = b.dataset.text; b.classList.remove('conf'); } }, 6000);
      return;
    }
    clearTimeout(confT);
    await amb(b, async () => {
      try { st.token = await call('/rest/v1/rpc/regenerar_mi_token', {method: 'POST', body: {}}); notifica('QR regenerat. L’anterior ja no funciona.'); render(); }
      catch (e) { notifica(e.message, true); }
    });
  },
  baixa() {
    const cv = $('cv'); if (!cv) return;
    cv.toBlob(b => {
      if (!b) return notifica('No s’ha pogut crear la imatge.', true);
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'carnet-' + st.socio.numero_socio + '.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
  }
};
function carregaImg(u) { return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('imatge')); i.src = u; }); }

async function inici() {
  if (mustChange()) return render();
  st.loading = true; render();
  try {
    const f = await call('/rest/v1/socios?select=numero_socio,nombre,apellidos,foto_path,estado&id=eq.' + encodeURIComponent(st.S.user.id));
    if (!Array.isArray(f) || !f[0]) throw new Error('No s’ha trobat la teva fitxa de soci. Contacta amb el club.');
    st.socio = f[0];
    st.token = await call('/rest/v1/rpc/obtener_mi_token', {method: 'POST', body: {}});
    if (!L.tokenValid(st.token)) throw new Error('No s’ha pogut generar el QR. Torna-ho a provar.');
    st.foto = null;
    if (L.fotoPathValid(st.socio.foto_path)) {
      try {
        const r = await call('/storage/v1/object/authenticated/fotos/' + st.socio.foto_path, {raw: true});
        if (r.ok) { const u = URL.createObjectURL(await r.blob()); st.foto = await carregaImg(u); URL.revokeObjectURL(u); }
      } catch (e) { /* sense foto: la targeta mostra la silueta */ }
    }
  } catch (e) {
    st.loading = false;
    if (st.S) { const m = e.message; surt(m); } return;
  }
  st.loading = false; reiniciaInactivitat(); render();
}

async function pujaFoto(inp) {
  const f = inp.files && inp.files[0]; inp.value = '';
  if (!f) return;
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return notifica('Tria una imatge JPEG, PNG o WebP.', true);
  if (f.size > 20 * 1024 * 1024) return notifica('La imatge és massa gran (màxim 20 MB).', true);
  try {
    const u = URL.createObjectURL(f); let img;
    try { img = await carregaImg(u); } finally { URL.revokeObjectURL(u); }
    if (img.width > 12000 || img.height > 12000 || img.width < 100 || img.height < 100) return notifica('Mida d’imatge no admesa (entre 100 i 12000 px).', true);
    const cv = document.createElement('canvas'); cv.width = cv.height = 600;
    const k = Math.max(600 / img.width, 600 / img.height), w = img.width * k, h = img.height * k;
    cv.getContext('2d').drawImage(img, (600 - w) / 2, (600 - h) / 2, w, h);   // es torna a codificar: s'esborren metadades i qualsevol contingut amagat
    let blob = null;
    for (const q of [0.85, 0.7, 0.5, 0.35]) {
      blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= 524288) break;
    }
    if (!blob || blob.size > 524288) return notifica('No s’ha pogut reduir la foto a menys de 500 KB.', true);
    const path = st.S.user.id + '/foto.jpg';
    await call('/storage/v1/object/fotos/' + path, {method: 'POST', body: blob, headers: {'Content-Type': 'image/jpeg', 'x-upsert': 'true'}});
    await call('/rest/v1/socios?id=eq.' + encodeURIComponent(st.S.user.id), {method: 'PATCH', body: {foto_path: path}, headers: {Prefer: 'return=minimal'}});
    st.socio.foto_path = path; st.foto = await carregaImg(URL.createObjectURL(blob)); notifica('Foto desada.'); render();
  } catch (e) { notifica(e.message === 'imatge' ? 'No es pot llegir aquesta imatge (prova JPEG, PNG o WebP).' : 'No s’ha pogut pujar la foto: ' + e.message, true); }
}

/* ---------- vistes ---------- */
const I = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICO = {
  carnet: I('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/>'),
  av: I('<path d="M3 12V4h8l10 10-8 8L3 12z"/><circle cx="7.5" cy="8.5" r="1.3"/>'),
  scan: I('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/>'),
  baixa: I('<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/>'),
  regen: I('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>'),
  foto: I('<rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="3.5"/><path d="M8.5 6l1.2-2h4.6l1.2 2"/>'),
  sortir: I('<path d="M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4M15 8l4 4-4 4M19 12H9"/>'),
  check: I('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  info: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>')
};
const NOM_CAT = {club: 'El club', alimentacio: 'Alimentació', vi: 'Vi i gastronomia', salut: 'Salut', esport: 'Esports'};

function render() {
  const ok = !!st.S && !!st.socio && !st.loading && !mustChange();
  document.body.classList.toggle('amb-nav', ok);
  const nav = $('nav'); nav.hidden = !ok;
  if (ok) nav.innerHTML = [['carnet', 'El meu carnet', 'carnet'], ['av', 'Avantatges', 'av'], ...hooks.tabs.map(t => [t.id, t.text, t.icona || 'scan'])]
    .map(([id, t, ic]) => `<button type="button" data-act="tab" data-tab="${esc(id)}" class="${st.tab === id ? 'sel' : ''}" aria-current="${st.tab === id}">${ICO[ic] || ''}<span>${esc(t)}</span></button>`).join('');
  const el = $('app');
  if (!st.S) {
    const falta = C.PUBLISHABLE_KEY.includes('POSA_AQUI');
    el.innerHTML = `<div class="entrada"><section class="lema"><img class="emblema" src="img/logo-taronja.png" alt="" aria-hidden="true"><span class="xip">Temporada ${esc(T)}</span>
      <h2>El teu carnet de soci, <em>sempre a la butxaca</em></h2><p>Ensenya el QR als comerços associats i aprofita els descomptes del club i d’Alella.</p>
      <ul class="punts"><li>${ICO.check}Carnet sempre al mòbil</li><li>${ICO.check}QR verificat en temps real</li><li>${ICO.check}Descomptes al club i als comerços</li></ul></section>
      <form class="panel" data-form="login" novalidate><h2>Entra al teu carnet</h2>
      <label for="num">Número de soci</label><input id="num" type="text" name="username" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="username" required>
      <label for="pw">Clau</label><input id="pw" name="password" type="password" autocomplete="current-password" required>
      <div class="err" id="e" role="alert">${esc(falta ? 'Falta posar la clau pública a config.js.' : st.avis)}</div>
      <button class="btn p" id="go" type="submit">Entrar</button>
      <p class="small">${C.PREVIEW ? 'Previsualització: soci <b>0001</b> · clau <b>1234</b> (entra directe) o soci <b>0002</b> · clau <b>provisional1</b> (et demana triar una clau nova).' : 'Si és el teu primer accés, fes servir la clau que t’ha donat el club. Te’n demanarem una de nova.'}</p></form></div>`;
    return;
  }
  if (mustChange()) {
    el.innerHTML = `<form class="panel" data-form="canvi" novalidate><h2>Tria la teva clau</h2><p class="small">És el primer accés: cal una clau pròpia de mínim 10 caràcters, amb lletres, que no sigui previsible.</p>
      <label for="n1">Clau nova</label><input id="n1" type="password" autocomplete="new-password" required>
      <label for="n2">Repeteix-la</label><input id="n2" type="password" autocomplete="new-password" required>
      <div class="err" id="e" role="alert"></div><button class="btn p" id="gc" type="submit">Desar i continuar</button>
      <button class="btn" type="button" data-act="surt">Sortir</button></form>`;
    el.firstElementChild.classList.add('panel-estret');
    return;
  }
  if (st.loading || !st.socio) { el.innerHTML = '<p class="panel">Carregant…</p>'; return; }
  if (st.tab === 'av') return vistaAvantatges();
  const h = hooks.tabs.find(t => t.id === st.tab); if (h) { el.innerHTML = h.vista(); return; }
  const s = st.socio, actiu = s.estado === 'activo';
  el.innerHTML = `<div class="escena"><section class="stage"><div class="cap"><h2>El teu carnet</h2><span class="xip">${esc(T)}</span></div>
    <canvas id="cv" class="carnet" width="1011" height="638" role="img" aria-label="Carnet de soci de ${esc(s.nombre)} ${esc(s.apellidos)}, número ${esc(s.numero_socio)}, temporada ${esc(T)}"></canvas></section>
    <aside><section class="panel"><h2>Accions</h2><div class="accions">
    <button class="acc primari" type="button" data-act="baixa">${ICO.baixa}<span>Descarregar carnet<br><small>Imatge PNG</small></span></button>
    <button class="acc" type="button" data-act="regen">${ICO.regen}<span>Regenerar QR</span></button>
    <label class="acc" for="foto">${ICO.foto}<span>${s.foto_path ? 'Canviar foto' : 'Pujar foto'}</span></label><input id="foto" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" data-change="foto">
    <button class="acc lleuger" type="button" data-act="surt">${ICO.sortir}<span>Tancar sessió</span></button></div>
    ${s.foto_path ? '' : '<div class="warn">Puja una foto: el comerç la fa servir per comprovar que ets tu.</div>'}
    ${actiu ? '' : `<div class="warn">El teu estat és «${esc(s.estado)}»: el QR mostrarà NO ACTIU. Contacta amb el club.</div>`}
    <p class="info">${ICO.info}<span>El QR comprova en temps real que ets soci actiu i al corrent de pagament: el comerç veurà «ACTIU» o «NO ACTIU». Si algú comparteix una captura del teu QR, regenera’l.</span></p></section>
    ${hooks.panell ? hooks.panell() : ''}</aside></div>`;
  paint();
}

function cupo(a) {
  const mono = a.club ? '<img src="img/logo-ocell.png" alt="">' : esc(a.mono || (a.nom || '?').slice(0, 2).toUpperCase()), clara = a.tinta === 'clara' ? ' clara' : '';
  const stub = a.pack
    ? `<div class="preus"><s>${esc(a.preuAntic)}</s><b>${esc(a.preuNou)}</b></div><div class="valor-t">Pack de soci</div>`
    : `<div class="valor${String(a.valor).length > 4 ? ' llarg' : ''}">${esc(a.valor)}</div><div class="valor-t">${esc(a.valorText)}</div>`;
  const llista = (a.detalls || []).map(d => `<li>${ICO.check}<span>${esc(d)}</span></li>`);
  const detalls = a.club ? `<div class="xips">${(a.detalls || []).map(d => `<span>${esc(d)}</span>`).join('')}</div>` : `<ul class="tics">${llista.join('')}</ul>`;
  return `<article class="cupo${a.club ? ' club' : ''}" data-color="${esc(a.color || '#F88018')}"><div class="stub${clara}">${stub}</div>
    <div class="cos"><div class="cap"><span class="mono${clara}${a.club ? ' logo' : ''}">${mono}</span><div><h3>${esc(a.nom)}</h3><span class="etiq${a.pack ? ' pack' : ''}">${esc(a.pack ? a.categoria + ' · Pack' : a.categoria)}</span></div></div>
    <p class="of">${esc(a.oferta)}</p>${detalls}</div></article>`;
}
function pintaColors(arrel) {
  arrel.querySelectorAll('[data-color]').forEach(e => { const c = e.dataset.color; if (/^#[0-9a-fA-F]{6}$/.test(c)) e.style.setProperty('--c', c); });
}
function pintaCupons() {
  const tots = window.AVANTATGES || [], contenidor = $('cupons'); if (!contenidor) return;
  document.querySelectorAll('.filtres button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === st.filtre)));
  contenidor.innerHTML = tots.filter(a => st.filtre === 'tots' || a.cat === st.filtre).map(cupo).join('') || '<p class="panel">Cap oferta en aquesta categoria.</p>';
  pintaColors(contenidor);
}
function vistaAvantatges() {
  const tots = window.AVANTATGES || [], cats = ['tots', ...new Set(tots.map(a => a.cat).filter(Boolean))];
  if (!cats.includes(st.filtre)) st.filtre = 'tots';
  const chips = cats.map(c => `<button type="button" data-act="filtre" data-f="${esc(c)}" aria-pressed="${c === st.filtre}">${esc(c === 'tots' ? 'Tots' : NOM_CAT[c] || c)}</button>`).join('');
  $('app').innerHTML = `<section class="intro"><h2>Avantatges per a socis</h2><p>${esc(window.AVANTATGES_CONDICIONS || '')}</p>
    ${window.AVANTATGES_EXEMPLE ? '<div class="warn">Llistat d’exemple: establiments i ofertes inventats.</div>' : ''}</section>
    <ol class="passos"><li>Obre el teu carnet al mòbil</li><li>Ensenya el QR al comerç</li><li>El comerç veu «ACTIU» i t’aplica l’oferta</li></ol>
    <div class="filtres" role="group" aria-label="Filtra per categoria">${chips}</div><div class="cupons" id="cupons"></div>`;
  pintaCupons();
}

/* ---------- targeta ---------- */
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function paint() {
  const cv = $('cv'); if (!cv || !st.socio) return;
  const s = st.socio, c = cv.getContext('2d'), F = 'system-ui,Arial,sans-serif', D = '"Arial Narrow","Roboto Condensed",system-ui,Arial,sans-serif';
  const g = c.createLinearGradient(0, 0, 1011, 638); g.addColorStop(0, '#0B261E'); g.addColorStop(1, '#15402F'); c.fillStyle = g; c.fillRect(0, 0, 1011, 638);
  c.strokeStyle = 'rgba(245,240,228,.08)'; c.lineWidth = 4;                                  // línies de pista
  c.beginPath(); c.arc(930, 700, 330, Math.PI, 2 * Math.PI); c.stroke(); c.beginPath(); c.arc(930, 700, 190, Math.PI, 2 * Math.PI); c.stroke();
  c.beginPath(); c.arc(40, 330, 150, -Math.PI / 2, Math.PI / 2); c.stroke();
  c.fillStyle = '#F88018'; c.fillRect(0, 0, 1011, 14);
  c.beginPath(); c.moveTo(0, 638); c.lineTo(0, 560); c.lineTo(160, 638); c.closePath(); c.fill();
  if (IMG.marca) { c.save(); c.globalAlpha = .08; const w = 470, h = w * IMG.marca.height / IMG.marca.width; c.drawImage(IMG.marca, 520, 150, w, h); c.restore(); }   // filigrana
  if (IMG.logo) { const h = 98, w = h * IMG.logo.width / IMG.logo.height; c.drawImage(IMG.logo, 50, 20, w, h); }
  else { c.fillStyle = '#F5F0E4'; c.font = '900 40px ' + D; c.fillText('CB ALELLA', 50, 78); }
  c.textAlign = 'right'; c.fillStyle = '#F88018'; c.font = '900 34px ' + D; c.fillText('CARNET DE SOCI', 961, 70);
  c.fillStyle = '#F5F0E4'; c.font = '800 24px ' + D; c.fillText('TEMPORADA ' + T, 961, 104); c.textAlign = 'left';
  c.fillStyle = 'rgba(190,205,198,.35)'; c.fillRect(50, 122, 911, 2);
  rr(c, 50, 160, 270, 270, 26); c.fillStyle = '#2D5850'; c.fill();
  if (st.foto) { c.save(); rr(c, 50, 160, 270, 270, 26); c.clip(); const k = Math.max(270 / st.foto.width, 270 / st.foto.height), w = st.foto.width * k, h = st.foto.height * k; c.drawImage(st.foto, 50 + (270 - w) / 2, 160 + (270 - h) / 2, w, h); c.restore(); }
  else { c.fillStyle = '#BECDC6'; c.beginPath(); c.arc(185, 265, 45, 0, 7); c.fill(); c.beginPath(); c.ellipse(185, 400, 80, 65, 0, Math.PI, 0); c.fill(); }
  rr(c, 50, 160, 270, 270, 26); c.strokeStyle = '#F88018'; c.lineWidth = 4; c.stroke();
  c.fillStyle = '#BECDC6'; c.font = '600 20px ' + F; c.fillText('NOM', 360, 190);
  c.fillStyle = '#F5F0E4'; c.font = '900 46px ' + D; c.fillText(s.nombre, 360, 240, 340); c.fillText(s.apellidos, 360, 292, 340);
  c.fillStyle = '#BECDC6'; c.font = '600 20px ' + F; c.fillText('Nº DE SOCI', 360, 372);
  c.fillStyle = '#F88018'; c.font = '900 96px ' + D; c.fillText(s.numero_socio, 358, 452);
  rr(c, 696, 318, 265, 265, 22); c.fillStyle = '#fff'; c.fill();     // QR més gran: mòduls de 5 px (més fàcil d'escanejar)
  if (L.tokenValid(st.token)) window.QRGen.dibuixa(c, C.WEB_URL + '/verificar.html?id=' + st.token, 706, 328, 245, 'M', 0);
  c.fillStyle = '#BECDC6'; c.font = '600 22px ' + F; c.fillText('Temporada ' + T + ' · Escaneja el QR per verificar', 190, 604);
}

/* ---------- arrencada ---------- */
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b || b.disabled) return; const f = ACT[b.dataset.act] || hooks.accions[b.dataset.act]; if (f) f(b, e); });
document.addEventListener('submit', e => { const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault(); if (FORM[f.dataset.form]) FORM[f.dataset.form](f); });
document.addEventListener('change', e => { if (e.target.matches && e.target.matches('[data-change="foto"]')) pujaFoto(e.target); });
['click', 'keydown', 'touchstart', 'scroll'].forEach(ev => document.addEventListener(ev, reiniciaInactivitat, {passive: true}));
const net_ = () => { $('offline').hidden = navigator.onLine; };
window.addEventListener('online', net_); window.addEventListener('offline', net_); net_();

$('temp').textContent = T;
window.CarnetApp = {
  state: st, render, notifica,
  setApi(fn) { hooks.api = fn; }, pestanya(id, text, vista, icona) { hooks.tabs.push({id, text, vista, icona}); },
  panell(fn) { hooks.panell = fn; }, accio(n, fn) { hooks.accions[n] = fn; }
};
if (!C.PREVIEW) {
  let saved = null; try { saved = JSON.parse(sessionStorage.getItem('sess') || 'null'); } catch (e) {}
  if (saved && saved.access_token && saved.user) { st.S = saved; inici(); } else render();
}
})();
