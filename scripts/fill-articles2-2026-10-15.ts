/**
 * Заполнение пустых полей артикулов по Word-ТЗ (приложения к договору подряда), «Расчёт стоимости пошива ММ FW26» и АРТИКУЛА.xlsx.
 * Данные: scripts/data/article-profile-src.json (собирает scripts/data/build-article-profile.py).
 * Ставит ТОЛЬКО в пустые поля и только однозначное:
 *  - salesName: все ТЗ дают одно название (или более короткие — начало самого полного); спорные — в SKIP, не трогаются;
 *  - description: добавляет в конец строки «Мех: / Подкладка: / Размеры: / Цвета:» (формат формы Веллмеха), если такой строки ещё нет; старый текст не меняется;
 *  - supplierWorkPrice / supplierFurPerUnit: только если во ВСЕХ источниках (ТЗ + расчёт FW26) одно и то же значение.
 * Расценка/расход берутся только если есть значение из реальных ТЗ (одно только плановое из расчёта FW26 не ставится).
 * Пробный прогон по умолчанию; --apply (backup.sh + журнал); --rollback [--apply].
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/fill-articles2-2026-10-15.ts [--apply|--rollback]
 */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { normalizeModelCode } from "../src/lib/model-code";
import { parseSupplierDescription, composeSupplierDescription } from "../src/lib/supplier-article";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const ROOT = join(__dirname, "..");
const JOURNAL = join(ROOT, "docs-inventory", "corrections-journal-articles2-2026-10-15.json");

type P = { names: [string, number][]; colors: [string, number][]; sizes: string[]; linings: [string, number][]; furs: string[]; tz: number[]; work: [number, string][]; hides: [number, string][]; sheet_work?: number[]; sheet_hides?: number[]; file_len?: string[]; file_furs?: string[] };
const PROFILE: Record<string, P> = JSON.parse(readFileSync(join(__dirname, "data", "article-profile-src.json"), "utf8"));

// Названия, которые ставить нельзя, хотя ТЗ однозначны/есть источники (причина в отчёте).
const SKIP_NAME: Record<string, string> = {
  M026: "в ТЗ 150/174 «Пальто женское из норки с шарфом», но письмо Меркури Мода 27.05.2026: шарф — отдельный артикул",
  M002A: "в ТЗ два названия (4× пальто из соболя, 1× полупальто из норки с соболем)",
};
const cut = (items: string[], sep: string, max = 200) => { const out: string[] = []; for (const it of items) { if ([...out, it].join(sep).length > max) break; out.push(it); } return out.join(sep); };
const distinct = (xs: number[]) => Array.from(new Set(xs));
const tzList = (p: P) => (p.tz.length ? `ТЗ ${p.tz.join(", ")}` : "");

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:fill-articles2");
  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as { id: string; name: string; before: Record<string, unknown>; after: Record<string, unknown> }[];
    console.log(`откат: ${j.length} артикулов`);
    if (!APPLY) return console.log("пробный откат (добавьте --apply)");
    for (const r of j) {
      const cur = await prisma.productModel.findUnique({ where: { id: r.id }, select: { description: true, salesName: true } });
      if (cur && (cur.description !== (r.after.description ?? cur.description) || cur.salesName !== (r.after.salesName ?? cur.salesName))) { console.log(`${r.name}: изменён после заполнения — пропуск`); continue; }
      await prisma.productModel.update({ where: { id: r.id }, data: r.before as never });
    }
    return console.log("откат выполнен");
  }
  const models = await prisma.productModel.findMany({ select: { id: true, name: true, salesName: true, description: true, supplierWorkPrice: true, supplierFurPerUnit: true } });
  const plan: { m: (typeof models)[number]; data: Record<string, unknown>; log: string[] }[] = [];
  const skipped: string[] = [];
  for (const m of models) {
    const code = normalizeModelCode(m.name).toUpperCase().replace(/-/g, "");
    const p = PROFILE[code];
    if (!p) { skipped.push(`${m.name}: данных нет`); continue; }
    const data: Record<string, unknown> = {};
    const log: string[] = [];
    // название
    if (!m.salesName?.trim()) {
      const names = p.names.map((n) => n[0]);
      const longest = [...names].sort((a, b) => b.length - a.length)[0];
      if (SKIP_NAME[code]) skipped.push(`${m.name}: название не ставлю — ${SKIP_NAME[code]}`);
      else if (longest && names.every((n) => longest.toLowerCase().startsWith(n.toLowerCase()))) { data.salesName = longest; log.push(`название «${longest}» (${p.names.map((n) => `${n[0]}×${n[1]}`).join("; ")}; ${tzList(p)})`); }
      else if (names.length) skipped.push(`${m.name}: название спорное: ${p.names.map((n) => `«${n[0]}»×${n[1]}`).join("; ")}`);
    }
    // описание: Мех / Подкладка / Размеры / Цвета (только отсутствующие строки)
    const own = parseSupplierDescription(m.description);
    const add: Record<string, string> = {};
    const fur = Array.from(new Set([...p.furs, ...(p.file_furs ?? [])]));
    if (!own.fur && fur.length) add.fur = fur.join(" + ");
    if (!own.lining && p.linings.length) add.lining = cut(p.linings.slice(0, 3).map((l) => l[0]), "; ");
    if (!own.sizes && p.sizes.length) add.sizes = cut(p.sizes, ", ");
    if (!own.colors && p.colors.length) add.colors = cut(p.colors.map((c) => c[0]), ", ");
    if (Object.keys(add).length) {
      const block = composeSupplierDescription(add);
      data.description = m.description?.trim() ? `${m.description.trimEnd()}\n${block}` : block;
      log.push(`описание += ${block.replace(/\n/g, " / ")} (${tzList(p) || "АРТИКУЛА.xlsx / расчёт FW26"})`);
    }
    // расценка и расход: единое значение во всех источниках
    const works = distinct([...p.work.map((w) => w[0]), ...(p.sheet_work ?? [])]);
    if (m.supplierWorkPrice == null && p.work.length > 0 && works.length === 1) { data.supplierWorkPrice = works[0]; log.push(`расценка ${works[0]} (все ТЗ и расчёт FW26 совпадают)`); }
    else if (m.supplierWorkPrice == null && works.length > 1) skipped.push(`${m.name}: расценка разная: ${works.join(" / ")}`);
    const hides = distinct([...p.hides.map((h) => h[0]), ...(p.sheet_hides ?? [])]);
    if (m.supplierFurPerUnit == null && p.hides.length > 0 && hides.length === 1) { data.supplierFurPerUnit = hides[0]; log.push(`расход шкур ${hides[0]}`); }
    else if (m.supplierFurPerUnit == null && hides.length > 1) skipped.push(`${m.name}: расход шкур разный: ${hides.join(" / ")}`);
    if (p.file_len && p.file_len.filter((x) => x !== "NS").length > 1) skipped.push(`${m.name}: длина в АРТИКУЛА.xlsx разная: ${p.file_len.join(" / ")} — не ставлю`);
    if (Object.keys(data).length) plan.push({ m, data, log });
  }
  for (const x of plan) console.log(`${x.m.name}: ${x.log.join(" | ")}`);
  console.log("\nНЕ СТАВЛЮ:\n" + skipped.join("\n"));
  console.log(`\nартикулов к изменению: ${plan.length}`);
  if (!APPLY) return console.log("пробный прогон (добавьте --apply)");
  execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: ROOT });
  const journal = plan.map((x) => ({
    id: x.m.id, name: x.m.name,
    before: Object.fromEntries(Object.keys(x.data).map((k) => [k, (x.m as Record<string, unknown>)[k] ?? null])),
    after: x.data, source: x.log,
  }));
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 2));
  for (const x of plan) await prisma.productModel.update({ where: { id: x.m.id }, data: x.data as never });
  console.log("применено, журнал:", JOURNAL);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
