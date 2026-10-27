/**
 * Отчёт о товарах «Total - Custom Report» (лист Report, MVST РМ, выгрузка 27.10.2026): размерные строки артикул × цвет × размер — заказано (Conf),
 * поступило, продано, остаток, выручка, а также сезоны FW26/27, SS26, FW25/26 и категории (KTT Level 02–05).
 * Хранение: новая версия SystemState «sales-report-sizes:2026-10-27» + указатель «sales-report-sizes:current» (прежняя версия 19.10 остаётся нетронутой).
 *
 *   TSX="node --conditions=react-server --env-file=.env node_modules/.bin/tsx"
 *   $TSX scripts/apply-report-2026-10-27.ts                  # пробный прогон: разбор и сверка со строкой Total отчёта (БД не меняется)
 *   $TSX scripts/apply-report-2026-10-27.ts --apply          # в НЕ боевую базу
 *   $TSX scripts/apply-report-2026-10-27.ts --apply --live   # в боевую (сам делает bash scripts/backup.sh)
 *   $TSX scripts/apply-report-2026-10-27.ts --rollback --apply [--live]   # вернуть указатель на прежнюю версию и удалить 27.10
 *   --file="/путь/к/файлу.xlsx" — другой источник (по умолчанию ~/Downloads/2026-10-27 Total - Custom Report.xlsx)
 *
 * Сверка: Σ листовых строк = строка Total по 10 показателям; расхождение — остановка без записи.
 * Столбцы (0-based): 2 лист, 6 «Total», 8–11 Level 02–05, 12 артикул (ACODE), 13 цвет, 14 размер, 15 Conf PCS, 17 Delivery PCS, 23 NS RUR, 25 Sales PCS,
 * 27 NS RUR excl VAT, 28 Stock PCS, 35 FW26/27 Conf PCS, 37 FW26/27 Deliv PCS, 68 SS26 Deliv PCS, 97 FW25/26 Deliv PCS.
 */
import "./stubs/server-only-shim";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice(7) ?? join(homedir(), "Downloads", "2026-10-27 Total - Custom Report.xlsx");
const ROOT = join(__dirname, "..");
const DIR = join(ROOT, "docs-inventory", "cashflow-sales-2026-10-19");
const AS_OF = "2026-10-27";
type Journal = { script: string; status: "applied" | "rolled-back"; at: string; db: string; pointerBefore: unknown | null };
const COLS = { conf: 15, deliv: 17, nsRub: 23, sold: 25, nsRubEx: 27, stock: 28, fw26Conf: 35, fw26Deliv: 37, ss26Deliv: 68, fw25Deliv: 97 } as const;
type K = keyof typeof COLS;

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { SIZES_PREFIX, versionKey, pointerKey } = await import("../src/lib/import-keys");
  const { modelCodeOfArticle, classOfLevel2 } = await import("../src/lib/sales-receipts-core");
  const prisma = createAuditedClient("script:apply-report-2026-10-27");
  const url = process.env.DATABASE_URL ?? "";
  const dbName = /\/([^/?]+)(\?|$)/.exec(url)?.[1] ?? "?";
  const isLive = dbName === "fur_erp";
  const JOURNAL = join(DIR, `report-2026-10-27-journal${isLive ? "" : "-" + dbName}.json`);
  const KEY = versionKey(SIZES_PREFIX, AS_OF), PTR = pointerKey(SIZES_PREFIX);
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
      if (j.pointerBefore === null) await prisma.systemState.deleteMany({ where: { organizationId: orgId, key: PTR } });
      else await prisma.systemState.update({ where: { organizationId_key: { organizationId: orgId, key: PTR } }, data: { value: j.pointerBefore as object } });
      await prisma.systemState.deleteMany({ where: { organizationId: orgId, key: KEY } });
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
  const r8 = (c: number) => String(ws.getRow(8).getCell(c + 1).value ?? "");
  if (r8(15) !== "TTL Conf" || r8(34) !== "FW26/27" || r8(67) !== "SS26" || r8(96) !== "FW25/26") throw new Error("Шапка листа Report не совпала с ожидаемой (TTL Conf в столбце 16, FW26/27 в 35, SS26 в 68, FW25/26 в 97) — остановлено.");
  const rows: { acode: string; color: string; size: string; modelCode: string | null; cls: string; l2: string; l3: string; l4: string; l5: string; conf: number; deliv: number; sold: number; stock: number; nsRub: number; nsRubEx: number; fw26Conf: number; fw26Deliv: number; ss26Deliv: number; fw25Deliv: number }[] = [];
  let total: Record<K, number> | null = null;
  ws.eachRow((row, rn) => {
    if (rn < 12) return;
    const v = (row.values as unknown[]).slice(1);
    const pick = () => Object.fromEntries((Object.keys(COLS) as K[]).map((k) => [k, num(v[COLS[k]])])) as Record<K, number>;
    if (v[6] === "Total") { total = pick(); return; }
    if (v[2] !== 1 || !v[12]) return; // только листовые строки
    rows.push({ acode: String(v[12]), color: String(v[13] ?? ""), size: String(v[14] ?? ""), modelCode: modelCodeOfArticle(String(v[12])), cls: classOfLevel2(String(v[8] ?? "")), l2: String(v[8] ?? ""), l3: String(v[9] ?? ""), l4: String(v[10] ?? ""), l5: String(v[11] ?? ""), ...pick() });
  });
  if (!total) throw new Error("В отчёте нет строки Total — остановлено.");
  const tot: Record<K, number> = total;
  let bad = 0;
  for (const k of Object.keys(COLS) as K[]) {
    const s = rows.reduce((a, r) => a + r[k], 0); const ok = Math.abs(s - tot[k]) < 0.01; if (!ok) bad++;
    console.log(`  ${ok ? "ОК " : "НЕТ"} ${k}: Σ строк ${s.toLocaleString("ru-RU")} · Total ${tot[k].toLocaleString("ru-RU")}`);
  }
  console.log(`Строк артикул×цвет×размер: ${rows.length}; размеров ${new Set(rows.map((r) => r.size)).size}`);
  if (bad) throw new Error("Листовые строки не сходятся с Total отчёта — остановлено, БД не менялась.");
  if (!APPLY) { console.log("Пробный прогон: БД не менялась."); await prisma.$disconnect(); return; }
  const prev: Journal | null = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : null;
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое внесение — сначала --rollback --apply."); await prisma.$disconnect(); return; }
  if (isLive) backup();
  const ptr = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: PTR } }, select: { value: true } });
  writeFileSync(JOURNAL, JSON.stringify({ script: "apply-report-2026-10-27.ts", status: "applied", at: new Date().toISOString(), db: dbName, pointerBefore: (ptr?.value as unknown) ?? null } satisfies Journal, null, 1));
  const value = { asOf: AS_OF, source: "2026-10-27 Total - Custom Report.xlsx, лист Report (MVST РМ)", total: tot, orders: { source: "Total - Custom Report 27.10.2026", seasons: ["FW26/27", "SS26", "FW25/26"], total: tot }, rows };
  await prisma.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key: KEY } }, create: { organizationId: orgId, key: KEY, value }, update: { value } });
  await prisma.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key: PTR } }, create: { organizationId: orgId, key: PTR, value: { key: KEY } }, update: { value: { key: KEY } } });
  console.log(`Записано: ${rows.length} строк в ${KEY}, указатель ${PTR} → ${KEY}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
