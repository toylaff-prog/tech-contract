/* 竣工驗收至保固檢核表（依「B.3完工驗收階段」資料夾，臺北市政府所屬各機關工程施工及驗收基準第17～29點整理） */
(function (G) {
  "use strict";
  const NF_ = new Intl.NumberFormat("en-US"); // 共用一個數字格式器（每次建立很慢）
  const U = id => "https://drive.google.com/file/d/" + id + "/view";
  const FILES = {
    "00": ["00 竣工驗收作業流程", "1r5lrfzRlMgnVaXkTOQe4i9ZHvK87TDbq"],
    "01a": ["01 竣工報告表（空白表）", "1xXOSZa6rRwoyHRaTMxfyyMgWybFbPxB2"],
    "01b": ["01 竣工前廠商提竣工報告", "1PBsBJMsOtFaNLqQgK1-2ZuHx4MMY4Zy7"],
    "02": ["02 監造轉竣工報告給學校核定", "16EHTF0RO1jLEfHBdaEPZCZ0QclS1Qhzu"],
    "03a": ["03 學校核定廠商建築師竣工報告", "1vH5RaqZbg01D4oEtDIrD3fHRtNx8AlJg"],
    "03b": ["03 學校核定廠商竣工報告表", "17MQQ_SQDN4rmFOCP5ISqEqLxKjkZIhV1"],
    "04": ["04 竣工確認紀錄（空白表）", "1bZ5rGu86WHZF_NBaWrtdEJ3APMOamlGD"],
    "05A": ["05A 結算明細表（空白表）", "1U04ht8f-8pOj8D0S863iiwkv12dH_9qj"],
    "05B": ["05B 結算驗收證明書控制重點", "1oRnOsFFxWJbuhn0wfmY_nVslZZ-ckMRh"],
    "05C": ["05C 廠商提竣工文件（竣工圖＋結算書）", "1zNeXCoz3B_l5GRC8Ecr3WXXQPTuVc_fu"],
    "06": ["06 監造審查轉竣工文件", "1yGS6u6cC4rUaWKSIY_AXg2Jdx--Ag_tc"],
    "07A": ["07A 驗收請示簽呈", "1fN6lI65vnTYF0V_1WptqmdblnnZGlhdn"],
    "07B": ["07B 驗收通知（公文範本）", "1LjNHcC7Jk5EDNtGjBB9n5lRVwtoYZlDX"],
    "08": ["08 驗收紀錄（空白表）", "1heEh3DpyO-fAAv2eQWNyrhEOsHBEf_cY"],
    "09": ["09 驗收不合格範例", "1tRhy3TT2X6_QO-Yr_iVar12WOBV7GgZC"],
    10: ["10 改善後複驗合格範例", "1ANwNdrkl_2q-lriJzbJCxcyk_fAWh-_L"],
    11: ["11 結算驗收證明書（空白表）", "1BVv-uB6tHFvEslAVOQxB4OhfEDHK6FzN"],
    12: ["12 發函給廠商結算驗收證明書", "1WHpvWRnZhxYa7HiRv1c2B9YA3GPB6soz"],
    "13A": ["13A 申報末期空污費（空白表）", "1QNOaPwjKBkgqw5TR5Wc5ZTdnAeerPeY9"],
    "13B": ["13B 申報末期空污費流程圖", "1YJpT1MO6Y8LyRh9HSaHrmqGipXo_iACT"],
    "14A": ["14A 竣工計價前檢核清單", "1ysYAYbttFsMLSvbIYRoAbR59lN9xgssw"],
    "14B": ["14B 竣工計價單（空白表）", "1zdOcyw7aC4uzRs1Sys2OLPG5cgxeU5nl"],
    "14C": ["14C 驗收後付款簽呈", "1euB1y8OKjRZ0Tv8ILaf9gPYmWgOpBrOu"],
    15: ["15 核定監造報告書公文", "1VSWi2Qj9hbJ-_P4zvX1L68MB1sCngGt6"],
    16: ["16 工程決算書（空白表）", "1yepfyMM7D51brSZGyCOO6QlP3L24jwkP"],
  };
  // 關鍵日期（依時間先後）；填了某個日期，它之前的例行項目都推定已完成
  const DATES = [
    ["report", "機關收受竣工報告日", "廠商報竣、監造轉核"],
    ["verify", "會同查證屬實日", "學校會同監造、廠商查證竣工之日"],
    ["actual", "實際竣工日", "經查證確認的竣工日期（結算驗收證明書的「實際竣工日期」）；未填時暫以查證日計算"],
    ["docs", "機關收受竣工文件日", "監造送審全部竣工文件之日"],
    ["pre", "初驗合格日", "無初驗程序者免填"],
    ["accept", "驗收合格日", "驗收紀錄簽認合格之日"],
    ["cert", "結算驗收證明書核定日", ""],
    ["paid", "尾款付款日", "簽准付款之日"],
    ["years", "保固期（年）", "依契約約定；保固期滿日＝驗收合格日加上保固年限"],
    ["wplan", "預計保固會勘日（選填）", "只是安排會勘的日子，不會改變正式的保固期滿日"],
    ["wcheck", "保固期滿會勘日", ""],
    ["refund", "保固保證金發還日", ""],
  ];
  const ORDER = ["report", "verify", "docs", "pre", "accept", "cert", "paid", "wcheck", "refund"];
  // 各項的自動判斷：[推定完成的日期, 完成日期取自, 類型]
  // 類型：n 一般｜x 例外（有發生才辦）｜pre 有初驗才辦｜audit 查核金額以上才辦｜decide 依預算判斷｜w 保固起算｜m 手動
  const AUTO = [
    ["report", ["report"], "n"],
    ["report", ["report"], "n"],
    ["verify", ["verify"], "n"],
    ["verify", ["verify"], "n"],
    ["verify", ["verify"], "n"],
    ["docs", [], "n"],
    ["docs", ["docs"], "n"],
    ["docs", ["docs"], "n"],
    ["pre", [], "n"],
    ["pre", [], "n"],
    ["pre", [], "decide"],
    ["pre", [], "n"],
    ["pre", [], "n"],
    ["pre", ["pre", "accept"], "n"],
    ["accept", ["accept"], "pre"],
    ["accept", ["accept"], "n"],
    [null, [], "x"],
    [null, [], "x"],
    ["accept", [], "n"],
    ["cert", ["cert"], "n"],
    ["paid", [], "audit"],
    ["paid", [], "n"],
    ["paid", [], "n"],
    ["paid", [], "n"],
    ["paid", [], "n"],
    ["paid", ["paid"], "n"],
    ["wcheck", [], "n"],
    ["wcheck", [], "n"],
    ["accept", ["accept"], "w"],
    ["paid", [], "n"],
    [null, [], "x"],
    ["wcheck", ["wcheck"], "n"],
    ["refund", ["refund"], "n"],
  ];
  const DATE_LABEL = Object.fromEntries(DATES.map(d => [d[0], d[1]]));
  const STAGES = ["報竣", "竣工文件審查", "初驗／驗收", "驗收合格・結算", "付款・決算", "保固"];
  // [階段索引, 項目, 期限說明, 應完成日規則, 主辦, 檔案, 依據]
  const ITEMS = [
    [
      0,
      "廠商於預定竣工日前或竣工當日填報「工程竣工報告表」（含竣工圖）向監造及學校報備",
      "預定竣工日前或當日",
      ["plan", 0],
      "廠商",
      ["01a", "01b"],
      "基準17；工契15(二)",
    ],
    [0, "監造審查竣工報告表，轉學校核定", "收到後即辦", null, "監造", ["02"], "基準17"],
    [0, "學校核定廠商（建築師）竣工報告", "", null, "學校", ["03a", "03b"], "基準17"],
    [
      0,
      "學校會同監造、廠商依契約、圖說核對竣工項目及數量，查證是否竣工",
      "收受竣工報告日起7日內",
      ["report", 7],
      "學校／監造／廠商",
      ["04"],
      "基準17；工契15(二)4",
    ],
    [0, "確認廠商施工期間損壞或遷移之學校設施、公共設施已修復或回復", "會同查證時", null, "學校／監造", ["04"], "基準17"],
    [0, "監造做成「竣工查驗紀錄」報請學校核定", "查證屬實後2日內", ["verify", 2], "監造", ["04"], "基準17"],
    [1, "廠商提送竣工圖、結算明細表、結算數量計算書等竣工文件", "竣工次日起15日內", ["actual", 15], "廠商", ["05C", "05A"], "工契15(二)3"],
    [1, "監造審查結算資料並轉學校核定（會同丈量清點）", "審查期限7日", null, "監造", ["06"], "基準18"],
    [
      1,
      "備妥驗收抽核資料：契約文件、履約文件（估驗、契約變更、施工過程異動紀錄統計表）、竣工文件、檢（查、試）驗紀錄統計表",
      "初驗／驗收前",
      null,
      "監造",
      ["00"],
      "流程圖註3",
    ],
    [
      1,
      "督促廠商辦理驗收前事項：環境清理、餘料土方運離、拆除臨時設施、玻璃地板清潔、損鄰處理等",
      "驗收前",
      null,
      "監造／廠商",
      ["00"],
      "基準19；流程圖註4",
    ],
    [2, "確認本案是否須初驗（依校內初驗建議門檻或個案選擇）", "", null, "學校", ["00"], "工契15(二)5"],
    [2, "簽請辦理驗收，指派主驗（非承辦採購人員）、會驗、監辦人員；查核金額以上報上級機關監辦", "", null, "學校", ["07A"], "基準24"],
    [2, "發驗收通知予廠商、監造及相關單位", "", null, "學校", ["07B"], ""],
    [2, "辦理初驗或驗收（無初驗者直接驗收）", "收受竣工文件日起30日內", ["docs", 30], "學校／監造／廠商", ["08"], "基準20、23"],
    [2, "有初驗者：初驗合格後辦理驗收", "初驗合格後20日內", ["pre", 20], "學校／監造／廠商", ["08"], "基準22"],
    [2, "作成驗收紀錄，合格與不合格項目分別記載，瑕疵載明改正期限", "驗收當日", null, "學校", ["08"], "基準25"],
    [2, "驗收不合格：通知廠商於指定期限內改正（逾期計逾期違約金）", "依通知期限", null, "學校／廠商", ["09"], "工契15(十)"],
    [2, "廠商改正後辦理複驗（就紀錄所載瑕疵複驗）", "改正後次日起", null, "學校／監造／廠商", ["10"], "基準27"],
    [2, "確認現場施工機具、器材、廢棄物已全部運離或清除，方可認定驗收合格", "驗收合格前", null, "監造／廠商", ["00"], "工契15(七)"],
    [
      3,
      "填製「結算驗收證明書」（附結算明細表），主驗、監驗簽章並陳核",
      "驗收合格後15日內",
      ["accept", 15],
      "學校",
      ["11", "05B"],
      "流程圖註12",
    ],
    [3, "查核金額以上工程：結算驗收證明書轉報上級機關備查", "核定後", null, "學校", ["11"], "流程圖註12"],
    [3, "發函給廠商結算驗收證明書", "核定後", null, "學校", ["12"], ""],
    [3, "申報末期空氣污染防制費", "", null, "廠商／學校", ["13A", "13B"], ""],
    [
      4,
      "逐項確認竣工計價前應辦妥事項（工棚拆除、材料退料、管線修復、逾期罰款、竣工圖、保固保證金、末期空污費、設施復舊等）",
      "計價前",
      null,
      "監造／學校",
      ["14A"],
      "14A 檢核清單",
    ],
    [4, "填製竣工計價單", "", null, "監造／學校", ["14B"], ""],
    [
      4,
      "簽請付款：廠商繳納保固保證金、無待解決事項並提出請款單據後，一次給付尾款",
      "結算驗收證明書核定後30日內",
      ["cert", 30],
      "學校",
      ["14C"],
      "基準29",
    ],
    [4, "核定監造提送之監造報告書", "", null, "學校", ["15"], ""],
    [4, "付款後填製工程決算書", "付款後", null, "學校", ["16"], "施工及驗收基準表格30"],
    [5, "確認保固期起算日（一般為驗收合格日）並登錄保固期間", "驗收合格日", ["accept", 0], "學校", ["14A"], "工契16"],
    [5, "確認保固保證金已繳納或自尾款扣抵，並登記保管", "付款前", null, "學校／會計", ["14A", "14C"], "14A、14C"],
    [5, "保固期間發現瑕疵：通知廠商限期修補，並留存通知及修復紀錄", "保固期間", null, "學校／廠商", [], "工契16"],
    [5, "保固期滿前會勘，確認無待修瑕疵", "保固期滿日前（預計會勘日另列）", ["accept", "years"], "學校／廠商", [], "工契16"],
    [5, "保固期滿且無待解決事項，無息發還保固保證金", "保固期滿後", null, "學校／會計", [], "工契14、16"],
  ];
  const STATUS = ["未辦", "辦理中", "已完成", "不適用"];

  /** 嚴格解析 yyyy-mm-dd：2026-02-30 這類不存在的日期回傳 null，不會被 Date 自動進位成 3 月 */
  const pd = s => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
  };
  const valid = s => !!pd(s);
  /** 保固年數須能換算成整月（1、2、0.5、1.25 年可以；0.3 年＝3.6 個月不行） */
  const wholeMonths = y => {
    const n = parseFloat(String(y ?? "").trim());
    if (!isFinite(n) || n <= 0) return 0;
    return Math.abs(n * 12 - Math.round(n * 12)) < 1e-8 ? Math.round(n * 12) : 0;
  };
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const roc = s => {
    const d = pd(s);
    return d ? d.getFullYear() - 1911 + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + String(d.getDate()).padStart(2, "0") : "";
  };
  // ov：本案契約另有約定時的調整 { n 日數, unit 日曆天／工作天, incl 當日是否算入 }
  function dueOf(rule, dates, ctx, ov) {
    if (!rule) return "";
    if (ov && typeof rule[1] === "number" && rule[1] > 0) {
      const b = rule[0] === "actual" ? dates.actual || dates.verify : dates[rule[0]];
      const n = ov.n !== undefined && ov.n !== "" ? +ov.n : rule[1];
      if (pd(b) && ctx && ctx.countDays && ctx.cal) return ctx.countDays(b, n, ov.unit || "日曆天", !!ov.incl, ctx.cal);
    }
    const baseS = rule[0] === "plan" ? (ctx && ctx.plan) || "" : rule[0] === "actual" ? dates.actual || dates.verify : dates[rule[0]];
    const base = pd(baseS);
    if (!base) return "";
    if (rule[1] !== "years" && ctx && ctx.countDays && ctx.cal) return ctx.countDays(baseS, rule[1], "日曆天", false, ctx.cal);
    if (rule[1] === "years") {
      // 預計會勘日（wplan）只是安排，不覆寫保固期滿日；年數不能換算整月時不計算，交由畫面提示核對
      const months = wholeMonths(dates.years);
      if (!months) return "";
      // 加月數時，目標月份沒有同一天（如 2/29、1/31）就取該月最後一天（民法第121條）
      const mm = base.getMonth() + months,
        last = new Date(base.getFullYear(), mm + 1, 0).getDate();
      return iso(new Date(base.getFullYear(), mm, Math.min(base.getDate(), last)));
    }
    const d = new Date(base);
    d.setDate(d.getDate() + rule[1]);
    return iso(d);
  }
  // 「今天」一律以臺北時間為準（裝置設在其他時區時也不會差一天）
  let TWF = null;
  try {
    TWF = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" });
  } catch (e) {}
  const today = () => (TWF ? TWF.format(new Date()) : iso(new Date()));
  const twDate = v => {
    if (!v) return "";
    const d = new Date(v);
    return isNaN(d) ? "" : TWF ? TWF.format(d) : iso(d);
  };
  // 日期字串加減天數：全程用年月日計算，不經過 UTC，避免時區造成差一天
  const addDays = (s, n) => {
    const d = pd(s);
    if (!d || !Number.isInteger(Number(n || 0))) return "";
    d.setDate(d.getDate() + Number(n || 0));
    return iso(d);
  };
  /** 兩個日期相差幾天；以 UTC 年月日相減，不受裝置時區、日光節約影響；日期無效回傳 null */
  const daysBetween = (a, b) => {
    const x = pd(a),
      y = pd(b);
    if (!x || !y) return null;
    const u = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((u(y) - u(x)) / 86400000);
  };

  // 依預算判斷初驗、查核金額（預算未填時，以契約金額能確定的部分判斷）
  const num = v => {
    const n = parseFloat(String(v ?? "").replace(/,/g, ""));
    return isFinite(n) ? n : 0;
  };
  const fmt = n => NF_.format(Number(n));
  function money(ctx) {
    ctx = ctx || {};
    const budget = num(ctx.budget),
      amount = num(ctx.amount),
      preTh = num(ctx.preTh) || 2e7,
      auditTh = num(ctx.auditTh) || 5e7;
    const base = budget || amount,
      by = budget ? "預算" : "契約金額";
    // 逾＝大於（不含本數）；以上＝大於等於。金額只是「建議」，個案可在竣工驗收頁改選
    const suggested = budget ? budget > preTh : amount > preTh ? true : null;
    const mode = ctx.preMode === "required" || ctx.preMode === "exempt" ? ctx.preMode : "";
    const pre = mode === "required" ? true : mode === "exempt" ? false : suggested;
    const audit = budget ? budget >= auditTh : amount >= auditTh ? true : null;
    return { base, by, pre, suggested, mode, audit, preTh, auditTh };
  }
  // 自動狀態：回傳 [狀態, 說明, 推定完成日期]
  function autoStatus(i, dates, ctx) {
    ctx = ctx || {};
    const [key, dkeys, kind] = AUTO[i],
      m = money(ctx);
    const filledFrom = k => {
      const idx = ORDER.indexOf(k);
      return idx >= 0 && ORDER.slice(idx).some(x => valid(dates[x]));
    };
    const dateOf = () => {
      for (const k of dkeys) if (valid(dates[k])) return dates[k];
      return "";
    };
    // 已填驗收合格日（或更後面的日期）卻沒有初驗合格日：視為直接驗收，初驗相關項目不再卡住結案
    const skippedPre = !valid(dates.pre) && filledFrom("accept");
    const preWhy = () =>
      m.mode === "exempt"
        ? "個案選擇：免初驗"
        : skippedPre
          ? "已直接辦理驗收（未登錄初驗），視為免初驗"
          : `${m.by} ${fmt(m.base)} 元，未逾校內初驗建議門檻 ${fmt(m.preTh)} 元，建議免初驗`;
    if (kind === "x") return ["不適用", "未發生；若發生請改狀態", ""];
    if (kind === "pre" && !valid(dates.pre) && (m.pre === false || (skippedPre && m.pre !== true)))
      return ["不適用", preWhy(), ""];
    if (kind === "audit" && m.audit === false) return ["不適用", `${m.by} ${fmt(m.base)} 元，未達查核金額`, ""];
    if (kind === "decide") {
      if (m.mode) return ["已完成", m.mode === "required" ? "個案選擇：須初驗" : "個案選擇：免初驗", ""];
      if (skippedPre) return ["已完成", "已直接辦理驗收（未登錄初驗），視為免初驗", ""];
      if (valid(dates.pre)) return ["已完成", "已登錄初驗合格日", dates.pre];
      if (m.pre !== null)
        return ["已完成", m.pre ? `${m.by}逾校內初驗建議門檻 ${fmt(m.preTh)} 元，建議初驗` : preWhy(), ""];
    }
    if (kind === "w")
      return valid(dates.accept) && wholeMonths(dates.years) ? ["已完成", "依驗收合格日與保固期推定", dates.accept] : ["未辦", "", ""];
    // 保固追蹤才建檔的工程：已登錄驗收合格日時，保固會勘以前的例行事項推定已完成，不要求回頭補登
    const beforeWarranty = ITEMS[i][0] < 5 || ORDER.indexOf(key) < ORDER.indexOf("wcheck");
    if (ctx.entry === "warranty" && valid(dates.accept) && key && beforeWarranty)
      return ["已完成", "保固追蹤建檔：前置事項推定已完成", ""];
    if (key && filledFrom(key)) {
      const by = ORDER.slice(ORDER.indexOf(key)).find(x => valid(dates[x]));
      return ["已完成", "依「" + DATE_LABEL[by] + "」推定", dateOf()];
    }
    return ["未辦", "", ""];
  }

  // 計算一個工程的檢核狀態
  function evaluate(chk, now, ctx) {
    chk = chk || {};
    const dates = chk.dates || {},
      st = chk.items || {};
    now = now || today();
    let done = 0,
      total = 0,
      started = false,
      next = null,
      overdue = 0,
      stage = -1;
    ctx = Object.assign({}, ctx || {}, { preMode: chk.preMode });
    const m = money(ctx);
    const rows = ITEMS.map((it, i) => {
      const stored = (st[i] && st[i].s) || "",
        [aS, aNote, aD] = autoStatus(i, dates, ctx);
      const ov = (chk.rules || {})[i],
        s = stored || aS,
        due = dueOf(it[3], dates, ctx, ov);
      if (s !== "不適用") total++;
      if (s === "已完成") done++;
      if (stored && stored !== "未辦") started = true;
      const open = s !== "已完成" && s !== "不適用";
      // 停工中（第 1 項＝預定竣工日報竣）：原期限待核對，不列入正式逾期
      const hold = i === 0 && !!ctx.planHold;
      // 假日資料沒涵蓋到的年度：日期只是試算（不擋操作）
      const rule = it[3];
      const baseS = rule && (rule[0] === "plan" ? ctx.plan : rule[0] === "actual" ? dates.actual || dates.verify : dates[rule[0]]);
      const trial = due && rule && typeof rule[1] === "number" && ctx.cal && ctx.cal.coverNote ? ctx.cal.coverNote(baseS, due) : "";
      let left = null;
      if (open && due) {
        left = daysBetween(now, due);
        if (left < 0 && !hold) overdue++;
        if (!next || due < next.due) next = { i, due, left, item: it[1], hold };
      }
      if (open && stage < 0) stage = it[0];
      let item = it[1];
      if (i === 11 && m.audit === false) item += "（本案未達查核金額，免報上級機關監辦）";
      let when =
        ov && typeof (it[3] || [])[1] === "number" && it[3][1] > 0
          ? `${it[2]} → 本案契約：${ov.n !== undefined && ov.n !== "" ? ov.n : it[3][1]} ${ov.unit || "日曆天"}，` +
            (ov.incl ? "當日算入" : "次日起算")
          : it[2];
      if (trial) when += (when ? "；" : "") + trial;
      if (hold) when += (when ? "；" : "") + "停工中（原期限待核對）";
      if (i === 31 && valid(dates.wplan))
        when += `；預計會勘 ${roc(dates.wplan)}` + (due && dates.wplan > due ? "（晚於保固期滿日，請核對）" : "");
      return {
        i,
        stage: it[0],
        item,
        when,
        due,
        who: it[4],
        files: it[5].map(k => ({ name: FILES[k][0], url: U(FILES[k][1]) })),
        basis: it[6],
        s,
        auto: !stored,
        autoS: aS,
        autoNote: stored ? "" : aNote,
        autoD: aD,
        d: (st[i] && st[i].d) || (stored ? "" : aD),
        dStored: (st[i] && st[i].d) || "",
        note: (st[i] && st[i].n) || "",
        left,
        open,
        hold,
        trial,
        kind: AUTO[i][2],
      };
    });
    if (ORDER.some(k => valid(dates[k]))) started = true;
    return {
      rows,
      done,
      total,
      pct: total ? Math.round((done / total) * 100) : 0,
      started,
      next,
      overdue,
      stage: stage < 0 ? STAGES.length : stage,
    };
  }

  // 每個項目應留存的文件（缺件檢查用）
  const DOCS = {
    0: "工程竣工報告表（含竣工圖）",
    1: "監造轉送竣工報告",
    2: "學校核定竣工報告",
    3: "竣工確認紀錄",
    5: "竣工查驗紀錄",
    6: "竣工圖、結算明細表、結算數量計算書",
    7: "監造審查竣工文件",
    11: "驗收簽呈",
    12: "驗收通知",
    13: "初驗或驗收紀錄",
    14: "驗收紀錄",
    16: "限期改正通知",
    17: "複驗紀錄",
    19: "結算驗收證明書",
    20: "上級機關備查公文",
    21: "結算驗收證明書發函",
    22: "末期空污費申報",
    23: "竣工計價前檢核清單",
    24: "竣工計價單",
    25: "付款簽呈",
    26: "監造報告書核定",
    27: "工程決算書",
    29: "保固保證金收據",
    30: "瑕疵通知及修復紀錄",
    31: "保固期滿會勘紀錄",
    32: "保固保證金發還簽呈",
  };
  const warrantyEnd = dates => dueOf(["accept", "years"], dates || {});
  G.Checklist = {
    pd,
    valid,
    wholeMonths,
    twDate,
    addDays,
    warrantyEnd,
    DOCS,
    DATES,
    ORDER,
    STAGES,
    ITEMS,
    STATUS,
    FILES,
    evaluate,
    dueOf,
    roc,
    today,
    daysBetween,
    money,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
