/**
 * Факты из переписки (backup.pst) по ТЗ 116 и ТЗ 117 — то, что «Что не заведено» считает пробелом, а письма закрывают:
 *  • ТЗ 116 «Ремонт пальто» (П-2026-0183): номер договора пуст → «№ 1605 от 16.05.2025». Основание: оплата работы 218 860 ₽
 *    (п/п 46523 от 28.05.2026, счёт №135 от 07.05.2026) стоит в акте сверки ММ–Веллмех по договору подряда №1605 (на 30.06.2026).
 *  • ТЗ 116 и ТЗ 117: «партия не указана» — это не пробел. Письмо Коношенко Е. А. 10.07.2026 (письмо №135 архива, ответ на
 *    «проверка ТЗ 113–118»): «ТЗ 117 — отдельная поставка — индивидуальный пошив кейпа; ТЗ 118 — поставка 17; ТЗ 116 — только
 *    переделка без партии». В заметки ТЗ дописывается пометка (с меткой источника), партия НЕ присваивается.
 * Даты ТЗ, суммы, оплаты, статусы не меняются.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-mail-tz116-117.ts            # пробный прогон (ничего не пишет)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-mail-tz116-117.ts --apply    # применить (перед этим scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-mail-tz116-117.ts --rollback --apply
 * Идемпотентно (метка в notes). Журнал: docs-inventory/corrections-journal-mail-tz116-117.json
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-mail-tz116-117.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const MARK = "[письма backup 2026-10-08, ТЗ 116/117]";

type Entry = { time: string; id: string; number: string; before: { contractNumber: string | null; notes: string | null }; after: { contractNumber: string | null; notes: string }; rolledBack?: string };
const readJournal = (): Entry[] => (existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : []);
const writeJournal = (e: Entry[]) => writeFileSync(JOURNAL, JSON.stringify(e, null, 1));

const PLAN: { number: string; contract?: string; note: string }[] = [
  {
    number: "П-2026-0183",
    contract: "№ 1605 от 16.05.2025",
    note: `${MARK} ТЗ 116 — только переделка, без партии (Коношенко → Федин, 10.07.2026, письмо №135). Договор подряда №1605: оплата работы 218 860 ₽ (п/п 46523 от 28.05.2026) значится в акте сверки по №1605 на 30.06.2026.`,
  },
  {
    number: "П-2026-0122",
    note: `${MARK} ТЗ 117 — отдельная поставка, индивидуальный пошив кейпа, в партию не входит (Коношенко → Федин, 10.07.2026, письмо №135).`,
  },
];

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!org) throw new Error("нет организации");

    if (ROLLBACK) {
      const journal = readJournal();
      let n = 0;
      for (const e of journal) {
        if (e.rolledBack) continue;
        const cur = await prisma.productionOrder.findUnique({ where: { id: e.id }, select: { notes: true, contractNumber: true } });
        if (!cur || cur.notes !== e.after.notes) { e.rolledBack = `${new Date().toISOString()} (уже изменено — пропущено)`; continue; }
        if (APPLY) {
          await prisma.productionOrder.update({ where: { id: e.id }, data: { notes: e.before.notes, contractNumber: e.before.contractNumber } });
          e.rolledBack = new Date().toISOString();
        }
        n++;
      }
      if (APPLY) writeJournal(journal);
      console.log(`${APPLY ? "Откачено" : "Будет откачено (добавьте --apply)"}: ${n}`);
      return;
    }

    console.log(`\nФакты из переписки: ТЗ 116 и 117 (${APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН"})`);
    const journal = readJournal();
    for (const p of PLAN) {
      const o = await prisma.productionOrder.findFirst({ where: { organizationId: org.id, number: p.number }, select: { id: true, notes: true, contractNumber: true } });
      if (!o) { console.log(`  ✗ ${p.number}: нет в базе`); continue; }
      const hasNote = (o.notes ?? "").includes(MARK);
      const needContract = !!p.contract && !o.contractNumber;
      if (hasNote && !needContract) { console.log(`  = ${p.number}: уже есть`); continue; }
      console.log(`  ✓ ${p.number}: ${needContract ? `номер договора «${p.contract}»; ` : ""}${hasNote ? "" : "заметка о партии"}`);
      if (!APPLY) continue;
      const notes = hasNote ? o.notes! : (o.notes ? o.notes + "\n" : "") + p.note;
      const contractNumber = needContract ? p.contract! : o.contractNumber;
      await prisma.productionOrder.update({ where: { id: o.id }, data: { notes, contractNumber } });
      journal.push({ time: new Date().toISOString(), id: o.id, number: p.number, before: { contractNumber: o.contractNumber, notes: o.notes }, after: { contractNumber, notes } });
      writeJournal(journal);
    }
    if (!APPLY) console.log("\nПробный прогон: ничего не записано.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
