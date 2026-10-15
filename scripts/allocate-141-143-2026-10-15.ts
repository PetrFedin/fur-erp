/**
 * Остатки авансов №141 (980 000,00) и №143 (1 755 600,00) — ТОЛЬКО ПРОВЕРКА (чтение, БД не меняется), 15.10.2026.
 * Однозначных привязок документы не дают, поэтому записи нет: скрипт показывает остаток и арифметику
 * (70% от работы набора изделий) и падает, если картина в базе изменилась.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/allocate-141-143-2026-10-15.ts
 * Источники: «расчет взятых в работу изделий 01072026.xlsx» (82 изд., 16 944 100), «расчет стоимости пошива ММ.xlsx» (245 акс., 4 615 400).
 */
import "./stubs/server-only-shim";

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:check-141-143");
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const fmt = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2 });
  let bad = 0;
  for (const [inv, total, workFull, pieces] of [["141", 11860870, 16944100, 82], ["143", 3230780, 4615400, 245]] as const) {
    const p = await prisma.productionPayment.findFirstOrThrow({ where: { invoiceNo: inv, paidAt: { gte: new Date("2026-07-01") } }, include: { allocations: { include: { productionOrder: true } } } });
    const alloc = r2(p.allocations.reduce((s, a) => s + Number(a.amount), 0));
    const rest = r2(Number(p.amount) - alloc);
    const qty = p.allocations.reduce((s, a) => s + Number(a.productionOrder.plannedQuantity), 0);
    console.log(`Счёт №${inv}: платёж ${fmt(Number(p.amount))}; 70% × ${fmt(workFull)} = ${fmt(r2(workFull * 0.7))}; разнесено ${fmt(alloc)} (${p.allocations.length} позиций ТЗ, ${qty} шт); остаток ${fmt(rest)} = 70% × ${fmt(r2(rest / 0.7))}`);
    if (Math.abs(Number(p.amount) - workFull * 0.7) > 0.01) { console.log("  ! сумма платежа не равна 70% работы"); bad++; }
  }
  console.log("\nЗаписи нет: ТЗ на остаток (М023 ×5; 127 аксессуаров) в базе отсутствуют. См. docs-inventory/allocate-141-143-2026-10-15.md");
  await prisma.$disconnect();
  if (bad) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
