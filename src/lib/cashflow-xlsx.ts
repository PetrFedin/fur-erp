import "server-only";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { CASHFLOW_ARTICLES, split, TYPE_LABEL, type RowVatShare, type SalesMonthly } from "@/lib/cashflow";
import type { OverviewRow } from "@/lib/payments-overview";

/**
 * Книга Cash Flow: 1) «Данные» — один массив строк (платёж × статья и выручка по месяцам) с суммами с НДС, НДС и без НДС;
 * 2) «Сводная» — настоящая сводная таблица по этому массиву (Excel соберёт значения при открытии);
 * 3) «Отчёт» — тот же Cash Flow, что на экране: статьи в строках, месяцы и итоги года в столбцах, формулы SUMIFS по листу «Данные»; НДС — отдельным блоком снизу.
 * Знак: траты отрицательные, поступления положительные (как в таблице Cash Flow).
 */
const DATA = "Данные";
const NUM = "#,##0;-#,##0;–";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colL = (n: number) => { let o = ""; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) o = String.fromCharCode(65 + ((x - 1) % 26)) + o; return o; };
const ruDate = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");

type DRow = { month: string; year: string; section: "Трата" | "Получено"; article: string; kind: string; object: string; doc: string; date: string; incl: number; vat: number; ex: number };
const HEAD = ["Месяц", "Год", "Раздел", "Статья", "Вид платежа", "Объект", "Основание", "Дата", "Сумма с НДС", "НДС", "Сумма без НДС"];
const LABEL: Record<string, string> = Object.fromEntries(CASHFLOW_ARTICLES.map((a) => [a.key, a.label]));
const REVENUE = "Выручка от продаж (по дате продажи)";
const HIDES = "Шкуры подрядчика в счёте за пошив";
const MONTH_RU = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

/** Строки листа «Данные»: каждая оплата делится по статьям (мех: аукционы / закупка, шкуры подрядчика, подкладка, услуги, работа), плюс выручка по месяцам. Суммы положительные, раздел — «Трата» или «Получено». */
export function cashflowDataRows(rows: OverviewRow[], share: RowVatShare, months: string[], sales: SalesMonthly): DRow[] {
  const inPeriod = new Set(months);
  const out: DRow[] = [];
  for (const r of rows) {
    const month = r.iso.slice(0, 7);
    if (!inPeriod.has(month)) continue;
    const sh = share.get(r.id) ?? 0;
    for (const [k, v] of Object.entries(split(r))) {
      if (Math.abs(v) <= 0.005) continue;
      out.push({ month, year: month.slice(0, 4), section: "Трата", article: k === "hides" ? HIDES : LABEL[k], kind: TYPE_LABEL[r.type], object: r.label, doc: r.doc ?? "", date: ruDate(r.iso), incl: v, vat: v * sh, ex: v * (1 - sh) });
    }
  }
  if (sales.available) {
    months.forEach((m, i) => {
      const incl = sales.revIncl[i] ?? 0, ex = sales.revEx[i] ?? 0;
      if (Math.abs(incl) < 0.005 && Math.abs(ex) < 0.005) return;
      out.push({ month: m, year: m.slice(0, 4), section: "Получено", article: REVENUE, kind: "", object: "Продажи по файлу «поступления и продажи»", doc: "", date: "", incl, vat: incl - ex, ex });
    });
  }
  return out;
}

/** Лист «Отчёт» повторяет эталон «Cash Flow» владельца: выпадающий «С НДС / Без НДС» в B3, месяцы в столбцах с итогами года, тысячи рублей, справочно НДС и виды оплаты. */
export async function buildCashflowWorkbook(opts: { title: string; subtitle: string; months: string[]; data: DRow[]; hasSales: boolean }): Promise<Buffer> {
  const { data } = opts;
  const wb = new ExcelJS.Workbook();
  // 1. Данные
  const wsD = wb.addWorksheet(DATA, { views: [{ state: "frozen", ySplit: 1 }] });
  wsD.addRow(HEAD).font = { bold: true };
  wsD.getRow(1).eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } }; });
  for (const r of data) wsD.addRow([r.month, r.year, r.section, r.article, r.kind, r.object, r.doc, r.date, r.incl, r.vat, r.ex]);
  for (const c of [9, 10, 11]) { wsD.getColumn(c).numFmt = "#,##0.00"; wsD.getColumn(c).width = 16; }
  [10, 6, 13, 34, 20, 38, 50, 12].forEach((w, i) => { wsD.getColumn(i + 1).width = w; });
  const last = data.length + 1;
  wsD.autoFilter = { from: "A1", to: `K${last}` };
  // 2. Сводная (лист-заготовка: таблицу вставляем в пакет ниже)
  const wsP = wb.addWorksheet("Сводная");
  wsP.getCell("A1").value = "Сводная таблица по листу «Данные»: суммы с НДС по разделам, статьям и месяцам. Если значения не появились — «Данные → Обновить всё».";
  wsP.getCell("A1").font = { bold: true };
  // 3. Отчёт (эталонный макет)
  const ws = wb.addWorksheet("Отчёт");
  ws.properties.tabColor = { argb: "FFFFC000" };
  const monthsWith = [...new Set(data.map((d) => d.month))].sort();
  const firstM = monthsWith[0], lastM = monthsWith[monthsWith.length - 1];
  const range = firstM ? opts.months.filter((m) => m >= firstM && m <= lastM) : [];
  type Col = { key: string; label: string; kind: "month" | "year" | "all"; value: string };
  const cols: Col[] = [];
  for (const y of [...new Set(range.map((m) => m.slice(0, 4)))]) {
    for (const m of range.filter((x) => x.startsWith(y))) cols.push({ key: m, label: MONTH_RU[Number(m.slice(5)) - 1], kind: "month", value: m });
    cols.push({ key: "y" + y, label: "", kind: "year", value: y });
  }
  cols.push({ key: "all", label: "", kind: "all", value: "" });
  const NC = cols.length + 1;
  const fmtK = "#,##0,;\\−#,##0,;\\-;@", fmtNet = "#,##0,;[Red]\\-#,##0,";
  const L = (n: number) => colL(n);
  const monthCols = cols.map((c, i) => ({ c, ci: i + 2 })).filter((x) => x.c.kind === "month");
  const yearOf = (y: string) => monthCols.filter((x) => x.c.value.startsWith(y));
  // шапка
  ws.getCell("A1").value = `Cash Flow ${range.length ? range[0].slice(0, 4) + (range[range.length - 1].slice(0, 4) !== range[0].slice(0, 4) ? "-" + range[range.length - 1].slice(0, 4) : "") : ""}, 000 ₽ ${"с НДС"}`;
  ws.getCell("A1").font = { bold: true, size: 12 };
  ws.getCell("A2").value = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z"); ws.getCell("A2").numFmt = "dd.mm.yyyy"; ws.getCell("A2").alignment = { horizontal: "left" };
  ws.getCell("B3").value = "С НДС";
  ws.getCell("B3").font = { bold: true, color: { argb: "FFB00020" } };
  ws.getCell("B3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
  ws.getCell("B3").dataValidation = { type: "list", allowBlank: false, formulae: ['"С НДС,Без НДС"'] };
  ws.getCell("C3").value = "← «С НДС» или «Без НДС» (поступления и платежи на одной базе)";
  ws.getCell("A1").value = { formula: `"Cash Flow ${range.length ? range[0].slice(0, 4) + (range[range.length - 1].slice(0, 4) !== range[0].slice(0, 4) ? "-" + range[range.length - 1].slice(0, 4) : "") : ""}, 000 ₽ "&$B$3`, result: String(ws.getCell("A1").value) };
  cols.forEach((c, i) => { const cell = ws.getCell(5, i + 2); cell.value = c.label || null; cell.font = { bold: true }; cell.alignment = { horizontal: "center" }; });
  const hdr = ws.getRow(6);
  hdr.getCell(1).value = "Статья";
  cols.forEach((c, i) => { hdr.getCell(i + 2).value = c.kind === "month" ? c.value : c.kind === "year" ? "Итого " + c.value : "Всего"; });
  for (let ci = 1; ci <= NC; ci++) { const c = hdr.getCell(ci); c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF37474F" } }; if (ci > 1) c.alignment = { horizontal: "right" }; }
  const N = data.length + 1;
  const rng = (col: string) => `${DATA}!$${col}$2:$${col}$${N}`;
  const amount = `IF($B$3="С НДС",${rng("I")},${rng("K")})`;
  const sumRows = (col: "incl" | "ex" | "vat", f: { section: string; article?: string[]; kind?: string[] }, mi: string) => data.filter((d) => d.section === f.section && d.month === mi && (!f.article || f.article.includes(d.article)) && (!f.kind || f.kind.includes(d.kind))).reduce((t, d) => t + d[col], 0);
  const sf = (f: { section: string; article?: string[]; kind?: string[] }, ci: number, vatOnly = false) => {
    const crit = [`${rng("C")},"${f.section}"`, `${rng("A")},${L(ci)}$6`];
    const arts = (f.article ?? []).map((a) => `"${a.replace(/"/g, '""')}"`);
    const kinds = (f.kind ?? []).map((k) => `"${k}"`);
    const one = (extra: string[]) => `SUMIFS(${vatOnly ? rng("J") : amount},${[...crit, ...extra].join(",")})`;
    const parts = arts.length ? arts.map((a) => one([`${rng("D")},${a}`])) : kinds.length ? kinds.map((k) => one([`${rng("E")},${k}`])) : [one([])];
    return parts.length > 1 ? parts.join("+") : parts[0];
  };
  type Row = { r: number; label: string; bold?: boolean; fmt?: string; leaf?: { section: string; article?: string[]; kind?: string[]; sign: 1 | -1; vat?: boolean }; formula?: (c: string) => string; fill?: boolean; cum?: boolean; mayRed?: boolean };
  const A = (k: keyof typeof LABEL) => LABEL[k];
  const rowsDef: Row[] = [
    { r: 7, label: "ПОСТУПЛЕНИЯ", bold: true, formula: (c) => `${c}8` },
    { r: 8, label: REVENUE, leaf: { section: "Получено", article: [REVENUE], sign: 1 } },
    { r: 10, label: "ПЛАТЕЖИ", bold: true, formula: (c) => `${c}11+${c}15` },
    { r: 11, label: "Сырьё и материалы", bold: true, formula: (c) => `SUM(${c}12:${c}14)` },
    { r: 12, label: A("furAuction"), leaf: { section: "Трата", article: [A("furAuction")], sign: -1 } },
    { r: 13, label: "Мех: закупка у поставщика*", leaf: { section: "Трата", article: [A("furPurchase"), HIDES], sign: -1 } },
    { r: 14, label: A("lining"), leaf: { section: "Трата", article: [A("lining")], sign: -1 } },
    { r: 15, label: "Работа и услуги", bold: true, formula: (c) => `SUM(${c}16:${c}17)` },
    { r: 16, label: A("work"), leaf: { section: "Трата", article: [A("work")], sign: -1 } },
    { r: 17, label: A("services"), leaf: { section: "Трата", article: [A("services")], sign: -1 } },
    { r: 19, label: "ЧИСТЫЙ ДЕНЕЖНЫЙ ПОТОК", bold: true, formula: (c) => `${c}7+${c}10`, mayRed: true },
    { r: 20, label: "Накопленный чистый поток (с начала данных)", bold: true, cum: true, mayRed: true },
    { r: 22, label: "Справочно (не входит в итоги)", bold: true },
    { r: 23, label: "НДС в составе платежей", leaf: { section: "Трата", sign: 1, vat: true } },
    { r: 24, label: "НДС в составе выручки", leaf: { section: "Получено", sign: 1, vat: true } },
    { r: 25, label: "Разница НДС (в выручке − в платежах)", bold: true, formula: (c) => `${c}24-${c}23` },
    { r: 27, label: "Платежи по видам оплаты: аванс (включая предоплату за непринятые заказы)", formula: (c) => `${c}10-${c}28-${c}29` },
    { r: 28, label: "Платежи по видам оплаты: доплата", leaf: { section: "Трата", kind: ["Доплата"], sign: -1 } },
    { r: 29, label: "Платежи по видам оплаты: окончательный расчёт", leaf: { section: "Трата", kind: ["Окончательный расчёт"], sign: -1 } },
    { r: 30, label: "Итого платежей по видам оплаты", bold: true, formula: (c) => `SUM(${c}27:${c}29)` },
  ];
  // Значения для кэша формул (режим «С НДС»): считаем теми же правилами, рекурсивно с запоминанием.
  const memo = new Map<string, number>();
  const rowBy = new Map(rowsDef.map((r) => [r.r, r]));
  const val = (r: number, c: Col): number => {
    const k = r + "|" + c.key;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const row = rowBy.get(r)!;
    let v = 0;
    if (row.leaf) {
      const lf = row.leaf;
      const per = (mi: string) => lf.sign * sumRows(lf.vat ? "vat" : "incl", lf, mi);
      v = c.kind === "month" ? per(c.value) : monthCols.filter((x) => c.kind === "all" || x.c.value.startsWith(c.value)).reduce((t, x) => t + per(x.c.value), 0);
    } else {
      const g = (n: number) => val(n, c);
      switch (r) {
        case 7: v = g(8); break;
        case 10: v = g(11) + g(15); break;
        case 11: v = g(12) + g(13) + g(14); break;
        case 15: v = g(16) + g(17); break;
        case 19: v = g(7) + g(10); break;
        case 25: v = g(24) - g(23); break;
        case 27: v = g(10) - g(28) - g(29); break;
        case 30: v = g(27) + g(28) + g(29); break;
        case 20: { const lastMonth = c.kind === "month" ? c : [...monthCols].reverse().find((x) => c.kind === "all" || x.c.value.startsWith(c.value))?.c; v = lastMonth ? monthCols.filter((x) => x.c.value <= lastMonth.value).reduce((t, x) => t + val(19, x.c), 0) : 0; break; }
        default: v = 0;
      }
    }
    memo.set(k, v);
    return v;
  };
  for (const row of rowsDef) {
    const x = ws.getRow(row.r);
    x.getCell(1).value = row.label;
    if (row.bold) x.getCell(1).font = { bold: true };
    cols.forEach((c, i) => {
      const ci = i + 2, col = L(ci), cell = x.getCell(ci);
      if (row.r === 22) { cell.numFmt = fmtK; return; }
      let f: string;
      if (row.cum) {
        if (c.kind === "month") { const prev = [...monthCols].reverse().find((m) => m.ci < ci); f = prev ? `${L(prev.ci)}20+${col}19` : `${col}19`; }
        else { const t = [...monthCols].reverse().find((m) => c.kind === "all" || m.c.value.startsWith(c.value)); f = t ? `${L(t.ci)}20` : "0"; }
      } else if (row.leaf && c.kind !== "month") {
        if (c.kind === "year") { const ms = yearOf(c.value); f = ms.length ? `SUM(${L(ms[0].ci)}${row.r}:${L(ms[ms.length - 1].ci)}${row.r})` : "0"; }
        else f = cols.map((z, zi) => (z.kind === "year" ? `${L(zi + 2)}${row.r}` : "")).filter(Boolean).join("+") || "0";
      } else if (row.leaf) {
        const lf = row.leaf;
        f = (lf.sign < 0 ? "-" : "") + (lf.article && lf.article.length > 1 ? `(${sf(lf, ci, lf.vat)})` : sf(lf, ci, lf.vat));
      } else f = row.formula!(col);
      cell.value = { formula: f, result: val(row.r, c) };
      cell.numFmt = row.mayRed ? fmtNet : fmtK;
      if (row.bold) cell.font = { bold: true };
      if (c.kind !== "month") cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FA" } };
    });
  }
  ws.getCell("A32").value = "* (включая шкуры подрядчика в счёте за пошив)";
  ws.getColumn(1).width = 44.4;
  for (let c = 2; c <= NC; c++) ws.getColumn(c).width = 10.5;
  ws.pageSetup = { orientation: "landscape" };
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 6 }];

  const base = Buffer.from(await wb.xlsx.writeBuffer());
  return injectPivot(base, data, last);
}

/** Настоящая сводная таблица на листе 2: строки — раздел и статья, столбцы — месяцы, значения — сумма с НДС. Кэш с refreshOnLoad: Excel соберёт значения при открытии. */
async function injectPivot(buf: Buffer, data: DRow[], last: number): Promise<Buffer> {
  const uniq = (f: (r: DRow) => string) => [...new Set(data.map(f))];
  const str = [
    { name: HEAD[0], vals: uniq((r) => r.month) }, { name: HEAD[1], vals: uniq((r) => r.year) }, { name: HEAD[2], vals: uniq((r) => r.section) }, { name: HEAD[3], vals: uniq((r) => r.article) },
    { name: HEAD[4], vals: uniq((r) => r.kind) }, { name: HEAD[5], vals: uniq((r) => r.object) }, { name: HEAD[6], vals: uniq((r) => r.doc) }, { name: HEAD[7], vals: uniq((r) => r.date) },
  ];
  const strField = (f: { name: string; vals: string[] }) => `<cacheField name="${esc(f.name)}" numFmtId="0"><sharedItems count="${f.vals.length}">${f.vals.map((v) => `<s v="${esc(v)}"/>`).join("")}</sharedItems></cacheField>`;
  const numField = (n: string) => `<cacheField name="${esc(n)}" numFmtId="0"><sharedItems containsString="0" containsBlank="1" containsNumber="1"/></cacheField>`;
  const cache = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" refreshOnLoad="1" refreshedVersion="8" minRefreshableVersion="3" createdVersion="6" recordCount="${data.length}">` +
    `<cacheSource type="worksheet"><worksheetSource ref="A1:K${last}" sheet="${DATA}"/></cacheSource><cacheFields count="11">${str.map(strField).join("")}${numField(HEAD[8])}${numField(HEAD[9])}${numField(HEAD[10])}</cacheFields></pivotCacheDefinition>`;
  const items = (n: number) => `<items count="${n + 1}">${Array.from({ length: n }, (_, k) => `<item x="${k}"/>`).join("")}<item t="default"/></items>`;
  const axis = (ax: "axisRow" | "axisCol", n: number) => `<pivotField axis="${ax}" showAll="0">${items(n)}</pivotField>`;
  const pivot = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="Сводная Cash Flow" cacheId="1" showError="1" errorCaption="–" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Значения" updatedVersion="8" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="6" indent="0" outline="1" outlineData="1" multipleFieldFilters="0" rowHeaderCaption="Раздел / статья" colHeaderCaption="Месяц">` +
    `<location ref="A4:Z30" firstHeaderRow="1" firstDataRow="2" firstDataCol="1"/><pivotFields count="11">${axis("axisCol", str[0].vals.length)}<pivotField showAll="0"/>${axis("axisRow", str[2].vals.length)}${axis("axisRow", str[3].vals.length)}<pivotField showAll="0"/><pivotField showAll="0"/><pivotField showAll="0"/><pivotField showAll="0"/><pivotField dataField="1" showAll="0"/><pivotField showAll="0"/><pivotField showAll="0"/></pivotFields>` +
    `<rowFields count="2"><field x="2"/><field x="3"/></rowFields><colFields count="1"><field x="0"/></colFields>` +
    `<dataFields count="1"><dataField name="Сумма с НДС, ₽" fld="8" baseField="0" baseItem="0" numFmtId="3"/></dataFields>` +
    `<pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>`;
  const zip = await JSZip.loadAsync(buf);
  const text = async (p: string) => (await zip.file(p)!.async("string"));
  zip.file("[Content_Types].xml", (await text("[Content_Types].xml")).replace("</Types>", '<Override PartName="/xl/pivotCache/pivotCacheDefinition1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml"/><Override PartName="/xl/pivotTables/pivotTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/></Types>'));
  zip.file("xl/workbook.xml", (await text("xl/workbook.xml")).replace("</workbook>", '<pivotCaches><pivotCache xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" cacheId="1" r:id="rIdPC1"/></pivotCaches></workbook>'));
  zip.file("xl/_rels/workbook.xml.rels", (await text("xl/_rels/workbook.xml.rels")).replace("</Relationships>", '<Relationship Id="rIdPC1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/></Relationships>'));
  zip.file("xl/pivotCache/pivotCacheDefinition1.xml", cache);
  zip.file("xl/pivotTables/pivotTable1.xml", pivot);
  zip.file("xl/pivotTables/_rels/pivotTable1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition1.xml"/></Relationships>');
  const relPath = "xl/worksheets/_rels/sheet2.xml.rels";
  const pivotRel = '<Relationship Id="rIdPV1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="../pivotTables/pivotTable1.xml"/>';
  zip.file(relPath, zip.file(relPath) ? (await text(relPath)).replace("</Relationships>", pivotRel + "</Relationships>") : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pivotRel}</Relationships>`);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}
