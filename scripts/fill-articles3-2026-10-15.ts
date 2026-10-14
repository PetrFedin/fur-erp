/**
 * Решения владельца по спорным полям артикулов (15.10.2026, «по твоей рекомендации»):
 *  - названия: M002A «Пальто женское из соболя» (4 ТЗ из 5), М026 «Пальто женское из норки» (шарф — отдельный артикул MSC01), M007 «Шуба средней длины из рыси»;
 *  - расценка работы и расход шкур, где значения в ТЗ расходятся: берётся значение из ПОСЛЕДНЕГО (по номеру) ТЗ артикула.
 * Ставит только в пустые поля. Длину М057 не ставит (в АРТИКУЛА.xlsx два варианта — Regular и Short, поле одно).
 * Пробный прогон по умолчанию; --apply (backup.sh + журнал); --rollback [--apply].
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fill-articles3-2026-10-15.ts [--apply|--rollback]
 */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { normalizeModelCode } from "../src/lib/model-code";

const APPLY = process.argv.includes("--apply"), ROLLBACK = process.argv.includes("--rollback");
const ROOT = join(__dirname, "..");
const JOURNAL = join(ROOT, "docs-inventory", "corrections-journal-articles3-2026-10-15.json");
type P = { work: [number, string][]; hides: [number, string][] };
const PROFILE: Record<string, P> = JSON.parse(readFileSync(join(__dirname, "data", "article-profile-src.json"), "utf8"));
const NAMES: Record<string, string> = { M002A: "Пальто женское из соболя", M026: "Пальто женское из норки", M007: "Шуба средней длины из рыси" };
const latest = (xs: [number, string][]) => {
  const rows = xs.map(([v, tz]) => ({ v, tz: Number(tz) })).filter((r) => Number.isFinite(r.tz));
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.tz));
  const vals = rows.filter((r) => r.tz === max).map((r) => r.v);
  const cnt = new Map<number, number>();
  for (const v of vals) cnt.set(v, (cnt.get(v) ?? 0) + 1);
  const best = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  return { value: best, tz: max, distinct: new Set(rows.map((r) => r.v)).size };
};

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:fill-articles3");
  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as { id: string; before: Record<string, unknown> }[];
    console.log(`откат: ${j.length} артикулов`);
    if (APPLY) for (const e of j) await prisma.productModel.update({ where: { id: e.id }, data: e.before as never });
    return;
  }
  const models = await prisma.productModel.findMany({ where: { category: { not: "Ремонт" } }, select: { id: true, name: true, salesName: true, supplierWorkPrice: true, supplierFurPerUnit: true } });
  const byCode = new Map(models.map((m) => [normalizeModelCode(m.name), m]));
  const plan: { id: string; code: string; before: Record<string, unknown>; after: Record<string, unknown>; why: string }[] = [];
  for (const [code, name] of Object.entries(NAMES)) {
    const m = byCode.get(normalizeModelCode(code));
    if (m && !m.salesName) plan.push({ id: m.id, code: m.name, before: { salesName: null }, after: { salesName: name }, why: "название по решению владельца" });
  }
  for (const [code, p] of Object.entries(PROFILE)) {
    const m = byCode.get(normalizeModelCode(code));
    if (!m) continue;
    const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
    const w = latest(p.work);
    if (m.supplierWorkPrice == null && w && w.distinct > 1) { before.supplierWorkPrice = null; after.supplierWorkPrice = w.value; }
    const h = latest(p.hides);
    if (m.supplierFurPerUnit == null && h && h.distinct > 1) { before.supplierFurPerUnit = null; after.supplierFurPerUnit = h.value; }
    if (Object.keys(after).length) plan.push({ id: m.id, code: m.name, before, after, why: `последнее ТЗ № ${w?.tz ?? h?.tz} из спорных значений` });
  }
  for (const e of plan) console.log(`${e.code}: ${JSON.stringify(e.after)} — ${e.why}`);
  console.log(`итого артикулов: ${plan.length}`);
  if (!APPLY) return console.log("пробный прогон (добавьте --apply)");
  execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: ROOT });
  writeFileSync(JOURNAL, JSON.stringify(plan.map((e) => ({ id: e.id, before: e.before })), null, 1));
  for (const e of plan) await prisma.productModel.update({ where: { id: e.id }, data: e.after as never });
  console.log("готово");
}
main().then(() => process.exit(0));
