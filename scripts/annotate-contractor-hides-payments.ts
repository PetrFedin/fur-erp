/**
 * Партии 5, 6, 7: «переплата» (4 584 500 / 463 750 / 1 117 466 ₽ в карточке партии) — это шкуры ПОДРЯДЧИКА, включённые в
 * платёж доплаты (смешанный платёж «работа + материал − аванс 70%»). Скрипт пишет понятную разбивку в
 * ProductionPayment.docRef (видна в карточке партии) и ProductionPayment.notes. Суммы не меняются.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/annotate-contractor-hides-payments.ts            # DRY-RUN
 *   node --env-file=.env node_modules/.bin/tsx scripts/annotate-contractor-hides-payments.ts --apply    # (до этого scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/annotate-contractor-hides-payments.ts --rollback docs-inventory/corrections-journal-overpayments.json
 * Идемпотентно (маркер в notes). Расчёты: docs-inventory/overpayments-check.md.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const JOURNAL = join(resolve(__dirname, ".."), "docs-inventory", "corrections-journal-overpayments.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const rb = args.indexOf("--rollback");
const MARK = "[разбивка платежа: шкуры подрядчика 2026-10-04]";

const T: { id: string; batch: number; docRefAdd: string; note: string }[] = [
  {
    id: "cmupo4c162a6f1fbc5f3be2a53b", batch: 5,
    docRefAdd: "в т.ч. шкуры подрядчика 4 584 500 ₽ (свакара, 346 шк.) по счёту №235",
    note: `${MARK} Платёж по счёту №235 = работа партии 5 (3 540 220) + шкуры подрядчика 4 584 500 (НДС 20%, закупка З-2026-0010) − аванс 70% (2 455 600) = 5 669 120. Всего оплачено по партии 8 124 720 = работа + шкуры; переплаты заказчика нет (баланс 040226: «расчёт партии 5 (включая шкуры)» 8 124 720). Основание использования сырья подрядчика — письмо Решетняка 10.12.2025, согласовано 15.12.2025.`,
  },
  {
    id: "cmupo4c163595ccdb639a956863", batch: 6,
    docRefAdd: "в т.ч. шкуры подрядчика 463 750 ₽ (свакара фондю ТЗ 61, 35 шк.) по счёту №239",
    note: `${MARK} Платёж по счёту №239 = работа партии 6 (1 597 870) + шкуры подрядчика 463 750 (НДС 20%, закупка З-2026-0011) − аванс 70% (1 114 750) = 946 870. Всего оплачено по партии 2 061 620 = работа + шкуры; переплаты заказчика нет (баланс 040226: «отгрузка 2 061 620, включая шкуры и аксессуары»).`,
  },
  {
    id: "cmupo4c16a6497a23dcd2bb7937", batch: 7,
    docRefAdd: "в т.ч. шкуры подрядчика 1 117 464 ₽ по счёту №1",
    note: `${MARK} Платёж по счёту №1 = работа партии 7 (3 030 324) + шкуры подрядчика 1 117 464 (НДС 22%; из них свакара фондю ТЗ 79 — 952 540, остальное — мелкие шкуры по ТЗ 70–83; закупка З-2026-0012 покрывает 927 500) − аванс (по расчёту 2 066 400; в счёте №1 учтено 2 072 665, +6 265) = 2 075 122,54 (письмо: 2 081 387,54). Всего оплачено по партии 4 147 787,54 = работа + шкуры (баланс 040226: «отгрузка 4 147 787,54»); переплаты заказчика нет.`,
  },
];

async function main() {
  if (rb >= 0) {
    const j = JSON.parse(readFileSync(args[rb + 1], "utf8")).changes as { id: string; docRefBefore: string | null; notesBefore: string | null; docRefAfter: string; notesAfter: string }[];
    for (const c of j) {
      const p = await prisma.productionPayment.findUnique({ where: { id: c.id } });
      if (!p || p.notes !== c.notesAfter || p.docRef !== c.docRefAfter) { console.log("пропуск", c.id); continue; }
      await prisma.productionPayment.update({ where: { id: c.id }, data: { docRef: c.docRefBefore, notes: c.notesBefore } });
      console.log("откат", c.id);
    }
    return;
  }
  console.log(APPLY ? "ПРИМЕНЕНИЕ" : "DRY-RUN");
  const changes: { id: string; batch: number; docRefBefore: string | null; notesBefore: string | null; docRefAfter: string; notesAfter: string }[] = [];
  for (const t of T) {
    const p = await prisma.productionPayment.findUnique({ where: { id: t.id } });
    if (!p) { console.log("нет платежа", t.id); continue; }
    if (p.notes?.includes(MARK)) continue;
    const docRefAfter = `${(p.docRef ?? "").trim()} · ${t.docRefAdd}`.replace(/^ · /, "");
    const notesAfter = `${p.notes ? p.notes + "\n" : ""}${t.note}`;
    console.log(`партия ${t.batch}: сумма ${p.amount} не меняется; docRef → «${docRefAfter}»`);
    changes.push({ id: t.id, batch: t.batch, docRefBefore: p.docRef, notesBefore: p.notes, docRefAfter, notesAfter });
  }
  if (APPLY && changes.length) {
    const prev = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")).changes : [];
    for (const c of changes) await prisma.productionPayment.update({ where: { id: c.id }, data: { docRef: c.docRefAfter, notes: c.notesAfter } });
    writeFileSync(JOURNAL, JSON.stringify({ script: "annotate-contractor-hides-payments.ts", time: new Date().toISOString(), changes: [...prev, ...changes] }, null, 1));
    console.log("ГОТОВО. Журнал", JOURNAL);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
