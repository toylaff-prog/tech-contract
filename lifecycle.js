/* 工程生命週期：技術服務 → 施工 → 竣工驗收至保固
   期限計算依契約範本第7條：
   - 工作天：不計週六、週日及放假日（學校設定可列放假日、補行上班日）
   - 「自指定之日起算」：當日算入；「收到／簽約後N日」：次日起算
   - 日曆天：末日遇放假日，順延至次一辦公日 */
(function (G) {
  "use strict";
  const C = G.Checklist;
  const pd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const num = v => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return isFinite(n) ? n : 0; };
  const dates = txt => (String(txt || "").match(/\d{4}-\d{2}-\d{2}/g) || []);

  function makeCal(school) {
    const off = new Set(dates((school || {}).holidays)), on = new Set(dates((school || {}).makeups));
    return { isOff(d) { const k = iso(d); if (on.has(k)) return false; const w = d.getDay(); return w === 0 || w === 6 || off.has(k); } };
  }
  // 由 base 起算 n 日（unit：工作天／日曆天；inclusive：當日是否算入）
  function countDays(base, n, unit, inclusive, cal) {
    const d0 = pd(base); n = num(n); if (!d0 || n < 0) return "";
    const d = new Date(d0);
    if (n === 0) return iso(d);
    if (!inclusive) d.setDate(d.getDate() + 1);
    if (unit === "工作天") {
      let c = 0;
      for (let g = 0; g < 4000; g++) { if (!cal.isOff(d)) { c++; if (c >= n) return iso(d); } d.setDate(d.getDate() + 1); }
      return "";
    }
    d.setDate(d.getDate() + Math.ceil(n) - 1);
    for (let g = 0; g < 60 && cal.isOff(d); g++) d.setDate(d.getDate() + 1);
    return iso(d);
  }

  // ---------- 一、技術服務履約期程 ----------
  // [id, 事項, 基準日, 日數來源, 當日算入, 主辦, 契約依據, 備註, 適用條件]
  const TECH = [
    ["T1", "提出「服務實施計畫書」送甲方核可", "start", "planSubmit", true, "技服廠商", "第8條(一)", "", null],
    ["T2", "審查服務實施計畫書", "T1", "planReview", false, "學校", "第8條(一)", "", null],
    ["T3", "檢具派駐甲方處所勞工名冊", "sign", "roster", false, "技服廠商", "第8條", "學校設定未填日數者不列入", s => num(s.roster) > 0],
    ["T4", "提報技師簽證執行計畫", "start", "certPlan", true, "技服廠商", "第8條", "", null],
    ["T5", "交付規劃／設計成果", "start", "days", true, "技服廠商", "第7條(一)", "", (s, p) => p.plan === "是" || p.design === "是"],
    ["T6", "審查各階段書面資料（設計成果）", "T5", "stageReview", false, "學校", "第8條", "逾期未審視同甲方接受", (s, p) => p.plan === "是" || p.design === "是"],
  ];
  const BASE_LABEL = { start: "甲方通知指定之日", sign: "簽約日", T1: "收到服務實施計畫書", T5: "收到設計成果" };
  function techAuto(id, p) {
    const b = p.build || {}, ms = (p.tech || {}).ms || {};
    if (b.award || b.start) return ["已完成", "工程已發包，設計階段推定完成"];
    if (id === "T1" && ms.T2 && ms.T2.d) return ["已完成", "已審查，推定已提出"];
    if (id === "T5" && ms.T6 && ms.T6.d) return ["已完成", "已審查，推定已交付"];
    return ["未辦", ""];
  }
  function techRows(p, school, cal, now) {
    const t = p.tech || {}, ms = t.ms || {}, unit = school.daytype === "日曆天" ? "日曆天" : "工作天";
    return TECH.filter(r => !r[8] || r[8](school, p)).map(([id, item, base, src, incl, who, basis, note]) => {
      const n = src === "days" ? num(p.days) : num(school[src]);
      const baseDate = base === "start" ? t.start : base === "sign" ? t.sign : ((ms[base] || {}).d || "");
      const due = baseDate && n ? countDays(baseDate, n, src === "days" ? (t.daysUnit || unit) : unit, incl, cal) : "";
      const st = ms[id] || {}, [aS, aNote] = techAuto(id, p), s = st.s || aS, open = s !== "已完成" && s !== "不適用";
      const when = (n ? `${BASE_LABEL[base]}${incl ? "起" : "後"} ${n} ${src === "days" ? (t.daysUnit || unit) : unit}內` : "（契約未載明日數）") + (note ? "；" + note : "");
      return { key: id, phase: "tech", item, when, basis, who, due, s, auto: !st.s, autoS: aS, autoNote: st.s ? "" : aNote, autoD: "", d: st.d || "", note: st.n || "", nt: st.nt || "", open, left: open && due ? C.daysBetween(now, due) : null, files: [] };
    });
  }

  // ---------- 二、施工 ----------
  function extTotal(b) { return (b.ext || []).reduce((a, e) => a + num(e.days), 0); }
  function plannedCompletion(p, cal) {
    const b = p.build || {};
    if (b.due) return { date: b.due, how: "手動輸入" };
    if (b.start && num(b.days)) {
      const total = num(b.days) + extTotal(b);
      return { date: countDays(b.start, total, b.unit === "工作天" ? "工作天" : "日曆天", true, cal), how: `開工日起 ${num(b.days)}${extTotal(b) ? "＋展延 " + extTotal(b) : ""} ${b.unit === "工作天" ? "工作天" : "日曆天"}（含開工當日）` };
    }
    return { date: "", how: "" };
  }

  // ---------- 三、竣工驗收至保固（沿用 checklist.js） ----------
  function acceptRows(p, cal, now, plan, school) {
    const b = p.build || {};
    const ev = C.evaluate(p.chk, now, { plan, cal, countDays, budget: b.budget, amount: b.amount, preTh: school.preTh, auditTh: school.auditTh });
    ev.rows.forEach(r => { r.key = r.i; r.phase = "accept"; r.nt = (((p.chk || {}).items || {})[r.i] || {}).nt || ""; });
    return ev;
  }

  // ---------- 整合 ----------
  function evaluate(p, school, now) {
    p = p || {}; school = school || {}; now = now || C.today();
    const cal = makeCal(school), plan = plannedCompletion(p, cal);
    const tech = techRows(p, school, cal, now), acc = acceptRows(p, cal, now, plan.date, school);
    const t = p.tech || {}, b = p.build || {};
    const techDone = tech.filter(r => r.s === "已完成").length, techTotal = tech.filter(r => r.s !== "不適用").length;
    const all = tech.concat(acc.rows), open = all.filter(r => r.open && r.due);
    const overdue = open.filter(r => r.left < 0).length;
    const next = open.slice().sort((a, b2) => a.due.localeCompare(b2.due))[0] || null;
    const accStarted = acc.started;
    let phase, label;
    if (accStarted) { phase = "accept"; label = acc.stage >= C.STAGES.length ? "結案" : acc.stage === 5 ? "保固中" : "驗收：" + C.STAGES[acc.stage]; }
    else if (b.start) { phase = "build"; label = "施工中" + (plan.date ? "（預定竣工 " + C.roc(plan.date) + "）" : ""); }
    else if (b.award) { phase = "build"; label = "工程已決標，待開工"; }
    else if (t.sign || t.start) { phase = "tech"; label = "技術服務履約中"; }
    else { phase = "prep"; label = "契約準備中"; }
    const steps = [
      { key: "tech", name: "技術服務", status: t.sign || t.start ? (techTotal && techDone === techTotal ? "履約事項完成" : `履約中 ${techDone}/${techTotal}`) : "尚未簽約" },
      { key: "build", name: "施工", status: b.start ? (((p.chk || {}).dates || {}).report ? "已報竣" : "施工中") : b.award ? "已決標，待開工" : "尚未發包", sub: plan.date ? "預定竣工 " + C.roc(plan.date) : "" },
      { key: "accept", name: "竣工驗收至保固", status: accStarted ? (acc.stage >= C.STAGES.length ? "結案" : C.STAGES[acc.stage]) : "尚未報竣", sub: accStarted ? acc.pct + "%" : "" },
    ];
    const out = { phase, label, steps, tech, techDone, techTotal, accept: acc, plan, overdue, next, cal };
    out.step = nextStep(p, school, out);
    return out;
  }

  // ---------- 下一步 ----------
  function nextStep(p, school, ev) {
    const t = p.tech || {}, b = p.build || {}, d = ((p.chk || {}).dates) || {}, docs = p.docs || {};
    const roc = C.roc, rows = ev.accept.rows, R = i => rows[i] || {};
    const step = (title, detail, sub, sel, extra) => Object.assign({ title, detail: detail || "", go: { sub, sel } }, extra || {});
    const withDue = (r, txt) => r && r.due ? (txt ? txt + "；" : "") + "期限 " + roc(r.due) : (txt || "");
    // 0. 使用者標為「辦理中」的事項優先
    const doing = ev.tech.concat(rows).find(r => !r.auto && r.s === "辦理中");
    if (doing) return step("處理中：" + doing.item, withDue(doing), doing.phase === "tech" ? "tech" : "chk", `[data-ph=${doing.phase}][data-key="${doing.key}"][data-f=s]`, { due: doing.due, left: doing.left });
    const phases = ["plan", "design", "super"].filter(k => p[k] === "是");
    // 1～2. 技術服務契約與履約；工程已發包或已進入驗收（例如中途才建檔的工程），就不再回頭要求
    const later = !!(b.award || b.start || C.ORDER.some(k => d[k]));
    if (!later) {
      if (!p.title) return step("填寫案名", "從技術服務契約開始建立這個工程", "proj", "#f-title");
      if (!phases.length) return step("選擇委託階段", "規劃、設計、監造", "proj", "[data-tog=design]");
      if (!p.method) return step("選擇計價方式", "並可用服務費參考試算", "proj", "#f-method");
      if (!p.vendor) {
        if (!docs.tender) return step("下載招標版契約", "作為招標文件附件；決標後再填乙方與金額", "proj", "#dl", { stage: "tender" });
        return step("決標後：填乙方（得標廠商）", "接著填服務費並下載簽約版", "proj", "#f-vendor");
      }
      if (p.method !== "建造費用百分比法" && !num(p.fee)) return step("填服務費金額", "決標金額", "proj", "#f-fee");
      if (!docs.sign) return step("下載簽約版契約", "用印簽約", "proj", "#dl", { stage: "sign" });
      // 2. 技術服務履約
      if (!t.sign) return step("填簽約日", "簽約後填寫", "tech", "#tt-sign");
      if (!t.start) return step("填甲方書面通知開始日", "服務實施計畫書、設計成果的期限由此起算", "tech", "#tt-start");
      if (!b.award && !b.start) {
        const open = ev.tech.filter(r => r.open).sort((a, c) => (a.due || "9").localeCompare(c.due || "9"));
        if (open.length) {
          const r = open[0], mine = /學校/.test(r.who);
          return step((mine ? "學校待辦：" : "等候乙方：") + r.item, withDue(r, mine ? "" : "可用 LINE 提醒") + "；完成後填完成日期", "tech", `[data-ph=tech][data-key="${r.key}"][data-f=d]`, { due: r.due, left: r.left });
        }
        return step("工程發包：決標後填施工廠商", "設計成果已完成", "build", "#bf-name");
      }
    }
    // 3. 施工
    if (!b.name) return step("填施工廠商全銜", "", "build", "#bf-name");
    if (!num(b.amount)) return step("填工程契約金額", "", "build", "#bf-amount");
    if (!num(b.budget)) return step("填工程預算金額", "用來自動判斷是否須初驗、是否達查核金額", "build", "#bf-budget");
    if (!b.due && (!b.start || !num(b.days))) return step(!b.start ? "填開工日" : "填工期", "自動算出預定竣工日", "build", !b.start ? "#bf-start" : "#bf-days");
    // 4. 竣工驗收至保固：依序填關鍵日期
    const m = C.money({ budget: b.budget, amount: b.amount, preTh: school.preTh, auditTh: school.auditTh });
    const needPre = m.pre === true || !!d.pre;
    const seq = [
      ["report", "施工中：廠商報竣後，填「機關收受竣工報告日」", R(0), "預定竣工 " + roc(ev.plan.date)],
      ["verify", "會同查證竣工，填「會同查證屬實日」", R(3), "收受竣工報告日起7日內"],
      ["actual", "填「實際竣工日」（查證確認廠商實際完工的日期）", R(3), "竣工文件期限、結算驗收證明書都以這天為準"],
      ["docs", "收到竣工文件後，填「機關收受竣工文件日」", R(6), "廠商應於竣工次日起15日內提送"],
    ].concat(needPre ? [["pre", "辦理初驗，合格後填「初驗合格日」", R(13), `預算逾 ${C.money({ preTh: school.preTh }).preTh.toLocaleString("en-US")} 元須先初驗`]] : [])
      .concat([
        ["accept", "辦理驗收，合格後填「驗收合格日」", needPre ? R(14) : R(13), ""],
        ["cert", "填製並核定結算驗收證明書，填「核定日」", R(19), "驗收合格後15日內"],
        ["paid", "簽請付款，付款後填「尾款付款日」", R(25), "結算驗收證明書核定後30日內"],
      ]);
    // 已填較後面的日期，前面的就不再要求補填
    const after = i => seq.slice(i + 1).some(x => d[x[0]]) || !!d.wcheck || !!d.refund;
    for (let i = 0; i < seq.length; i++) {
      const [k, title, r, hint] = seq[i];
      if (d[k] || after(i)) continue;
      if ((k === "cert" || k === "paid") && !num(d.years)) return step("驗收合格：填保固期（年）", "保固期自驗收合格日起算，依工程契約約定；填了才算得出保固期滿日", "chk", "#cd-years");
      return step(title, k === "report" ? (ev.plan.date ? hint : "尚未設定預定竣工日") : withDue(r, hint), "chk", "#cd-" + k, { due: r.due, left: r.open ? r.left : null });
    }
    const manual = rows.filter(r => r.open && r.stage === 4);
    if (manual.length) return step("付款後：" + manual.map(r => r.item.replace(/^付款後/, "")).join("、"), "完成後在清單把狀態改為已完成", "chk", `[data-ph=accept][data-key="${manual[0].i}"][data-f=s]`);
    if (!num(d.years) && !d.wcheck && !d.refund) return step("填保固期（年）", "自動算出保固期滿日", "chk", "#cd-years");
    if (!d.wcheck && !d.refund) return step("保固中：期滿前會勘", withDue(R(31), "保固期間有瑕疵，請在清單改狀態"), "chk", "#cd-wcheck", { due: R(31).due, left: R(31).left });
    if (!d.refund) return step("發還保固保證金，填「發還日」", "", "chk", "#cd-refund");
    const rest = ev.tech.concat(rows).filter(r => r.open);
    if (rest.length) return step("完成剩餘項目：" + rest[0].item, "", rest[0].phase === "tech" ? "tech" : "chk", `[data-ph=${rest[0].phase}][data-key="${rest[0].key}"][data-f=s]`);
    return step("本案已結案", "所有項目都已完成", "chk", "");
  }

  // ---------- 通知 ----------
  function contacts(p) {
    const b = p.build || {}, techName = p.vendorLine || p.vendor || "";
    return { "技服廠商": techName, "監造": p.super === "是" ? techName : (b.supervisor || ""), "廠商": b.line || b.name || "" };
  }
  const tokens = who => String(who || "").split("／");
  const notifiable = r => r.open && tokens(r.who).some(w => w === "廠商" || w === "監造" || w === "技服廠商");
  function message(p, r, party) {
    const ct = contacts(p), to = [];
    tokens(r.who).forEach(w => { if (ct[w] && !to.includes(ct[w])) to.push(ct[w]); });
    const name = p.title || p.name || "本工程";
    let t = (to.length ? to.join("、") + " 您好：\n" : "") + "〔" + (party || "學校") + "〕" + name + "\n";
    t += "提醒辦理：" + r.item.replace(/。$/, "");
    if (r.due) t += "\n期限：" + C.roc(r.due) + (r.when ? "（" + r.when + "）" : "") + (r.left !== null && r.left < 0 ? "，已逾期 " + (-r.left) + " 天" : r.left !== null ? "，尚餘 " + r.left + " 天" : "");
    else if (r.when) t += "\n時點：" + r.when;
    if (r.files && r.files.length && /空白表/.test(r.files[0].name)) t += "\n請使用表單：" + r.files[0].name;
    return t + "\n請協助辦理，謝謝。";
  }
  const lineUrl = text => "https://line.me/R/share?text=" + encodeURIComponent(text);
  function store(p, r) {
    if (r.phase === "tech") { p.tech = p.tech || {}; p.tech.ms = p.tech.ms || {}; return (p.tech.ms[r.key] = p.tech.ms[r.key] || {}); }
    p.chk = p.chk || {}; p.chk.items = p.chk.items || {}; return (p.chk.items[r.key] = p.chk.items[r.key] || {});
  }
  function upcoming(projects, school, now) {
    now = now || C.today(); const out = [];
    Object.keys(projects).forEach(id => {
      const p = projects[id], ev = evaluate(p, school, now);
      ev.tech.concat(ev.accept.rows).forEach(r => {
        if (!notifiable(r) || r.left === null || r.left > 7) return;
        if (r.nt && C.daysBetween(r.nt, now) < 3) return;
        out.push({ id, p, r });
      });
    });
    return out.sort((a, b) => a.r.left - b.r.left);
  }
  // 舊資料轉換：檢核表聯絡人、預定竣工日移到施工
  function normalize(p) {
    p.tech = p.tech || {}; p.build = p.build || {};
    const c = (p.chk && p.chk.contacts) || null;
    if (c) { if (c.builder && !p.build.line) p.build.line = c.builder; if (c.supervisor && !p.build.supervisor) p.build.supervisor = c.supervisor; delete p.chk.contacts; }
    if (p.chk && p.chk.dates && p.chk.dates.plan) { if (!p.build.due) p.build.due = p.chk.dates.plan; delete p.chk.dates.plan; }
    // v2：狀態改為「自動」判斷。舊版存下的「未辦」與未填相同，轉為自動，日期才能帶出完成狀態
    if (!(p.v >= 2)) {
      [p.tech.ms, p.chk && p.chk.items].forEach(box => Object.values(box || {}).forEach(it => { if (it && it.s === "未辦") delete it.s; }));
      p.v = 2;
    }
    return p;
  }

  // ---------- 共用日曆：每個未完成、有期限的事項一個全天活動 ----------
  const CAL_TITLE = {
    "tech-T1": "技服廠商提送服務實施計畫書", "tech-T2": "審查服務實施計畫書", "tech-T3": "技服廠商提送勞工名冊",
    "tech-T4": "技服廠商提報技師簽證計畫", "tech-T5": "技服廠商交付設計成果", "tech-T6": "審查設計成果",
    "acc-0": "預定竣工・廠商應報竣", "acc-3": "會同查證竣工", "acc-5": "監造提送竣工查驗紀錄", "acc-6": "廠商提送竣工文件",
    "acc-14": "辦理驗收", "acc-19": "結算驗收證明書陳核", "acc-25": "簽請付款（尾款）", "acc-28": "登錄保固期間", "acc-31": "保固期滿前會勘",
  };
  function calendarEvents(p, school, link, now) {
    const ev = evaluate(p, school, now), name = p.name || p.title || "未命名工程", out = [];
    const short = s => { s = String(s || "").replace(/（[^）]*）/g, "").replace(/[。：]$/, "").trim(); return s.length > 22 ? s.slice(0, 21) + "…" : s; };
    const whoTxt = w => String(w || "").replace("技服廠商", "技術服務廠商");
    const title = (key, r) => key === "acc-13" ? ((ev.accept.rows[14] || {}).s === "不適用" ? "辦理驗收" : "辦理初驗")
      : CAL_TITLE[key] || short(r.item) + (/學校/.test(r.who || "") ? "" : "〔" + whoTxt(r.who) + "〕");
    const tail = (link ? "\n開啟網站：" + link : "") + "\n（由「工程契約與驗收管理」自動產生；請在網站修改，直接改日曆會被覆蓋）";
    const add = (key, r, lines) => out.push({ key, date: r.due, title: name + "｜" + title(key, r), short: title(key, r), who: whoTxt(r.who), desc: ["事項：" + r.item, "主辦：" + whoTxt(r.who), "期限：" + C.roc(r.due) + (r.when ? "（" + r.when + "）" : "")].concat(lines).filter(Boolean).join("\n") + tail });
    ev.tech.filter(r => r.open && r.due).forEach(r => add("tech-" + r.key, r, ["階段：技術服務履約"]));
    ev.accept.rows.filter(r => r.open && r.due).forEach(r => add("acc-" + r.key, r, ["階段：竣工驗收至保固・" + C.STAGES[r.stage], r.key === 0 && ev.plan.how ? "預定竣工日：" + ev.plan.how : ""]));
    return out;
  }

  // ---------- 修改紀錄：比對暫存前後，列出改了哪些欄位 ----------
  const BUILD_LABEL = { title: "工程名稱（施工契約）", name: "施工廠商", line: "施工廠商 LINE 稱呼", budget: "工程預算金額", amount: "工程契約金額", award: "決標／簽約日",
    start: "開工日", days: "工期（天）", unit: "工期計算", due: "預定竣工日（手動）", supervisor: "監造單位" };
  const EXT_LABEL = { d: "核定日期", days: "天數", doc: "文號／事由" }, F_LABEL = { s: "狀態", d: "完成日期", n: "備註", nt: "LINE 通知日" };
  const TECH_LABEL = { sign: "簽約日", start: "通知開始日", daysUnit: "交付期限計算" };
  function flat(o, pre, out) {
    if (o === null || o === undefined) return out;
    if (typeof o !== "object") { out[pre] = String(o); return out; }
    Object.keys(o).forEach(k => flat(o[k], pre ? pre + "." + k : k, out));
    return out;
  }
  const cut = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  function fieldLabel(path) {
    const k = path.split("."), E = G.ContractEngine;
    if (k.length === 1) { const f = E && E.PROJECT_FIELDS.find(x => x.k === k[0]); return f ? "技術服務契約・" + f.label : k[0] === "vendorLine" ? "技術服務廠商 LINE 稱呼" : path; }
    if (k[0] === "tech" && k[1] === "ms") { const t = TECH.find(r => r[0] === k[2]); return `技術服務 ${k[2]}「${cut(t ? t[1] : "", 14)}」・${F_LABEL[k[3]] || k[3]}`; }
    if (k[0] === "tech") return "技術服務・" + (TECH_LABEL[k[1]] || k[1]);
    if (k[0] === "build" && k[1] === "ext") return `施工・展延第 ${+k[2] + 1} 筆・${EXT_LABEL[k[3]] || k[3]}`;
    if (k[0] === "build") return "施工・" + (BUILD_LABEL[k[1]] || k[1]);
    if (k[0] === "chk" && k[1] === "dates") { const d = C.DATES.find(x => x[0] === k[2]); return "竣工驗收・" + (d ? d[1] : k[2]); }
    if (k[0] === "chk" && k[1] === "items") { const it = C.ITEMS[+k[2]]; return `竣工驗收 項${+k[2] + 1}「${cut(it ? it[1] : "", 14)}」・${F_LABEL[k[3]] || k[3]}`; }
    if (k[0] === "adv") return "契約進階欄位 " + k[1];
    if (k[0] === "docs") return k[1] === "tender" ? "下載招標版契約" : k[1] === "sign" ? "下載簽約版契約" : path;
    if (k[0] === "gov") { const d = G.GovDocs && G.GovDocs.DOCS.find(x => x.id === k[1]); const f = d ? d.fields({ d: {}, pre: false }).find(x => x[0] === k[2]) : null; return `簽稿「${d ? d.label : k[1]}」・${f ? f[1] : k[2]}`; }
    return path;
  }
  function fileKeyLabel(key) {
    const m = /^(tech|acc)-(.+)$/.exec(key); if (!m) return key;
    if (m[1] === "tech") return "技術服務 " + m[2];
    return "竣工驗收 項" + (+m[2] + 1) + (C.DOCS[+m[2]] ? "「" + C.DOCS[+m[2]] + "」" : "");
  }
  function changeList(oldStr, p) {
    let old = {}; try { old = JSON.parse(oldStr || "{}"); } catch (e) { old = {}; }
    const skip = /^(updatedAt|updatedBy|id|changes|v|folder)$|^files(\.|$)/;
    const show = (v, money) => v === undefined ? "" : /^\d{4}-\d{2}-\d{2}$/.test(v) ? C.roc(v) : money && /^[1-9]\d{3,}$/.test(v) ? Number(v).toLocaleString("en-US") : cut(v, 200);
    const a = flat(old, "", {}), b = flat(p, "", {}), out = [];
    Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).forEach(k => {
      if (skip.test(k) || (a[k] || "") === (b[k] || "")) return;
      const label = fieldLabel(k), money = /金額|（元）|費/.test(label);
      out.push([label, show(a[k], money), show(b[k], money)]);
    });
    const fa = old.files || {}, fb = p.files || {};
    Object.keys(fb).forEach(key => {
      const had = new Set((fa[key] || []).map(f => f.id));
      (fb[key] || []).filter(f => !had.has(f.id)).forEach(f => out.push(["上傳檔案・" + fileKeyLabel(key), "", f.name]));
    });
    return out.slice(0, 200);
  }

  // ---------- 工程報表（匯出 Excel） ----------
  function reportSheets(projects, school, now) {
    now = now || C.today();
    const n = v => { const x = Number(String(v == null ? "" : v).replace(/,/g, "")); return x || ""; };
    const stamp = iso => { const d = new Date(iso); return isNaN(d) ? "" : `${d.getFullYear() - 1911}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
    const list = Object.keys(projects).map(id => ({ id, p: projects[id], ev: evaluate(projects[id], school, now) }))
      .sort((a, b) => (b.ev.overdue > 0) - (a.ev.overdue > 0) || (a.ev.next ? a.ev.next.due : "9").localeCompare(b.ev.next ? b.ev.next.due : "9"));
    const s1 = { name: "工程總表", cols: [
      { title: "工程簡稱", width: 16 }, { title: "案名", width: 30 }, { title: "目前階段", width: 22 }, { title: "完成率", width: 8, type: "pct" },
      { title: "下一步", width: 34 }, { title: "最近期限", width: 11 }, { title: "剩餘天數", width: 9, type: "int" }, { title: "逾期項數", width: 9, type: "int" },
      { title: "技術服務廠商", width: 22 }, { title: "服務費（元）", width: 14, type: "money" }, { title: "施工廠商", width: 22 },
      { title: "工程預算（元）", width: 15, type: "money" }, { title: "工程契約金額（元）", width: 17, type: "money" },
      { title: "開工日", width: 11 }, { title: "預定竣工日", width: 11 }, { title: "驗收合格日", width: 11 }, { title: "保固期滿日", width: 11 }, { title: "最後修改", width: 22 }],
      rows: list.map(({ p, ev }) => {
        const b = p.build || {}, d = ((p.chk || {}).dates) || {}, tot = ev.techTotal + ev.accept.total, done = ev.techDone + ev.accept.done;
        return [p.name || "", p.title || "", ev.label, tot ? done / tot : 0, ev.step.title, ev.next ? C.roc(ev.next.due) : "", ev.next ? ev.next.left : "", ev.overdue,
          p.vendor || "", n(p.fee), b.name || "", n(b.budget), n(b.amount), b.start ? C.roc(b.start) : "", ev.plan.date ? C.roc(ev.plan.date) : "",
          d.accept ? C.roc(d.accept) : "", (ev.accept.rows[31] || {}).due ? C.roc(ev.accept.rows[31].due) : "", (p.updatedBy ? p.updatedBy + " " : "") + stamp(p.updatedAt)];
      }), red: r => r[7] > 0 };
    const items = [];
    list.forEach(({ p, ev }) => {
      ev.tech.filter(r => r.open && r.due).forEach(r => items.push([r.due, r.left, p.name || p.title || "", "技術服務履約", r.item, r.who.replace("技服廠商", "技術服務廠商"), r.auto ? "自動：" + r.autoS : r.s]));
      ev.accept.rows.filter(r => r.open && r.due).forEach(r => items.push([r.due, r.left, p.name || p.title || "", "竣工驗收・" + C.STAGES[r.stage], r.item, r.who, r.auto ? "自動：" + r.autoS : r.s]));
    });
    items.sort((a, b) => a[0].localeCompare(b[0]));
    const s2 = { name: "期限明細", cols: [{ title: "期限", width: 11 }, { title: "剩餘天數", width: 9, type: "int" }, { title: "工程", width: 16 }, { title: "階段", width: 22 },
      { title: "事項", width: 56 }, { title: "主辦", width: 16 }, { title: "狀態", width: 12 }],
      rows: items.map(r => [C.roc(r[0])].concat(r.slice(1))), red: r => typeof r[1] === "number" && r[1] < 0 };
    return [s1, s2];
  }

  G.Lifecycle = { changeList, fieldLabel, reportSheets, calendarEvents, nextStep, makeCal, countDays, evaluate, plannedCompletion, extTotal, contacts, notifiable, message, lineUrl, store, upcoming, normalize, TECH };
})(typeof globalThis !== "undefined" ? globalThis : this);
