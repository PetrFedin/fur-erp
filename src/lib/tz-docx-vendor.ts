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
