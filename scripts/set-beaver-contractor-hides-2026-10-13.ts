/**
 * Бобр (сырьё подрядчика, закупки нет): шкуры подрядчика по ТЗ 97 и 104, штук — только справка, суммы не меняются.
 * По расчёту «МГУ» 12.02.2026: 1 шкура на изделие (ТЗ 97 — 9 изд., ТЗ 104 — 1 изд.); реальной цены шкуры в документах нет.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/set-beaver-contractor-hides-2026-10-13.ts [--apply]
 * Откат: те же команды с --clear (ставит пусто).
 */
import "./stubs/server-only-shim";

const APPLY = process.argv.includes("--apply");
const CLEAR = process.argv.includes("--clear");
const WANT: Record<string, number> = { "97": 9, "104": 1 };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:set-beaver-contractor-hides");
  for (const [no, n] of Object.entries(WANT)) {
    const rows = await prisma.productionOrder.findMany({ where: { workOrderNumber: no }, select: { id: true, number: true, plannedQuantity: true, contractorHides: true } });
    for (const r of rows) {
      const next = CLEAR ? null : n;
      console.log(`ТЗ ${no} (${r.number}): изделий ${r.plannedQuantity}, было ${r.contractorHides ?? "—"}, станет ${next ?? "—"}`);
      if (APPLY) await prisma.productionOrder.update({ where: { id: r.id }, data: { contractorHides: next } });
    }
  }
  console.log(APPLY ? "записано" : "пробный прогон: ничего не записано (добавьте --apply)");
}
main().then(() => process.exit(0));
