/**
 * Заказано (Conf) и поступило по сезонам из листа Report файла «отчет по товарам фото и цены.xlsx»: добавляет к уже внесённым размерным
 * строкам (SystemState «sales-report-sizes:2026-10-19», артикул × цвет × размер) поля сезонов отчёта:
 *   fw26Conf, fw26Deliv — FW26/27: заказано (Conf) и поступило; ss26Deliv — SS26: поступило; fw25Deliv — FW25/26: поступило.
 * Правило владельца (21.10.2026): по FW25 и SS26 больше ничего не ждём — заказано = поступило; по FW26 «заказано» = Conf, ждём = Conf − поступило.
 *
 *   TSX="node --conditions=react-server --env-file=.env node_modules/.bin/tsx"
 *   $TSX scripts/apply-report-orders-2026-10-21.ts                  # пробный прогон: разбор и сверка с «Total» отчёта (БД не меняется)
 *   $TSX scripts/apply-report-orders-2026-10-21.ts --apply          # в НЕ боевую базу
 *   $TSX scripts/apply-report-orders-2026-10-21.ts --apply --live   # в боевую (сам делает bash scripts/backup.sh)
 *   $TSX scripts/apply-report-orders-2026-10-21.ts --rollback --apply [--live]
 * Категории строк отчёта (KTT Level 02–05) тоже вносятся (l2–l5): по ним сезоны в окне «Заказ и приход» разворачиваются на тип меха / категории. Повторный запуск безопасен.
 * Журнал с прежним значением ключа: docs-inventory/cashflow-sales-2026-10-19/orders-journal<-база>.json
 */
import "./stubs/server-only-shim";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const FILE = process.argv.find((a) => a.startsWith("--file="))?.slice(7) ?? join(homedir(), "Downloads", "отчет по товарам фото и цены.xlsx");
const ROOT = join(__dirname, "..");
const DIR = join(ROOT, "docs-inventory", "cashflow-sales-2026-10-19");
type Journal = { script: string; status: "applied" | "rolled-back"; at: string; db: string; before: unknown };
type Row = { acode: string; color: string; size: string; conf?: number; deliv: number; fw26Conf?: number; fw26Deliv?: number; ss26Deliv?: number; fw25Deliv?: number; l2?: string; l3?: string; l4?: string; l5?: string };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { REPORT_SIZES_KEY } = await import("../src/lib/margin-tree");
  const prisma = createAuditedClient("script:apply-report-orders-2026-10-21");
  const url = process.env.DATABASE_URL ?? "";
  const dbName = /\/([^/?]+)(\?|$)/.exec(url)?.[1] ?? "?";
  const isLive = dbName === "fur_erp";
  const JOURNAL = join(DIR, `orders-journal${isLive ? "" : "-" + dbName}.json`);
  const orgId = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  console.log(`База: ${dbName}${isLive ? " (БОЕВАЯ)" : ""}; ${ROLLBACK ? "откат" : "внесение"}${APPLY ? " — ПРИМЕНЕНИЕ" : " — пробный прогон"}`);
  if (APPLY && isLive && !LIVE) { console.log("Боевая база: нужен --live."); process.exitCode = 1; await prisma.$disconnect(); return; }
  if (APPLY && !isLive && LIVE) { console.log("--live указан, но база не fur_erp."); process.exitCode = 1; await prisma.$disconnect(); return; }
  const backup = () => { console.log("Копия базы: bash scripts/backup.sh …"); execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: ROOT }); };
  const cur = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: REPORT_SIZES_KEY } }, select: { value: true } });
  if (!cur) throw new Error(`Нет ключа ${REPORT_SIZES_KEY}: сначала scripts/apply-report-sizes-2026-10-19.ts`);

  if (ROLLBACK) {
    const j: Journal | null = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : null;
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен."); await prisma.$disconnect(); return; }
    if (APPLY) {
      if (isLive) backup();
      await prisma.systemState.update({ where: { organizationId_key: { organizationId: orgId, key: REPORT_SIZES_KEY } }, data: { value: j.before as object } });
      writeFileSync(JOURNAL, JSON.stringify({ ...j, status: "rolled-back", at: new Date().toISOString() }, null, 1));
      console.log("Откат выполнен.");
    } else console.log("Откат (пробный — добавьте --apply).");
    await prisma.$disconnect();
    return;
  }

  const stored = cur.value as { rows: Row[]; [k: string]: unknown };
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets.find((w) => w.name === "Report");
  if (!ws) throw new Error("В файле нет листа Report");
  const num = (v: unknown) => { const x = v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v; return x == null || x === "" ? 0 : Number(x); };
  // Столбцы (0-based в строке Report): 18 TTL Conf PCS, 20 TTL Delivery PCS, 38 FW26/27 Conf PCS, 40 FW26/27 Deliv PCS, 71 SS26 Deliv PCS, 100 FW25/26 Deliv PCS.
  const head = (ws.getRow(10).values as unknown[]).slice(1);
  if (String(head[37]) !== "FW26/27" || String(head[70]) !== "SS26" || String(head[99]) !== "FW25/26") throw new Error("Шапка листа Report не совпала с ожидаемой (FW26/27 в столбце 38, SS26 в 71, FW25/26 в 100) — остановлено.");
  const leaf: { acode: string; color: string; size: string; l2: string; l3: string; l4: string; l5: string; conf: number; deliv: number; fw26Conf: number; fw26Deliv: number; ss26Deliv: number; fw25Deliv: number }[] = [];
  let total = { conf: 0, deliv: 0, fw26Conf: 0, fw26Deliv: 0, ss26Deliv: 0, fw25Deliv: 0 };
  ws.eachRow((row, rn) => {
    if (rn < 14) return;
    const v = (row.values as unknown[]).slice(1);
    if (v[6] === "Total") { total = { conf: num(v[18]), deliv: num(v[20]), fw26Conf: num(v[38]), fw26Deliv: num(v[40]), ss26Deliv: num(v[71]), fw25Deliv: num(v[100]) }; return; }
    if (v[2] !== 1 || !v[7]) return;
    leaf.push({ acode: String(v[7]), color: String(v[17] ?? ""), size: String(v[14] ?? ""), l2: String(v[10] ?? ""), l3: String(v[11] ?? ""), l4: String(v[12] ?? ""), l5: String(v[13] ?? ""), conf: num(v[18]), deliv: num(v[20]), fw26Conf: num(v[38]), fw26Deliv: num(v[40]), ss26Deliv: num(v[71]), fw25Deliv: num(v[100]) });
  });
  let bad = 0;
  for (const k of Object.keys(total) as (keyof typeof total)[]) {
    const s = leaf.reduce((a, r) => a + r[k], 0); const ok = Math.abs(s - total[k]) < 0.01; if (!ok) bad++;
    console.log(`  ${ok ? "ОК " : "НЕТ"} ${k}: Σ строк ${s} · Total ${total[k]}`);
  }
  if (bad) throw new Error("Листовые строки не сходятся с Total — остановлено, БД не менялась.");
  if (leaf.length !== stored.rows.length) throw new Error(`Строк в файле ${leaf.length}, в базе ${stored.rows.length}: порядок не сопоставить — остановлено.`);
  const rows = stored.rows.map((r, i) => {
    const f = leaf[i];
    if (f.acode !== r.acode || f.color !== r.color || f.size !== r.size || f.deliv !== r.deliv || f.conf !== (r.conf ?? 0)) throw new Error(`Строка ${i + 1} не совпала (${r.acode} ${r.color} ${r.size}) — остановлено.`);
    return { ...r, fw26Conf: f.fw26Conf, fw26Deliv: f.fw26Deliv, ss26Deliv: f.ss26Deliv, fw25Deliv: f.fw25Deliv, l2: f.l2, l3: f.l3, l4: f.l4, l5: f.l5 };
  });
  const other = leaf.reduce((a, r) => a + r.deliv - r.fw26Deliv - r.ss26Deliv - r.fw25Deliv, 0);
  console.log(`Строк: ${rows.length}. Поступило: FW25 ${total.fw25Deliv}, SS26 ${total.ss26Deliv}, FW26 ${total.fw26Deliv}, прежние сезоны ${other}; заказано FW26 (Conf) ${total.fw26Conf}.`);
  console.log(`Общий заказ = поступило ${total.deliv} + ждём (FW26: ${total.fw26Conf} − ${total.fw26Deliv}) = ${total.deliv + total.fw26Conf - total.fw26Deliv}; Conf отчёта: ${total.conf}.`);
  if (!APPLY) { console.log("Пробный прогон: БД не менялась."); await prisma.$disconnect(); return; }
  const prev: Journal | null = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : null;
  // Повторное внесение (например, добавились категории l2–l5) — прежнее значение для отката остаётся из первого внесения.
  if (isLive) backup();
  writeFileSync(JOURNAL, JSON.stringify({ script: "apply-report-orders-2026-10-21.ts", status: "applied", at: new Date().toISOString(), db: dbName, before: prev && prev.status === "applied" ? prev.before : cur.value } satisfies Journal, null, 1));
  const value = { ...stored, orders: { source: "отчет по товарам фото и цены.xlsx, лист Report", seasons: ["FW26/27", "SS26", "FW25/26"], total }, rows };
  await prisma.systemState.update({ where: { organizationId_key: { organizationId: orgId, key: REPORT_SIZES_KEY } }, data: { value } });
  console.log(`Записано: ${rows.length} строк. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
