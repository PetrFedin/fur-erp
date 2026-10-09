/**
 * РАЗНЕСЕНИЕ ДВУХ ПЛАТЕЖЕЙ 2025 ГОДА ПО АУКЦИОНАМ СП 05.25 И РП 05.25 (комплект по Спец. №4 к договору №2502, УПД №143).
 *
 * Документально:
 *  • п/п 53423 от 27.06.2025, 30 666 300,00 — аванс, и п/п 70941 от 01.10.2025, 2 533 779,20 — окончательный платёж (оба в акте сверки на 30.06.2026);
 *  • письмо Василия 18.09.2025 (№363): «Был оплачен аванс 30 66 300, к доплате 2 533 779,2»; его расчёт «СП-РП 05-2025»:
 *    СП 05.25 = 29 605 789,30, РП 05.25 = 3 594 289,90; Σ = 33 200 079,20 = УПД №143 = 30 666 300 + 2 533 779,20 (до копейки).
 * Оба платежа вместе равны стоимости комплекта, поэтому оба аукциона оплачены полностью. Какой именно платёж за какую часть —
 * значения не имеет: итог по каждому аукциону задан расчётом. Разнесение: п/п 53423 = СП 29 605 789,30 + РП 1 060 510,70;
 * п/п 70941 = РП 2 533 779,20 (РП: 1 060 510,70 + 2 533 779,20 = 3 594 289,90). Суммы платежей в целом не меняются.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-advances-sp-rp-0525.ts            # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-advances-sp-rp-0525.ts --apply    # применить (перед этим scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-advances-sp-rp-0525.ts --rollback --apply
 * Журнал: docs-inventory/corrections-journal-advances-sp-rp-0525.json
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-advances-sp-rp-0525.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const MARK = "[разнесение СП/РП 05.25, 2026-10-08]";

type Journal = {
  time: string;
  first: { id: string; before: { amount: string; auctionSession: string | null; notes: string | null; docRef: string | null } };
  second: { id: string; before: { auctionSession: string | null; notes: string | null } };
  createdId: string;
  rolledBack?: string;
};
const readJ = (): Journal | null => (existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : null);

const SP = "СП 05.25";
const RP = "РП 05.25";
const CALC_SP = 29605789.3;
const CALC_RP = 3594289.9;

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!org) throw new Error("нет организации");

    if (ROLLBACK) {
      const j = readJ();
      if (!j || j.rolledBack) { console.log("Нечего откатывать"); return; }
      if (!APPLY) { console.log("Будет откачено разнесение (добавьте --apply)"); return; }
      await prisma.$transaction([
        prisma.payment.delete({ where: { id: j.createdId } }),
        prisma.payment.update({ where: { id: j.first.id }, data: { amount: j.first.before.amount, auctionSession: j.first.before.auctionSession, notes: j.first.before.notes, docRef: j.first.before.docRef } }),
        prisma.payment.update({ where: { id: j.second.id }, data: { auctionSession: j.second.before.auctionSession, notes: j.second.before.notes } }),
      ]);
      j.rolledBack = new Date().toISOString();
      writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
      console.log("Откачено");
      return;
    }

    const first = await prisma.payment.findFirst({ where: { organizationId: org.id, docRef: { contains: "53423" }, amount: "30666300" } });
    const second = await prisma.payment.findFirst({ where: { organizationId: org.id, docRef: { contains: "70941" }, amount: "2533779.2" } });
    if (!first || !second) throw new Error("не найдены платежи п/п 53423 / 70941");
    if ((first.notes ?? "").includes(MARK)) { console.log("Уже разнесено"); return; }
    if (first.auctionSession || second.auctionSession || first.purchaseId || second.purchaseId) throw new Error("платежи уже привязаны — разнесение не нужно");

    const rpFromFirst = Math.round((30666300 - CALC_SP) * 100) / 100;
    const check = Math.round((rpFromFirst + 2533779.2) * 100) / 100;
    if (Math.abs(check - CALC_RP) > 0.005) throw new Error(`расчёт не сходится: РП ${check} ≠ ${CALC_RP}`);

    console.log(`\nРазнесение платежей 2025 по СП 05.25 / РП 05.25 (${APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН"})`);
    console.log(`  п/п 53423: ${SP} ${CALC_SP.toFixed(2)} + ${RP} ${rpFromFirst.toFixed(2)} (= 30 666 300,00)`);
    console.log(`  п/п 70941: ${RP} 2533779.20`);
    console.log(`  Итого: ${SP} ${CALC_SP.toFixed(2)}, ${RP} ${check.toFixed(2)}; Σ ${(CALC_SP + check).toFixed(2)} = УПД №143`);
    if (!APPLY) { console.log("\nПробный прогон: ничего не записано."); return; }

    const note = (txt: string) => `${MARK} ${txt}`;
    const basis = "Расчёт Василия «СП-РП 05-2025» (письмо 18.09.2025, №363): СП 05.25 = 29 605 789,30, РП 05.25 = 3 594 289,90; Σ 33 200 079,20 = УПД №143 = аванс 30 666 300 (п/п 53423) + финал 2 533 779,20 (п/п 70941). Оба аукциона оплачены полностью.";
    const created = await prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: first.id }, data: { amount: CALC_SP, auctionSession: SP, docRef: `${first.docRef ?? ""} (часть 1/2: ${SP})`, notes: `${first.notes ?? ""}\n${note(`Часть 1 из 2: ${SP} ${CALC_SP.toFixed(2)}. ${basis}`)}` } });
      const c = await tx.payment.create({
        data: {
          organizationId: org.id, supplierId: first.supplierId, amount: rpFromFirst, currency: first.currency, method: first.method, status: first.status,
          paidAt: first.paidAt, auctionSession: RP, kind: first.kind, confirmed: first.confirmed, confirmedAt: first.confirmedAt, confirmedBy: first.confirmedBy,
          docRef: `${first.docRef ?? ""} (часть 2/2: ${RP})`,
          notes: `${first.notes ?? ""}\n${note(`Часть 2 из 2: ${RP} ${rpFromFirst.toFixed(2)}. ${basis}`)}`,
        },
      });
      await tx.payment.update({ where: { id: second.id }, data: { auctionSession: RP, notes: `${second.notes ?? ""}\n${note(`Целиком на ${RP}. ${basis}`)}` } });
      return c;
    });
    writeFileSync(JOURNAL, JSON.stringify({
      time: new Date().toISOString(),
      first: { id: first.id, before: { amount: first.amount.toString(), auctionSession: first.auctionSession, notes: first.notes, docRef: first.docRef } },
      second: { id: second.id, before: { auctionSession: second.auctionSession, notes: second.notes } },
      createdId: created.id,
    } satisfies Journal, null, 1));
    console.log("\nГотово.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
