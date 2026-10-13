/**
 * Оплаты 2026 года по указанию владельца (08.10.2026: «всё оплачено до СП 09.26, остаток минимальный»).
 * Суммы — из документов (расчёты Василия, письма согласования); п/п в архиве нет, даты — даты согласования, записи НЕ подтверждены.
 *  • счёт №197 (доплата по спец. 10) 7 236 812,03: РП 04.26 5 438 524,49 + СП 05.26 1 798 287,53 (расчёт Василия 09.07, согласовано Киржнером 17.07.2026; письма №136, №125);
 *  • счёт №253 (AME 05.26) к оплате 214 522,92 = УПД №253 − авансы − зачёты (письма №41, №42; согласован 15.09.2026). Зачёты 139 469,87 (переплата SAGA 83 875,37 и подкладки 55 594,50) остаются как зачёт.
 * НЕ внесено: FH 06.26 «аванс 3» 3 603 475,98 (счёта нет, мех не получен), СП 09.26 сверх счёта №271 3 627 050,40.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-owner-paid-2026.ts            # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-owner-paid-2026.ts --apply
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-owner-paid-2026.ts --rollback --apply
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-owner-paid-2026.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const MARK = "[оплата 2026 по указанию владельца 08.10.2026]";
const PLAN = [
  { auction: "РП 04.26", amount: 5438524.49, date: "2026-07-17", doc: "счёт Веллмех №197 от 09.07.2026 (доплата)", why: "доплата по счёту №197, согласована Киржнером 17.07.2026" },
  { auction: "СП 05.26", amount: 1798287.54, date: "2026-07-17", doc: "счёт Веллмех №197 от 09.07.2026 (доплата)", why: "доплата по счёту №197, согласована Киржнером 17.07.2026" },
  { auction: "AME 05.26", amount: 214522.92, date: "2026-09-15", doc: "счёт Веллмех №253 от 09.09.2026", why: "к оплате по счёту №253 после зачётов, согласован 15.09.2026" },
];

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!org) throw new Error("нет организации");
    if (ROLLBACK) {
      if (!existsSync(JOURNAL)) { console.log("Нечего откатывать"); return; }
      const j = JSON.parse(readFileSync(JOURNAL, "utf-8")) as { ids: string[]; rolledBack?: string };
      if (j.rolledBack) { console.log("Уже откачено"); return; }
      if (APPLY) { await prisma.payment.deleteMany({ where: { id: { in: j.ids } } }); j.rolledBack = new Date().toISOString(); writeFileSync(JOURNAL, JSON.stringify(j, null, 1)); }
      console.log(APPLY ? "Откачено" : "Будет откачено (добавьте --apply)");
      return;
    }
    if (await prisma.payment.findFirst({ where: { organizationId: org.id, notes: { contains: MARK } } })) { console.log("Уже внесено"); return; }
    const supplier = await prisma.supplier.findFirst({ where: { organizationId: org.id, name: { contains: "Веллмех" } } });
    if (!supplier) throw new Error("нет поставщика Веллмех");
    for (const p of PLAN) {
      const n = await prisma.purchase.count({ where: { organizationId: org.id, auctionSession: p.auction } });
      if (!n) throw new Error(`нет аукциона ${p.auction}`);
      console.log(`  ${p.auction}: ${p.amount.toFixed(2)} ₽, ${p.date} — ${p.why}`);
    }
    if (!APPLY) { console.log("Пробный прогон: ничего не записано."); return; }
    const ids: string[] = [];
    for (const p of PLAN) {
      const c = await prisma.payment.create({
        data: {
          organizationId: org.id, supplierId: supplier.id, amount: p.amount, currency: "RUB", method: "BANK_TRANSFER", status: "COMPLETED",
          paidAt: new Date(`${p.date}T00:00:00Z`), auctionSession: p.auction, kind: "FINAL", confirmed: false, docRef: p.doc,
          notes: `${MARK} ${p.why}. П/п нет, дата — дата согласования (фактическая неизвестна). Подтвердить по п/п или акту сверки новее 30.06.2026.`,
        },
      });
      ids.push(c.id);
      writeFileSync(JOURNAL, JSON.stringify({ time: new Date().toISOString(), ids }, null, 1));
    }
    console.log("Готово");
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
