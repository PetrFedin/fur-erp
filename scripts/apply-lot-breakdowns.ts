/**
 * Расчётные листы лотов, которых не хватает в RawMaterialLot.costBreakdown (сектор «Прочее» → «Без разбивки» виджета Главной
 * «Из чего складывается стоимость меха»). Берутся ТОЛЬКО однозначные случаи: расчёт по лоту есть в письмах архива почты
 * (docs-inventory/backup-mail, папка «мех»), цена лота в расчёте совпадает с ценой лота в базе (допуск 0,5 %).
 * Если Σ составляющих ≠ цене лота — лот не пишется, а перечисляется в выводе.
 *
 * Источники (письмо №, дата, отправитель — вложение):
 *  • РП 04.26 (З-2026-0042), лоты 19, 20, 23, 26, 27 — №136 (09.07.2026, Василий/Веллмех) и №134 (10.07.2026, Коношенко), «закупка РП 04-2026.xlsx» (лист «РП-04.26»,
 *    окончательная версия с выделкой/транспортом/брокерским %; ранняя версия без них — №220 от 04.05.2026); цены «для УПД» совпадают с ценой лота;
 *  • РП 03.25 (З-2026-0018), лот 1498-2 — №375 (15.09.2025, Василий), «Русьпушнина для УПД.xlsx» (счёт Русьпушнины №2157, курс 88,2568);
 *  • СП 03.25 (З-2026-0026), лот 3751-2 — №375, «Союзпушнина для УПД.xlsx» (счёт Союзпушнины №1053 от 03.03.2025, 5,5 % + 1,25 % + 1,25 %);
 *  • РП 05.25 (З-2026-0019), лот 1498-1, и СП 05.25 (З-2026-0028), лот 3751-1 — №360/363/365 (18–23.09.2025), «расчет СП-РП 05-2025.xlsx» (счета №2227, №2094);
 *  • AME 05.26 (З-2026-0058), лот 204742 — №42 (09.09.2026, Василий), «расчет себестоимости fin.xlsx» (блок «факт», УПД №253: 9 654,49 ₽ × 371 шт. = 3 581 815,79).
 * Формат строк — как у соседних лотов тех же закупок/аукционов (словарь label → сектор: src/lib/price-composition.ts):
 *  РП 04.26 — «fx» (суммы за шкуру), 2025 — «lot» (суммы за весь лот), AME — «lot» (суммы за лот; молоток в $ × курс; брокерский % внутри «Услуг Аукциона»).
 * НЕ меняет unitCost / totalCost / цену лота, списания ТЗ, количество и вообще любое поле, кроме costBreakdown у перечисленных лотов.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-lot-breakdowns.ts            # пробный прогон (ничего не пишет)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-lot-breakdowns.ts --apply    # перед этим бэкап базы (scripts/backup.sh)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-lot-breakdowns.ts --rollback [--apply]
 * Журнал: docs-inventory/corrections-journal-lot-breakdowns.json. Идемпотентно: лот, у которого уже есть расчётный лист, пропускается.
 */
import "./stubs/server-only-shim";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { Prisma, PrismaClient } from "@prisma/client";
import { loadDashboard } from "../src/lib/dashboard-data";
import { priceComposition } from "../src/lib/price-composition-server";
import { COMP_CATS, CAT_LABEL, emptyCats, lotComposition, splitVat } from "../src/lib/price-composition";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-lot-breakdowns.json");
const TOL = 0.005; // допуск Σ составляющих документа к цене лота в базе, 0,5 %

type Item = { label: string; value: number };
type Sheet = { items: Item[]; furDescription: string | null; exchangeRateFixed: string | null; exchangeRateInvoice: string | null; source: string };
type Spec = { purchase: string; lot: string; qty: number; title: string; docTotalIncl: number; sheet: Sheet };
type Entry = { time: string; entity: string; id: string; lot: string; field: string; before: unknown; after: unknown; source: string; rolledBack?: boolean };

const f2 = (v: number) => v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r = (x: number) => Math.round(x * 1e6) / 1e6;

// ───────────────────────── РП 04.26: формат «fx» (за шкуру), как у лота 18 той же закупки ─────────────────────────
// Столбцы листа «РП-04.26»: аукционный сбор (с НДС), НДС (на молоток), курс, выделка, транспорт на выделку и обратно, брокерский % (= «Комиссия РМ, 4,5%»).
function fx(lot: string, qty: number, fur: string, fee: number, vat: number, dress: number, transport: number, broker: number, total: number, src: string): Spec {
  return {
    purchase: "З-2026-0042", lot, qty, title: `РП 04.26, лот ${lot}`, docTotalIncl: total * qty,
    sheet: {
      items: [
        { label: "Аукционный сбор", value: fee },
        { label: "Курс ЦБ (фиксация)", value: 74.5897 },
        { label: "Выделка/крашение/стрижка, $", value: dress },
        { label: "Транспорт на выделку и обратно", value: transport },
        { label: "Комиссия РМ, 4,5%", value: broker },
        { label: "НДС на шкуры", value: vat },
      ],
      furDescription: fur, exchangeRateFixed: "74.589699999999993", exchangeRateInvoice: null, source: src,
    },
  };
}
const SRC_RP0426 = "письма №136 (09.07.2026) и №134 (10.07.2026), «закупка РП 04-2026.xlsx», лист «РП-04.26»";
const T = 18.871161048689135;
const RP0426: Spec[] = [
  fx("19", 55, "Sable  wild raw Barguzinsky XXL 3 - 1.3 -", 2428.77489346, 5579.30956, 1159, T, 1141.2224099999999, 35687.676024508684, SRC_RP0426),
  fx("20", 50, "Sable  wild raw Barguzinsky XXL 3 - 2.1 -", 2214.47122639, 5087.01754, 1159, T, 1040.5263149999998, 32642.693242438687, SRC_RP0426),
  fx("23", 50, "Sable  wild raw Barguzinsky XXL 3 - 2.1 -", 2214.47122639, 5087.01754, 1159, T, 1040.5263149999998, 32642.693242438687, SRC_RP0426),
  fx("26", 55, "Sable  wild raw Barguzinsky XXL 3 - 2.2 -", 2357.3403377699997, 5415.212219999999, 1159, T, 1107.657045, 34672.681763818684, SRC_RP0426),
  fx("27", 55, "Sable  wild raw Barguzinsky XXL 3 - 2.2 -", 2357.3403377699997, 5415.212219999999, 1159, T, 1107.657045, 34672.681763818684, SRC_RP0426),
];

// ───────────────────────── 2025: формат «lot» (суммы за весь лот), как у соседних лотов (1465, 3748 и др.) ─────────────────────────
// feeIncl — «Услуги Аукциона в т.ч. НДС» за шкуру (аукционный + маркетинговый сбор + сбор за доставку, ×(1+НДС)); vatHammer — НДС на молоток за шкуру.
function lot2025(purchase: string, lot: string, qty: number, title: string, usd: number, rate: number, feeIncl: number, vatHammer: number, dress: number, transport: number, broker: number, total: number, src: string): Spec {
  const hammerUnit = usd * rate;
  const hammer = hammerUnit * qty, vat = vatHammer * qty, fee = feeIncl * qty;
  return {
    purchase, lot, qty, title, docTotalIncl: total,
    sheet: {
      items: [
        { label: "Цена за ед. (ам. долл.)", value: usd },
        { label: "Курс", value: rate },
        { label: "Стоимость молоток ЛОТ без НДС", value: r(hammer) },
        { label: "Стоимость молоток за ед без НДС", value: r(hammerUnit) },
        { label: "НДС на товар", value: r(vat) },
        { label: "Услуги Аукциона в т.ч. НДС", value: r(fee) },
        { label: "Итого за сырье к оплате по счету", value: r(hammer + vat + fee) },
        { label: "Выделка (тонировка / тортора) в т.ч. НДС", value: r(dress * qty) },
        { label: "Перевозка в т.ч. НДС", value: r(transport * qty) },
        { label: "Комиссия", value: r(broker * qty) },
        { label: "Итого за готовое сырье к оплате в т.ч. НДС", value: total },
      ],
      furDescription: null, exchangeRateFixed: null, exchangeRateInvoice: String(rate), source: src,
    },
  };
}
const SRC_375 = "письмо №375 (15.09.2025, Василий → Федин, Коношенко, «закупки на аукционах+остатки»)";
const SRC_05 = "письма №360/363/365 (18–23.09.2025), «расчет СП-РП 05-2025.xlsx»";
const LOTS2025: Spec[] = [
  // РП 03.25, лот 1498 (счёт Русьпушнины №2157; сборы 5,5 % + 1,25 % + 1,1 % = 7,85 % × 1,2 = 9,42 %).
  lot2025("З-2026-0018", "1498-2", 12, "РП 03.25, лот 1498-2", 88, 88.2568, 731.61356928, 1553.31968, 1140, 38.9723, 349.49692799999997, 138960.01052736002, `${SRC_375}, «Русьпушнина для УПД.xlsx», строка лота 1498`),
  // СП 03.25, лот 3751 (счёт Союзпушнины №1053; сборы 8 % + НДС 20 % на сбор = 1 779,26 за шкуру).
  lot2025("З-2026-0026", "3751-2", 28, "СП 03.25, лот 3751-2", 210, 88.2568, 1482.71424 + 296.542848, 3706.7856, 1140, 38.9723, 834.02676, 728923.1529440001, `${SRC_375}, «Союзпушнина для УПД.xlsx», строка лота 3751`),
  // РП 05.25, лот 1498 (счёт №2227) и СП 05.25, лот 3751 (счёт №2094): сбор в листе уже с НДС.
  lot2025("З-2026-0019", "1498-1", 23, "РП 05.25, лот 1498-1", 160, 80.3075, 1210.39464, 2569.84, 1140, 18.863442940038684, 578.214, 422429.7779076208, `${SRC_05}, строка лота 1498`),
  lot2025("З-2026-0028", "3751-1", 22, "СП 05.25, лот 3751-1", 310, 79.7357, 2372.934432, 4943.6134, 1140, 18.863442940038684, 1112.313015, 754727.4083786809, `${SRC_05}, строка лота 3751`),
];

// ───────────────────────── AME 05.26 (норка махагон): формат «lot», суммы за лот; расчёт «факт» на 376 шт. ─────────────────────────
// В листе за шкуру: молоток $72 × курс; аукционный сбор $6,552; упаковка $0,82; брокерский % 3 = $2,16; выделка ₽250,75; «НДС 22 % + TAX 5 % + платёж + услуги перевозки» ₽1 853,35;
// перелёт из США ₽147,25; доставка Тай–МСК ₽948,46; интерес РМ/финансирование 4,5 % ₽241,79; итого ₽9 526,10 × 376 = 3 581 814,89 (УПД №253: 371 шт. × 9 654,49 = 3 581 815,79).
// Брокерский % входит в «Услуги Аукциона» (сектор «Аукционные сборы и брокер»); упаковка отдельной строкой — остаётся в «Прочем» (реальный расход).
function ame(): Spec {
  const rate = 74.62711295266553, n = 376;
  const hammerUnit = 72 * rate;
  const agent = (6.552 + 2.16) * rate * n;
  const dress = 250.74709952095617 * n;
  const transport = (1853.351515957447 + 147.25326124026594 + 948.4619257914362) * n;
  const mediator = 241.79184596663632 * n;
  const packing = 0.82 * rate * n;
  const hammer = hammerUnit * n;
  const total = 3581815.79;
  return {
    purchase: "З-2026-0058", lot: "204742", qty: 371, title: "AME 05.26, лот 204742", docTotalIncl: 9526.103421733465 * n,
    sheet: {
      items: [
        { label: "Цена за ед. (ам. долл.)", value: 72 },
        { label: "Курс", value: rate },
        { label: "Стоимость молоток ЛОТ без НДС", value: r(hammer) },
        { label: "Стоимость молоток за ед без НДС", value: r(hammerUnit) },
        { label: "Услуги Аукциона в т.ч. НДС", value: r(agent) },
        { label: "Выделка (тонировка / тортора) в т.ч. НДС", value: r(dress) },
        { label: "Упаковка", value: r(packing) },
        { label: "Перевозка в т.ч. НДС", value: r(transport) },
        { label: "Комиссия", value: r(mediator) },
        { label: "Итого за готовое сырье к оплате в т.ч. НДС", value: total },
      ],
      furDescription: "норка gold Mahogany M, SN 1/2, Xdark", exchangeRateFixed: String(rate), exchangeRateInvoice: null,
      source: "письмо №42 (09.09.2026, Василий, «Спецификация 11 норка махагон 371 шт. (376 шт.)»), «расчет себестоимости fin.xlsx», блок «факт», УПД №253",
    },
  };
}

const SPECS: Spec[] = [...RP0426, ...LOTS2025, ame()];

function readJournal(): Entry[] {
  return existsSync(JOURNAL) ? (JSON.parse(readFileSync(JOURNAL, "utf-8")) as Entry[]) : [];
}

async function rollback() {
  const entries = readJournal().filter((e) => !e.rolledBack);
  if (!entries.length) return console.log("Журнал пуст — откатывать нечего");
  const rev = [...entries].reverse();
  for (const e of rev) console.log(`  откат лот ${e.lot} (${e.id}).${e.field}`);
  if (!APPLY) return console.log("DRY-RUN: ничего не изменено. Добавьте --apply.");
  for (const e of rev) {
    const cur = await prisma.rawMaterialLot.findUnique({ where: { id: e.id }, select: { costBreakdown: true } });
    if (JSON.stringify(cur?.costBreakdown) !== JSON.stringify(e.after)) { console.log(`  лот ${e.lot}: расчётный лист изменён после внесения — пропуск (не затираю правки)`); continue; }
    await prisma.rawMaterialLot.update({ where: { id: e.id }, data: { costBreakdown: e.before == null ? Prisma.DbNull : (e.before as Prisma.InputJsonValue) } });
  }
  writeFileSync(JOURNAL, JSON.stringify(readJournal().map((e) => ({ ...e, rolledBack: true })), null, 1));
  console.log("Откат выполнен");
}

async function main() {
  console.log(`${ROLLBACK ? "ОТКАТ" : APPLY ? "ПРИМЕНЕНИЕ" : "DRY-RUN"}; БД: ${(process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@")}`);
  if (ROLLBACK) return rollback();
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const time = new Date().toISOString();
  const J: Entry[] = [];
  const skipped: string[] = [];
  const after = emptyCats();
  let nobdBefore = 0, lotsOk = 0, otherAdd = 0;

  console.log("\nЛоты:");
  for (const s of SPECS) {
    const lot = await prisma.rawMaterialLot.findFirst({
      where: { organizationId: org.id, lotNumber: s.lot, purchase: { number: s.purchase } },
      select: { id: true, quantityReceived: true, totalCost: true, unitCost: true, vatRate: true, costBreakdown: true, purchaseItems: { select: { costPlan: true } } },
    });
    if (!lot) { skipped.push(`${s.title}: лот не найден в базе`); continue; }
    const items = (lot.costBreakdown as { items?: unknown[] } | null)?.items;
    if (Array.isArray(items) && items.length) { skipped.push(`${s.title}: расчётный лист уже есть — пропуск`); continue; }
    const qty = lot.quantityReceived.toNumber();
    const total = lot.totalCost.toNumber();
    const vat = lot.vatRate.toNumber();
    if (Math.abs(qty - s.qty) > 1e-6) { skipped.push(`${s.title}: количество в базе ${qty} ≠ ${s.qty} в расчёте — не пишу`); continue; }
    const delta = s.docTotalIncl - total, rel = total ? delta / total : 1;
    const bd = { items: s.sheet.items, furDescription: s.sheet.furDescription, exchangeRateFixed: s.sheet.exchangeRateFixed, exchangeRateInvoice: s.sheet.exchangeRateInvoice, source: s.sheet.source };
    const comp = lotComposition({ breakdown: bd, plans: (lot.purchaseItems ?? []).map((i) => i.costPlan), vatRate: vat, qty, totalIncl: total, purchaseNumber: s.purchase, lotNumber: s.lot });
    console.log(`  ${s.title.padEnd(26)} ${String(qty).padStart(3)} шт.  цена лота ${f2(total).padStart(14)}  Σ документа ${f2(s.docTotalIncl).padStart(14)}  Δ ${f2(delta)} ₽ (${(rel * 100).toFixed(4)} %)`);
    if (!comp) { skipped.push(`${s.title}: формат листа не распознан словарём`); continue; }
    if (Math.abs(rel) > TOL) { skipped.push(`${s.title}: Σ документа ${f2(s.docTotalIncl)} ≠ цене лота ${f2(total)} (Δ ${(rel * 100).toFixed(2)} % > 0,5 %) — не пишу`); continue; }
    const sp = splitVat(comp, vat, total / (1 + vat / 100));
    const parts = COMP_CATS.filter((c) => Math.abs(sp.excl[c.key]) >= 0.5).map((c) => `${CAT_LABEL[c.key]} ${f2(sp.excl[c.key])}`).join("; ");
    console.log(`      сектора (без НДС): ${parts}${comp.unused.length ? `\n      не распознано: ${comp.unused.join(", ")}` : ""}`);
    nobdBefore += sp.exclTotal;
    for (const c of COMP_CATS) after[c.key] += sp.excl[c.key];
    otherAdd += sp.excl.other;
    lotsOk++;
    J.push({ time, entity: "RawMaterialLot", id: lot.id, lot: `${s.purchase} / ${s.lot}`, field: "costBreakdown", before: lot.costBreakdown ?? null, after: bd, source: s.sheet.source });
  }

  console.log("\nПропущено:");
  if (!skipped.length) console.log("  нет");
  for (const x of skipped) console.log(`  ${x}`);

  // Эффект на Главной: «Прочее» = «Прочие расходы» + «Без разбивки».
  const org2 = org.id;
  const E0 = { auction: [] as string[], fur: [] as string[], color: [] as string[], batch: [] as string[], status: [] as string[], vat: [] as string[], attr: [] as string[], catgroup: [] as string[] };
  const d = await loadDashboard(org2, "all" as never, E0 as never, "off" as never);
  const pc = await priceComposition(org2, d);
  const NC = COMP_CATS.length, io = COMP_CATS.findIndex((c) => c.key === "other");
  const tot = new Array<number>(NC + 1).fill(0);
  for (const l of pc.lots) l.excl.forEach((x, i) => (tot[i] += x));
  const prochee0 = tot[NC] + tot[io];
  const prochee1 = prochee0 - nobdBefore + otherAdd;
  console.log(`\nИтого по ${lotsOk} лотам к внесению (цена лота без НДС): ${f2(nobdBefore)} ₽ — сейчас целиком в «Без разбивки».`);
  console.log(`«Прочее» на Главной (без НДС): ${f2(prochee0)} → ${f2(prochee1)} ₽ (−${f2(prochee0 - prochee1)}); из них «Без разбивки» ${f2(tot[NC])} → ${f2(tot[NC] - nobdBefore)}, «Прочие расходы» ${f2(tot[io])} → ${f2(tot[io] + otherAdd)} (упаковка AME 05.26).`);
  console.log("\nСектора «Тотал» (без НДС), ₽: сейчас → после внесения");
  COMP_CATS.forEach((c, i) => {
    const b = tot[i], a = tot[i] + after[c.key];
    if (Math.abs(a - b) >= 0.5 || Math.abs(b) >= 0.5) console.log(`  ${CAT_LABEL[c.key].padEnd(30)} ${f2(b).padStart(18)} → ${f2(a).padStart(18)}  (${a - b >= 0 ? "+" : ""}${f2(a - b)})`);
  });
  console.log(`  ${"Без разбивки в расчёте".padEnd(30)} ${f2(tot[NC]).padStart(18)} → ${f2(tot[NC] - nobdBefore).padStart(18)}  (−${f2(nobdBefore)})`);
  const sumAll = tot.reduce((a, x) => a + x, 0);
  console.log(`  ${"Σ секторов (без НДС)".padEnd(30)} ${f2(sumAll).padStart(18)} → ${f2(sumAll - nobdBefore + COMP_CATS.reduce((a, c) => a + after[c.key], 0)).padStart(18)}  (должно совпасть)`);

  if (!J.length) return console.log("Нечего менять");
  if (!APPLY) return console.log(`\nDRY-RUN: лотов к внесению ${J.length}, в БД ничего не записано.`);
  await prisma.$transaction(async (tx) => {
    for (const e of J) await tx.rawMaterialLot.update({ where: { id: e.id }, data: { costBreakdown: e.after as Prisma.InputJsonValue } });
  });
  writeFileSync(JOURNAL, JSON.stringify([...readJournal(), ...J], null, 1));
  console.log(`\nПрименено лотов: ${J.length}. Журнал: ${JOURNAL}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
