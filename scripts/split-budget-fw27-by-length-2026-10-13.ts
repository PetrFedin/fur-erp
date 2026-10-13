/**
 * Бюджет FW27 (DRAFT): разложить штуки по длинам Short / Regular / Long по отчёту 2026_10_08_MVST_WW_Русский_мех_Budget_PCS_FW27.pdf
 * (колонка «Conf TTL PCS», стр. 2). Длины есть только у склеек мех × категория, перечисленных ниже (в PDF у них нет аксессуаров и прочих категорий).
 * Рысь (замок) не трогаем — «рысь не трогаем, оставляем как есть». Если сумма длин не равна штукам категории в версии — склейка пропускается и выводится в отчёте (не подгоняем).
 * Новый узел-длина получает значения категории (шкуры, цены, база, источник) — итог в рублях не меняется; затем кнопка «Автоматический расчёт»
 * пересчитает длины по статистике «мех × категория × длина» (где ТЗ с длиной уже есть) или по паре «мех × категория».
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/split-budget-fw27-by-length-2026-10-13.ts            # пробный прогон
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/split-budget-fw27-by-length-2026-10-13.ts --apply    # backup.sh + запись + журнал
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/split-budget-fw27-by-length-2026-10-13.ts --rollback # вернуть строки из журнала
 * Журнал: docs-inventory/corrections-journal-budget-fw27-lengths-2026-10-13.json
 */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const FORCE = process.argv.includes("--force");
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-budget-fw27-lengths-2026-10-13.json");

type Len = "Short" | "Regular" | "Long";
/** По PDF (стр. 2): мех → категория бюджета → штуки по длинам. */
const PLAN: Array<{ fur: string; cat: string; pdfTotal: number; lens: Partial<Record<Len, number>> }> = [
  { fur: "Соболь", cat: "Шубы", pdfTotal: 86, lens: { Short: 46, Long: 12, Regular: 28 } },
  { fur: "Соболь", cat: "Жилет меховой", pdfTotal: 26, lens: { Short: 18, Long: 8 } },
  { fur: "Норка", cat: "Шубы", pdfTotal: 110, lens: { Short: 65, Long: 45 } },
  { fur: "Норка", cat: "Жилет меховой", pdfTotal: 95, lens: { Regular: 35, Short: 42, Long: 18 } },
  { fur: "Норка", cat: "Куртки меховые", pdfTotal: 45, lens: { Short: 45 } },
  { fur: "Норка+Соболь", cat: "Шубы", pdfTotal: 14, lens: { Long: 14 } },
  { fur: "Лиса", cat: "Шубы", pdfTotal: 70, lens: { Short: 55, Long: 15 } },
];
const ORDER: Len[] = ["Short", "Regular", "Long"];

type N = { id: string; kind: string; parentId: string | null; name: string; pcs: number; locked: boolean; [k: string]: unknown };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { grandTotal, DEFAULT_PARAMS, parseNodes, newId } = await import("../src/lib/budget-calc");
  const prisma = createAuditedClient("script:split-budget-fw27-by-length");
  const row = await prisma.budgetScenario.findFirst({ where: { name: "FW27", season: "FW27" } });
  if (!row) throw new Error("версия FW27 не найдена");

  if (ROLLBACK) {
    if (!existsSync(JOURNAL)) throw new Error("журнала нет: откатывать нечего");
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as { id: string; before: unknown; appliedUpdatedAt: string };
    if (j.id !== row.id) throw new Error("журнал относится к другой версии");
    if (row.updatedAt.toISOString() !== j.appliedUpdatedAt && !FORCE) throw new Error(`версия менялась после применения (${row.updatedAt.toISOString()}); откат затрёт эти правки — добавьте --force, если это нужно`);
    await prisma.budgetScenario.update({ where: { id: row.id }, data: { lines: j.before as object[] } });
    console.log("откат выполнен: строки версии FW27 возвращены к состоянию до разбивки по длинам");
    return;
  }

  const before = row.lines as unknown as N[];
  if (before.some((n) => n.kind === "len")) { console.log("в версии уже есть узлы-длины: ничего не делаю"); return; }
  const params = { ...DEFAULT_PARAMS, ...(row.params as object) };
  const totBefore = grandTotal(parseNodes(before), params);
  const next: N[] = [];
  const report: string[] = [];
  const skipped: string[] = [];
  let created = 0;
  const plan = new Map(PLAN.map((p) => [`${p.fur}|${p.cat}`, p]));
  for (const nd of before) {
    next.push(nd);
    if (nd.kind !== "cat") continue;
    const fur = before.find((x) => x.id === nd.parentId);
    const p = fur ? plan.get(`${fur.name}|${nd.name}`) : undefined;
    if (!fur || !p) continue;
    const sum = Object.values(p.lens).reduce((s, v) => s + (v ?? 0), 0);
    if (fur.locked || nd.locked) { skipped.push(`${fur.name} → ${nd.name}: замок, не трогаем`); continue; }
    if (sum !== p.pdfTotal) { skipped.push(`${fur.name} → ${nd.name}: длины в PDF дают ${sum}, а итог PDF ${p.pdfTotal}`); continue; }
    if (sum !== nd.pcs) { skipped.push(`${fur.name} → ${nd.name}: сумма длин по PDF ${sum}, а в версии ${nd.pcs} шт. — не подгоняю`); continue; }
    const kids = before.filter((x) => x.parentId === nd.id);
    if (kids.length) { skipped.push(`${fur.name} → ${nd.name}: уже есть вложенные строки (${kids.length})`); continue; }
    for (const l of ORDER) {
      const pcs = p.lens[l];
      if (!pcs) continue;
      // Значения категории переходят в длину: пересчёт по длине сделает кнопка «Автоматический расчёт».
      next.push({ ...nd, id: newId(), kind: "len", parentId: nd.id, name: l, pcs, locked: false, modelId: null, statFur: "", statCat: "" });
      created++;
    }
    report.push(`${fur.name} → ${nd.name} ${nd.pcs}: ${ORDER.filter((l) => p.lens[l]).map((l) => `${l} ${p.lens[l]}`).join(" + ")}`);
  }
  const after = parseNodes(next);
  const totAfter = grandTotal(after, params);
  console.log("Разбивка по длинам (FW27):\n  " + (report.join("\n  ") || "—"));
  if (skipped.length) console.log("Не разложено:\n  " + skipped.join("\n  "));
  console.log(`Новых узлов-длин: ${created}. Изделий: было ${totBefore.pcs}, станет ${totAfter.pcs}; итог ₽: было ${Math.round(totBefore.total)}, станет ${Math.round(totAfter.total)}`);
  if (totAfter.pcs !== totBefore.pcs || Math.round(totAfter.total) !== Math.round(totBefore.total)) throw new Error("итоги расходятся — запись отменена");
  if (!APPLY) { console.log("пробный прогон: ничего не записано (добавьте --apply)"); return; }
  console.log(execSync("scripts/backup.sh", { cwd: join(__dirname, ".."), encoding: "utf8" }).trim());
  const saved = await prisma.budgetScenario.update({ where: { id: row.id }, data: { lines: next as unknown as object[] } });
  writeFileSync(JOURNAL, JSON.stringify({ id: row.id, name: row.name, appliedAt: new Date().toISOString(), appliedUpdatedAt: saved.updatedAt.toISOString(), created, before }, null, 1));
  console.log(`записано; журнал: ${JOURNAL}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
