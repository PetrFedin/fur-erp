/**
 * Размеры из листа Report файла «отчет по товарам фото и цены 2.xlsx» (строки артикул × цвет × размер: поступило, продано, остаток, выручка) — для разреза «Размеры» в Cashflow.
 * Хранение: SystemState «sales-report-sizes:2026-10-19» (миграция не нужна). Дат и сезонов у размерных строк нет — только итоги на 19.10.2026.
 *
 *   TSX="node --conditions=react-server --env-file=.env node_modules/.bin/tsx"
 *   $TSX scripts/apply-report-sizes-2026-10-19.ts                  # пробный прогон: разбор и сверка с итогами отчёта (БД не меняется)
 *   $TSX scripts/apply-report-sizes-2026-10-19.ts --apply          # в НЕ боевую базу
 *   $TSX scripts/apply-report-sizes-2026-10-19.ts --apply --live   # в боевую (сам делает bash scripts/backup.sh)
 *   $TSX scripts/apply-report-sizes-2026-10-19.ts --rollback --apply [--live]
 * Сверка: Σ штук поступления / продаж / остатка и выручки по размерным строкам = строка «Total» отчёта. Расхождение — остановка. Идемпотентно (перезапись того же ключа тем же значением).
 * Журнал: docs-inventory/cashflow-sales-2026-10-19/sizes-journal<-база>.json (прежнее значение ключа).
 */
import "./stubs/server-only-shim";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice(7) ?? join(homedir(), "Downloads", "отчет по товарам фото и цены 2.xlsx");
const ROOT = join(__dirname, "..");
const DIR = join(ROOT, "docs-inventory", "cashflow-sales-2026-10-19");
type Journal = { script: string; status: "applied" | "rolled-back"; at: string; db: string; before: unknown | null };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { REPORT_SIZES_KEY } = await import("../src/lib/margin-tree");
  const { modelCodeOfArticle, classOfLevel2 } = await import("../src/lib/sales-receipts-core");
  const prisma = createAuditedClient("script:apply-report-sizes-2026-10-19");
  const url = process.env.DATABASE_URL ?? "";
  const dbName = /\/([^/?]+)(\?|$)/.exec(url)?.[1] ?? "?";
  const isLive = dbName === "fur_erp";
  const JOURNAL = join(DIR, `sizes-journal${isLive ? "" : "-" + dbName}.json`);
  const orgId = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  console.log(`База: ${dbName}${isLive ? " (БОЕВАЯ)" : ""}; ${ROLLBACK ? "откат" : "внесение"}${APPLY ? " — ПРИМЕНЕНИЕ" : " — пробный прогон"}`);
  if (APPLY && isLive && !LIVE) { console.log("Боевая база: нужен --live."); process.exitCode = 1; await prisma.$disconnect(); return; }
  if (APPLY && !isLive && LIVE) { console.log("--live указан, но база не fur_erp."); process.exitCode = 1; await prisma.$disconnect(); return; }
  const backup = () => { console.log("Копия базы: bash scripts/backup.sh …"); execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: ROOT }); };

  if (ROLLBACK) {
    const j: Journal | null = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : null;
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен."); await prisma.$disconnect(); return; }
    if (APPLY) {
      if (isLive) backup();
      if (j.before === null) await prisma.systemState.deleteMany({ where: { organizationId: orgId, key: REPORT_SIZES_KEY } });
      else await prisma.systemState.update({ where: { organizationId_key: { organizationId: orgId, key: REPORT_SIZES_KEY } }, data: { value: j.before as object } });
      writeFileSync(JOURNAL, JSON.stringify({ ...j, status: "rolled-back", at: new Date().toISOString() }, null, 1));
      console.log("Откат выполнен.");
    } else console.log("Откат (пробный — добавьте --apply).");
    await prisma.$disconnect();
    return;
  }

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets.find((w) => w.name === "Report");
  if (!ws) throw new Error("В файле нет листа Report");
  const num = (v: unknown) => { const x = v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v; return x == null || x === "" ? 0 : Number(x); };
  const rows: { acode: string; color: string; size: string; modelCode: string | null; cls: string; deliv: number; sold: number; stock: number; nsRub: number; nsRubEx: number }[] = [];
  let total = { deliv: 0, sold: 0, stock: 0, nsRub: 0, nsRubEx: 0 };
  ws.eachRow((row, rn) => {
    if (rn < 14) return;
    const v = (row.values as unknown[]).slice(1);
    if (v[6] === "Total") { total = { deliv: num(v[20]), sold: num(v[28]), stock: num(v[31]), nsRub: num(v[26]), nsRubEx: num(v[30]) }; return; }
    if (v[2] !== 1 || !v[7]) return; // только листовые строки
    rows.push({ acode: String(v[7]), color: String(v[17] ?? ""), size: String(v[14] ?? ""), modelCode: modelCodeOfArticle(String(v[7])), cls: classOfLevel2(String(v[10] ?? "")), deliv: num(v[20]), sold: num(v[28]), stock: num(v[31]), nsRub: num(v[26]), nsRubEx: num(v[30]) });
  });
  const sum = (k: "deliv" | "sold" | "stock" | "nsRub" | "nsRubEx") => rows.reduce((a, r) => a + r[k], 0);
  let bad = 0;
  for (const k of ["deliv", "sold", "stock", "nsRub", "nsRubEx"] as const) {
    const ok = Math.abs(sum(k) - total[k]) < 0.01; if (!ok) bad++;
    console.log(`  ${ok ? "ОК " : "НЕТ"} ${k}: Σ строк ${sum(k).toLocaleString("ru-RU")} · Total ${total[k].toLocaleString("ru-RU")}`);
  }
  console.log(`Строк артикул×цвет×размер: ${rows.length}; размеров ${new Set(rows.map((r) => r.size)).size}`);
  if (bad) throw new Error("Размерные строки не сходятся с Total отчёта — остановлено, БД не менялась.");
  if (!APPLY) { console.log("Пробный прогон: БД не менялась."); await prisma.$disconnect(); return; }
  const prev: Journal | null = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : null;
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое внесение — сначала --rollback --apply."); await prisma.$disconnect(); return; }
  if (isLive) backup();
  const cur = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: REPORT_SIZES_KEY } }, select: { value: true } });
  writeFileSync(JOURNAL, JSON.stringify({ script: "apply-report-sizes-2026-10-19.ts", status: "applied", at: new Date().toISOString(), db: dbName, before: (cur?.value as unknown) ?? null } satisfies Journal, null, 1));
  const value = { asOf: "2026-10-19", source: "отчет по товарам фото и цены 2.xlsx, лист Report", total, rows };
  await prisma.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key: REPORT_SIZES_KEY } }, create: { organizationId: orgId, key: REPORT_SIZES_KEY, value }, update: { value } });
  console.log(`Записано: ${rows.length} строк. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
