// Excel: каракуль по лотам — куплено / ср. цена / использовано / остаток, раздельно Свакара, Каракуль, Бродтейл + справка.
// Группа лота — по тексту сорта (grade), затем по названию материала: «swakara/свакара» → Каракуль (свакара); «каракульча/broadtail/бродтейл» → Бродтейл; остальной «каракуль» → Каракуль.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/export-karakul-report.ts <out.xlsx>
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";

const GROUPS = ["Каракуль (свакара)", "Бродтейл"] as const;
type G = (typeof GROUPS)[number];
// Лоты, которые по документам закупки (расчёт SAGA 06-2025, «KARAKUL BROADTAIL GREY», 994 шт.) — бродтейл, хотя в УПД и в справочнике названы «шкурки каракуля».
const BROADTAIL_LOTS: Record<string, string> = Object.fromEntries(["728001", "728002", "728011", "728026"].map((n) => [n, "расчёт SAGA 06-2025: KARAKUL BROADTAIL GREY"]));
const groupOf = (grade: string, material: string, lot = ""): G | null => {
  if (BROADTAIL_LOTS[lot]) return "Бродтейл";
  const t = `${grade} ${material}`.toLowerCase();
  const g = grade.toLowerCase();
  if (/broadtail|бродтейл|брудтейл/.test(g)) return "Бродтейл";
  // «Каракульча» из закупки у поставщика (З-2026-0063) — по решению владельца 22.10 относим к Каракулю, не к Бродтейлу.
  if (/каракульч/.test(g) || /каракульч/.test(material.toLowerCase())) return "Каракуль (свакара)";
  if (/swakara|свакара/.test(g)) return "Каракуль (свакара)";
  if (/каракул|karakul/.test(g)) return "Каракуль (свакара)";
  if (/каракульч|broadtail/.test(material.toLowerCase())) return "Бродтейл";
  if (/свакара|swakara/.test(material.toLowerCase())) return "Каракуль (свакара)";
  return /каракул|karakul/.test(t) ? "Каракуль" : null;
};

async function main() {
  const out = process.argv[2]; if (!out) throw new Error("укажите путь файла");
  const prisma = new PrismaClient();
  const { loadRawData, lotValues } = await import("../src/lib/raw-analytics");
  const org = await prisma.organization.findFirst({ select: { id: true } });
  const data = await loadRawData(org!.id, "all");
  const { classifyPurchaseSource } = await import("../src/lib/purchase-source");
  const srcOf = new Map((await prisma.rawMaterialLot.findMany({ where: { organizationId: org!.id }, select: { id: true, purchase: { select: { isContractorRaw: true, auction: { select: { kind: true, house: true } } } } } })).map((l) => [l.id, l.purchase?.isContractorRaw ? "supplier" : classifyPurchaseSource(l.purchase?.auction)] as const));
  const grades = new Map((await prisma.rawMaterialLot.findMany({ where: { organizationId: org!.id }, select: { id: true, grade: true, color: true } })).map((l) => [l.id, l]));
  type Agg = { lots: number; recv: number; recvIn: number; recvEx: number; used: number; usedIn: number; usedEx: number; rem: number; remIn: number; remEx: number; other: number };
  const zero = (): Agg => ({ lots: 0, recv: 0, recvIn: 0, recvEx: 0, used: 0, usedIn: 0, usedEx: 0, rem: 0, remIn: 0, remEx: 0, other: 0 });
  const agg = new Map<G, Agg>(GROUPS.map((g) => [g, zero()]));
  const rows: { g: G; l: (typeof data.lots)[number]; grade: string }[] = [];
  for (const l of data.lots) {
    if (l.synthetic || l.unit === "M") continue;
    const gr = grades.get(l.id)?.grade ?? "";
    const g = groupOf(gr, l.materialName, l.lotNumber); if (!g) continue;
    const v = lotValues(l); const a = agg.get(g)!;
    a.lots++; a.recv += +l.recv; a.recvIn += +v.recvIncl; a.recvEx += +v.recvExcl; a.used += +l.used; a.usedIn += +l.usedIncl; a.usedEx += +l.usedExcl;
    a.rem += +l.rem; a.remIn += +v.remIncl; a.remEx += +v.remExcl; a.other += +l.otherOut; rows.push({ g, l, grade: gr });
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Отчёт");
  ws.columns = [{ width: 30 }, { width: 8 }, { width: 12 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  ws.addRow(["Каракуль: куплено, использовано, остаток (шкуры, ₽)"]).font = { bold: true, size: 13 };
  ws.addRow(["Все лоты закупки. Цены с НДС и без НДС. «Прочее списание» — получено − использовано − остаток."]);
  ws.addRow([]);
  const head = ["Вид", "Лотов", "Куплено, шт.", "Куплено, ₽ с НДС", "Ср. цена закупки, ₽/шт. с НДС", "Использовано, шт.", "Использовано, ₽ с НДС", "Остаток, шт.", "Остаток, ₽ с НДС", "Прочее списание, шт.", "Куплено, ₽ без НДС", "Ср. цена закупки, ₽/шт. без НДС", "Остаток, ₽ без НДС"];
  const hr = ws.addRow(head); hr.font = { bold: true }; hr.alignment = { wrapText: true, vertical: "middle" }; ws.getRow(hr.number).height = 44;
  const put = (name: string, a: Agg, bold = false) => {
    const r = ws.addRow([name, a.lots, +a.recv.toFixed(1), Math.round(a.recvIn), a.recv ? Math.round(a.recvIn / a.recv) : null, +a.used.toFixed(1), Math.round(a.usedIn), +a.rem.toFixed(1), Math.round(a.remIn), +a.other.toFixed(1), Math.round(a.recvEx), a.recv ? Math.round(a.recvEx / a.recv) : null, Math.round(a.remEx)]);
    if (bold) r.font = { bold: true };
  };
  for (const g of GROUPS) put(g, agg.get(g)!);
  const tot = zero(); for (const a of agg.values()) for (const k of Object.keys(tot) as (keyof Agg)[]) tot[k] += a[k];
  put("Всего", tot, true);
  for (let c = 3; c <= 13; c++) ws.getColumn(c).numFmt = "#,##0";
  ws.getColumn(3).numFmt = "#,##0.0"; ws.getColumn(6).numFmt = "#,##0.0"; ws.getColumn(8).numFmt = "#,##0.0"; ws.getColumn(10).numFmt = "#,##0.0";
  ws.addRow([]);
  ws.addRow(["Как отнесены лоты: по тексту сорта лота. «SWAKARA/свакара» → Каракуль (свакара); «каракульча/broadtail» → Бродтейл; «каракульча» из закупки у поставщика и прочее «каракуль» без слова swakara → Каракуль (4 шт. З-2026-0063 — по решению владельца); бродтейл — лоты, названные BROADTAIL в расчёте закупки. Лоты, где вид в справочнике «Свакара», но в сорте сказано просто «каракуль», попадают в Каракуль."]).alignment = { wrapText: true };
  ws.mergeCells(`A${ws.rowCount}:M${ws.rowCount}`); ws.getRow(ws.rowCount).height = 48;

  const wl = wb.addWorksheet("Лоты");
  wl.addRow(["Вид", "Лот", "Дата", "Аукцион", "Сорт (текст лота)", "Куплено, шт.", "Цена, ₽/шт. с НДС", "Куплено, ₽ с НДС", "Использовано, шт.", "Использовано, ₽ с НДС", "Остаток, шт.", "Остаток, ₽ с НДС"]).font = { bold: true };
  for (const { g, l, grade } of rows.sort((a, b) => a.g.localeCompare(b.g, "ru") || +a.l.date - +b.l.date)) {
    const v = lotValues(l);
    wl.addRow([g, l.lotNumber, l.date.toISOString().slice(0, 10), l.auctionLabel, grade || l.materialName, +l.recv, Math.round(+l.unitIncl), Math.round(+v.recvIncl), +l.used, Math.round(+l.usedIncl), +l.rem, Math.round(+v.remIncl)]);
  }
  [14, 18, 12, 22, 48, 12, 14, 16, 14, 18, 12, 16].forEach((w, i) => (wl.getColumn(i + 1).width = w));
  wl.views = [{ state: "frozen", ySplit: 1 }]; wl.autoFilter = "A1:L1";

  const wh = wb.addWorksheet("Справка");
  wh.columns = [{ width: 18 }, { width: 110 }];
  wh.addRow(["Термин", "Что значит"]).font = { bold: true };
  wh.addRow(["Каракуль", "Шкурки ягнят каракульской породы овец (карақұл). Общее название меха: плотный курчавый «завиток». В отчёте это лоты, где в сорте сказано просто «каракуль», без слов swakara и broadtail."]);
  wh.addRow(["Свакара (Swakara)", "Торговая марка намибийского каракуля: каракуль, выращенный и выделанный в Намибии (Swakara — Karakul Pelts of Namibia). По типу мех тот же каракуль, с упором на происхождение и качество; шкурки крупнее, с чёткими завитками, часто цветные (крашеные)."]);
  wh.addRow(["Бродтейл (Broadtail, каракульча)", "Мех самых молодых каракулят: ягнят забивают очень рано (в первые дни жизни или недоношенными). Шкурка тонкая, лёгкая, шёлковистая, с гладким муаровым (волнистым) рисунком без завитков; дороже и нежнее каракуля. В справочнике системы пока сведён в один вид «Свакара»."]);
  wh.addRow(["Куплено / Остаток", "Куплено — получено по лотам закупки; остаток — то, что ещё лежит на складе. Использовано — списано в ТЗ. Прочее списание — получено минус использовано и остаток (списания вне ТЗ)."]);
  wh.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  if (process.env.DUMP_JSON) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.DUMP_JSON, JSON.stringify(rows.map(({ g, l, grade }) => { const v = lotValues(l); return { g, lot: l.lotNumber, date: l.date.toISOString().slice(0, 10), year: String(l.date.getUTCFullYear()), auction: l.auctionLabel, grade: grade || l.materialName, recv: +l.recv, unit: Math.round(+l.unitIncl), recvIn: Math.round(+v.recvIncl), used: +l.used, usedIn: Math.round(+l.usedIncl), rem: +l.rem, remIn: Math.round(+v.remIncl), other: +(+l.otherOut).toFixed(3), basis: BROADTAIL_LOTS[l.lotNumber] ?? "по тексту сорта лота", src: srcOf.get(l.id) === "auction" ? "Куплено на аукционе" : "Куплено у поставщика", recvEx: Math.round(+v.recvExcl), usedEx: Math.round(+l.usedExcl), remEx: Math.round(+v.remExcl) }; })));
  }
  await wb.xlsx.writeFile(out);
  for (const g of GROUPS) { const a = agg.get(g)!; console.log(g, "лотов", a.lots, "куплено", a.recv, Math.round(a.recvIn), "ср", a.recv ? Math.round(a.recvIn / a.recv) : 0, "исп", a.used, "ост", a.rem); }
  console.log("Всего лотов:", rows.length);
  await prisma.$disconnect();
}
main();
