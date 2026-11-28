# Carnet digital de soci · CB Alella (versió 4 · amb l'escut del club)

Web per a mòbil i ordinador (GitHub Pages) + Supabase. Targeta de la **temporada 2026/27** amb QR que es valida **en temps real**, i llistat d'**avantatges** (ofertes dels establiments vinculats) amb disseny de vals.

## Com funciona el QR
El QR porta `…/verificar.html?id=<token aleatori de 64 caràcters>`. Quan un comerç l'escaneja, la pàgina pregunta a Supabase **en aquell moment** i mostra:
- **✔ SOCI ACTIU** (número, nom i foto) si el soci té estat `activo` **i** està al corrent de pagament (`vence` ≥ avui);
- **✖ NO ACTIU** (cap dada, cap motiu) en qualsevol altre cas.

El resultat es torna a comprovar sol cada 90 s i en tornar a la pestanya. La targeta no mostra res de l'estat ni del pagament.

## Què hi ha
| Fitxer | Per a què serveix |
| --- | --- |
| `index.html`, `app.js`, `style.css` | Web del soci: login, canvi de clau, targeta, foto, regenerar QR, avantatges |
| `verificar.html`, `verificar.js` | Pàgina pública que obre el comerç en escanejar el QR |
| `config.js` | URL de Supabase, clau **pública**, adreça de la web i temporada (**l'has d'editar**) |
| `avantatges.js` | Establiments i ofertes (editable; ara són d'**exemple**) |
| `lib.js`, `qr.js`, `fons.svg` | Utilitats, generador de QR (MIT, sense CDN) i fons de pista |
| `img/` | Escut del club en PNG transparent (`logo-crema`, `logo-taronja`, `logo-ocell`) i icones de l'app (`favicon`, `apple-touch-icon`, `icona-192/512`) |
| `manifest.webmanifest` | Permet afegir el carnet a la pantalla d'inici del mòbil com una app |
| `supabase/01…04_*.sql` | Base de dades (01, 02, 03 ja executats; **04 és nou**) |
| `supabase/functions/verificar/index.ts` | Funció pública de verificació (reforçada) |
| `scripts/` | Alta de socis i proves en directe (`provar_login.py`, `provar_seguretat.py`) |
| `tests/`, `package.json` | Proves automàtiques (vegeu «Proves») |

**Mai a GitHub:** `.env`, `claus_inicials_*.csv`, `socis_privats*.csv` i fotos reals (el `.gitignore` ja ho bloqueja).

## Posar-ho en marxa (ordre)

### 1. Supabase · SQL
SQL Editor → New query. Si no ho has fet, executa `03_pagament_i_temporada.sql`. Després executa **`04_enduriment.sql`**: al final ha de mostrar totes les taules amb `rls_activa = true`.

### 2. Supabase · funció `verificar`
Edge Functions → `verificar` → editor → enganxa el nou `index.ts` → Deploy. Comprova:
- **Verify JWT** desactivat;
- secret `CLAU_SECRETA` = la teva secret key (`sb_secret_...`);
- secret `ALLOWED_ORIGIN` = `https://provesbasquetalella.github.io` (només el domini).

### 3. Supabase · ajustos d'Authentication (cal fer-ho a mà)
- Sign In / Providers → **Allow new users to sign up: desactivat**.
- Email → **Minimum password length: 10**.
- Si el teu pla ho permet, activa «Prevent use of leaked passwords».
- Mantén el temps de vida del JWT en 3600 s (per defecte).

### 4. `config.js`
Posa la **Publishable key** (`sb_publishable_...`) on diu `POSA_AQUI_LA_TEVA_CLAU`. És pública.

### 5. GitHub
Add file → Upload files → **arrossega** tot el contingut de la carpeta (fitxers i carpetes) → Commit changes. Sobreescriu els antics. Els fitxers amagats (`.gitignore`, `.env.example`) es creen a mà amb *Create new file* si no s'han pujat. Comprova que NO hi ha `.env` ni `claus_inicials_*.csv`.

### 6. GitHub Pages
Settings → Pages → Deploy from a branch → `main` / `(root)` → Save. Adreça: `https://provesbasquetalella.github.io/carnet-socis-alella/`.

> La CSP de les pàgines permet connexions a `https://*.supabase.co`. Si algun dia uses un domini propi a Supabase, cal canviar-ho a `index.html` i `verificar.html`.

## Proves
**Automàtiques (al teu ordinador, sense tocar Supabase)**
```bash
node --test                                    # 34 proves: lògica, funció Edge, auditoria estàtica de seguretat i SQL
pip install playwright opencv-python-headless pillow
playwright install chromium
python tests/e2e_navegador.py                  # 12 proves de navegador (login, QR, XSS, temps real, offline, responsiu…)
```
**En directe contra el teu Supabase**
```bash
python scripts/provar_login.py    claus_inicials_AAAAMMDD-HHMM.csv   # login i QR de cada soci
python scripts/provar_seguretat.py claus_inicials_AAAAMMDD-HHMM.csv  # intents d'atac amb la clau pública (cal ≥ 2 socis)
python scripts/provar_seguretat.py claus_inicials_AAAAMMDD-HHMM.csv --limit   # a més, el límit d'intents (bloqueja la teva IP uns 10 min)
```
Necessiten al `.env`: `SUPABASE_URL` i `SUPABASE_PUBLISHABLE_KEY`. Vegeu `INFORME_PROVES.md` per al que s'ha provat i el que falta.

## Gestió diària (SQL Editor, canviant el número de soci)
```sql
-- Ha pagat la temporada 26/27
update public.socios_admin set vence = date '2027-06-30'
 where socio_id = (select id from public.socios where numero_socio = '0011');
-- Pagament pendent (el QR passa a NO ACTIU a l'instant)
update public.socios_admin set vence = current_date - 1
 where socio_id = (select id from public.socios where numero_socio = '0011');
-- Suspendre
update public.socios set estado = 'suspendido' where numero_socio = '0011';
-- Veure l'estat de tothom
select s.numero_socio, s.nombre, s.apellidos, s.estado, a.vence,
       (s.estado = 'activo' and a.vence >= current_date) as qr_actiu
  from public.socios s left join public.socios_admin a on a.socio_id = s.id order by s.numero_socio;
```

## Escut i icones
L'escut surt a la capçalera, a la targeta (amb una filigrana de l'àguila), al login i al val del club. Es va crear a partir de `Icono3.jpg` (àguila horitzontal) i `Icono2.jpg` (àguila en diagonal), convertits a PNG transparents. Si el club té els originals en vectorial (SVG/AI), es poden substituir els fitxers de `img/` mantenint el nom. La icona d'aplicació és l'àguila taronja sobre verd fosc.
Per instal·lar el carnet al mòbil: obre la web amb Chrome (Android) o Safari (iPhone) → «Afegeix a la pantalla d'inici».

## Alta de socis nous
```bash
python scripts/alta_socis.py scripts/socis_proves.csv --dry-run
python scripts/alta_socis.py scripts/socis_proves.csv --vence 2027-06-30
```
Necessita `.env` amb `SUPABASE_URL` i `SUPABASE_SECRET_KEY`. Es pot repetir: salta els socis que ja existeixen.

## Canviar els avantatges
Edita `avantatges.js`. Cada oferta té: `cat` (club, alimentacio, vi, salut, esport), `nom`, `mono` (inicials), `categoria`, `color` (#RRGGBB), `tinta: "clara"` si el text sobre el color ha de ser blanc, `oferta`, `detalls`, i **o bé** `valor` + `valorText` (p. ex. "−20%" + "pa i brioixeria") **o bé** `pack: true` + `preuAntic` + `preuNou`. Quan siguin reals, posa `AVANTATGES_EXEMPLE = false`. Per a la temporada vinent, canvia `TEMPORADA` a `config.js`.

## Seguretat (resum)
- Clau **secreta** només al `.env` local i als secrets de Supabase. Si es filtra: crea'n una de nova i elimina l'antiga.
- La clau pública a `config.js` és normal: la seguretat la donen les regles d'accés (RLS) i els privilegis mínims de `04_enduriment.sql`.
- Pàgines amb CSP estricta (cap script ni estil en línia), tot el text de la base de dades s'escapa, la foto es torna a codificar abans de pujar-la.
- El comerç només veu número, nom i foto d'un soci actiu; mai telèfon, email, quota ni el motiu d'un «NO ACTIU».
