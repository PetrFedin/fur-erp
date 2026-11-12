/**
 * Дочитать итоговые колонки TTL (заказано / получено / остаток и €) в текущую версию «Размеры из отчёта»: поле ttl у каждой строки.
 * Нужно, чтобы разложить приход из файла «поступления и продажи» по размерам, когда в сезонных блоках отчёта пусто.
 * Прежнее значение — в журнал docs-inventory/corrections-journal-reparse-report-ttl-2026-11-12.json (--rollback возвращает).
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/reparse-report-ttl-2026-11-12.ts [--apply | --rollback] [--file=...]
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
const APPLY = process.argv.includes("--apply"), ROLLBACK = process.argv.includes("--rollback");
const ROOT = resolve(__dirname, "..");
const JOURNAL = join(ROOT, "docs-inventory", "corrections-journal-reparse-report-ttl-2026-11-12.json");
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice(7) ?? join(homedir(), "Downloads", "заказ и продажи 09-11-2026.xlsx");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
(async () => {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const db = createAuditedClient("script:reparse-report-ttl");
  const { loadReportSizesState } = await import("../src/lib/import-keys");
  const { sizeKey, withDupKeys } = await import("../src/lib/import-core");
  const org = (await db.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  if (ROLLBACK) { const j = JSON.parse(readFileSync(JOURNAL, "utf8")); await db.systemState.update({ where: { organizationId_key: { organizationId: org, key: j.key } }, data: { value: j.before } }); console.log("Откат выполнен."); process.exit(0); }
  const cur = await loadReportSizesState(org, db);
  if (!cur) throw new Error("нет версии размеров");
  const val = cur.value as { rows: { acode: string; color: string; size: string; ttl?: unknown }[] };
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(FILE);
  const ws = wb.getWorksheet("Report")!;
  const cell = (r: number, c: number) => { const v = ws.getRow(r).getCell(c).value; return v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v; };
  const fileRows: { acode: string; color: string; size: string; ttl: { conf: number; deliv: number; stock: number; delivEur: number } }[] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    if (cell(r, 3) !== 1 || !cell(r, 13)) continue;
    fileRows.push({ acode: String(cell(r, 13)), color: String(cell(r, 17)), size: String(cell(r, 18)), ttl: { conf: num(cell(r, 19)), deliv: num(cell(r, 21)), stock: num(cell(r, 32)), delivEur: num(cell(r, 22)) } });
  }
  const byKey = new Map(withDupKeys(fileRows, sizeKey).map((x) => [x.key, x.row]));
  let hit = 0;
  const rows = withDupKeys(val.rows, sizeKey).map(({ key, row }) => { const f = byKey.get(key); if (f) hit++; return f ? { ...row, ttl: f.ttl } : row; });
  const sum = (k: "conf" | "deliv" | "stock") => fileRows.reduce((a, r) => a + r.ttl[k], 0);
  console.log(`версия ${cur.key}: строк в базе ${val.rows.length}, в файле ${fileRows.length}, сопоставлено ${hit}; TTL: заказано ${sum("conf")}, получено ${sum("deliv")}, остаток ${sum("stock")}`);
  if (hit !== val.rows.length) { console.log("Не все строки сопоставлены — стоп."); process.exit(1); }
  if (!APPLY) { console.log("Пробный прогон."); process.exit(0); }
  if (existsSync(JOURNAL)) { console.log("Журнал уже есть — сначала --rollback."); process.exit(1); }
  writeFileSync(JOURNAL, JSON.stringify({ key: cur.key, before: cur.value }));
  await db.systemState.update({ where: { organizationId_key: { organizationId: org, key: cur.key } }, data: { value: { ...val, rows } as object } });
  console.log("Применено. Журнал:", JOURNAL); process.exit(0);
})();
