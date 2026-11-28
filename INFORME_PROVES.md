# Informe de proves, seguretat i robustesa · v3

Versió 4 (amb l'escut). Executat a l'entorn de desenvolupament amb un Supabase **simulat** (no hi ha connexió a la teva base de dades). Data: 27/11/2026.

## Resultat
| Bateria | Proves | Resultat |
| --- | --- | --- |
| Lògica (`tests/lib.test.mjs`) | 8 | ✔ totes |
| Funció Edge `verificar` (`tests/edge.test.mjs`) | 10 | ✔ totes |
| Auditoria estàtica: secrets, CSP, XSS, SQL, imatges (`tests/estatic.test.mjs`) | 16 | ✔ totes |
| Navegador real, Chromium (`tests/e2e_navegador.py`) | 12 | ✔ totes |
| QR de la targeta descodificat amb OpenCV (targetes amb tokens diferents) | 40 | ✔ 40/40 |

Mides provades al navegador: 320×568, 360×740, 390×844, 768×1024, 1024×768, 1280×800, 1920×1080 i 844×390 (horitzontal), en mode clar i fosc. Cap desbordament horitzontal, botons ≥ 44 px, camps de text ≥ 16 px (sense zoom a iOS).

## Què cobreixen les proves de navegador
Login i bloqueig després de 5 errors · canvi obligatori de clau amb regles · QR descodificat de la targeta · regenerar QR i revocar l'anterior · filtres d'avantatges · XSS (noms amb HTML/scripts i URL de foto maliciosa) · verificació ACTIU / NO ACTIU (sense cap dada) / QR mal format (cap petició) / 429 / 500 / sense connexió · re-comprovació automàtica en temps real (el pagament passa a vençut i el resultat canvia sol) · sessió: recàrrega, tancar sessió (també al servidor), inactivitat de 20 min, sessió caducada · foto: es redimensiona i es torna a codificar a JPEG ≤ 500 KB, rebuig de fitxers que no són imatge · mode sense connexió i errors del servidor sense que l'app es trenqui · cap petició a dominis externs i cap error de CSP.

## Problemes trobats i corregits
1. **`.gitignore` no protegia `socis_privats*.csv`** (llistes amb noms reals). Detectat per l'auditoria. Corregit.
2. **IP del client falsificable** a la funció de verificació (es llegia el primer valor de `X-Forwarded-For`, que el client pot posar), cosa que permetia esquivar el límit d'intents. Ara es fa servir `cf-connecting-ip` i, si no hi és, l'últim valor.
3. **Cap límit de mida ni d'origen** a la funció: ara rebutja cossos > 1 KB (413), orígens diferents de `ALLOWED_ORIGIN` (403) i tokens que no siguin 64 caràcters hexadecimals sense tocar la base de dades.
4. **Fotos**: la política deixava pujar qualsevol nom de fitxer a la carpeta pròpia. Ara només `<id>/foto.jpg`; JPEG/WebP ≤ 500 KB.
5. **Privilegis massa amplis per defecte** de Supabase (anon/authenticated amb permisos sobre les taules). `04_enduriment.sql` els retira i afegeix límits de format al telèfon, email i noms.
6. **Tokens**: les funcions exigeixen sessió (`auth.uid()`), es limiten les regeneracions (10/hora) i s'esborren els tokens inactius de més de 30 dies.
7. **Web**: CSP estricta (cap `unsafe-inline`), `no-referrer`, escapat de tot el text de la base de dades, protecció contra clickjacking, expiració de sessió per inactivitat, tancament de sessió al servidor, bloqueig temporal després de 5 intents, regles per a claus noves, temps màxim i reintent a les peticions, protecció contra doble clic, foto re-codificada (s'eliminen metadades i contingut amagat), QR propi sense CDN.
8. **QR**: mòduls més grans (5 px) i més fàcils d'escanejar; el detector clàssic d'OpenCV fallava en un 1-4% dels QR fins i tot perfectes, i es va comprovar amb 300 QR que el codificador és correcte (el detector Aruco no en va fallar cap).

## Què NO s'ha pogut provar aquí (cal fer-ho tu)
- **L'SQL en una base de dades Postgres real** (només s'ha auditat el text). Executa `04_enduriment.sql` al projecte de proves i després `provar_seguretat.py`.
- **La funció Edge desplegada** (sí el seu codi, amb una base simulada).
- **Navegadors i mòbils reals**: només s'ha provat Chromium. Cal mirar-ho a Safari/iPhone, Firefox i un Android.
- **Escaneig amb mòbils reals** i amb llum/brillantor reals.
- No és una auditoria de seguretat professional ni una prova d'intrusió.

## Riscos que es mantenen (assumits)
- **Captura del QR compartida:** es mitiga amb la foto obligatòria, la comprovació en directe (hora visible), el QR regenerable i el NO ACTIU immediat. No es pot evitar del tot.
- **El marcador «ha de canviar la clau»** el pot esborrar el propi soci (només afecta a la comoditat, no a la seguretat).
- **GitHub Pages no permet capçaleres HTTP** (HSTS, `frame-ancestors`): es compensa amb CSP per `<meta>` i un anti-incrustació en JavaScript.
- **Límit d'intents per IP:** un comerç amb moltes comprovacions fallides des d'una mateixa xarxa podria arribar al límit (20 / 10 min).
- **Pla gratuït de Supabase:** es pausa als 7 dies sense activitat; sense còpies de seguretat diàries.
- **Dades de proves:** els comerços i ofertes són inventats.
- **Escut:** s'ha convertit a PNG des de dues imatges JPG; el resultat és net a les mides de la web, però per imprimir-lo a gran mida caldria l'original vectorial. Les proves comproven que totes les imatges carreguen i que el QR de la targeta es descodifica amb el logo i la filigrana.
