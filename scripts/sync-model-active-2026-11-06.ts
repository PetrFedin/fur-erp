/**
 * «Изделия»: Вкл/Выкл модели по наличию (владелец, 06.11.2026): нет в наличии — выкл (строка приглушена), есть — вкл.
 * Наличие = розничный остаток по отчёту «заказ и продажи» (сумма остатка по размерам модели), как в «Продажи → Отчёт» и каталоге.
 * Меняет только поле «Активен» (ProductModel.isActive). Журнал для отката: docs-inventory/corrections-journal-model-active-2026-11-06.json.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/sync-model-active-2026-11-06.ts [--apply | --rollback]
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const APPLY = process.argv.includes("--apply"), ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(resolve(__dirname, ".."), "docs-inventory", "corrections-journal-model-active-2026-11-06.json");
(async () => {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { loadSalesInput } = await import("../src/lib/sales-server");
  const { normCode } = await import("../src/lib/sales-receipts-core");
  const prisma = createAuditedClient("script:model-active");
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as { id: string; before: boolean }[];
    await prisma.$transaction(async (tx) => { for (const r of j) await tx.productModel.update({ where: { id: r.id }, data: { isActive: r.before } }); });
    console.log(`Откат выполнен: ${j.length} моделей возвращены.`); process.exit(0);
  }
  const data = await loadSalesInput(org.id, "on");
  const stock = new Map<string, number>();
  for (const r of data.sizes) if (r.modelCode) { const k = normCode(r.modelCode); stock.set(k, (stock.get(k) ?? 0) + (r.stock ?? 0)); }
  const models = await prisma.productModel.findMany({ where: { organizationId: org.id }, select: { id: true, name: true, isActive: true } });
  const plan = models.map((m) => ({ id: m.id, name: m.name, before: m.isActive, after: (stock.get(normCode(m.name)) ?? 0) > 0 })).filter((x) => x.before !== x.after);
  const on = models.filter((m) => (stock.get(normCode(m.name)) ?? 0) > 0).length;
  console.log(`Моделей ${models.length}: в наличии ${on}, без остатка ${models.length - on}. Изменится: ${plan.length} (выкл ${plan.filter((x) => !x.after).length}, вкл ${plan.filter((x) => x.after).length}).`);
  if (!APPLY) { console.log("Пробный прогон. Примеры:", plan.slice(0, 6).map((x) => `${x.name}→${x.after ? "вкл" : "выкл"}`).join(", ")); process.exit(0); }
  if (existsSync(JOURNAL)) { console.log("Журнал уже есть — сначала --rollback."); process.exit(1); }
  await prisma.$transaction(async (tx) => { for (const x of plan) await tx.productModel.update({ where: { id: x.id }, data: { isActive: x.after } }); });
  writeFileSync(JOURNAL, JSON.stringify(plan, null, 1)); console.log("Применено. Журнал:", JOURNAL); process.exit(0);
})();
