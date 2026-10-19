/**
 * Этап «Куплено на аукционе» по аукциону СП 09-26: аукцион прошёл 30.09.2026 в Санкт-Петербурге
 * (письмо Василия «Прошла закупка на аукционе в Санкт-Петербурге»). Ставится по одному этапу на каждую закупку аукциона
 * СП 09.26 у Веллмеха, у которой ещё нет этапа «Куплено на аукционе». Ничего больше не меняется (оплата аванса, выделка и т.д. — не ставятся:
 * в документах нет подтверждения).
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/set-raw-stage-sp0926.ts               # пробный прогон
 *   ... --apply --live       # записать в боевую (сам делает scripts/backup.sh); на копии — просто --apply
 *   ... --rollback --apply   # удалить созданные этапы по журналу
 * Журнал: docs-inventory/corrections-journal-raw-stage-sp0926-2026-10-15.json
 */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const APPLY = process.argv.includes("--apply"), LIVE = process.argv.includes("--live"), ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(__dirname, "../docs-inventory/corrections-journal-raw-stage-sp0926-2026-10-15.json");
const SUPPLIER_EMAIL = "wellmekh@demo.local";

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:raw-stage-sp0926");
  const db = /\/([^/?]+)(\?|$)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "?";
  console.log(`База: ${db}${APPLY ? " · ЗАПИСЬ" : " · пробный прогон"}`);
  if (APPLY && db === "fur_erp" && !LIVE) throw new Error("боевая база: нужен явный --live");
  const user = await prisma.user.findFirstOrThrow({ where: { email: SUPPLIER_EMAIL, role: "SUPPLIER" }, select: { id: true, organizationId: true, supplierId: true } });
  const orgId = user.organizationId, supplierId = user.supplierId!;

  if (ROLLBACK) {
    const ids = (JSON.parse(readFileSync(JOURNAL, "utf8")) as { created: string[] }).created;
    console.log(`Откат: удалить этапов ${ids.length}`);
    if (APPLY) { await prisma.supplierRawStage.deleteMany({ where: { id: { in: ids }, organizationId: orgId } }); console.log("откат выполнен"); }
    return;
  }
  const purchases = await prisma.purchase.findMany({
    where: { organizationId: orgId, supplierId, status: { not: "CANCELLED" }, OR: [{ auction: { name: { in: ["СП 09.26", "СП 09-26"] } } }, { auctionSession: { in: ["СП 09.26", "СП 09-26"] } }] },
    select: { id: true, number: true, invoiceNumber: true, rawStages: { where: { stage: "AUCTION_BOUGHT" }, select: { id: true } } },
  });
  const todo = purchases.filter((p) => p.rawStages.length === 0);
  console.log(`Закупок СП 09.26: ${purchases.length}, без этапа «Куплено на аукционе»: ${todo.length}`);
  for (const p of todo) console.log(`  + ${p.number} (счёт ${p.invoiceNumber ?? "—"}): Куплено на аукционе · Санкт-Петербург · 30.09.2026 · готово`);
  if (!APPLY || todo.length === 0) return console.log(APPLY ? "нечего создавать" : "пробный прогон: БД не тронута");
  if (LIVE) execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
  const d = new Date(Date.UTC(2026, 8, 30));
  const created: string[] = existsSync(JOURNAL) ? (JSON.parse(readFileSync(JOURNAL, "utf8")) as { created: string[] }).created : [];
  for (const p of todo) {
    const r = await prisma.supplierRawStage.create({
      data: { organizationId: orgId, supplierId, purchaseId: p.id, stage: "AUCTION_BOUGHT", status: "DONE", place: "Санкт-Петербург", plannedStart: d, plannedEnd: d, factStart: d, factEnd: d, note: "По письму Василия: закупка прошла на аукционе в Санкт-Петербурге 30.09.2026", createdById: user.id },
      select: { id: true },
    });
    created.push(r.id);
  }
  writeFileSync(JOURNAL, JSON.stringify({ created }, null, 1));
  console.log(`создано этапов: ${todo.length}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
