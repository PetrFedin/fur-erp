/**
 * СП 09-26: «Транспорт на выделку и обратно» в лотах заказчика (27,883987 и 21,743434 ₽/шкуру) приводится к 20 ₽ по расчёту Веллмеха и спецификации №20
 * (в УПД установится 63 887 050 + 571 100 = 64 458 150 ₽). Правка идёт тем же путём, что кнопка «Править» в карточке лота (buildLotPlan + applyLotWrites).
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fix-sp0926-transport.ts          — только показать план
 *   APPLY=1 node … scripts/fix-sp0926-transport.ts                                                                  — записать
 */
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";

const TARGET = 20;
const APPLY = process.env.APPLY === "1";

// Цена в счёте поставщика (USD) остаётся как в документе: из записи позиции убираем цену/сумму/количество/ставку,
// в плане стоимости позиции оставляем только расчётный лист лота (транспорт 20 ₽).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fixItem(w: any) {
  if (!w.item) return;
  const d = w.item.data;
  delete d.unitPrice; delete d.subtotal; delete d.quantity; delete d.vatRate;
  const lotBd = w.lot?.costBreakdown;
  if (d.costPlan && lotBd && typeof d.costPlan === "object") d.costPlan = { ...d.costPlan, costBreakdown: lotBd };
}

(async () => {
  const prisma = new PrismaClient();
  const { buildLotPlan, applyLotWrites } = await import("../src/lib/lot-reprice");
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const lots = await prisma.rawMaterialLot.findMany({
    where: { organizationId: org, purchase: { auctionSession: { startsWith: "СП 09.26" }, number: { not: "З-2026-0057" } } },
    select: { id: true, lotNumber: true, unitCost: true, quantityReceived: true, costBreakdown: true, purchase: { select: { number: true } }, _count: { select: { usages: true } } },
    orderBy: [{ purchase: { number: "asc" } }, { lotNumber: "asc" }],
  });
  let totalBefore = 0, totalAfter = 0, done = 0, skipped = 0;
  for (const l of lots) {
    const items = ((l.costBreakdown as { items?: { label?: string; value?: number }[] } | null)?.items ?? []);
    const idx = items.findIndex((x) => typeof x.label === "string" && x.label.startsWith("Транспорт на выделку"));
    const cur = idx >= 0 ? Number(items[idx].value) : NaN;
    if (idx < 0 || !(Math.abs(cur - TARGET) > 0.0001)) { skipped++; continue; }
    if (l._count.usages > 0) { console.log(`ПРОПУСК ${l.purchase?.number} лот ${l.lotNumber}: есть списания в ТЗ (${l._count.usages})`); skipped++; continue; }
    const r = await buildLotPlan(prisma, org, l.id, { sheet: [{ idx, value: TARGET }] });
    if ("error" in r) { console.log(`ОШИБКА ${l.purchase?.number} ${l.lotNumber}: ${r.error}`); continue; }
    const before = Number(l.unitCost) * Number(l.quantityReceived);
    const unitAfter = r.plan.lines.find((x) => /цена|за шкуру|за ед/i.test(x.label));
    console.log(`${l.purchase?.number} лот ${l.lotNumber}: транспорт ${cur} → ${TARGET}; ${r.plan.lines.map((x) => `${x.label}: ${x.before} → ${x.after}`).join(" | ").slice(0, 200)}`);
    void unitAfter;
    totalBefore += before;
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "RawMaterialLot" WHERE "id" = ${l.id} AND "organizationId" = ${org} FOR UPDATE`;
        const again = await buildLotPlan(tx, org, l.id, { sheet: [{ idx, value: TARGET }] });
        if ("error" in again) throw new Error(again.error);
        fixItem(again.writes);
        await applyLotWrites(tx, org, again.writes);
      }, { maxWait: 10_000, timeout: 60_000 });
      const after = await prisma.rawMaterialLot.findUniqueOrThrow({ where: { id: l.id }, select: { unitCost: true, quantityReceived: true } });
      totalAfter += Number(after.unitCost) * Number(after.quantityReceived);
    }
    done++;
  }
  console.log(`\n${APPLY ? "ЗАПИСАНО" : "ПЛАН (ничего не записано)"}: лотов ${done}, пропущено ${skipped}. Σ лотов до: ${totalBefore.toFixed(2)}${APPLY ? `, после: ${totalAfter.toFixed(2)}, разница ${(totalAfter - totalBefore).toFixed(2)}` : ""}`);
  await prisma.$disconnect();
})();
