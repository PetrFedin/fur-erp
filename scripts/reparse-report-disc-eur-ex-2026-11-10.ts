/**
 * Дочитать сезонные поля (NS EUR и NS EUR excl VAT) в текущую версию «Размеры из отчёта» без новой версии: строки и итоги те же, меняется только seas.
 * Прежнее значение — в журнал docs-inventory/corrections-journal-reparse-report-disc-eur-ex-2026-11-10.json (--rollback возвращает).
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/reparse-report-disc-eur-ex-2026-11-10.ts [--apply | --rollback]
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const APPLY = process.argv.includes("--apply"), ROLLBACK = process.argv.includes("--rollback");
const ROOT = resolve(__dirname, "..");
const JOURNAL = join(ROOT, "docs-inventory", "corrections-journal-reparse-report-disc-eur-ex-2026-11-10.json");
const FILE = join(ROOT, "docs-inventory", "incoming-2026-11-09", "заказ и продажи 09-11-2026.xlsx");
(async () => {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const db = createAuditedClient("script:reparse-report-disc-eur-ex");
  const { loadReportSizesState } = await import("../src/lib/import-keys");
  const { parseSizesWorkbook, sizeKey, withDupKeys } = await import("../src/lib/import-core");
  const org = (await db.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  if (ROLLBACK) { const j = JSON.parse(readFileSync(JOURNAL, "utf8")); await db.systemState.update({ where: { organizationId_key: { organizationId: org, key: j.key } }, data: { value: j.before } }); console.log("Откат выполнен."); process.exit(0); }
  const cur = await loadReportSizesState(org, db);
  if (!cur) throw new Error("нет версии размеров");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(FILE);
  const f = parseSizesWorkbook(wb);
  if (f.errors.length) { console.log("ОШИБКИ:", f.errors); process.exit(1); }
  const val = cur.value as { rows: { acode: string; color: string; size: string; seas?: unknown }[]; total?: { seas?: unknown } };
  const byKey = new Map(withDupKeys(f.rows, sizeKey).map((x) => [x.key, x.row]));
  let hit = 0;
  const rows = withDupKeys(val.rows, sizeKey).map(({ key, row }) => { const n = byKey.get(key); if (n) hit++; return n ? { ...row, seas: n.seas } : row; });
  console.log(`версия ${cur.key}: строк ${val.rows.length}, обновлено seas ${hit}`);
  if (!APPLY) { console.log("Пробный прогон."); process.exit(0); }
  if (existsSync(JOURNAL)) { console.log("Журнал уже есть — сначала --rollback."); process.exit(1); }
  writeFileSync(JOURNAL, JSON.stringify({ key: cur.key, before: cur.value }));
  await db.systemState.update({ where: { organizationId_key: { organizationId: org, key: cur.key } }, data: { value: { ...val, rows, total: { ...(val.total ?? {}), seas: f.total.seas } } as object } });
  console.log("Применено. Журнал:", JOURNAL); process.exit(0);
})();
