#!/usr/bin/env python3
"""
Prova d'accés dels socis · CB Alella
Per a cada soci del fitxer claus_inicials_*.csv comprova, com ho faria la web:
  1. el login amb número de soci + clau inicial funciona
  2. una clau incorrecta és rebutjada
  3. el soci només veu LA SEVA fitxa (RLS)
  4. el soci no pot veure les dades privades del club (socios_admin)
  5. el soci no pot canviar el seu estat
  6. es genera el token del QR (64 caràcters) i es manté igual en tornar-lo a demanar
  7. només existeix 1 token actiu per soci

Ús:
  python scripts/provar_login.py claus_inicials_AAAAMMDD-HHMM.csv

Necessita al .env: SUPABASE_URL i SUPABASE_PUBLISHABLE_KEY (la clau PÚBLICA, sb_publishable_...).
No es mostren mai claus ni tokens complets.
"""
import csv
import os
import re
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parent.parent
DOMINI = "socios.invalid"


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    load_dotenv(RAIZ / ".env")
    url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    pub = os.getenv("SUPABASE_PUBLISHABLE_KEY") or ""
    if not url or not pub.startswith("sb_publishable_"):
        sys.exit("Falta SUPABASE_URL o SUPABASE_PUBLISHABLE_KEY (ha de començar per sb_publishable_) al .env")

    with open(sys.argv[1], newline="", encoding="utf-8-sig") as f:
        socis = list(csv.DictReader(f))

    total_fallos = 0
    for s in socis:
        num, clau = s["numero"], s["clau_inicial"]
        res = []  # (nom de la prova, ok, detall)
        email = f"{num}@{DOMINI}"

        # 2) clau incorrecta
        r = requests.post(f"{url}/auth/v1/token?grant_type=password", headers={"apikey": pub},
                          json={"email": email, "password": clau + "x"}, timeout=30)
        res.append(("clau incorrecta rebutjada", r.status_code in (400, 401), r.status_code))

        # 1) login correcte
        r = requests.post(f"{url}/auth/v1/token?grant_type=password", headers={"apikey": pub},
                          json={"email": email, "password": clau}, timeout=30)
        if r.status_code != 200:
            res.append(("login amb la clau inicial", False, f"{r.status_code} {r.text[:80]}"))
            mostra(num, s, res)
            total_fallos += 1
            continue
        d = r.json()
        jwt, uid = d["access_token"], d["user"]["id"]
        meta = d["user"].get("user_metadata", {})
        res.append(("login amb la clau inicial", True, "ok"))
        res.append(("marcat per canviar la clau", meta.get("must_change_password") is True, meta.get("must_change_password")))

        H = {"apikey": pub, "Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}

        # 3) només la seva fitxa
        r = requests.get(f"{url}/rest/v1/socios?select=id,numero_socio,estado", headers=H, timeout=30)
        files = r.json() if r.status_code == 200 else []
        res.append(("només veu la seva fitxa", r.status_code == 200 and len(files) == 1
                    and files[0]["numero_socio"] == num and files[0]["id"] == uid,
                    f"{len(files)} fila(es)"))

        # 4) dades privades del club
        r = requests.get(f"{url}/rest/v1/socios_admin?select=*", headers=H, timeout=30)
        res.append(("no veu dades privades del club", r.status_code != 200 or r.json() == [], r.status_code))

        # 5) no pot canviar l'estat (es prova amb el mateix valor 'activo', sense fer cap canvi real)
        r = requests.patch(f"{url}/rest/v1/socios?id=eq.{uid}", headers={**H, "Prefer": "return=minimal"},
                           json={"estado": "activo"}, timeout=30)
        res.append(("no pot editar el seu estat", r.status_code >= 400, r.status_code))

        # 6) token del QR
        r1 = requests.post(f"{url}/rest/v1/rpc/obtener_mi_token", headers=H, json={}, timeout=30)
        t1 = r1.json() if r1.status_code == 200 else ""
        r2 = requests.post(f"{url}/rest/v1/rpc/obtener_mi_token", headers=H, json={}, timeout=30)
        t2 = r2.json() if r2.status_code == 200 else ""
        res.append(("genera token QR (64 caràcters)", isinstance(t1, str) and re.fullmatch(r"[0-9a-f]{64}", t1) is not None,
                    (t1[:6] + "…") if isinstance(t1, str) and t1 else f"{r1.status_code} {r1.text[:80]}"))
        res.append(("el token es manté en tornar-lo a demanar", bool(t1) and t1 == t2, "igual" if t1 == t2 else "diferent"))

        # 7) un únic token actiu
        r = requests.get(f"{url}/rest/v1/qr_tokens?select=token&activo=eq.true", headers=H, timeout=30)
        n = len(r.json()) if r.status_code == 200 else -1
        res.append(("1 sol token actiu", n == 1, n))

        if mostra(num, s, res):
            total_fallos += 1

    print("\n" + ("TOT CORRECTE ✔" if total_fallos == 0 else f"{total_fallos} soci(s) amb problemes ✖"))


def mostra(num, s, res):
    malament = [x for x in res if not x[1]]
    print(f"\n{num} · {s['nom']} {s['cognoms']}: {'OK' if not malament else 'FALLA'}")
    for nom, ok, det in res:
        if not ok:
            print(f"    ✖ {nom}  ({det})")
    return bool(malament)


if __name__ == "__main__":
    main()
