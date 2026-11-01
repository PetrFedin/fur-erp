// Расход меха по ТЗ: каждое списание шкур (соболь, норка, каракульча, лиса, рысь) — лот (вид меха, пол норки, аукцион, год), ТЗ, артикул, партия, шкур, ₽. Только чтение.
// Пол норки — признак лота «Самец» / «Самка» (scripts/apply-mink-sex-attrs-2026-11-02.ts).
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/export-fur-usage-json.ts <out.json>
import "./stubs/server-only-shim";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { loadFurLots } from "../src/lib/fur-table-server";
import { orderLabel } from "../src/lib/order-label";

const NAME: Record<string, string> = { Свакара: "Каракульча" };
const MAIN = ["Соболь", "Норка", "Каракульча", "Лиса", "Рысь"];
const STATUS_RU: Record<string, string> = { PLANNED: "план", IN_PROGRESS: "в работе", COMPLETED: "завершено", CANCELLED: "отменено" };

(async () => {
  const prisma = new PrismaClient();
  const org = (await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } }))!.id;
  const lots = new Map((await loadFurLots(prisma, org, { kind: "fur", year: "all" })).filter((l) => MAIN.includes(NAME[l.item] ?? l.item)).map((l) => [l.id, l]));
  const usages = await prisma.productionMaterialUsage.findMany({
    where: { lotId: { in: [...lots.keys()] }, productionOrder: { organizationId: org, status: { not: "CANCELLED" } } },
    select: {
      quantity: true, totalCost: true, date: true,
      lot: { select: { id: true, attrs: { select: { attr: { select: { name: true, group: true } } } } } },
      productionOrder: { select: { number: true, workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true, endDate: true,
        productModel: { select: { name: true, sku: true, category: true } }, batch: { select: { number: true, name: true } } } },
    },
  });
  const rows = usages.map((u) => {
    const l = lots.get(u.lot.id)!, o = u.productionOrder;
    const fur = NAME[l.item] ?? l.item;
    const sexAttr = fur !== "Норка" ? "—" : u.lot.attrs.find((a) => a.attr.group === "Пол")?.attr.name ?? "Пол не указан";
    return {
      fur, sex: sexAttr, lot: l.lotNumber, year: String(l.year), auction: l.auctionLabel, grade: l.grade || l.materialName,
      attrs: u.lot.attrs.map((a) => a.attr.name).join(", ") || "—",
      tz: orderLabel(o), status: STATUS_RU[o.status] ?? o.status, article: o.productModel.sku || o.productModel.name, item: o.productModel.name, category: o.productModel.category ?? "—",
      batch: o.batch ? `Партия ${o.batch.number}${o.batch.name ? ` · ${o.batch.name}` : ""}` : "Без партии",
      pcs: Number(o.plannedQuantity), qty: Number(u.quantity), sum: Math.round(Number(u.totalCost) * 100) / 100,
      date: u.date.toISOString().slice(0, 10),
    };
  });
  rows.sort((a, b) => MAIN.indexOf(a.fur) - MAIN.indexOf(b.fur) || a.sex.localeCompare(b.sex) || a.article.localeCompare(b.article, "ru", { numeric: true }) || a.tz.localeCompare(b.tz, "ru", { numeric: true }));
  writeFileSync(process.argv[2], JSON.stringify(rows));
  const by = (k: string) => rows.filter((r) => r.sex === k).reduce((s, r) => s + r.qty, 0);
  const byFur = Object.fromEntries(MAIN.map((f) => [f, rows.filter((r) => r.fur === f).reduce((s, r) => s + r.qty, 0)]));
  console.log(`списаний ${rows.length}, шкур по видам меха:`, byFur, `; норка: самцы ${by("Самец")}, самки ${by("Самка")}, без пола ${by("Пол не указан")}`);
  await prisma.$disconnect();
})();
