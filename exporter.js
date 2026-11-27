/* 匯出 Excel（.xlsx）：不需外部套件，用 JSZip 組出活頁簿。 */
(function (G) {
  "use strict";
  const esc = s =>
    String(s)
      .replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const col = i => {
    let s = "";
    i += 1;
    while (i) {
      const m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  };
  // 樣式：0 一般、1 標題列、2 金額 #,##0、3 百分比 0%、4 逾期（紅字）
  const STYLES =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet ` +
    `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz ` +
    `val="11"/><name val="Arial"/><family val="2"/></font><font><b/><sz val="11"/><name ` +
    `val="Arial"/><family val="2"/></font><font><sz val="11"/><color rgb="FFB3261E"/><name ` +
    `val="Arial"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill ` +
    `patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill ` +
    `patternType="solid"><fgColor rgb="FFEDEDED"/><bgColor indexed="64"/></patternFill></fill>` +
    `</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" ` +
    `applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" ` +
    `fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment ` +
    `vertical="center"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" ` +
    `applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="9" ` +
    `fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1">` +
    `<alignment vertical="top"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" ` +
    `applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  /** sheet：{ name, cols: [{ title, width, type: 'text'|'money'|'pct'|'int' }], rows: [[...]], red: (row) => bool } */
  function sheetXml(sh) {
    const head = `<row r="1">${sh.cols
      .map((c, i) => `<c r="${col(i)}1" t="inlineStr" s="1"><is>` + `<t>${esc(c.title)}</t></is></c>`)
      .join("")}</row>`;
    const body = sh.rows
      .map((r, ri) => {
        const n = ri + 2,
          red = sh.red && sh.red(r);
        return (
          `<row r="${n}">` +
          r
            .map((v, ci) => {
              if (v === null || v === undefined || v === "") return "";
              const type = sh.cols[ci].type || "text",
                ref = col(ci) + n;
              if (type !== "text" && typeof v === "number" && isFinite(v))
                return `<c r="${ref}" s="${type === "money" ? 2 : type === "pct" ? 3 : 0}"><v>${v}</v></c>`;
              return `<c r="${ref}" t="inlineStr" s="${red ? 4 : 0}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
            })
            .join("") +
          `</row>`
        );
      })
      .join("");
    const last = col(sh.cols.length - 1) + (sh.rows.length + 1);
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ` +
      `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ` +
      `ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" ` +
      `topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="15"/><cols>${sh.cols
        .map((c, i) => `<col min="${i + 1}" ` + `max="${i + 1}" width="${c.width || 12}" customWidth="1"/>`)
        .join("")}</cols>` +
      `<sheetData>${head}${body}</sheetData><autoFilter ref="A1:${last}"/><pageMargins left="0.5" ` +
      `right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" ` +
      `orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`
    );
  }

  async function xlsx(JSZip, sheets) {
    const z = new JSZip();
    z.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types ` +
        `xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default ` +
        `Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/><Override ` +
        `PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spre` +
        `adsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ` +
        `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/` +
        `>${sheets
          .map(
            (s, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
              `ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
          )
          .join("")}</Types>`
    );
    z.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ` +
        `xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship ` +
        `Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeD` +
        `ocument" Target="xl/workbook.xml"/></Relationships>`
    );
    z.file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ` +
        `xmlns="http://schemas.openxmlformats.org/package/2006/relationships"` +
        `>${sheets
          .map(
            (s, i) =>
              `<Relationship Id="rId${i + 1}" ` +
              `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ` +
              `Target="worksheets/sheet${i + 1}.xml"/>`
          )
          .join("")}<Relationship ` +
        `Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/re` +
        `lationships/styles" Target="styles.xml"/></Relationships>`
    );
    const names = sheets.map(s =>
      String(s.name)
        .replace(/[\\/?*[\]:]/g, "")
        .slice(0, 31)
    );
    z.file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ` +
        `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews>` +
        `<workbookView/></bookViews><sheets>${names
          .map((n, i) => `<sheet name="${esc(n)}" ` + `sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join("")}</sheets>` +
        `<definedNames>${sheets
          .map(
            (s, i) =>
              `<definedName name="_xlnm._FilterDatabase" ` +
              `localSheetId="${i}" hidden="1">'${esc(names[i])}'!$A$1:` +
              `$${col(s.cols.length - 1)}$${s.rows.length + 1}</definedName>`
          )
          .join("")}</definedNames></workbook>`
    );
    z.file("xl/styles.xml", STYLES);
    sheets.forEach((s, i) => z.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
    return z.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  G.Exporter = { xlsx };
})(typeof globalThis !== "undefined" ? globalThis : this);
