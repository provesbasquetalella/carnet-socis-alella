# Carnet digital de soci · CB Alella

Fase 1 del projecte: base de dades, alta de socis i verificació del QR.
(La web amb login i targeta arriba al pas següent.)

## Què hi ha en aquest repositori

| Fitxer | Per a què serveix |
| --- | --- |
| `supabase/01_esquema.sql` | Taules, regles d'accés (RLS), fotos privades i tokens de QR |
| `supabase/02_verificacio.sql` | Funció de verificació del QR + límit d'intents |
| `supabase/functions/verificar/index.ts` | Edge Function pública que comprova el QR i retorna les dades mínimes |
| `scripts/alta_socis.py` | Crea usuaris, claus inicials úniques i fitxes de socis des d'un CSV |
| `scripts/socis_proves.csv` | 10 socis inventats per fer proves |
| `.env.example` | Plantilla de la configuració (copiar com a `.env`) |

**Mai a GitHub:** `.env`, les llistes `claus_inicials_*.csv` i la carpeta `fotos/` amb fotos reals. El `.gitignore` ja ho bloqueja.

## Pas 1 · Crear el projecte de Supabase (de PROVES)

1. A supabase.com crea un projecte nou, **regió UE** (p. ex. Frankfurt).
2. **Authentication → Sign In / Providers**:
   - Desactiva **Allow new users to sign up** (només el club crea usuaris).
   - A Email, posa la longitud mínima de contrasenya a **10**.
3. **SQL Editor**: enganxa i executa **`01_esquema.sql`**, i després **`02_verificacio.sql`**.
   Si dona error, copia'm el missatge i ho corregim (l'SQL no s'havia provat mai).

## Pas 2 · Donar d'alta els socis de prova

1. Copia la **Project URL** (botó **Connect** de dalt, o `https://<Reference ID>.supabase.co`, amb el *Reference ID* a *Project Settings → General*) i la **Secret key** (`sb_secret_...`, a *Project Settings → API Keys*; abans es deia *service_role*).
2. Copia `.env.example` com a `.env` i omple els dos valors.
3. Instal·la i executa (necessites Python 3.9+):

```bash
pip install -r requirements.txt
python scripts/alta_socis.py scripts/socis_proves.csv --dry-run   # només valida
python scripts/alta_socis.py scripts/socis_proves.csv             # alta real
```

Es crea el fitxer `claus_inicials_AAAAMMDD-HHMM.csv` amb la clau de cada soci.

- L'usuari de cada soci és `<número>@socios.invalid`. Si Supabase rebutgés aquest domini, avisa'm i en triem un altre.
- L'script es pot tornar a executar: salta els socis que ja existeixen.
- **Fotos (opcional):** posa-les a `fotos/0001.jpg`, `fotos/0002.jpg`... (JPEG o WebP, màx. 500 KB) abans d'executar l'script.
- Per fer-te **administrador**: a l'SQL Editor, `insert into public.admins(user_id) select id from auth.users where email = '0001@socios.invalid';` (canvia l'email pel de l'usuari que vulguis).

## Pas 3 · Desplegar la verificació del QR

Amb la [Supabase CLI](https://supabase.com/docs/guides/cli) instal·lada:

```bash
supabase login
supabase link --project-ref EL_TEU_PROJECT_REF
supabase secrets set CLAU_SECRETA=sb_secret_XXXX ALLOWED_ORIGIN=https://provesbasquetalella.github.io
supabase functions deploy verificar --no-verify-jwt
```

`--no-verify-jwt` és necessari perquè els comerços l'han de poder cridar sense login.
La URL serà `https://<project-ref>.supabase.co/functions/v1/verificar`.

### Provar-la sense web

Els tokens es creen quan el soci entra per primera vegada. Per provar-ho ara, genera'n un a mà a l'SQL Editor:

```sql
insert into public.qr_tokens(token, socio_id)
select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), id
from public.socios where numero_socio = '0001'
returning token;
```

I crida la funció amb el token que et surti:

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/verificar \
  -H "Content-Type: application/json" -d '{"token":"EL_TOKEN"}'
```

Resultats esperats:
- Soci actiu → `valid: true` + número, nom, cognoms i `foto_url` (caduca als 60 s).
- Token inventat → `{"valid":false}` sense cap dada.
- Després de 20 intents fallits en 10 min des de la mateixa IP → error 429.
- Posa el soci en `suspendido` (`update public.socios set estado='suspendido' where numero_socio='0001';`) → `valid:false`.

## Pujar-ho a GitHub

1. Crea un repositori nou (pot ser públic: no conté dades personals).
2. Puja **tota aquesta carpeta**. Abans, comprova que `.env` i `claus_inicials_*.csv` no apareixen a la llista de fitxers (`git status`).
3. Si algun cop puges la clau secreta (`sb_secret_...`) per error, **regenera-la** a Supabase immediatament.

## Següent pas

Web (GitHub Pages): login, canvi obligatori de clau, perfil, targeta descarregable amb QR, «regenerar QR» i pàgina de verificació per als comerços.
