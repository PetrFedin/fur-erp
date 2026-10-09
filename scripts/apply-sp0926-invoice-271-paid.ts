/**
 * Оплата счёта Веллмех №271 от 30.09.2026 (СП 09.26, 60 831 100,00) — по указанию владельца 08.10.2026: «оплачено».
 * Платёжки (п/п) в архиве нет, дата оплаты неизвестна: ставится срок счёта 05.10.2026, запись НЕ подтверждена (confirmed=false) —
 * подтвердить после появления п/п или акта сверки новее 30.06.2026. Платёж идёт на аукцион СП 09.26 как аванс.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-sp0926-invoice-271-paid.ts            # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-sp0926-invoice-271-paid.ts --apply
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-sp0926-invoice-271-paid.ts --rollback --apply
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-sp0926-invoice-271.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const MARK = "[оплата счёта №271, решение владельца 08.10.2026]";

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!org) throw new Error("нет организации");
    if (ROLLBACK) {
      if (!existsSync(JOURNAL)) { console.log("Нечего откатывать"); return; }
      const j = JSON.parse(readFileSync(JOURNAL, "utf-8")) as { id: string; rolledBack?: string };
      if (j.rolledBack) { console.log("Уже откачено"); return; }
      if (APPLY) { await prisma.payment.delete({ where: { id: j.id } }); j.rolledBack = new Date().toISOString(); writeFileSync(JOURNAL, JSON.stringify(j, null, 1)); }
      console.log(APPLY ? "Откачено" : "Будет откачено (добавьте --apply)");
      return;
    }
    const exists = await prisma.payment.findFirst({ where: { organizationId: org.id, notes: { contains: MARK } } });
    if (exists) { console.log("Уже внесено"); return; }
    const supplier = await prisma.supplier.findFirst({ where: { organizationId: org.id, name: { contains: "Веллмех" } } });
    if (!supplier) throw new Error("нет поставщика Веллмех");
    console.log(`Оплата счёта №271: 60 831 100,00 ₽, СП 09.26, дата 05.10.2026 (срок счёта), не подтверждена (${APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН"})`);
    if (!APPLY) return;
    const p = await prisma.payment.create({
      data: {
        organizationId: org.id, supplierId: supplier.id, amount: 60831100, currency: "RUB", method: "BANK_TRANSFER", status: "COMPLETED",
        paidAt: new Date("2026-10-05T00:00:00Z"), auctionSession: "СП 09.26", kind: "ADVANCE", confirmed: false,
        docRef: "счёт Веллмех №271 от 30.09.2026",
        notes: `${MARK} Оплачено по указанию владельца. П/п нет, фактическая дата неизвестна — взят срок счёта 05.10.2026. Подтвердить по п/п или акту сверки новее 30.06.2026.`,
      },
    });
    writeFileSync(JOURNAL, JSON.stringify({ time: new Date().toISOString(), id: p.id }, null, 1));
    console.log("Готово");
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
