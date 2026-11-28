#!/usr/bin/env python3
"""
Proves de SEGURETAT contra el teu Supabase real (només amb la clau pública, com un atacant).
Comprova que un soci NO pot: veure o tocar dades d'altres, canviar el seu estat, crear-se un registre,
pujar fotos fora de lloc, i que el públic (anon) no veu res. També prova la funció de verificació.

Ús:
  python scripts/provar_seguretat.py claus_inicials_AAAAMMDD-HHMM.csv            # cal tenir ≥ 2 socis al fitxer
  python scripts/provar_seguretat.py claus_inicials_AAAAMMDD-HHMM.csv --limit    # a més, prova el límit d'intents
                                                                                  (bloqueja la TEVA IP uns 10 minuts)
Requereix al .env: SUPABASE_URL i SUPABASE_PUBLISHABLE_KEY. Els socis han d'haver fet ja el canvi de clau?  No cal.
No es mostra cap clau ni token complet. Pot deixar una foto minúscula al soci A (es pot substituir).
"""
import csv, io, json, os, re, secrets, sys
from pathlib import Path
import requests
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parent.parent
load_dotenv(RAIZ / ".env")
URL = (os.getenv("SUPABASE_URL") or "").rstrip("/"); PUB = os.getenv("SUPABASE_PUBLISHABLE_KEY") or ""
if len(sys.argv) < 2 or not URL or not PUB.startswith("sb_publishable_"):
    sys.exit(__doc__)
with open(sys.argv[1], newline="", encoding="utf-8-sig") as f:
    socis = list(csv.DictReader(f))
if len(socis) < 2: sys.exit("Calen almenys 2 socis al fitxer de claus.")
resultats = []

def prova(nom, cond, detall=""):
    resultats.append((nom, bool(cond))); print(("  OK     " if cond else "  FALLA  ") + nom + ("" if cond else f"   ← {detall}"))
def req(m, path, jwt=None, **kw):
    h = {"apikey": PUB, **kw.pop("headers", {})}
    if jwt: h["Authorization"] = "Bearer " + jwt
    return requests.request(m, URL + path, headers=h, timeout=30, **kw)
def buit_o_denegat(r):
    if r.status_code in (401, 403, 404): return True
    try: return r.status_code == 200 and r.json() == []
    except Exception: return False
def login(s):
    r = req("POST", "/auth/v1/token?grant_type=password", json={"email": f"{s['numero']}@socios.invalid", "password": s["clau_inicial"]})
    if r.status_code != 200: sys.exit(f"No s'ha pogut entrar amb el soci {s['numero']} ({r.status_code}). Si ja ha canviat la clau, usa un altre.")
    d = r.json(); return d["access_token"], d["user"]["id"]

print("\n== Públic (sense sessió) ==")
for t in ("socios", "qr_tokens", "socios_admin", "admins", "verif_fallits"):
    prova(f"anon no veu la taula {t}", buit_o_denegat(req("GET", f"/rest/v1/{t}?select=*")), req("GET", f"/rest/v1/{t}?select=*").text[:80])
r = req("POST", "/rest/v1/rpc/verificar_token", json={"p_token": "a" * 64, "p_ip": "1.1.1.1"}); prova("anon no pot cridar verificar_token directament", r.status_code in (401, 403, 404), r.status_code)
r = req("POST", "/rest/v1/rpc/obtener_mi_token", json={}); prova("anon no pot demanar un token de QR", r.status_code in (400, 401, 403, 404) or not re.search(r"[0-9a-f]{64}", r.text), r.status_code)
r = req("POST", "/auth/v1/signup", json={"email": f"x{secrets.token_hex(3)}@socios.invalid", "password": "Alguna-Clau-9876"}); prova("el registre públic està desactivat", r.status_code >= 400, r.status_code)

A, B = socis[0], socis[1]; ta, ua = login(A); tb, ub = login(B)
print(f"\n== Soci A ({A['numero']}) intenta tocar el soci B ({B['numero']}) ==")
r = req("GET", f"/rest/v1/socios?id=eq.{ub}&select=*", ta); prova("A no veu la fitxa de B", r.status_code == 200 and r.json() == [], r.text[:80])
r = req("GET", "/rest/v1/socios?select=numero_socio", ta); prova("A només veu 1 fitxa en total", r.status_code == 200 and len(r.json()) == 1, r.text[:80])
tokB = req("POST", "/rest/v1/rpc/obtener_mi_token", tb, json={}).json()
r = req("GET", f"/rest/v1/qr_tokens?token=eq.{tokB}&select=*", ta); prova("A no pot llegir el token de B", r.status_code == 200 and r.json() == [], r.text[:60])
r = req("PATCH", f"/rest/v1/socios?id=eq.{ub}", ta, json={"telefono": "600000000"}, headers={"Prefer": "return=representation"}); prova("A no pot editar la fitxa de B", r.status_code >= 400 or r.json() == [], r.text[:80])
r = req("GET", f"/storage/v1/object/authenticated/fotos/{ub}/foto.jpg", ta); prova("A no pot llegir la foto de B", r.status_code >= 400, r.status_code)
r = req("GET", f"/storage/v1/object/public/fotos/{ub}/foto.jpg"); prova("el bucket de fotos no és públic", r.status_code >= 400, r.status_code)

print("\n== Soci A intenta saltar-se les seves regles ==")
for camp, valor in (("estado", "activo"), ("numero_socio", "9999"), ("nombre", "Hacker"), ("apellidos", "X")):
    r = req("PATCH", f"/rest/v1/socios?id=eq.{ua}", ta, json={camp: valor}); prova(f"A no pot canviar el seu «{camp}»", r.status_code >= 400, r.status_code)
r = req("PATCH", f"/rest/v1/socios?id=eq.{ua}", ta, json={"foto_path": f"{ub}/foto.jpg"}); prova("A no pot apuntar la seva foto a la carpeta de B", r.status_code >= 400, r.status_code)
r = req("PATCH", f"/rest/v1/socios?id=eq.{ua}", ta, json={"telefono": "x" * 60}); prova("el telèfon té límit de format/longitud", r.status_code >= 400, r.status_code)
r = req("POST", "/rest/v1/socios", ta, json={"id": str(__import__("uuid").uuid4()), "numero_socio": "8888", "nombre": "N", "apellidos": "N"}); prova("A no pot crear fitxes de socis", r.status_code >= 400, r.status_code)
r = req("DELETE", f"/rest/v1/socios?id=eq.{ua}", ta, headers={"Prefer": "return=representation"}); prova("A no pot esborrar la seva fitxa", r.status_code >= 400 or r.json() == [], r.text[:60])
r = req("POST", "/rest/v1/qr_tokens", ta, json={"token": secrets.token_hex(32), "socio_id": ua}); prova("A no pot inserir tokens de QR a mà", r.status_code >= 400, r.status_code)
r = req("PATCH", f"/rest/v1/qr_tokens?socio_id=eq.{ua}", ta, json={"activo": True}); prova("A no pot modificar tokens a mà", r.status_code >= 400, r.status_code)
r = req("GET", "/rest/v1/socios_admin?select=*", ta); prova("A no veu quotes ni notes del club (socios_admin)", buit_o_denegat(r), r.text[:60])
r = req("POST", "/rest/v1/socios_admin", ta, json={"socio_id": ua, "vence": "2099-01-01"}); prova("A no pot ampliar el seu pagament", r.status_code >= 400, r.status_code)
r = req("POST", "/rest/v1/admins", ta, json={"user_id": ua}); prova("A no es pot fer administrador", r.status_code >= 400, r.status_code)
r = req("POST", "/rest/v1/rpc/verificar_token", ta, json={"p_token": tokB, "p_ip": "1.1.1.1"}); prova("A no pot cridar verificar_token ni amb sessió", r.status_code in (401, 403, 404), r.status_code)

print("\n== Fotos: només <el-seu-id>/foto.jpg, JPEG/WebP i ≤ 500 KB ==")
try:
    from PIL import Image; b = io.BytesIO(); Image.new("RGB", (8, 8), (10, 80, 60)).save(b, "JPEG"); jpg = b.getvalue()
except Exception: jpg = None
H = {"x-upsert": "true"}
r = req("POST", f"/storage/v1/object/fotos/{ub}/foto.jpg", ta, data=jpg or b"x", headers={**H, "Content-Type": "image/jpeg"}); prova("A no pot pujar a la carpeta de B", r.status_code >= 400, r.status_code)
r = req("POST", f"/storage/v1/object/fotos/{ua}/altra.jpg", ta, data=jpg or b"x", headers={**H, "Content-Type": "image/jpeg"}); prova("A no pot pujar fitxers amb un altre nom", r.status_code >= 400, r.status_code)
r = req("POST", f"/storage/v1/object/fotos/{ua}/foto.jpg", ta, data=b"<script>alert(1)</script>", headers={**H, "Content-Type": "text/html"}); prova("no s'accepten fitxers que no són imatge", r.status_code >= 400, r.status_code)
r = req("POST", f"/storage/v1/object/fotos/{ua}/foto.jpg", ta, data=os.urandom(600 * 1024), headers={**H, "Content-Type": "image/jpeg"}); prova("no s'accepten fotos de més de 500 KB", r.status_code >= 400, r.status_code)
if jpg:
    r = req("POST", f"/storage/v1/object/fotos/{ua}/foto.jpg", ta, data=jpg, headers={**H, "Content-Type": "image/jpeg"}); prova("A sí pot pujar la seva foto vàlida", r.status_code in (200, 201), f"{r.status_code} {r.text[:80]}")

print("\n== Funció de verificació (pública) ==")
FN = "/functions/v1/verificar"; tokA = req("POST", "/rest/v1/rpc/obtener_mi_token", ta, json={}).json()
r = requests.post(URL + FN, json={"token": "no-es-un-token"}, timeout=30); prova("token mal format → valid:false sense dades", r.status_code == 200 and r.json() == {"valid": False}, r.text[:80])
r = requests.get(URL + FN, timeout=30); prova("GET no permès (405)", r.status_code == 405, r.status_code)
r = requests.post(URL + FN, data="x" * 5000, timeout=30); prova("cos massa gran rebutjat", r.status_code in (400, 413), r.status_code)
r = requests.post(URL + FN, json={"token": tokA}, timeout=30); d = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
if d.get("valid"):
    prova("soci actiu: només dades mínimes", set(d) <= {"valid", "numero_socio", "nombre", "apellidos", "foto_url"} and "foto_path" not in d, list(d))
    prova("la resposta no es pot guardar a la memòria cau", "no-store" in r.headers.get("cache-control", ""), r.headers.get("cache-control"))
else:
    print("  (avís) el soci A surt com NO ACTIU: comprova estat i data de pagament (03_pagament_i_temporada.sql). Es continua.")
nou = req("POST", "/rest/v1/rpc/regenerar_mi_token", ta, json={}).json()
r = requests.post(URL + FN, json={"token": tokA}, timeout=30); prova("després de regenerar, el token vell és NO ACTIU", r.json().get("valid") is False and set(r.json()) <= {"valid", "limited"}, r.text[:80])
r = requests.post(URL + FN, json={"token": tokA}, headers={"Origin": "https://evil.example"}, timeout=30)
print(f"  (info) Origin d'un altre web → {r.status_code}  (403 = ALLOWED_ORIGIN configurat correctament; 200 = encara accepta qualsevol origen)")
if "--limit" in sys.argv:
    codis = [requests.post(URL + FN, json={"token": secrets.token_hex(32)}, timeout=30).status_code for _ in range(25)]
    prova("el límit d'intents fallits respon 429", 429 in codis, codis)

mal = [n for n, ok in resultats if not ok]
print(f"\n{len(resultats) - len(mal)}/{len(resultats)} proves correctes" + ("  ✔ TOT CORRECTE" if not mal else "  ✖ REVISA: " + "; ".join(mal)))
sys.exit(1 if mal else 0)
