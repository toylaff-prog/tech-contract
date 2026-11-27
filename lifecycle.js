/* 工程生命週期：技術服務 → 施工 → 竣工驗收至保固
   期限計算依契約範本第7條：
   - 工作天：不計週六、週日及放假日（學校設定可列放假日、補行上班日）
   - 「自指定之日起算」：當日算入；「收到／簽約後N日」：次日起算
   - 日曆天：末日遇放假日，順延至次一辦公日 */
(function (G) {
  "use strict";
  const NF_ = new Intl.NumberFormat("en-US"); // 共用一個數字格式器（每次建立很慢）
  const C = G.Checklist;
  const pd = C.pd; // 嚴格日期（2026-02-30 這類無效日期回傳 null）
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const num = v => {
    const n = parseFloat(String(v ?? "").replace(/,/g, ""));
    return isFinite(n) ? n : 0;
  };
  const dates = txt => String(txt || "").match(/\d{4}-\d{2}-\d{2}/g) || [];

  function makeCal(school) {
    school = school || {};
    const offList = dates(school.holidays).filter(x => pd(x)),
      off = new Set(offList),
      on = new Set(dates(school.makeups));
    // 已維護假日資料的年度：學校設定「已維護假日資料年度」所列、且該年至少有一個放假日
    const listed =
      school.calendarYears === undefined ? offList.map(x => x.slice(0, 4)) : String(school.calendarYears).match(/\b\d{4}\b/g) || [];
    const years = new Set(listed.filter(y => offList.some(x => x.startsWith(y + "-"))));
    return {
      isOff(d) {
        const k = iso(d);
        if (on.has(k)) return false;
        const w = d.getDay();
        return w === 0 || w === 6 || off.has(k);
      },
      /** 由 a 推算到 b 的期間，若跨入沒有維護假日資料的年度，回傳提醒文字（只提醒，不擋操作） */
      coverNote(a, b) {
        if (!pd(a) || !pd(b)) return "";
        const miss = [];
        for (let y = +String(a).slice(0, 4); y <= +String(b).slice(0, 4) && miss.length < 10; y++) if (!years.has(String(y))) miss.push(y);
        return miss.length ? `假日資料未涵蓋 ${miss.join("、")} 年，日期為試算` : "";
      },
    };
  }
  // 由 base 起算 n 日（unit：工作天／日曆天；inclusive：當日是否算入；roll：日曆天末日遇假日是否順延）
  function countDays(base, n, unit, inclusive, cal, roll = true) {
    const d0 = pd(base);
    n = Number(String(n ?? "").replace(/,/g, ""));
    if (!d0 || !Number.isInteger(n) || n < 0 || n > 4000) return "";
    const d = new Date(d0);
    if (n === 0) return iso(d);
    if (!inclusive) d.setDate(d.getDate() + 1);
    if (unit === "工作天") {
      let c = 0;
      for (let g = 0; g < 4000; g++) {
        if (!cal.isOff(d)) {
          c++;
          if (c >= n) return iso(d);
        }
        d.setDate(d.getDate() + 1);
      }
      return "";
    }
    d.setDate(d.getDate() + n - 1);
    for (let g = 0; roll && g < 60 && cal.isOff(d); g++) d.setDate(d.getDate() + 1);
    return iso(d);
  }

  // ---------- 一、技術服務履約期程 ----------
  // [id, 事項, 基準日, 日數來源, 當日算入, 主辦, 契約依據, 備註, 適用條件]
  const TECH = [
    ["T1", "提出「服務實施計畫書」送甲方核可", "start", "planSubmit", true, "技服廠商", "第8條(一)", "", null],
    ["T2", "審查服務實施計畫書", "T1", "planReview", false, "學校", "第8條(一)", "", null],
    [
      "T3",
      "檢具派駐甲方處所勞工名冊",
      "sign",
      "roster",
      false,
      "技服廠商",
      "第8條",
      "本案契約未填日數者不列入",
      (s, p, cd) => cd.n("roster") > 0,
    ],
    ["T4", "提報技師簽證執行計畫", "start", "certPlan", true, "技服廠商", "第8條", "", null],
    ["T5", "交付規劃／設計成果", "start", "days", true, "技服廠商", "第7條(一)", "", (s, p) => p.plan === "是" || p.design === "是"],
    [
      "T6",
      "審查各階段書面資料（設計成果）",
      "T5",
      "stageReview",
      false,
      "學校",
      "第8條",
      "逾期未審視同甲方接受",
      (s, p) => p.plan === "是" || p.design === "是",
    ],
  ];
  const BASE_LABEL = { start: "甲方通知指定之日", sign: "簽約日", T1: "收到服務實施計畫書", T5: "收到設計成果" };
  function techAuto(id, p) {
    const b = p.build || {},
      ms = (p.tech || {}).ms || {};
    if (b.award || b.start) return ["已完成", "工程已發包，設計階段推定完成"];
    if (["build", "chk", "warranty"].includes(p.entryStage)) return ["已完成", "中途建檔：設計階段推定已完成"];
    if (id === "T1" && ms.T2 && ms.T2.d) return ["已完成", "已審查，推定已提出"];
    if (id === "T5" && ms.T6 && ms.T6.d) return ["已完成", "已審查，推定已交付"];
    return ["未辦", ""];
  }
  // 期限日數取自本案契約最後的數值（學校設定＋本案進階覆寫），沒填就用範本「未載明者」的規定
  const SRC_ID = { planSubmit: "F046", planReview: "F047", stageReview: "F048", roster: "F049", certPlan: "F052", days: "F040" };
  function contractDays(p, school) {
    const E = G.ContractEngine;
    if (!E) return { unit: school.daytype === "日曆天" ? "日曆天" : "工作天", n: k => (k === "days" ? num(p.days) : num(school[k])) };
    // 已鎖定正式簽約內容快照：以鎖定時的契約內容為準，之後改學校設定或範本不影響本案；
    // 但本案自己改的欄位（每案欄位、進階覆寫）視為本案契約的更正，照樣套用
    const sn = p.snap && p.snap.sign && p.snap.sign.locked === true && p.snap.sign.values,
      cur = E.computeValues(p, school, "sign"),
      dft = {};
    let v = cur.values;
    if (sn) {
      v = Object.assign({}, sn);
      Object.keys(cur.values).forEach(k => {
        if (cur.source[k] === "project" || cur.source[k] === "adv") v[k] = cur.values[k];
      });
    }
    E.FIXED.forEach(f => {
      dft[f[1]] = f[3];
    });
    return { unit: E.isChecked(v.F045) ? "日曆天" : "工作天", n: k => num(v[SRC_ID[k]]) || (k === "days" ? 0 : num(dft[k])) };
  }
  // 技術服務適用性：self＝學校自辦、none＝無委託；這兩種沒有技術服務履約期程
  const noTech = p => p.techScope === "self" || p.techScope === "none";
  function techRows(p, school, cal, now) {
    if (noTech(p)) return [];
    const t = p.tech || {},
      ms = t.ms || {},
      cd = contractDays(p, school),
      unit = cd.unit;
    // 是否列入、日數、單位都用同一組「本案契約」數值（學校設定＋本案進階覆寫）
    return TECH.filter(r => !r[8] || r[8](school, p, cd)).map(([id, item, base, src, incl, who, basis, note]) => {
      const n = cd.n(src);
      // 審查期限從「學校收件日」起算；只填了廠商提出日時暫以提出日計算
      const b = ms[base] || {},
        baseDate = base === "start" ? t.start : base === "sign" ? t.sign : b.r || b.d || "";
      const proxy = (base === "T1" || base === "T5") && !b.r && b.d;
      const du = src === "days" ? t.daysUnit || unit : unit;
      const due = baseDate && n ? countDays(baseDate, n, du, incl, cal) : "";
      const st = ms[id] || {},
        [aS, aNote] = techAuto(id, p),
        s = st.s || aS,
        open = s !== "已完成" && s !== "不適用";
      const trial = due ? cal.coverNote(baseDate, due) : "";
      const when =
        (n ? `${BASE_LABEL[base]}${incl ? "起" : "後"} ${n} ${du}內` : "（契約未載明日數）") +
        (proxy ? "（未填學校收件日，暫以廠商提出日計算）" : "") +
        (note ? "；" + note : "") +
        (trial ? "；" + trial : "");
      return {
        key: id,
        phase: "tech",
        item,
        when,
        basis,
        who,
        due,
        s,
        auto: !st.s,
        autoS: aS,
        autoNote: st.s ? "" : aNote,
        autoD: "",
        d: st.d || "",
        r: st.r || "",
        recv: id === "T1" || id === "T5",
        note: st.n || "",
        nt: st.nt || "",
        open,
        trial,
        left: open && due ? C.daysBetween(now, due) : null,
        files: [],
      };
    });
  }

  // ---------- 二、施工 ----------
  function extTotal(b) {
    return (b.ext || []).reduce((a, e) => a + num(e.days), 0);
  }
  /** 停復工：只保留有填任何一欄的列（空白列自動忽略） */
  function stopRows(b) {
    return (Array.isArray(b.stops) ? b.stops : []).filter(x => x && ["s", "e", "doc", "days"].some(k => String(x[k] ?? "").trim()));
  }
  const isInt = v => /^\d+$/.test(String(v ?? "").trim());
  /** 預定竣工日：開工日＋工期＋展延＋已復工且核定淨增的停工日數
      停工日早於竣工期限、尚未復工：halted＝true（原期限待核對，不列入正式逾期） */
  function plannedCompletion(p, cal) {
    const b = p.build || {},
      unit = b.unit === "工作天" ? "工作天" : "日曆天",
      roll = b.rollHoliday !== "不順延",
      ext = extTotal(b),
      stops = stopRows(b),
      issues = [];
    let add = 0;
    stops.forEach((x, i) => {
      if (!C.valid(x.e) || x.mode !== "淨增") return;
      if (isInt(x.days)) add += +x.days;
      else issues.push(`停工第 ${i + 1} 筆的核定淨增天數須為整數`);
    });
    let date = "",
      how = "";
    if (b.due) {
      date = C.valid(b.due) ? b.due : "";
      how = date ? "手動輸入" + (add ? "（停工核定淨增天數請自行計入）" : "") : "手動輸入的日期無效，請核對";
    } else if (b.start && num(b.days)) {
      date = countDays(b.start, num(b.days) + ext + add, unit, true, cal, roll);
      const tail = unit === "日曆天" ? (roll ? "；末日遇假日順延" : "；末日遇假日不順延") : "";
      how = `開工日起 ${num(b.days)}${ext ? "＋展延 " + ext : ""}${add ? "＋停工核定淨增 " + add : ""} ${unit}（含開工當日${tail}）`;
      if (!date) how = "工期或展延天數須為整數，請核對";
      const trial = date && (unit === "工作天" || roll) ? cal.coverNote(b.start, date) : "";
      if (trial) how += "；" + trial;
    }
    // 停工中：停工日早於目前竣工期限、還沒有復工日
    const halt = stops.find(x => C.valid(x.s) && !C.valid(x.e) && date && x.s < date);
    if (issues.length) how += "；【請核對】" + issues.join("；");
    return { date, how, stopDays: add, halted: !!halt, haltFrom: halt ? halt.s : "" };
  }

  // ---------- 三、竣工驗收至保固（沿用 checklist.js） ----------
  function acceptRows(p, cal, now, plan, school) {
    const b = p.build || {};
    const ev = C.evaluate(p.chk, now, {
      plan: plan.date,
      planHold: plan.halted,
      entry: p.entryStage || "",
      cal,
      countDays,
      budget: b.budget,
      amount: b.amount,
      preTh: school.preTh,
      auditTh: school.auditTh,
    });
    ev.rows.forEach(r => {
      r.key = r.i;
      r.phase = "accept";
      r.nt = (((p.chk || {}).items || {})[r.i] || {}).nt || "";
    });
    return ev;
  }

  // ---------- 整合 ----------
  function evaluate(p, school, now) {
    p = p || {};
    school = school || {};
    now = now || C.today();
    const cal = makeCal(school),
      plan = plannedCompletion(p, cal);
    const tech = techRows(p, school, cal, now),
      acc = acceptRows(p, cal, now, plan, school);
    const t = p.tech || {},
      b = p.build || {};
    const techDone = tech.filter(r => r.s === "已完成").length,
      techTotal = tech.filter(r => r.s !== "不適用").length;
    const all = tech.concat(acc.rows),
      open = all.filter(r => r.open && r.due);
    const overdue = open.filter(r => r.left < 0 && !r.hold).length;
    const next = open.slice().sort((a, b2) => a.due.localeCompare(b2.due))[0] || null;
    const accStarted = acc.started;
    let phase, label;
    if (accStarted) {
      phase = "accept";
      label = acc.stage >= C.STAGES.length ? "結案" : acc.stage === 5 ? "保固中" : "驗收：" + C.STAGES[acc.stage];
    } else if (b.start) {
      phase = "build";
      label = plan.halted ? "停工中（原期限待核對）" : "施工中" + (plan.date ? "（預定竣工 " + C.roc(plan.date) + "）" : "");
    } else if (b.award) {
      phase = "build";
      label = "工程已決標，待開工";
    } else if (t.sign || t.start) {
      phase = "tech";
      label = "技術服務履約中";
    } else {
      // 中途建檔：依新增工程時選的起始階段顯示，不要求回頭補填前面的契約欄位
      const ENTRY = {
        tech: ["tech", "技術服務履約（待填簽約日）"],
        build: ["build", "施工管理（待填開工日）"],
        chk: ["accept", "竣工驗收（待填報竣日期）"],
        warranty: ["accept", "保固追蹤（待填驗收合格日）"],
      };
      [phase, label] = ENTRY[p.entryStage] || ["prep", "契約準備中"];
    }
    const mid = ["build", "chk", "warranty"].includes(p.entryStage);
    const techStatus = noTech(p)
      ? p.techScope === "self"
        ? "學校自辦（無技術服務契約）"
        : "無委託技術服務"
      : t.sign || t.start
        ? techTotal && techDone === techTotal
          ? "履約事項完成"
          : `履約中 ${techDone}/${techTotal}`
        : mid
          ? "中途建檔，不需補填"
          : "尚未簽約";
    const buildStatus = b.start
      ? plan.halted
        ? "停工中"
        : ((p.chk || {}).dates || {}).report
          ? "已報竣"
          : "施工中"
      : b.award
        ? "已決標，待開工"
        : p.entryStage === "chk" || p.entryStage === "warranty"
          ? "中途建檔，不需補填"
          : "尚未發包";
    const steps = [
      { key: "tech", name: "技術服務", status: techStatus },
      { key: "build", name: "施工", status: buildStatus, sub: plan.date ? "預定竣工 " + C.roc(plan.date) : "" },
      {
        key: "accept",
        name: "竣工驗收至保固",
        status: accStarted ? (acc.stage >= C.STAGES.length ? "結案" : C.STAGES[acc.stage]) : "尚未報竣",
        sub: accStarted ? acc.pct + "%" : "",
      },
    ];
    const out = { phase, label, steps, tech, techDone, techTotal, accept: acc, plan, overdue, next, cal };
    out.step = nextStep(p, school, out);
    return out;
  }

  // ---------- 下一步 ----------
  function nextStep(p, school, ev) {
    const t = p.tech || {},
      b = p.build || {},
      d = (p.chk || {}).dates || {},
      docs = p.docs || {};
    const roc = C.roc,
      rows = ev.accept.rows,
      R = i => rows[i] || {};
    const step = (title, detail, sub, sel, extra) => Object.assign({ title, detail: detail || "", go: { sub, sel } }, extra || {});
    const withDue = (r, txt) => (r && r.due ? (txt ? txt + "；" : "") + "期限 " + roc(r.due) : txt || "");
    // 0. 使用者標為「辦理中」的事項優先
    const doing = ev.tech.concat(rows).find(r => !r.auto && r.s === "辦理中");
    if (doing)
      return step(
        "處理中：" + doing.item,
        withDue(doing),
        doing.phase === "tech" ? "tech" : "chk",
        `[data-ph=${doing.phase}][data-key="${doing.key}"][data-f=s]`,
        { due: doing.due, left: doing.left }
      );
    const phases = ["plan", "design", "super"].filter(k => p[k] === "是");
    const entry = p.entryStage || "";
    // 停工中：先處理復工（原竣工期限待核對）
    if (ev.plan.halted && !C.valid(d.report)) {
      const i = (b.stops || []).findIndex(x => x && C.valid(x.s) && !C.valid(x.e));
      return step("停工中：復工後填復工日", `自 ${roc(ev.plan.haltFrom)} 停工，原竣工期限待核對`, "build", `#st-e-${i}`);
    }
    // 1～2. 技術服務契約與履約；工程已發包或已進入驗收、中途建檔、或無委託技術服務，就不再回頭要求
    const later = !!(b.award || b.start || C.ORDER.some(k => C.valid(d[k])) || ["build", "chk", "warranty"].includes(entry) || noTech(p));
    // 保固追蹤才建檔：只需要驗收合格日、保固期，接著會勘與發還
    if (entry === "warranty" && !C.valid(d.accept))
      return step("登錄驗收合格日（保固起算日）", "中途建檔：前面的施工、驗收事項不需補填", "chk", "#cd-accept");
    if (!later && entry === "tech") {
      if (!t.sign) return step("填簽約日", "中途建檔：技術服務契約已簽好，不需重新產生 Word", "tech", "#tt-sign");
    } else if (!later) {
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
          const r = open[0],
            mine = /學校/.test(r.who);
          return step(
            (mine ? "學校待辦：" : "等候乙方：") + r.item,
            withDue(r, mine ? "" : "可用 LINE 提醒") + "；完成後填完成日期",
            "tech",
            `[data-ph=tech][data-key="${r.key}"][data-f=d]`,
            { due: r.due, left: r.left }
          );
        }
        return step("工程發包：決標後填施工廠商", "設計成果已完成", "build", "#bf-name");
      }
    }
    if (!later && entry === "tech") {
      if (!t.start) return step("填甲方書面通知開始日", "服務實施計畫書、設計成果的期限由此起算", "tech", "#tt-start");
      const open = ev.tech.filter(r => r.open).sort((a, c) => (a.due || "9").localeCompare(c.due || "9"));
      if (open.length) {
        const r = open[0];
        return step("技術服務待辦：" + r.item, withDue(r), "tech", `[data-ph=tech][data-key="${r.key}"][data-f=d]`, {
          due: r.due,
          left: r.left,
        });
      }
      return step("工程發包：決標後填施工廠商", "技術服務履約事項已完成", "build", "#bf-name");
    }
    // 3. 施工（從竣工驗收或保固才建檔的工程不要求回頭補填施工資料）
    if (entry !== "chk" && entry !== "warranty") {
      if (!b.name) return step("填施工廠商全銜", "", "build", "#bf-name");
      if (!num(b.amount)) return step("填工程契約金額", "", "build", "#bf-amount");
      if (!num(b.budget)) return step("填工程預算金額", "用來建議是否須初驗、判斷是否達查核金額", "build", "#bf-budget");
      if (!b.due && (!b.start || !num(b.days)))
        return step(!b.start ? "填開工日" : "填工期", "自動算出預定竣工日", "build", !b.start ? "#bf-start" : "#bf-days");
    }
    // 4. 竣工驗收至保固：依序填關鍵日期
    const m = C.money({
      budget: b.budget,
      amount: b.amount,
      preTh: school.preTh,
      auditTh: school.auditTh,
      preMode: (p.chk || {}).preMode,
    });
    const needPre = m.pre === true || C.valid(d.pre);
    const seq = [
      ["report", "施工中：廠商報竣後，填「機關收受竣工報告日」", R(0), "預定竣工 " + roc(ev.plan.date)],
      ["verify", "會同查證竣工，填「會同查證屬實日」", R(3), "收受竣工報告日起7日內"],
      ["actual", "填「實際竣工日」（查證確認廠商實際完工的日期）", R(3), "竣工文件期限、結算驗收證明書都以這天為準"],
      ["docs", "收到竣工文件後，填「機關收受竣工文件日」", R(6), "廠商應於竣工次日起15日內提送"],
    ]
      .concat(
        needPre
          ? [["pre", "辦理初驗，合格後填「初驗合格日」", R(13), m.mode === "required" ? "個案選擇須初驗" : "依校內初驗建議門檻建議初驗"]]
          : []
      )
      .concat([
        ["accept", "辦理驗收，合格後填「驗收合格日」", needPre ? R(14) : R(13), ""],
        ["cert", "填製並核定結算驗收證明書，填「核定日」", R(19), "驗收合格後15日內"],
        ["paid", "簽請付款，付款後填「尾款付款日」", R(25), "結算驗收證明書核定後30日內"],
      ]);
    // 已填較後面的日期，前面的就不再要求補填；保固追蹤建檔的工程略過驗收前的日期
    const has = k => C.valid(d[k]);
    const after = i => seq.slice(i + 1).some(x => has(x[0])) || has("wcheck") || has("refund");
    for (let i = 0; i < seq.length && entry !== "warranty"; i++) {
      const [k, title, r, hint] = seq[i];
      if (has(k) || after(i)) continue;
      if ((k === "cert" || k === "paid") && !num(d.years))
        return step("驗收合格：填保固期（年）", "保固期自驗收合格日起算，依工程契約約定；填了才算得出保固期滿日", "chk", "#cd-years");
      return step(title, k === "report" ? (ev.plan.date ? hint : "尚未設定預定竣工日") : withDue(r, hint), "chk", "#cd-" + k, {
        due: r.due,
        left: r.open ? r.left : null,
      });
    }
    const manual = rows.filter(r => r.open && r.stage === 4);
    if (manual.length)
      return step(
        "付款後：" + manual.map(r => r.item.replace(/^付款後/, "")).join("、"),
        "完成後在清單把狀態改為已完成",
        "chk",
        `[data-ph=accept][data-key="${manual[0].i}"][data-f=s]`
      );
    if (!C.wholeMonths(d.years) && !has("wcheck") && !has("refund"))
      return step(
        "填保固期（年）",
        num(d.years) ? "保固年數須能換算為整月（例如 1、2、0.5 年），請核對" : "自動算出保固期滿日",
        "chk",
        "#cd-years"
      );
    if (!has("wcheck") && !has("refund"))
      return step("保固中：期滿前會勘", withDue(R(31), "保固期間有瑕疵，請在清單改狀態"), "chk", "#cd-wcheck", {
        due: R(31).due,
        left: R(31).left,
      });
    if (!has("refund")) return step("發還保固保證金，填「發還日」", "", "chk", "#cd-refund");
    const rest = ev.tech.concat(rows).filter(r => r.open);
    if (rest.length)
      return step(
        "完成剩餘項目：" + rest[0].item,
        "",
        rest[0].phase === "tech" ? "tech" : "chk",
        `[data-ph=${rest[0].phase}][data-key="${rest[0].key}"][data-f=s]`
      );
    return step("本案已結案", "所有項目都已完成", "chk", "");
  }

  // ---------- 通知 ----------
  function contacts(p) {
    const b = p.build || {},
      techName = p.vendorLine || p.vendor || "";
    return { 技服廠商: techName, 監造: p.super === "是" ? techName : b.supervisor || "", 廠商: b.line || b.name || "" };
  }
  const tokens = who => String(who || "").split("／");
  const notifiable = r => r.open && tokens(r.who).some(w => w === "廠商" || w === "監造" || w === "技服廠商");
  function message(p, r, party) {
    const ct = contacts(p),
      to = [];
    tokens(r.who).forEach(w => {
      if (ct[w] && !to.includes(ct[w])) to.push(ct[w]);
    });
    const name = p.title || p.name || "本工程";
    let t = (to.length ? to.join("、") + " 您好：\n" : "") + "〔" + (party || "學校") + "〕" + name + "\n";
    t += "提醒辦理：" + r.item.replace(/。$/, "");
    if (r.due)
      t +=
        "\n期限：" +
        C.roc(r.due) +
        (r.when ? "（" + r.when + "）" : "") +
        (r.hold
          ? "，停工中（原期限待核對）"
          : r.left !== null && r.left < 0
            ? "，已逾期 " + -r.left + " 天"
            : r.left !== null
              ? "，尚餘 " + r.left + " 天"
              : "");
    else if (r.when) t += "\n時點：" + r.when;
    if (r.files && r.files.length && /空白表/.test(r.files[0].name)) t += "\n請使用表單：" + r.files[0].name;
    return t + "\n請協助辦理，謝謝。";
  }
  const lineUrl = text => "https://line.me/R/share?text=" + encodeURIComponent(text);
  function store(p, r) {
    if (r.phase === "tech") {
      p.tech = p.tech || {};
      p.tech.ms = p.tech.ms || {};
      return (p.tech.ms[r.key] = p.tech.ms[r.key] || {});
    }
    p.chk = p.chk || {};
    p.chk.items = p.chk.items || {};
    return (p.chk.items[r.key] = p.chk.items[r.key] || {});
  }
  // evs：呼叫端已算好的各案評估結果（首頁共用，不必每案再算一次）
  function upcoming(projects, school, now, evs) {
    now = now || C.today();
    const out = [];
    Object.keys(projects).forEach(id => {
      const p = projects[id],
        ev = (evs && evs[id]) || evaluate(p, school, now);
      ev.tech.concat(ev.accept.rows).forEach(r => {
        if (!notifiable(r) || r.hold || r.left === null || r.left > 7) return;
        if (r.nt && C.daysBetween(r.nt, now) < 3) return;
        out.push({ id, p, r });
      });
    });
    return out.sort((a, b) => a.r.left - b.r.left);
  }
  // 舊資料轉換：檢核表聯絡人、預定竣工日移到施工
  function normalize(p) {
    p.tech = p.tech || {};
    p.build = p.build || {};
    const c = (p.chk && p.chk.contacts) || null;
    if (c) {
      if (c.builder && !p.build.line) p.build.line = c.builder;
      if (c.supervisor && !p.build.supervisor) p.build.supervisor = c.supervisor;
      delete p.chk.contacts;
    }
    if (p.chk && p.chk.dates && p.chk.dates.plan) {
      if (!p.build.due) p.build.due = p.chk.dates.plan;
      delete p.chk.dates.plan;
    }
    // v2：狀態改為「自動」判斷。舊版存下的「未辦」與未填相同，轉為自動，日期才能帶出完成狀態
    if (!(p.v >= 2)) {
      [p.tech.ms, p.chk && p.chk.items].forEach(box =>
        Object.values(box || {}).forEach(it => {
          if (it && it.s === "未辦") delete it.s;
        })
      );
      p.v = 2;
    }
    return p;
  }

  // ---------- 共用日曆：每個未完成、有期限的事項一個全天活動 ----------
  const CAL_TITLE = {
    "tech-T1": "技服廠商提送服務實施計畫書",
    "tech-T2": "審查服務實施計畫書",
    "tech-T3": "技服廠商提送勞工名冊",
    "tech-T4": "技服廠商提報技師簽證計畫",
    "tech-T5": "技服廠商交付設計成果",
    "tech-T6": "審查設計成果",
    "acc-0": "預定竣工・廠商應報竣",
    "acc-3": "會同查證竣工",
    "acc-5": "監造提送竣工查驗紀錄",
    "acc-6": "廠商提送竣工文件",
    "acc-14": "辦理驗收",
    "acc-19": "結算驗收證明書陳核",
    "acc-25": "簽請付款（尾款）",
    "acc-28": "登錄保固期間",
    "acc-31": "保固期滿前會勘",
  };
  function calendarEvents(p, school, link, now) {
    const ev = evaluate(p, school, now),
      name = p.name || p.title || "未命名工程",
      out = [];
    const short = s => {
      s = String(s || "")
        .replace(/（[^）]*）/g, "")
        .replace(/[。：]$/, "")
        .trim();
      return s.length > 22 ? s.slice(0, 21) + "…" : s;
    };
    const whoTxt = w => String(w || "").replace("技服廠商", "技術服務廠商");
    const title = (key, r) =>
      key === "acc-13"
        ? (ev.accept.rows[14] || {}).s === "不適用"
          ? "辦理驗收"
          : "辦理初驗"
        : CAL_TITLE[key] || short(r.item) + (/學校/.test(r.who || "") ? "" : "〔" + whoTxt(r.who) + "〕");
    const tail = (link ? "\n開啟網站：" + link : "") + "\n（由「工程契約與驗收管理」自動產生；請在網站修改，直接改日曆會被覆蓋）";
    // 停工中的竣工期限：標「待核對」，週報不列入逾期（hold）
    const mark = r => (r.hold ? "【停工中・原期限待核對】" : "");
    const add = (key, r, lines) =>
      out.push({
        key,
        date: r.due,
        hold: !!r.hold,
        title: name + "｜" + mark(r) + title(key, r),
        short: mark(r) + title(key, r),
        who: whoTxt(r.who),
        desc:
          ["事項：" + r.item, "主辦：" + whoTxt(r.who), "期限：" + C.roc(r.due) + (r.when ? "（" + r.when + "）" : "")]
            .concat(lines)
            .filter(Boolean)
            .join("\n") + tail,
      });
    ev.tech.filter(r => r.open && r.due).forEach(r => add("tech-" + r.key, r, ["階段：技術服務履約"]));
    ev.accept.rows
      .filter(r => r.open && r.due)
      .forEach(r =>
        add("acc-" + r.key, r, [
          "階段：竣工驗收至保固・" + C.STAGES[r.stage],
          r.key === 0 && ev.plan.how ? "預定竣工日：" + ev.plan.how : "",
        ])
      );
    return out;
  }

  // ---------- 修改紀錄：比對暫存前後，列出改了哪些欄位 ----------
  const BUILD_LABEL = {
    title: "工程名稱（施工契約）",
    name: "施工廠商",
    line: "施工廠商 LINE 稱呼",
    budget: "工程預算金額",
    amount: "工程契約金額",
    award: "決標／簽約日",
    start: "開工日",
    days: "工期（天）",
    unit: "工期計算",
    due: "預定竣工日（手動）",
    supervisor: "監造單位",
    rollHoliday: "工期末日遇假日",
  };
  const STOP_LABEL = { s: "停工日", e: "復工日", doc: "核定文號", mode: "處理方式", days: "核定淨增天數" };
  const TOP_LABEL = { vendorLine: "技術服務廠商 LINE 稱呼", entryStage: "建檔起始階段", techScope: "技術服務適用性" };
  const EXT_LABEL = { d: "核定日期", days: "天數", doc: "文號／事由" },
    F_LABEL = { s: "狀態", d: "完成日期", n: "備註", nt: "LINE 通知日" };
  const TECH_LABEL = { sign: "簽約日", start: "通知開始日", daysUnit: "交付期限計算" };
  function flat(o, pre, out) {
    if (o === null || o === undefined) return out;
    if (typeof o !== "object") {
      out[pre] = String(o);
      return out;
    }
    Object.keys(o).forEach(k => flat(o[k], pre ? pre + "." + k : k, out));
    return out;
  }
  const cut = (s, n) => {
    s = String(s || "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  };
  function fieldLabel(path) {
    const k = path.split("."),
      E = G.ContractEngine;
    if (k.length === 1) {
      const f = E && E.PROJECT_FIELDS.find(x => x.k === k[0]);
      return f ? "技術服務契約・" + f.label : TOP_LABEL[k[0]] || path;
    }
    if (k[0] === "tech" && k[1] === "ms") {
      const t = TECH.find(r => r[0] === k[2]);
      return `技術服務 ${k[2]}「${cut(t ? t[1] : "", 14)}」・${F_LABEL[k[3]] || k[3]}`;
    }
    if (k[0] === "tech") return "技術服務・" + (TECH_LABEL[k[1]] || k[1]);
    if (k[0] === "build" && k[1] === "stops") return `施工・停復工第 ${+k[2] + 1} 筆・${STOP_LABEL[k[3]] || k[3]}`;
    if (k[0] === "chk" && k[1] === "preMode") return "竣工驗收・初驗適用（個案選擇）";
    if (k[0] === "build" && k[1] === "ext") return `施工・展延第 ${+k[2] + 1} 筆・${EXT_LABEL[k[3]] || k[3]}`;
    if (k[0] === "build") return "施工・" + (BUILD_LABEL[k[1]] || k[1]);
    if (k[0] === "chk" && k[1] === "dates") {
      const d = C.DATES.find(x => x[0] === k[2]);
      return "竣工驗收・" + (d ? d[1] : k[2]);
    }
    if (k[0] === "chk" && k[1] === "items") {
      const it = C.ITEMS[+k[2]];
      return `竣工驗收 項${+k[2] + 1}「${cut(it ? it[1] : "", 14)}」・${F_LABEL[k[3]] || k[3]}`;
    }
    if (k[0] === "adv") return "契約進階欄位 " + k[1];
    if (k[0] === "docs") return k[1] === "tender" ? "下載招標版契約" : k[1] === "sign" ? "下載簽約版契約" : path;
    if (k[0] === "gov") {
      const d = G.GovDocs && G.GovDocs.DOCS.find(x => x.id === k[1]);
      const f = d ? d.fields({ d: {}, pre: false }).find(x => x[0] === k[2]) : null;
      return `簽稿「${d ? d.label : k[1]}」・${f ? f[1] : k[2]}`;
    }
    return path;
  }
  function fileKeyLabel(key) {
    const m = /^(tech|acc)-(.+)$/.exec(key);
    if (!m) return key;
    if (m[1] === "tech") return "技術服務 " + m[2];
    return "竣工驗收 項" + (+m[2] + 1) + (C.DOCS[+m[2]] ? "「" + C.DOCS[+m[2]] + "」" : "");
  }
  function changeList(oldStr, p) {
    let old = {};
    try {
      old = JSON.parse(oldStr || "{}");
    } catch (e) {
      old = {};
    }
    const skip = /^(updatedAt|updatedBy|id|changes|v|folder)$|^(files|snap)(\.|$)|\.(flow|flowLog)(\.|$)/;
    const show = (v, money) =>
      v === undefined
        ? ""
        : /^\d{4}-\d{2}-\d{2}$/.test(v)
          ? C.roc(v)
          : money && /^[1-9]\d{3,}$/.test(v)
            ? NF_.format(Number(v))
            : cut(v, 200);
    const a = flat(old, "", {}),
      b = flat(p, "", {}),
      out = [];
    Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).forEach(k => {
      if (skip.test(k) || (a[k] || "") === (b[k] || "")) return;
      const label = fieldLabel(k),
        money = /金額|（元）|費/.test(label);
      out.push([label, show(a[k], money), show(b[k], money)]);
    });
    const fa = old.files || {},
      fb = p.files || {};
    Object.keys(fb).forEach(key => {
      const had = new Set((fa[key] || []).map(f => f.id));
      (fb[key] || []).filter(f => !had.has(f.id)).forEach(f => out.push(["上傳檔案・" + fileKeyLabel(key), "", f.name]));
    });
    // 表件流向：每一筆新的流向紀錄寫進修改紀錄（工程裡只留最近 20 筆，完整紀錄在試算表）
    const each = (o, f) =>
      [
        ["chk", "items", "acc-"],
        ["tech", "ms", "tech-"],
      ].forEach(([a, b, pre]) => {
        const m = (o[a] || {})[b] || {};
        Object.keys(m).forEach(k => f(pre + k, a + "." + b + "." + k, m[k] || {}));
      });
    const seen = {};
    each(old, (key, path, it) => {
      seen[key] = new Set((it.flowLog || []).map(e => e.at + "|" + e.status));
    });
    each(p, (key, path, it) =>
      (it.flowLog || []).forEach(e => {
        if (seen[key] && seen[key].has(e.at + "|" + e.status)) return;
        out.push([
          `表件流向［${key}］${fileKeyLabel(key)}`,
          "",
          [
            e.status || "待確認",
            e.owner || "經手待確認",
            e.follow ? "追蹤 " + C.roc(e.follow) : "",
            e.note || "",
            e.by ? "登錄：" + e.by : "",
          ]
            .filter(Boolean)
            .join("｜"),
        ]);
      })
    );
    return out.slice(0, 200);
  }

  // ---------- 工程報表（匯出 Excel） ----------
  const p2 = n => String(n).padStart(2, "0");
  function reportSheets(projects, school, now) {
    now = now || C.today();
    const n = v => {
      const t = String(v == null ? "" : v)
        .replace(/,/g, "")
        .trim();
      if (t === "") return "";
      const x = Number(t);
      return isFinite(x) ? x : "";
    }; // 空白＝未填，0 照實呈現
    const stamp = iso => {
      const d = new Date(iso);
      return isNaN(d)
        ? ""
        : `${d.getFullYear() - 1911}.${p2(d.getMonth() + 1)}.${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
    };
    const list = Object.keys(projects)
      .map(id => ({ id, p: projects[id], ev: evaluate(projects[id], school, now) }))
      .sort(
        (a, b) =>
          (b.ev.overdue > 0) - (a.ev.overdue > 0) || (a.ev.next ? a.ev.next.due : "9").localeCompare(b.ev.next ? b.ev.next.due : "9")
      );
    const s1 = {
      name: "工程總表",
      cols: [
        { title: "工程簡稱", width: 16 },
        { title: "案名", width: 30 },
        { title: "目前階段", width: 22 },
        { title: "完成率", width: 8, type: "pct" },
        { title: "下一步", width: 34 },
        { title: "最近期限", width: 11 },
        { title: "剩餘天數", width: 9, type: "int" },
        { title: "逾期項數", width: 9, type: "int" },
        { title: "技術服務廠商", width: 22 },
        { title: "服務費（元）", width: 14, type: "money" },
        { title: "施工廠商", width: 22 },
        { title: "工程預算（元）", width: 15, type: "money" },
        { title: "工程契約金額（元）", width: 17, type: "money" },
        { title: "開工日", width: 11 },
        { title: "預定竣工日", width: 11 },
        { title: "驗收合格日", width: 11 },
        { title: "保固期滿日", width: 11 },
        { title: "最後修改", width: 22 },
      ],
      rows: list.map(({ p, ev }) => {
        const b = p.build || {},
          d = (p.chk || {}).dates || {},
          tot = ev.techTotal + ev.accept.total,
          done = ev.techDone + ev.accept.done;
        return [
          p.name || "",
          p.title || "",
          ev.label,
          tot ? done / tot : 0,
          ev.step.title,
          ev.next ? C.roc(ev.next.due) : "",
          ev.next ? ev.next.left : "",
          ev.overdue,
          p.vendor || "",
          n(p.fee || (p.method === "建造費用百分比法" && G.ContractEngine ? G.ContractEngine.calcFee(p) : "")),
          b.name || "",
          n(b.budget),
          n(b.amount),
          b.start ? C.roc(b.start) : "",
          ev.plan.date ? C.roc(ev.plan.date) : "",
          d.accept ? C.roc(d.accept) : "",
          C.warrantyEnd(d) ? C.roc(C.warrantyEnd(d)) : "",
          (p.updatedBy ? p.updatedBy + " " : "") + stamp(p.updatedAt),
        ];
      }),
      red: r => r[7] > 0,
    };
    const items = [];
    list.forEach(({ p, ev }) => {
      ev.tech
        .filter(r => r.open && r.due)
        .forEach(r =>
          items.push([
            r.due,
            r.left,
            p.name || p.title || "",
            "技術服務履約",
            r.item,
            r.who.replace("技服廠商", "技術服務廠商"),
            r.auto ? "自動：" + r.autoS : r.s,
          ])
        );
      ev.accept.rows
        .filter(r => r.open && r.due)
        .forEach(r =>
          items.push([
            r.due,
            r.left,
            p.name || p.title || "",
            "竣工驗收・" + C.STAGES[r.stage],
            r.item,
            r.who,
            r.auto ? "自動：" + r.autoS : r.s,
          ])
        );
    });
    items.sort((a, b) => a[0].localeCompare(b[0]));
    const s2 = {
      name: "期限明細",
      cols: [
        { title: "期限", width: 11 },
        { title: "剩餘天數", width: 9, type: "int" },
        { title: "工程", width: 16 },
        { title: "階段", width: 22 },
        { title: "事項", width: 56 },
        { title: "主辦", width: 16 },
        { title: "狀態", width: 12 },
      ],
      rows: items.map(r => [C.roc(r[0])].concat(r.slice(1))),
      red: r => typeof r[1] === "number" && r[1] < 0,
    };
    return [s1, s2];
  }

  G.Lifecycle = {
    changeList,
    fieldLabel,
    reportSheets,
    calendarEvents,
    nextStep,
    makeCal,
    countDays,
    evaluate,
    plannedCompletion,
    extTotal,
    contacts,
    notifiable,
    message,
    lineUrl,
    store,
    upcoming,
    normalize,
    TECH,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
