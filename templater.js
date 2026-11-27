/* 範本處理：從 docx 找出所有填寫點、與舊版比對、記號化，產生網站可用的範本資產。
   演算法與當初建立 115.4.23 版資產的 Python 程式一致。瀏覽器與 Node 共用。 */
(function (G) {
  "use strict";
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
  const XS = "http://www.w3.org/XML/1998/namespace";
  const PAT = /_{2,}|＿+|(?<=【)[ 　]+(?=】)|[□■]/g;

  const kidEls = el => {
    const a = [];
    for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) a.push(c);
    return a;
  };
  const kid = (el, name) => kidEls(el).find(e => e.namespaceURI === W && e.localName === name) || null;
  const isW = (el, name) => el && el.nodeType === 1 && el.namespaceURI === W && el.localName === name;
  function closestP(n) {
    let a = n.parentNode;
    while (a && !isW(a, "p")) a = a.parentNode;
    return a;
  }
  function paraRuns(p) {
    const out = [],
      ts = p.getElementsByTagNameNS(W, "t");
    for (let i = 0; i < ts.length; i++) if (closestP(ts[i]) === p) out.push(ts[i]);
    return out;
  }
  const paraText = p =>
    paraRuns(p)
      .map(t => t.textContent || "")
      .join("");
  function inTable(p) {
    let a = p.parentNode;
    while (a) {
      if (isW(a, "tc")) return true;
      a = a.parentNode;
    }
    return false;
  }
  function ancestor(n, name) {
    let a = n.parentNode;
    while (a && !isW(a, name)) a = a.parentNode;
    return a;
  }
  const pyStrip = s => s.replace(/^\s+|\s+$/g, "");

  function numInfo(p) {
    const ppr = kid(p, "pPr");
    if (!ppr) return null;
    const np = kid(ppr, "numPr");
    if (!np) return null;
    const il = kid(np, "ilvl"),
      id = kid(np, "numId");
    return { ilvl: il ? il.getAttributeNS(W, "val") : null, numId: id ? id.getAttributeNS(W, "val") : null };
  }

  function makeCtx(p, txt, a, b, kind) {
    let before = txt.slice(Math.max(0, a - 45), a);
    let after = txt.slice(b, b + (kind === "勾選" ? 45 : 30));
    if (kind === "勾選") {
      const m = after.search(/[□■]/);
      if (m > 2) after = after.slice(0, m);
      before = /[□■]/.test(before) ? before.split(/[□■]/).pop().slice(-25) : before.slice(-25);
    }
    const mark = kind === "勾選" ? "【☐】" : "【＿＿】";
    let core = pyStrip(before + mark + after);
    if (pyStrip(txt).length <= 2) {
      const tr = ancestor(p, "tr");
      if (tr) {
        let row = Array.from(tr.getElementsByTagNameNS(W, "p")).map(paraText).join("");
        row = pyStrip(row.replace(/\s+/g, " "));
        core = mark + " " + row.replace(/^[□■ ]+/, "").slice(0, 70);
      }
    }
    return core.replace(/\s+/g, " ");
  }

  // 讀出空格後方「未載明者，為○○」的預設值（同一段落、最近的一個）
  const DEF_RE =
    /未(?:載明|填寫|勾選|約定)(?:者|時)?[^，,為以）)]{0,8}[，,]?\s*(?:均|分別)?(?:為|以)\s*((?:\d[\d,.]*\d|\d)[^）)；;。，,\d]{0,12}|[^）)；;。，,]{1,30})/;
  function extractDefault(txt, end) {
    const rest = txt.slice(end, end + 120);
    const stop = rest.search(/_{2,}|＿+|[□■]/);
    const seg = stop >= 0 ? rest.slice(0, stop) : rest;
    const m = DEF_RE.exec(seg);
    return m ? m[1].trim() : "";
  }

  // 找出所有填寫點（依文件順序）
  function indexPoints(doc) {
    const body = doc.getElementsByTagNameNS(W, "body")[0];
    const ps = Array.from(body.getElementsByTagNameNS(W, "p"));
    let artNum = "11";
    for (const p of ps) {
      if (pyStrip(paraText(p)).startsWith("契約文件及效力")) {
        const ni = numInfo(p);
        if (ni && ni.numId) artNum = ni.numId;
        break;
      }
    }
    let art = 0,
      sec = "前言",
      n = 0,
      label = "";
    const out = [];
    for (const p of ps) {
      const txt = paraText(p),
        s = pyStrip(txt);
      const ni = numInfo(p);
      if (ni && ni.numId === artNum && (ni.ilvl === null || ni.ilvl === "0") && !/^第\d+條附件/.test(s)) {
        art++;
        sec = "第" + art + "條 " + s.slice(0, 14);
      }
      if (/^(第\d+條附件\d*)/.test(s) && s.length < 40) sec = s.slice(0, 20);
      if (s.startsWith("附錄") && s.length < 30) sec = s.slice(0, 20);
      if (s.startsWith("契約範本使用說明")) sec = "使用說明";
      if (s.startsWith("立契約人")) sec = "前言";
      PAT.lastIndex = 0;
      let m;
      while ((m = PAT.exec(txt))) {
        n++;
        const tok = m[0],
          kind = tok === "□" || tok === "■" ? "勾選" : "填空";
        out.push({
          id: "F" + String(n).padStart(3, "0"),
          sec,
          label,
          kind,
          ctx: makeCtx(p, txt, m.index, m.index + tok.length, kind),
          orig: tok,
          dflt: tok === "■" ? "V" : "",
          def: kind === "填空" ? extractDefault(txt, m.index + tok.length) : "",
          _p: p,
          _s: m.index,
          _e: m.index + tok.length,
        });
      }
      if (s.length >= 4 && s[0] !== "□" && s[0] !== "■" && !inTable(p)) label = s.replace(/\s+/g, " ").slice(0, 40);
    }
    return out;
  }

  // 以新文字取代段落文字 [start,end)
  function setRange(p, start, end, text) {
    let pos = 0,
      first = true;
    for (const t of paraRuns(p)) {
      const s = t.textContent || "",
        a = pos,
        b = pos + s.length;
      pos = b;
      if (b <= start || a >= end) continue;
      const ls = Math.max(start, a) - a,
        le = Math.min(end, b) - a;
      if (first) {
        t.textContent = s.slice(0, ls) + text + s.slice(le);
        t.setAttributeNS(XS, "xml:space", "preserve");
        first = false;
      } else t.textContent = s.slice(0, ls) + s.slice(le);
    }
  }
  const U_ORDER = new Set([
    "rStyle",
    "rFonts",
    "b",
    "bCs",
    "i",
    "iCs",
    "caps",
    "smallCaps",
    "strike",
    "dstrike",
    "outline",
    "shadow",
    "emboss",
    "imprint",
    "noProof",
    "snapToGrid",
    "vanish",
    "webHidden",
    "color",
    "spacing",
    "w",
    "kern",
    "position",
    "sz",
    "szCs",
    "highlight",
  ]);
  function splitRunInsert(t, pre, mid, post) {
    const doc = t.ownerDocument,
      r = t.parentNode,
      kids = kidEls(r),
      idx = kids.indexOf(t);
    const rPost = r.cloneNode(true);
    kids.slice(idx + 1).forEach(ch => r.removeChild(ch));
    t.textContent = pre;
    t.setAttributeNS(XS, "xml:space", "preserve");
    const pk = kidEls(rPost);
    pk.forEach((ch, i) => {
      if (i < idx && ch.localName !== "rPr") rPost.removeChild(ch);
    });
    pk[idx].textContent = post;
    pk[idx].setAttributeNS(XS, "xml:space", "preserve");
    const rMid = doc.createElementNS(W, "w:r");
    const rpr0 = kid(r, "rPr");
    const rpr = rpr0 ? rpr0.cloneNode(true) : doc.createElementNS(W, "w:rPr");
    rMid.appendChild(rpr);
    kidEls(rpr)
      .filter(e => e.localName === "u")
      .forEach(e => rpr.removeChild(e));
    const u = doc.createElementNS(W, "w:u");
    u.setAttributeNS(W, "w:val", "single");
    let pos = 0;
    kidEls(rpr).forEach((ch, i) => {
      if (U_ORDER.has(ch.localName)) pos = i + 1;
    });
    const ref = kidEls(rpr)[pos] || null;
    rpr.insertBefore(u, ref);
    const tm = doc.createElementNS(W, "w:t");
    tm.textContent = mid;
    tm.setAttributeNS(XS, "xml:space", "preserve");
    rMid.appendChild(tm);
    r.parentNode.insertBefore(rMid, r.nextSibling);
    r.parentNode.insertBefore(rPost, rMid.nextSibling);
  }

  function tokenize(points) {
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i],
        tok = "⟦" + p.id + "⟧";
      const blank = p.kind === "填空" && p.orig.replace(/[ 　]/g, "") !== "";
      if (!blank) {
        setRange(p._p, p._s, p._e, tok);
        continue;
      }
      let pos = 0,
        done = false;
      for (const t of paraRuns(p._p)) {
        const s = t.textContent || "",
          a = pos,
          b = pos + s.length;
        pos = b;
        if (a <= p._s && p._e <= b) {
          splitRunInsert(t, s.slice(0, p._s - a), tok, s.slice(p._e - a));
          done = true;
          break;
        }
      }
      if (!done) {
        setRange(p._p, p._s, p._e, tok);
        for (const t of paraRuns(p._p)) {
          const s = t.textContent || "",
            k = s.indexOf(tok);
          if (k >= 0) {
            splitRunInsert(t, s.slice(0, k), tok, s.slice(k + tok.length));
            break;
          }
        }
      }
    }
  }

  const REGION_HEADS = [
    ["A21", "第2條附件1"],
    ["A22", "第2條附件2"],
    ["A23", "第2條附件3"],
    ["A2X", "第2條其他附件"],
    ["A31", "第3條附件1"],
    ["A32", "第3條附件2"],
    ["A33", "第3條附件3"],
    ["A34", "第3條附件4"],
    ["A51", "第5條附件1"],
    ["A52", "第5條附件2"],
    ["A53", "第5條附件3"],
    ["A8", "第8條附件"],
  ];
  const REGIONS = ["A21", "A22", "A23", "A31", "A32", "A33", "A34", "A51", "A52", "A53"];
  function findRegions(doc) {
    const body = doc.getElementsByTagNameNS(W, "body")[0],
      kids = kidEls(body);
    const idx = {};
    REGION_HEADS.forEach(([k, pre]) => {
      const i = kids.findIndex(ch => isW(ch, "p") && pyStrip(paraText(ch)).startsWith(pre));
      if (i >= 0) idx[k] = i;
    });
    const order = REGION_HEADS.map(r => r[0])
      .filter(k => k in idx)
      .sort((a, b) => idx[a] - idx[b]);
    const hasSect = el => el.getElementsByTagNameNS(W, "sectPr").length > 0;
    const out = {};
    for (const k of REGIONS) {
      if (!(k in idx)) continue;
      const a = idx[k],
        nextK = order[order.indexOf(k) + 1];
      if (!nextK) continue;
      let b = idx[nextK];
      while (b - 1 > a && hasSect(kids[b - 1])) b--;
      if (kids.slice(a, b).some(hasSect)) continue;
      const pa = kids[a].getAttributeNS(W14, "paraId"),
        pb = kids[b] && kids[b].getAttributeNS(W14, "paraId");
      if (!pa || !pb) continue;
      out[k] = { start: pa, end: pb, title: pyStrip(paraText(kids[a])) };
    }
    return out;
  }

  // ---------- 新舊版比對 ----------
  const sig = p => p.kind + "|" + p.label + "|" + p.ctx;
  function bigrams(s) {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.substr(i, 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  }
  function dice(a, b) {
    if (a === b) return 1;
    const A = bigrams(a),
      B = bigrams(b);
    let inter = 0,
      na = 0,
      nb = 0;
    A.forEach(v => {
      na += v;
    });
    B.forEach(v => {
      nb += v;
    });
    A.forEach((v, k) => {
      if (B.has(k)) inter += Math.min(v, B.get(k));
    });
    return na + nb ? (2 * inter) / (na + nb) : 0;
  }
  const simText = p => (p.label + " " + p.ctx).replace(/【☐】|【＿＿】/g, "◆");
  function matchPoints(oldPts, newPts) {
    const n = oldPts.length,
      m = newPts.length;
    const so = oldPts.map(sig),
      sn = newPts.map(sig);
    const L = [];
    for (let i = 0; i <= n; i++) L.push(new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) L[i][j] = so[i] === sn[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const pairs = [];
    let i = 0,
      j = 0;
    while (i < n && j < m) {
      if (so[i] === sn[j]) {
        pairs.push([i, j]);
        i++;
        j++;
      } else if (L[i + 1][j] >= L[i][j + 1]) i++;
      else j++;
    }
    const newToOld = new Array(m).fill(-1),
      oldUsed = new Array(n).fill(false),
      fuzzy = [];
    pairs.forEach(([a, b]) => {
      newToOld[b] = a;
      oldUsed[a] = true;
    });
    // 錨點之間的區段做模糊比對（同類型、保持順序）
    const anchors = [[-1, -1]].concat(pairs, [[n, m]]);
    for (let k = 0; k < anchors.length - 1; k++) {
      const [oa, na] = anchors[k],
        [ob, nb] = anchors[k + 1];
      let jStart = na + 1;
      for (let a = oa + 1; a < ob; a++) {
        let best = -1,
          bs = 0;
        for (let b = jStart; b < nb; b++) {
          if (newToOld[b] >= 0 || newPts[b].kind !== oldPts[a].kind) continue;
          const s = dice(simText(oldPts[a]), simText(newPts[b]));
          if (s > bs) {
            bs = s;
            best = b;
          }
        }
        if (best >= 0 && bs >= 0.55) {
          newToOld[best] = a;
          oldUsed[a] = true;
          fuzzy.push({ old: a, nw: best, sim: Math.round(bs * 100) });
          jStart = best + 1;
        }
      }
    }
    return { newToOld, oldUsed, exact: pairs.length, fuzzy };
  }

  async function readDocx(JSZip, data) {
    const zip = await JSZip.loadAsync(data),
      parts = [];
    for (const name of Object.keys(zip.files)) {
      const f = zip.files[name];
      if (f.dir) continue;
      if (/\.(xml|rels)$/i.test(name)) parts.push({ name, text: await f.async("string") });
      else parts.push({ name, b64: await f.async("base64") });
    }
    // [Content_Types].xml 放最前面
    parts.sort((a, b) => (a.name === "[Content_Types].xml" ? -1 : b.name === "[Content_Types].xml" ? 1 : 0));
    return parts;
  }

  // 處理上傳的新範本；oldPoints 為目前使用中範本的欄位，usedIds 為表單會自動填寫的編號
  async function processTemplate(env, data, oldPoints, usedIds) {
    const { JSZip, DOMParser, XMLSerializer } = env;
    const parts = await readDocx(JSZip, data);
    const dp = parts.find(p => p.name === "word/document.xml");
    if (!dp) throw new Error("這不是 Word（.docx）檔");
    const doc = new DOMParser().parseFromString(dp.text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("文件內容無法解析");
    const pts = indexPoints(doc);
    if (!pts.length) throw new Error("找不到任何填寫底線或勾選框，請確認是契約範本");
    const full = doc.getElementsByTagNameNS(W, "body")[0];
    const allText = Array.from(full.getElementsByTagNameNS(W, "p")).slice(0, 12).map(paraText).join("");
    const ver = (allText.match(/（\s*(\d{2,3}\.\d{1,2}\.\d{1,2})\s*版\s*）/) || [])[1] || "";
    const mt = matchPoints(oldPoints, pts);
    const used = new Set(usedIds || []);
    let maxN = 0;
    oldPoints.forEach(p => {
      const k = /^N(\d+)$/.exec(p.id);
      if (k) maxN = Math.max(maxN, +k[1]);
    });
    pts.forEach((p, j) => {
      const a = mt.newToOld[j];
      p.id = a >= 0 ? oldPoints[a].id : "N" + String(++maxN).padStart(3, "0");
    });
    const regions = findRegions(doc);
    tokenize(pts);
    let xml = new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, "");
    xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + xml;
    dp.text = xml;
    const points = pts.map(p => {
      const o = { id: p.id, sec: p.sec, label: p.label, kind: p.kind, ctx: p.ctx, orig: p.orig, dflt: p.dflt };
      if (p.def) o.def = p.def;
      return o;
    });
    // 預設值有變動的填空（新舊版都對上的位置）
    const oldById = {};
    oldPoints.forEach(o => {
      oldById[o.id] = o;
    });
    const defChanges = points
      .filter(p => oldById[p.id] && (oldById[p.id].def || "") !== (p.def || "") && (oldById[p.id].def || p.def))
      .map(p => ({ id: p.id, sec: p.sec, oldDef: oldById[p.id].def || "", newDef: p.def || "", ctx: p.ctx, used: used.has(p.id) }));
    const report = {
      version: ver,
      total: points.length,
      exact: mt.exact,
      fuzzy: mt.fuzzy.map(f => ({
        id: oldPoints[f.old].id,
        sim: f.sim,
        oldCtx: oldPoints[f.old].ctx,
        newCtx: pts[f.nw].ctx,
        sec: pts[f.nw].sec,
        used: used.has(oldPoints[f.old].id),
      })),
      removed: oldPoints.filter((p, i) => !mt.oldUsed[i]).map(p => ({ id: p.id, sec: p.sec, ctx: p.ctx, used: used.has(p.id) })),
      added: points.filter(p => /^N/.test(p.id) && !oldPoints.some(o => o.id === p.id)).map(p => ({ id: p.id, sec: p.sec, ctx: p.ctx })),
      regions: Object.keys(regions),
      defChanges,
    };
    return { parts, points, regions, report };
  }

  G.Templater = { indexPoints, processTemplate, matchPoints, findRegions, readDocx, REGIONS };
})(typeof globalThis !== "undefined" ? globalThis : this);
