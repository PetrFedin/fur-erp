/**
 * Ответы на открытые вопросы по документам (письма архива «мех», Drive) — 14.10.2026. Ставится только то, что документы
 * подтверждают однозначно; остальное в отчёт, не в базу.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/answer-open-questions-2026-10-14.ts [--apply] [--rollback]
 * Пробный прогон по умолчанию; --apply: scripts/backup.sh, журнал docs-inventory/corrections-journal-answer-open-questions-2026-10-14.json
 * (до/после по каждой записи). --rollback (с --apply) возвращает «до» и удаляет созданное этим скриптом.
 *
 * 1. Оплата …14c996 (п/п 82173, зачёт аванса по счёту №209): invoiceNo=209, ppNo=82173. Основание: docRef оплаты «п/п №82173 от 27.11.2025 (аванс по
 *    счёту №209)»; пять оплат производства той же п/п (ProductionPayment) уже имеют 209 / 82173 из акта сверки на 30.06.2026. «Зачёт в счёте №7» остаётся в docRef.
 * 2. ТЗ 118 (П-2026-0123…0126): дата выпуска 03.07.2026 — письмо Коношенко → Киржнер 12.08.2026 («срочная поставка 03.07.2026»; Киржнер: «Ок. Это можно доплатить»);
 *    цвета строк подтверждены приложением ТЗ 118 (письмо 16.07.2026): С-Бежевый / Бежевый / Черный / Коричневый. Лот 15316: «Стоимость молоток за ед в т.ч. НДС»
 *    была суммой лота (1 354 109,29), стала ценой шкуры 24 009,03 × 1,2 = 28 810,84 (300 $ × 80,0301 = 24 009,03; 47 шт. × 24 009,03 = 1 128 424,41 — строка лота).
 * 3. Категории моделей: М040, М054 → Пальто (письма/таблицы Веллмех «пальто»; в каталоге «Шуба удлиненная» — так же, как у М002/М011А/М026/М039, у которых по ТЗ «Пальто»);
 *    М047 → Шуба / полушубок («Шуба укороченная» в расчёте LYNX MVST FW26 — дословно псевдоним категории); MCF-02 → Манжеты (каталог FW26/27: MCF-01 «Манжеты»).
 * 4. Решения владельца: saga-overpay → confirm; markup-vat → incl.
 * 5. Документы к оплате №253 (214 522,92): письмо Веллмех 09.09.2026 и «расчет себестоимости fin.xlsx» (только ссылки на Drive-файлы, содержимое не копируется).
 */
import "./stubs/server-only-shim";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DECISIONS, DECISION_KEY_PREFIX } from "../src/lib/task-docs-catalog";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const SCRIPT = "answer-open-questions-2026-10-14";
const JOURNAL = path.join(__dirname, `../docs-inventory/corrections-journal-${SCRIPT}.json`);
const WHO = `по документам (скрипт ${SCRIPT})`;

type Entry =
  | { kind: "update"; model: string; id: string; label: string; before: Record<string, unknown>; after: Record<string, unknown> }
  | { kind: "create"; model: "driveDocument"; id: string; label: string }
  | { kind: "state"; key: string; at: string; label: string };

const ANSWERS: Record<string, { choice: string; note: string }> = {
  "saga-overpay": {
    choice: "confirm",
    note: "Письмо Веллмех 09.09.2026 13:46 (счёт №253, спец. 11): «переплаты по SAGA и подкладке учтены». «расчет себестоимости fin.xlsx»: «переплата SAGA 03-26» −83 875,37 и «переплата подкладка» −55 594,50; 353 992,79 − 139 469,87 = 214 522,92 = счёт №253 к оплате. Сумма в документе 83 875,37 (в заголовке вопроса …,32).",
  },
  "markup-vat": {
    choice: "incl",
    note: "Каталог MVST FW26/27 (06.02.2026): «Розн.цена ₽» = розничная цена ЦУМ, совпадает с ProductModel.sellingPrice (М031 3 460 000). Расчёт LYNX MVST FW26 (02.06.2026): «Без НДС при реализации» = Retail × 0,78, т.е. розничная цена в расчётах — с НДС 22%.",
  },
};

const CATS: Array<[string, string, string]> = [
  ["М040", "Пальто", "«пальто» в «Расчёте стоимости пошива ММ FW26», «расчёт взятых в работу изделий 01072026», «в работе на 01.09.2026»; письмо ЦУМ 27.05.2026 «М040 — самое дорогое пальто из соболя в роспуск»"],
  ["М054", "Пальто", "«пальто» в «Расчёте стоимости пошива ММ FW26», «расчёт взятых в работу изделий 01072026», «производство 22092026»"],
  ["M047", "Шуба / полушубок", "«Шуба укороченная» в расчёте LYNX MVST FW26 (02.06.2026) и отчёте по меху 08.06.2026"],
  ["MCF-02", "Манжеты", "каталог MVST FW26/27: MCF-01 «Манжеты»; серия MCF — манжеты (файл АРТИКУЛА.xlsx)"],
];

const TZ118 = [
  { n: "П-2026-0123", color: "С-Бежевый" },
  { n: "П-2026-0124", color: "Бежевый" },
  { n: "П-2026-0125", color: "Черный" },
  { n: "П-2026-0126", color: "Коричневый" },
];
const OLD_DATE_SENTENCE = "Дата выпуска не подтверждена, ждёт ручной проверки; по документам вероятна 03.07.2026.";
const NEW_DATE_SENTENCE = "Дата выпуска 03.07.2026 (срочная поставка, партия 17) — письмо Коношенко → Киржнеру 12.08.2026 15:11 («срочная поставка 03.07.2026», аванс оплачен 06.07.2026), доплату согласовал Киржнер («Ок. Это можно доплатить»).";

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient(`script:${SCRIPT}`);
  const org = await prisma.organization.findFirstOrThrow();
  const j: (Entry & { rolledBack?: boolean })[] = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : [];
  const save = () => writeFileSync(JOURNAL, JSON.stringify(j, null, 1));

  if (ROLLBACK) {
    for (const e of [...j].reverse()) {
      if (e.rolledBack) continue;
      console.log("вернуть:", e.label);
      if (!APPLY) continue;
      if (e.kind === "update") await (prisma[e.model as "payment"] as unknown as { update: (a: unknown) => Promise<unknown> }).update({ where: { id: e.id }, data: e.before });
      else if (e.kind === "create") await prisma.driveDocument.deleteMany({ where: { id: e.id } });
      else {
        const cur = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: org.id, key: e.key } } });
        if (cur && (cur.value as { at?: string }).at === e.at) await prisma.systemState.delete({ where: { organizationId_key: { organizationId: org.id, key: e.key } } });
      }
      e.rolledBack = true;
      save();
    }
    if (!APPLY) console.log("пробный прогон (добавьте --apply)");
    return;
  }

  const plan: Array<{ label: string; run: () => Promise<Entry> }> = [];

  // 1. оплата …14c996
  const pay = await prisma.payment.findFirst({ where: { id: { endsWith: "14c996" } } });
  if (!pay) throw new Error("нет оплаты …14c996");
  if (pay.invoiceNo || pay.ppNo) console.log("оплата …14c996 уже заполнена, пропуск");
  else if (!/п\/п №82173/.test(pay.docRef ?? "") || !/счёту №209/.test(pay.docRef ?? "")) throw new Error("основание оплаты изменилось");
  else plan.push({
    label: `Payment …14c996: invoiceNo=209, ppNo=82173`,
    run: async () => {
      await prisma.payment.update({ where: { id: pay.id }, data: { invoiceNo: "209", ppNo: "82173" } });
      return { kind: "update", model: "payment", id: pay.id, label: "Payment …14c996 invoiceNo/ppNo", before: { invoiceNo: null, ppNo: null }, after: { invoiceNo: "209", ppNo: "82173" } };
    },
  });

  // 2a. ТЗ 118
  for (const t of TZ118) {
    const o = await prisma.productionOrder.findFirst({ where: { number: t.n } });
    if (!o) throw new Error(`нет ТЗ ${t.n}`);
    if (o.endDate) { console.log(`${t.n}: дата выпуска уже есть, пропуск`); continue; }
    if (!(o.notes ?? "").includes(OLD_DATE_SENTENCE)) throw new Error(`${t.n}: текст примечания изменился`);
    const notes = `${(o.notes ?? "").replace(OLD_DATE_SENTENCE, NEW_DATE_SENTENCE)} Цвет «${t.color}» подтверждён приложением ТЗ 118 (письмо Веллмех 16.07.2026).`;
    plan.push({
      label: `${t.n}: дата выпуска 03.07.2026, примечание`,
      run: async () => {
        const endDate = new Date("2026-07-03T00:00:00.000Z");
        await prisma.productionOrder.update({ where: { id: o.id }, data: { endDate, notes } });
        return { kind: "update", model: "productionOrder", id: o.id, label: `${t.n} endDate/notes`, before: { endDate: null, notes: o.notes }, after: { endDate: endDate.toISOString(), notes } };
      },
    });
  }

  // 2b. лот 15316
  const lot = await prisma.rawMaterialLot.findFirst({ where: { lotNumber: "15316" } });
  if (!lot) throw new Error("нет лота 15316");
  const bd = lot.costBreakdown as { items: { label: string; value: number }[] } | null;
  const row = bd?.items.find((i) => i.label === "Стоимость молоток за ед в т.ч. НДС");
  const excl = bd?.items.find((i) => i.label === "Стоимость молоток за ед без НДС")?.value;
  const lotSum = bd?.items.find((i) => i.label === "Стоимость молоток ЛОТ без НДС")?.value;
  if (!bd || !row || !excl || !lotSum) throw new Error("расчёт лота 15316 изменился");
  const right = Math.round(excl * 1.2 * 1000) / 1000;
  if (Math.abs(row.value - lotSum * 1.2) > 0.01) console.log(`лот 15316: «молоток с НДС» уже не равен сумме лота (${row.value}), пропуск`);
  else if (Math.abs(excl * Number(lot.quantityReceived) - lotSum) > 0.05) throw new Error("лот 15316: 47 × молоток ≠ сумма лота");
  else plan.push({
    label: `лот 15316: «молоток за ед в т.ч. НДС» ${row.value} → ${right}`,
    run: async () => {
      const next = { ...bd, items: bd.items.map((i) => (i === row ? { ...i, value: right } : i)) };
      await prisma.rawMaterialLot.update({ where: { id: lot.id }, data: { costBreakdown: next as never } });
      return { kind: "update", model: "rawMaterialLot", id: lot.id, label: "лот 15316 costBreakdown", before: { costBreakdown: bd }, after: { costBreakdown: next } };
    },
  });

  // 3. категории
  for (const [name, cat, basis] of CATS) {
    const m = await prisma.productModel.findFirst({ where: { name } });
    const ref = await prisma.categoryRef.findFirst({ where: { name: cat } });
    if (!m || !ref) throw new Error(`нет модели/категории ${name}/${cat}`);
    if (m.categoryRefId) { console.log(`${name}: категория уже есть, пропуск`); continue; }
    plan.push({
      label: `${name} → ${cat}  (${basis})`,
      run: async () => {
        await prisma.productModel.update({ where: { id: m.id }, data: { category: ref.name, categoryRefId: ref.id } });
        return { kind: "update", model: "productModel", id: m.id, label: `${name} категория`, before: { category: m.category, categoryRefId: m.categoryRefId }, after: { category: ref.name, categoryRefId: ref.id } };
      },
    });
  }

  // 5. документы к оплате №253
  const pay253 = await prisma.payment.findFirst({ where: { amount: "214522.92", invoiceNo: "253" } });
  if (!pay253) throw new Error("нет оплаты 214 522,92");
  const LETTER = "17Vfav01-z4GYLtZITdxK3TDy_ctFTzbh";
  const FIN = "16PwBglRg3O3PsvNnN6UwgHVxA09oaJVw";
  const srcLetter = await prisma.driveDocument.findFirst({ where: { driveFileId: LETTER } });
  const srcFin = await prisma.driveDocument.findFirst({ where: { driveFileId: FIN } });
  if (!srcLetter || !srcFin) throw new Error("нет исходных ссылок на Drive");
  const docs: Array<{ src: typeof srcLetter; title: string; docType: "APPROVAL_EMAIL" | "CALC_SHEET"; notes: string }> = [
    { src: srcLetter, title: "Зачёт переплат SAGA и подкладки — письмо Веллмех 09.09.2026 (спец. 11, норка махагон 371 шт.)", docType: "APPROVAL_EMAIL",
      notes: "Письмо Веллмех (Василий) 09.09.2026 13:46 со счётом №253: «переплаты по SAGA и подкладке учтены». Файл Drive: «Re доплата за меховое сырье - норка махагон … 371 шт. (376 шт.).msg»." },
    { src: srcFin, title: "расчет себестоимости fin.xlsx (зачёты: переплата SAGA 03-26 −83 875,37; подкладка −55 594,50)", docType: "CALC_SHEET",
      notes: "Расчёт Веллмех: «переплата SAGA 03-26» −83 875,37 и «переплата подкладка» −55 594,50; счёт 353 992,79 − 139 469,87 = 214 522,92." },
  ];
  for (const d of docs) {
    const have = await prisma.driveDocument.findFirst({ where: { driveFileId: d.src.driveFileId, paymentId: pay253.id } });
    if (have) { console.log("ссылка уже есть:", d.title); continue; }
    plan.push({
      label: `документ к оплате 214 522,92: ${d.title}`,
      run: async () => {
        const c = await prisma.driveDocument.create({
          data: { organizationId: org.id, driveFileId: d.src.driveFileId, title: d.title, docType: d.docType, mimeType: d.src.mimeType, sizeBytes: d.src.sizeBytes, drivePath: d.src.drivePath, viewUrl: d.src.viewUrl, year: d.src.year, notes: d.notes, paymentId: pay253.id },
        });
        return { kind: "create", model: "driveDocument", id: c.id, label: `DriveDocument ${d.title.slice(0, 40)}` };
      },
    });
  }

  // 4. решения владельца
  const states: Array<{ key: string; title: string; label: string; value: Record<string, unknown> }> = [];
  for (const [id, a] of Object.entries(ANSWERS)) {
    const d = DECISIONS.find((x) => x.id === id);
    const o = d?.options.find((x) => x.key === a.choice);
    if (!d || !o) throw new Error(`нет решения или варианта: ${id}/${a.choice}`);
    const key = DECISION_KEY_PREFIX + id;
    if (await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: org.id, key } } })) { console.log(`уже решено, пропуск: ${id}`); continue; }
    states.push({ key, title: d.title, label: o.label, value: { choice: o.key, label: o.label, note: a.note.slice(0, 500), at: new Date().toISOString(), by: null, byName: WHO } });
  }

  for (const p of plan) console.log("•", p.label);
  for (const s of states) console.log(`• ${s.key}  «${s.title}» → ${s.label}`);
  if (!APPLY) return console.log("\nпробный прогон (добавьте --apply)");
  if (!plan.length && !states.length) return;
  execFileSync(path.join(__dirname, "backup.sh"), { stdio: "inherit" });
  for (const p of plan) { j.push(await p.run()); save(); }
  for (const s of states) {
    await prisma.systemState.create({ data: { organizationId: org.id, key: s.key, value: s.value as never } });
    j.push({ kind: "state", key: s.key, at: s.value.at as string, label: s.key });
    save();
  }
  console.log("записано:", plan.length, "изменений,", states.length, "решений");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
