/* 公文簽稿：依工程資料自動帶入常用簽、函的草稿（可複製到公文系統或下載 Word）。 */
(function (G) {
  "use strict";
  const NF_ = new Intl.NumberFormat("en-US"); // 共用一個數字格式器（每次建立很慢）
  const C = () => G.Checklist;
  const num = v => Number(String(v == null ? "" : v).replace(/[,\s]/g, "")) || 0;
  const money = v => (num(v) ? NF_.format(num(v)) : "");
  const amt = v => (money(v) ? "新臺幣" + money(v) + "元" : "新臺幣○○元");
  /** 付款金額嚴格解析：只接受非負整數（可含正確的千分位逗號）；
      空白、負數、小數、科學記號（1e4）、全形數字一律回傳 null */
  const strictInt = v => {
    const t = String(v ?? "").trim();
    if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)$/.test(t)) return null;
    const n = Number(t.replace(/,/g, ""));
    return Number.isSafeInteger(n) ? n : null;
  };
  /** 付款簽呈的金額核對：回傳 { pay, blocked }，blocked 有文字時不得產出 */
  function payCheck(v) {
    const fin = strictInt(v.final),
      paid = strictInt(v.paid);
    if (fin === null || paid === null)
      return {
        pay: null,
        blocked:
          "請填結算金額與已付估驗計價款（未付款請填 0）：只接受非負整數，可含千分位逗號；" + "不接受空白、負數、小數、科學記號或全形數字。",
      };
    if (paid > fin) return { pay: null, blocked: "已付估驗計價款超過結算金額（超付），請核對金額。" };
    if (paid === fin) return { pay: 0, blocked: "結算金額等於已付金額，本案沒有應付尾款，不需產出付款簽呈。" };
    return { pay: fin - paid, blocked: "" };
  }
  const rocLong = d => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ""))) return "○○年○○月○○日";
    const [y, m, dd] = d.split("-").map(Number);
    return `${y - 1911}年${m}月${dd}日`;
  };
  const val = (v, ph) => (v !== undefined && v !== null && String(v).trim()) || ph || "○○";
  const NUMS = "一二三四五六七八九十";
  const today = () => G.Checklist.today();

  /** 施工契約名稱：優先用「施工」頁填的，否則由技術服務案名去掉「委託…」推得 */
  function projName(p) {
    const b = p.build || {};
    if (b.title) return b.title;
    const t = String(p.title || "")
      .replace(/(委託)?(規劃|設計|監造|技術服務|專案管理)[^工程]*$/, "")
      .replace(/委託$/, "");
    return t || p.name || "○○工程";
  }

  function facts(p, school, ev) {
    const b = p.build || {},
      d = (p.chk || {}).dates || {},
      m = C().money({ budget: b.budget, amount: b.amount, preTh: school.preTh, auditTh: school.auditTh });
    const rows = (ev && ev.accept && ev.accept.rows) || [];
    return {
      school: school.party || "本校",
      unit: school.unit || "總務處",
      proj: projName(p),
      vendor: b.name || "",
      supervisor: p.super === "是" ? p.vendor || "" : b.supervisor || "",
      amount: b.amount,
      budget: b.budget,
      start: b.start,
      plan: ev && ev.plan ? ev.plan.date : "",
      d,
      pre: m.pre === true || !!d.pre,
      audit: m.audit === true,
      wEnd: (rows[31] || {}).due || "",
      years: d.years,
    };
  }

  // 欄位：[鍵, 標籤, 類型(text/date/textarea), 預設值函式(f) , 說明]
  const DOCS = [
    {
      id: "acceptReq",
      item: 11,
      kind: "簽",
      label: "簽請辦理驗收",
      fields: f => [
        ["date", "簽辦日期", "date", today()],
        ["accDate", (f.pre ? "初驗" : "驗收") + "日期", "date", ""],
        ["accTime", "時間", "text", "上午9時30分"],
        ["place", "地點", "text", "本校工程現場"],
        ["chief", "主驗人員", "text", "", "不得為承辦採購人員"],
        ["co", "會驗人員", "text", "監造單位及使用單位"],
        ["sup", "監辦單位", "text", "主（會）計室"],
      ],
      build: (f, v) => {
        const act = f.pre ? "初驗" : "驗收";
        return {
          subject: `本校「${f.proj}」業已竣工，擬於${rocLong(v.accDate)}${val(v.accTime, "")}辦理${act}，並請指派主驗、會驗及監辦人員，簽請核示。`,
          items: [
            `本工程由${val(f.vendor, "○○營造有限公司")}承攬，契約金額${amt(f.amount)}，` +
              `於${rocLong(f.start)}開工，${
                f.d.verify
                  ? `經會同監造單位及廠商於${rocLong(f.d.verify)}查證竣工屬` +
                    `實${f.d.actual ? `，實際竣工日為${rocLong(f.d.actual)}` : ""}`
                  : "業已報請竣工"
              }。`,
            f.d.docs
              ? `監造單位已於${rocLong(f.d.docs)}送達竣工圖表及結算資料，經審查完竣，依政府採購法及其施行細則規定辦理${act}。`
              : `竣工圖表及結算資料收件情形：○○（請承辦確認，並填「機關收受竣工文件日」）；俟資料齊備後，依政府採購法及其施行細則規定辦理${act}。`,
            `擬請指派${val(v.chief, "○○○")}為主驗人員、${val(v.co)}為會驗人員，並請${val(v.sup)}派員監辦${f.audit ? "；本工程達查核金額，另函報請上級機關派員監辦" : ""}。`,
            `${act}時間：${rocLong(v.accDate)}${val(v.accTime, "")}；地點：${val(v.place)}。`,
          ],
          after: `擬辦：奉核後，函請廠商、監造單位及相關人員依時辦理${act}。`,
        };
      },
    },
    {
      id: "acceptNotice",
      item: 12,
      kind: "函",
      label: "驗收通知",
      fields: f => [
        ["date", "發文日期", "date", today()],
        ["to", "受文者", "text", f.vendor],
        ["accDate", (f.pre ? "初驗" : "驗收") + "日期", "date", ""],
        ["accTime", "時間", "text", "上午9時30分"],
        ["place", "地點", "text", "本校工程現場"],
        ["contact", "聯絡人", "text", ""],
        ["phone", "電話", "text", ""],
        ["cc", "副本", "text", [f.supervisor, "本校主（會）計室", f.audit ? "上級機關" : ""].filter(Boolean).join("、")],
      ],
      build: (f, v) => {
        const act = f.pre ? "初驗" : "驗收";
        return {
          subject: `本校「${f.proj}」訂於${rocLong(v.accDate)}${val(v.accTime, "")}辦理${act}，請 貴公司派員會同辦理，請 查照。`,
          items: [
            "依本校與 貴公司簽訂之工程契約辦理。",
            `${act}地點：${val(v.place)}。請 貴公司備妥契約、竣工圖、結算明細表及相關檢（試）驗資料，並指派熟悉本工程之人員到場說明。`,
            `${act}結果如有與契約、圖說或貨樣規定不符者，將依契約規定通知限期改正。`,
            `本案聯絡人：${val(v.contact, "○○○")}，電話：${val(v.phone, "○○")}。`,
          ],
          to: val(v.to, "○○營造有限公司"),
          cc: v.cc,
        };
      },
    },
    {
      id: "fixNotice",
      item: 16,
      kind: "函",
      label: "驗收不合格限期改正",
      fields: f => [
        ["date", "發文日期", "date", today()],
        ["to", "受文者", "text", f.vendor],
        ["accDate", "驗收（初驗）日期", "date", f.d.pre || f.d.accept || ""],
        ["defects", "應改正項目（一行一項）", "textarea", ""],
        ["due", "改正期限", "date", ""],
        ["cc", "副本", "text", f.supervisor],
      ],
      build: (f, v) => {
        const defects = String(v.defects || "")
          .split(/\n+/)
          .map(s => s.trim())
          .filter(Boolean);
        return {
          subject: `本校「${f.proj}」於${rocLong(v.accDate)}驗收結果與契約規定不符，請 貴公司於${rocLong(v.due)}前改正完成並通知本校辦理複驗，請 查照。`,
          items: [
            `依本校${rocLong(v.accDate)}驗收紀錄辦理。`,
            "應改正項目如下：" + (defects.length ? "\n" + defects.map((x, i) => `（${NUMS[i] || i + 1}）${x}`).join("\n") : "\n（一）○○"),
            "請於期限內改正完成並以書面通知本校，以憑辦理複驗；逾期未改正者，依契約規定計算逾期違約金。",
          ],
          to: val(v.to, "○○營造有限公司"),
          cc: v.cc,
        };
      },
    },
    {
      id: "payment",
      item: 25,
      kind: "簽",
      label: "驗收後付款",
      fields: f => [
        ["date", "簽辦日期", "date", today()],
        ["final", "結算金額（元）", "text", ""],
        ["paid", "已付估驗計價款（元）", "text", ""],
        ["deposit", "保固保證金（元）", "text", ""],
        ["source", "經費來源", "text", ""],
      ],
      build: (f, v) => {
        const { pay, blocked } = payCheck(v);
        return {
          blocked,
          subject: blocked ? "【金額待核對】" + blocked : `本校「${f.proj}」業經驗收合格，擬支付尾款${amt(pay)}，請核示。`,
          items: [
            `本工程由${val(f.vendor, "○○營造有限公司")}承攬，契約金額${amt(f.amount)}，於${rocLong(f.d.accept)}驗收合格，` +
              `結算驗收證明書於${rocLong(f.d.cert)}核定，結算金額${amt(v.final)}。`,
            `本工程已付估驗計價款${amt(v.paid)}，本次應付尾款${amt(pay)}。`,
            `廠商已繳納保固保證金${amt(v.deposit)}並提出請款單據，竣工計價前應辦事項均已辦妥，無待解決事項。`,
            `所需經費由${val(v.source, "○○")}項下支應。`,
          ],
          after: "擬辦：奉核後，依規定辦理付款。",
        };
      },
    },
    {
      id: "depositReturn",
      item: 32,
      kind: "簽",
      label: "保固保證金發還",
      fields: f => [
        ["date", "簽辦日期", "date", today()],
        ["wEnd", "保固期滿日", "date", f.wEnd],
        ["check", "保固期滿會勘日", "date", f.d.wcheck || ""],
        ["deposit", "保固保證金（元）", "text", ""],
      ],
      build: (f, v) => ({
        subject: `本校「${f.proj}」保固期已於${rocLong(v.wEnd)}屆滿，經會勘無待修瑕疵，擬無息發還保固保證金${amt(v.deposit)}予${val(f.vendor, "○○營造有限公司")}，請核示。`,
        items: [
          `本工程於${rocLong(f.d.accept)}驗收合格，保固期${val(f.years, "○")}年，於${rocLong(v.wEnd)}屆滿。`,
          `本校已於${rocLong(v.check)}會同${f.supervisor ? "監造單位及" : ""}廠商辦理保固期滿會勘，確認無待修瑕疵，亦無待解決事項。`,
          "依契約規定，保固期滿且無待解決事項後，無息發還保固保證金。",
        ],
        after: "擬辦：奉核後，通知廠商檢具收據領回保固保證金。",
      }),
    },
  ];

  /** 產生一份簽稿：回傳 { doc, fields, values, subject, items, after, to, cc, text, parts } */
  function make(id, p, school, ev) {
    const doc = DOCS.find(x => x.id === id) || DOCS[0];
    const f = facts(p, school, ev),
      stored = (p.gov || {})[doc.id] || {};
    const fields = doc.fields(f),
      values = {};
    fields.forEach(([k, , , dft]) => {
      values[k] = stored[k] !== undefined ? stored[k] : dft || "";
    });
    const r = doc.build(f, values);
    const head =
      doc.kind === "簽"
        ? [`簽　於${f.unit}`, `日期：中華民國${rocLong(values.date)}`]
        : [
            `${f.school}　函`,
            `受文者：${r.to || ""}`,
            `發文日期：中華民國${rocLong(values.date)}`,
            "發文字號：",
            "速別：普通件",
            "密等及解密條件或保密期限：",
            "附件：",
          ];
    const body = r.items.map((x, i) => `${NUMS[i]}、${x}`);
    const tail =
      doc.kind === "簽" ? [r.after || "", "敬陳", "主任", "校長"].filter(Boolean) : [`正本：${r.to || ""}`, `副本：${r.cc || ""}`];
    const text = [...head, "", `主旨：${r.subject}`, "說明：", ...body, "", ...tail].join("\n");
    return Object.assign({ doc, fields, values, text, head, body, tail, explain: body.join("\n") }, r);
  }

  // ---------- Word（.docx） ----------
  const x = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // left／hanging 以 twip 計（14pt 一個中文字約 280）
  function para(text, o) {
    o = o || {};
    const ind = o.left || o.hanging ? `<w:ind w:left="${o.left || 0}" w:hanging="${o.hanging || 0}"/>` : "";
    const rpr = o.size ? `<w:rPr>${o.b ? "<w:b/>" : ""}<w:sz w:val="${o.size * 2}"/><w:szCs w:val="${o.size * 2}"/></w:rPr>` : "";
    return (
      `<w:p><w:pPr>${o.keep ? "<w:keepNext/>" : ""}<w:spacing w:after="${o.after || 0}" ` +
      `w:line="400" w:lineRule="exact"/>${ind}${
        o.center ? "<w:jc " + 'w:val="center"/>' : ""
      }${rpr}</w:pPr><w:r>${rpr}<w:t xml:space="preserve">${x(text)}</w:t></w:r></w:p>`
    );
  }
  function documentXml(g) {
    const ps = [];
    g.head.forEach((h, i) => ps.push(i === 0 ? para(h, { size: 20, b: true, center: g.doc.kind === "函", after: 160 }) : para(h)));
    ps.push(para(""));
    ps.push(para(`主旨：${g.subject}`, { left: 840, hanging: 840, after: 60 }));
    ps.push(para("說明：", { keep: true }));
    g.body.forEach(b => {
      const lines = b.split("\n");
      ps.push(para(lines[0], { left: 1120, hanging: 560 }));
      lines.slice(1).forEach(l => ps.push(para(l, { left: 1960, hanging: 840 })));
    });
    ps.push(para(""));
    g.tail.forEach(t => ps.push(para(t, t.startsWith("擬辦") ? { left: 840, hanging: 840 } : {})));
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ` +
      `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${ps.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" ` +
      `w:right="1304" w:bottom="1440" w:left="1304" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>`
    );
  }
  const STYLES =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ` +
    `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults>` +
    `<w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" ` +
    `w:eastAsia="標楷體" w:cs="Times New Roman"/><w:sz w:val="28"/><w:szCs w:val="28"/><w:lang ` +
    `w:val="en-US" w:eastAsia="zh-TW"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing ` +
    `w:after="0" w:line="400" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults><w:style ` +
    `w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;
  async function docx(JSZip, g) {
    if (g.blocked) throw new Error(g.blocked);
    const z = new JSZip();
    z.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types ` +
        `xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default ` +
        `Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/><Override ` +
        `PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wo` +
        `rdprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ` +
        `ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
    );
    z.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ` +
        `xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship ` +
        `Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeD` +
        `ocument" Target="word/document.xml"/></Relationships>`
    );
    z.file(
      "word/_rels/document.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ` +
        `xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship ` +
        `Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    );
    z.file("word/document.xml", documentXml(g));
    z.file("word/styles.xml", STYLES);
    return z.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  G.GovDocs = { DOCS, make, docx, projName, rocLong, strictInt, payCheck };
})(typeof globalThis !== "undefined" ? globalThis : this);
