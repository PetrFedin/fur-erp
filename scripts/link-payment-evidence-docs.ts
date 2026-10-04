/**
 * Документы-основания платежей (DriveDocument ↔ Payment) и пометка по закупке AME З-2026-0058.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-payment-evidence-docs.ts            # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-payment-evidence-docs.ts --apply    # после scripts/backup.sh
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-payment-evidence-docs.ts --rollback
 *
 * Банковских выписок и платёжек ООО «Меркури Мода» в Drive нет (в «выписках» только ИП Янина, «Салон Юлия Янина», «Декор» — другие
 * юрлица, не используются). Привязывается то, что в самих документах называет платёж:
 *  - УПД №96 от 15.07.2025 (xlsx+pdf), п.(5): «53423 от 27.06.2025» -> платёж 2 000 000 по счёту №96 (дата платежа в БД не меняется);
 *  - УПД №253 от 09.09.2026 (xlsx+pdf), п.(5): «46538 от 28.05.2026» -> платёж 761 250 (аванс 1 AME);
 *  - «расчёт себестоимости fin.xlsx» («оплачен 28.05.2026», «п-п аванс 2 … 6/4/2026») -> платежи 761 250 и 2 466 573.
 * confirmed / paidAt / docRef не меняются. З-2026-0058: количество 371 шт подтверждено УПД №253 и счётом №253 (376 — план), в notes
 * дописывается пометка [docs:ame-371]. Журнал: docs-inventory/corrections-journal-payment-evidence.json
 */
import { join } from "path";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const JOURNAL = join(INV, "corrections-journal-payment-evidence.json");
const newId = () => "c" + Date.now().toString(36) + randomBytes(9).toString("hex");

const PAY_ID = {
  p2000000: "cmupnzwk9000plsvqkvluccyp", // п/п (53423 по УПД) счёт №96, 2 000 000
  p761250: "cmupnzwne0019lsvq0j1tjh75", // п/п №46538 от 28.05.2026
  p2466573: "cmupnzwnl001blsvqs7j46d58", // аванс 2 AME, 04.06.2026 (не подтверждён)
};
const LINKS: Array<{ file: string; pay: string; note: string }> = [
  { file: "1YjnZHOTGdthB_blw9RnNTdYaAwyk6Jh8", pay: PAY_ID.p2000000, note: "УПД №96 от 15.07.2025, п.(5): «К платежно-расчётному документу № 53423 от 27.06.2025». Банковской выписки нет; реестр называет п/п 56327 от 15.07.2025 (= дата УПД) — расхождение не снято." },
  { file: "1LT26CRbe9B4dJ5oCezEyklFEzgPTISNd", pay: PAY_ID.p2000000, note: "УПД №96 от 15.07.2025 (pdf), п.(5): 53423 от 27.06.2025. Банковской выписки нет." },
  { file: "1qx4qR_1NuTKUi4rGfja_N8uv1mFbzaMH", pay: PAY_ID.p761250, note: "УПД №253 от 09.09.2026, п.(5): «К платежно-расчётному документу № 46538 от 28.05.2026» — документальное основание номера и даты п/п." },
  { file: "1AtV0oDZIhQnHhkpDe6kdJ8_TOw5BJqPv", pay: PAY_ID.p761250, note: "УПД №253 от 09.09.2026 (pdf), п.(5): п/п 46538 от 28.05.2026." },
  { file: "1YTcVqkvWlIvO0YPnIqCO-fJ1S9tFazl9", pay: PAY_ID.p761250, note: "Расчёт себестоимости fin: «аванс 25% от молотка 761 250 — оплачен 28.05.2026»." },
  { file: "1YTcVqkvWlIvO0YPnIqCO-fJ1S9tFazl9", pay: PAY_ID.p2466573, note: "Расчёт себестоимости fin: «п-п аванс 2 — 2 466 573 — 6/4/2026» (формат М/Д/Г = 04.06.2026). Платёжки нет — платёж остаётся неподтверждённым." },
];
const AME_PURCHASE = "З-2026-0058";
const AME_MARK = "[docs:ame-371]";
const AME_NOTE = `${AME_MARK} Количество 371 шт подтверждено УПД №253 от 09.09.2026 (371 × 7 913,52 без НДС = 2 935 914,58; НДС 22% 645 901,21; итого 3 581 815,79) и письмом 09–16.09.2026 «Спецификация 11 норка махагон 371 шт. (376 шт.)» (просьба оплатить счёт №253 на 214 522,92 «в количестве 371 шт.»). 376 шт — плановое количество предварительного расчёта (расчёт себестоимости fin, блок «план»/колонка quantity; Спец. №11 от 21.05.2026 — 400 шт ориентировочно). Инвойс AME (invoice MVST.pdf) в Drive нечитаем (пустой текст).`;

type J = { docs: string[]; purchase?: { id: string; oldNotes: string | null } };

async function rollback() {
  const j = readJson<J>(JOURNAL, { docs: [] });
  await prisma.driveDocument.deleteMany({ where: { id: { in: j.docs } } });
  if (j.purchase) await prisma.purchase.update({ where: { id: j.purchase.id }, data: { notes: j.purchase.oldNotes } });
  console.log(`Откат: удалено привязок ${j.docs.length}${j.purchase ? ", notes закупки восстановлены" : ""}`);
  writeJson(JOURNAL, { script: "link-payment-evidence-docs.ts", rolledBackAt: new Date().toISOString(), docs: [] });
}

async function main() {
  if (process.argv.includes("--rollback")) return rollback();
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN ==");
  const prev = readJson<J>(JOURNAL, { docs: [] });
  const journal: J = { docs: [...prev.docs], purchase: prev.purchase };
  for (const l of LINKS) {
    const src = await prisma.driveDocument.findFirst({ where: { driveFileId: l.file }, orderBy: { createdAt: "asc" } });
    if (!src) { console.log(`! нет DriveDocument для файла ${l.file}`); continue; }
    const pay = await prisma.payment.findUnique({ where: { id: l.pay } });
    if (!pay) { console.log(`! нет платежа ${l.pay}`); continue; }
    const exists = await prisma.driveDocument.findFirst({ where: { driveFileId: l.file, paymentId: l.pay } });
    if (exists) { console.log(`= уже: ${src.title} -> ${pay.amount}`); continue; }
    console.log(`+ ${src.title} -> платёж ${pay.amount} (${pay.paidAt.toISOString().slice(0, 10)})`);
    if (APPLY) {
      const { id: _id, createdAt: _c, purchaseId: _p, lotId: _l, productionOrderId: _o, productionBatchId: _b, productionPaymentId: _pp, clientId: _cl, supplierId: _s, ...rest } = src;
      const id = newId();
      await prisma.driveDocument.create({ data: { ...rest, id, paymentId: l.pay, notes: l.note } });
      journal.docs.push(id);
      writeJson(JOURNAL, { script: "link-payment-evidence-docs.ts", appliedAt: new Date().toISOString(), ...journal });
    }
  }
  const p = await prisma.purchase.findFirst({ where: { number: AME_PURCHASE } });
  if (p && !(p.notes ?? "").includes(AME_MARK)) {
    console.log(`+ notes ${AME_PURCHASE}: ${AME_NOTE.slice(0, 100)}…`);
    if (APPLY) {
      journal.purchase = { id: p.id, oldNotes: p.notes };
      await prisma.purchase.update({ where: { id: p.id }, data: { notes: (p.notes ? p.notes + "\n" : "") + AME_NOTE } });
      writeJson(JOURNAL, { script: "link-payment-evidence-docs.ts", appliedAt: new Date().toISOString(), ...journal });
    }
  } else console.log(`= notes ${AME_PURCHASE}: уже/нет закупки`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
