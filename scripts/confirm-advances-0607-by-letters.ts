/**
 * Подтверждение двух авансов от 06.07.2026 по письмам (решение владельца 09.10.2026: «в письмах есть, что оплачено — значит есть»).
 *  • 11 860 870 ₽ — аванс 70 % по счёту №141 от 15.05.2026 (82 изделия «в работе»);
 *  • 3 230 780 ₽ — аванс 70 % по счёту №143 от 15.05.2026 (аксессуары).
 * Основание: письмо Василия (Веллмех) 01.09.2026 «аванс за пошив» — «Аванс 1 … 11 860 870 руб, дата оплаты 06 07 2026; Аванс 1.1 … 3 230 780 руб, дата оплаты 06 07 2026. Все верно»;
 * письмо Коношенко Е. А. 01.09.2026 с тем же перечнем. Платёжки (п/п) нет. Суммы, даты, привязки не меняются.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/confirm-advances-0607-by-letters.ts            # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/confirm-advances-0607-by-letters.ts --apply    # применить (перед этим scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/confirm-advances-0607-by-letters.ts --rollback --apply
 * Журнал: docs-inventory/corrections-journal-confirm-advances-0607.json
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-confirm-advances-0607.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const BASIS = "письма Василия (Веллмех) и Коношенко Е. А. 01.09.2026 «аванс за пошив»: аванс оплачен 06.07.2026, «Все верно»; платёжки (п/п) нет";
const AMOUNTS = ["11860870", "3230780"];

type Entry = { id: string; amount: string; before: { confirmed: boolean; confirmedAt: string | null; confirmedBy: string | null }; rolledBack?: string };
const read = (): Entry[] => (existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : []);

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!org) throw new Error("нет организации");
    if (ROLLBACK) {
      const j = read(); let n = 0;
      for (const e of j) {
        if (e.rolledBack) continue;
        if (APPLY) { await prisma.productionPayment.update({ where: { id: e.id }, data: { confirmed: e.before.confirmed, confirmedAt: e.before.confirmedAt ? new Date(e.before.confirmedAt) : null, confirmedBy: e.before.confirmedBy } }); e.rolledBack = new Date().toISOString(); }
        n++;
      }
      if (APPLY) writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
      console.log(`${APPLY ? "Откачено" : "Будет откачено (добавьте --apply)"}: ${n}`);
      return;
    }
    const pays = await prisma.productionPayment.findMany({ where: { organizationId: org.id, paidAt: new Date("2026-07-06T00:00:00Z"), amount: { in: AMOUNTS } } });
    if (pays.length !== 2) throw new Error(`ожидалось 2 платежа, найдено ${pays.length}`);
    console.log(`Подтверждение авансов 06.07.2026 по письмам (${APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН"})`);
    for (const p of pays) console.log(`  ${p.amount.toString()} ₽ · ${p.docRef} · сейчас ${p.confirmedAt ? "подтверждена" : "не подтверждена"}`);
    if (!APPLY) return;
    const j = read();
    for (const p of pays) {
      if (p.confirmedAt) continue;
      j.push({ id: p.id, amount: p.amount.toString(), before: { confirmed: p.confirmed, confirmedAt: null, confirmedBy: p.confirmedBy } });
      await prisma.productionPayment.update({ where: { id: p.id }, data: { confirmed: true, confirmedAt: new Date(), confirmedBy: BASIS } });
      writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
    }
    console.log("Готово");
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
