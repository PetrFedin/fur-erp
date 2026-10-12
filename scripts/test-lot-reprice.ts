// Проверка пересчёта лота (lot-reprice) на КОПИИ базы — запускать только с DATABASE_URL копии (fur_erp_scratch_lot), на живой базе скрипт откажется работать.
//   DATABASE_URL=postgresql://fur_erp:fur_erp@localhost:5436/fur_erp_scratch_lot node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-lot-reprice.ts
import "./stubs/server-only-shim";
import { prisma } from "../src/lib/prisma";
import { buildLotPlan, applyLotWrites, type LotChange } from "../src/lib/lot-reprice";
import { lotComposition, splitVat } from "../src/lib/price-composition";
import { lotHammer, lotUsdPrice } from "../src/lib/lot-hammer";

if (!/scratch/.test(process.env.DATABASE_URL ?? "")) { console.error("Отказ: DATABASE_URL не похож на копию (нет «scratch»)"); process.exit(2); }
let fails = 0, checks = 0;
const ok = (what: string, cond: boolean, extra = "") => { checks++; if (!cond) { fails++; console.log(`  ✗ ${what} ${extra}`); } };
const near = (what: string, a: number, b: number, tol = 0.011) => ok(what, Math.abs(a - b) <= tol, `(${a} ≠ ${b})`);
const N = (x: unknown) => Number(x as never);

async function org() { return (await prisma.organization.findFirst())!.id; }
async function apply(orgId: string, lotId: string, ch: LotChange) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "RawMaterialLot" WHERE "id" = ${lotId} FOR UPDATE`;
    const r = await buildLotPlan(tx, orgId, lotId, ch);
    if ("error" in r) return { error: r.error };
    await applyLotWrites(tx, orgId, r.writes);
    return { plan: r.plan };
  }, { timeout: 60000 });
}
async function snap(lotId: string) {
  const l = await prisma.rawMaterialLot.findUniqueOrThrow({ where: { id: lotId }, include: { purchase: true, purchaseItems: true, usages: { include: { productionOrder: { include: { materialUsages: true, expenses: true } } } }, stockMovements: true } });
  const plans = l.purchaseItems.map((i) => i.costPlan);
  const comp = lotComposition({ breakdown: l.costBreakdown, plans, vatRate: N(l.vatRate), qty: N(l.quantityReceived), totalIncl: N(l.totalCost), purchaseNumber: l.purchase?.number, lotNumber: l.lotNumber });
  const orders = new Map(l.usages.map((u) => [u.productionOrder.id, u.productionOrder]));
  return {
    l, comp, ham: lotHammer(l.costBreakdown, N(l.vatRate), plans), usd: lotUsdPrice(l.costBreakdown, plans, { vatRate: N(l.vatRate), purchaseNumber: l.purchase?.number, lotNumber: l.lotNumber }),
    orders: [...orders.values()].map((o) => ({ id: o.id, status: o.status, mc: N(o.materialCost), tc: N(o.totalCost), uc: N(o.unitCost), live: o.materialUsages.reduce((s, u) => s + N(u.totalCost), 0), exp: o.expenses.reduce((s, e) => s + N(e.amount), 0) })),
  };
}
type Snap = Awaited<ReturnType<typeof snap>>;
const gapOf = (s: Snap) => {
  const m = s.l.stockMovements, IN = ["PURCHASE_IN", "ADJUSTMENT_IN", "TRANSFER_IN"];
  return m.filter((x) => IN.includes(x.type)).reduce((a, x) => a + N(x.quantity), 0) - m.filter((x) => !IN.includes(x.type)).reduce((a, x) => a + N(x.quantity), 0) - N(s.l.quantityRemaining);
};
function invariants(tag: string, s: Snap, gap0 = 0) {
  const l = s.l;
  near(`${tag}: totalCost = unitCost × qty (±0.5·qty%)`, N(l.totalCost), N(l.unitCost) * N(l.quantityReceived), 0.006 * N(l.quantityReceived) + 0.02);
  near(`${tag}: unitCost = Σ частей`, N(l.unitCost), N(l.materialCostExclVat) + N(l.materialVatAmount) + N(l.expenseCostExclVat) + N(l.expenseVatAmount), 0.03);
  const used = l.usages.reduce((a, u) => a + N(u.quantity), 0);
  const gone = N(l.quantityReceived) - N(l.quantityRemaining);
  ok(`${tag}: остаток ≥ 0`, N(l.quantityRemaining) >= 0);
  ok(`${tag}: ушло ≥ списано в ТЗ`, gone + 1e-9 >= used);
  for (const u of l.usages) near(`${tag}: списание = кол-во × цена лота`, N(u.totalCost), Math.round(N(u.quantity) * N(l.unitCost) * 100) / 100, 0.011);
  const jin = l.stockMovements.filter((m) => ["PURCHASE_IN", "ADJUSTMENT_IN", "TRANSFER_IN"].includes(m.type)).reduce((a, m) => a + N(m.quantity), 0);
  const jout = l.stockMovements.filter((m) => !["PURCHASE_IN", "ADJUSTMENT_IN", "TRANSFER_IN"].includes(m.type)).reduce((a, m) => a + N(m.quantity), 0);
  near(`${tag}: журнал движений = остаток (как до правки)`, jin - jout - N(l.quantityRemaining), gap0, 0.0005);
  for (const o of s.orders) if (o.status === "COMPLETED") { near(`${tag}: ТЗ ${o.id.slice(-4)} материалы = Σ списаний`, o.mc, o.live, 0.011); near(`${tag}: ТЗ итог = материалы + расходы`, o.tc, o.live + o.exp, 0.011); }
  if (s.comp) {
    const sp = splitVat(s.comp, N(l.vatRate));
    near(`${tag}: Σ секторов + НДС = цена лота`, Object.values(sp.excl).reduce((a, x) => a + x, 0) + sp.vat, N(l.totalCost), 0.01);
  }
}

async function main() {
  const orgId = await org();
  // Лот меха формата «lot» с молотком, одной позицией и списаниями в завершённых ТЗ.
  const cands = await prisma.rawMaterialLot.findMany({
    where: { organizationId: orgId, rawMaterial: { unit: "PIECE" }, purchaseItems: { some: {} }, usages: { some: { productionOrder: { status: "COMPLETED" } } } },
    include: { purchaseItems: true, usages: true },
  });
  const lots = cands.filter((c) => c.purchaseItems.length === 1 && JSON.stringify(c.costBreakdown).includes("Стоимость молоток ЛОТ без НДС") && c.usages.length >= 1).sort((a, b) => a.id.localeCompare(b.id));
  // лоты с разной схемой НДС молотка: берём по одному «обычному» и одному из таможенных листов (Крашение в РФ)
  const pick = [lots[0], lots[Math.floor(lots.length / 2)], lots.find((c) => JSON.stringify(c.costBreakdown).includes("Крашение в РФ")) ?? lots[1], lots[lots.length - 1]];
  for (const lot of Array.from(new Set(pick))) await testLot(orgId, lot.id, lot.lotNumber, lot.usages.length);
  await restOfTests(orgId);
  console.log(`Пересчёт лота: проверок ${checks}, расхождений ${fails}`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
}

async function testLot(orgId: string, id: string, lotNumber: string | null, nUsages: number) {
  console.log("Лот для проверки:", lotNumber, "списаний:", nUsages);
  let r: Awaited<ReturnType<typeof apply>>;
  const s0 = await snap(id);
  invariants("исходно", s0);
  const items0 = JSON.stringify((s0.l.costBreakdown as { items: unknown[] }).items);
  const hammerIdx = ((s0.l.costBreakdown as { items: { label: string }[] }).items).findIndex((x) => x.label === "Стоимость молоток ЛОТ без НДС");
  const hammerV = N(((s0.l.costBreakdown as { items: { value: number }[] }).items)[hammerIdx].value);
  const other0 = s0.comp!.incl.other;

  // 1. правка строки молотка
  r = await apply(orgId, id, { sheet: [{ idx: hammerIdx, value: hammerV + 10000 }] });
  ok("правка строки: применилась", "plan" in r, JSON.stringify(r));
  const s1 = await snap(id);
  invariants("после правки строки", s1);
  const k = 1 + N(s0.l.vatRate) / 100;
  near("правка строки: цена лота выросла на Δмолотка (×(1+НДС), если НДС молотка входит в сырьё)", N(s1.l.totalCost) - N(s0.l.totalCost), 10000 * (s0.comp!.hvat ? k : 1), 0.011);
  ok("правка строки: молоток за шкуру вырос", s1.ham!.excl > s0.ham!.excl);
  near("правка строки: молоток за шкуру = H/кол-во", s1.ham!.excl, (hammerV + 10000) / N(s0.l.quantityReceived), 0.01);
  near("правка строки: «Прочие» не изменились (сумма не ушла в остаток)", s1.comp!.incl.other, other0, 1.5);
  ok("правка строки: стоимость списаний выросла", s1.l.usages.reduce((a, u) => a + N(u.totalCost), 0) > s0.l.usages.reduce((a, u) => a + N(u.totalCost), 0));
  for (const o of s1.orders) { const o0 = s0.orders.find((x) => x.id === o.id)!; if (o.status === "COMPLETED") ok("правка строки: себестоимость ТЗ изменилась", o.tc > o0.tc); }
  if (s0.usd.usd != null) ok("правка строки: $ пересчитан", s1.usd.usd != null && s1.usd.usd > s0.usd.usd);

  // 2. откат строки
  r = await apply(orgId, id, { sheet: [{ idx: hammerIdx, value: hammerV }] });
  ok("откат строки: применился", "plan" in r, JSON.stringify(r));
  const s2 = await snap(id);
  invariants("после отката строки", s2);
  near("откат: цена лота как была", N(s2.l.totalCost), N(s0.l.totalCost), 0.011);
  ok("откат: лист как был", JSON.stringify((s2.l.costBreakdown as { items: unknown[] }).items) === items0 || JSON.stringify((s2.l.costBreakdown as { items: { value: number }[] }).items.map((x) => Math.round(x.value * 1e4))) === JSON.stringify((s0.l.costBreakdown as { items: { value: number }[] }).items.map((x) => Math.round(x.value * 1e4))));
  near("откат: молоток", s2.ham!.excl, s0.ham!.excl, 0.0001);
  for (const o of s2.orders) { const o0 = s0.orders.find((x) => x.id === o.id)!; near("откат: итог ТЗ", o.tc, o0.tc, 0.011); }
  const fg = await prisma.finishedGoodsMovement.count({ where: { notes: { contains: "пересчёта лота" } } });
  ok("корректировки готовой продукции записаны", fg >= 2, String(fg));

  // 3. цена за шкуру с НДС (+5%) и возврат
  const unit0 = N(s0.l.unitCost);
  r = await apply(orgId, id, { unitIncl: (unit0 * 1.05).toFixed(2) });
  ok("цена: применилась", "plan" in r, JSON.stringify(r));
  const s3 = await snap(id);
  invariants("после смены цены", s3);
  near("цена: единица ≈ +5%", N(s3.l.unitCost), unit0 * 1.05, 0.02);
  near("цена: позиция закупки согласована с лотом", N(s3.l.purchaseItems[0].subtotal) * N(s3.l.purchase!.exchangeRate) * (1 + N(s3.l.vatRate) / 100), N(s3.l.totalCost), 0.0122 * N(s3.l.quantityReceived) + 0.02);
  ok("цена: молоток изменился", Math.abs(s3.ham!.excl - s0.ham!.excl) > 1);
  near("цена: «Прочие» не раздулись", s3.comp!.incl.other, other0, 1.5);
  r = await apply(orgId, id, { unitIncl: unit0.toFixed(2) });
  const s4 = await snap(id);
  invariants("после возврата цены", s4);
  near("возврат цены: единица как была", N(s4.l.unitCost), unit0, 0.011);
  near("возврат цены: сумма лота как была (допуск округления единицы)", N(s4.l.totalCost), N(s0.l.totalCost), 0.006 * N(s0.l.quantityReceived));

  // 4. количество: ниже списанного нельзя; увеличить и вернуть
  const gone = N(s0.l.quantityReceived) - N(s0.l.quantityRemaining);
  if (gone > 0.001) {
    const bad = await apply(orgId, id, { qty: String(gone - 0.5) });
    ok("количество ниже списанного: отказ с понятным текстом", "error" in bad && /Нельзя поставить количество/.test(bad.error ?? ""), JSON.stringify(bad));
    console.log("   текст отказа:", "error" in bad ? bad.error : "");
  }
  const q0 = N(s0.l.quantityReceived);
  r = await apply(orgId, id, { qty: String(q0 + 10) });
  ok("количество +10: применилось", "plan" in r, JSON.stringify(r));
  const s5 = await snap(id);
  invariants("после +10 шт.", s5);
  near("количество: остаток вырос на 10", N(s5.l.quantityRemaining), N(s0.l.quantityRemaining) + 10, 0.0005);
  near("количество: цена шкуры та же", N(s5.l.unitCost), unit0, 0.02);
  near("количество: «Прочие» не раздулись", s5.comp!.incl.other / (q0 + 10), other0 / q0, 0.5);
  r = await apply(orgId, id, { qty: String(q0) });
  const s6 = await snap(id);
  invariants("после возврата количества", s6);
  near("возврат количества: остаток", N(s6.l.quantityRemaining), N(s0.l.quantityRemaining), 0.0005);
  near("возврат количества: сумма", N(s6.l.totalCost), N(s0.l.totalCost), 0.006 * q0);

  // 5. НДС: сохранить сумму с НДС, затем сохранить цену без НДС
  const vat0 = N(s0.l.vatRate), vNew = vat0 === 22 ? 20 : 22;
  r = await apply(orgId, id, { vatRate: String(vNew), vatKeep: "incl" });
  ok("НДС (сумма с НДС): применилось", "plan" in r, JSON.stringify(r));
  const s7 = await snap(id);
  invariants("после НДС (с НДС сохранена)", s7);
  near("НДС: сумма с НДС та же", N(s7.l.totalCost), N(s0.l.totalCost), 0.006 * q0);
  near("НДС: цена без НДС изменилась", N(s7.l.materialCostExclVat) + N(s7.l.expenseCostExclVat), N(s7.l.unitCost) / (1 + vNew / 100), 0.03);
  r = await apply(orgId, id, { vatRate: String(vat0), vatKeep: "incl" });
  const s8 = await snap(id);
  near("НДС возврат: сумма", N(s8.l.totalCost), N(s0.l.totalCost), 0.006 * q0);
  r = await apply(orgId, id, { vatRate: String(vNew), vatKeep: "excl" });
  const s9 = await snap(id);
  invariants("после НДС (цена без НДС сохранена)", s9);
  near("НДС (без НДС сохранена): сумма с НДС изменилась по ставке", N(s9.l.totalCost), N(s0.l.totalCost) * (1 + vNew / 100) / (1 + vat0 / 100), 0.02 * q0);
  await apply(orgId, id, { vatRate: String(vat0), vatKeep: "excl" });

  // 6. ручная категория строки: вклад переезжает, цена та же
  const labels = (s0.l.costBreakdown as { items: { label: string; value: number }[] }).items;
  const perevozIdx = labels.findIndex((x) => x.label === "Перевозка в т.ч. НДС");
  if (perevozIdx >= 0) {
    const sPre = await snap(id);
    const before = sPre.comp!.incl;
    r = await apply(orgId, id, { sheet: [{ idx: perevozIdx, cat: "dress" }] });
    const sc = await snap(id);
    near("категория: цена лота не изменилась", N(sc.l.totalCost), N(sPre.l.totalCost), 0.0001);
    near("категория: «Выделка» выросла на сумму перевозки", sc.comp!.incl.dress - before.dress, before.transport, 1);
    near("категория: «Транспорт» ушёл в 0", sc.comp!.incl.transport, 0, 1);
    await apply(orgId, id, { sheet: [{ idx: perevozIdx, cat: "" }] });
    const sc2 = await snap(id);
    near("категория: сброс возвращает транспорт", sc2.comp!.incl.transport, before.transport, 0.011);
  }

}

async function restOfTests(orgId: string) {
  let r: Awaited<ReturnType<typeof apply>>;
  // Другие виды листов: «fx» (НДС на шкуры), «inv» (валютный курс инвойса) и молоток в долларах у листа «lot».
  for (const marker of ["НДС на шкуры", "Валютный курс инвойса", "Цена за ед. (ам. долл.)"]) {
    const cs = (await prisma.rawMaterialLot.findMany({ where: { organizationId: orgId, rawMaterial: { unit: "PIECE" }, costBreakdown: { not: undefined as never } }, include: { purchaseItems: true, usages: true } }))
      .filter((c) => c.purchaseItems.length === 1 && JSON.stringify(c.costBreakdown).includes(marker) && c.usages.length > 0).sort((a, b) => a.id.localeCompare(b.id));
    const c = cs[0];
    if (!c) { console.log("нет лота с", marker); continue; }
    const t0 = await snap(c.id);
    const u0 = N(t0.l.unitCost);
    r = await apply(orgId, c.id, { unitIncl: (u0 * 1.03).toFixed(2) });
    ok(`[${marker}] цена применилась`, "plan" in r, JSON.stringify(r));
    const t1 = await snap(c.id);
    invariants(`[${marker}] после цены`, t1, gapOf(t0));
    if (Math.abs(gapOf(t0)) > 0.0005) console.log(`   [${marker}] в исходных данных журнал движений расходится с остатком на ${gapOf(t0)} (не связано с правкой)`);
    console.log(`   [${marker}] формат ${t0.comp?.format}: Прочие ${t0.comp?.incl.other.toFixed(2)} → ${t1.comp?.incl.other.toFixed(2)}, молоток ${t0.ham?.excl.toFixed(2)} → ${t1.ham?.excl.toFixed(2)}`);
    await apply(orgId, c.id, { unitIncl: u0.toFixed(2) });
    near(`[${marker}] возврат цены`, N((await snap(c.id)).l.unitCost), u0, 0.011);
    if (marker === "Цена за ед. (ам. долл.)" && t0.usd.usd) {
      r = await apply(orgId, c.id, { hammerUsd: String(t0.usd.usd * 1.1) });
      const t2 = await snap(c.id);
      invariants("молоток $ +10%", t2);
      near("молоток $: новое значение", t2.usd.usd ?? 0, t0.usd.usd * 1.1, 0.001);
      ok("молоток $: цена лота выросла", N(t2.l.totalCost) > N(t0.l.totalCost));
      await apply(orgId, c.id, { hammerUsd: String(t0.usd.usd) });
      near("молоток $: возврат цены лота", N((await snap(c.id)).l.totalCost), N(t0.l.totalCost), 0.011 + 0.006 * N(t0.l.quantityReceived));
    }
  }
  const single = await prisma.rawMaterialLot.findMany({ where: { organizationId: orgId, rawMaterial: { unit: "M" } }, include: { purchaseItems: true } });
  const lin1 = single.find((x) => x.purchaseItems.length === 1 && x.costBreakdown == null);
  if (lin1) {
    const sl0 = await snap(lin1.id);
    const u0 = N(sl0.l.unitCost);
    r = await apply(orgId, lin1.id, { unitIncl: (u0 + 1).toFixed(2) });
    ok("подкладка без листа: цена применилась", "plan" in r, JSON.stringify(r));
    const sl1 = await snap(lin1.id);
    invariants("подкладка после цены", sl1);
    near("подкладка: единица +1", N(sl1.l.unitCost), u0 + 1, 0.011);
    await apply(orgId, lin1.id, { unitIncl: u0.toFixed(2) });
    near("подкладка: возврат", N((await snap(lin1.id)).l.unitCost), u0, 0.011);
  }
  const pool = single.find((x) => x.purchaseItems.length > 1);
  if (pool) { const e = await apply(orgId, pool.id, { qty: String(N(pool.quantityReceived) + 1) }); ok("пул ткани: отказ", "error" in e && /нескольких поступлений/.test(e.error ?? ""), JSON.stringify(e)); }
}

main();
