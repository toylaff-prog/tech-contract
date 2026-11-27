/* 20261127m-lts 後端測試：在 Node VM 裡模擬 Google Apps Script 服務，載入「後端_Code.gs」實際執行。
 *
 *   node tests/lts_backend_test.js            執行後端測試（輸出 PASS／FAIL）
 *   node tests/lts_backend_test.js --serve N  在 127.0.0.1:N 提供模擬後端，給前端 Chromium 測試使用
 *
 * 不連線任何正式 Google 服務：試算表、雲端硬碟、日曆、寄信都是記憶體裡的假物件。 */
"use strict";
const fs = require("fs"),
  path = require("path"),
  vm = require("vm"),
  http = require("http");

const ROOT = path.resolve(__dirname, "..");
const CODE_FILE = path.join(ROOT, "後端_Code.gs");
const TEST_CODE = "lts-test-code-2026";

/* ---------------- 模擬 Google Apps Script 環境 ---------------- */
function makeEnv() {
  const env = { mails: [], logs: [], calls: [] };
  let idSeq = 1;
  const nid = p => p + (idSeq++).toString(36).padStart(6, "0");

  // 試算表
  function makeSheet(name) {
    const data = [];
    const sh = {
      name,
      data,
      getLastRow: () => data.length,
      getLastColumn: () => data.reduce((m, r) => Math.max(m, r.length), 0),
      getMaxRows: () => Math.max(1000, data.length),
      setFrozenRows() {},
      appendRow(row) {
        data.push(row.slice());
      },
      deleteRow(r) {
        data.splice(r - 1, 1);
      },
      getRange(row, col, nr, nc) {
        nr = nr || 1;
        nc = nc || 1;
        const cell = (r, c) => {
          const v = (data[r - 1] || [])[c - 1];
          return v === undefined ? "" : v;
        };
        const put = (r, c, v) => {
          while (data.length < r) data.push([]);
          const line = data[r - 1];
          while (line.length < c - 1) line.push("");
          line[c - 1] = v;
        };
        return {
          getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(row + i, col + j))),
          getValue: () => cell(row, col),
          setValues(vals) {
            vals.forEach((line, i) => line.forEach((v, j) => put(row + i, col + j, v)));
            return this;
          },
          setValue(v) {
            put(row, col, v);
            return this;
          },
          setNumberFormat() {
            return this;
          },
        };
      },
    };
    return sh;
  }
  const sheets = {};
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = makeSheet(n)),
  };
  env.sheets = sheets;

  // 指令碼屬性、快取、鎖
  const props = {};
  env.props = props;
  const cache = {};
  env.cache = cache;

  // 雲端硬碟
  const files = {},
    folders = {};
  function makeFolder(name) {
    const f = {
      id: nid("fd"),
      name,
      trashed: false,
      viewers: [],
      kids: [],
      files: [],
      getId: () => f.id,
      getName: () => f.name,
      getUrl: () => "https://drive.google.com/drive/folders/" + f.id,
      isTrashed: () => f.trashed,
      addViewer: e => f.viewers.push(e),
      removeViewer: e => (f.viewers = f.viewers.filter(x => x !== e)),
      createFolder(n) {
        const k = makeFolder(n);
        f.kids.push(k);
        return k;
      },
      getFoldersByName(n) {
        const list = f.kids.filter(k => k.name === n);
        let i = 0;
        return { hasNext: () => i < list.length, next: () => list[i++] };
      },
      createFile(blob) {
        const file = {
          id: nid("fl"),
          name: blob.name,
          blob,
          getId: () => file.id,
          getUrl: () => "https://drive.google.com/file/d/" + file.id + "/view",
          getName: () => file.name,
          getBlob: () => blob,
        };
        files[file.id] = file;
        f.files.push(file);
        return file;
      },
    };
    folders[f.id] = f;
    return f;
  }
  env.files = files;
  env.folders = folders;

  // 日曆（可設定錯誤：fail.remove / fail.patch / fail.insert ＝ "404" | "quota"）
  const cal = { calendars: {}, events: {}, acl: {}, fail: {} };
  env.cal = cal;
  const calErr = kind =>
    new Error(kind === "404" ? "API call to calendar.events failed with error: Not Found (404)" : "Rate Limit Exceeded: quota");
  const Calendar = {
    CalendarList: { list: () => ({ items: Object.values(cal.calendars) }) },
    Calendars: {
      get(id) {
        if (!cal.calendars[id]) throw calErr("404");
        return cal.calendars[id];
      },
      insert(o) {
        const id = nid("cal") + "@group.calendar.google.com";
        cal.calendars[id] = Object.assign({ id }, o);
        cal.acl[id] = [{ id: "own", role: "owner", scope: { type: "user", value: "owner@example.edu.tw" } }];
        return cal.calendars[id];
      },
    },
    Events: {
      insert(res, cid) {
        if (cal.fail.insert) throw calErr(cal.fail.insert);
        const id = nid("ev");
        cal.events[id] = Object.assign({ id, cid }, res);
        return cal.events[id];
      },
      patch(res, cid, eid) {
        if (cal.fail.patch) throw calErr(cal.fail.patch);
        if (!cal.events[eid]) throw calErr("404");
        Object.assign(cal.events[eid], res);
        return cal.events[eid];
      },
      remove(cid, eid) {
        if (cal.fail.remove) throw calErr(cal.fail.remove);
        if (!cal.events[eid]) throw calErr("404");
        delete cal.events[eid];
      },
    },
    Acl: {
      list: id => ({ items: cal.acl[id] || [] }),
      insert(o, id) {
        (cal.acl[id] = cal.acl[id] || []).push(Object.assign({ id: nid("acl") }, o));
      },
      remove(id, aid) {
        cal.acl[id] = (cal.acl[id] || []).filter(a => a.id !== aid);
      },
    },
  };

  const triggers = [];
  const ctx = {
    console,
    JSON,
    Math,
    Date,
    Number,
    String,
    Object,
    Array,
    RegExp,
    Error,
    encodeURIComponent,
    parseInt,
    isNaN,
    SpreadsheetApp: { getActive: () => ss, flush() {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => {
          props[k] = String(v);
        },
        deleteProperty: k => {
          delete props[k];
        },
        getKeys: () => Object.keys(props),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (k in cache ? cache[k] : null),
        put: (k, v) => {
          cache[k] = String(v);
        },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: t => ({ text: t, setMimeType() { return this; }, getContent() { return t; } }),
    },
    Utilities: {
      getUuid: () => "1234abcd-12ab-34cd-56ef-1234567890ab".replace(/1/g, () => String(idSeq++ % 10)),
      base64Decode: s => Array.from(Buffer.from(s, "base64")),
      base64Encode: b => Buffer.from(b).toString("base64"),
      newBlob: (data, mime, name) => ({
        data,
        mime,
        name,
        getDataAsString: () => (typeof data === "string" ? data : Buffer.from(data).toString("utf8")),
        getBytes: () => (typeof data === "string" ? Array.from(Buffer.from(data)) : data),
      }),
      formatDate: d => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(d),
      unzip: () => [],
    },
    DriveApp: {
      createFolder: n => makeFolder(n),
      getFolderById(id) {
        if (!folders[id]) throw new Error("No item with the given ID could be found");
        return folders[id];
      },
      getFileById(id) {
        if (!files[id]) throw new Error("No item with the given ID could be found");
        return files[id];
      },
    },
    XmlService: {
      parse(text) {
        // 簡易格式檢查：標籤要成對（測試用，不是完整 XML 解析器）
        const st = [];
        const re = /<(\/?)([A-Za-z_][\w:.-]*)[^>]*?(\/?)>/g;
        let m;
        const body = String(text).replace(/<\?[\s\S]*?\?>/g, "");
        while ((m = re.exec(body))) {
          if (m[3] === "/") continue;
          if (!m[1]) st.push(m[2]);
          else if (st.pop() !== m[2]) throw new Error("XML 標籤不成對：" + m[2]);
        }
        if (st.length) throw new Error("XML 標籤未關閉");
        return {};
      },
    },
    Calendar,
    MailApp: {
      getRemainingDailyQuota: () => 100,
      sendEmail: o => env.mails.push(o),
    },
    ScriptApp: {
      WeekDay: { MONDAY: "MONDAY" },
      getProjectTriggers: () => triggers,
      deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
      newTrigger(fn) {
        const t = { getHandlerFunction: () => fn };
        const chain = {
          timeBased: () => chain,
          onWeekDay: () => chain,
          atHour: () => chain,
          inTimezone: () => chain,
          create: () => (triggers.push(t), t),
        };
        return chain;
      },
    },
    Logger: { log: m => env.logs.push(String(m)) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(CODE_FILE, "utf8"), ctx, { filename: "後端_Code.gs" });
  ctx.setup();
  props.ACCESS_CODE = TEST_CODE;
  env.ctx = ctx;
  env.post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ code: TEST_CODE }, body)) } }).text);
  env.raw = text => JSON.parse(ctx.doPost({ postData: { contents: text } }).text);
  env.get = () => JSON.parse(ctx.doGet({ parameter: { code: TEST_CODE, action: "load" } }).text);
  env.eventsOf = pid => Object.values(cal.events).filter(e => String(e.extendedProperties.private.tsc).startsWith(pid + "|"));
  env.deadlines = pid => {
    const r = sheets["期限"].data.find(x => x[0] === pid);
    return r ? { list: JSON.parse(r[2]), map: JSON.parse(r[3]) } : null;
  };
  return env;
}

/* ---------------- 模擬後端伺服器（給前端測試用） ---------------- */
function serve(port) {
  let env = makeEnv();
  const srv = http.createServer((req, res) => {
    const head = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" };
    let buf = "";
    req.on("data", c => (buf += c));
    req.on("end", () => {
      try {
        if (req.url.startsWith("/__reset")) {
          env = makeEnv();
          res.writeHead(200, head).end('{"ok":true}');
          return;
        }
        if (req.url.startsWith("/__debug")) {
          const projects = (env.sheets["工程"].data || [])
            .slice(1)
            .map(r => ({ id: r[0], name: r[1], at: r[2], by: r[3], data: JSON.parse(r[4]) }));
          const deadlines = (env.sheets["期限"].data || []).slice(1).map(r => ({ id: r[0], list: JSON.parse(r[2]), map: JSON.parse(r[3]) }));
          const out = { projects, deadlines, events: Object.values(env.cal.events), calls: env.calls, props: env.props };
          res.writeHead(200, head).end(JSON.stringify(out));
          return;
        }
        if (req.url.startsWith("/__calendar")) {
          // 測試用：先建立共用日曆
          env.ctx.calCreate_("測試日曆");
          res.writeHead(200, head).end('{"ok":true}');
          return;
        }
        if (req.method === "GET") {
          env.calls.push({ method: "GET", url: req.url });
          res.writeHead(200, head).end(env.ctx.doGet({ parameter: {} }).text);
          return;
        }
        let action = "";
        try {
          action = JSON.parse(buf).action;
        } catch (e) {}
        env.calls.push({ method: req.method, url: req.url, action, body: buf.length < 4000 ? buf : buf.slice(0, 4000) });
        res.writeHead(200, head).end(env.ctx.doPost({ postData: { contents: buf } }).text);
      } catch (e) {
        res.writeHead(500, head).end(JSON.stringify({ ok: false, error: String(e && e.stack || e) }));
      }
    });
  });
  srv.listen(port, "127.0.0.1", () => console.log("mock backend ready on " + port));
}

/* ---------------- 測試 ---------------- */
const results = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error("assertion returned false");
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, e && e.message]);
  }
}
const eq = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || "不相等") + "：" + JSON.stringify(a) + " ≠ " + JSON.stringify(b));
};
const ok = (v, msg) => {
  if (!v) throw new Error(msg || "應為真");
};

function runTests() {
  const src = fs.readFileSync(CODE_FILE, "utf8");

  // ---- 11. 單一存取碼與防注入 ----
  check("11a doGet 拒絕網址帶存取碼", () => {
    const env = makeEnv();
    const r = env.get();
    eq(r.ok, false);
    ok(/POST/.test(r.error), "應提示改用 POST");
  });
  check("11b doPost 驗證 ACCESS_CODE（錯誤碼回 code、正確碼 ping 成功）", () => {
    const env = makeEnv();
    eq(env.post({ action: "ping", code: "wrong-code-123" }).error, "code");
    const r = env.post({ action: "ping" });
    eq(r.ok, true);
    eq(r.ping, "pong");
  });
  check("11c 存取碼少於 12 字元時拒絕服務", () => {
    const env = makeEnv();
    env.props.ACCESS_CODE = "short123";
    const r = env.post({ action: "ping", code: "short123" });
    eq(r.ok, false);
    ok(/12/.test(r.error));
  });
  check("11d 15 分鐘內錯 30 次暫停猜碼，但正確碼不受阻斷", () => {
    const env = makeEnv();
    for (let i = 0; i < 35; i++) env.post({ action: "ping", code: "guess-" + i + "-xxxxxx" });
    eq(Number(env.cache.badCode), 30, "錯誤次數上限");
    eq(env.post({ action: "ping" }).ok, true, "正確碼仍可使用");
    eq(env.post({ action: "ping", code: "guess-again-xxxxx" }).error, "code");
  });
  check("11e safeText_ 防公式注入（含前導空白）", () => {
    const env = makeEnv(),
      f = env.ctx.safeText_;
    eq(f(" =SUM(A1)"), "' =SUM(A1)");
    eq(f("=1+1"), "'=1+1");
    eq(f("+886"), "'+886");
    eq(f("-x"), "'-x");
    eq(f("@foo"), "'@foo");
    eq(f("\t=cmd"), "'\t=cmd");
    eq(f("一般文字 =不算"), "一般文字 =不算");
  });
  check("11f ID_RE 防原型污染（__proto__、constructor 不得當工程編號）", () => {
    const env = makeEnv(),
      re = env.ctx.ID_RE;
    ok(!re.test("__proto__") && !re.test("constructor") && !re.test("prototype"));
    ok(re.test("p123abc") && !re.test("a/b") && !re.test("x".repeat(41)));
    const r = env.post({ action: "saveProjects", projects: [{ id: "__proto__", name: "x" }] });
    eq(r.saved.length, 0);
    eq(r.rejected.length, 1);
  });
  check("11g 試算表寫入的名稱與修改者經過 safeText_", () => {
    const env = makeEnv();
    env.post({ action: "saveProjects", who: "=HYPERLINK(1)", projects: [{ id: "p1", name: "+惡意", baseUpdatedAt: "" }] });
    const row = env.sheets["工程"].data[1];
    eq(row[1], "'+惡意");
    eq(row[3], "'=HYPERLINK(1)");
  });

  // ---- 9. 版本衝突（後端部分） ----
  check("9a 版本衝突：舊 base 回傳衝突；以剛看到的衝突版本為 base 可覆蓋儲存", () => {
    const env = makeEnv();
    const a = env.post({ action: "saveProjects", projects: [{ id: "p1", name: "A", baseUpdatedAt: "" }] }).saved[0].updatedAt;
    const b = env.post({ action: "saveProjects", projects: [{ id: "p1", name: "B", baseUpdatedAt: a }] });
    eq(b.saved.length, 1);
    const stale = env.post({ action: "saveProjects", projects: [{ id: "p1", name: "C", baseUpdatedAt: a }] });
    eq(stale.saved.length, 0);
    eq(stale.conflicts[0].name, "B");
    const mine = env.post({ action: "saveProjects", projects: [{ id: "p1", name: "C", baseUpdatedAt: stale.conflicts[0].updatedAt }] });
    eq(mine.saved.length, 1);
    eq(JSON.parse(env.sheets["工程"].data[1][4]).name, "C");
  });
  check("9b 已刪除的工程不會被舊頁面存回（回傳 deleted 衝突）", () => {
    const env = makeEnv();
    const at = env.post({ action: "saveProjects", projects: [{ id: "p9", name: "X", baseUpdatedAt: "" }] }).saved[0].updatedAt;
    eq(env.post({ action: "deleteProject", id: "p9", base: at }).ok, true);
    const r = env.post({ action: "saveProjects", projects: [{ id: "p9", name: "X2", baseUpdatedAt: at }] });
    eq(r.conflicts[0].deleted, true);
  });

  // ---- 12. 附件上傳白名單 ----
  check("12a 允許學校常用工程檔案（pdf/docx/xlsx/pptx/jpg/png/heic/dwg/zip）", () => {
    const env = makeEnv();
    env.post({ action: "saveProjects", projects: [{ id: "p1", name: "A", baseUpdatedAt: "" }] });
    const data = Buffer.from("hello").toString("base64");
    const types = { pdf: "application/pdf", docx: "", xlsx: "", pptx: "", jpg: "image/jpeg", png: "image/png", heic: "", dwg: "", zip: "" };
    Object.keys(types).forEach(ext => {
      const r = env.post({ action: "upload", pid: "p1", pname: "A", dir: 2, filename: "附件." + ext, mime: types[ext], data });
      ok(r.ok, ext + " 應允許：" + r.error);
      ok(/^https:\/\//.test(r.file.url), "附件連結須為 https");
    });
  });
  check("12b 拒絕 html/js/exe/svg/bat/sh，及偽裝成 PDF 的 HTML", () => {
    const env = makeEnv();
    env.post({ action: "saveProjects", projects: [{ id: "p1", name: "A", baseUpdatedAt: "" }] });
    const data = Buffer.from("x").toString("base64");
    ["a.html", "a.htm", "a.js", "a.exe", "a.svg", "a.bat", "a.sh", "a.pdf.html", "noext"].forEach(fn => {
      const r = env.post({ action: "upload", pid: "p1", dir: 0, filename: fn, mime: "", data });
      eq(r.ok, false, fn + " 應拒絕");
    });
    eq(env.post({ action: "upload", pid: "p1", dir: 0, filename: "a.pdf", mime: "text/html", data }).ok, false, "MIME 是 HTML");
  });
  check("12c 單檔超過 20MB 拒絕", () => {
    const env = makeEnv();
    env.post({ action: "saveProjects", projects: [{ id: "p1", name: "A", baseUpdatedAt: "" }] });
    const big = Buffer.alloc(20 * 1024 * 1024 + 10).toString("base64");
    eq(env.post({ action: "upload", pid: "p1", dir: 0, filename: "big.pdf", mime: "application/pdf", data: big }).ok, false);
  });

  // ---- 13. 日曆同步與完工清零 ----
  const ev = (key, date, title) => ({ key, date, title: "A｜" + title, short: title, who: "學校", desc: "事項：" + title });
  function calEnv() {
    const env = makeEnv();
    env.ctx.calCreate_("測試日曆");
    const at = env.post({ action: "saveProjects", projects: [{ id: "p1", name: "A", baseUpdatedAt: "" }] }).saved[0].updatedAt;
    const sc = env.post({ action: "saveSchool", school: { party: "東湖國中" }, base: "" }).updatedAt;
    return { env, at, sc };
  }
  check("13a 最後一筆待辦完成送出 list: [] → 移除舊日曆事件、不攔截", () => {
    const { env, at, sc } = calEnv();
    const two = [ev("acc-0", "2026-12-01", "報竣"), ev("acc-3", "2026-12-08", "查證")];
    let r = env.post({ action: "sync", schoolAt: sc, items: { p1: { name: "A", at, list: two } } });
    eq(r.errors, []);
    eq(env.eventsOf("p1").length, 2);
    r = env.post({ action: "sync", schoolAt: sc, items: { p1: { name: "A", at, list: [] } } });
    eq(r.ok, true);
    eq(r.errors, [], "清空不應報錯");
    eq(env.eventsOf("p1").length, 0, "日曆事件應全部移除");
    eq(env.deadlines("p1").list, []);
    eq(env.deadlines("p1").map, {});
  });
  check("13b 移除時遇 404：視同已刪除，移除對照", () => {
    const { env, at, sc } = calEnv();
    env.post({ action: "sync", schoolAt: sc, items: { p1: { name: "A", at, list: [ev("acc-0", "2026-12-01", "報竣")] } } });
    Object.keys(env.cal.events).forEach(k => delete env.cal.events[k]); // 有人直接在日曆上刪掉
    const r = env.post({ action: "sync", schoolAt: sc, items: { p1: { name: "A", at, list: [] } } });
    eq(r.errors, []);
    eq(env.deadlines("p1").map, {});
  });
  check("13c 移除時遇配額錯誤：保留對照並回報，等手動重試", () => {
    const { env, at, sc } = calEnv();
    env.post({ action: "sync", schoolAt: sc, items: { p1: { name: "A", at, list: [ev("acc-0", "2026-12-01", "報竣")] } } });
    env.cal.fail.remove = "quota";
    const r = env.post({ action: "sync", schoolAt: sc, items: { p1: { name: "A", at, list: [] } } });
    ok(r.errors.length > 0, "應回報錯誤");
    eq(Object.keys(env.deadlines("p1").map), ["acc-0"], "對照應保留");
    env.cal.fail.remove = "";
    const r2 = env.post({ action: "sync", schoolAt: sc, items: { p1: { name: "A", at, list: [] } } });
    eq(r2.errors, []);
    eq(env.eventsOf("p1").length, 0, "重試後移除");
  });
  check("13d 更新時活動已不存在（404）→ 重新建立；說明欄移除外部網址並附 SITE_URL", () => {
    const { env, at, sc } = calEnv();
    env.post({ action: "siteSet", site: "https://example.github.io/tech-contract/" });
    env.post({ action: "sync", schoolAt: sc, items: { p1: { name: "A", at, list: [ev("acc-0", "2026-12-01", "報竣")] } } });
    Object.keys(env.cal.events).forEach(k => delete env.cal.events[k]);
    const one = Object.assign(ev("acc-0", "2026-12-02", "報竣"), { desc: "事項：x\n釣魚 https://evil.example/login\n開啟網站：http://old" });
    const r = env.post({ action: "sync", schoolAt: sc, items: { p1: { name: "A", at, list: [one] } } });
    eq(r.errors, []);
    const e = env.eventsOf("p1");
    eq(e.length, 1);
    ok(!/evil\.example|http:\/\/old/.test(e[0].description), "外部網址應移除");
    ok(/開啟網站：https:\/\/example\.github\.io\/tech-contract\/#p=p1/.test(e[0].description), "應附 SITE_URL");
  });
  check("13e 學校設定版本不是最新時略過同步（不用舊設定改日曆）", () => {
    const { env, at } = calEnv();
    const r = env.post({ action: "sync", schoolAt: "old", items: { p1: { name: "A", at, list: [ev("acc-0", "2026-12-01", "報竣")] } } });
    eq(r.skipped, "school");
  });
  check("13f siteSet 只接受 https 網址", () => {
    const env = makeEnv();
    eq(env.post({ action: "siteSet", site: "http://x.example/" }).ok, false);
    eq(env.post({ action: "siteSet", site: "javascript:alert(1)" }).ok, false);
    eq(env.post({ action: "siteSet", site: "https://x.example/a?b=1" }).ok, false);
    eq(env.post({ action: "siteSet", site: "https://x.example/tech-contract/" }).ok, true);
  });

  // ---- 14. 週報產出 ----
  check("14 每週摘要信分列已逾期、7 日內、8～30 日內（停工中另列、不算逾期）", () => {
    const env = makeEnv();
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());
    const add = n => {
      const p = today.split("-").map(Number);
      return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
    };
    const at = env.post({ action: "saveProjects", projects: [{ id: "p1", name: "屋頂防水", baseUpdatedAt: "" }] }).saved[0].updatedAt;
    const sc = env.post({ action: "saveSchool", school: { party: "臺北市立東湖國民中學" }, base: "" }).updatedAt;
    const list = [
      ev("a", add(-3), "逾期事項"),
      ev("b", add(5), "七日內事項"),
      ev("c", add(20), "二十日事項"),
      ev("d", add(60), "很久以後"),
      Object.assign(ev("e", add(-10), "停工中期限"), { hold: true }),
    ];
    env.post({ action: "sync", schoolAt: sc, items: { p1: { name: "屋頂防水", at, list } } });
    env.post({ action: "person", email: "staff@example.edu.tw", cal: false, drive: false, mail: true });
    const g = env.ctx.digestGroups_(today);
    eq(g.late.map(x => x.t), ["逾期事項"]);
    eq(g.week.map(x => x.t), ["七日內事項"]);
    eq(g.month.map(x => x.t), ["二十日事項"]);
    eq(g.hold.map(x => x.t), ["停工中期限"]);
    const r = env.post({ action: "digestTest" });
    eq(r.ok, true);
    const m = env.mails[0];
    ok(/逾期 1 項/.test(m.subject) && /7 日內 1 項/.test(m.subject), m.subject);
    ok(/已逾期（1 項）/.test(m.body) && /7 日內到期（1 項）/.test(m.body) && /8–30 日內到期（1 項）/.test(m.body), m.body);
    ok(!/很久以後/.test(m.body), "30 日後不列入");
  });

  // ---- 範本基礎檢查 ----
  check("範本上傳：基礎 JSON/XML 檢查、防路徑穿越、無孤兒記號，預設待核對", () => {
    const env = makeEnv();
    const doc = '<w:document><w:body><w:p><w:r><w:t>⟦F001⟧</w:t></w:r></w:p></w:body></w:document>';
    const parts = [
      { name: "[Content_Types].xml", text: "<Types/>" },
      { name: "_rels/.rels", text: "<Relationships/>" },
      { name: "word/document.xml", text: doc },
    ];
    const base = { tpl: JSON.stringify(parts), points: JSON.stringify([{ id: "F001", kind: "填空" }]), regions: "{}", review: '{"left":0}' };
    const r = env.post(Object.assign({ action: "addTemplate", version: "測試版" }, base));
    eq(r.ok, true);
    eq(r.status, "pending");
    const evil = parts.concat([{ name: "../../evil.xml", text: "<x/>" }]);
    eq(env.post(Object.assign({}, base, { action: "addTemplate", tpl: JSON.stringify(evil) })).ok, false, "路徑穿越");
    const swap = p => (p.name === "word/document.xml" ? { name: p.name, text: doc.replace("F001", "F999") } : p);
    const orphan = JSON.stringify(parts.map(swap));
    eq(env.post(Object.assign({}, base, { action: "addTemplate", tpl: orphan })).ok, false, "孤兒記號");
    eq(env.post({ action: "activateTemplate", id: r.id }).error, "review", "待核對範本啟用前要確認");
    eq(env.post({ action: "activateTemplate", id: r.id, reviewed: true }).ok, true);
  });

  // ---- 刪除清單：這些機制不得存在 ----
  check("LTS 不含已刪除的機制（管理員密碼、DOCX 封存、限期改正鎖死、硬編碼範本型別、大量取消攔截）", () => {
    const banned = ["ADMIN_CODE", "adminOK_", "archiveContract_", "getContractArchive_", "sealed_", "SHA_256", "contractHistory",
      "checkFixHistory_", "templateStructure_", "大量取消", "SHARE_DOMAINS"];
    const hit = banned.filter(w => src.includes(w));
    eq(hit, []);
  });
  check("後端每行不超過 140 字元", () => {
    const long = src.split("\n").map((l, i) => [i + 1, l.length]).filter(x => x[1] > 140);
    eq(long, []);
  });

  // ---- 輸出 ----
  const pass = results.filter(r => r[0] === "PASS").length;
  results.forEach(r => console.log(r[0] + "  " + r[1] + (r[2] ? "\n      → " + r[2] : "")));
  console.log(`\n後端測試：${pass}/${results.length} PASS`);
  process.exitCode = pass === results.length ? 0 : 1;
}

if (require.main === module) {
  const i = process.argv.indexOf("--serve");
  if (i >= 0) serve(Number(process.argv[i + 1] || 8790));
  else runTests();
}
module.exports = { makeEnv, TEST_CODE };
