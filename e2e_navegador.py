#!/usr/bin/env python3
"""
Proves de navegador (Chromium real) de la web, amb un Supabase SIMULAT (cap connexió externa).
Comprova: login, bloqueig, canvi de clau, QR (es descodifica del canvas), regenerar/revocar, avantatges,
XSS, verificació (ACTIU/NO ACTIU/errors), temps real, inactivitat, fotos, offline, CSP i disseny responsiu.

Ús:   pip install playwright opencv-python-headless pillow && playwright install chromium
      python tests/e2e_navegador.py
Genera captures a tests/captures/ i el resum a tests/resultats_e2e.json
"""
import io, json, re, secrets, sys, threading, traceback, uuid
from datetime import date
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ARREL = Path(__file__).resolve().parent.parent
CAPT = ARREL / "tests" / "captures"; CAPT.mkdir(exist_ok=True)
FAKE = "https://fake.supabase.co"
AVUI = date.today().isoformat()
try:
    import cv2, numpy as np
except Exception:
    cv2 = None
from PIL import Image


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ARREL)))
BASE = f"http://127.0.0.1:{srv.server_address[1]}"
threading.Thread(target=srv.serve_forever, daemon=True).start()
CONFIG_JS = f'window.CONFIG={{SUPABASE_URL:"{FAKE}",PUBLISHABLE_KEY:"sb_publishable_test",WEB_URL:"{BASE}",TEMPORADA:"2026/27",DOMINI:"socios.invalid"}};'
PNG1 = io.BytesIO(); Image.new("RGB", (4, 4), (200, 50, 50)).save(PNG1, "PNG")


class Fake:
    def __init__(s):
        s.users, s.tokens, s.sess, s.calls, s.mode = {}, {}, {}, [], {}
        s.add("0001", "Marta", "Puig Ferrer", "1234"); s.add("0002", "Jordi", "Serra Vila", "provisional1", canvi=True)
    def add(s, num, nom, cog, clau, canvi=False, estat="activo", vence="2027-06-30"):
        u = dict(id=str(uuid.uuid4()), num=num, nom=nom, cog=cog, clau=clau, canvi=canvi, estat=estat, vence=vence, foto=None, blob=None); s.users[num] = u; return u
    def tok(s, num):
        u = s.users[num]; t = next((k for k, v in s.tokens.items() if v["u"] == num and v["on"]), None)
        if not t: t = secrets.token_hex(32); s.tokens[t] = {"u": num, "on": True}
        return t
    def n(s, frag): return sum(1 for c in s.calls if frag in c[1])

    def handle(s, route):
        rq = route.request; u = urlparse(rq.url); p = u.path; m = rq.method; q = u.query
        H = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*"}
        def out(code=200, body=None, ct="application/json"):
            route.fulfill(status=code, headers=H, content_type=ct, body=body if isinstance(body, (bytes, str)) or body is None else json.dumps(body))
        if s.mode.get("offline"): return route.abort()
        if m == "OPTIONS": return route.fulfill(status=204, headers=H)
        s.calls.append((m, p + ("?" + q if q else "")))
        tk = rq.headers.get("authorization", "").replace("Bearer ", ""); me = s.users.get(s.sess.get(tk))
        if p == "/auth/v1/token":
            b = json.loads(rq.post_data); num = b.get("email", "")[:4]; us = s.users.get(num)
            if "grant_type=refresh_token" in q: return out(200, s.session(me or list(s.users.values())[0]))
            if not us or us["clau"] != b.get("password"): return out(400, {"error": "invalid_grant", "msg": "Invalid login credentials"})
            return out(200, s.session(us))
        if p == "/auth/v1/logout": s.sess.pop(tk, None); return out(204)
        if s.mode.get("rest_401") and p.startswith("/rest/"): s.mode.pop("rest_401"); return out(401, {"message": "JWT expired"})
        if p == "/auth/v1/user" and m == "PUT":
            if not me: return out(401, {"msg": "no auth"})
            b = json.loads(rq.post_data)
            if b["password"] == me["clau"]: return out(422, {"msg": "New password should be different from the old password."})
            me["clau"] = b["password"]; me["canvi"] = False; return out(200, s.user(me))
        if p.startswith("/functions/v1/verificar"):
            md = s.mode.get("verif")
            if md == "abort": return route.abort()
            if md == "429": return out(429, {"valid": False, "limited": True})
            if md == "500": return out(500, {"valid": False, "error": True})
            if md == "lent": pass
            t = json.loads(rq.post_data).get("token"); k = s.tokens.get(t); us = s.users.get(k["u"]) if k and k["on"] else None
            if us and us["estat"] == "activo" and us["vence"] >= AVUI:
                foto = s.mode.get("foto_url") or (f"{FAKE}/storage/v1/object/sign/fotos/{us['id']}/foto.jpg?token=x" if us["blob"] else None)
                return out(200, {"valid": True, "numero_socio": us["num"], "nombre": us["nom"], "apellidos": us["cog"], "foto_url": foto})
            return out(200, {"valid": False})
        if p.startswith("/storage/v1/object/sign/"): return out(200, PNG1.getvalue(), "image/png")
        if not me: return out(401, {"message": "no auth"})
        if p == "/rest/v1/socios" and m == "GET":
            ident = re.search(r"id=eq\.([0-9a-f-]+)", q).group(1)
            return out(200, [dict(numero_socio=me["num"], nombre=me["nom"], apellidos=me["cog"], foto_path=me["foto"], estado=me["estat"])] if ident == me["id"] else [])
        if p.endswith("/rpc/obtener_mi_token"):
            if s.mode.get("rpc_500"): return out(500, {"message": "boom"})
            return out(200, json.dumps(s.tok(me["num"])))
        if p.endswith("/rpc/regenerar_mi_token"):
            if s.mode.get("rpc_500"): return out(500, {"message": "boom"})
            for k, v in s.tokens.items():
                if v["u"] == me["num"]: v["on"] = False
            return out(200, json.dumps(s.tok(me["num"])))
        if p.startswith("/storage/v1/object/authenticated/"):
            return out(200, me["blob"], "image/jpeg") if me["blob"] and p.split("/fotos/")[1].startswith(me["id"]) else out(404, {"message": "not found"})
        if p.startswith("/storage/v1/object/fotos/") and m == "POST":
            path = p.split("/fotos/")[1]
            if not path.startswith(me["id"] + "/") or rq.headers.get("content-type") != "image/jpeg": return out(400, {"message": "rebutjat"})
            me["blob"] = rq.post_data_buffer; me["upload_len"] = len(me["blob"]); return out(200, {"Key": path})
        if p == "/rest/v1/socios" and m == "PATCH": me["foto"] = json.loads(rq.post_data)["foto_path"]; return out(204)
        out(404, {"message": "no implementat: " + p})
    def user(s, u): return {"id": u["id"], "email": f"{u['num']}@socios.invalid", "user_metadata": {"must_change_password": u["canvi"]}}
    def session(s, u):
        t = "tok-" + secrets.token_hex(8); s.sess[t] = u["num"]; return {"access_token": t, "refresh_token": "r-" + t, "expires_in": 3600, "user": s.user(u)}


def nova(browser, f, w=390, h=844, scheme="light", clock=False, offline=False):
    ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=scheme, accept_downloads=True)
    pg = ctx.new_page(); pg.errors, pg.externes, pg.dialogs = [], [], []
    pg.on("console", lambda m: pg.errors.append(m.text) if m.type == "error" and not m.text.startswith("Failed to load resource") else None)
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.on("response", lambda r: pg.errors.append(f"HTTP {r.status} {r.url}") if r.url.startswith(BASE) and r.status >= 400 else None)   # recursos que falten (logos, etc.)
    pg.on("dialog", lambda d: (pg.dialogs.append(d.message), d.dismiss()))
    def tot(route):
        url = route.request.url
        if url == BASE + "/config.js": return route.fulfill(body=CONFIG_JS, content_type="application/javascript")
        if url.startswith(BASE): return route.continue_()
        if url.startswith(FAKE): return f.handle(route)
        if url.startswith(("data:", "blob:")): return route.continue_()
        pg.externes.append(url); route.abort()
    ctx.route("**/*", tot)
    if clock: pg.clock.install()
    pg.ctx = ctx; return pg

def ok(c, msg="assert"):
    if not c: raise AssertionError(msg)
def entra(pg, num="0001", clau="1234", espera="#cv"):
    pg.goto(BASE + "/index.html"); pg.fill("#num", num); pg.fill("#pw", clau); pg.click("#go"); pg.wait_for_selector(espera, timeout=8000)
def token_del_qr(pg):
    if cv2 is None: return None
    data = pg.evaluate("document.getElementById('cv').toDataURL('image/png')").split(",")[1]
    import base64; img = cv2.imdecode(np.frombuffer(base64.b64decode(data), np.uint8), cv2.IMREAD_COLOR)
    dets = [cv2.QRCodeDetectorAruco()] if hasattr(cv2, "QRCodeDetectorAruco") else []
    dets.append(cv2.QRCodeDetector())   # el detector clàssic d'OpenCV falla ~1-4% fins i tot amb QR perfectes: es prova l'Aruco primer
    for det in dets:
        for k in (1, 2, 3, 4):
            val, _, _ = det.detectAndDecode(cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_NEAREST) if k > 1 else img)
            if val: return val
    return ''
def net(pg): ok(not pg.externes, f"peticions externes: {pg.externes}"); ok(not pg.errors, f"errors de consola/CSP: {pg.errors}")
def sense_desbord(pg, etiqueta):
    d = pg.evaluate("[document.documentElement.scrollWidth, window.innerWidth]"); ok(d[0] <= d[1] + 1, f"{etiqueta}: desbordament horitzontal {d}")

# ---------------------------------------------------------------- proves
def t_login_bloqueig(b, f):
    pg = nova(b, f); pg.goto(BASE + "/index.html")
    pg.fill("#num", "ab"); pg.fill("#pw", "x"); pg.click("#go"); ok("4 xifres" in pg.inner_text("#e"))
    for i in range(5):
        pg.fill("#num", "0001"); pg.fill("#pw", "mala%d" % i); pg.click("#go"); pg.wait_for_selector("#go:not([disabled])")
    ok("incorrectes" in pg.inner_text("#e")); n = f.n("grant_type=password")
    pg.fill("#pw", "1234"); pg.click("#go"); ok("Espera" in pg.inner_text("#e"), pg.inner_text("#e"))
    ok(f.n("grant_type=password") == n, "el bloqueig ha de frenar la petició"); net(pg)

def t_canvi_clau(b, f):
    pg = nova(b, f); entra(pg, "0002", "provisional1", "#n1")
    for clau, esperat in [("curta", "Mínim"), ("1234567890", "lletres"), ("abcdef0002xyz", "número de soci"), ("Password12345", "previsible"), ("provisional1", "previsible")]:
        pg.fill("#n1", clau); pg.fill("#n2", clau); pg.click("#gc"); ok(esperat in pg.inner_text("#e"), (clau, pg.inner_text("#e")))
    pg.fill("#n1", "Camp-Basquet-2027"); pg.fill("#n2", "Camp-Basquet-2028"); pg.click("#gc"); ok("no coincideixen" in pg.inner_text("#e"))
    pg.fill("#n2", "Camp-Basquet-2027"); pg.click("#gc"); pg.wait_for_selector("#cv")
    ok(f.users["0002"]["clau"] == "Camp-Basquet-2027" and not f.users["0002"]["canvi"]); net(pg)

def t_qr(b, f):
    pg = nova(b, f); entra(pg); lab = pg.get_attribute("#cv", "aria-label"); ok("2026/27" in lab and "0001" in lab, lab)
    tk = f.tok("0001"); ok(re.fullmatch(r"[0-9a-f]{64}", tk))
    ok(pg.evaluate("[...document.images].every(i => i.complete && i.naturalWidth > 0)"), "una imatge (escut) no ha carregat")
    if cv2: ok(token_del_qr(pg) == f"{BASE}/verificar.html?id={tk}", "el QR no descodifica a l'enllaç esperat")
    pg.locator("#cv").screenshot(path=str(CAPT / "targeta.png")); net(pg)

def t_regenera(b, f):
    pg = nova(b, f); entra(pg); vell = f.tok("0001")
    pg.click("[data-act=regen]"); ok("Confirma" in pg.inner_text("[data-act=regen]")); ok(f.tok("0001") == vell, "no ha de regenerar al primer clic")
    pg.click("[data-act=regen]"); pg.wait_for_selector("#toast:not([hidden])"); nou = f.tok("0001"); ok(nou != vell)
    v = nova(b, f); v.goto(f"{BASE}/verificar.html?id={vell}"); v.wait_for_selector(".res.ko"); ok("NO ACTIU" in v.inner_text("#r"))
    w = nova(b, f); w.goto(f"{BASE}/verificar.html?id={nou}"); w.wait_for_selector(".res.ok"); ok("SOCI ACTIU" in w.inner_text("#r") and "0001" in w.inner_text("#r")); net(pg)

def t_avantatges(b, f):
    pg = nova(b, f); entra(pg); pg.click("[data-tab=av]"); pg.wait_for_selector(".cupo")
    ok(pg.locator(".cupo").count() == 6 and pg.locator(".cupo.club").count() == 1); ok("−10%" in pg.inner_text(".cupo.club"))
    ok(pg.locator(".cupo.club + .cupo, .cupo").first.get_attribute("class").startswith("cupo club"))
    pg.click("[data-f=alimentacio]"); ok(pg.locator(".cupo").count() == 2, pg.locator(".cupo").count()); pg.click("[data-f=tots]"); ok(pg.locator(".cupo").count() == 6)
    ok(pg.evaluate("getComputedStyle(document.querySelector('.cupo:nth-child(2)')).getPropertyValue('--c').trim()") == "#B8412F", "color d'accent per oferta")
    pg.screenshot(path=str(CAPT / "avantatges-mobil.png"), full_page=True); net(pg)

def t_xss(b, f):
    f.add("0003", '<img src=x onerror="window.__xss=1">', '"><script>window.__xss=2</script>', "Clau-Segura-9")
    pg = nova(b, f); entra(pg, "0003", "Clau-Segura-9"); ok(pg.evaluate("window.__xss") is None); ok("<img" in pg.get_attribute("#cv", "aria-label"))
    t = f.tok("0003"); v = nova(b, f); f.mode["foto_url"] = "javascript:window.__xss=3"; v.goto(f"{BASE}/verificar.html?id={t}"); v.wait_for_selector(".res.ok")
    ok(v.evaluate("window.__xss") is None); ok("&lt;" not in v.inner_text("#r") and "<img" in v.inner_text("#r")); ok(v.locator(".res img").count() == 0, "foto no segura")
    f.mode["foto_url"] = "https://evil.example/x.png"; v.reload(); v.wait_for_selector(".res.ok"); ok(v.locator(".res img").count() == 0); ok(not v.externes, v.externes)

def t_verificar_estats(b, f):
    t = f.tok("0001"); v = nova(b, f); v.goto(f"{BASE}/verificar.html?id={t}"); v.wait_for_selector(".res.ok")
    tx = v.inner_text("#r"); ok("SOCI ACTIU" in tx and "Marta Puig Ferrer" in tx and "Comprovat en directe" in tx); v.screenshot(path=str(CAPT / "verificar-actiu.png"))
    f.users["0001"]["vence"] = "2020-01-01"; v.click("#rep"); v.wait_for_selector(".res.ko"); tx = v.inner_text("#r")
    ok("NO ACTIU" in tx and "Marta" not in tx and "0001" not in tx, "un NO ACTIU no ha de mostrar cap dada"); v.screenshot(path=str(CAPT / "verificar-no-actiu.png"))
    f.users["0001"]["vence"] = "2027-06-30"; f.users["0001"]["estat"] = "suspendido"; v.click("#rep"); v.wait_for_selector(".res.ko"); ok("NO ACTIU" in v.inner_text("#r"))
    f.users["0001"]["estat"] = "activo"
    n = f.n("/functions/v1/verificar"); m = nova(b, f); m.goto(f"{BASE}/verificar.html?id=abc"); m.wait_for_selector(".res.ko"); ok("QR NO VÀLID" in m.inner_text("#r")); ok(f.n("/functions/v1/verificar") == n, "token mal format: cap petició")
    for md, text in (("429", "Massa intents"), ("500", "No s’ha pogut comprovar"), ("abort", "Sense connexió")):
        f.mode["verif"] = md; w = nova(b, f); w.goto(f"{BASE}/verificar.html?id={t}"); w.wait_for_selector(".res.ko"); ok(text.lower() in w.inner_text("#r").lower(), (md, w.inner_text("#r")))
    f.mode.pop("verif")

def t_temps_real(b, f):
    t = f.tok("0001"); v = nova(b, f, clock=True); v.goto(f"{BASE}/verificar.html?id={t}"); v.wait_for_selector(".res.ok"); n = f.n("/functions/v1/verificar")
    f.users["0001"]["vence"] = "2020-01-01"; v.clock.fast_forward(95000)
    v.wait_for_selector(".res.ko", timeout=8000); ok(f.n("/functions/v1/verificar") == n + 1 and "NO ACTIU" in v.inner_text("#r"), "ha de tornar a comprovar sol")
    f.users["0001"]["vence"] = "2027-06-30"

def t_sessio(b, f):
    pg = nova(b, f); entra(pg); pg.reload(); pg.wait_for_selector("#cv"); ok(f.n("grant_type=password") == 1, "recarregar no demana la clau")
    pg.click("[data-act=surt] >> nth=0"); pg.wait_for_selector("#go"); ok(pg.evaluate("sessionStorage.getItem('sess')") is None); pg.wait_for_timeout(300); ok(f.n("/auth/v1/logout") == 1)
    pg2 = nova(b, f, clock=True); entra(pg2); pg2.clock.fast_forward(21 * 60 * 1000); pg2.wait_for_selector("#go", timeout=5000); ok("inactivitat" in pg2.inner_text("#e"))
    pg3 = nova(b, f); entra(pg3); f.mode["rest_401"] = True; pg3.reload(); pg3.wait_for_selector("#go", timeout=6000); ok("caducat" in pg3.inner_text("#e"), pg3.inner_text("#e"))

def t_foto(b, f):
    pg = nova(b, f); entra(pg); buf = io.BytesIO(); Image.effect_noise((1600, 1200), 80).convert("RGB").save(buf, "PNG")
    pg.set_input_files("#foto", files=[{"name": "f.png", "mimeType": "image/png", "buffer": buf.getvalue()}]); pg.wait_for_selector("#toast:not([hidden])")
    u = f.users["0001"]; ok("Foto desada" in pg.inner_text("#toast"), pg.inner_text("#toast")); ok(u["blob"][:2] == b"\xff\xd8" and u["upload_len"] <= 524288, u.get("upload_len"))
    ok(u["foto"] == u["id"] + "/foto.jpg"); pg.set_input_files("#foto", files=[{"name": "t.jpg", "mimeType": "image/jpeg", "buffer": b"no soc una imatge"}]); pg.wait_for_timeout(500); ok("No es pot llegir" in pg.inner_text("#toast"), pg.inner_text("#toast"))
    pg.set_input_files("#foto", files=[{"name": "d.pdf", "mimeType": "application/pdf", "buffer": b"%PDF"}]); pg.wait_for_timeout(300); ok("Tria una imatge" in pg.inner_text("#toast"))
    pg.reload(); pg.wait_for_selector("#cv"); ok(f.n("/storage/v1/object/authenticated/") >= 1, "ha de recuperar la foto"); net(pg)

def t_offline(b, f):
    pg = nova(b, f); entra(pg); pg.ctx.set_offline(True); pg.wait_for_selector("#offline:not([hidden])", timeout=3000)   # banner de «sense connexió»
    pg.ctx.set_offline(False); pg.wait_for_selector("#offline", state="hidden", timeout=3000); f.mode["offline"] = True
    pg.click("[data-act=regen]"); pg.click("[data-act=regen]"); pg.wait_for_selector("#toast:not([hidden])"); ok("Sense connexió" in pg.inner_text("#toast"), pg.inner_text("#toast"))
    f.mode.pop("offline")
    f.mode["rpc_500"] = True; pg.click("[data-act=regen]"); pg.click("[data-act=regen]"); pg.wait_for_function("document.getElementById('toast').textContent.includes('boom')"); ok(pg.locator("#cv").count() == 1, "l'app ha de seguir viva"); f.mode.pop("rpc_500")

def t_responsiu(b, f):
    mides = [(320, 568), (360, 740), (390, 844), (768, 1024), (1024, 768), (1280, 800), (1920, 1080), (844, 390)]
    t = f.tok("0001"); f.users["0001"]["blob"] = None
    for w, h in mides:
        pg = nova(b, f, w, h); pg.goto(BASE + "/index.html"); pg.wait_for_selector("#go"); sense_desbord(pg, f"login {w}x{h}")
        ok(pg.evaluate("[...document.querySelectorAll('input[type=text],input[type=password]')].every(i=>parseFloat(getComputedStyle(i).fontSize)>=16)"), "inputs < 16px (zoom iOS)")
        if w in (390, 1280): pg.screenshot(path=str(CAPT / f"login-{w}.png"))
        pg.fill("#num", "0001"); pg.fill("#pw", "1234"); pg.click("#go"); pg.wait_for_selector("#cv"); sense_desbord(pg, f"carnet {w}x{h}")
        cw = pg.evaluate("document.getElementById('cv').getBoundingClientRect().width"); ok(cw <= w, "canvas més ample que la pantalla")
        pq = pg.evaluate("[...document.querySelectorAll('button,label.acc,.filtres button')].filter(e=>e.offsetParent).map(e=>[e.textContent.trim().slice(0,20),e.getBoundingClientRect().height]).filter(x=>x[1]<44)"); ok(not pq, f"botons < 44px a {w}x{h}: {pq}")
        if w in (390, 1280, 768):
            pg.screenshot(path=str(CAPT / f"carnet-{w}.png"), full_page=True)
        pg.click("[data-tab=av]"); pg.wait_for_selector(".cupo"); sense_desbord(pg, f"avantatges {w}x{h}")
        pq = pg.evaluate("[...document.querySelectorAll('button')].filter(e=>e.offsetParent).filter(e=>e.getBoundingClientRect().height<40).length"); ok(pq == 0)
        if w in (390, 1280): pg.screenshot(path=str(CAPT / f"avantatges-{w}.png"), full_page=True)
        v = nova(b, f, w, h); v.goto(f"{BASE}/verificar.html?id={t}"); v.wait_for_selector(".res.ok"); sense_desbord(v, f"verificar {w}x{h}")
        if w in (390, 1280, 844): v.screenshot(path=str(CAPT / f"verificar-{w}x{h}.png"))
        for p in (pg, v): net(p)
    d = nova(b, f, 1280, 800); entra(d); bb = d.evaluate("[document.getElementById('cv').getBoundingClientRect().right, document.querySelector('aside').getBoundingClientRect().left]"); ok(bb[1] >= bb[0] - 1, "a l'escriptori targeta i accions van en dues columnes")
    m = nova(b, f, 390, 844); entra(m); ok(m.evaluate("getComputedStyle(document.getElementById('nav')).position") == "fixed", "barra de navegació inferior al mòbil")
    ds = nova(b, f, 390, 844, scheme="dark"); ds.goto(BASE + "/index.html"); ds.wait_for_selector("#go"); ok(ds.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(7, 19, 14)"); ds.screenshot(path=str(CAPT / "login-fosc-390.png"))

PROVES = [t_login_bloqueig, t_canvi_clau, t_qr, t_regenera, t_avantatges, t_xss, t_verificar_estats, t_temps_real, t_sessio, t_foto, t_offline, t_responsiu]
if __name__ == "__main__":
    res = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        for t in PROVES:
            f = Fake()
            try: t(b, f); res.append((t.__name__, "OK", "")); print("OK     ", t.__name__)
            except Exception as e:
                res.append((t.__name__, "FALLA", f"{type(e).__name__}: {e}")); print("FALLA  ", t.__name__, "→", str(e)[:300]); traceback.print_exc(limit=2)
        b.close()
    (ARREL / "tests" / "resultats_e2e.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    print(f"\n{sum(r[1]=='OK' for r in res)}/{len(res)} proves correctes" + ("" if cv2 else "  (sense opencv: no s'ha descodificat el QR)"))
    sys.exit(0 if all(r[1] == "OK" for r in res) else 1)
