import JSZip from "jszip";
import { TZ_TEMPLATE_B64 } from "@/lib/tz-template-data";
import { itemFilled, kopNum, materialFilled, plainNum, ruDate, spacedNum, typedNum, tzTotals, type TzPayload } from "@/lib/tz-vendor";

/**
 * Word-документ ТЗ в формате Веллмеха («ПРИЛОЖЕНИЕ N к Договору подряда»).
 * Вёрстка берётся из присланного Веллмехом Word (шаблон tz-template-data.ts: поля, стили, ширины колонок, границы, интервалы,
 * кегль, пустые абзацы) — генератор меняет в нём только тексты и размножает строки таблиц. Если текст ячейки или абзаца не
 * отличается от шаблона (без учёта пробелов), его XML остаётся нетронутым, поэтому ТЗ с теми же данными получается в той же вёрстке.
 * Прежний генератор (src/lib/tz-print.ts, /api/production/[id]/docx) не затронут.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const squash = (s: string) => s.replace(/[\s  ]+/g, "");

// ——— абзац ———
const paraOf = (xml: string) => xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
function paraText(p: string): string {
  return unesc([...p.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(""));
}
/** Новый текст в абзаце: свойства абзаца и первого фрагмента (шрифт, кегль, жирность) сохраняются, «\n» — перенос строки. */
function setParaText(p: string, text: string): string {
  const open = /^<w:p(?: [^>]*)?>/.exec(p)![0];
  const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p)?.[0] ?? "";
  const runRpr = /<w:r(?: [^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/.exec(p)?.[1];
  const rPr = runRpr ?? /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(pPr)?.[0] ?? "";
  const parts = text.split("\n");
  const body = text === "" ? "" : `<w:r>${rPr}${parts.map((t, i) => `${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${esc(t)}</w:t>`).join("")}</w:r>`;
  return `${open}${pPr}${body}</w:p>`;
}

// ——— ячейка, строка, таблица ———
/** Текст ячейки: строки через «\n» — отдельные абзацы, как в образце. */
function setCell(tc: string, text: string): string {
  const ps = paraOf(tc);
  if (!ps.length) return tc;
  if (squash(ps.map(paraText).join("")) === squash(text)) return tc; // совпало с шаблоном — вёрстку не трогаем
  const head = tc.slice(0, tc.indexOf(ps[0]!));
  const out = text.split("\n").map((t, i) => setParaText(ps[Math.min(i, ps.length - 1)], t));
  return head + out.join("") + "</w:tc>";
}
const cellsOf = (tr: string) => tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [];
function setRow(tr: string, texts: (string | null)[]): string {
  let out = tr;
  cellsOf(tr).forEach((c, i) => {
    const t = texts[i];
    if (t != null) out = out.replace(c, () => setCell(c, t));
  });
  return out;
}
const rowsOf = (tbl: string) => tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? [];
function withRows(tbl: string, rows: string[]): string {
  const old = rowsOf(tbl);
  const start = tbl.indexOf(old[0]!);
  const end = tbl.lastIndexOf(old[old.length - 1]) + old[old.length - 1].length;
  return tbl.slice(0, start) + rows.join("") + tbl.slice(end);
}
/** k-я строка данных берёт k-ю строку-образец; лишние строки — копии последнего образца. */
const pick = <T,>(tpl: T[], k: number) => tpl[Math.min(k, tpl.length - 1)];

export async function buildTzDocx(p: TzPayload): Promise<Buffer> {
  const zip = await JSZip.loadAsync(Buffer.from(TZ_TEMPLATE_B64, "base64"));
  const xml = await zip.file("word/document.xml")!.async("string");
  const bodyStart = xml.indexOf("<w:body>") + "<w:body>".length;
  const bodyEnd = xml.lastIndexOf("</w:body>");
  const blocks = xml.slice(bodyStart, bodyEnd).match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:sectPr[\s\S]*?<\/w:sectPr>/g)!;

  const t = tzTotals(p);
  const vat = p.vatPct.trim() || "22";
  const repair = p.kind === "REPAIR";
  const items = p.items.filter(itemFilled);
  const mats = p.materials.filter(materialFilled);

  const setPara = (prefix: string, text: string) => {
    const i = blocks.findIndex((b) => b.startsWith("<w:p") && paraText(b).trimStart().startsWith(prefix));
    if (i >= 0 && squash(paraText(blocks[i])) !== squash(text)) blocks[i] = setParaText(blocks[i], text);
  };
  const tbl = blocks.map((b, i) => (b.startsWith("<w:tbl>") ? i : -1)).filter((i) => i >= 0);

  setPara("ПРИЛОЖЕНИЕ №", `ПРИЛОЖЕНИЕ № ${p.number}`);
  setPara("к Договору подряда", `к Договору подряда ${p.contract} `);
  setPara("ТЕХНИЧЕСКОЕ ЗАДАНИЕ №", `ТЕХНИЧЕСКОЕ ЗАДАНИЕ № ${p.number}`);

  // город и дата
  blocks[tbl[0]] = withRows(blocks[tbl[0]!]!, [setRow(rowsOf(blocks[tbl[0]!]!)[0]!, [p.city, `${ruDate(p.date)}г.`])]);

  // изделия: заголовок, строки, «Итого:»
  {
    const rows = rowsOf(blocks[tbl[1]]);
    const data = rows.slice(1, -1);
    const head = setRow(rows[0]!, [
      null, repair ? "Наименование услуги" : "Наименование Продукции", null, null, null, null, null, null,
      repair ? `Стоимость работ в руб. т.ч. НДС\n${vat}%` : `Стоимость работ за ед. в руб. т.ч. НДС\n${vat}%`,
      repair ? `Стоимость материала в руб. в т.ч. НДС ${vat}%` : `Стоимость продукции за ед. в руб. в т.ч. НДС ${vat}%`,
      `ИТОГО в руб. в т.ч. НДС ${vat}%`,
    ]);
    const body = items.map((i, k) => setRow(pick(data, k), [
      String(k + 1), i.name, i.color, i.model, i.material, i.size, i.lining, i.qty, typedNum(i.work), typedNum(i.price), i.total?.trim() ? i.total.trim() : kopNum(t.itemTotals[p.items.indexOf(i)] ?? 0),
    ]));
    const showWork = p.showWorkTotal !== false;
    const total = setRow(rows[rows.length - 1], [
      "Итого:", plainNum(t.qty), showWork ? (repair ? kopNum(t.work) : plainNum(t.work)) : "", repair ? kopNum(t.price) : "", repair ? spacedNum(t.total) : kopNum(t.total),
    ]);
    blocks[tbl[1]] = withRows(blocks[tbl[1]], [head, ...body, total]);
  }

  // «ЗАКАЗЧИК ПЕРЕДАЛ»
  {
    const rows = rowsOf(blocks[tbl[2]]);
    const data = rows.slice(2, -1);
    const head = setRow(rows[1], [null, null, null, null, null, null, `Общая стоимость товаров в т.ч. НДС ${vat}%`]);
    const body = mats.map((m, k) => setRow(pick(data, k), [
      m.name, m.lot, m.unit, m.qty, typedNum(m.priceNet), `${m.vatPct || vat}%`, m.total?.trim() ? m.total.trim() : spacedNum(t.matTotals[p.materials.indexOf(m)] ?? 0),
    ]));
    const total = setRow(rows[rows.length - 1], ["ИТОГО:", t.matQty ? plainNum(t.matQty) : "", "", "", spacedNum(t.materials)]);
    blocks[tbl[2]] = withRows(blocks[tbl[2]], [rows[0]!, head, ...body, total]);
  }

  // условия
  const tm = p.terms;
  setPara("Общая стоимость настоящего", `Общая стоимость настоящего Технического задания № ${p.number} (далее по тексту – ТЗ) составляет ${plainNum(t.total)} рублей в т.ч. НДС ${vat}%.`);
  setPara("Порядок оплаты:", `Порядок оплаты: ${tm.payment}.`);
  setPara("Срок завершения Работ:", `Срок завершения Работ: не позднее ${ruDate(tm.deadline)} г.`);
  setPara("Срок поставки Продукции:", `Срок поставки Продукции: ${tm.delivery}.`);
  setPara("Место поставки/самовывоза Продукции:", `Место поставки/самовывоза Продукции: ${tm.place}.`);
  setPara("Способ поставки Продукции:", `Способ поставки Продукции: ${tm.method}.`);
  setPara("Иные характеристики Продукции:", `Иные характеристики Продукции: ${tm.other}`);

  // подписи
  {
    const rows = rowsOf(blocks[tbl[3]]);
    const sg = p.signers;
    blocks[tbl[3]] = withRows(blocks[tbl[3]], [
      rows[0]!,
      setRow(rows[1]!, [sg.customerPost, sg.contractorPost]),
      setRow(rows[2], [`___________________________ ${sg.customerName}`, `________________________ ${sg.contractorName}`]),
    ]);
  }

  zip.file("word/document.xml", xml.slice(0, bodyStart) + blocks.join("") + xml.slice(bodyEnd));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// ——— Предпросмотр: HTML-копия того же документа (строится из собранного Word, поэтому тексты и порядок блоков совпадают) ———
const jcOf = (p: string) => /<w:jc w:val="(\w+)"/.exec(p)?.[1];
function htmlPara(p: string): string {
  const jc = jcOf(p);
  const bold = /<w:r(?: [^>]*)?>\s*<w:rPr>[\s\S]*?<w:b(?:\/| w:val="(?:1|true)"\/)>/.test(p);
  const txt = paraText(p.replace(/<w:br\/>/g, "<w:t>\n</w:t>")).split("\n").map(esc).join("<br>");
  const al = jc === "center" ? "center" : jc === "right" ? "right" : "left";
  return `<p style="text-align:${al};${bold ? "font-weight:bold" : ""}">${txt || "&nbsp;"}</p>`;
}
export async function tzPreviewHtml(p: TzPayload): Promise<string> {
  const zip = await JSZip.loadAsync(await buildTzDocx(p));
  const xml = await zip.file("word/document.xml")!.async("string");
  const sect = /<w:pgMar [^>]*w:top="(\d+)" [^>]*w:right="(\d+)" [^>]*w:bottom="(\d+)" [^>]*w:left="(\d+)"/.exec(xml);
  const mm = (v?: string) => (Number(v ?? 0) / 56.7).toFixed(1) + "mm";
  const blocks = xml.slice(xml.indexOf("<w:body>") + 8, xml.lastIndexOf("</w:body>")).match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];
  const body = blocks.map((b) => {
    if (!b.startsWith("<w:tbl>")) return htmlPara(b);
    const borderless = /<w:tblBorders>[\s\S]*?w:val="none"/.test(b);
    const grid = [...b.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((m) => Number(m[1]));
    const rows = (b.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []).map((r) => {
      const cells = (r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((c) => {
        const span = /<w:gridSpan w:val="(\d+)"/.exec(c)?.[1];
        const w = /<w:tcW w:w="(\d+)"/.exec(c)?.[1];
        const mid = /<w:vAlign w:val="center"/.test(c);
        return `<td${span ? ` colspan="${span}"` : ""} style="${borderless ? "" : "border:1px solid #000;"}${mid ? "vertical-align:middle;" : "vertical-align:top;"}${w ? `width:${(Number(w) / 20).toFixed(0)}pt;` : ""}padding:1px 4px">${(c.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(htmlPara).join("")}</td>`;
      });
      return `<tr>${cells.join("")}</tr>`;
    });
    const tw = grid.reduce((s, x) => s + x, 0) / 20;
    return `<table style="border-collapse:collapse;width:${tw.toFixed(0)}pt;max-width:100%;table-layout:auto">${rows.join("")}</table>`;
  });
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
body{margin:0;background:#e5e5e5;font:9pt/1.15 "Times New Roman",Times,serif;color:#000}
.page{box-sizing:border-box;width:210mm;min-height:297mm;margin:12px auto;background:#fff;padding:${mm(sect?.[1])} ${mm(sect?.[2])} ${mm(sect?.[3])} ${mm(sect?.[4])};box-shadow:0 1px 4px rgba(0,0,0,.3)}
p{margin:0}td{font-size:9pt}table{margin:0}
@media (max-width:800px){.page{width:auto;margin:0}}
</style></head><body><div class="page">${body.join("")}</div></body></html>`;
}
