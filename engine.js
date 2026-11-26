/* 技術服務契約產生核心：欄位定義、值的計算、產生 docx。瀏覽器與 Node 共用。 */
(function (G) {
  "use strict";
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";

  const PROJECT_FIELDS = [
    { k: "name", label: "工程簡稱", hint: "清單與檔名用" },
    { k: "title", label: "案名", hint: "契約第一頁「茲為辦理【　】案」" },
    { k: "vendor", label: "乙方（得標廠商）", hint: "受託人全銜；招標版不會填入" },
    { k: "type", label: "工程類型", opts: ["建築工程", "非建築公共工程"] },
    { k: "plan", label: "規劃", opts: ["是", "否"] },
    { k: "design", label: "設計（基本＋細部）", opts: ["是", "否"] },
    { k: "super", label: "監造", opts: ["是", "否"] },
    { k: "method", label: "計價方式", opts: ["總包價法", "建造費用百分比法", "服務成本加公費法", "按月計酬", "按日計酬", "按時計酬"] },
    { k: "fee", label: "服務費金額（元）" },
    { k: "feeFixed", label: "招標時公告固定服務費", opts: ["是", "否"] },
    { k: "rate", label: "費率（%）" },
    { k: "range", label: "適用建造費用範圍（元）" },
    { k: "shape", label: "契約型態（附件2 是否分案計算服務費）", opts: ["單一工程", "分期", "分區", "開口契約"] },
    { k: "cost", label: "預估建造費用（元）" },
    { k: "bclass", label: "建築物類別", opts: ["第一類", "第二類", "第三類", "第四類"] },
    { k: "days", label: "規劃設計交付期限（日）" },
    { k: "permit", label: "代辦建照／圖說送審", opts: ["是", "否"] },
    { k: "tender", label: "協辦招標及決標", opts: ["是", "否"] },
  ];

  // [分類, 項目key, 項目名, 預設, 說明, 對應]
  const FIXED = [
    ["基本", "party", "甲方名稱", "臺北市立東湖國民中學", "契約第一頁委託人", ["F001"]],
    ["基本", "announce", "公告金額（元）", "1500000", "政府採購法公告金額；達此金額提醒納入臺北市履約績效管理要點", []],
    ["基本", "auditTh", "查核金額（工程，元）", "50000000", "政府採購法第12條：工程採購查核金額 5,000 萬元，達此金額之驗收須報上級機關監辦", []],
    ["基本", "unit", "承辦單位", "總務處", "公文簽稿「簽　於○○」使用", []],
    ["基本", "preTh", "須辦初驗之工程預算門檻（元）", "20000000", "竣工驗收流程：工程預算金額逾此金額者應先辦初驗", []],
    ["基本", "copies", "契約副本份數", "", "第1條：副本＿份（範本要求載明）", ["F004"]],
    ["基本", "daytype", "日數計算方式", "工作天", "第7條（範本預設工作天）", "opt"],
    ["基本", "holidays", "放假日（平日放假者，每行一個日期）", "115年（2026）\n2026-01-01 元旦\n2026-02-16 春節\n2026-02-17 春節\n2026-02-18 春節\n2026-02-19 春節\n2026-02-20 春節\n2026-02-27 和平紀念日補假\n2026-04-03 兒童節補假\n2026-04-06 清明節補假\n2026-05-01 勞動節\n2026-06-19 端午節\n2026-09-25 中秋節\n2026-09-28 教師節\n2026-10-09 國慶日補假\n2026-10-26 光復節補假\n2026-12-25 行憲紀念日\n116年（2027）\n2027-01-01 元旦\n2027-02-04 春節\n2027-02-05 春節\n2027-02-08 春節\n2027-02-09 春節補假\n2027-02-10 春節補假\n2027-03-01 和平紀念日補假\n2027-04-05 清明節\n2027-04-06 兒童節補假\n2027-04-30 勞動節補假\n2027-06-09 端午節\n2027-09-15 中秋節\n2027-09-28 教師節\n2027-10-11 國慶日補假\n2027-10-25 光復節\n2027-12-24 行憲紀念日補假\n2027-12-31 117年元旦補假", "計算工作天時不計入；日曆天期限末日遇放假日順延。依人事行政總處政府行政機關辦公日曆表，每年公告後請補上新年度", []],
    ["基本", "makeups", "補行上班日（每行一個日期）", "", "週六補班者列入；115、116年無補班日", []],
    ["價金", "reduce", "減價收受違約金（%）", "20", "第4條（未載明為20%）", ["F024"]],
    ["價金", "suspend", "進度落後暫停給付門檻（%）", "", "第5條（範本無預設）", ["F033"]],
    ["價金", "threshold", "薪資指數調整門檻 E（%）", "2.5", "第5條（未載明為2.5）", ["F036"]],
    ["價金", "wage", "全職員工月薪下限（元）", "", "第5條（空白＝依法以最低工資1.1倍計）", ["F039"]],
    ["價金", "otherpay", "其他服務費用核可後先付（%）", "90", "第3條附件（未載明為90%）", ["F287", "F372", "F425", "F486"]],
    ["價金", "otherrest", "其他服務費用其餘款給付時點", "驗收合格後", "第3條附件（未載明為驗收合格後）", ["F288", "F373", "F426", "F487"]],
    ["價金", "monthly", "監造費按月給付依據", "當月工程施工進度", "第5條附件 擇一", "opt"],
    ["履約管理", "planSubmit", "服務實施計畫書提出（日內）", "10", "第8條（未載明為10個工作天）", ["F046"]],
    ["履約管理", "planReview", "甲方審查實施計畫書（日內）", "5", "第8條（未載明為5個工作天）", ["F047"]],
    ["履約管理", "stageReview", "甲方審查各階段資料（日內）", "10", "第8條（未載明為10個工作天）", ["F048"]],
    ["履約管理", "roster", "勞工名冊於簽約後（日內）", "", "第8條（甲方自行填列）", ["F049"]],
    ["履約管理", "certPlan", "簽證執行計畫提報（日內）", "5", "第8條（未載明為5工作天）", ["F052"]],
    ["履約管理", "report", "工作月報每月（日）以前", "5", "第8條（未載明為5日）", ["F062"]],
    ["履約管理", "coding", "工程細目編碼正確率（%）", "40", "第8條（未載明為40%）", ["F064"]],
    ["履約管理", "absentSite", "監造人員未到工地（元／人日）", "2500", "第9條懲罰性違約金（未載明為2,500元）", ["F070"]],
    ["履約管理", "absentCall", "通知到場未到（元／人次）", "2500", "第9條懲罰性違約金（未載明為2,500元）", ["F071"]],
    ["履約管理", "callLimit", "通知到場扣罰每月上限（次）", "4", "第9條（未載明為4次）", ["F072"]],
    ["保險", "deductPro", "專業責任險每一事故自負額上限（元）", "", "第10條（範本無預設）", ["F078"]],
    ["保險", "insStart", "專業責任險保險期間起點", "契約簽訂日", "第10條：自＿起至契約驗收合格日止", ["F079"]],
    ["保險", "employer", "加保雇主意外責任險", "否", "第10條", "opt"],
    ["保險", "perperson", "雇主意外險每人體傷或死亡", "5,000,000元", "第10條（未載明為5,000,000元）", "opt"],
    ["保險", "perAccident", "雇主意外險每一事故倍數", "5", "第10條（未載明為5倍）", ["F090"]],
    ["保險", "aggregate", "雇主意外險最高累積責任倍數", "10", "第10條（未載明為10倍）", ["F091"]],
    ["保險", "deductEmp", "雇主意外險廠商自負額上限（元）", "", "第10條（範本無預設）", ["F092"]],
    ["遲延與違約", "late", "逾期違約金計算方式", "依逾期階段契約價金比率", "第13條 三擇一（建議值，請確認）", "opt"],
    ["遲延與違約", "lateval", "逾期違約金每日比率（%）或定額（元）", "0.1", "第13條（比率未載明為0.1%）", "opt"],
    ["遲延與違約", "partial", "部分完成時未完成部分每日比率（%）", "0.1", "第13條（未載明為0.1%）", ["F108"]],
    ["遲延與違約", "docLate", "文書逾期提送每次違約金（元）", "1000", "第13條（未載明為1,000元）", ["F109"]],
    ["遲延與違約", "cap", "損害賠償金額上限", "契約價金總額", "第14條（建議值，請確認）", "opt"],
    ["遲延與違約", "suspPay", "暫停執行逾＿個月甲方先付已完成價金", "2", "第16條（未載明為2個月）", ["F193"]],
    ["遲延與違約", "suspEnd", "暫停執行逾＿個月乙方得終止", "6", "第16條（未載明為6個月）", ["F194"]],
    ["遲延與違約", "payNotice", "延遲付款通知＿個月後乙方得暫停", "1", "第16條（未載明為1個月）", ["F196"]],
    ["遲延與違約", "payEnd", "延遲付款達＿個月乙方得終止", "3", "第16條（未載明為3個月）", ["F197"]],
    ["爭議處理", "appeal", "申訴審議委員會", "臺北市政府採購申訴審議委員會", "第17條（臺北市立學校選臺北市政府）", "opt"],
    ["爭議處理", "arbchief", "主任仲裁人選定方式", "雙方選定之仲裁人共推", "第17條（建議值，請確認）", "opt"],
    ["爭議處理", "arbsel", "仲裁人代為選定聲請對象", "指定之仲裁機構", "第17條（未勾選為指定之仲裁機構）", "opt"],
    ["爭議處理", "arbplace", "仲裁地", "甲方所在地", "第17條（未載明為甲方所在地）", "opt"],
    ["爭議處理", "equity", "仲裁庭適用衡平原則", "不同意", "第17條（未勾選為不同意）", "opt"],
  ];
  const OPTIONS = {
    daytype: ["工作天", "日曆天"],
    monthly: ["當月工程施工進度", "當月監造進度"],
    employer: ["是", "否"],
    perperson: ["2,000,000元", "3,000,000元", "5,000,000元", "6,000,000元"],
    late: ["依逾期階段契約價金比率", "依契約價金總額比率", "每日定額"],
    cap: ["契約價金總額", "不訂上限"],
    appeal: ["採購法主管機關設立之採購申訴審議委員會", "臺北市政府採購申訴審議委員會", "新北市政府採購申訴審議委員會", "桃園市政府採購申訴審議委員會", "臺中市政府採購申訴審議委員會", "臺南市政府採購申訴審議委員會", "高雄市政府採購申訴審議委員會"],
    arbchief: ["雙方共推", "雙方選定之仲裁人共推"],
    arbsel: ["法院", "指定之仲裁機構"],
    arbplace: ["甲方所在地"],
    equity: ["同意", "不同意"],
  };

  // 「未載明者為○○」文字 → 設定值（數字取數字部分；文字照用）
  function defVal(def) {
    const d = String(def || "").trim();
    const m = /^(\d[\d,.]*)/.exec(d);
    return m ? m[1].replace(/,/g, "") : d;
  }
  // 直接填值的學校設定項目 → 對應編號；逾期違約金比率另計
  function fixedIdMap() {
    const m = {};
    FIXED.forEach(([, key, label, dft, , mp]) => { if (Array.isArray(mp)) mp.forEach(id => { m[id] = { key, label, dft }; }); });
    const lv = FIXED.find(r => r[1] === "lateval");
    ["F103", "F105", "F107"].forEach(id => { m[id] = { key: "lateval", label: lv[2], dft: lv[3] }; });
    return m;
  }
  // 學校預設值：有範本時，以範本上「未載明者為○○」為準
  function defaultSchool(points) {
    const o = {};
    FIXED.forEach(r => { o[r[1]] = r[3]; });
    if (points && points.length) {
      const byId = {}; points.forEach(p => { byId[p.id] = p; });
      FIXED.forEach(([, key, , dft, , mp]) => {
        if (!Array.isArray(mp) || dft === "") return;
        const p = byId[mp[0]];
        if (p && p.def) o[key] = defVal(p.def);
      });
      const late = { "依逾期階段契約價金比率": "F105", "依契約價金總額比率": "F107" }[o.late];
      if (late && byId[late] && byId[late].def) o.lateval = defVal(byId[late].def);
    }
    return o;
  }
  // 新範本預設值改變、且影響學校設定的項目
  function defaultAlerts(defChanges, school) {
    const map = fixedIdMap(), seen = new Set(), out = [];
    (defChanges || []).forEach(c => {
      const f = map[c.id]; if (!f || seen.has(f.key)) return;
      if (f.key === "lateval" && { F105: "依逾期階段契約價金比率", F107: "依契約價金總額比率", F103: "每日定額" }[c.id] !== (school || {}).late) return;
      seen.add(f.key);
      const cur = String((school || {})[f.key] ?? "").replace(/,/g, "").trim();
      const oldV = defVal(c.oldDef), newV = defVal(c.newDef);
      out.push({ key: f.key, label: f.label, id: c.id, oldDef: c.oldDef, newDef: c.newDef, newVal: newV, cur, stale: cur !== "" && cur === oldV && newV !== "" && newV !== cur });
    });
    return out;
  }

  function fmt(v) {
    if (v === null || v === undefined) return "";
    let s = String(v).trim();
    const n = s.replace(/,/g, "");
    if (/^\d{4,}$/.test(n)) return Number(n).toLocaleString("en-US");
    return s;
  }

  function fixedOpt(key, v, ptype, out) {
    if (!v) return;
    const bld = ptype !== "非建築公共工程";
    switch (key) {
      case "daytype": out.F044 = v === "工作天" ? "V" : "X"; out.F045 = v === "日曆天" ? "V" : "X"; break;
      case "monthly": out[(bld ? ["F537", "F538"] : ["F539", "F540"])[v === "當月工程施工進度" ? 0 : 1]] = "V"; break;
      case "employer": if (v === "是") out.F075 = "V"; break;
      case "perperson": {
        const m = { "2,000,000元": "F084", "3,000,000元": "F085", "5,000,000元": "F086", "6,000,000元": "F087" };
        if (m[v]) out[m[v]] = "V"; else { out.F088 = "V"; out.F089 = fmt(v.replace(/元$/, "")); }
        break;
      }
      case "late": {
        const m = { "依逾期階段契約價金比率": "F104", "依契約價金總額比率": "F106", "每日定額": "F102" };
        if (m[v]) out[m[v]] = "V"; break;
      }
      case "cap": if (v === "契約價金總額") out.F182 = "V"; break;
      case "appeal": {
        const m = { "採購法主管機關設立之採購申訴審議委員會": "F212", "臺北市政府採購申訴審議委員會": "F213", "新北市政府採購申訴審議委員會": "F214", "桃園市政府採購申訴審議委員會": "F215", "臺中市政府採購申訴審議委員會": "F216", "臺南市政府採購申訴審議委員會": "F217", "高雄市政府採購申訴審議委員會": "F218" };
        if (m[v]) out[m[v]] = "V"; break;
      }
      case "arbchief": out[v === "雙方共推" ? "F200" : "F201"] = "V"; break;
      case "arbsel": if (v === "法院") { out.F198 = "V"; out.F202 = "V"; } else { out.F199 = "V"; out.F203 = "V"; } break;
      case "arbplace": if (v === "甲方所在地") out.F204 = "V"; break;
      case "equity": out[v === "同意" ? "F210" : "F211"] = "V"; break;
    }
  }

  const ATT2 = {
    "建築工程": { plan: ["F222"], design: ["F230", "F231", "F242"], super: ["F247"], permit: ["F245"], tender: ["F246"] },
    "非建築公共工程": { plan: ["F249"], design: ["F256", "F257", "F266"], super: ["F270"], permit: ["F268"], tender: ["F269"] },
  };
  const ART3 = { plan: ["F009", "F010", "F011", "F012", "F013"], design: ["F014", "F015", "F016", "F017", "F018"], super: ["F019", "F020", "F021", "F022", "F023"] };
  const MCOL = { "總包價法": 0, "建造費用百分比法": 2, "服務成本加公費法": 3, "計酬": 4 };

  function calcFee(p) {
    const r = parseFloat(String(p.rate || "").replace(/,/g, ""));
    const c = parseFloat(String(p.cost || "").replace(/,/g, ""));
    if (isFinite(r) && isFinite(c)) return String(Math.round(c * r / 100));
    return "";
  }

  // 計算所有填寫點的值；回傳 {values, source}
  function computeValues(project, school, stage) {
    const p = project || {}, s = Object.assign(defaultSchool(), school || {});
    const ptype = p.type || "建築工程";
    const vals = {}, src = {};
    const put = (o, tag) => { for (const k in o) { if (o[k] !== "" && o[k] != null) { vals[k] = o[k]; src[k] = tag; } } };
    // 1. 學校固定設定
    const fx = {};
    FIXED.forEach(([, key, , , , mp]) => {
      const v = (s[key] ?? "").toString().trim();
      if (Array.isArray(mp)) { if (v) mp.forEach(id => { fx[id] = fmt(v); }); }
      else if (key === "lateval") {
        const m = { "依逾期階段契約價金比率": "F105", "依契約價金總額比率": "F107", "每日定額": "F103" }[s.late];
        if (m && v) fx[m] = fmt(v);
      } else fixedOpt(key, v, ptype, fx);
    });
    put(fx, "school");
    // 2. 每案
    const pr = {};
    if (p.vendor && stage !== "tender") pr.F002 = p.vendor.trim();
    if (p.title) pr.F003 = p.title.trim();
    const phases = ["plan", "design", "super"].filter(k => p[k] === "是");
    const att = ATT2[ptype] || ATT2["建築工程"];
    phases.concat(["permit", "tender"].filter(k => p[k] === "是")).forEach(k => att[k].forEach(id => { pr[id] = "V"; }));
    const m = p.method || "";
    const mk = /計酬$/.test(m) ? "計酬" : m;
    if (mk in MCOL) phases.forEach(ph => { pr[ART3[ph][MCOL[mk]]] = "V"; });
    const fee = fmt(p.fee || (m === "建造費用百分比法" ? calcFee(p) : ""));
    if (m === "總包價法") {
      if (fee && (stage !== "tender" || p.feeFixed === "是")) pr.F285 = fee;
    } else if (m === "建造費用百分比法") {
      pr.F338 = "V"; pr[ptype === "非建築公共工程" ? "F343" : "F342"] = "V";
      if (p.rate) pr.F339 = String(p.rate).trim();
      if (p.range) pr.F340 = fmt(p.range);
      if (fee && stage !== "tender") pr.F341 = fee;
      // 範本原檔預先勾了「開口契約」；依本案型態重設三格，單一工程三格都不勾
      const shape = p.shape || "單一工程";
      [["F369", "分期"], ["F370", "分區"], ["F371", "開口契約"]].forEach(([id, v]) => { pr[id] = shape === v ? "V" : "X"; });
    } else if (m === "服務成本加公費法") {
      phases.forEach(ph => { pr[{ plan: "F477", design: "F478", super: "F479" }[ph]] = "V"; });
      if (fee) pr.F421 = fee;
    } else if (mk === "計酬") {
      pr[{ "按月計酬": "F482", "按日計酬": "F483", "按時計酬": "F484" }[m]] = "V";
      if (fee) pr.F485 = fee;
    }
    if (p.days) pr.F040 = String(p.days).trim();
    put(pr, "project");
    // 3. 進階覆寫
    const adv = p.adv || {};
    const ao = {};
    for (const k in adv) { const v = String(adv[k] ?? "").trim(); if (v) ao[k] = v; }
    put(ao, "adv");
    // 招標版的遮蔽規則放在進階覆寫之後，避免舊案或複製案的覆寫值把乙方、決標金額帶進招標文件
    if (stage === "tender") {
      const hide = ["F002"];
      if (m === "建造費用百分比法") hide.push("F341");
      if (m === "總包價法" && p.feeFixed !== "是") hide.push("F285");
      hide.forEach(id => { delete vals[id]; delete src[id]; });
    }
    return { values: vals, source: src };
  }

  // 依計價方式／工程類型決定各附件是否適用
  function regionPlan(project) {
    const p = project || {}, bld = (p.type || "建築工程") !== "非建築公共工程";
    const m = p.method || "";
    const plan = { A21: bld, A22: !bld, A23: false, A51: bld, A52: !bld, A53: false };
    const a3 = m === "總包價法" ? "A31" : m === "建造費用百分比法" ? "A32" : m === "服務成本加公費法" ? "A33" : /計酬$/.test(m) ? "A34" : null;
    ["A31", "A32", "A33", "A34"].forEach(k => { plan[k] = a3 ? k === a3 : true; });
    return plan;
  }

  function checks(project, stage) {
    const p = project || {}, out = [];
    if (!p.title) out.push("尚未填案名");
    const phases = ["plan", "design", "super"].filter(k => p[k] === "是");
    if (!phases.length) out.push("尚未選委託階段（規劃／設計／監造）");
    if (phases.length && !p.method) out.push("尚未選計價方式，第3條不會勾選");
    if (p.method === "建造費用百分比法" && !p.rate) out.push("百分比法尚未填費率");
    if (p.method === "建造費用百分比法" && !p.range) out.push("百分比法尚未填適用建造費用範圍");
    if (stage !== "tender" && !p.vendor) out.push("簽約版尚未填乙方");
    if (stage !== "tender" && p.method && p.method !== "建造費用百分比法" && !p.fee) out.push("尚未填服務費金額");
    if (phases.some(k => k !== "super") && !p.days) out.push("尚未填規劃設計交付期限");
    return out;
  }

  // 服務費參考試算：機關委託技術服務廠商評選及計費辦法 附表一、二（109.9.9 修正）
  const TIERS = [5e6, 1e7, 5e7, 1e8, 5e8, Infinity];
  const TABLE1 = { "第一類": [8.6, 8.0, 6.9, 5.8, 4.6, 3.7], "第二類": [9.3, 8.7, 7.6, 6.4, 5.2, 4.3], "第三類": [9.8, 9.3, 8.2, 7.0, 5.8, 5.0], "第四類": [10.5, 10.0, 8.9, 7.6, 6.4, 5.6] };
  const TABLE2 = { design: [5.9, 5.6, 5.0, 4.3, 3.6, 3.2], super: [4.6, 4.4, 3.9, 3.3, 2.8, 2.4] };
  const num = v => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return isFinite(n) ? n : 0; };
  function segCalc(cost, rates) {
    let prev = 0, sum = 0; const rows = [];
    for (let i = 0; i < TIERS.length && cost > prev; i++) {
      const top = Math.min(cost, TIERS[i]), part = top - prev, fee = part * rates[i] / 100;
      rows.push({ from: prev, to: top, rate: rates[i], fee }); sum += fee; prev = TIERS[i];
    }
    return { sum, rows };
  }
  function feeEstimate(p) {
    const cost = num(p.cost); if (!cost) return null;
    const bld = (p.type || "建築工程") !== "非建築公共工程";
    const ph = ["plan", "design", "super"].filter(k => p[k] === "是");
    const notes = [];
    if (cost < 1e6) notes.push("工程經費未達100萬元屬小規模工程，附表不適用，應依個案預估編列");
    let total, fee, rows, basis;
    if (bld) {
      const cls = TABLE1[p.bclass] ? p.bclass : "第一類";
      const r = segCalc(cost, TABLE1[cls]); rows = r.rows; total = r.sum;
      const share = { plan: 0.10, design: 0.45, super: 0.45 };
      fee = ph.reduce((a, k) => a + share[k] * total, 0);
      basis = "附表一 建築物工程 " + cls + "（規劃10%、設計45%、監造45%）";
    } else {
      const d = segCalc(cost, TABLE2.design), su = segCalc(cost, TABLE2.super);
      rows = d.rows.map((x, i) => ({ from: x.from, to: x.to, rate: +(x.rate + su.rows[i].rate).toFixed(1), fee: x.fee + su.rows[i].fee }));
      total = d.sum + su.sum;
      fee = (ph.includes("design") ? d.sum : 0) + (ph.includes("super") ? su.sum : 0);
      if (ph.includes("plan")) notes.push("附表二不含規劃，規劃費用需另行估算");
      basis = "附表二 公共工程（設計及協辦招標決標＋監造）";
    }
    if (!ph.length) notes.push("尚未選委託階段，參考服務費以0計");
    return { cost, total: Math.round(total), fee: Math.round(fee), totalRate: total / cost * 100, feeRate: fee / cost * 100, rows, basis, notes };
  }
  // 提醒（不影響「備妥」判斷）
  function reminders(p, school) {
    const out = [], th = num((school || {}).announce) || 1500000;
    const est = feeEstimate(p || {});
    const amt = num(p.fee) || (p.method === "建造費用百分比法" ? num(calcFee(p)) : 0) || (est ? est.fee : 0);
    if (amt >= th) out.push("服務費達公告金額（" + th.toLocaleString("en-US") + "元）以上：招標文件應納入《臺北市政府委託技術服務履約績效管理要點》，評選須列「廠商過去履約績效」項目且權重不低於15%");
    if (est && est.notes.length) est.notes.forEach(n => out.push(n));
    return out;
  }

  const CHECK = new Set(["V", "v", "Ｖ", "✓", "✔", "1", "■", "O", "o", "Y", "y"]);
  const UNCHECK = new Set(["X", "x", "Ｘ", "0", "□", "N", "n"]);

  function elKids(el) { const a = []; for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) a.push(c); return a; }
  function textOf(el) { let s = ""; const ts = el.getElementsByTagNameNS(W, "t"); for (let i = 0; i < ts.length; i++) s += ts[i].textContent; return s; }
  function hasSect(p) { return p.getElementsByTagNameNS(W, "sectPr").length > 0; }
  function stripLeadingBreak(p) {
    const brs = p.getElementsByTagNameNS(W, "br");
    for (let i = brs.length - 1; i >= 0; i--) if (brs[i].getAttributeNS(W, "type") === "page") brs[i].parentNode.removeChild(brs[i]);
  }

  // 產生 docx（回傳 Uint8Array）
  async function buildDocx(env, parts, points, regions, project, school, stage, opts) {
    const { JSZip, DOMParser, XMLSerializer } = env;
    opts = Object.assign({ dropGuide: true, naMode: "mark" }, opts || {});
    const { values } = computeValues(project, school, stage);
    const byId = {}; points.forEach(p => { byId[p.id] = p; });
    const docText = parts.find(pt => pt.name === "word/document.xml").text;
    const doc = new DOMParser().parseFromString(docText, "application/xml");
    const body = doc.getElementsByTagNameNS(W, "body")[0];

    // 使用說明框
    if (opts.dropGuide) {
      for (const ch of elKids(body)) {
        if (ch.localName === "tbl" && textOf(ch).indexOf("契約範本使用說明") >= 0) { body.removeChild(ch); break; }
      }
    }
    // 不適用附件
    if (opts.naMode !== "keep") {
      const plan = regionPlan(project);
      for (const key of Object.keys(regions)) {
        if (plan[key]) continue;
        const r = regions[key], kids = elKids(body);
        const a = kids.findIndex(e => e.getAttributeNS(W14, "paraId") === r.start);
        const b = kids.findIndex(e => e.getAttributeNS(W14, "paraId") === r.end);
        if (a < 0 || b <= a) continue;
        let keep = 0;
        if (opts.naMode === "mark") {
          keep = 1;
          while (a + keep < b && /^附表/.test(textOf(kids[a + keep]).trim())) keep++;
        }
        for (let i = a + keep; i < b; i++) body.removeChild(kids[i]);
        if (opts.naMode === "mark") {
          const h = kids[a];
          stripLeadingBreak(h);
          const np = h.cloneNode(true);
          np.removeAttributeNS(W14, "paraId"); np.removeAttributeNS(W14, "textId");
          const runs = elKids(np).filter(e => e.localName === "r");
          let first = runs.find(rr => rr.getElementsByTagNameNS(W, "t").length);
          runs.forEach(rr => { if (rr !== first) np.removeChild(rr); });
          for (const e of elKids(np)) if (e.localName !== "r" && e.localName !== "pPr") np.removeChild(e);
          if (first) {
            for (const e of elKids(first)) if (e.localName !== "rPr") first.removeChild(e);
            const b2 = first.getElementsByTagNameNS(W, "b"); for (let i = b2.length - 1; i >= 0; i--) b2[i].parentNode.removeChild(b2[i]);
            const t = doc.createElementNS(W, "w:t"); t.textContent = "（本案不適用）"; first.appendChild(t);
          }
          const last = kids[a + keep - 1];
          body.insertBefore(np, last.nextSibling);
        }
      }
      // 分節後第一段不需要分頁符號
      const ks = elKids(body);
      for (let i = 1; i < ks.length; i++) if (ks[i - 1].localName === "p" && hasSect(ks[i - 1]) && ks[i].localName === "p") stripLeadingBreak(ks[i]);
    }
    // 記號替換
    const ts = doc.getElementsByTagNameNS(W, "t");
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i], s = t.textContent;
      if (s.indexOf("⟦") < 0) continue;
      t.textContent = s.replace(/⟦([A-Z]\d{3,})⟧/g, (all, id) => {
        const pt = byId[id], v = values[id];
        if (!pt) return all;
        if (pt.kind === "勾選") {
          if (v && CHECK.has(v)) return "■";
          if (v && UNCHECK.has(v)) return "□";
          return pt.orig;
        }
        return v ? v : pt.orig;
      });
    }
    let xml = new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, "");
    xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + xml;
    // 依原 docx 順序寫入：[Content_Types].xml 須在最前面
    const ordered = new JSZip();
    for (const pt of parts) {
      if (pt.name === "word/document.xml") ordered.file(pt.name, xml);
      else if (pt.b64 != null) ordered.file(pt.name, pt.b64, { base64: true });
      else ordered.file(pt.name, pt.text);
    }
    return ordered.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  const USED_IDS = ["F001","F002","F003","F004","F009","F010","F011","F012","F013","F014","F015","F016","F017","F018","F019","F020","F021","F022","F023","F024","F033","F036","F039","F040","F044","F045","F046","F047","F048","F049","F052","F062","F064","F070","F071","F072","F075","F078","F079","F084","F085","F086","F087","F088","F089","F090","F091","F092","F102","F103","F104","F105","F106","F107","F108","F109","F182","F193","F194","F196","F197","F198","F199","F200","F201","F202","F203","F204","F210","F211","F212","F213","F214","F215","F216","F217","F218","F222","F230","F231","F242","F245","F246","F247","F249","F256","F257","F266","F268","F269","F270","F285","F287","F288","F338","F339","F340","F341","F342","F343","F372","F373","F421","F425","F426","F477","F478","F479","F482","F483","F484","F485","F486","F487","F537","F538","F539","F540"];
  G.ContractEngine = { USED_IDS, feeEstimate, reminders, defVal, defaultAlerts, fixedIdMap, PROJECT_FIELDS, FIXED, OPTIONS, defaultSchool, computeValues, regionPlan, checks, buildDocx, calcFee, fmt };
})(typeof globalThis !== "undefined" ? globalThis : this);
