import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { getFreshSession } from "@/lib/session";
import { loadTzDoc, type TzDoc, type TzLine } from "@/lib/tz-print";
import { parseCommission4Cookie } from "@/lib/commission4-mode";
import { parseVatModeCookie } from "@/lib/vat-mode";

export const dynamic = "force-dynamic";

const FONT = "Arial";
const PAGE_W = 11906; // A4, DXA
const PAGE_H = 16838;
const MARGIN = 851; // 15 мм
const CONTENT_W = PAGE_W - 2 * MARGIN;

const border = { style: BorderStyle.SINGLE, size: 4, color: "444444" };
const borders = { top: border, bottom: border, left: border, right: border };

function run(text: string, opts: { bold?: boolean; size?: number } = {}) {
  return new TextRun({ text, bold: opts.bold, size: opts.size ?? 20, font: FONT });
}

function para(text: string, opts: { bold?: boolean; size?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; before?: number; after?: number } = {}) {
  return new Paragraph({
    alignment: opts.align,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 60 },
    children: [run(text, opts)],
  });
}

function cell(text: string, w: number, opts: { bold?: boolean; right?: boolean; head?: boolean; span?: number } = {}) {
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    columnSpan: opts.span,
    borders,
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
    shading: opts.head ? { type: ShadingType.CLEAR, fill: "EEEEEE", color: "auto" } : { type: ShadingType.CLEAR, fill: "FFFFFF", color: "auto" },
    children: [
      new Paragraph({
        alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [run(text, { bold: opts.bold || opts.head, size: 18 })],
      }),
    ],
  });
}

function table(widths: number[], rows: TableRow[]) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    rows,
  });
}

function lotTable(rows: TzLine[], total: string) {
  const w = [1300, 3904, 1600, 1700, 1700];
  const head = new TableRow({
    tableHeader: true,
    children: ["Лот", "Материал", "Кол-во", "Цена за ед.", "Сумма"].map((t, i) => cell(t, w[i], { head: true, right: i >= 2 })),
  });
  const body = rows.map(
    (r) =>
      new TableRow({
        children: [cell(r.lot, w[0]), cell(r.material, w[1]), cell(r.qty, w[2], { right: true }), cell(r.unitPrice, w[3], { right: true }), cell(r.sum, w[4], { right: true })],
      }),
  );
  if (rows.length === 0) body.push(new TableRow({ children: [cell("—", CONTENT_W, { span: 5 })] }));
  const foot = new TableRow({
    children: [cell("Итого", w[0] + w[1] + w[2] + w[3], { bold: true, span: 4 }), cell(total, w[4], { bold: true, right: true })],
  });
  return table(w, [head, ...body, foot]);
}

function buildDoc(d: TzDoc) {
  const vatNote = d.vatMode === "excl" ? "без НДС" : "с НДС";
  const c4Note = d.c4Applied ? ", с учётом 4%" : "";
  const kids: (Paragraph | Table)[] = [];

  kids.push(para(d.title, { bold: true, size: 28, align: AlignmentType.CENTER }));
  kids.push(para(`к ${d.contract}`, { size: 22, align: AlignmentType.CENTER, after: 200 }));

  const info: [string, string][] = [
    ["Заказчик", d.customer || "—"],
    ["Партия", d.batch || "—"],
    ["Дата ТЗ", d.date || "—"],
    ["Заказ (внутр.)", d.orderNumber],
  ];
  if (d.material) info.push(["Материал", d.material]);
  const iw = [2200, CONTENT_W - 2200];
  kids.push(
    table(
      iw,
      info.map(
        ([k, v]) =>
          new TableRow({
            children: [cell(k, iw[0], { bold: true }), cell(v, iw[1])],
          }),
      ),
    ),
  );

  kids.push(para("Изделия", { bold: true, size: 22, before: 240 }));
  const pw = [2300, 1500, 1600, 1200, 1700, 1904];
  kids.push(
    table(pw, [
      new TableRow({
        tableHeader: true,
        children: ["Модель", "Цвет", "Размеры", "Кол-во, шт.", "Работа за ед.", "Сумма работы"].map((t, i) =>
          cell(t, pw[i], { head: true, right: i >= 3 }),
        ),
      }),
      new TableRow({
        children: [
          cell(d.model, pw[0]),
          cell(d.color || "—", pw[1]),
          cell(d.size || "—", pw[2]),
          cell(d.qty, pw[3], { right: true }),
          cell(d.workPerUnit, pw[4], { right: true }),
          cell(d.workSum, pw[5], { right: true }),
        ],
      }),
    ]),
  );

  kids.push(para(`Сырьё по лотам (${vatNote}${c4Note})`, { bold: true, size: 22, before: 240 }));
  kids.push(lotTable(d.fur, d.totals.fur));

  if (d.hasLining) {
    if (d.liningText) kids.push(para(`Подкладка по ТЗ: ${d.liningText}`, { before: 200 }));
    if (d.lining.length > 0) {
      kids.push(para(`Подкладка (${vatNote}${c4Note})`, { bold: true, size: 22, before: 160 }));
      kids.push(lotTable(d.lining, d.totals.lining));
    }
  }

  if (d.expenses.length > 0) {
    kids.push(para("Расходы", { bold: true, size: 22, before: 240 }));
    const ew = [3500, 4504, 2200];
    kids.push(
      table(ew, [
        new TableRow({ tableHeader: true, children: ["Статья", "Описание", "Сумма"].map((t, i) => cell(t, ew[i], { head: true, right: i === 2 })) }),
        ...d.expenses.map(
          (e) => new TableRow({ children: [cell(e.name, ew[0]), cell(e.description || "—", ew[1]), cell(e.sum, ew[2], { right: true })] }),
        ),
        new TableRow({ children: [cell("Итого", ew[0] + ew[1], { bold: true, span: 2 }), cell(d.totals.expenses, ew[2], { bold: true, right: true })] }),
      ]),
    );
  }

  kids.push(para("Итоги", { bold: true, size: 22, before: 240 }));
  const tw = [6004, 4200];
  const sums: [string, string, boolean][] = [["Сырьё", d.totals.fur, false]];
  if (d.lining.length > 0) sums.push(["Подкладка", d.totals.lining, false]);
  if (d.expenses.length > 0) sums.push(["Расходы", d.totals.expenses, false]);
  sums.push(["Работа", d.totals.work, false], ["Всего", d.totals.total, true]);
  kids.push(
    table(
      tw,
      sums.map(([k, v, b]) => new TableRow({ children: [cell(k, tw[0], { bold: b }), cell(v, tw[1], { bold: b, right: true })] })),
    ),
  );
  kids.push(para(`Суммы ${vatNote}${c4Note}. ${d.vatRatesNote}`.trim(), { size: 16, before: 60 }));

  // Подписи: таблица без рамок, линия — нижняя граница.
  const sw = [4800, 604, 4800];
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const sigCell = (title: string, name: string, w: number) =>
    new TableCell({
      width: { size: w, type: WidthType.DXA },
      borders: { top: none, left: none, right: none, bottom: none },
      shading: { type: ShadingType.CLEAR, fill: "FFFFFF", color: "auto" },
      children: [
        new Paragraph({ spacing: { before: 400, after: 40 }, children: [run(title, { bold: true })] }),
        new Paragraph({ spacing: { after: 400 }, children: [run(name || " ")] }),
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 1 } },
          children: [run(" ")],
        }),
        new Paragraph({ children: [run("подпись / М.П.", { size: 16 })] }),
      ],
    });
  const gap = new TableCell({
    width: { size: sw[1], type: WidthType.DXA },
    borders: { top: none, left: none, right: none, bottom: none },
    shading: { type: ShadingType.CLEAR, fill: "FFFFFF", color: "auto" },
    children: [new Paragraph("")],
  });
  kids.push(table(sw, [new TableRow({ cantSplit: true, children: [sigCell("Заказчик", d.customer, sw[0]), gap, sigCell("Исполнитель", "", sw[2])] })]));

  return new Document({
    creator: "THE FUR",
    title: d.title,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [
      {
        properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
        children: kids,
      },
    ],
  });
}

/** Печатная форма ТЗ в .docx. Читают все роли; доступ только к ТЗ своей организации. */
export async function GET(request: Request, ctx: RouteContext<"/api/production/[id]/docx">) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const cookie = (name: string) => request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))?.[1];
  const c4Mode = parseCommission4Cookie(url.searchParams.get("c4") ?? cookie("commission4Display"));
  const vatMode = parseVatModeCookie(url.searchParams.get("vat") ?? cookie("vatDisplay"));

  const d = await loadTzDoc(id, session.user.organizationId, c4Mode, vatMode);
  if (!d) return new Response("Not found", { status: 404 });

  const buf = await Packer.toBuffer(buildDoc(d));
  const fileName = `${d.fileName}.docx`;
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Length": String(buf.length),
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="tz.docx"; filename*=UTF-8''${encoded}`,
    },
  });
}
