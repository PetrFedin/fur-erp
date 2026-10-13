/**
 * Разнесение неразнесённых авансов 06.07.2026 (счета Веллмех №141 и №143) по ТЗ — предложение от 13.10.2026, НЕ ПРИМЕНЕНО.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-advance-allocation-2026-10-13.ts            # пробный прогон (БД не меняется), отчёт
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-advance-allocation-2026-10-13.ts --apply    # применить (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-advance-allocation-2026-10-13.ts --rollback # откат по журналу (пробный); с --apply — выполнить откат
 *
 * Основание (подробно — docs-inventory/decisions-2026-10-13.md, вопрос 2):
 *   • №141 (11 860 870,00) = 70% от работы 82 изделий «взятых в работу» на 01.07.2026 (файл «расчет взятых в работу изделий 01072026.xlsx»,
 *     письмо №150 от 02.07.2026, Василий). Список даёт «модель + цвет + количество» — по ним изделия найдены в ТЗ 119–167 партий 18–21
 *     (по порядку номеров ТЗ; количество в строке ≤ количества ТЗ). Совпадает с зачётом аванса в расчётах доплаты партий 18 и 19 (письма №73, №22).
 *   • №143 (3 230 780,00) = 70% × 4 615 400 (245 аксессуаров, лист «соболь аксессуары» файла «расчет стоимости пошива ММ.xlsx»,
 *     письмо №213 от 15.05.2026). Строки списка сопоставлены ТЗ аксессуаров партий 17–21 по модели и цвету.
 *   • Аванс по строке = 70% × цена работы строки × число изделий строки, найденных в ТЗ (цена ТЗ = цене списка — проверяется).
 * НЕ разносится (остаётся «неразнесённым авансом» — предоплата за изделия, которых нет в ТЗ / не сданы):
 *   №141: М023 ×6 (1 176 000), М026 ×3 (672 000), М001Е ×1 (168 000) = 2 016 000; №143: строки списка без ТЗ (МН01, МН08, MSC01 и др.) = остаток платежа.
 *   Спорные для Веллмеха ТЗ 122, 131, 146, 156 (аксессуары вне списка №143) — не разносятся, пока Веллмех не подтвердит источник аванса.
 *
 * Запись — тем же способом, что saveProductionPaymentAllocation (src/app/(app)/production/mark-actions.ts): строки PaymentAllocation (source MANUAL),
 * ссылки ProductionPaymentOrder (skipDuplicates); проверки checkAllocation (Σ ≤ платёж) и потолок «работа ТЗ − разнесено другими платежами».
 * Сумма платежа, docRef и notes платежей НЕ меняются. Журнал: docs-inventory/corrections-journal-advance-allocation-2026-10-13.json
 * (старое состояние: у платежей 0 строк разнесения и 0 ссылок на ТЗ; id созданных строк) — откат удаляет только созданное.
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const NO_BACKUP = process.argv.includes("--no-backup");
const TAG = "[advance-alloc:2026-10-13]";

/** Платежи: хвост id, сумма (коп.), основание. */
const PAYMENTS = {
  P141: { suffix: "19ac4a", amountC: 1186087000, ref: "Счёт №141 от 15.05.2026 (аванс 70% за 82 изделия), оплачен 06.07.2026" },
  P143: { suffix: "11907e", amountC: 323078000, ref: "Счёт №143 от 15.05.2026 (аванс 70% за аксессуары, 245 шт.), оплачен 06.07.2026" },
} as const;
type PKey = keyof typeof PAYMENTS;

/** Строка плана: платёж → ТЗ (workOrderNumber) → изделий k по цене price (₽) → сумма = 70% × price × k. Источник — строка списка. */
type Row = { p: PKey; tz: string; num?: string; k: number; price: number; src: string };
const ROWS: Row[] = [
  // №141: «расчет взятых в работу изделий 01072026.xlsx» (82 изделия)
  { p: "P141", tz: "119", k: 10, price: 195000, src: "М025 норка виолет ×10" },
  { p: "P141", tz: "120", k: 3, price: 220000, src: "М056 норка перл ×5 (3 здесь + 2 в ТЗ 149)" },
  { p: "P141", tz: "121", k: 5, price: 115000, src: "М029 лиса огневка ×5" },
  { p: "P141", tz: "123", k: 3, price: 240000, src: "М041 норка чёрная стрижка ×3" },
  { p: "P141", tz: "124", k: 3, price: 240000, src: "М001Е лиса арктическая ×4 (3 здесь, 1 не сдан)" },
  { p: "P141", tz: "125", k: 2, price: 408500, src: "М002 соболь торторо ×2" },
  { p: "P141", tz: "127", k: 2, price: 95600, src: "М012 манишка норка блекглама ×2" },
  { p: "P141", tz: "128", k: 6, price: 145000, src: "М052 лиса сильвер фокс ×6" },
  { p: "P141", tz: "132", k: 1, price: 307000, src: "М049 соболь ×1" },
  { p: "P141", tz: "133", k: 2, price: 246000, src: "М001А соболь ×2" },
  { p: "P141", tz: "136", k: 8, price: 200000, src: "М009 норка белая ×8" },
  { p: "P141", tz: "137", k: 10, price: 180000, src: "М045 жилет норка перл ×10" },
  { p: "P141", tz: "138", k: 2, price: 200000, src: "М009 норка браун ×2" },
  { p: "P141", tz: "140", k: 1, price: 386500, src: "М002А соболь ×1" },
  { p: "P141", tz: "141", k: 2, price: 246000, src: "М001К соболь ×2" },
  { p: "P141", tz: "142", k: 1, price: 187000, src: "М038 норка стрижка+соболь ×3 (1 здесь + 2 в ТЗ 167)" },
  { p: "P141", tz: "145", k: 1, price: 165000, src: "М012 манишка соболь ×1" },
  { p: "P141", tz: "148", k: 1, price: 215000, src: "М031 свакара ×1" },
  { p: "P141", tz: "149", k: 2, price: 220000, src: "М056 норка перл ×5 (2 здесь + 3 в ТЗ 120)" },
  { p: "P141", tz: "150", k: 1, price: 320000, src: "М026 норка белая ×4 (1 здесь, 3 не сданы)" },
  { p: "P141", tz: "153", k: 4, price: 95600, src: "М012 манишка норка браун ×4" },
  { p: "P141", tz: "167", k: 2, price: 187000, src: "М038 норка стрижка+соболь ×3 (2 здесь + 1 в ТЗ 142)" },
  // №143: «расчет стоимости пошива ММ.xlsx», лист «соболь аксессуары» (245 шт.)
  { p: "P143", tz: "118", num: "П-2026-0123", k: 1, price: 18000, src: "MSC03 косынка норка виолет (1 из 10)" },
  { p: "P143", tz: "118", num: "П-2026-0124", k: 1, price: 35000, src: "MSC04 шарф с карманами норка пастель (1 из 9)" },
  { p: "P143", tz: "118", num: "П-2026-0125", k: 1, price: 35000, src: "MSC04 шарф с карманами блекглама (1 из 4)" },
  { p: "P143", tz: "118", num: "П-2026-0126", k: 1, price: 150000, src: "MSC05 капюшон+хвосты соболь ферма (1 из 6)" },
  { p: "P143", tz: "126", k: 7, price: 35000, src: "MSC04 шарф с карманами норка пастель (7 из 9)" },
  { p: "P143", tz: "129", k: 4, price: 18000, src: "MSC03 косынка норка виолет (4 из 10)" },
  { p: "P143", tz: "130", k: 3, price: 35000, src: "MSC04 шарф с карманами блекглама (3 из 4)" },
  { p: "P143", tz: "134", k: 2, price: 150000, src: "MSC05 капюшон+хвосты соболь ферма (2 из 6)" },
  { p: "P143", tz: "151", k: 1, price: 56000, src: "MSC03 косынка соболь (1 из 10)" },
  { p: "P143", tz: "159", k: 9, price: 18000, src: "MSC03 косынка норка браун (9 из 20)" },
  { p: "P143", tz: "160", k: 8, price: 9500, src: "МН03 ушанка соболь/норка пастель ×8" },
  { p: "P143", tz: "161", k: 10, price: 7600, src: "МН05 чалма норка перл ×10" },
  { p: "P143", tz: "162", k: 14, price: 7600, src: "МН05 чалма норка браун ×14" },
  { p: "P143", tz: "163", k: 3, price: 18000, src: "MSC03 косынка норка браун (3 из 20, всего 12 с ТЗ 159)" },
  { p: "P143", tz: "164", k: 1, price: 150000, src: "MSC05 капюшон+хвосты соболь ферма (1 из 6)" },
];
// ТЗ 118 (партия 17) состоит из 4 заказов с одним номером ТЗ: строки различаются номером заказа (num); сумма по ТЗ = 70% × 238 000 = 166 600.

const cents = (v: { toString(): string } | number | string) => Math.round(Number(v.toString()) * 100);
const rub = (c: number) => (c / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ");
const dec = (c: number) => (c / 100).toFixed(2);
const advC = (r: Row) => Math.round(r.price * r.k * 0.7 * 100);

type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string;
  /** Состояние ДО: у обоих платежей не было ни строк разнесения, ни ссылок на ТЗ (проверяется перед записью). */
  before: { paymentId: string; amount: string; allocations: number; orderLinks: number }[];
  createdAllocations: { id: string; paymentId: string; orderId: string; amount: string }[];
  createdOrderLinks: { id: string; paymentId: string; orderId: string }[];
};

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { checkAllocation, toCents, fromCents } = await import("../src/lib/payment-alloc-core");
  const { allocatedCentsByOrder, orderWorkCents } = await import("../src/lib/payment-alloc");
  // Клиент с журналом: иначе PaymentAllocation / ProductionPaymentOrder пишутся мимо AuditLog и не видны в «Истории».
  const prisma = createAuditedClient("script:apply-advance-allocation-2026-10-13");
  const JOURNAL = join(INV, "corrections-journal-advance-allocation-2026-10-13.json");

  const pays = new Map<PKey, { id: string; organizationId: string; amountC: number; allocations: number; links: number }>();
  for (const k of Object.keys(PAYMENTS) as PKey[]) {
    const p = await prisma.productionPayment.findFirst({
      where: { id: { endsWith: PAYMENTS[k].suffix } },
      select: { id: true, organizationId: true, amount: true, status: true, _count: { select: { allocations: true, orders: true } } },
    });
    if (!p) throw new Error(`Платёж …${PAYMENTS[k].suffix} не найден`);
    if (p.status === "CANCELLED") throw new Error(`Платёж …${PAYMENTS[k].suffix} отменён`);
    pays.set(k, { id: p.id, organizationId: p.organizationId, amountC: cents(p.amount), allocations: p._count.allocations, links: p._count.orders });
  }
  const orgId = [...pays.values()][0].organizationId;

  // ----- Откат -----
  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат: строк разнесения ${j.createdAllocations.length}, ссылок на ТЗ ${j.createdOrderLinks.length}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        const a = await tx.paymentAllocation.deleteMany({ where: { id: { in: j.createdAllocations.map((x) => x.id) } } });
        const l = await tx.productionPaymentOrder.deleteMany({ where: { id: { in: j.createdOrderLinks.map((x) => x.id) } } });
        console.log(`  удалено строк разнесения ${a.count}, ссылок ${l.count}`);
      });
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
    }
    await prisma.$disconnect();
    return;
  }

  // ----- План и проверки -----
  const tzNums = [...new Set(ROWS.map((r) => r.tz))];
  const orders = await prisma.productionOrder.findMany({
    where: { organizationId: orgId, workOrderNumber: { in: tzNums }, status: { not: "CANCELLED" } },
    select: { id: true, number: true, workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true, batch: { select: { number: true } } },
  });
  const byTz = new Map<string, (typeof orders)[number][]>();
  for (const o of orders) byTz.set(o.workOrderNumber!, [...(byTz.get(o.workOrderNumber!) ?? []), o]);
  const problems: string[] = [];
  type Line = { p: PKey; tz: string; orderId: string; number: string; batch: number | null; amountC: number; src: string; workC: number; othersC: number };
  const lines: Line[] = [];
  const others = await allocatedCentsByOrder(prisma, orgId, orders.map((o) => o.id));
  for (const r of ROWS) {
    const os = (byTz.get(r.tz) ?? []).filter((x) => !r.num || x.number === r.num);
    if (os.length !== 1) { problems.push(`ТЗ №${r.tz}${r.num ? " " + r.num : ""}: найдено ${os.length} (ожидалось 1)`); continue; }
    const o = os[0];
    const qty = Number(o.status === "COMPLETED" ? o.producedQuantity : o.plannedQuantity);
    if (r.k > qty) problems.push(`ТЗ №${r.tz}: изделий в списке ${r.k} > количества ТЗ ${qty}`);
    const price = Number(o.clientWorkPricePerUnit ?? 0);
    if (Math.abs(price - r.price) > 0.005) problems.push(`ТЗ №${r.tz}: цена работы в ТЗ ${price} ≠ цене списка ${r.price}`);
    const workC = orderWorkCents(o);
    lines.push({ p: r.p, tz: r.tz + (r.num ? ` (${r.num.slice(-4)})` : ""), orderId: o.id, number: o.number, batch: o.batch?.number ?? null, amountC: advC(r), src: r.src, workC, othersC: others.get(o.id) ?? 0 });
  }
  for (const l of lines) if (l.amountC > l.workC - l.othersC + 1) problems.push(`ТЗ №${l.tz}: аванс ${rub(l.amountC)} больше остатка работы ${rub(l.workC - l.othersC)}`);
  const out: string[] = [];
  out.push(`# Разнесение авансов 06.07.2026 по ТЗ — ${APPLY ? "ПРИМЕНЕНИЕ" : "пробный прогон"} (${new Date().toISOString()})`, "");
  for (const k of Object.keys(PAYMENTS) as PKey[]) {
    const pay = pays.get(k)!;
    const ls = lines.filter((l) => l.p === k);
    const sum = ls.reduce((s, l) => s + l.amountC, 0);
    if (pay.amountC !== PAYMENTS[k].amountC) problems.push(`Платёж …${PAYMENTS[k].suffix}: сумма ${rub(pay.amountC)} ≠ ожидаемой ${rub(PAYMENTS[k].amountC)}`);
    if (pay.allocations > 0 || pay.links > 0) problems.push(`Платёж …${PAYMENTS[k].suffix}: уже есть разнесение (${pay.allocations}) или ссылки на ТЗ (${pay.links}) — скрипт не перезаписывает`);
    const err = checkAllocation(pay.amountC, ls.map((l) => ({ orderId: l.orderId, amountCents: l.amountC })));
    if (err) problems.push(`Платёж …${PAYMENTS[k].suffix}: ${err}`);
    out.push(`## ${PAYMENTS[k].ref}`, `Платёж …${PAYMENTS[k].suffix}: ${rub(pay.amountC)} ₽; разносится ${rub(sum)} ₽ на ${ls.length} ТЗ; остаётся неразнесённым ${rub(pay.amountC - sum)} ₽.`, "",
      "| ТЗ | заказ | партия | основание (строка списка) | сумма, ₽ |", "|---|---|---|---|---:|");
    for (const l of ls) out.push(`| ${l.tz} | ${l.number} | ${l.batch ?? "—"} | ${l.src} | ${rub(l.amountC)} |`);
    out.push("");
  }
  // Влияние на партии
  const batchSum = new Map<number, number>();
  for (const l of lines) if (l.batch != null) batchSum.set(l.batch, (batchSum.get(l.batch) ?? 0) + l.amountC);
  out.push("## Влияние на партии (разносится, ₽)", ...[...batchSum.entries()].sort((a, b) => a[0] - b[0]).map(([b, c]) => `- партия ${b}: ${rub(c)}`), "");
  if (problems.length) { out.push("## ПРОБЛЕМЫ — запись не выполняется", ...problems.map((p) => `- ${p}`)); }
  console.log(out.join("\n"));
  if (problems.length) { console.log(`\nНайдено проблем: ${problems.length}. Запись невозможна.`); await prisma.$disconnect(); process.exitCode = 1; return; }
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply."); await prisma.$disconnect(); return; }

  // ----- Применение -----
  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое разнесение — повторно не применяю (сначала --rollback --apply)."); await prisma.$disconnect(); return; }
  if (!NO_BACKUP) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  const journal: Journal = { script: "apply-advance-allocation-2026-10-13.ts", status: "applied", at: new Date().toISOString(), before: [], createdAllocations: [], createdOrderLinks: [] };
  await prisma.$transaction(async (tx) => {
    for (const k of Object.keys(PAYMENTS) as PKey[]) {
      const pay = pays.get(k)!;
      journal.before.push({ paymentId: pay.id, amount: fromCents(pay.amountC), allocations: pay.allocations, orderLinks: pay.links });
      const ls = lines.filter((l) => l.p === k);
      await tx.paymentAllocation.createMany({
        data: ls.map((l) => ({ organizationId: orgId, productionPaymentId: pay.id, productionOrderId: l.orderId, amount: dec(l.amountC), source: "MANUAL" as const, note: `${TAG} 70% × работа ${l.src}` })),
      });
      await tx.productionPaymentOrder.createMany({ data: ls.map((l) => ({ productionPaymentId: pay.id, productionOrderId: l.orderId })), skipDuplicates: true });
      const created = await tx.paymentAllocation.findMany({ where: { productionPaymentId: pay.id }, select: { id: true, productionOrderId: true, amount: true } });
      for (const c of created) journal.createdAllocations.push({ id: c.id, paymentId: pay.id, orderId: c.productionOrderId, amount: c.amount.toString() });
      const links = await tx.productionPaymentOrder.findMany({ where: { productionPaymentId: pay.id }, select: { id: true, productionOrderId: true } });
      for (const c of links) journal.createdOrderLinks.push({ id: c.id, paymentId: pay.id, orderId: c.productionOrderId });
      const tot = created.reduce((s, c) => s + toCents(c.amount), 0);
      if (tot > pay.amountC) throw new Error("Σ разнесения больше платежа — откат транзакции");
    }
  });
  writeJson(JOURNAL, journal);
  console.log(`Применено: строк разнесения ${journal.createdAllocations.length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
