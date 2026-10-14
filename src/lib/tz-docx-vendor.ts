import { AlignmentType, BorderStyle, Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType } from "docx";
import { plainNum, ruDate, spacedNum, tzTotals, type TzPayload } from "@/lib/tz-vendor";

/**
 * Word-документ ТЗ в формате Веллмеха («ПРИЛОЖЕНИЕ N к Договору подряда»), сверено с образцом «ПРИЛОЖЕНИЕ 160»:
 * A4, поля 15 мм (сверху 10 мм), Times New Roman, 9 пт в тексте и таблицах, колонтитулов нет.
 * Это НОВЫЙ генератор; прежний (src/lib/tz-print.ts, /api/production/[id]/docx) не затронут.
 */
const FONT = "Times New Roman";
const SZ = 18; // 9 пт — как в образце
const PAGE_W = 11906;
const MARGIN = 850;
const CONTENT_W = PAGE_W - 2 * MARGIN;

const line = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const grid = { top: line, bottom: line, left: line, right: line };
const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders = { top: none, bottom: none, left: none, right: none };

const run = (text: string, bold = false) => new TextRun({ text, bold, font: FONT, size: SZ });
const para = (text: string, o: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number } = {}) =>
  new Paragraph({ alignment: o.align, spacing: { after: o.after ?? 120, line: 240 }, children: [run(text, o.bold)] });

function cell(text: string, w: number, o: { bold?: boolean; span?: number; borders?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) {
  const parts = text.split("\n");
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    columnSpan: o.span,
    borders: o.borders === false ? noBorders : grid,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 30, bottom: 30, left: 60, right: 60 },
    children: parts.map((t) => new Paragraph({ alignment: o.align ?? AlignmentType.CENTER, spacing: { after: 0, line: 240 }, children: [run(t, o.bold)] })),
  });
}
const scale = (ws: number[]) => {
  const sum = ws.reduce((a, b) => a + b, 0);
  const out = ws.map((w) => Math.floor((w * CONTENT_W) / sum));
  out[out.length - 1] += CONTENT_W - out.reduce((a, b) => a + b, 0);
  return out;
};

export async function buildTzDocx(p: TzPayload): Promise<Buffer> {
  const t = tzTotals(p);
  const vat = p.vatPct.trim() || "22";
  const repair = p.kind === "REPAIR";
  const items = p.items.filter((i) => Object.values(i).some((v) => v.trim() !== "" && v !== "1"));
  const mats = p.materials.filter((m) => Object.values(m).some((v) => v.trim() !== "" && v !== "Шт." && v !== "22"));

  // Таблица изделий (поколение «ТЗ 100+»)
  const w1 = scale([412, 1114, 850, 709, 1418, 567, 1275, 851, 1134, 1134, 1134]);
  const head = [
    "№", repair ? "Наименование услуги" : "Наименование Продукции", "Цвет", "Модель", "Материал Продукции", "Размер", "Подкладка", "Количество",
    `Стоимость работ за ед. в руб. т.ч. НДС${vat}%`, `${repair ? "Стоимость материала" : "Стоимость продукции"} за ед. в руб. в т.ч. НДС ${vat}%`, `ИТОГО в руб. в т.ч. НДС ${vat}%`,
  ];
  const itemRows = items.map((i, k) => new TableRow({
    children: [String(k + 1), i.name, i.color, i.model, i.material, i.size, i.lining, i.qty, plainNum(Number(i.work.replace(",", ".")) || 0), plainNum(Number(i.price.replace(",", ".")) || 0), plainNum(t.itemTotals[p.items.indexOf(i)] ?? 0)]
      .map((v, c) => cell(v, w1[c])),
  }));
  const itemsTable = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: w1,
    rows: [
      new TableRow({ tableHeader: true, children: head.map((h, c) => cell(h, w1[c], { bold: true })) }),
      ...itemRows,
      new TableRow({ children: [
        cell("Итого:", w1[0] + w1[1] + w1[2] + w1[3] + w1[4] + w1[5] + w1[6], { span: 7, bold: true }),
        cell(plainNum(t.qty), w1[7], { bold: true }), cell(plainNum(t.work), w1[8], { bold: true }), cell("", w1[9]), cell(plainNum(t.total), w1[10], { bold: true }),
      ] }),
    ],
  });

  // «ЗАКАЗЧИК ПЕРЕДАЛ»
  const w2 = scale([3510, 993, 1115, 1153, 1559, 850, 1418]);
  const matRows = mats.map((m) => new TableRow({
    children: [m.name, m.lot, m.unit, m.qty, spacedNum(Number(m.priceNet.replace(",", ".")) || 0), `${m.vatPct || vat}%`, spacedNum(t.matTotals[p.materials.indexOf(m)] ?? 0)].map((v, c) => cell(v, w2[c])),
  }));
  const matTable = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: w2,
    rows: [
      new TableRow({ children: [cell("ЗАКАЗЧИК ПЕРЕДАЛ\n(заполняет при передаче сырья, материалов и т.д. со стороны Заказчика)", CONTENT_W, { span: 7, bold: true })] }),
      new TableRow({ children: ["Наименование материалов", "Лот (при наличии)", "Единица измерения", "Количество сырья", "Стоимость за единицу в рублях Без НДС", "НДС", `Общая стоимость товаров в т.ч. НДС ${vat}%`].map((h, c) => cell(h, w2[c], { bold: true })) }),
      ...matRows,
      new TableRow({ children: [cell("ИТОГО:", w2[0] + w2[1] + w2[2] + w2[3] + w2[4] + w2[5], { span: 6, bold: true, align: AlignmentType.LEFT }), cell(spacedNum(t.materials), w2[6], { bold: true })] }),
    ],
  });

  const half = Math.floor(CONTENT_W / 2);
  const two = (l: string, r: string, rBold = false, lBold = false) =>
    new TableRow({ children: [cell(l, half, { borders: false, align: AlignmentType.LEFT, bold: lBold }), cell(r, CONTENT_W - half, { borders: false, align: AlignmentType.RIGHT, bold: rBold })] });
  const cityTable = new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: [half, CONTENT_W - half], rows: [two(p.city, `${ruDate(p.date)}г.`)] });
  const signTable = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: [half, CONTENT_W - half],
    rows: [
      new TableRow({ children: [cell("ЗАКАЗЧИК", half, { borders: false, bold: true, align: AlignmentType.LEFT }), cell("ПОДРЯДЧИК", CONTENT_W - half, { borders: false, bold: true, align: AlignmentType.LEFT })] }),
      new TableRow({ children: [cell(p.signers.customerPost, half, { borders: false, align: AlignmentType.LEFT }), cell(p.signers.contractorPost, CONTENT_W - half, { borders: false, align: AlignmentType.LEFT })] }),
      new TableRow({ children: [cell(`___________________________ ${p.signers.customerName}`, half, { borders: false, align: AlignmentType.LEFT }), cell(`________________________ ${p.signers.contractorName}`, CONTENT_W - half, { borders: false, align: AlignmentType.LEFT })] }),
    ],
  });

  const tm = p.terms;
  const paras = [
    `Общая стоимость настоящего Технического задания № ${p.number} (далее по тексту – ТЗ) составляет ${plainNum(t.total)} рублей в т.ч. НДС ${vat}%.`,
    `Порядок оплаты: ${tm.payment}.`,
    `Срок завершения Работ: не позднее ${ruDate(tm.deadline)} г.`,
    `Срок поставки Продукции: ${tm.delivery}.`,
    `Место поставки/самовывоза Продукции: ${tm.place}.`,
    `Способ поставки Продукции: ${tm.method}.`,
    `Иные характеристики Продукции: ${tm.other}`,
    "Во всем остальном, что не предусмотрено в настоящем ТЗ, условия Договора сохраняют свою силу и остаются неизменными.",
    "В случае возникновения противоречий между условиями настоящего ТЗ и Договором преимущественную силу имеют положения данного ТЗ.",
    "Настоящее ТЗ приобретает юридическую силу с момента его подписания обеими Сторонами и становится неотъемлемой частью Договора.",
    "Настоящее ТЗ оформлено в 2 (двух) идентичных экземплярах, имеющих одинаковую юридическую силу, по одному для каждой из Сторон.",
  ];

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SZ } } } },
    sections: [{
      properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: 567, right: MARGIN, bottom: 284, left: 851, header: 0, footer: 0 } } },
      children: [
        para(`ПРИЛОЖЕНИЕ № ${p.number}`, { bold: true }),
        para(`к Договору подряда ${p.contract} `, { bold: true, align: AlignmentType.RIGHT }),
        para("", { after: 0 }),
        para(`ТЕХНИЧЕСКОЕ ЗАДАНИЕ № ${p.number}`, { bold: true, align: AlignmentType.CENTER, after: 0 }),
        cityTable,
        para("", { after: 0 }),
        itemsTable,
        para("", { align: AlignmentType.CENTER, after: 0 }),
        matTable,
        para("", { align: AlignmentType.CENTER }),
        ...paras.map((s) => para(s)),
        para("12.ПОДПИСИ СТОРОН", { bold: true }),
        signTable,
      ],
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
