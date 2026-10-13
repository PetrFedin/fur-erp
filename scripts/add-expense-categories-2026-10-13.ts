/**
 * Статьи расходов: все названия расходов из данных (строки расчётов лотов RawMaterialLot.costBreakdown, расчёты закупок
 * PurchaseItem.costPlan, PurchaseExpense/ProductionExpense) должны быть в справочнике ExpenseCategory.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/add-expense-categories-2026-10-13.ts [--apply] [--rollback]
 * Недостающие статьи (вид «Закупка») добавляются; остальные строки расчётов сопоставляются с уже существующими статьями
 * (таблица MAP) либо признаются не расходами (НДС, курс, итого, цена — расчётные величины) и в справочник не идут.
 * Пробный прогон по умолчанию; --apply: scripts/backup.sh, журнал docs-inventory/corrections-journal-expense-categories-2026-10-13.json.
 */
import "./stubs/server-only-shim";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = path.join(__dirname, "../docs-inventory/corrections-journal-expense-categories-2026-10-13.json");
const NEW_PURCHASE = ["Маркетинговый сбор", "Сбор за доставку", "Брокерская комиссия"];
/** Строка расчёта (по началу/шаблону) → статья справочника. */
const MAP: Array<[RegExp, string]> = [
  [/^(аукционный сбор|услуги аукциона)/i, "Аукционный сбор"],
  [/^маркетинговый сбор$/i, "Маркетинговый сбор"],
  [/^сбор за доставку$/i, "Сбор за доставку"],
  [/^брок(ерск|\.)/i, "Брокерская комиссия"],
  [/^комиссия( рм|$)/i, "Комиссия посредника"],
  [/^выделка|^крашение в рф/i, "Выделка"],
  [/^покраска/i, "Покраска / тонировка"],
  [/^(транспорт|перевозка|доставка)|^транспорт fi-/i, "Доставка"],
  [/^(пошлина|там\.сбор|расчетный аванс на таможню|аванс на таможню|итого таможенные)/i, "Растаможка"],
  [/^упаковка/i, "Упаковка"],
  [/^аукционный сбор, маркетинговый сбор/i, "Аукционный сбор"],
];
type J = { id: string; name: string; kind: string; rolledBack?: boolean };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:add-expense-categories");
  const org = await prisma.organization.findFirstOrThrow();
  const j: J[] = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : [];
  if (ROLLBACK) {
    for (const e of j) {
      if (e.rolledBack) continue;
      const used = (await prisma.purchaseExpense.count({ where: { categoryId: e.id } })) + (await prisma.productionExpense.count({ where: { categoryId: e.id } }));
      console.log(`удалить «${e.name}»${used ? " — используется, пропуск" : ""}`);
      if (APPLY && !used) { await prisma.expenseCategory.delete({ where: { id: e.id } }); e.rolledBack = true; }
    }
    if (APPLY) writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
    return;
  }
  const cats = await prisma.expenseCategory.findMany({ where: { organizationId: org.id } });
  const have = new Set(cats.map((c) => `${c.kind}:${c.name}`));

  // Названия в данных
  const labels = new Map<string, number>();
  const add = (l: unknown) => { if (typeof l === "string" && l.trim()) labels.set(l.trim(), (labels.get(l.trim()) ?? 0) + 1); };
  const itemsOf = (x: unknown): unknown[] => {
    const o = x as { items?: unknown[]; costBreakdown?: { items?: unknown[] }; breakdown?: unknown[] } | unknown[] | null;
    if (!o) return [];
    if (Array.isArray(o)) return o;
    return o.items ?? o.costBreakdown?.items ?? o.breakdown ?? [];
  };
  for (const l of await prisma.rawMaterialLot.findMany({ where: { costBreakdown: { not: null as never } }, select: { costBreakdown: true } })) for (const i of itemsOf(l.costBreakdown)) add((i as { label?: string }).label);
  for (const p of await prisma.purchaseItem.findMany({ where: { costPlan: { not: null as never } }, select: { costPlan: true } })) for (const i of itemsOf(p.costPlan)) add((i as { label?: string }).label);

  const mapped = new Map<string, string[]>(), unmapped: string[] = [];
  for (const [lab] of labels) {
    const hit = MAP.find(([re]) => re.test(lab));
    if (hit) mapped.set(hit[1], [...(mapped.get(hit[1]) ?? []), lab]);
    else unmapped.push(lab);
  }
  for (const [c, ls] of mapped) console.log(`${have.has(`PURCHASE:${c}`) ? "есть  " : "НОВАЯ "} «${c}» ← ${ls.length} строк расчётов: ${ls.slice(0, 4).join(" | ")}${ls.length > 4 ? " …" : ""}`);
  console.log("\nНе расходы (НДС, курсы, цены, итоги, корректировки), в справочник не идут:\n  " + unmapped.join("\n  "));
  const noCat = (await prisma.purchaseExpense.count()) + (await prisma.productionExpense.count());
  console.log(`\nPurchaseExpense/ProductionExpense: ${noCat} строк, статья обязательна (categoryId) — без статьи строк нет.`);

  const todo = NEW_PURCHASE.filter((n) => !have.has(`PURCHASE:${n}`));
  console.log("\nбудет добавлено:", todo.join(", ") || "ничего");
  if (!APPLY) return console.log("пробный прогон (добавьте --apply)");
  if (!todo.length) return;
  execFileSync(path.join(__dirname, "backup.sh"), { stdio: "inherit" });
  for (const name of todo) {
    const c = await prisma.expenseCategory.create({ data: { organizationId: org.id, name, kind: "PURCHASE" } });
    j.push({ id: c.id, name, kind: "PURCHASE" });
    writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
  }
  console.log("добавлено", todo.length);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
