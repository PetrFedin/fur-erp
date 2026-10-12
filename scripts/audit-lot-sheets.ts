// Сверка расчётных листов лотов с составом цены: каждая строка листа либо вошла в сектор, либо относится к справочным (INFO).
// Только чтение. Выводит лоты, где остались непринятые строки (unused), и суммы.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/audit-lot-sheets.ts
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { lotComposition } from "../src/lib/price-composition";

const prisma = new PrismaClient();
(async () => {
  const lots = await prisma.rawMaterialLot.findMany({
    select: { id: true, lotNumber: true, vatRate: true, quantityReceived: true, totalCost: true, costBreakdown: true, purchase: { select: { number: true } }, purchaseItems: { select: { costPlan: true } }, rawMaterial: { select: { name: true } } },
  });
  const unrecognized: string[] = [];
  let withSheet = 0, recognized = 0, bad = 0;
  const byFormat: Record<string, number> = {};
  let totUnused = 0;
  for (const l of lots) {
    const items = (l.costBreakdown as { items?: unknown[] } | null)?.items;
    const planHas = l.purchaseItems.some((i) => (i.costPlan as { costBreakdown?: { items?: unknown[] } } | null)?.costBreakdown?.items?.length);
    if (!items?.length && !planHas) continue;
    withSheet++;
    const comp = lotComposition({ breakdown: l.costBreakdown, plans: l.purchaseItems.map((i) => i.costPlan), vatRate: Number(l.vatRate), qty: Number(l.quantityReceived), totalIncl: Number(l.totalCost), purchaseNumber: l.purchase?.number, lotNumber: l.lotNumber });
    if (!comp) { unrecognized.push(`${l.purchase?.number} лот ${l.lotNumber ?? "—"} ${l.rawMaterial.name}`); continue; }
    recognized++;
    byFormat[comp.format] = (byFormat[comp.format] ?? 0) + 1;
    const sum = Object.values(comp.incl).reduce((a, x) => a + x, 0);
    if (Math.abs(sum - comp.total) > 0.01) bad++;
    if (comp.unused.length) { totUnused++; console.log(`UNUSED ${l.purchase?.number} лот ${l.lotNumber ?? "—"} [${comp.format}]: ${comp.unused.join("; ")}`); }
    if (comp.incl.other > 1 && Math.abs(comp.incl.other) > comp.total * 0.02) console.log(`OTHER>2% ${l.purchase?.number} лот ${l.lotNumber ?? "—"} [${comp.format}]: прочее ${comp.incl.other.toFixed(2)} из ${comp.total.toFixed(2)}`);
  }
  console.log({ lots: lots.length, withSheet, recognized, unrecognized: unrecognized.length, byFormat, lotsWithUnused: totUnused, sumMismatch: bad });
  if (unrecognized.length) console.log("не распознаны:\n " + unrecognized.join("\n "));
  await prisma.$disconnect();
})();
