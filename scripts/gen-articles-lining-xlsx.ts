/**
 * Excel «Артикулы по ТЗ и подкладка»: лист «Артикулы» (по строке на артикул: ТЗ, количество, какая подкладка записана в ТЗ и какая списана материалом) и лист «ТЗ» (по строке на ТЗ).
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/gen-articles-lining-xlsx.ts <результат.xlsx>
 */
import "./stubs/server-only-shim";
import ExcelJS from "exceljs";

const STATUS: Record<string, string> = { PLANNED: "Запланировано", IN_PROGRESS: "В работе", COMPLETED: "Завершено", CANCELLED: "Отменено" };
const num = (v: unknown) => Number(v ?? 0) || 0;

(async () => {
  const out = process.argv[2];
  if (!out) throw new Error("usage: <результат.xlsx>");
  const { prisma } = await import("../src/lib/prisma");
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const orders = await prisma.productionOrder.findMany({
    where: { organizationId: org, status: { not: "CANCELLED" } },
    orderBy: { number: "asc" },
    select: {
      number: true, status: true, plannedQuantity: true, producedQuantity: true, color: true, size: true, lining: true, materialDescription: true, startDate: true,
      productModel: { select: { id: true, name: true, salesCode: true, salesName: true, category: true } },
      materialUsages: { select: { quantity: true, rawMaterial: { select: { name: true, unit: true } } } },
    },
  });

  type TzRow = { art: string; code: string; sname: string; cat: string; number: string; status: string; planned: number; produced: number; color: string; size: string; liningText: string; furText: string; liningMat: string; liningM: number; furMat: string };
  const rows: TzRow[] = orders.map((o) => {
    const lin = new Map<string, number>(), fur = new Map<string, number>();
    for (const u of o.materialUsages) {
      const m = u.rawMaterial.unit === "M" ? lin : fur;
      m.set(u.rawMaterial.name, (m.get(u.rawMaterial.name) ?? 0) + num(u.quantity));
    }
    return {
      art: o.productModel.name, code: o.productModel.salesCode ?? "", sname: o.productModel.salesName ?? "", cat: o.productModel.category ?? "",
      number: o.number, status: STATUS[o.status] ?? o.status, planned: num(o.plannedQuantity), produced: num(o.producedQuantity), color: (o.color ?? "").trim(), size: (o.size ?? "").trim(),
      liningText: (o.lining ?? "").trim(), furText: (o.materialDescription ?? "").trim(),
      liningMat: [...lin].map(([n, q]) => `${n} (${Math.round(q * 10) / 10} м)`).join("; "), liningM: [...lin.values()].reduce((a, b) => a + b, 0),
      furMat: [...fur].map(([n, q]) => `${n} (${Math.round(q)} шт.)`).join("; "),
    };
  });

  const wb = new ExcelJS.Workbook(); wb.creator = "МехУчёт";
  const head = (ws: ExcelJS.Worksheet, widths: number[]) => {
    ws.getRow(1).font = { bold: true }; ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
    ws.getRow(1).eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E7F7" } }; c.border = { bottom: { style: "thin" } }; });
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: widths.length } };
  };

  // Лист 1: по артикулам
  const A = wb.addWorksheet("Артикулы");
  A.addRow(["Артикул", "Код в продажах", "Название в продажах", "Категория", "ТЗ, шт.", "Номера ТЗ", "Заказано, шт.", "Произведено, шт.", "Подкладка, как записана в ТЗ", "Подкладка, списанный материал (м)", "Метров подкладки всего", "Материал меха в ТЗ"]);
  const byArt = new Map<string, TzRow[]>();
  for (const r of rows) (byArt.get(r.art) ?? byArt.set(r.art, []).get(r.art)!).push(r);
  // одинаковые записи в разном написании («100 % Шелк» / «100% шелк») считаем одной, показываем первую
  const uniq = (xs: string[]) => { const seen = new Map<string, string>(); for (const x of xs.filter(Boolean)) { const k = x.toLowerCase().replace(/\s+/g, "").replace(/ё/g, "е"); if (!seen.has(k)) seen.set(k, x); } return [...seen.values()]; };
  for (const [art, rs] of [...byArt].sort((a, b) => a[0].localeCompare(b[0], "ru", { numeric: true }))) {
    const matAgg = new Map<string, number>();
    for (const r of rs) for (const part of r.liningMat.split("; ").filter(Boolean)) { const m = /^(.*) \(([\d.,]+) м\)$/.exec(part); if (m) matAgg.set(m[1], (matAgg.get(m[1]) ?? 0) + Number(m[2].replace(",", "."))); }
    A.addRow([art, rs[0].code, rs[0].sname, rs[0].cat, rs.length, rs.map((r) => r.number).join(", "), rs.reduce((a, r) => a + r.planned, 0), rs.reduce((a, r) => a + r.produced, 0),
      uniq(rs.map((r) => r.liningText)).join(" | ") || "не указана", [...matAgg].map(([n, q]) => `${n} (${Math.round(q * 10) / 10} м)`).join("; ") || "не списана", Math.round(rs.reduce((a, r) => a + r.liningM, 0) * 10) / 10, uniq(rs.map((r) => r.furText)).join(" | ")]);
  }
  head(A, [16, 14, 28, 18, 8, 34, 11, 13, 42, 48, 12, 44]);
  A.eachRow((r, i) => { if (i > 1) r.alignment = { vertical: "top", wrapText: true }; });

  // Лист 2: по ТЗ
  const T = wb.addWorksheet("ТЗ");
  T.addRow(["Артикул", "Номер ТЗ", "Статус", "Цвет", "Размер", "Заказано, шт.", "Произведено, шт.", "Подкладка, как записана в ТЗ", "Подкладка, списанный материал (м)", "Материал меха (шт.)"]);
  for (const r of rows.sort((a, b) => a.art.localeCompare(b.art, "ru", { numeric: true }) || a.number.localeCompare(b.number, "ru", { numeric: true }))) T.addRow([r.art, r.number, r.status, r.color, r.size, r.planned, r.produced, r.liningText || "не указана", r.liningMat || "не списана", r.furMat]);
  head(T, [16, 14, 14, 18, 14, 11, 13, 40, 46, 46]);
  T.eachRow((r, i) => { if (i > 1) r.alignment = { vertical: "top", wrapText: true }; });

  await wb.xlsx.writeFile(out);
  console.log(out, JSON.stringify({ articles: byArt.size, tz: rows.length, withLiningText: rows.filter((r) => r.liningText).length, withLiningMat: rows.filter((r) => r.liningMat).length }));
  process.exit(0);
})().catch((e) => { console.error(String(e).slice(0, 600)); process.exit(1); });
