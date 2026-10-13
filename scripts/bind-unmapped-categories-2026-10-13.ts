/**
 * «Не сопоставлено (7 моделей)» в справочнике категорий: привязка тех моделей, чья категория определяется по документам.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/bind-unmapped-categories-2026-10-13.ts [--apply] [--rollback]
 * Основания (только документы):
 *   М023 → Полупальто — ТЗ 171: «Полупальто из дикого соболя»;  М044 → Жилет — ТЗ 177: «Жилет меховой»;
 *   М055 → Куртка — ТЗ 181: «Куртка женская из норки»;  М039 → Пальто — каталог MVST FW26/27: «пальто из стриженой норки с поясом и отделкой из соболя».
 * Не привязываются (нет достоверного основания): М030, М040, М054 — в отчёте.
 * Пробный прогон по умолчанию; --apply: scripts/backup.sh, журнал docs-inventory/corrections-journal-bind-categories-2026-10-13.json.
 */
import "./stubs/server-only-shim";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = path.join(__dirname, "../docs-inventory/corrections-journal-bind-categories-2026-10-13.json");
const WANT: Array<[string, string, string]> = [
  ["М023", "Полупальто", "ТЗ 171: «Полупальто из дикого соболя»"],
  ["М044", "Жилет", "ТЗ 177: «Жилет меховой»"],
  ["М055", "Куртка", "ТЗ 181: «Куртка женская из норки»"],
  ["М039", "Пальто", "каталог MVST FW26/27: «пальто из стриженой норки с поясом и отделкой из соболя»"],
  // Артикулы, добавленные из файла АРТИКУЛА.xlsx (load-articles-sales-2026-10-13.ts), без ТЗ: категория по каталогу MVST FW26/27 (класс «… меховое/меховая», как у уже привязанных моделей).
  ["M007", "Полупальто", "каталог MVST FW26/27: «Полупальто меховое»"],
  ["M034", "Куртка", "каталог MVST FW26/27: «Куртка меховая»"],
  ["M035", "Пальто", "каталог MVST FW26/27: «Пальто меховое»"],
  ["MH-18", "Головной убор", "каталог MVST FW26/27: «Шапка меховая»"],
  ["MBG-01", "Сумка", "каталог MVST FW26/27: «Сумка»"],
  ["MGL-04", "Перчатки", "каталог MVST FW26/27: «Перчатки кожаные / замшевые»"],
  ["MGL-05", "Перчатки", "каталог MVST FW26/27: «Перчатки кожаные» (митенки)"],
];
/** Категории, которых нет в справочнике: создаются как «предложено, ждёт подтверждения» (ТЗ с ними нет). */
const NEW_CATS: Array<[string, string]> = [["Сумка", "Аксессуары"], ["Перчатки", "Аксессуары"]];
type J = { id: string; name: string; before: { category: string | null; categoryRefId: string | null }; after: { category: string; categoryRefId: string }; basis: string; rolledBack?: boolean };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:bind-unmapped-categories");
  const j: J[] = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : [];
  if (ROLLBACK) {
    for (const e of [...j].reverse()) {
      if (e.rolledBack) continue;
      console.log("вернуть", e.name);
      if (APPLY) {
        if ((e as { created?: boolean }).created) await prisma.categoryRef.deleteMany({ where: { id: e.id, models: { none: {} } } });
        else await prisma.productModel.update({ where: { id: e.id }, data: e.before });
        e.rolledBack = true;
      }
    }
    if (APPLY) writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
    return;
  }
  const todo: J[] = [];
  const cats = new Map<string, string>();
  const toCreate: Array<[string, string]> = [];
  for (const [n, g] of NEW_CATS) if (!(await prisma.categoryRef.findFirst({ where: { name: n } }))) { console.log(`создать категорию «${n}» (${g}, ждёт подтверждения)`); toCreate.push([n, g]); }
  for (const [name, cat, basis] of WANT) {
    const m = await prisma.productModel.findFirst({ where: { name } });
    let ref = await prisma.categoryRef.findFirst({ where: { name: cat } });
    if (!ref && toCreate.some(([n]) => n === cat)) ref = { id: "(будет создана)", name: cat } as never;
    if (!m || !ref) { console.log("нет", name, cat); continue; }
    if (m.categoryRefId) { console.log("уже привязана", name); continue; }
    console.log(`${name} → ${cat}  (${basis})`);
    todo.push({ id: m.id, name, before: { category: m.category, categoryRefId: m.categoryRefId }, after: { category: ref.name, categoryRefId: ref.id }, basis });
  }
  if (!APPLY) return console.log("пробный прогон (добавьте --apply)");
  execFileSync(path.join(__dirname, "backup.sh"), { stdio: "inherit" });
  const org = await prisma.organization.findFirstOrThrow();
  for (const [n, g] of toCreate) {
    const max = (await prisma.categoryRef.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    const c = await prisma.categoryRef.create({ data: { organizationId: org.id, name: n, group: g, confirmed: false, sortOrder: max + 10, note: "Предложено, ждёт подтверждения. Основание: каталог MVST FW26/27; ТЗ с такой категорией пока нет." } });
    for (const e of todo) if (e.after.categoryRefId === "(будет создана)") { /* заполним ниже */ }
    cats.set(n, c.id);
    j.push({ id: c.id, name: `категория «${n}»`, before: { category: null, categoryRefId: null }, after: { category: n, categoryRefId: c.id }, basis: "создана", created: true } as never);
  }
  for (const e of todo) {
    if (e.after.categoryRefId === "(будет создана)") e.after.categoryRefId = cats.get(e.after.category)!; await prisma.productModel.update({ where: { id: e.id }, data: e.after }); j.push(e); writeFileSync(JOURNAL, JSON.stringify(j, null, 1)); }
  console.log("привязано", todo.length);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
