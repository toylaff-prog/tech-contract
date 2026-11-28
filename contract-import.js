/* 匯入歷年契約：從去年的 Word（.docx）或貼上的文字，辨識工程會技術服務契約範本的填寫內容。
   做法：依範本填寫點（points.json）在文件中的先後順序，用填寫點前後的固定文字定位，讀出去年的勾選與填寫值。
   只回傳「去年寫了什麼」，今年採用什麼由承辦在核對畫面決定。 */
(function (G) {
  "use strict";
  const BOX_ON = "■☒☑✔✓▣",
    BOX_ANY = "□■☐☒☑✔✓▣";
  const SYM_ON = new Set(["F0FE", "F0FD", "F078", "F0FC", "F052", "F053", "F054"]),
    SYM_OFF = new Set(["F0A8", "F06F", "F071", "F0A1", "F0A3"]);
  const ATT2 = {
    建築工程: { plan: ["F222"], design: ["F230", "F231", "F242"], super: ["F247"], permit: ["F245"], tender: ["F246"] },
    非建築公共工程: { plan: ["F249"], design: ["F256", "F257", "F266"], super: ["F270"], permit: ["F268"], tender: ["F269"] },
  };
  const ART3 = {
    plan: ["F009", "F010", "F011", "F012", "F013"],
    design: ["F014", "F015", "F016", "F017", "F018"],
    super: ["F019", "F020", "F021", "F022", "F023"],
  };
  const MCOL = ["總包價法", "單價計算法", "建造費用百分比法", "服務成本加公費法", "計酬"];
  const PAY = { F482: "按月計酬", F483: "按日計酬", F484: "按時計酬" };
  // 已對應到工程欄位的填寫點；其他點有差異時列入「需人工確認」
  const MAPPED = new Set([
    "F002",
    "F003",
    "F040",
    "F338",
    "F339",
    "F340",
    "F341",
    "F285",
    "F421",
    "F485",
    "F369",
    "F370",
    "F371",
    "F342",
    "F343",
    "F477",
    "F478",
    "F479",
    ...Object.values(ATT2).flatMap(o => Object.values(o).flat()),
    ...Object.values(ART3).flat(),
    ...Object.keys(PAY),
  ]);

  /** 從 .docx 讀出純文字（段落以換行分隔；Wingdings 方框轉成 □／■） */
  async function docxText(JSZip, DOMParser, buf) {
    const zip = await JSZip.loadAsync(buf);
    const f = zip.file("word/document.xml");
    if (!f) throw new Error("這不是 Word（.docx）檔，或檔案已損毀");
    const doc = new DOMParser().parseFromString(await f.async("string"), "application/xml");
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const out = [];
    const ps = doc.getElementsByTagNameNS(W, "p");
    for (let i = 0; i < ps.length; i++) {
      let s = "";
      const walk = n => {
        for (let c = n.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          const ln = c.localName;
          if (ln === "p") continue; // 巢狀段落（文字方塊）另行處理
          if (ln === "t") s += c.textContent;
          else if (ln === "sym") {
            const ch = String(c.getAttributeNS(W, "char") || c.getAttribute("w:char") || "").toUpperCase();
            s += SYM_ON.has(ch) ? "■" : SYM_OFF.has(ch) ? "□" : "";
          } else if (ln === "checkbox") {
            /* w14:checkbox 的顯示字元已在 w:t 中 */
          } else walk(c);
        }
      };
      walk(ps[i]);
      out.push(s);
    }
    return out.join("\n");
  }

  // 比對用的正規化：去掉空白、方框統一、底線合併
  const norm = s =>
    String(s || "")
      .replace(/[\s　]+/g, "")
      .replace(/[□■☐☒☑✔✓▣]/g, "□")
      .replace(/_+/g, "_");
  function anchors(ctx) {
    const m = /【(☐|＿＿)】/.exec(ctx);
    if (!m) return null;
    const L = norm(ctx.slice(0, m.index)),
      R = norm(ctx.slice(m.index + m[0].length));
    // 左側文字取到前一個底線或填寫點為止；緊鄰的勾選框（例如「□其他」）一起當定位文字，
    // 否則「其他」兩個字會對到條文裡任何一個「其他」
    const seg = L.split(/_|】|【【/).pop(),
      bi = seg.lastIndexOf("□"),
      tail = bi >= 0 ? seg.slice(bi + 1) : seg;
    const cutL = (bi >= 0 && tail.length < 5 ? seg.slice(bi) : tail).slice(-10);
    const cutR = R.split(/[_□]|【/)[0].slice(0, 10);
    return { L: cutL, R: cutR, check: m[1] === "☐" };
  }

  // 附件標題（與範本處理 templater.js 的 REGION_HEADS 相同）。附件的填寫點只在自己的附件範圍內找，
  // 因為第3條附件1～4 都有一模一樣的「其他服務費用」條文，Word 裡通常只留下適用的那一份。
  const HEADS = [
    "第2條附件1",
    "第2條附件2",
    "第2條附件3",
    "第2條其他附件",
    "第3條附件1",
    "第3條附件2",
    "第3條附件3",
    "第3條附件4",
    "第5條附件1",
    "第5條附件2",
    "第5條附件3",
    "第8條附件",
  ];
  const secKey = sec => HEADS.find(h => String(sec || "").replace(/\s+/g, "").startsWith(h)) || "";
  /** 把文字整理成比對用的連續字串（去空白、底線合併），同時記下每個段落開頭在字串中的位置 */
  function flatten(text) {
    const src = String(text || "");
    let flat = "";
    const starts = new Set([0]);
    for (const ch of src) {
      if (ch === "\n") starts.add(flat.length);
      if (/[\s　]/.test(ch)) continue;
      if (ch === "_" && flat.endsWith("_")) continue;
      flat += ch;
    }
    return { flat, starts };
  }
  /** 各附件標題段落的位置：{ 附件: [起, 迄] }；正文（第一個附件標題之前）為 body。找不到任何標題時回傳 null */
  function regions(flat, starts) {
    const at = {};
    HEADS.forEach(h => {
      let i = -1;
      while ((i = flat.indexOf(h, i + 1)) >= 0) {
        // 標題要在段落開頭，而且不是「第3條附件1至附件4」這類引用
        if (starts.has(i) && !/^[至及、之所與或，。]/.test(flat.slice(i + h.length, i + h.length + 1))) {
          at[h] = i;
          break;
        }
      }
    });
    const order = Object.keys(at).sort((a, b) => at[a] - at[b]);
    if (!order.length) return null;
    const out = { body: [0, at[order[0]]] };
    order.forEach((h, k) => {
      out[h] = [at[h], k + 1 < order.length ? at[order[k + 1]] : flat.length];
    });
    return out;
  }

  /** 依填寫點順序在文字中定位。每個填寫點先找出所有可能位置，再挑一組「位置隨填寫點順序遞增、對上最多點」的組合
      （最長遞增子序列），避免某段條文被刪掉或改寫時，後面全部錯位。回傳 { values, ctx, found, total }
      opts.paras：文字來自 Word（段落分明）時為 true，填寫值不跨段落；貼上的文字可能在句子中間換行，不套用。 */
  function scan(text, points, opts) {
    opts = opts || {};
    const fl = flatten(text),
      flat = fl.flat; // 保留方框原字元
    const nt = norm(flat); // 與 flat 等長
    // 段落開頭的累計數，用來判斷兩個位置之間有沒有換段
    const brk = new Int32Array(flat.length + 1);
    for (let i = 1, n = 0; i <= flat.length; i++) {
      if (fl.starts.has(i)) n++;
      brk[i] = n;
    }
    const crosses = (a, b) => !!opts.paras && brk[b] > brk[a];
    const reg = regions(flat, fl.starts);
    // 同一條（例如第3條）有任何附件標題時，找不到標題的附件視為整段刪除；完全找不到標題（例如舊版編排不同）就不限制
    const art = h => h.replace(/(其他)?附件\d*$/, "");
    const range = p => {
      if (!reg) return null;
      const k = secKey(p.sec);
      if (!k) return reg.body;
      if (reg[k]) return reg[k];
      return Object.keys(reg).some(h => h !== "body" && art(h) === art(k)) ? [0, -1] : null;
    };
    const snippet = (a, b) => flat.slice(Math.max(0, a - 24), Math.min(flat.length, b + 24));
    const occ = (w, f) => {
      const out = [];
      if (!w) return out;
      let i = nt.indexOf(w, 0);
      while (i >= 0 && out.length < 400) {
        f(i, out);
        i = nt.indexOf(w, i + 1);
      }
      return out;
    };
    const cands = []; // [點序, 位置, 值, 起, 迄]
    let total = 0;
    points.forEach((p, pi) => {
      const a = anchors(p.ctx);
      if (!a || a.L.length + a.R.length < 3) return;
      total++;
      const rg = range(p),
        inRg = i => !rg || (i >= rg[0] && i < rg[1]);
      if (a.check) {
        const ok = i =>
          i >= 0 && nt[i] === "□" && (!a.R || nt.startsWith(a.R, i + 1)) && (!a.L || nt.slice(Math.max(0, i - a.L.length), i) === a.L);
        const list = a.R
          ? occ(a.R, (j, o) => {
              if (ok(j - 1)) o.push(j - 1);
            })
          : occ(a.L, (j, o) => {
              if (ok(j + a.L.length)) o.push(j + a.L.length);
            });
        list.filter(inRg).forEach(i => cands.push([pi, i, BOX_ON.includes(flat[i]) ? "V" : "X", i, i + 1]));
      } else if (a.L) {
        occ(a.L, (j, o) => {
          const st = j + a.L.length;
          if (!inRg(st)) return;
          let en;
          if (a.R) {
            en = nt.indexOf(a.R, st);
            // 填寫值和右側文字在範本裡是同一段，跨段落就是對錯位置
            if (en < 0 || en - st > 120 || crosses(j, en)) return;
          } else {
            en = st;
            // 沒有右側文字時讀到標點或段落結尾為止（避免把下一段的條文當成填寫值）
            while (en < flat.length && en - st < 60 && !/[，。；、（）]/.test(flat[en]) && !(opts.paras && fl.starts.has(en))) en++;
          }
          const v = flat.slice(st, en);
          if (/[□■☐☒☑]/.test(v) || v.length > 60 || v.includes(a.L)) return; // 含左側文字＝其實對到更前面的同名詞
          o.push(0);
          cands.push([pi, st, v, st, en]);
        });
      }
      // 只有右側文字的填空太容易對錯，不辨識
    });
    // 從最後一個點往前排（同一點位置遞增），求位置的最長嚴格遞減子序列。
    // 條文相同的點（例如建築與非建築附件都有「監造：」）搶同一個位置時，由排在前面的點取得。
    cands.sort((x, y) => y[0] - x[0] || x[1] - y[1]);
    const tails = [],
      tailIdx = [],
      prev = new Array(cands.length).fill(-1);
    cands.forEach((c, k) => {
      const key = -c[1];
      let lo = 0,
        hi = tails.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (tails[m] < key) lo = m + 1;
        else hi = m;
      }
      tails[lo] = key;
      tailIdx[lo] = k;
      prev[k] = lo ? tailIdx[lo - 1] : -1;
    });
    const values = {},
      ctx = {};
    let k = tails.length ? tailIdx[tails.length - 1] : -1,
      found = 0;
    while (k >= 0) {
      const [pi, , v, a, b] = cands[k],
        id = points[pi].id;
      if (!(id in values)) {
        let val = v;
        if (points[pi].kind !== "勾選") {
          val = val.replace(/^【|】$/g, "").replace(/^[_＿]+|[_＿]+$/g, "");
        }
        values[id] = val;
        ctx[id] = snippet(a, b);
        found++;
      }
      k = prev[k];
    }
    return { values, ctx, found, total };
  }

  const money = s => {
    const t = String(s || "").replace(/[,，\s元]/g, "");
    return /^\d+(\.\d+)?$/.test(t) ? t : "";
  };
  /** 在全文找某個關鍵字後面的金額，回傳候選 [{ value, ctx }] */
  function amountsNear(text, words, span) {
    const flat = String(text || "").replace(/[\s　]+/g, ""),
      out = [],
      seen = new Set();
    words.forEach(w => {
      let i = 0;
      while ((i = flat.indexOf(w, i)) >= 0) {
        const tail = flat.slice(i, i + w.length + (span || 30)),
          m = /(?:新臺幣|新台幣)?([0-9０-９][0-9０-９,，]{2,})元/.exec(tail);
        if (m) {
          const v = money(m[1].replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 65248)));
          const k = w + v;
          if (v && Number(v) >= 1000 && !seen.has(v)) {
            seen.add(v);
            out.push({ value: v, ctx: flat.slice(Math.max(0, i - 12), i + m.index + m[0].length + 8), word: w });
          }
        }
        i += w.length;
      }
    });
    return out;
  }

  /** 把辨識結果整理成工程欄位：每欄 { last, ctx, sure, options? , candidates? } */
  function analyze(text, points, opts) {
    opts = opts || {};
    const sc = scan(text, points, { paras: !!opts.paras }),
      v = sc.values,
      c = sc.ctx;
    const on = id => v[id] === "V";
    // 案名與廠商是最重要的兩欄：位置比對沒對上時，再單獨用條文找一次（例如貼上的文字順序不同）
    const flatAll = String(text || "").replace(/[\s\u3000]+/g, "");
    if (!v.F003) {
      const m = /茲為辦理【?([^【】]{2,80}?)】?案（以下簡稱本案）/.exec(flatAll);
      if (m) {
        v.F003 = m[1];
        c.F003 = flatAll.slice(Math.max(0, m.index - 10), m.index + m[0].length + 10);
      }
    }
    if (!v.F002) {
      // 各版範本的寫法可能是「受託人：」「受託廠商：」等，冒號也可能是半形
      const m = /受託(?:人|廠商|機構|單位)?[：:]([^（：:]{2,60})（以下簡稱乙方）/.exec(flatAll);
      if (m && !/^_+$/.test(m[1])) {
        v.F002 = m[1];
        c.F002 = flatAll.slice(Math.max(0, m.index - 6), m.index + m[0].length + 6);
      }
    }
    const F = {};
    const field = (k, last, ctx, extra) => {
      F[k] = Object.assign({ last: last == null ? "" : String(last), ctx: ctx || "" }, extra || {});
    };
    field("title", v.F003 || "", c.F003, { sure: !!v.F003 });
    field("vendor", v.F002 || "", c.F002, { sure: !!v.F002 });
    // 工程類型：先找附件2 的兩個區段標題（建築工程／公共工程不含建築），標「本案不適用」或被刪掉的不算。
    // 兩區段的勾選條文完全相同，只靠「■監造：」這類文字無法分辨類型。
    const HEAD = { 建築工程: "建築工程之規劃設計監造", 非建築公共工程: "公共工程（不包括建築工程）之規劃設計監造" };
    const live = Object.entries(HEAD)
      .filter(([, h]) => {
        let i = -1,
          ok = false;
        while ((i = flatAll.indexOf(h, i + 1)) >= 0) {
          const tail = flatAll.slice(i + h.length, i + h.length + 12);
          if (/^（本案不適用）|^本案不適用/.test(tail)) continue;
          if (/^甲方|^乙方|^[（(]?一/.test(tail) || tail) ok = true;
        }
        return ok;
      })
      .map(([t]) => t);
    const typeHits = Object.entries(ATT2)
      .filter(([, o]) => Object.values(o).flat().some(on))
      .map(([t]) => t);
    let type = "",
      typeSure = false;
    if (live.length === 1) {
      type = live[0];
      typeSure = true;
    } else if (live.length === 2 && typeHits.length === 1) {
      type = typeHits[0];
      typeSure = true;
    }
    field("type", type, live.length ? "附件2 有效區段：" + live.join("、") : "找不到附件2 區段標題", {
      sure: typeSure,
      options: !typeSure && typeHits.length > 1 ? typeHits : null,
    });
    // 委託階段：只有一個區段時，兩組相同條文的辨識結果都屬於這個區段；整組勾選點都找到才判斷「否」
    ["plan", "design", "super", "permit", "tender"].forEach(k => {
      const sets = live.length === 1 ? [ATT2["建築工程"][k], ATT2["非建築公共工程"][k]] : [ATT2[type || "建築工程"][k]];
      const ids = sets.find(ids => ids.every(id => id in v)) || sets.find(ids => ids.some(id => id in v)) || sets[0];
      const seen = ids.filter(id => id in v),
        yes = ids.some(on),
        all = seen.length === ids.length;
      field(k, yes ? "是" : all ? "否" : "", seen.map(id => c[id]).join("｜"), {
        sure: yes || all,
        partial: !yes && seen.length > 0 && !all,
      });
    });
    // 計價方式：各委託階段勾的是哪一欄；一致才預填，不一致或多選讓承辦選
    const phases = ["plan", "design", "super"].filter(k => F[k].last === "是");
    const cols = new Set();
    phases.forEach(ph =>
      ART3[ph].forEach((id, i) => {
        if (on(id)) cols.add(i);
      })
    );
    let methods = [...cols].map(i => MCOL[i]);
    if (methods.includes("計酬")) {
      const pay = Object.keys(PAY)
        .filter(on)
        .map(id => PAY[id]);
      methods = methods.filter(m => m !== "計酬").concat(pay.length ? pay : ["按月計酬"]);
    }
    methods = methods.filter(m => m !== "單價計算法");
    field("method", methods.length === 1 ? methods[0] : "", phases.flatMap(ph => ART3[ph].filter(on).map(id => c[id])).join("｜"), {
      sure: methods.length === 1,
      options: methods.length > 1 ? methods : null,
    });
    // 契約型態（附件2 分期／分區／開口契約）
    const shapes = [
      ["F369", "分期"],
      ["F370", "分區"],
      ["F371", "開口契約"],
    ]
      .filter(([id]) => on(id))
      .map(x => x[1]);
    field(
      "shape",
      shapes.length === 1 ? shapes[0] : shapes.length === 0 && ["F369", "F370", "F371"].some(id => id in v) ? "單一工程" : "",
      c.F371 || c.F369 || "",
      { sure: shapes.length <= 1 && ["F369", "F370", "F371"].some(id => id in v), options: shapes.length > 1 ? shapes : null }
    );
    // 數字：費率、適用範圍、交付天數
    field("rate", (v.F339 || "").replace(/[%％]/g, ""), c.F339, { sure: !!v.F339 });
    field("range", money(v.F340), c.F340, { sure: !!money(v.F340) });
    field("days", (v.F040 || "").replace(/[^\d.]/g, ""), c.F040, { sure: !!v.F040 });
    // 金額：契約上各處的服務費＋全文關鍵字，去重後列為候選
    const cand = [];
    const add = (val, ctx, label, conf) => {
      const m2 = money(val);
      if (m2 && !cand.some(x => x.value === m2))
        cand.push({ value: m2, ctx: ctx || "", label: label + "｜" + (conf || "條文定位"), conf: conf || "條文定位" });
    };
    add(v.F341, c.F341, "服務費用小計（百分比法）");
    add(v.F285, c.F285, "議定服務費（總包價法）");
    add(v.F421, c.F421, "服務費用上限（成本加公費）");
    add(v.F485, c.F485, "服務費用上限（計酬）");
    amountsNear(text, ["服務費用之小計", "議定服務費", "服務費用上限", "服務費用新臺幣", "服務費新臺幣", "契約價金總額"], 22).forEach(x =>
      add(x.value, x.ctx, "全文「" + x.word + "」附近", "關鍵字附近，信心較低")
    );
    // 只有「條文定位」得到的唯一金額才算確定；關鍵字附近找到的即使只有一個也要人工確認
    field("fee", cand.length === 1 && cand[0].conf === "條文定位" ? cand[0].value : "", cand[0] ? cand[0].ctx : "", {
      sure: cand.length === 1 && cand[0].conf === "條文定位",
      candidates: cand,
    });
    // 建造費用：契約通常不寫，由「服務費用小計 ÷ 費率」推算，另找全文的工程預算
    const costC = [];
    const r0 = parseFloat(String(v.F339 || "").replace(/[%％]/g, "")),
      f0 = Number(money(v.F341));
    if (r0 > 0 && f0 > 0)
      costC.push({ value: String(Math.round(f0 / (r0 / 100))), ctx: c.F341 || "", label: "由服務費用小計 ÷ 費率推算｜推算值，請核對" });
    amountsNear(text, ["工程預算", "工程經費", "預估建造費用", "建造費用預算"], 22).forEach(x => {
      if (!costC.some(y => y.value === x.value))
        costC.push({ value: x.value, ctx: x.ctx, label: "全文「" + x.word + "」附近｜關鍵字附近，信心較低" });
    });
    field("cost", "", costC[0] ? costC[0].ctx : "", { sure: false, candidates: costC });
    // 用舊版範本辨識時，「需人工確認」仍以目前使用的範本比對（填寫點編號在各版之間是對應好的）
    const review = reviewList(v, c, opts.reviewPoints || points, opts.defaults || {});
    return { fields: F, review, found: sc.found, total: sc.total, values: v, ctx: c };
  }

  /** 需人工確認：已對應欄位以外，去年和「今年這份設定會產生的值」不同的勾選或填寫。今年採用值改變時可重算。 */
  function reviewList(v, c, points, now) {
    const on = id => v[id] === "V",
      tplText = points.map(p => norm(p.ctx)).join("|"),
      review = [];
    points.forEach(p => {
      if (MAPPED.has(p.id) || !(p.id in v)) return;
      const old = v[p.id],
        cur = now[p.id] !== undefined ? now[p.id] : p.kind === "勾選" ? (p.orig === "■" ? "V" : "X") : "";
      if (p.kind === "勾選") {
        if (old !== (cur === "V" || cur === "■" ? "V" : "X"))
          review.push({
            id: p.id,
            kind: p.kind,
            sec: p.sec,
            old: old === "V" ? "■ 有勾" : "□ 沒勾",
            now: cur === "V" || cur === "■" ? "■ 有勾" : "□ 沒勾",
            value: old,
            ctx: c[p.id],
          });
      } else if (old && old.length <= 40 && old !== cur && old !== String(p.def || "") && !tplText.includes(norm(old)))
        review.push({ id: p.id, kind: p.kind, sec: p.sec, old, now: cur || "（空白）", value: old, ctx: c[p.id] });
    });
    if (on("F371"))
      review.unshift({
        id: "F371",
        kind: "勾選",
        sec: "第3條附件2",
        old: "■ 開口契約",
        now: "依本案「契約型態」",
        value: "V",
        ctx: c.F371,
        shape: true,
      });
    return review;
  }
  /* ---------- 不同版本的範本 ----------
     工程會每次改版，條文文字會變，填寫點前後的固定文字也跟著變。範本管理上傳過的每一版都有自己的填寫點，
     而且編號已和現行版對應好（templater.js 的 matchPoints），所以用「去年那一版」的填寫點辨識，結果可直接套到今年。 */
  const VER_RE = /\d{2,3}\.\d{1,2}\.\d{1,2}/;
  /** 契約封面上的範本版本，例如「（115.4.23版）」→ "115.4.23"；找不到回傳 "" */
  function detectVersion(text) {
    const m = /[（(]\s*(\d{2,3}\.\d{1,2}\.\d{1,2})\s*版\s*[）)]/.exec(String(text || "").slice(0, 3000));
    return m ? m[1] : "";
  }
  /** 範本名稱裡的版本號（「115.4.23」「114.3.10（待審）」都取出數字部分） */
  const versionOf = s => (VER_RE.exec(String(s || "")) || [""])[0];
  /** 從可用的範本中挑辨識效果最好的一版：版本號相同的優先，其次是對上最多填寫點的。
      cands：[{ id, version, points }]，回傳 { pick, scores: [{ id, version, found, total }] } */
  function pickTemplate(text, cands, opts) {
    const want = detectVersion(text),
      scores = cands.map(t => {
        const sc = scan(text, t.points, opts);
        return { id: t.id, version: t.version, found: sc.found, total: sc.total };
      });
    const same = scores.filter(x => want && versionOf(x.version) === want);
    const pool = same.length ? same : scores;
    const best = pool.reduce((a, b) => (b.found > a.found ? b : a), pool[0]);
    return { pick: cands[scores.indexOf(best)], want, exact: same.length > 0, scores };
  }
  G.ContractImport = { reviewList, docxText, scan, analyze, amountsNear, norm, detectVersion, versionOf, pickTemplate };
})(typeof globalThis !== "undefined" ? globalThis : this);
