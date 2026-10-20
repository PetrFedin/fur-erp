/**
 * Даты закупок З-2026-0010…0013 («шкуры подрядчика», дата-заглушка 01.06.2025) → реальные даты счетов Веллмеха. Меняется ТОЛЬКО Purchase.orderDate.
 * Соответствие (по основанию закупки «Доп закупк сырья партия N» и назначению счетов в реестре сверки): 0010 партия 5 → счёт №235 от 04.12.2025 (20 %); 0011 партия 6 → №239 от 18.12.2025 (20 %);
 * 0012 партия 7 → №1 от 15.01.2026 (22 %); 0013 партия 9 (накопительная доплата по балансу, партии 8+9) → №7 от 04.02.2026 (22 %). Ставки позиций (20/20/22/22 %) уже верны — после даты 2026 год ставки 22 % сходится.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-vat-dates-2026-10-20.ts                 # пробный прогон
 *   DATABASE_URL=<копия> node --env-file=.env node_modules/.bin/tsx scripts/apply-vat-dates-2026-10-20.ts --apply        # репетиция
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-vat-dates-2026-10-20.ts --apply --live                      # боевая (сам делает scripts/backup.sh)
 *   ... --rollback [--apply [--live]]
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  if (req === "next/cache") return join(__dirname, "stubs", "next-cache.js");
  return orig.call(this, req, ...rest);
};
const APPLY = process.argv.includes("--apply"), LIVE = process.argv.includes("--live"), ROLLBACK = process.argv.includes("--rollback"), NO_BACKUP = process.argv.includes("--no-backup");
const FIX: { number: string; inv: string; date: string; vat: number; basis: string }[] = [
  { number: "З-2026-0010", inv: "Доп закупк сырья партия 5", date: "2025-12-04", vat: 20, basis: "счёт №235 от 04.12.2025" },
  { number: "З-2026-0011", inv: "Доп закупк сырья партия 6", date: "2025-12-18", vat: 20, basis: "счёт №239 от 18.12.2025" },
  { number: "З-2026-0012", inv: "Доп закупк сырья партия 7", date: "2026-01-15", vat: 22, basis: "счёт №1 от 15.01.2026" },
  { number: "З-2026-0013", inv: "Доп закупк сырья партия 9", date: "2026-02-04", vat: 22, basis: "счёт №7 от 04.02.2026" },
];
type Journal = { script: string; status: "applied" | "rolled-back"; at: string; db: string; rows: { id: string; number: string; oldOrderDate: string; newOrderDate: string }[] };

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const dbName = (process.env.DATABASE_URL ?? "").split("?")[0].split("/").pop() ?? "";
  const isLive = dbName === "fur_erp";
  if (APPLY && isLive && !LIVE) throw new Error(`База «${dbName}» боевая: нужен --live (для репетиции укажите копию через DATABASE_URL).`);
  if (APPLY && !isLive && LIVE) throw new Error(`--live указан, но DATABASE_URL смотрит на «${dbName}».`);
  const prisma = createAuditedClient("script:apply-vat-dates-2026-10-20");
  const JOURNAL = join(INV, `corrections-journal-vat-dates-2026-10-20${isLive ? "" : `-${dbName}`}.json`);
  const prev = readJson<Journal | null>(JOURNAL, null);
  if (ROLLBACK) {
    if (!prev || prev.status !== "applied") { console.log("Журнал пуст или уже откачен."); await prisma.$disconnect(); return; }
    for (const r of prev.rows) console.log(`  ${r.number}: ${r.newOrderDate} -> ${r.oldOrderDate}`);
    if (APPLY) {
      await prisma.$transaction(prev.rows.map((r) => prisma.purchase.update({ where: { id: r.id }, data: { orderDate: new Date(r.oldOrderDate) } })));
      writeJson(JOURNAL, { ...prev, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    } else console.log("Пробный прогон отката.");
    await prisma.$disconnect();
    return;
  }
  const rows: Journal["rows"] = [];
  for (const x of FIX) {
    const p = await prisma.purchase.findFirst({ where: { number: x.number }, select: { id: true, number: true, orderDate: true, invoiceNumber: true, items: { select: { vatRate: true } } } });
    if (!p) { console.log(`  ${x.number}: не найдена — пропуск`); continue; }
    const rates = new Set(p.items.map((i) => Number(i.vatRate)));
    const ok = p.invoiceNumber === x.inv && rates.size === 1 && rates.has(x.vat);
    console.log(`  ${x.number} (${p.invoiceNumber}; ставка позиций ${[...rates].join("/")} %): ${p.orderDate.toISOString().slice(0, 10)} -> ${x.date} по ${x.basis}${ok ? "" : "  ПРОПУСК: основание или ставка не совпали"}`);
    if (ok && p.orderDate.toISOString().slice(0, 10) !== x.date) rows.push({ id: p.id, number: x.number, oldOrderDate: p.orderDate.toISOString(), newOrderDate: new Date(x.date + "T00:00:00.000Z").toISOString() });
  }
  if (!APPLY) { console.log(`\nПробный прогон: БД не менялась (к изменению ${rows.length}).`); await prisma.$disconnect(); return; }
  if (prev && prev.status === "applied") { console.log("Уже применено — сначала --rollback --apply."); await prisma.$disconnect(); return; }
  if (isLive && !NO_BACKUP) { console.log("Копия базы: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  await prisma.$transaction(rows.map((r) => prisma.purchase.update({ where: { id: r.id }, data: { orderDate: new Date(r.newOrderDate) } })));
  writeJson(JOURNAL, { script: "apply-vat-dates-2026-10-20.ts", status: "applied", at: new Date().toISOString(), db: dbName, rows } satisfies Journal);
  console.log(`Применено на «${dbName}»: ${rows.length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
