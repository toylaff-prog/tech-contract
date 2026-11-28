#!/usr/bin/env python3
"""20261127m-lts 前端 Chromium 實測（16 項核心情境）

    python3 tests/lts_smoke_and_core.py

- 網頁由本機 HTTP 伺服器提供；不連線任何正式 Google 服務。
- 測試時一律替換 config.js（本機模式 API 為空字串），不會連到正式 Apps Script。
- 「雲端模式」的情境，會啟動 node tests/lts_backend_test.js --serve 提供的模擬後端
  （在 Node VM 裡實際執行「後端_Code.gs」，試算表／日曆都是記憶體假物件），
  並只在測試時把 config.js 的 API 換成模擬後端網址；交付的 config.js 仍是 API: ""。
"""
import functools
import http.server
import io
import json
import os
import pathlib
import re
import socket
import statistics
import subprocess
import sys
import threading
import time
import urllib.request
import zipfile
from xml.dom import minidom

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEST_CODE = "lts-test-code-2026"
RESULTS = []
CONSOLE_ERRORS = []


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def start_static():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}/index.html"


def start_backend():
    port = free_port()
    proc = subprocess.Popen(["node", str(ROOT / "tests" / "lts_backend_test.js"), "--serve", str(port)],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    line = proc.stdout.readline()
    assert "ready" in line, line
    return proc, f"http://127.0.0.1:{port}"


def http_json(url, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "text/plain;charset=utf-8"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


def record(no, name, fn):
    t0 = time.time()
    try:
        detail = fn() or ""
        RESULTS.append((no, "PASS", name, detail, time.time() - t0))
    except Exception as e:  # noqa: BLE001
        RESULTS.append((no, "FAIL", name, f"{type(e).__name__}: {e}", time.time() - t0))


def ensure(cond, msg):
    if not cond:
        raise AssertionError(msg)


# ---------------- 測試資料 ----------------
def proj(**kw):
    base = {"name": "", "title": "", "vendor": "", "type": "建築工程", "plan": "否", "design": "是", "super": "是", "method": "",
            "fee": "", "feeFixed": "否", "rate": "", "range": "", "shape": "單一工程", "cost": "", "bclass": "第一類", "days": "",
            "permit": "否", "tender": "是", "tenderCap": "", "adv": {}, "vendorLine": "", "entryStage": "proj", "techScope": "",
            "tech": {}, "build": {"ext": [], "stops": []}, "v": 2}
    base.update(kw)
    return base


def many_projects(n):
    out = {}
    for i in range(n):
        k = i % 5
        p = proj(name=f"測試工程{i:03d}", title=f"115 年度測試工程 {i:03d} 委託設計監造案")
        if k >= 1:
            p["build"] = {"name": "△△營造", "amount": "5000000", "budget": "5000000", "start": "2026-08-01", "days": "120",
                          "unit": "日曆天", "ext": [], "stops": []}
            p["entryStage"] = "build"
        if k >= 2:
            p["chk"] = {"dates": {"report": "2026-11-20", "verify": "2026-11-23"}}
        if k >= 3:
            p["chk"]["dates"].update({"actual": "2026-11-22", "docs": "2026-11-25", "accept": "2026-11-26"})
        if k == 4:
            p["chk"]["dates"].update({"cert": "2026-11-27", "paid": "2026-11-27", "years": "2"})
        out[f"p{i:03d}"] = p
    return out


class Browser:
    def __init__(self, pw, url, api=None):
        self.pw = pw
        self.url = url
        self.api = api
        self.b = pw.chromium.launch()

    def page(self, width=1280, height=900, cloud=False, ctx=None):
        ctx = ctx or self.b.new_context(viewport={"width": width, "height": height}, accept_downloads=True)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: CONSOLE_ERRORS.append(f"pageerror: {e}"))
        pg.on("console", lambda m: CONSOLE_ERRORS.append(f"console.error: {m.text}") if m.type == "error" else None)
        fonts = re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*")
        pg.route(fonts, lambda r: r.fulfill(status=200, body="", content_type="text/css"))
        # 測試一律換掉 config.js：本機模式 API 為空字串、雲端模式指向模擬後端，絕不連到正式 Apps Script
        body = f'window.TSC_CONFIG = {{ API: "{self.api}/exec" }};' if cloud else 'window.TSC_CONFIG = { API: "" };'
        pg.route(re.compile(r".*/config\.js.*"), lambda r: r.fulfill(status=200, body=body, content_type="application/javascript"))
        return pg

    def local(self, projects=None, school=None, extra=None, **kw):
        pg = self.page(**kw)
        pg.goto(self.url)
        pg.evaluate("""([d, x]) => { localStorage.clear(); if (d) localStorage.setItem('tsc-local', JSON.stringify(d));
            for (const k in x) localStorage.setItem('tsc-' + k, JSON.stringify(x[k])); }""",
                    [{"projects": projects or {}, "school": school or {}} if projects is not None else None, extra or {}])
        pg.reload()
        pg.wait_for_selector("#dashBody .home, #dashBody .gate", timeout=15000)
        pg.wait_for_timeout(300)
        return pg


def open_project(pg, pid, sub):
    pg.evaluate("([id, sub]) => { localStorage.setItem('tsc-cur', JSON.stringify(id)); }", [pid, sub])
    pg.click(f'#plist button[data-id="{pid}"]')
    pg.click(f'#subNav button[data-v="{sub}"]')
    pg.wait_for_timeout(150)


def download(pg, click_selector):
    with pg.expect_download(timeout=30000) as dl:
        pg.click(click_selector)
    path = dl.value.path()
    return dl.value.suggested_filename, pathlib.Path(path).read_bytes()


def docx_check(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    bad = z.testzip()
    ensure(bad is None, f"ZIP CRC 錯誤：{bad}")
    texts = {}
    for n in z.namelist():
        if n.endswith(".xml") or n.endswith(".rels"):
            raw = z.read(n).decode("utf-8")
            minidom.parseString(raw.encode("utf-8"))  # XML 可解析
            texts[n] = raw
    doc = texts["word/document.xml"]
    ensure("⟦" not in doc and "⟧" not in doc, "document.xml 殘留 ⟦Fxxx⟧ 記號")
    plain = re.sub(r"<[^>]+>", "", doc)
    return plain


# ---------------- 16 項情境 ----------------
def t01_home_perf(B):
    pg = B.local(many_projects(100))
    times = []
    for _ in range(5):
        ms = pg.evaluate("""() => { document.querySelector('#mainNav button[data-v="school"]').click();
            const t0 = performance.now(); document.querySelector('#mainNav button[data-v="dash"]').click();
            void document.body.offsetHeight; return performance.now() - t0; }""")
        times.append(ms)
    med = statistics.median(times)
    ensure(med < 100, f"100 件工程首頁渲染中位數 {med:.1f}ms ≥ 100ms")
    ensure(pg.locator(".slogan").inner_text() == "校園的美好，由我們一起打造。", "固定標語 1")
    ensure(pg.locator(".slogan2").inner_text() == "讓繁瑣的行政交給系統，讓用心的你留一點時間給自己。", "固定標語 2")
    rows = pg.locator(".ovcard tbody tr").count()
    ensure(rows == 100, f"進度總覽應有 100 列，實際 {rows}")
    closed = pg.evaluate("document.querySelectorAll('#deskBox *').length")
    ensure(closed == 0, f"表件追蹤收合時不應產生內容，實際 {closed} 個節點")
    nodes = pg.evaluate("document.getElementsByTagName('*').length")
    pg.click("#deskLazy > summary")
    pg.wait_for_timeout(200)
    opened = pg.evaluate("document.querySelectorAll('#deskBox *').length")
    ensure(opened > 0, "展開後應產生表件追蹤內容")
    pg.click("#deskLazy > summary")
    pg.wait_for_timeout(100)
    ensure(pg.evaluate("document.querySelectorAll('#deskBox *').length") == 0, "收合後應清空")
    # 每日語錄可開關
    pg.click("button[data-quote='off']")
    ensure(pg.locator("button[data-quote='on']").count() == 1, "語錄可關閉")
    pg.click("button[data-quote='on']")
    pg.context.close()
    widths = []
    for w in (320, 390):
        pm = B.local(many_projects(12), width=w, height=800)
        for view in ("dash", "work"):
            pm.click(f'#mainNav button[data-v="{view}"]')
            pm.wait_for_timeout(150)
            if view == "work":
                for sub in ("proj", "build", "chk"):
                    pm.click(f'#subNav button[data-v="{sub}"]')
                    pm.wait_for_timeout(120)
                    sw, cw = pm.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
                    ensure(sw <= cw + 1, f"{w}px {sub} 水平破版：{sw} > {cw}")
            sw, cw = pm.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
            ensure(sw <= cw + 1, f"{w}px {view} 水平破版：{sw} > {cw}")
        widths.append(w)
        pm.context.close()
    return f"渲染中位數 {med:.1f}ms（{', '.join(f'{t:.0f}' for t in times)}）；首頁節點 {nodes}；收合 0、展開 {opened}；320/390px 無水平捲動"


def t02_mid_entry(B):
    pg = B.local({})
    out = []
    for entry, want in (("build", "填施工廠商全銜"), ("chk", "機關收受竣工報告日"), ("warranty", "登錄驗收合格日")):
        pg.click('#mainNav button[data-v="dash"]')
        pg.click("#newp")
        pg.fill("#newName", "中途建檔-" + entry)
        pg.check(f"#newBody input[name=entry][value={entry}]")
        pg.click("#newGo")
        pg.wait_for_timeout(200)
        card = pg.locator(".nextcard").inner_text()
        ensure(want in card, f"{entry}：下一步應為「{want}」，實際「{card}」")
        for bad in ("案名", "計價方式", "招標版", "委託階段", "簽約日"):
            ensure(bad not in card, f"{entry}：不應要求回頭填技術服務契約（{bad}）")
        steps = pg.locator("#workHead .steps").inner_text()
        ensure("中途建檔，不需補填" in steps, f"{entry}：技術服務步驟應標示不需補填")
        out.append(f"{entry}→{want}")
    # 無委託技術服務
    pg.click("#newp")
    pg.fill("#newName", "無委託")
    pg.check("#newBody input[name=scope][value=none]")
    pg.click("#newGo")
    pg.wait_for_timeout(200)
    ensure("無委託技術服務" in pg.locator("#workHead .steps").inner_text(), "無委託應顯示")
    pg.context.close()
    return "；".join(out) + "；無委託技術服務 OK"


def t03_word(B):
    vendor, fee = "得標建築師事務所甲", "1234567"
    p1 = proj(name="屋頂防水", title="115 年度活動中心屋頂防水委託設計監造案", vendor=vendor, method="總包價法", fee=fee, days="30")
    p2 = proj(name="成本加公費", title="115 年度成本加公費測試案", vendor="乙方顧問", method="服務成本加公費法", fee="888888",
              tenderCap="2,000,000", days="30")
    pg = B.local({"pA": p1, "pB": p2})
    res = []
    for pid, checks in (("pA", None), ("pB", None)):
        open_project(pg, pid, "proj")
        for stage in ("tender", "sign"):
            pg.click(f'#projBody button[data-stage="{stage}"]')
            pg.click("#dl")
            pg.wait_for_selector("#dlDlg[open]")
            ensure(not pg.locator("#dlGo").is_disabled(), f"{pid} {stage} 不應被擋")
            name, data = download(pg, "#dlGo")
            plain = docx_check(data)
            if pid == "pA" and stage == "tender":
                ensure(vendor not in plain, "招標版洩漏乙方")
                ensure("1,234,567" not in plain, "招標版洩漏決標金額")
            if pid == "pA" and stage == "sign":
                ensure(vendor in plain and "1,234,567" in plain, "簽約版應有乙方與金額")
            if pid == "pB" and stage == "tender":
                ensure("888,888" not in plain, "成本加公費法招標版不應帶入決標金額")
                ensure("2,000,000" in plain, "應填入招標前核定上限")
                ensure("乙方顧問" not in plain, "招標版洩漏乙方")
            res.append(f"{name}（{len(data)//1024}KB）")
    pg.context.close()
    return "ZIP CRC／XML 解析／無殘留記號通過：" + "、".join(res)


def t04_conflict_and_pay(B):
    bad1 = proj(name="雇主險衝突", title="互斥測試案一", vendor="V", method="總包價法", fee="100000", days="30", adv={"F086": "V"})
    bad2 = proj(name="開口契約衝突", title="互斥測試案二", vendor="V", method="建造費用百分比法", rate="5", range="10000000",
                shape="單一工程", days="30", adv={"F371": "V"})
    pay = proj(name="付款", title="付款測試", build={"name": "營造", "amount": "5000000", "budget": "5000000", "ext": [], "stops": []},
               chk={"dates": {"accept": "2026-10-01", "cert": "2026-10-10"}})
    pg = B.local({"pX": bad1, "pY": bad2, "pZ": pay})
    msgs = []
    for pid, want in (("pX", "雇主意外責任險"), ("pY", "附件2")):
        open_project(pg, pid, "proj")
        pg.click("#dl")
        pg.wait_for_selector("#dlDlg[open]")
        body = pg.locator("#dlBody").inner_text()
        ensure("互斥勾選" in body and want in body, f"{pid} 應顯示互斥：{body[:200]}")
        ensure(pg.locator("#dlGo").is_disabled(), f"{pid} 互斥時應擋下載")
        pg.click("#dlDlg .dlgf button[data-close]")
        msgs.append(want)
    open_project(pg, "pZ", "gov")
    pg.click('#govBody button[data-gd="payment"]')
    cases = [("", "0", True), ("-5", "0", True), ("1e4", "0", True), ("100.5", "0", True), ("１２３", "0", True),
             ("500000", "600000", True), ("500000", "500000", True), ("5,000,000", "4,000,000", False)]
    for final, paid, blocked in cases:
        pg.fill("#gv-final", final)
        pg.fill("#gv-paid", paid)
        pg.wait_for_timeout(60)
        is_blocked = pg.locator("#govBlock .banner").count() > 0
        dis = pg.locator('#govBody button[data-gword]').is_disabled()
        want = "擋" if blocked else "可"
        ensure(is_blocked == blocked and dis == blocked, f"付款 {final}/{paid} 應{want}（banner={is_blocked}, disabled={dis}）")
    ensure("新臺幣1,000,000元" in pg.locator("#govText").inner_text(), "尾款應為 1,000,000")
    name, data = download(pg, '#govBody button[data-gword]')
    docx_check(data)
    pg.context.close()
    return f"互斥（{'、'.join(msgs)}）擋下載；付款簽呈 7 種錯誤金額皆擋、正確金額可產出 {name}"


def t05_dates(B):
    p = proj(name="日期", title="日期測試", entryStage="chk", chk={"dates": {"accept": "2026-02-30", "years": "2"}},
             build={"start": "2027-06-01", "days": "400", "unit": "日曆天", "ext": [], "stops": []})
    pg = B.local({"pD": p})
    open_project(pg, "pD", "chk")
    txt = pg.locator("#chkBody .kd").inner_text()
    ensure("日期無效，未計算" in txt, "2026-02-30 應標示無效")
    ensure("保固期滿日：" not in txt, "無效日期不應算出保固期滿日")
    ok_end = pg.evaluate("Checklist.warrantyEnd({accept:'2026-02-30', years:'2'})")
    ensure(ok_end == "", "warrantyEnd 對無效日期應回空字串")
    pg.fill("#cd-accept", "2026-01-31")
    pg.dispatch_event("#cd-accept", "change")
    pg.fill("#cd-years", "0.3")
    pg.dispatch_event("#cd-years", "change")
    pg.wait_for_timeout(100)
    ensure("無法換算為整月" in pg.locator("#chkBody .kd").inner_text(), "0.3 年應提示核對")
    ensure("保固期滿日：" not in pg.locator("#chkBody .kd").inner_text(), "0.3 年不應亂進位算出期滿日")
    pg.fill("#cd-years", "0.5")
    pg.dispatch_event("#cd-years", "change")
    pg.wait_for_timeout(100)
    ensure("保固期滿日：115.07.31" in pg.locator("#chkBody .kd").inner_text(), "0.5 年應算出 115.07.31")
    pg.click('#subNav button[data-v="build"]')
    how = pg.locator("#buildBody .calc").last.inner_text()
    ensure("假日資料未涵蓋 2028 年，日期為試算" in how, f"跨入未維護年度應提醒：{how}")
    pg.context.close()
    return "無效日期不計算；0.3 年提示核對、0.5 年＝115.07.31；跨 2028 年標示試算"


def t06_stops(B):
    b0 = {"name": "營造", "amount": "1", "budget": "1", "start": "2026-01-05", "days": "100", "unit": "日曆天", "ext": []}
    p1 = proj(name="核定淨增", entryStage="build", build=dict(b0, stops=[{"s": "", "e": "", "doc": "", "mode": "", "days": ""},
                                                                        {"s": "2026-02-01", "e": "2026-02-11", "doc": "府教字1號",
                                                                         "mode": "淨增", "days": "10"}]))
    p2 = proj(name="停工中", entryStage="build", build=dict(b0, stops=[{"s": "2026-03-01", "e": "", "doc": "", "mode": "", "days": ""}]))
    p3 = proj(name="逾期後才停工", entryStage="build", build=dict(b0, stops=[{"s": "2026-05-01", "e": "", "doc": "", "mode": "", "days": ""}]))
    pg = B.local({"s1": p1, "s2": p2, "s3": p3})
    base = pg.evaluate("Lifecycle.evaluate({build:%s}, ContractEngine.defaultSchool()).plan.date" % json.dumps(dict(b0, stops=[])))
    d1 = pg.evaluate("Lifecycle.evaluate(%s, ContractEngine.defaultSchool()).plan.date" % json.dumps(p1))
    diff = pg.evaluate(f"Checklist.daysBetween('{base}', '{d1}')")
    ensure(diff == 10, f"核定淨增 10 天應順延 10 天（{base} → {d1}，差 {diff}）")
    open_project(pg, "s1", "build")
    ensure("＋停工核定淨增 10" in pg.locator("#buildBody .calc").last.inner_text(), "預定竣工日說明應含淨增天數")
    open_project(pg, "s2", "build")
    head = pg.locator("#workHead").inner_text()
    ensure("停工中（原期限待核對）" in head, "停工未復工應標示待核對")
    pg.click('#mainNav button[data-v="dash"]')
    row2 = pg.locator('.ovcard tr[data-open="s2"]').inner_text()
    row3 = pg.locator('.ovcard tr[data-open="s3"]').inner_text()
    ov2 = pg.locator('.ovcard tr[data-open="s2"] td[data-l="逾期"]').inner_text().strip()
    ov3 = pg.locator('.ovcard tr[data-open="s3"] td[data-l="逾期"]').inner_text().strip()
    ensure(ov2 == "0" and "停工中（原期限待核對）" in row2, f"停工中不列入正式逾期（{ov2}）")
    ensure(ov3 != "0" and "逾期" in row3, f"原期限過後才停工，逾期不應被抹除（{ov3}）")
    pg.context.close()
    return f"空白列忽略；淨增 10 天 {base}→{d1}；停工中逾期 0；期限過後才停工仍逾期 {ov3} 項"


def t07_close(B):
    p = proj(name="五百萬工程", title="500 萬免初驗測試", entryStage="build",
             build={"name": "△△營造", "amount": "5000000", "budget": "5000000", "start": "2026-01-05", "days": "60",
                    "unit": "日曆天", "ext": [], "stops": []})
    pg = B.local({"pC": p})
    open_project(pg, "pC", "chk")
    seq = [("report", "2026-03-05"), ("verify", "2026-03-06"), ("actual", "2026-03-05"), ("docs", "2026-03-15"),
           ("accept", "2026-03-30"), ("cert", "2026-04-08"), ("paid", "2026-04-20"), ("years", "2"),
           ("wcheck", "2028-03-20"), ("refund", "2028-04-01")]
    for k, v in seq:
        pg.fill(f"#cd-{k}", v)
        pg.dispatch_event(f"#cd-{k}", "change")
        pg.wait_for_timeout(60)
    pct = pg.locator("#chkBody > div b").first.inner_text()
    card = pg.locator(".nextcard").inner_text()
    ensure(pct == "100%", f"完成率應為 100%，實際 {pct}")
    ensure("本案已結案" in card, f"下一步應為結案：{card}")
    ensure("結案" in pg.locator("#workHead .phase").inner_text(), "階段應為結案")
    pg.context.close()
    return "依序填 10 個關鍵日期 → 100%、本案已結案（未填初驗不卡結案）"


def t08_drafts(B, api):
    # 本機模式
    p = proj(name="草稿測試", entryStage="build", build={"name": "營造", "amount": "100", "budget": "100", "ext": [], "stops": []})
    pg = B.local({"pDraft": p})
    open_project(pg, "pDraft", "build")
    pg.fill("#bf-budget", "7654321")
    pg.dispatch_event("#bf-budget", "change")
    pg.wait_for_timeout(400)
    pg.reload()
    pg.wait_for_selector("#banners button[data-b=restore]", timeout=10000)
    pg.click("#banners button[data-b=restore]")
    ensure(pg.locator("#plist li button").count() == 1, "本機模式還原後不應多出副本")
    open_project(pg, "pDraft", "build")
    ensure(pg.input_value("#bf-budget") == "7654321", "本機模式應還原修改的金額")
    pg.click("#saveBtn")
    pg.wait_for_timeout(200)
    keys = pg.evaluate("Object.keys(JSON.parse(localStorage.getItem('tsc-local')).projects)")
    ensure(keys == ["pDraft"], f"暫存後仍是同一件工程 ID：{keys}")
    pg.context.close()
    # 雲端快取模式
    http_json(api + "/__reset")
    pc = B.page(cloud=True)
    pc.goto(B.url)
    pc.wait_for_selector("#codeIn")
    pc.fill("#codeIn", TEST_CODE)
    pc.click("#gate button[type=submit]")
    pc.wait_for_selector("#dashBody .home", timeout=15000)
    pc.click("#newp")
    pc.fill("#newName", "雲端草稿")
    pc.check("#newBody input[name=entry][value=build]")
    pc.click("#newGo")
    pc.click("#saveBtn")
    pc.wait_for_function("document.querySelector('#sync').textContent.includes('共用試算表已儲存')", timeout=10000)
    dbg = http_json(api + "/__debug")
    ensure(len(dbg["projects"]) == 1, "雲端應有 1 件工程")
    pid = dbg["projects"][0]["id"]
    pc.fill("#bf-budget", "3333333")
    pc.dispatch_event("#bf-budget", "change")
    pc.wait_for_timeout(400)
    pc.reload()
    pc.wait_for_selector("#banners button[data-b=restore]", timeout=15000)
    calls = [c["action"] for c in http_json(api + "/__debug")["calls"]]
    ensure("ping" in calls, "重開時應先 ping 驗證存取碼")
    pc.click("#banners button[data-b=restore]")
    pc.click("#saveBtn")
    pc.wait_for_function("document.querySelector('#sync').textContent.includes('共用試算表已儲存')", timeout=10000)
    dbg = http_json(api + "/__debug")
    ensure(len(dbg["projects"]) == 1 and dbg["projects"][0]["id"] == pid, "還原後暫存應回到同一件工程，不產生副本")
    ensure(dbg["projects"][0]["data"]["build"]["budget"] == "3333333", "雲端應存入還原的金額")
    pc.context.close()
    return f"本機模式與雲端快取模式皆還原回原工程 ID（{pid}），沒有多餘副本"


def login(B, ctx=None):
    pg = B.page(cloud=True, ctx=ctx)
    pg.goto(B.url)
    pg.wait_for_selector("#codeIn, #dashBody .home", timeout=15000)
    if pg.locator("#codeIn").count():
        pg.fill("#codeIn", TEST_CODE)
        pg.click("#gate button[type=submit]")
    pg.wait_for_selector("#dashBody .home", timeout=15000)
    pg.wait_for_timeout(300)
    return pg


def wait_saved(pg):
    pg.wait_for_function("document.querySelector('#sync').textContent.includes('共用試算表已儲存')", timeout=10000)


def t09_conflict(B, api):
    http_json(api + "/__reset")
    a = login(B)
    a.click("#newp")
    a.fill("#newName", "衝突測試")
    a.check("#newBody input[name=entry][value=build]")
    a.click("#newGo")
    a.click("#saveBtn")
    wait_saved(a)
    pid = http_json(api + "/__debug")["projects"][0]["id"]
    b = login(B)
    open_project(b, pid, "build")
    b.fill("#bf-name", "同仁改的營造廠")
    b.dispatch_event("#bf-name", "change")
    b.click("#saveBtn")
    wait_saved(b)
    # A 沒有重新載入就修改並暫存 → 衝突
    a.fill("#bf-budget", "1111111")
    a.dispatch_event("#bf-budget", "change")
    a.click("#saveBtn")
    a.wait_for_selector("#banners button[data-b=theirs]", timeout=10000)
    with a.expect_download() as dl:
        a.click("#banners button[data-b=theirs]")
    backup = json.loads(pathlib.Path(dl.value.path()).read_text(encoding="utf-8"))
    ensure(backup["data"]["build"]["budget"] == "1111111", "下載的備份應含我的修改")
    kept = a.evaluate("JSON.parse(localStorage.getItem('tsc-conflict-backup'))")
    ensure(len(kept) == 1 and kept[0]["data"]["build"]["budget"] == "1111111", "tsc-conflict-backup 應保存我的修改")
    a.click('#subNav button[data-v="build"]')
    ensure(a.input_value("#bf-name") == "同仁改的營造廠", "改用同仁版本後畫面應是同仁的資料")
    # 第二輪：以我的版本覆蓋儲存
    b.fill("#bf-line", "同仁第二次修改")
    b.dispatch_event("#bf-line", "change")
    b.click("#saveBtn")
    wait_saved(b)
    a.fill("#bf-budget", "2222222")
    a.dispatch_event("#bf-budget", "change")
    a.click("#saveBtn")
    a.wait_for_selector("#banners button[data-b=mine]", timeout=10000)
    a.click("#banners button[data-b=mine]")
    wait_saved(a)
    data = http_json(api + "/__debug")["projects"][0]["data"]
    ensure(data["build"]["budget"] == "2222222", "以我的版本覆蓋後雲端應是我的金額")
    a.context.close()
    b.context.close()
    return f"「{backup['name']}」改用同仁版本前已備份（下載 {dl.value.suggested_filename}＋tsc-conflict-backup）；以我的版本覆蓋儲存成功"


def t10_notes(B):
    p = proj(name="記事工程", title="記事測試案", entryStage="chk", chk={"dates": {"report": "2026-11-01"}})
    pg = B.local({"pN": p})
    text = "屋頂防水廠商說週四補送竣工圖\n（王經理來電）"
    pg.fill("#qnText", text)
    pg.select_option("#qnPid", "pN")
    pg.click("button[data-qnadd]")
    ensure(pg.locator(".qlist .qtext").first.inner_text() == text, "記事應新增並保留換行")
    with pg.expect_download() as dl:
        pg.click("button[data-qnexp]")
    exported = json.loads(pathlib.Path(dl.value.path()).read_text(encoding="utf-8"))
    ensure(exported[0]["text"] == text, "匯出的 JSON 應含原文")
    pg.click("button[data-qnuse]")
    pg.wait_for_selector(".qnpick select")
    pg.click("button[data-qngo]")
    pg.wait_for_selector("#flowDlg[open]")
    ensure(text in pg.input_value("#flowNote"), "表件備註應帶入記事")
    pg.click("#flowSave")
    pg.wait_for_timeout(300)
    pg.click('#mainNav button[data-v="dash"]')
    ensure(pg.locator(".qlist .qtext").first.inner_text() == text, "帶入後記事原文仍保留")
    ensure("已帶入" in pg.locator(".qlist li").first.inner_text(), "記事應標示已帶入")
    stored = pg.evaluate("JSON.parse(localStorage.getItem('tsc-uiQuickNotes'))")
    ensure(stored[0]["text"] == text, "localStorage tsc-uiQuickNotes 保留原文")
    pg.context.close()
    return f"新增、匯出 {dl.value.suggested_filename}、帶入表件備註並保留原文"


def t11_access(B, api):
    http_json(api + "/__reset")
    seen = []
    pg = B.page(cloud=True)
    pg.on("request", lambda r: seen.append((r.method, r.url)) if r.url.startswith(api) else None)
    pg.goto(B.url)
    pg.wait_for_selector("#codeIn")
    pg.fill("#codeIn", "wrong-code-xyz")
    pg.click("#gate button[type=submit]")
    # 等後端回覆後重畫的輸入框（避免讀到送出前的舊畫面）
    pg.wait_for_function("(document.querySelector('#gate') || {}).textContent?.includes('存取碼錯誤')", timeout=10000)
    ensure(pg.locator("#codeIn").count() == 1, "錯誤存取碼應被拒")
    pg.fill("#codeIn", TEST_CODE)
    pg.click("#gate button[type=submit]")
    pg.wait_for_selector("#dashBody .home", timeout=15000)
    ensure(seen and all(m == "POST" for m, _ in seen), f"所有後端請求都應為 POST：{set(m for m, _ in seen)}")
    ensure(not any("code" in u.lower().split("?", 1)[-1] for _, u in seen if "?" in u), "網址不得帶存取碼")
    with urllib.request.urlopen(api + "/exec?code=" + TEST_CODE + "&action=load", timeout=10) as r:
        g = json.loads(r.read().decode())
    ensure(g["ok"] is False and "POST" in g["error"], "doGet 應拒絕")
    # 安全登出：清除本機所有 tsc- 資料
    pg.click("#sideMore > summary") if not pg.locator("#logout").is_visible() else None
    pg.once("dialog", lambda d: d.accept())
    pg.click("#logout")
    pg.wait_for_selector("#codeIn", timeout=15000)
    keys = ["tsc-code", "tsc-cache", "tsc-drafts", "tsc-uiQuickNotes", "tsc-conflict-backup", "tsc-schoolDraft"]
    left = pg.evaluate("ks => ks.filter(k => localStorage.getItem(k) !== null)", keys)
    ensure(left == [], f"登出後應清除本機資料：{left}")
    pg.context.close()
    return f"{len(seen)} 次後端請求全為 POST、網址不含存取碼；doGet 拒絕；錯誤碼被拒；安全登出清除本機資料（safeText_ 見後端測試 11e）"


def t12_upload(api):
    http_json(api + "/__reset")
    post = lambda b: http_json(api + "/exec", dict(code=TEST_CODE, **b))
    post({"action": "saveProjects", "projects": [{"id": "pU", "name": "上傳", "baseUpdatedAt": ""}]})
    import base64
    data = base64.b64encode(b"test").decode()
    good = ["a.pdf", "a.docx", "a.xlsx", "a.pptx", "a.jpg", "a.png", "a.heic", "a.dwg", "a.zip"]
    bad = ["a.html", "a.js", "a.exe"]
    for f in good:
        r = post({"action": "upload", "pid": "pU", "dir": 2, "filename": f, "mime": "", "data": data})
        ensure(r.get("ok"), f"{f} 應允許：{r}")
    for f in bad:
        r = post({"action": "upload", "pid": "pU", "dir": 2, "filename": f, "mime": "", "data": data})
        ensure(r.get("ok") is False, f"{f} 應拒絕")
    return "允許 " + "、".join(x[2:] for x in good) + "；拒絕 " + "、".join(x[2:] for x in bad)


def t13_calendar(B, api):
    http_json(api + "/__reset")
    http_json(api + "/__calendar")
    pg = login(B)
    pg.click("#newp")
    pg.fill("#newName", "保固追蹤日曆")
    pg.check("#newBody input[name=entry][value=warranty]")
    pg.click("#newGo")
    for k, v in (("accept", "2026-06-01"), ("years", "2")):
        pg.fill(f"#cd-{k}", v)
        pg.dispatch_event(f"#cd-{k}", "change")
    pg.click("#saveBtn")
    wait_saved(pg)
    deadline = time.time() + 10
    while time.time() < deadline:
        dbg = http_json(api + "/__debug")
        if dbg["events"]:
            break
        time.sleep(0.3)
    ensure(len(dbg["events"]) >= 1, "保固會勘期限應同步到日曆")
    pid = dbg["projects"][0]["id"]
    for k, v in (("wcheck", "2028-05-20"), ("refund", "2028-06-01")):
        pg.fill(f"#cd-{k}", v)
        pg.dispatch_event(f"#cd-{k}", "change")
    pg.click("#saveBtn")
    wait_saved(pg)
    deadline = time.time() + 10
    while time.time() < deadline:
        dbg = http_json(api + "/__debug")
        dl = [d for d in dbg["deadlines"] if d["id"] == pid]
        if dl and dl[0]["list"] == [] and not dbg["events"]:
            break
        time.sleep(0.3)
    sync_bodies = [json.loads(c["body"]) for c in dbg["calls"] if c.get("action") == "sync"]
    last = sync_bodies[-1]["items"][pid]["list"]
    ensure(last == [], f"最後一筆待辦完成後應送出 list: []，實際 {last}")
    ensure(not dbg["events"], "舊日曆事件應移除")
    ensure("結案" in pg.locator("#workHead .phase").inner_text(), "應顯示結案")
    pg.context.close()
    return "完工後送出 list: []，後端移除日曆事件、未攔截（404／配額錯誤見後端測試 13b、13c）"


def t14_digest():
    out = subprocess.run(["node", str(ROOT / "tests" / "lts_backend_test.js")], capture_output=True, text=True)
    line = next((l for l in out.stdout.splitlines() if l.startswith(("PASS  14", "FAIL  14"))), "")
    ensure(line.startswith("PASS"), f"後端週報測試未通過：{line}")
    return line.replace("PASS  ", "")


def rewrite_docx(data, pairs):
    """改寫 Word 裡的條文文字（模擬舊版範本做的契約）"""
    zin, buf = zipfile.ZipFile(io.BytesIO(data)), io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
        for it in zin.infolist():
            b = zin.read(it.filename)
            if it.filename == "word/document.xml":
                x = b.decode("utf-8")
                for a, c in pairs:
                    ensure(x.count(a) == 1, f"測試資料：Word 裡找不到唯一的「{a}」")
                    x = x.replace(a, c)
                b = x.encode("utf-8")
            zout.writestr(it, b)
    return buf.getvalue()


def t15_import(B):
    """匯入歷年契約：用網站產生「去年」的簽約版 Word，再匯入辨識（含不同版本範本的辨識）"""
    title = "臺北市立東湖國民中學114年度外牆整修工程委託設計監造案"
    last = proj(name="114年度外牆整修", title=title, vendor="示範建築師事務所", method="總包價法", fee="1280000", days="60",
                adv={"F055": "V", "F295": "V"})
    pg = B.local({"pLast": last})
    open_project(pg, "pLast", "proj")
    pg.click('#projBody button[data-stage="sign"]')
    pg.click("#dl")
    pg.wait_for_selector("#dlDlg[open]")
    _, data = download(pg, "#dlGo")
    pg.click("#impOld")
    pg.wait_for_selector("#impPick")
    ensure(not pg.locator("#impGo").is_visible(), "還沒選檔案就出現「建立今年工程」")
    with pg.expect_file_chooser() as fc:
        pg.click("#impPick")
    mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    fc.value.set_files({"name": "114年度外牆整修.docx", "mimeType": mime, "buffer": data})
    pg.wait_for_selector("#impBody table.impt", timeout=20000)
    ensure(pg.locator("#impGo").is_visible(), "讀完檔案後應出現「建立今年工程」")
    vals = pg.evaluate("Object.fromEntries([...document.querySelectorAll('#impBody [data-imp]')].map(e => [e.dataset.imp, e.value]))")
    ensure(vals["title"] == title and vals["design"] == "是" and vals["super"] == "是" and vals["method"] == "總包價法",
           f"基本欄位辨識：{vals}")
    rev = pg.evaluate("[...document.querySelectorAll('#impRev [data-imprev]')].map(e => e.dataset.imprev)")
    ensure("F055" in rev and "F295" in rev, f"去年加勾的第8條、第3條附件1 應列入需人工確認：{rev}")
    ensure("F494" not in rev, "第3條附件1 的勾選不應對到附件4")
    ensure("F098" not in rev and "F220" not in rev, f"「□其他＿＿」不應把後面的條文當成填寫值：{rev}")
    # 不同版本：模擬去年用的是改過條文的舊版範本（113.6.5 版），範本庫有這一版時應能辨識被改寫的條文
    b64 = __import__("base64").b64encode(data).decode()
    r = pg.evaluate("""async (b64) => {
        const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer, CI = window.ContractImport;
        const text = await CI.docxText(window.JSZip, DOMParser, buf);
        const pts = await fetch('points.json').then(x => x.json());
        const M = [['受託人：', '受託廠商：'], ['施工安全評估', '施工安全性評估'], ['（115.4.23版）', '（113.6.5版）'],
                   ['乙方應於甲方書面通知指定之日起', '乙方應於甲方通知之日起']];
        const sub = s => M.reduce((a, [x, y]) => a.split(x).join(y), s);
        const old = sub(text), oldPts = pts.map(p => Object.assign({}, p, { ctx: sub(p.ctx), label: sub(p.label) }));
        const a = CI.analyze(old, pts, { paras: true });
        const pk = CI.pickTemplate(old, [{ id: 'builtin', version: '115.4.23', points: pts },
                                         { id: 'u113', version: '113.6.5（待審）', points: oldPts }], { paras: true });
        const b = CI.analyze(old, pk.pick.points, { paras: true, reviewPoints: pts });
        return { want: pk.want, pick: pk.pick.id, exact: pk.exact, a: [a.fields.vendor.last, a.fields.days.last, a.values.F055 || ''],
                 b: [b.fields.vendor.last, b.fields.days.last, b.values.F055 || ''], old };
    }""", b64)
    ensure(r["want"] == "113.6.5" and r["pick"] == "u113" and r["exact"], f"應選用範本庫的 113.6.5 版：{r['pick']}")
    # 乙方另有不分版本的寫法比對（受託人／受託廠商），所以只檢查期限與第8條勾選
    ensure(r["a"][1:] == ["", ""], f"只用現行版時，改寫過的條文應讀不到（測試前提）：{r['a']}")
    ensure(r["a"][0] == "示範建築師事務所", f"「受託廠商：」寫法也應讀到乙方：{r['a']}")
    ensure(r["b"] == ["示範建築師事務所", "60", "V"], f"用同一版範本應讀到廠商、期限、第8條勾選：{r['b']}")
    # 範本庫沒有那一版時，核對畫面要說明並提示上傳（本機模式沒有範本庫）
    pg.click("#impCancel")
    pg.click("#impOld")
    pg.click("#impPasteBox > summary")
    pg.fill("#impPaste", r["old"])
    pg.click("#impPasteGo")
    pg.wait_for_selector("#impBody table.impt", timeout=20000)
    note = pg.locator("#impBody").inner_text()
    ensure("去年契約是工程會 113.6.5 版" in note and "範本管理裡沒有這一版" in note, "應說明去年契約的範本版本")
    # 新舊版差異：條文改寫過的舊契約（Word）→ 列出差異並推出去年的勾選與填寫，打勾才套用
    old = rewrite_docx(data, [("施工安全評估", "施工安全性評估"), ("乙方應於甲方書面通知指定之日起", "乙方應於甲方通知之日起")])
    pg.click("#impCancel")
    pg.click("#impOld")
    with pg.expect_file_chooser() as fc:
        pg.click("#impPick")
    fc.value.set_files({"name": "113年度外牆整修.docx", "mimeType": mime, "buffer": old})
    pg.wait_for_selector("#impDiff details", timeout=20000)
    box = '#impDiff [data-impdiff="F055"]'
    ensure(pg.locator(box).count() == 1, "改寫條文裡去年的勾選應列在「新舊版差異」")
    ensure(not pg.is_checked(box), "新舊版差異預設不套用")
    days = pg.locator('#impDiff button[data-impuse="days"]')
    ensure(days.count() == 1 and "60" not in pg.input_value('#impBody input[data-imp="days"]'), "交付期限應由差異區提供「填入」")
    pg.check(box)
    days.click()
    pg.select_option('#impBody select[data-imp="shape"]', "單一工程")
    pg.dispatch_event('#impBody select[data-imp="shape"]', "change")
    ensure(pg.is_checked(box), "改了上方欄位後，差異區的勾選要保留")
    ensure("新舊版差異：可套用 1 項，勾選套用 1 項" in pg.locator("#impSum").inner_text(), "建立前確認應列出差異套用數")
    pg.click("#impGo")
    pg.wait_for_function("!document.querySelector('#impDlg').open", timeout=15000)
    saved = pg.evaluate("Object.values(JSON.parse(localStorage.getItem('tsc-local')).projects)"
                        ".filter(p => p.importedFrom && p.importedFrom.file === '113年度外牆整修.docx')")
    ensure(len(saved) == 1, f"應建立 1 件匯入工程：{len(saved)}")
    ensure(saved[0]["adv"].get("F055") == "V" and saved[0]["days"] == "60", f"套用結果：{saved[0]['adv']}、{saved[0]['days']}")
    pg.context.close()
    return ("基本欄位正確；附件1 不錯置到附件4；「其他」空格不誤讀；選用同一版範本後讀到改寫條文；缺版本時有提示；"
            "新舊版差異列出改寫條文並推出去年值，打勾才套用")


def t16_quality():
    cfg = (ROOT / "config.js").read_text(encoding="utf-8")
    # 交付包的 API 必須是空字串；正式 repo 已填網址時，用 LTS_DEPLOYED=1 執行改為只檢查網址格式
    if os.environ.get("LTS_DEPLOYED") == "1":
        ensure(re.search(r'API:\s*"https://script\.google\.com/macros/s/[\w-]+/exec"', cfg), "config.js 的 API 網址格式")
    else:
        ensure(re.search(r'API:\s*""', cfg), "config.js 的 API 必須是空字串")
    files = ["index.html", "sw.js", "config.js", "後端_Code.gs", "engine.js", "checklist.js", "lifecycle.js", "govdocs.js",
             "exporter.js", "templater.js", "contract-import.js", "tests/lts_backend_test.js", "tests/lts_smoke_and_core.py"]
    longest = {}
    for f in files:
        lines = (ROOT / f).read_text(encoding="utf-8").split("\n")
        mx = max(len(l) for l in lines)
        longest[f] = mx
        ensure(mx <= 140, f"{f} 有超過 140 字元的行（最長 {mx}）")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    ensure("controllerchange" not in html, "前端不得監聽 controllerchange 自動重新整理")
    ensure(all(x in sw for x in ("skipWaiting()", "clients.claim()", 'startsWith("tc-")')), "sw.js 基本設定")
    # 版本號：sw.js 的 VERSION、index.html 的 VER 與所有 ?v= 必須是同一個（改版時三處一起改）
    m = re.search(r'const VERSION = "([\w-]+)"', sw)
    ensure(m, "sw.js 找不到 VERSION")
    ver = m.group(1)
    ensure(f'const VER = "{ver}"' in html, f"index.html 的 VER 應為 {ver}")
    ensure("postMessage" not in sw and "setInterval" not in sw, "sw.js 不應有訊息握手或輪詢")
    srcs = re.findall(r'<script src="([^"]+)"', html)
    ensure(srcs and all(s.endswith("?v=" + ver) for s in srcs), f"靜態資源版本號應為 {ver}：{srcs}")
    banned = ["ADMIN_CODE", "archiveContract", "mergeProject", "chooseConflicts", "DRAFT_SESSION", "syncPending",
              "checkFixHistory", "templateStructure", "ready-update", "legacy-ext"]
    hits = [b for b in banned for f in files[:11] if b in (ROOT / f).read_text(encoding="utf-8")]
    ensure(not hits, f"不得帶入已刪除的機制：{hits}")
    errs = [e for e in CONSOLE_ERRORS]
    ensure(not errs, "Console 錯誤：" + " | ".join(errs[:5]))
    return f"版本 {ver}；API 設定正確；{len(files)} 個檔案最長 {max(longest.values())} 字元；sw 極簡；無已刪除機制；全程 Console 無錯誤"


def main():
    srv, url = start_static()
    proc, api = start_backend()
    print(f"網站：{url}\n模擬後端：{api}\n")
    try:
        with sync_playwright() as pw:
            B = Browser(pw, url, api)
            record(1, "首頁與效能（100 件 <100ms、延遲載入、320/390px 不破版）", lambda: t01_home_perf(B))
            record(2, "建檔與接續（中途建檔不回頭填技服欄位）", lambda: t02_mid_entry(B))
            record(3, "Word 輸出與遮蔽（ZIP CRC、XML、無殘留記號、招標版不洩漏）", lambda: t03_word(B))
            record(4, "互斥與付款防呆", lambda: t04_conflict_and_pay(B))
            record(5, "日期與保固計算", lambda: t05_dates(B))
            record(6, "停復工處理", lambda: t06_stops(B))
            record(7, "全流程 100% 結案（500 萬免初驗）", lambda: t07_close(B))
            record(8, "草稿重開還原（本機＋雲端快取）", lambda: t08_drafts(B, api))
            record(9, "版本衝突保護（先備份再改用同仁版本／以我的版本儲存）", lambda: t09_conflict(B, api))
            record(10, "本機記事（新增、匯出、帶入表件保留原文）", lambda: t10_notes(B))
            record(11, "單一存取碼與防注入", lambda: t11_access(B, api))
            record(12, "附件上傳白名單", lambda: t12_upload(api))
            record(13, "日曆同步與完工清零", lambda: t13_calendar(B, api))
            record(14, "週報產出", t14_digest)
            record(15, "匯入歷年契約（辨識、附件不錯置、不同版本範本、新舊版差異）", lambda: t15_import(B))
            record(16, "程式碼品質檢查", t16_quality)
            B.b.close()
    finally:
        proc.terminate()
        srv.shutdown()
    print("=" * 72)
    for no, st, name, detail, sec in sorted(RESULTS):
        print(f"{no:>2}. {st}  {name}（{sec:.1f}s）\n     {detail}")
    npass = sum(1 for r in RESULTS if r[1] == "PASS")
    print("=" * 72)
    print(f"前端核心情境：{npass}/{len(RESULTS)} PASS")
    sys.exit(0 if npass == len(RESULTS) else 1)


if __name__ == "__main__":
    main()
