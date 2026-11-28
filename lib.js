// Funcions pures compartides per la web i per les proves automàtiques.
(function (root) {
  'use strict';
  const Lib = {
    esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"'`]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'}[c]));
    },
    tokenValid(t) { return typeof t === 'string' && /^[0-9a-f]{64}$/.test(t); },
    numeroValid(n) { return typeof n === 'string' && /^[0-9]{4}$/.test(n); },
    fotoPathValid(p) { return typeof p === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/foto\.jpg$/.test(p); },
    // Retorna '' si la clau és acceptable, o el missatge d'error.
    validaClau(clau, numero) {
      if (typeof clau !== 'string' || clau.length < 10) return 'Mínim 10 caràcters.';
      if (new TextEncoder().encode(clau).length > 72) return 'Màxim 72 caràcters.';
      if (/^(.)\1+$/.test(clau)) return 'No pot ser el mateix caràcter repetit.';
      if (/^[0-9]+$/.test(clau)) return 'Afegeix lletres: només amb xifres és massa fàcil d’endevinar.';
      if (numero && clau.includes(numero)) return 'No pot contenir el teu número de soci.';
      if (/(password|contrasenya|contraseña|provisional|123456789|qwertyuiop)/i.test(clau)) return 'Aquesta clau és massa previsible. Tria’n una altra.';
      return '';
    },
    // Regla del QR (la mateixa que fa servir la base de dades): estat actiu + pagament al dia.
    vigent(estat, vence, avui) { return estat === 'activo' && typeof vence === 'string' && vence >= avui; },
    avui() { return new Date().toLocaleDateString('sv-SE', {timeZone: 'Europe/Madrid'}); },
    iniciais(n, c) { return ((n || '?')[0] + ((c || '')[0] || '')).toUpperCase(); },
    // Bloqueig temporal després de 5 intents fallits (només comoditat; el servidor té els seus propis límits).
    segonsBloqueig(f, ara) { return f.until > ara ? Math.ceil((f.until - ara) / 1000) : 0; },
    registraFallada(f, ara) { const n = f.n + 1; return n >= 5 ? {n: 0, until: ara + 60000} : {n: n, until: 0}; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Lib; else root.Lib = Lib;
})(typeof window !== 'undefined' ? window : globalThis);
