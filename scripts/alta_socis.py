#!/usr/bin/env python3
"""
Script d'alta de socis · CB Alella
Llegeix un CSV (numero,nom,cognoms) i, per a cada soci:
  1. crea l'usuari a Supabase Auth (email intern <numero>@socios.invalid)
  2. li assigna una clau inicial ÚNICA i aleatòria
  3. crea la fila a la taula `socios`
  4. (opcional) puja la foto fotos/<numero>.jpg
Al final desa una llista amb les claus per repartir: claus_inicials_<data>.csv

S'executa NOMÉS a l'ordinador de l'administrador. Necessita la clau secreta
(service_role) al fitxer .env, que MAI s'ha de pujar a GitHub.

Ús:
  python scripts/alta_socis.py scripts/socis_proves.csv --dry-run   # prova sense crear res
  python scripts/alta_socis.py scripts/socis_proves.csv             # alta real
"""
import argparse
import csv
import os
import re
import secrets
import sys
from datetime import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv

# Sense caràcters ambigus (0/O, 1/l/I)
ALFABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
LONG_CLAU = 12  # mínim exigit: 10
DOMINI = "socios.invalid"
RAIZ = Path(__file__).resolve().parent.parent


def genera_clau() -> str:
    while True:
        c = "".join(secrets.choice(ALFABET) for _ in range(LONG_CLAU))
        if any(x.islower() for x in c) and any(x.isupper() for x in c) and any(x.isdigit() for x in c):
            return c


def llegeix_csv(ruta: Path):
    socis, vistos = [], set()
    with open(ruta, newline="", encoding="utf-8-sig") as f:
        for i, fila in enumerate(csv.DictReader(f), start=2):
            num = (fila.get("numero") or "").strip()
            nom = (fila.get("nom") or "").strip()
            cog = (fila.get("cognoms") or "").strip()
            if not re.fullmatch(r"[0-9]{4}", num):
                sys.exit(f"Fila {i}: el número de soci ha de tenir 4 dígits (rebut: '{num}')")
            if not nom or not cog:
                sys.exit(f"Fila {i}: falten nom o cognoms")
            if num in vistos:
                sys.exit(f"Fila {i}: número de soci repetit ({num})")
            vistos.add(num)
            socis.append({"numero": num, "nom": nom, "cognoms": cog})
    return socis


def main():
    ap = argparse.ArgumentParser(description="Alta de socis a Supabase")
    ap.add_argument("csv", type=Path, help="CSV amb columnes: numero,nom,cognoms")
    ap.add_argument("--dry-run", action="store_true", help="Només valida el CSV, no crea res")
    args = ap.parse_args()

    socis = llegeix_csv(args.csv)
    print(f"{len(socis)} socis al CSV.")
    if args.dry_run:
        for s in socis:
            print(f"  [prova] {s['numero']} · {s['nom']} {s['cognoms']} → {s['numero']}@{DOMINI}")
        print("Dry-run: no s'ha creat res.")
        return

    load_dotenv(RAIZ / ".env")
    url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    clau_servei = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not clau_servei:
        sys.exit("Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY al fitxer .env")

    H = {"apikey": clau_servei, "Authorization": f"Bearer {clau_servei}"}
    HJ = {**H, "Content-Type": "application/json"}

    resultats, errors = [], 0
    for s in socis:
        num = s["numero"]
        etiqueta = f"{num} · {s['nom']} {s['cognoms']}"

        # Ja existeix?
        r = requests.get(f"{url}/rest/v1/socios", headers=H,
                         params={"numero_socio": f"eq.{num}", "select": "id"}, timeout=30)
        if r.status_code != 200:
            print(f"  ERROR consultant {etiqueta}: {r.status_code} {r.text}")
            errors += 1
            continue
        if r.json():
            print(f"  salta  {etiqueta} (ja existeix)")
            continue

        clau = genera_clau()

        # 1) Usuari a Auth
        r = requests.post(f"{url}/auth/v1/admin/users", headers=HJ, timeout=30, json={
            "email": f"{num}@{DOMINI}",
            "password": clau,
            "email_confirm": True,
            "user_metadata": {"numero_socio": num, "must_change_password": True},
        })
        if r.status_code not in (200, 201):
            print(f"  ERROR creant usuari {etiqueta}: {r.status_code} {r.text}")
            errors += 1
            continue
        uid = r.json()["id"]

        # 2) Fila a `socios`
        r = requests.post(f"{url}/rest/v1/socios", headers={**HJ, "Prefer": "return=minimal"}, timeout=30,
                          json={"id": uid, "numero_socio": num, "nombre": s["nom"], "apellidos": s["cognoms"]})
        if r.status_code not in (200, 201, 204):
            print(f"  ERROR creant fitxa {etiqueta}: {r.status_code} {r.text} (es desfà l'usuari)")
            requests.delete(f"{url}/auth/v1/admin/users/{uid}", headers=H, timeout=30)
            errors += 1
            continue

        # 3) Foto (opcional): fotos/<numero>.jpg|.jpeg|.webp
        foto_ok = ""
        for ext, mime in ((".jpg", "image/jpeg"), (".jpeg", "image/jpeg"), (".webp", "image/webp")):
            p = RAIZ / "fotos" / f"{num}{ext}"
            if p.exists():
                dades = p.read_bytes()
                if len(dades) > 524288:
                    print(f"    avís: la foto de {num} supera 500 KB, no es puja")
                    break
                r = requests.post(f"{url}/storage/v1/object/fotos/{uid}/foto.jpg",
                                  headers={**H, "Content-Type": mime, "x-upsert": "true"},
                                  data=dades, timeout=60)
                if r.status_code in (200, 201):
                    requests.patch(f"{url}/rest/v1/socios", headers={**HJ, "Prefer": "return=minimal"},
                                   params={"id": f"eq.{uid}"}, json={"foto_path": f"{uid}/foto.jpg"}, timeout=30)
                    foto_ok = " + foto"
                else:
                    print(f"    avís: no s'ha pogut pujar la foto de {num}: {r.status_code} {r.text}")
                break

        print(f"  creat  {etiqueta}{foto_ok}")
        resultats.append({"numero": num, "nom": s["nom"], "cognoms": s["cognoms"], "clau_inicial": clau})

    if resultats:
        sortida = RAIZ / f"claus_inicials_{datetime.now():%Y%m%d-%H%M}.csv"
        with open(sortida, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=["numero", "nom", "cognoms", "clau_inicial"])
            w.writeheader()
            w.writerows(resultats)
        try:
            os.chmod(sortida, 0o600)
        except OSError:
            pass
        print(f"\nClaus inicials desades a: {sortida}")
        print("Reparteix cada clau per separat i esborra el fitxer quan acabis. NO el pugis a GitHub.")
    print(f"Fet: {len(resultats)} creats, {errors} errors.")


if __name__ == "__main__":
    main()
