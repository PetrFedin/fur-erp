/**
 * Разбор присланного Веллмехом Word «ПРИЛОЖЕНИЕ N» → блоки текста → TzPayload, и сравнение текста/вёрстки двух docx.
 * Только для скриптов (проверка точности генератора src/lib/tz-docx-vendor.ts и заведение ТЗ из присланного файла).
 */
import JSZip from "jszip";
import { totalRowTexts } from "../../src/lib/tz-docx-vendor";
import { plainNum, tzTotals, kopNum, spacedNum, defaultTerms, emptyTz, itemTotal, materialTotal, type TzItem, type TzMaterial, type TzPayload } from "../../src/lib/tz-vendor";

export type Block = ["T", string[][]] | ["P", string];

const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const norm = (s: string) => s.replace(/[\s  ]+/g, " ").trim();
const paraTxt = (p: string) => unesc([...p.replace(/<w:br\/>/g, "<w:t>\n</w:t>").matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(""));
/** Служебное Word, не вёрстка: rsid-метки правок, масштаб просмотра, внутренние идентификаторы нумерации — у каждого файла свои. */
const stripSession = (x: string) => x.replace(/<w:rsid [^>]*\/>/g, "").replace(/<w:rsids>[\s\S]*?<\/w:rsids>/g, "").replace(/<w:zoom [^>]*\/>/g, "").replace(/<w:proofState [^>]*\/>/g, "").replace(/<w1[45]:docId [^>]*\/>/g, "").replace(/<m:smallFrac[^>]*\/>/g, "").replace(/ w16cid:durableId="\d+"/g, "");
const stripIds = (x: string) => x.replace(/ w:rsid\w*="[0-9A-Fa-f]+"| w14:(?:paraId|textId)="[0-9A-Fa-f]+"/g, "");

export async function docxPart(buf: Buffer, name: string): Promise<string> {
  return (await (await JSZip.loadAsync(buf)).file(name)?.async("string")) ?? "";
}
export async function docxParts(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const get = async (n: string) => (await zip.file(n)?.async("string")) ?? "";
  const doc = await get("word/document.xml");
  const body = stripIds(doc.slice(doc.indexOf("<w:body>") + 8, doc.lastIndexOf("</w:body>")));
  return { body, styles: stripIds(await get("word/styles.xml")), settings: stripSession(stripIds(await get("word/settings.xml"))), numbering: stripSession(await get("word/numbering.xml")), theme: await get("word/theme/theme1.xml") };
}
const topBlocks = (body: string) => body.match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:sectPr[\s\S]*?<\/w:sectPr>/g) ?? [];

export async function docxBlocks(buf: Buffer): Promise<Block[]> {
  const { body } = await docxParts(buf);
  const out: Block[] = [];
  for (const b of topBlocks(body)) {
    if (b.startsWith("<w:tbl>")) out.push(["T", (b.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []).map((r) => (r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((c) => (c.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(paraTxt).join("\n")))]);
    else if (b.startsWith("<w:p")) out.push(["P", paraTxt(b)]);
  }
  return out;
}

/** Сравнение текста: пробелы нормализуются (в т.ч. неразрывные), абзацы ячейки сохраняются. */
export function textDiff(a: Block[], b: Block[]): string[] {
  const out: string[] = [];
  if (a.length !== b.length) out.push(`число блоков: ${a.length} ≠ ${b.length}`);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (x[0] !== y[0]) { out.push(`блок ${i}: тип ${x[0]} ≠ ${y[0]}`); continue; }
    if (x[0] === "P") { if (norm(x[1]) !== norm(y[1] as string)) out.push(`блок ${i}: «${x[1]}» ≠ «${y[1]}»`); continue; }
    const ra = x[1], rb = y[1] as string[][];
    if (ra.length !== rb.length) out.push(`блок ${i}: строк ${ra.length} ≠ ${rb.length}`);
    for (let r = 0; r < Math.min(ra.length, rb.length); r++) {
      if (ra[r].length !== rb[r].length) out.push(`блок ${i} стр ${r}: ячеек ${ra[r].length} ≠ ${rb[r].length}`);
      for (let c = 0; c < Math.min(ra[r].length, rb[r].length); c++) if (norm(ra[r][c]) !== norm(rb[r][c])) out.push(`блок ${i} стр ${r} яч ${c}: «${ra[r][c]}» ≠ «${rb[r][c]}»`);
    }
  }
  return out;
}

/** Свойства, не меняющие вида на странице: язык/проверка правописания, цвет «авто», свойства сложных шрифтов (bCs/iCs/szCs), кернинг. */
const visual = (x: string) => x.replace(/<w:(?:(?:lang|noProof|kern|bCs|iCs|szCs)\b[^>]*|color w:val="(?:auto|000000)")\/>/g, "").replace(/<w:rPr><\/w:rPr>/g, "").replace(/ w:(?:hint|eastAsia|eastAsiaTheme)="[^"]*"/g, "");
/** Подпись вёрстки абзаца: свойства абзаца + свойства первого фрагмента + число переносов (текст и разбиение на фрагменты не учитываются). */
const paraSig = (p: string) => {
  let pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p)?.[0] ?? "";
  if (/<w:t[ >]/.test(p)) pPr = pPr.replace(/<w:rPr>(?:(?!<w:rPr>)[\s\S])*?<\/w:rPr><\/w:pPr>$/, "</w:pPr>"); // знак абзаца в непустом абзаце не виден
  return visual(`${pPr}|${/<w:r(?: [^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/.exec(p)?.[1] ?? ""}|br${(p.match(/<w:br\/>/g) ?? []).length}`);
};
function tableSig(t: string): { head: string; rows: { tr: string; cells: { tc: string; ps: string[] }[] }[] } {
  const head = (/<w:tblPr>[\s\S]*?<\/w:tblPr>/.exec(t)?.[0] ?? "") + (/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/.exec(t)?.[0] ?? "");
  const rows = (t.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []).map((r) => ({
    tr: /<w:trPr>[\s\S]*?<\/w:trPr>/.exec(r)?.[0] ?? "",
    cells: (r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((c) => ({ tc: /<w:tcPr>[\s\S]*?<\/w:tcPr>/.exec(c)?.[0] ?? "", ps: (c.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(paraSig) })),
  }));
  return { head, rows };
}

/** Сравнение вёрстки: стили, настройки, секция (поля/размер), свойства таблиц/строк/ячеек/абзацев/фрагментов, порядок блоков. */
export async function layoutDiff(orig: Buffer, gen: Buffer): Promise<string[]> {
  const A = await docxParts(orig), B = await docxParts(gen);
  const out: string[] = [];
  for (const k of ["styles", "settings", "numbering", "theme"] as const) if (A[k] !== B[k]) out.push(`${k}.xml отличается`);
  const ba = topBlocks(A.body), bb = topBlocks(B.body);
  if (ba.length !== bb.length) out.push(`число блоков: ${ba.length} ≠ ${bb.length}`);
  for (let i = 0; i < Math.min(ba.length, bb.length); i++) {
    const x = ba[i], y = bb[i];
    const kind = (s: string) => (s.startsWith("<w:tbl>") ? "T" : s.startsWith("<w:sectPr") ? "S" : "P");
    if (kind(x) !== kind(y)) { out.push(`блок ${i}: тип ${kind(x)} ≠ ${kind(y)}`); continue; }
    if (kind(x) === "S") { if (x !== y) out.push(`блок ${i}: секция (поля/размер страницы) отличается`); continue; }
    if (kind(x) === "P") { if (paraSig(x) !== paraSig(y)) out.push(`блок ${i}: свойства абзаца отличаются`); continue; }
    const ta = tableSig(x), tb = tableSig(y);
    if (ta.head !== tb.head) out.push(`блок ${i}: свойства/сетка таблицы отличаются`);
    if (ta.rows.length !== tb.rows.length) out.push(`блок ${i}: строк ${ta.rows.length} ≠ ${tb.rows.length}`);
    for (let r = 0; r < Math.min(ta.rows.length, tb.rows.length); r++) {
      const ra = ta.rows[r], rb = tb.rows[r];
      if (ra.tr !== rb.tr) out.push(`блок ${i} стр ${r}: свойства строки отличаются`);
      if (ra.cells.length !== rb.cells.length) { out.push(`блок ${i} стр ${r}: ячеек ${ra.cells.length} ≠ ${rb.cells.length}`); continue; }
      ra.cells.forEach((ca, c) => {
        const cb = rb.cells[c];
        if (ca.tc !== cb.tc) {
          const geom = (t: string) => `${/<w:tcW[^>]*>/.exec(t)?.[0] ?? ""}${/<w:gridSpan[^>]*>/.exec(t)?.[0] ?? ""}${/<w:vMerge[^>]*>/.exec(t)?.[0] ?? ""}`;
          // ширина/объединение — структура; выравнивание по вертикали, границы и заливка отдельной ячейки — мелочь («~»)
          out.push(geom(ca.tc) !== geom(cb.tc) ? `блок ${i} стр ${r} яч ${c}: ширина/объединение ячейки отличается` : `~ блок ${i} стр ${r} яч ${c}: границы/заливка/выравнивание ячейки отличаются`);
        }
        if (ca.ps.length !== cb.ps.length) out.push(`блок ${i} стр ${r} яч ${c}: абзацев ${ca.ps.length} ≠ ${cb.ps.length}`);
        else if (ca.ps.join("¦") !== cb.ps.join("¦")) out.push(`блок ${i} стр ${r} яч ${c}: свойства абзацев/шрифта отличаются`);
      });
    }
  }
  return out;
}

/** Текст ячейки с сохранением переносов между абзацами (в Word «Головной убор» и «(Повязка)» — две строки); пустые абзацы в конце отбрасываются. */
const nl = (t: string) => t.split("\n").map(norm).join("\n").replace(/\n+$/, "");
/** Пустые абзацы в местах разрывов (см. DEFAULT_GAPS в tz-docx-vendor.ts) — как оставил Веллмех в присланном файле. */
export function gapsFromBlocks(blocks: Block[]): number[] {
  const isE = (b: Block) => b[0] === "P" && b[1].trim() === "";
  const ti = blocks.map((b, i) => (b[0] === "T" ? i : -1)).filter((i) => i >= 0);
  const run = (from: number, to: number) => { let n = 0; for (let i = from; i < to && isE(blocks[i]); i++) n++; return n; };
  const runBack = (to: number) => { let n = 0; for (let i = to - 1; i >= 0 && isE(blocks[i]); i--) n++; return n; };
  const iContract = blocks.findIndex((b) => b[0] === "P" && /^к Договору подряда/.test(b[1].trim()));
  const iSign = blocks.findIndex((b) => b[0] === "P" && /^12\.\s*ПОДПИСИ/.test(b[1].trim()));
  return [run(iContract + 1, blocks.length), run(ti[0] + 1, ti[1]), run(ti[1] + 1, ti[2]), run(ti[2] + 1, blocks.length), runBack(iSign), run(iSign + 1, blocks.length), run(ti[3] + 1, blocks.length)];
}
/** Какой образец вёрстки у присланного файла: «wide» — таблица изделий с объединениями ячеек (как в ТЗ 182), иначе по виду ТЗ. */
export async function payloadFromDocx(buf: Buffer): Promise<TzPayload> {
  const blocks = await docxBlocks(buf);
  const p = payloadFromBlocks(blocks);
  const { body } = await docxParts(buf);
  const t1 = topBlocks(body).filter((b) => b.startsWith("<w:tbl>"))[1] ?? "";
  p.layout = { gaps: gapsFromBlocks(blocks) };
  // строки «Итого:» — как вписал Веллмех, если система считает иначе
  const tables = blocks.filter((b): b is ["T", string[][]] => b[0] === "T").map((b) => b[1]);
  const typed = { items: tables[1][tables[1].length - 1].map(norm), mats: tables[2][tables[2].length - 1].map(norm) };
  const calc = totalRowTexts(p);
  const differs = (a: string[], b: string[]) => a.length !== b.length || a.some((x, i) => norm(x) !== norm(b[i]));
  if (differs(typed.items, calc.items) || differs(typed.mats, calc.mats)) p.totalRows = { ...(differs(typed.items, calc.items) ? { items: typed.items } : {}), ...(differs(typed.mats, calc.mats) ? { mats: typed.mats } : {}) };
  p.layout.geo = topBlocks(body).filter((b) => b.startsWith("<w:tbl>")).map((t) => ({
    w: Number(/<w:tblW w:w="(\d+)"/.exec(t)?.[1] ?? 0) || undefined,
    grid: [...t.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1])),
    cells: (t.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []).map((r) => (r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((c) => Number(/<w:tcW w:w="(\d+)"/.exec(c)?.[1] ?? 0))),
  }));
  if ((t1.match(/<w:gridCol/g) ?? []).length > 14) p.layout.tpl = "wide";
  else if (p.items.some((i) => i.extra)) p.layout.tpl = "extra";
  const mt = topBlocks(body).filter((b) => b.startsWith("<w:tbl>"))[2] ?? "";
  const mrows = mt.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? [];
  if (mrows.length > 3) p.layout.matAlign = (mrows[2].match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((c) => /<w:vAlign w:val="(\w+)"/.exec(c)?.[1] ?? null);
  const settings = await docxPart(buf, "word/settings.xml");
  if (/compatibilityMode"[^>]*w:val="12"/.test(settings)) p.layout.compat = 12;
  const sect = /<w:sectPr[\s\S]*?<\/w:sectPr>/.exec(body)?.[0];
  if (sect) p.layout.sect = sect;
  return p;
}

/** Блоки разбора присланного ТЗ → данные. Поколение «ТЗ 100+» (как 182/160/113) и ремонт (116). */
export function payloadFromBlocks(blocks: Block[]): TzPayload {
  const tables = blocks.filter((b): b is ["T", string[][]] => b[0] === "T").map((b) => b[1]);
  const paras = blocks.filter((b): b is ["P", string] => b[0] === "P").map((b) => b[1].trim());
  const num = /№\s*(\d+)/.exec(paras[0])![1];
  const dateRu = /(\d{2})\.(\d{2})\.(\d{4})/.exec(tables[0][0][1])!;
  const head = tables[1][0];
  const repair = /услуг/i.test(head[1]);
  const extra = head.length === 12; // столбец «Дополнительные материалы» между работой и стоимостью продукции
  const p = emptyTz(repair ? "REPAIR" : "WORK", num, `${dateRu[3]}-${dateRu[2]}-${dateRu[1]}`);
  p.city = norm(tables[0][0][0]);
  p.contract = /к Договору подряда\s*(.*?)\s*$/.exec(paras[1])![1].trim();
  p.vatPct = /НДС\s*(\d+)\s*%/.exec(norm(head[head.length - 1]))?.[1] ?? "22";
  const rows = tables[1].slice(1).filter((r) => /^\d+\.?$/.test(r[0].trim()));
  const totalRow = tables[1].find((r) => /^Итого/i.test(r[0].trim()))!;
  p.showWorkTotal = norm(totalRow[2] ?? "") !== "";
  p.items = rows.map((r) => {
    const it: TzItem = { name: nl(r[1]), color: nl(r[2]), model: nl(r[3]), material: nl(r[4]), size: nl(r[5]), lining: nl(r[6]), qty: norm(r[7]), pelts: "", work: norm(r[8]), price: norm(r[extra ? 10 : 9]), ...(extra ? { extra: norm(r[9]) } : {}) };
    const typed = norm(r[extra ? 11 : 10]);
    const auto = itemTotal(it, p.kind);
    if (typed !== kopNum(auto)) it.total = typed; // расчёт не даёт того, что вписано, — берём вписанное
    return it;
  });
  p.materials = tables[2].slice(2).filter((r) => r.length >= 7 && r[0].trim() && !/^ИТОГО/i.test(r[0])).map((r) => {
    const m: TzMaterial = { name: nl(r[0]), lot: nl(r[1]), unit: norm(r[2]), qty: norm(r[3]), priceNet: norm(r[4]), vatPct: r[5].replace("%", "").trim() };
    const typed = norm(r[6]);
    if (typed !== spacedNum(materialTotal(m))) m.total = typed;
    return m;
  });
  const pickP = (re: RegExp) => paras.find((x) => re.test(x))?.replace(re, "").trim().replace(/\.$/, "") ?? "";
  const t = defaultTerms(p.kind);
  t.payment = pickP(/^Порядок оплаты:\s*/) || t.payment;
  const dl = /не позднее\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(paras.find((x) => /^Срок завершения Работ/.test(x)) ?? "");
  t.deadline = dl ? `${dl[3]}-${dl[2]}-${dl[1]}` : "";
  t.delivery = pickP(/^Срок поставки Продукции:\s*/) || t.delivery;
  t.place = pickP(/^Место поставки\/самовывоза Продукции:\s*/) || t.place;
  t.method = pickP(/^Способ поставки Продукции:\s*/)|| t.method;
  t.other = pickP(/^Иные характеристики Продукции:\s*/) || t.other;
  p.terms = t;
  const sum = /составляет\s*(.*?)\s*рубл/.exec(paras.find((x) => /^Общая стоимость настоящего/.test(x)) ?? "")?.[1];
  if (sum && norm(sum) !== plainNum(tzTotals(p).total)) p.totalText = norm(sum);
  const sg = tables[tables.length - 1];
  p.showMatQty = norm(tables[2][tables[2].length - 1][1] ?? "") !== "";
  // в ячейках подписей считаются и пустые абзацы под должностью («\n» в конце)
  const sgCell = (t: string) => t.split("\n").map(norm).join("\n");
  p.signers = { customerPost: sgCell(sg[1][0]), customerName: norm(sg[2][0]).replace(/^_+\s*/, ""), contractorPost: sgCell(sg[1][1]), contractorName: norm(sg[2][1]).replace(/^_+\s*/, "") };
  return p;
}
