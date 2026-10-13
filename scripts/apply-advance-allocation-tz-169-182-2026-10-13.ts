/**
 * Разнесение остатка неразнесённых авансов 06.07.2026 (счета Веллмех №141 и №143) на НОВЫЕ ТЗ 169–182 — ПРЕДЛОЖЕНИЕ от 13.10.2026, НЕ ПРИМЕНЕНО.
 * Запускать ПОСЛЕ scripts/apply-tz-169-182-2026-10-13.ts --apply и ПОСЛЕ scripts/apply-advance-allocation-2026-10-13.ts --apply
 * (тот скрипт отказывается работать, если у платежа уже есть строки разнесения, поэтому порядок именно такой; на 13.10.2026 в живой базе он уже применён:
 * у платежей 22 и 15 строк разнесения).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-advance-allocation-tz-169-182-2026-10-13.ts            # пробный прогон (БД не меняется)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-advance-allocation-tz-169-182-2026-10-13.ts --apply    # применить (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --env-file=.env node_modules/.bin/tsx scripts/apply-advance-allocation-tz-169-182-2026-10-13.ts --rollback [--apply]
 *
 * Основание: строки «не разносится» из docs-inventory/decisions-2026-10-13.md (вопрос 2) теперь имеют ТЗ.
 *   №141 (список «взятых в работу» 01.07.2026): М001Е ×1 (ТЗ 169, 240 000 → 168 000); М023 ×6 (ТЗ 171 даёт 1 из 6: 280 000 → 196 000; остаётся 5 × 196 000 = 980 000);
 *        М026 ×3 (ТЗ 174, 4 изделия: 3 из них по списку — 320 000 × 3 × 70% = 672 000).
 *   №143 (лист «соболь аксессуары» «расчет стоимости пошива ММ.xlsx», письмо №213): MMF01 муфта (ТЗ 178, 1 из 6: 16 000 → 11 200); MCF01 манжеты (ТЗ 179, 5 из 10: 24 000 → 84 000);
 *        МН06 повязка норка ирис ×20 и норка лавандер ×20 (ТЗ 182: по 7 000 → 98 000 + 98 000); MH07 повязка из соболя ×6 (ТЗ 182: 8 500 → 35 700).
 *   Цены работы в списках и в ТЗ совпадают до рубля (проверяется). Аванс по строке = 70% × цена работы × число изделий строки, найденных в ТЗ.
 *   ТЗ 170, 172, 173, 175–177, 180, 181 в списках №141/№143 НЕТ (взяты в работу после 01.07.2026) — аванс на них из этих платежей не относится.
 * Запись — как saveProductionPaymentAllocation: PaymentAllocation (source MANUAL) + ProductionPaymentOrder; Σ ≤ сумма платежа; ≤ остатка работы ТЗ. Суммы/docRef/notes платежей не меняются.
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
const TAG = "[advance-alloc-tz-169-182:2026-10-13]";

const PAYMENTS = {
  P141: { suffix: "19ac4a", amountC: 1186087000, ref: "Счёт №141 от 15.05.2026 (аванс 70% за 82 изделия), оплачен 06.07.2026" },
  P143: { suffix: "11907e", amountC: 323078000, ref: "Счёт №143 от 15.05.2026 (аванс 70% за аксессуары, 245 шт.), оплачен 06.07.2026" },
} as const;
type PKey = keyof typeof PAYMENTS;

/** Платёж → ТЗ (номер, артикул, цвет) → изделий k по цене price (₽) → сумма = 70% × price × k. */
type Row = { p: PKey; tz: string; model: string; color: string; k: number; price: number; src: string };
const ROWS: Row[] = [
  { p: "P141", tz: "169", model: "M001E", color: "Белый", k: 1, price: 240000, src: "М001Е лиса арктическая ×4 (3 в ТЗ 124, 1 — ТЗ 169)" },
  { p: "P141", tz: "171", model: "М023", color: "Бежевый", k: 1, price: 280000, src: "М023 соболь торторо ×6 (1 из 6 — ТЗ 171; ещё 5 без ТЗ)" },
  { p: "P141", tz: "174", model: "М026", color: "Белый", k: 3, price: 320000, src: "М026 норка белая ×4 (1 в ТЗ 150; 3 из 4 изделий ТЗ 174)" },
  { p: "P143", tz: "178", model: "MMF01", color: "Коричневый", k: 1, price: 16000, src: "MMF01 муфта (1 из 6)" },
  { p: "P143", tz: "179", model: "MCF01", color: "Коричневый", k: 5, price: 24000, src: "MCF01 манжеты (5 из 10)" },
  { p: "P143", tz: "182", model: "МН06", color: "Серый", k: 20, price: 7000, src: "МН06 повязка норка ирис ×20" },
  { p: "P143", tz: "182", model: "МН06", color: "Кремовый", k: 20, price: 7000, src: "МН06 повязка норка лавандер ×20" },
  { p: "P143", tz: "182", model: "МН07", color: "Коричневый", k: 6, price: 8500, src: "MH07 повязка из соболя ×6" },
];

const LAT: Record<string, string> = { М: "M", Н: "H", Е: "E", С: "C", К: "K", А: "A", О: "O", Т: "T", Р: "P", В: "B", Х: "X" };
const nm = (s: string) => s.toUpperCase().replace(/[\s\-_]/g, "").replace(/[А-Я]/g, (c) => LAT[c] ?? c);
const cents = (v: { toString(): string } | number | string) => Math.round(Number(v.toString()) * 100);
const rub = (c: number) => (c / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ");
const dec = (c: number) => (c / 100).toFixed(2);
const advC = (r: Row) => Math.round(r.price * r.k * 0.7 * 100);

type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string;
  createdAllocations: { id: string; paymentId: string; orderId: string; amount: string }[];
  createdOrderLinks: { id: string; paymentId: string; orderId: string }[];
};

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { INV, readJson, writeJson } = await import("./detail-common");
  const { checkAllocation, toCents, fromCents } = await import("../src/lib/payment-alloc-core");
  const { allocatedCentsByOrder, orderWorkCents } = await import("../src/lib/payment-alloc");
  const prisma = createAuditedClient("script:apply-advance-allocation-tz-169-182-2026-10-13");
  const JOURNAL = join(INV, "corrections-journal-advance-allocation-tz-169-182-2026-10-13.json");

  const pays = new Map<PKey, { id: string; organizationId: string; amountC: number; existing: { orderId: string; amountCents: number }[] }>();
  for (const k of Object.keys(PAYMENTS) as PKey[]) {
    const p = await prisma.productionPayment.findFirst({
      where: { id: { endsWith: PAYMENTS[k].suffix } },
      select: { id: true, organizationId: true, amount: true, status: true, allocations: { select: { productionOrderId: true, amount: true } } },
    });
    if (!p) throw new Error(`Платёж …${PAYMENTS[k].suffix} не найден`);
    if (p.status === "CANCELLED") throw new Error(`Платёж …${PAYMENTS[k].suffix} отменён`);
    pays.set(k, { id: p.id, organizationId: p.organizationId, amountC: cents(p.amount), existing: p.allocations.map((a) => ({ orderId: a.productionOrderId, amountCents: cents(a.amount) })) });
  }
  const orgId = [...pays.values()][0].organizationId;

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

  const problems: string[] = [];
  const tzNums = [...new Set(ROWS.map((r) => r.tz))];
  const orders = await prisma.productionOrder.findMany({
    where: { organizationId: orgId, workOrderNumber: { in: tzNums }, status: { not: "CANCELLED" } },
    select: { id: true, number: true, workOrderNumber: true, color: true, status: true, plannedQuantity: true, producedQuantity: true, clientWorkPricePerUnit: true, batch: { select: { number: true } }, productModel: { select: { name: true } } },
  });
  const others = await allocatedCentsByOrder(prisma, orgId, orders.map((o) => o.id));
  type Line = { p: PKey; tz: string; orderId: string; number: string; batch: number | null; amountC: number; src: string; workC: number; othersC: number };
  const lines: Line[] = [];
  for (const r of ROWS) {
    const os = orders.filter((o) => o.workOrderNumber === r.tz && nm(o.productModel.name) === nm(r.model) && (o.color ?? "").toLowerCase() === r.color.toLowerCase());
    if (os.length !== 1) { problems.push(`ТЗ №${r.tz} ${r.model} ${r.color}: найдено ${os.length} (ожидалось 1) — новые ТЗ ещё не заведены?`); continue; }
    const o = os[0];
    const qty = Number(o.status === "COMPLETED" ? o.producedQuantity : o.plannedQuantity);
    if (r.k > qty) problems.push(`ТЗ №${r.tz}: изделий в списке ${r.k} > количества ТЗ ${qty}`);
    const price = Number(o.clientWorkPricePerUnit ?? 0);
    if (Math.abs(price - r.price) > 0.005) problems.push(`ТЗ №${r.tz}: цена работы в ТЗ ${price} ≠ цене списка ${r.price}`);
    lines.push({ p: r.p, tz: r.tz + (r.tz === "182" ? ` (${r.model} ${r.color})` : ""), orderId: o.id, number: o.number, batch: o.batch?.number ?? null, amountC: advC(r), src: r.src, workC: orderWorkCents(o), othersC: others.get(o.id) ?? 0 });
  }
  for (const l of lines) if (l.amountC > l.workC - l.othersC + 1) problems.push(`ТЗ №${l.tz}: аванс ${rub(l.amountC)} больше остатка работы ${rub(l.workC - l.othersC)}`);

  const out: string[] = [`# Разнесение остатка авансов на ТЗ 169–182 — ${APPLY ? "ПРИМЕНЕНИЕ" : "пробный прогон"} (${new Date().toISOString()})`, ""];
  for (const k of Object.keys(PAYMENTS) as PKey[]) {
    const pay = pays.get(k)!;
    const ls = lines.filter((l) => l.p === k);
    const sum = ls.reduce((s, l) => s + l.amountC, 0);
    const exist = pay.existing.reduce((s, e) => s + e.amountCents, 0);
    if (pay.amountC !== PAYMENTS[k].amountC) problems.push(`Платёж …${PAYMENTS[k].suffix}: сумма ${rub(pay.amountC)} ≠ ожидаемой ${rub(PAYMENTS[k].amountC)}`);
    for (const l of ls) if (pay.existing.some((e) => e.orderId === l.orderId)) problems.push(`Платёж …${PAYMENTS[k].suffix}: на ТЗ ${l.tz} уже есть строка разнесения — не перезаписываю`);
    const err = checkAllocation(pay.amountC, [...pay.existing, ...ls.map((l) => ({ orderId: l.orderId, amountCents: l.amountC }))]);
    if (err) problems.push(`Платёж …${PAYMENTS[k].suffix}: ${err}`);
    out.push(`## ${PAYMENTS[k].ref}`,
      `Платёж …${PAYMENTS[k].suffix}: ${rub(pay.amountC)} ₽; уже разнесено ${rub(exist)} ₽ (${pay.existing.length} строк); этим скриптом +${rub(sum)} ₽ на ${ls.length} строк; останется неразнесённым ${rub(pay.amountC - exist - sum)} ₽.`, "",
      "| ТЗ | заказ | партия | основание (строка списка) | сумма, ₽ |", "|---|---|---|---|---:|");
    for (const l of ls) out.push(`| ${l.tz} | ${l.number} | ${l.batch ?? "—"} | ${l.src} | ${rub(l.amountC)} |`);
    out.push("");
  }
  out.push("Если scripts/apply-advance-allocation-2026-10-13.ts ещё НЕ применён, «останется неразнесённым» выше завышено на его сумму (9 844 870 по №141 и 1 148 280 по №143).", "");
  if (problems.length) out.push("## ПРОБЛЕМЫ — запись не выполняется", ...problems.map((x) => `- ${x}`));
  console.log(out.join("\n"));
  if (problems.length) { console.log(`\nНайдено проблем: ${problems.length}. Запись невозможна.`); await prisma.$disconnect(); process.exitCode = 1; return; }
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply."); await prisma.$disconnect(); return; }

  const prev = readJson<Journal | null>(JOURNAL, null);
  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое разнесение — повторно не применяю (сначала --rollback --apply)."); await prisma.$disconnect(); return; }
  if (!NO_BACKUP) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  const journal: Journal = { script: "apply-advance-allocation-tz-169-182-2026-10-13.ts", status: "applied", at: new Date().toISOString(), createdAllocations: [], createdOrderLinks: [] };
  await prisma.$transaction(async (tx) => {
    for (const k of Object.keys(PAYMENTS) as PKey[]) {
      const pay = pays.get(k)!;
      const ls = lines.filter((l) => l.p === k);
      const linksBefore = new Set((await tx.productionPaymentOrder.findMany({ where: { productionPaymentId: pay.id }, select: { id: true } })).map((x) => x.id));
      await tx.paymentAllocation.createMany({
        data: ls.map((l) => ({ organizationId: orgId, productionPaymentId: pay.id, productionOrderId: l.orderId, amount: dec(l.amountC), source: "MANUAL" as const, note: `${TAG} 70% × работа ${l.src}` })),
      });
      await tx.productionPaymentOrder.createMany({ data: ls.map((l) => ({ productionPaymentId: pay.id, productionOrderId: l.orderId })), skipDuplicates: true });
      const created = await tx.paymentAllocation.findMany({ where: { productionPaymentId: pay.id, productionOrderId: { in: ls.map((l) => l.orderId) }, note: { startsWith: TAG } }, select: { id: true, productionOrderId: true, amount: true } });
      for (const c of created) journal.createdAllocations.push({ id: c.id, paymentId: pay.id, orderId: c.productionOrderId, amount: c.amount.toString() });
      const links = await tx.productionPaymentOrder.findMany({ where: { productionPaymentId: pay.id }, select: { id: true, productionOrderId: true } });
      for (const c of links) if (!linksBefore.has(c.id)) journal.createdOrderLinks.push({ id: c.id, paymentId: pay.id, orderId: c.productionOrderId });
      const all = await tx.paymentAllocation.findMany({ where: { productionPaymentId: pay.id }, select: { amount: true } });
      if (all.reduce((s, c) => s + toCents(c.amount), 0) > pay.amountC) throw new Error("Σ разнесения больше платежа — откат транзакции");
      void fromCents;
    }
  });
  writeJson(JOURNAL, journal);
  console.log(`Применено: строк разнесения ${journal.createdAllocations.length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
