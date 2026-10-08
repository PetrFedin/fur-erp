/**
 * Факты из переписки (backup.pst, папка «мех», 392 письма, 07.02.2024 – 08.10.2026) — ТОЛЬКО то, что подтверждено документом
 * и не опровергнуто более поздним письмом. Всё остальное — предложения владельцу в docs/OPEN-QUESTIONS.md (раздел Л).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-backup-mail-facts.ts            # сухой прогон (БД не меняется, всё в транзакции с откатом)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-backup-mail-facts.ts --apply    # применить (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-backup-mail-facts.ts --rollback # откат по журналу
 *
 * Что делает:
 *  1) Заводит 4 оплаты поставщику (ООО «Веллмех»), которые есть в акте сверки ММ–Веллмех по договору №2502 на 30.06.2026
 *     (файл «баланс всех оплат мех.xlsx», приложен к письму Федин↔Коношенко 07.08.2026 «акт сверки»; «подтверждённая сверка от Веллмех
 *     на 30.06.2026» — письмо Желниной О.И. 24.07.2026 «Оплаты за меховые изделия») с п/п, датой и суммой, а в приложении их не было:
 *       70941  01.10.2025   2 533 779,20  — окончательный платёж по Спец. №4 (соболь СП 05.25 + РП 05.25), счёт №143 от 18.09.2025, УПД №143; без привязки
 *                                           (как аванс 53423 по тому же УПД: разнесение между СП и РП документом не названо)
 *       88105  24.12.2025   4 836 327,52  — СП 12.25, лоты 15316–15318, счёт №241 от 22.12.2025, УПД №283 от 30.12.2025 → З-2026-0004
 *       46963  01.06.2026   5 400 000,00  — Спец. №13 (подкладка), счёт №157 от 26.05.2026 → З-2026-0061
 *       48642  11.06.2026  85 063 078,00  — аванс 2, рысевидная кошка, Спец. №12, счёт №173 от 05.06.2026 → З-2026-0049 (FH 06.26)
 *     Письма не заменяют платёжку: основание — акт сверки (правило владельца: платёж подтверждается платёжкой/актом/п/п с датой и суммой).
 *  2) ТЗ 116 «Ремонт пальто» (П-2026-0183): дата ТЗ 07.05.2026 (шапка приложения №116, письма Василия 07.05.2026 и 06.07.2026) и заказчик
 *     ООО «Меркури Мода» (запрос и согласование Изабеллы Манги 08.04–22.04.2026, договор подряда №1605, оплата п/п 46523 от 28.05.2026 по акту сверки).
 *     Долг заказчиков не меняется: работа 218 859,97 уже разнесена платежом 46523.
 *  3) Дописывает в notes (с меткой) справочные факты из писем: подтверждения ТЗ партий (Денисюк А.В.), бобр З-2026-0063, подкладка Спец. 13 (УПД №233),
 *     AME (УПД №253), красная лиса (счёт №209), платёж 20.07.2026 (остаётся НЕподтверждённым).
 * НЕ делает: не трогает DriveDocument/PurchaseDocument, схему, суммы закупок, статусы, ТЗ, оплаты производства.
 * Безопасность: одна транзакция; долг поставщика должен измениться ровно на сумму новых оплат; долг заказчиков — не меняться.
 * Идемпотентно (метка в notes/docRef). Журнал: docs-inventory/corrections-journal-backup-mail-facts.json.
 */
import Module from "module";
import { join, resolve } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { randomBytes } from "crypto";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");
const TAG = "[письма backup 2026-10-08]";
const INV = join(resolve(__dirname, ".."), "docs-inventory");
const JOURNAL = join(INV, "corrections-journal-backup-mail-facts.json");
class DryRun extends Error {}
const cid = () => "c" + randomBytes(12).toString("hex");
const fmt = (n: number | string) => Number(n).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ru = (ymd: string) => ymd.split("-").reverse().join(".");

const ACT = "акт сверки ООО «Меркури Мода» – ООО «Веллмех» по договору №2502 от 26.02.2025 на 30.06.2026 (файл «баланс всех оплат мех.xlsx» в письме Федин↔Коношенко 07.08.2026 «акт сверки»; сверку от Веллмех на 30.06.2026 подтвердила Желнина О.И. 24.07.2026, тема «Оплаты за меховые изделия»)";

type NewPay = { pp: string; date: string; amount: string; kind: "ADVANCE" | "PARTIAL" | "FINAL"; purchase: string | null; docRef: string; text: string };
const NEW_PAYMENTS: NewPay[] = [
  { pp: "70941", date: "2025-10-01", amount: "2533779.20", kind: "FINAL", purchase: null, docRef: "счёт Веллмех №143 от 18.09.2025; УПД №143",
    text: "Окончательный платёж за шкурки соболя по Приложению №4 от 26.05.2025 (Спец. №4) к договору №2502 — комплект СП 05.25 + РП 05.25. Счёт №143 от 18.09.2025 = 2 533 779,20 (письмо Василия 18.09.2025 «Закупка соболя 2»: «Был оплачен аванс 30 666 300, к доплате 2 533 779,2»). С авансом п/п 53423 (30 666 300) = 33 200 079,20 = УПД №143 (22.09.2025); разнесение между СП 05.25 и РП 05.25 документом не названо — запись без привязки, как у аванса 53423." },
  { pp: "88105", date: "2025-12-24", amount: "4836327.52", kind: "ADVANCE", purchase: "З-2026-0004", docRef: "счёт Веллмех №241 от 22.12.2025; УПД №283 от 30.12.2025",
    text: "Соболь клеточный выделанный тонированный, лоты 15316–15318 (СП 12.25). Счёт №241 от 22.12.2025 (письмо Василия 22.12.2025 «расчет закупки + счет за закупку Союзпушнина 12-25»: «надо оплатить быстро»), УПД №283 от 30.12.2025 = 4 836 327,52." },
  { pp: "46963", date: "2026-06-01", amount: "5400000.00", kind: "ADVANCE", purchase: "З-2026-0061", docRef: "счёт Веллмех №157 от 26.05.2026",
    text: "Вспомогательные материалы (подкладочная ткань) по Спец. №13 от 26.05.2026, счёт №157 (письмо Василия 26.05.2026: «в понедельник (01.06.2026) мы планируем сделать оплату в Турцию»). Поставка проведена 24.08.2026 по УПД №233 на 5 344 405,50 — разница 55 594,50 зачтена в счёт №253 (AME)." },
  { pp: "48642", date: "2026-06-11", amount: "85063078.00", kind: "PARTIAL", purchase: "З-2026-0049", docRef: "счёт Веллмех №173 от 05.06.2026",
    text: "Аванс 2 за шкурки рысевидной кошки по Спец. №12 от 22.05.2026 (аукцион Fur Harvesters 04.06.2026). Счёт №173 от 05.06.2026 = 85 063 078,00 (письма Коношенко 09.06.2026 «Закупка рысевидной кошки»: согласовано Решетняком и Киржнером, срок оплаты — 10.06.2026). Вместе с авансом 1 (п/п 46538, счёт №155) 30 660 000 = 115 723 078,00." },
];

/** Справочные заметки (дописываются к notes с меткой). */
const BATCH_NOTES: { number: number; text: string }[] = [
  { number: 7, text: "26.12.2025 12:01 Денисюк А.В. (ММ): «Подтверждаем обновлённые ТЗ из поставки №7» (письмо «Партия 7»)." },
  { number: 8, text: "28.12.2025 15:12 Денисюк А.В. (ММ): «Подтверждаю ТЗ 84» (письмо «Партия 7»); остальные ТЗ партии 8 в письме не названы." },
  { number: 9, text: "30.01.2026 21:43 Денисюк А.В. (ММ): «Подтверждаем партию №9 с обновлённым ТЗ 94» (письмо «Партия 9»)." },
  { number: 11, text: "21.02.2026 14:24 Денисюк А.В. (ММ): «Подтверждаем все ТЗ из партии №11» (письмо «Партия 11»)." },
  { number: 12, text: "27.02.2026 18:52 Денисюк А.В. (ММ): «Подтверждаем партию №12» (письмо «Партия 12»)." },
  { number: 13, text: "05.03.2026 19:32 Денисюк А.В. (ММ): «Подтверждаем поставку №13» (письмо «Партия 13»); 06.03.2026 расчёт и счёт №71 (Василий)." },
  { number: 14, text: "01.07.2026 20:11 Денисюк А.В. (ММ): «Подтверждаем партию №14, просьба продолжить с оформлением» (письмо «Партия 14»); 03.07.2026 финальные ТЗ и счёт №121 (Василий); 16.07.2026 исправленный счёт №121 «на 30% от поставки прошлого сезона» (аванса по этим изделиям не было). Оплата письмами не подтверждена (нужна п/п)." },
  { number: 17, text: "30.06.2026 20:28 Денисюк А.В. (ММ): «Подтверждаем партию №17» (4 аксессуара, ТЗ 118); УПД МФВМ-000034 от 30.06.2026 (исправлено 01.07.2026: ошибка в цене последней позиции «Соболь»); 03.07.2026 КИЗ получены, сдача в ЦУМ; 16.07.2026 счёт №207 и расчёт доплаты (Василий). Оплата письмами не подтверждена." },
  { number: 18, text: "27.08.2026 17:24 Денисюк А.В. (ММ): «Обновленные ТЗ по партии №18 подтверждаем» (письмо «Партия 18 (ТЗ)»); 28.08.2026 финальные ТЗ 119–135 (Василий), отгрузка через ЧЗ и ЭДО; счёт №237 от 25.08.2026 = 3 397 795,00 (расчёт доплаты: работа 8 273 900 − аванс; в него входят шкуры красной лисы подрядчика 880 000 по ТЗ 121). 02.09.2026 Коношенко: «оплачен при приемке 02.09.2026», Василий в ответ: «пока оплата не поступила» — оплата не подтверждена." },
  { number: 19, text: "11.09.2026 19:05 Денисюк А.В. (ММ): «Подтверждаем все обновленные ТЗ из партии №19» (письмо «Партия 19 (41 изделие)»); 14.09.2026 УПД на продажу (Желнина), финальные ТЗ; 15.09.2026 расчёт доплаты и счёт №257 (Василий)." },
  { number: 20, text: "21.09.2026 17:24 Денисюк А.В. (ММ): «Подтверждаю ТЗ по партии №20», 17:41 — обновлённое ТЗ №160 (8 головных уборов); 22.09.2026 финальные ТЗ 152–162, расчёт доплаты и счёт №265 = 1 892 430,00 (Василий); 22.09 Коношенко: в расчёте МН05 10 ед., в ТЗ 162 — 14 ед. (вопрос без ответа в письмах); 23.09.2026 Федин: «Расчеты все ок»." },
  { number: 21, text: "24.09.2026 19:34 Денисюк А.В. (ММ): «Подтверждаю ТЗ по партии №21, прошу продолжить с отгрузкой»; 30.09 Денисюк спрашивает сроки отгрузки меха и подкладки; 01.10.2026 Желнина — документы на отгрузку сырья, Василий — финальные ТЗ 163–168, расчёт доплаты и счёт №275 (442 980,00); 01.10 Федин: «Расчёты корректные»; 02.10.2026 Коношенко: «Спасибо, отправлю в оплату» — это согласование счёта, не оплата и не приёмка готовых изделий (приёмка партии 21 в письмах не зафиксирована)." },
];
const PURCHASE_NOTES: { number: string; text: string }[] = [
  { number: "З-2026-0063", text: "Invoice Nr 1-2026 от 06.08.2026 (вложение письма «бобр», Решетняк→Василий, переслано Коношенко 07.08.2026): продавец WELLFUR LLC (= ООО «ВеллМех», ИНН 9729114877, те же реквизиты), «Client/Bill to» — YUSUFOĞULLARI TEKSTİL DERİ (Турция), валюта RUB, EXW, НДС и курс не указаны; 587 шт: чёрный 49 × 7 870, коричневый 376 × 7 870, тёмно-синий 162 × 7 070 (сумма строк 4 490 090; итог, напечатанный в инвойсе, 4 490 080). Письмо Василия 06.08.2026: бобр 7 000/7 000/6 200 ₽ = 3 979 400 + подстежки 442 372 + экспорт (брокер, декларант, логист) минимум 70 000 = 4 491 772; Решетняк 07.08.2026: «Подтверждаю». Коношенко 07.08.2026: «это бобр от Веллмеха, который купит ШАки и сошьёт нам готовое изделие». Подстежки 442 372 — отдельный счёт Веллмех №182 от 18.06.2026 (Приложение 17). Счёта на ММ, УПД и оплаты нет. Наша ли это закупка или сырьё подрядчика в цене пошива — решение владельца (Е6)." },
  { number: "З-2026-0061", text: "УПД №233 от 24.08.2026: 1 183,7 м, 5 344 405,50 с НДС (4 380 660,24 + НДС 963 745,26); поставка проведена 24.08.2026 (Желнина О.И.), расчёт «расчет за подкладку 24082026». Аванс п/п 46963 5 400 000 → разница 55 594,50 в пользу ММ зачтена в счёт №253 (AME). Закупка в приложении остаётся черновиком на 5 400 000 — привести к УПД и принять: решение владельца." },
  { number: "З-2026-0058", text: "УПД №253 от 09.09.2026 = 3 581 815,79; счёт №253 на 214 522,92 = 3 581 815,79 − авансы 761 250 − 2 466 573 − зачёт переплаты SAGA 03-26 83 875,37 − зачёт подкладки Спец. 13 55 594,50 (письмо Василия 09.09.2026: «переплаты по SAGA и подкладке учтены»). Приложение показывает остаток 353 992,79 без зачётов." },
  { number: "З-2026-0001", text: "Красная лиса (огневка): счёт №209 от 16.07.2026 = 1 408 000,00 (88 шкур × 16 000: 55 — ТЗ 121, 33 — ТЗ 158). Киржнер 17.07.2026: «заплатим 21 августа после получения товара, большие авансы не платим»; Коношенко 25.08.2026: «счет за лису мы не платили». Те же 880 000 (ТЗ 121: 5 изд. × 176 000) уже входят в расчёт доплаты партии 18 (счёт №237, 3 397 795) — при оплате обоих счетов возможна двойная оплата; решение владельца." },
];
const PAYMENT_NOTES: { match: { amount: string; date: string }; text: string }[] = [
  { match: { amount: "2380500.00", date: "2026-07-20" }, text: "Вторая запись об оплате: расчёт «Закупка ММ SAGA 03-26» (Василий, 12.08.2026): «Оплата 3 — 2 380 500 — оплачено — 20.07.2026»; счёт №253 (09.09.2026) учитывает «переплату SAGA 83 875,37». Это сведения Веллмеха, а не платёжка: п/п № нет — остаётся НЕподтверждённой." },
];

const ORDER_FIXES: { wo: string; date: string; client: string; text: string }[] = [
  { wo: "116", date: "2026-05-07", client: "ООО Меркури Мода",
    text: "ТЗ №116 «Ремонт пальто» (7 ед.): дата 07.05.2026 — по шапке приложения №116 (письмо Василия 06.07.2026 «приложение 116»); заказчик — ООО «Меркури Мода»: запрос ремонта и бюджет согласовала Изабелла Манги (MVST), 08.04–22.04.2026, договор подряда №1605, оплата по акту сверки п/п 46523 от 28.05.2026 (218 860)." },
];

type Entry = { time: string; entity: "Payment" | "Purchase" | "ProductionBatch" | "ProductionOrder"; id: string; op: "create" | "notes" | "field"; field?: string; before?: string | null; after?: string | null; label: string };
const readJournal = (): Entry[] => (existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf8")) : []);

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const { loadSupplierDebt } = await import("../src/lib/supplier-debt");
  const { loadClientDebt } = await import("../src/lib/payment-alloc");

  if (ROLLBACK) {
    const j = readJournal();
    if (!j.length) { console.log("Журнал пуст — откатывать нечего."); await prisma.$disconnect(); return; }
    let del = 0, back = 0, skipped = 0;
    await prisma.$transaction(async (tx) => {
      for (const e of [...j].reverse()) {
        if (e.op === "create") {
          const al = await tx.payment.findUnique({ where: { id: e.id }, select: { id: true } });
          if (al) { await tx.payment.delete({ where: { id: e.id } }); del++; } else skipped++;
        } else if (e.op === "field") {
          const cur = await tx.productionOrder.findUnique({ where: { id: e.id } }) as unknown as Record<string, unknown> | null;
          const curVal = cur ? (cur[e.field!] instanceof Date ? (cur[e.field!] as Date).toISOString() : cur[e.field!] ?? null) : undefined;
          if (cur && curVal === (e.after ?? null)) { await tx.productionOrder.update({ where: { id: e.id }, data: { [e.field!]: e.field === "workOrderDate" ? (e.before ? new Date(e.before) : null) : e.before ?? null } as never }); back++; } else skipped++;
        } else {
          const model = e.entity === "Purchase" ? tx.purchase : e.entity === "ProductionBatch" ? tx.productionBatch : e.entity === "ProductionOrder" ? tx.productionOrder : tx.payment;
          const cur = await (model as unknown as { findUnique: (a: unknown) => Promise<{ notes: string | null } | null> }).findUnique({ where: { id: e.id } });
          if (cur && (cur.notes ?? null) === (e.after ?? null)) { await (model as unknown as { update: (a: unknown) => Promise<unknown> }).update({ where: { id: e.id }, data: { notes: e.before ?? null } }); back++; } else skipped++;
        }
      }
    });
    console.log(`Откат: удалено оплат ${del}, notes восстановлено ${back}, пропущено ${skipped}.`);
    writeFileSync(JOURNAL.replace(".json", ".rolledback.json"), JSON.stringify(j, null, 1));
    writeFileSync(JOURNAL, "[]\n");
    await prisma.$disconnect();
    return;
  }

  const supplier = await prisma.supplier.findFirst({ where: { name: { contains: "еллмех" } } });
  if (!supplier) throw new Error("Не найден поставщик ООО «Веллмех»");
  const orgId = supplier.organizationId;
  const log: string[] = [];
  const entries: Entry[] = [];
  const problems: string[] = [];
  let backupDone = false;

  const run = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], real: boolean) => {
    const before = { s: await loadSupplierDebt(tx, orgId), c: await loadClientDebt(tx, orgId, { year: "all" }) };
    let added = 0;
    for (const n of NEW_PAYMENTS) {
      const head = `п/п №${n.pp} от ${ru(n.date)}`;
      const dup = await tx.payment.findFirst({ where: { organizationId: orgId, docRef: { startsWith: head } } });
      if (dup) { log.push(`уже есть: ${head}`); continue; }
      const same = await tx.payment.findFirst({ where: { organizationId: orgId, amount: n.amount, paidAt: new Date(`${n.date}T00:00:00.000Z`) } });
      if (same) { problems.push(`${head}: уже есть оплата на ту же сумму и дату (${same.id}) — пропуск, проверить вручную`); continue; }
      let purchaseId: string | null = null;
      if (n.purchase) {
        const p = await tx.purchase.findFirst({ where: { organizationId: orgId, number: n.purchase }, select: { id: true } });
        if (!p) { problems.push(`${head}: нет закупки ${n.purchase}`); continue; }
        purchaseId = p.id;
      }
      const id = cid();
      await tx.payment.create({
        data: {
          id, organizationId: orgId, supplierId: supplier.id, purchaseId, amount: n.amount, currency: "RUB", method: "BANK_TRANSFER", status: "COMPLETED",
          paidAt: new Date(`${n.date}T00:00:00.000Z`), kind: n.kind, confirmed: true, confirmedAt: new Date(),
          confirmedBy: `${ACT}: п/п №${n.pp} от ${ru(n.date)}, ${fmt(n.amount)} ₽`,
          docRef: `${head}; ${n.docRef}`,
          notes: `${TAG} ${n.text} Подтверждение: ${ACT}.`,
        },
      });
      entries.push({ time: new Date().toISOString(), entity: "Payment", id, op: "create", label: `${head} ${fmt(n.amount)} ${n.purchase ?? "без привязки"}` });
      added += Number(n.amount);
      log.push(`заведена: ${head} ${fmt(n.amount)} → ${n.purchase ?? "аванс без привязки"}`);
    }
    const appendNote = async (entity: Entry["entity"], id: string, label: string, text: string, cur: string | null) => {
      if ((cur ?? "").includes(`${TAG} ${text.slice(0, 40)}`)) { log.push(`заметка уже есть: ${label}`); return; }
      const after = `${cur ?? ""}${cur ? "\n" : ""}${TAG} ${text}`;
      if (entity === "Purchase") await tx.purchase.update({ where: { id }, data: { notes: after } });
      else if (entity === "ProductionBatch") await tx.productionBatch.update({ where: { id }, data: { notes: after } });
      else await tx.payment.update({ where: { id }, data: { notes: after } });
      entries.push({ time: new Date().toISOString(), entity, id, op: "notes", before: cur, after, label });
      log.push(`заметка: ${label}`);
    };
    for (const f of ORDER_FIXES) {
      const o = await tx.productionOrder.findFirst({ where: { organizationId: orgId, workOrderNumber: f.wo }, select: { id: true, number: true, workOrderDate: true, clientId: true, notes: true } });
      const cl = await tx.client.findFirst({ where: { organizationId: orgId, name: f.client }, select: { id: true } });
      if (!o || !cl) { problems.push(`ТЗ ${f.wo}: ${!o ? "нет ТЗ" : "нет заказчика"}`); continue; }
      if (o.clientId && o.clientId !== cl.id) { problems.push(`ТЗ ${f.wo}: заказчик уже другой — пропуск`); continue; }
      if (o.workOrderDate && o.workOrderDate.toISOString().slice(0, 10) !== f.date) { problems.push(`ТЗ ${f.wo}: дата уже другая (${o.workOrderDate.toISOString().slice(0, 10)}) — пропуск`); continue; }
      const data: Record<string, unknown> = {};
      if (!o.clientId) { data.clientId = cl.id; entries.push({ time: new Date().toISOString(), entity: "ProductionOrder", id: o.id, op: "field", field: "clientId", before: null, after: cl.id, label: `ТЗ ${f.wo} заказчик` }); }
      if (!o.workOrderDate) { data.workOrderDate = new Date(`${f.date}T00:00:00.000Z`); entries.push({ time: new Date().toISOString(), entity: "ProductionOrder", id: o.id, op: "field", field: "workOrderDate", before: null, after: new Date(`${f.date}T00:00:00.000Z`).toISOString(), label: `ТЗ ${f.wo} дата` }); }
      if (!(o.notes ?? "").includes(`${TAG} ТЗ №${f.wo}`)) { const after = `${o.notes ?? ""}${o.notes ? "\n" : ""}${TAG} ${f.text}`; data.notes = after; entries.push({ time: new Date().toISOString(), entity: "ProductionOrder", id: o.id, op: "notes", before: o.notes, after, label: `ТЗ ${f.wo} заметка` }); }
      if (Object.keys(data).length) { await tx.productionOrder.update({ where: { id: o.id }, data: data as never }); log.push(`ТЗ ${f.wo} (${o.number}): ${Object.keys(data).filter((k) => k !== "notes").join(", ") || "заметка"}`); }
      else log.push(`ТЗ ${f.wo}: уже сделано`);
    }
    for (const b of BATCH_NOTES) {
      const x = await tx.productionBatch.findFirst({ where: { organizationId: orgId, number: b.number }, select: { id: true, notes: true } });
      if (!x) { problems.push(`нет партии ${b.number}`); continue; }
      await appendNote("ProductionBatch", x.id, `партия ${b.number}`, b.text, x.notes);
    }
    for (const p of PURCHASE_NOTES) {
      const x = await tx.purchase.findFirst({ where: { organizationId: orgId, number: p.number }, select: { id: true, notes: true } });
      if (!x) { problems.push(`нет закупки ${p.number}`); continue; }
      await appendNote("Purchase", x.id, `закупка ${p.number}`, p.text, x.notes);
    }
    for (const p of PAYMENT_NOTES) {
      const x = await tx.payment.findMany({ where: { organizationId: orgId, amount: p.match.amount, paidAt: new Date(`${p.match.date}T00:00:00.000Z`) }, select: { id: true, notes: true } });
      if (x.length !== 1) { problems.push(`оплата ${p.match.amount} ${p.match.date}: найдено ${x.length}`); continue; }
      await appendNote("Payment", x[0].id, `оплата ${fmt(p.match.amount)} от ${ru(p.match.date)}`, p.text, x[0].notes);
    }
    const after = { s: await loadSupplierDebt(tx, orgId), c: await loadClientDebt(tx, orgId, { year: "all" }) };
    const dS = Number(before.s.debt) - Number(after.s.debt);
    if (Math.abs(dS - added) > 0.005) problems.push(`долг поставщику изменился на ${fmt(dS)}, ожидалось ${fmt(added)}`);
    if (Math.abs(Number(before.c.balance) - Number(after.c.balance)) > 0.005) problems.push("долг заказчиков изменился");
    return { before, after, added };
  };

  type Res = Awaited<ReturnType<typeof run>>;
  let res: Res | null = null;
  try {
    await prisma.$transaction(async (tx) => { res = await run(tx, false); throw new DryRun(); }, { timeout: 180000, maxWait: 30000 });
  } catch (e) { if (!(e instanceof DryRun)) throw e; }
  const r = res as unknown as Res;
  console.log(APPLY ? "== APPLY (проверочный прогон) ==" : "== DRY-RUN ==");
  for (const l of log) console.log("  " + l);
  console.log(`Долг поставщику: ${fmt(Number(r.before.s.debt))} → ${fmt(Number(r.after.s.debt))} (Δ ${fmt(Number(r.before.s.debt) - Number(r.after.s.debt))}; ожидалось ${fmt(r.added)})`);
  console.log(`  к оплате по УПД и счетам: ${fmt(Number(r.before.s.receivedNet))} → ${fmt(Number(r.after.s.receivedNet))}; счёт выставлен: ${fmt(Number(r.before.s.invoiced))} → ${fmt(Number(r.after.s.invoiced))}; ожидаемое: ${fmt(Number(r.before.s.expected))} → ${fmt(Number(r.after.s.expected))}; авансы без привязки: ${fmt(Number(r.before.s.unlinkedAdvances))} → ${fmt(Number(r.after.s.unlinkedAdvances))}`);
  console.log(`Долг заказчиков (работа − оплаты): ${fmt(Number(r.before.c.balance))} → ${fmt(Number(r.after.c.balance))}`);
  if (problems.length) console.log("ПРОБЛЕМЫ:\n  " + problems.join("\n  "));
  if (!APPLY) { console.log("Сухой прогон: БД не изменена. Для применения: --apply"); await prisma.$disconnect(); return; }
  if (problems.length) throw new Error("есть проблемы — apply остановлен");
  if (!entries.length) { console.log("Нечего применять (идемпотентно)."); await prisma.$disconnect(); return; }

  if (!NO_BACKUP && !backupDone) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); backupDone = true; }
  entries.length = 0; log.length = 0; problems.length = 0;
  await prisma.$transaction(async (tx) => {
    const r2 = await run(tx, true);
    if (problems.length) throw new Error(problems.join("; "));
    void r2;
  }, { timeout: 180000, maxWait: 30000 });
  const journal = readJournal().concat(entries);
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 1) + "\n");
  console.log(`Применено: оплат ${entries.filter((e) => e.op === "create").length}, заметок ${entries.filter((e) => e.op === "notes").length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
