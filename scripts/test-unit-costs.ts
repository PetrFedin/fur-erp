// Себестоимость: чистые расчёты ТЗ, расчётного листа позиции, правки листа лота, разложения «Аукцион» и группировки строк (без базы). node --conditions=react-server node_modules/.bin/tsx scripts/test-unit-costs.ts
import { draftTotals, lineCalc, sumLines, vatByRate, type CalcLine } from "../src/lib/tz-calc";
import { SERVICE_VAT, buildCostPlanJson, computeCostPlan, deriveCostPlanInputs, roundPrice, roundQty, roundRate, roundTo, roundVat, DEFAULT_BROKER_PCT, DEFAULT_FEE_PCT, type CostPlanInputs } from "../src/lib/cost-plan";
import { anchorIndex, applyRowEdits, pushPriceDelta, scaleLotRows, toRows, type RawItem } from "../src/lib/lot-sheet-calc";
import { aggregateCostParts, lineParts, partOfLabel, type PartsPurchase, type PartsRow } from "../src/lib/auction-cost-parts";
import { GROUPS, classifyLabel, groupBreakdownItems, labelUnit } from "../src/lib/cost-breakdown-groups";
import type { CompInput } from "../src/lib/price-composition";

let fails = 0, checks = 0;
const ok = (what: string, cond: boolean, extra = "") => { checks++; if (!cond) { fails++; console.log(`  ✗ ${what} ${extra}`); } };
const near = (what: string, a: number | null | undefined, b: number, tol = 1e-6) => ok(what, a != null && Math.abs(a - b) <= tol, `(${a} ≠ ${b})`);

// ───────────────────────── tz-calc ─────────────────────────
// Лот A: 120 ₽ с НДС, 100 ₽ без НДС, НДС 20 %. Лот B: 61 / 50, НДС 22 %.
const lotA = { unitCost: 120, unitCostExcl: 100, vatRate: 20 };
const lotB = { unitCost: 61, unitCostExcl: 50, vatRate: 22 };
{
  // 3 × 120 = 360; 3 × 100 = 300; без 4 % — incl4 = base
  const c = lineCalc({ lot: lotA, qty: 3, commission4: false });
  ok("строка без 4%: с НДС = кол-во × цена", c.baseIncl === 360 && c.incl4 === 360);
  ok("строка без 4%: без НДС = кол-во × цена без НДС", c.baseExcl === 300 && c.excl4 === 300);
  ok("строка: ставка из лота", c.vat === 20);
}
{
  // 4 %: 360 × 1,04 = 374,4; 300 × 1,04 = 312
  const c = lineCalc({ lot: lotA, qty: 3, commission4: true });
  near("строка с 4%: с НДС", c.incl4, 374.4);
  near("строка с 4%: без НДС", c.excl4, 312);
  ok("строка с 4%: база не меняется", c.baseIncl === 360 && c.baseExcl === 300);
  near("4% = 4 % от базы с НДС", c.incl4 - c.baseIncl, 14.4);
}
{
  // своя ставка 10 %: без НДС = 360 / 1,1 = 327,2727…; ставка строки 10
  const c = lineCalc({ lot: lotA, qty: 3, commission4: false, vatRate: 10 });
  near("своя ставка НДС: без НДС = с НДС ÷ (1 + ставка)", c.baseExcl, 360 / 1.1);
  ok("своя ставка НДС: эффективная ставка строки", c.vat === 10);
  const z = lineCalc({ lot: lotA, qty: 3, commission4: false, vatRate: 0 });
  ok("своя ставка 0 %: без НДС = с НДС", z.baseExcl === 360 && z.vat === 0);
  const n = lineCalc({ lot: lotA, qty: 3, commission4: false, vatRate: null });
  ok("ставка null — как в лоте", n.vat === 20 && n.baseExcl === 300);
  const nan = lineCalc({ lot: lotA, qty: 3, commission4: false, vatRate: NaN });
  ok("ставка NaN — как в лоте", nan.vat === 20 && nan.baseExcl === 300);
}
{
  ok("отрицательное количество → 0", lineCalc({ lot: lotA, qty: -2, commission4: true }).incl4 === 0);
  ok("NaN количество → 0", lineCalc({ lot: lotA, qty: NaN, commission4: false }).baseIncl === 0 && lineCalc({ lot: lotA, qty: NaN, commission4: false }).baseExcl === 0);
  ok("Infinity количество → 0", lineCalc({ lot: lotA, qty: Infinity, commission4: false }).baseIncl === 0);
  // 33,333 × 3 = 99,999 → округление до копеек = 100; без НДС не округляется: 27,7775 × 3 = 83,3325
  const r = lineCalc({ lot: { unitCost: 33.333, unitCostExcl: 27.7775, vatRate: 20 }, qty: 3, commission4: false });
  ok("с НДС округляется до копеек", r.baseIncl === 100, `(${r.baseIncl})`);
  near("без НДС не округляется", r.baseExcl, 83.3325, 1e-9);
}
const lnA: CalcLine = { lot: lotA, qty: 3, commission4: true };
const lnB: CalcLine = { lot: lotB, qty: 2, commission4: false };
const lnBad: CalcLine = { lot: lotA, qty: -1, commission4: true };
{
  // A: 360/300/374,4/312; B: 122/100/122/100; плохая строка — 0
  const s = sumLines([lnA, lnB, lnBad]);
  ok("сумма строк: с НДС", s.baseIncl === 482);
  ok("сумма строк: без НДС", s.baseExcl === 400);
  near("сумма строк: с НДС и 4%", s.incl4, 496.4);
  near("сумма строк: без НДС и 4%", s.excl4, 412);
  ok("сумма строк: количество без отрицательных", s.qty === 5);
  const e = sumLines([]);
  ok("пустой список — нули", e.baseIncl === 0 && e.baseExcl === 0 && e.incl4 === 0 && e.excl4 === 0 && e.qty === 0);
}
{
  const v = vatByRate([lnB, lnA], true);
  ok("НДС по ставкам: две ставки по возрастанию", v.length === 2 && v[0].rate === 20 && v[1].rate === 22);
  // 20 %: 374,4 − 312 = 62,4; 22 %: 122 − 100 = 22
  near("НДС 20% с 4%", v[0].vat, 62.4);
  near("НДС 22%", v[1].vat, 22);
  const s = sumLines([lnA, lnB]);
  near("Σ incl по ставкам = Σ incl4 строк", v[0].incl + v[1].incl, s.incl4);
  near("Σ excl по ставкам = Σ excl4 строк", v[0].excl + v[1].excl, s.excl4);
  const w0 = vatByRate([lnA], false);
  ok("НДС без 4%: 360 − 300 = 60", w0.length === 1 && w0[0].vat === 60);
  // две строки одной ставки сливаются: 2 × (360 − 300) = 120
  const same = vatByRate([{ ...lnA, commission4: false }, { ...lnA, commission4: false }], false);
  ok("одна ставка — одна строка", same.length === 1 && same[0].vat === 120 && same[0].incl === 720);
  // своя ставка строки уходит в свою группу
  const own = vatByRate([{ ...lnA, commission4: false, vatRate: 10 }], false);
  ok("своя ставка строки — своя группа", own.length === 1 && own[0].rate === 10);
  near("своя ставка: НДС = 360 − 360/1,1", own[0].vat, 360 - 360 / 1.1);
  ok("пусто — нет строк", vatByRate([], true).length === 0);
}
{
  // мех A (с 4%), подкладка B; расходы 100 + 50 (−5 и NaN отброшены); работа 200 × 2 = 400
  const t = draftTotals({ fur: [lnA], lining: [lnB], expenses: [100, -5, NaN, 50], workPrice: 200, qty: 2 });
  ok("ТЗ: расходы без отрицательных и NaN", t.expenses === 150);
  ok("ТЗ: работа = цена × количество", t.work === 400);
  // 374,4 + 122 + 150 + 400 = 1046,4
  near("ТЗ: всего с НДС и 4%", t.grandIncl4, 1046.4);
  // 360 + 122 + 150 + 400 = 1032
  near("ТЗ: всего с НДС без 4%", t.grandIncl0, 1032);
  // 312 + 100 + 150 + 400 = 962
  near("ТЗ: всего без НДС с 4%", t.grandExcl4, 962);
  // 300 + 100 + 150 + 400 = 950
  near("ТЗ: всего без НДС без 4%", t.grandExcl0, 950);
  near("ТЗ: надбавка 4% = 14,4 (только мех A)", t.extra4, 14.4);
  near("ТЗ: на изделие с НДС и 4% = 1046,4 / 2", t.perUnitIncl4, 523.2);
  near("ТЗ: на изделие без НДС без 4% = 950 / 2", t.perUnitExcl0, 475);
  near("ТЗ: средняя цена меха с 4% = 374,4 / 3", t.furAvgPrice?.incl4, 124.8);
  near("ТЗ: средняя цена меха без 4% = 360 / 3", t.furAvgPrice?.incl0, 120);
  near("ТЗ: расход меха на изделие = 3 / 2", t.furPerItem, 1.5);
  ok("ТЗ: средняя цена подкладки без 4% = 61", t.liningAvgPrice?.incl4 === 61 && t.liningAvgPrice?.incl0 === 61);
  ok("ТЗ: расход подкладки на изделие = 1", t.liningPerItem === 1);
  near("ТЗ: всего = мех + подкладка + расходы + работа", t.grandIncl4, t.fur.incl4 + t.lining.incl4 + t.expenses + t.work);
}
{
  const t = draftTotals({ fur: [lnA], lining: [], expenses: [], workPrice: 200, qty: 0 });
  ok("ТЗ без количества: на изделие — нет", t.perUnitIncl4 === null && t.perUnitIncl0 === null && t.perUnitExcl4 === null && t.perUnitExcl0 === null);
  ok("ТЗ без количества: работа 0", t.work === 0);
  ok("ТЗ без количества: расход на изделие — нет", t.furPerItem === null);
  ok("ТЗ без подкладки: средняя цена подкладки — нет", t.liningAvgPrice === null && t.liningPerItem === null);
  const e = draftTotals({ fur: [], lining: [], expenses: [], workPrice: -1, qty: 3 });
  ok("пустое ТЗ: всё нули", e.grandIncl4 === 0 && e.grandExcl0 === 0 && e.extra4 === 0 && e.work === 0 && e.furAvgPrice === null);
  // работа 10,555 × 2 = 21,11 (с точностью двоичной дроби) — проверяем, что сумма округлена до копеек
  const w = draftTotals({ fur: [], lining: [], expenses: [], workPrice: 10.555, qty: 2 });
  ok("работа округляется до копеек", Math.abs(w.work * 100 - Math.round(w.work * 100)) < 1e-9 && Math.abs(w.work - 21.11) < 0.011);
}

// ───────────────────────── cost-plan ─────────────────────────
ok("roundTo: 1,005 → 1,01 (half-up без ошибки двоичной дроби)", roundTo(1.005, 2) === 1.01);
ok("roundTo: −1,005 → −1,01 (симметрично)", roundTo(-1.005, 2) === -1.01);
ok("roundTo: 2,675 → 2,68", roundTo(2.675, 2) === 2.68);
ok("roundTo: 1,004 → 1", roundTo(1.004, 2) === 1);
ok("roundTo: 0 знаков 2,5 → 3", roundTo(2.5, 0) === 3);
ok("roundTo: экспоненциальная запись 1e-7 → 0", roundTo(1e-7, 2) === 0);
ok("roundTo: NaN/Infinity как есть", Number.isNaN(roundTo(NaN, 2)) && roundTo(Infinity, 2) === Infinity);
ok("roundPrice 123,455 → 123,46", roundPrice(123.455) === 123.46);
ok("roundQty 1,0005 → 1,001", roundQty(1.0005) === 1.001);
ok("roundVat 19,995 → 20", roundVat(19.995) === 20);
ok("roundRate 92,1234565 → 92,123457", roundRate(92.1234565) === 92.123457);
ok("ставка услуг по умолчанию 22 %", SERVICE_VAT === 0.22);

// Пример: 5 шт. по $10, курс 100; сборы 10 %, выделка 1220 ₽ (с НДС 22 %), транспорт 300, брокер 5 %, транзит 50, НДС товара 22 %.
const P: CostPlanInputs = { quantity: 5, price: 10, rate: 100, feePct: 10, dressing: 1220, transport: 300, brokerPct: 5, transit: 50, vat: 22 };
{
  const c = computeCostPlan(P);
  ok("товар = цена × курс = 1000", c.goods === 1000);
  ok("сбор = 10 % от 1000 = 100", c.fee === 100);
  near("НДС на сбор = 22 % от 100 = 22", c.feeVat, 22);
  near("НДС на товар = 22 % от 1000 = 220", c.goodsVat, 220);
  ok("брокер = 5 % от 1000 = 50", c.broker === 50);
  near("выделка без НДС = 1220 / 1,22 = 1000", c.dressingExcl, 1000);
  // 1000 + 100 + 22 + 220 + 1220 + 300 + 50 + 50 = 2962
  near("за единицу с НДС = 2962", c.unitIncl, 2962);
  // 1000 + 100 + 1000 + 300 + 50 + 50 = 2500
  near("за единицу без НДС = 2500", c.unitExcl, 2500);
  ok("материал без НДС = товар, НДС материала = НДС товара", c.materialExcl === c.goods && c.materialVat === c.goodsVat);
  near("расходы без НДС = 2500 − 1000 = 1500", c.expenseExcl, 1500);
  near("НДС расходов = 22 + (1220 − 1000) = 242", c.expenseVat, 242);
  near("всего с НДС = 2962 × 5", c.totalIncl, 14810);
  near("всего без НДС = 2500 × 5", c.totalExcl, 12500);
  near("с НДС = без НДС + НДС материала + НДС расходов", c.unitIncl, c.unitExcl + c.materialVat + c.expenseVat);
  near("без НДС = материал + расходы", c.unitExcl, c.materialExcl + c.expenseExcl);
}
{
  // закупка 2025 года: услуги с НДС 20 %
  const c = computeCostPlan({ ...P, serviceVatPct: 20 });
  near("НДС 20 % на сбор = 20", c.feeVat, 20);
  near("выделка без НДС = 1220 / 1,2", c.dressingExcl, 1220 / 1.2);
  // 1000 + 100 + 20 + 220 + 1220 + 300 + 50 + 50 = 2960
  near("за единицу с НДС при 20 % = 2960", c.unitIncl, 2960);
  near("инвариант с НДС при 20 %", c.unitIncl, c.unitExcl + c.materialVat + c.expenseVat);
  const d = computeCostPlan({ ...P, serviceVatPct: NaN });
  near("ставка услуг NaN → 22 %", d.feeVat, 22);
  const z = computeCostPlan({ ...P, quantity: 0 });
  ok("количество 0 → итоги 0, за единицу считается", z.totalIncl === 0 && z.totalExcl === 0 && Math.abs(z.unitIncl - 2962) < 1e-6);
  const nil = computeCostPlan({ quantity: 1, price: 0, rate: 0, feePct: 0, dressing: 0, transport: 0, brokerPct: 0, transit: 0, vat: 0 });
  ok("все нули → нули", nil.unitIncl === 0 && nil.unitExcl === 0 && nil.expenseVat === 0);
}

const findIdx = (items: { label: string }[], prefix: string) => items.findIndex((x) => x.label.toLowerCase().startsWith(prefix.toLowerCase()));
const J = buildCostPlanJson(P, { furDescription: "Норка", exchangeRateFixed: 101 }, "2026-11-26T00:00:00.000Z", { customs: 100, packing: 50 });
type JItem = { label: string; value: number };
const JI = J.costBreakdown.items as JItem[];
{
  ok("JSON: себестоимость единицы строкой «2962»", J.unitCostInclVat === "2962");
  ok("JSON: материал «1000», НДС материала «220»", J.materialExclVat === "1000" && J.materialVat === "220");
  ok("JSON: расходы «1500», НДС расходов «242»", J.expenseExclVat === "1500" && J.expenseVat === "242");
  ok("JSON: курс счёта строкой, справочные поля", J.costBreakdown.exchangeRateInvoice === "100" && J.costBreakdown.exchangeRateFixed === 101 && J.costBreakdown.furDescription === "Норка");
  ok("JSON: время правки", J.manualEditedAt === "2026-11-26T00:00:00.000Z");
  // транспорт 300 = собственно транспорт 150 + таможня 100 + упаковка 50
  ok("JSON: транспорт без таможни и упаковки = 150", JI[findIdx(JI, "Транспорт на выделку")].value === 150);
  ok("JSON: строка таможни 100", JI[findIdx(JI, "Таможня")].value === 100);
  ok("JSON: строка упаковки 50", JI[findIdx(JI, "Упаковка")].value === 50);
  ok("JSON: подпись сбора с процентом", JI.some((x) => x.label === "Аукционный сбор, маркетинговый сбор, сбор за доставку (10% от цены), ₽" && x.value === 100));
  ok("JSON: подпись НДС товара", JI.some((x) => x.label === "НДС 22% на товар, ₽" && x.value === 220));
  ok("JSON: подпись выделки с НДС 22%", JI.some((x) => x.label === "Выделка (с НДС 22%), ₽" && x.value === 1220));
  ok("JSON: последняя строка — итог за единицу 2962", JI[JI.length - 1].label === "Итого себестоимость за единицу, ₽" && JI[JI.length - 1].value === 2962);
  // сумма составляющих (без $, курса, итога) = итог за единицу
  const comp = JI.filter((x) => !/^(цена за ед\., \$|курс|итого)/i.test(x.label)).reduce((a, x) => a + x.value, 0);
  near("JSON: Σ составляющих = итог за единицу", comp, 2962);
  ok("JSON: inputs с частями транспорта, без ставки услуг 22", J.inputs.customs === 100 && J.inputs.packing === 50 && J.inputs.transport === 300 && !("serviceVatPct" in J.inputs));
  const J20 = buildCostPlanJson({ ...P, feePct: 7.35, serviceVatPct: 20, transit: 0 }, {}, "x");
  const I20 = J20.costBreakdown.items as JItem[];
  ok("JSON: ставка услуг 20 сохраняется в inputs", J20.inputs.serviceVatPct === 20);
  ok("JSON: подпись выделки с НДС 20%", I20.some((x) => x.label === "Выделка (с НДС 20%), ₽"));
  ok("JSON: процент с запятой 7,35", I20.some((x) => x.label.includes("(7,35% от цены)")));
  ok("JSON: нулевой транзит — без строки", findIdx(I20, "Комиссия за транзит") < 0);
  ok("JSON: без частей — нет строк таможни и упаковки, весь транспорт = 300", findIdx(I20, "Таможня") < 0 && findIdx(I20, "Упаковка") < 0 && I20[findIdx(I20, "Транспорт на выделку")].value === 300);
  ok("JSON: справочные поля по умолчанию null", J20.costBreakdown.furDescription === null && J20.costBreakdown.exchangeRateFixed === null);
  // таможня больше транспорта: 500 → 300; упаковка не помещается → 0; транспорт без частей 0
  const Jc = buildCostPlanJson(P, {}, "x", { customs: 500, packing: 50 });
  const Ic = Jc.costBreakdown.items as JItem[];
  ok("JSON: таможня ограничена транспортом", Ic[findIdx(Ic, "Таможня")].value === 300 && findIdx(Ic, "Упаковка") < 0 && Ic[findIdx(Ic, "Транспорт на выделку")].value === 0);
  const Jn = buildCostPlanJson(P, {}, "x", { customs: -10, packing: -5 });
  ok("JSON: отрицательные части → 0", !("customs" in Jn.inputs) && !("packing" in Jn.inputs));
}
{
  const base = { quantity: 5, price: 10, rate: 100, vat: 22 };
  const d = deriveCostPlanInputs(J, base);
  ok("вывод параметров: из сохранённых inputs", d.feePct === 10 && d.dressing === 1220 && d.transport === 300 && d.brokerPct === 5 && d.transit === 50);
  ok("вывод параметров: цена, курс, ставка — из позиции", d.price === 10 && d.rate === 100 && d.vat === 22 && d.quantity === 5);
  near("вывод → расчёт даёт тот же итог", computeCostPlan(d).unitIncl, 2962);
  // расчёт из импорта: только строки, без inputs; проценты = сумма / товар (1000)
  const imported = { costBreakdown: { items: JI.map((x) => ({ ...x })) } };
  const di = deriveCostPlanInputs(imported, base);
  ok("из строк импорта: сбор 100 / 1000 = 10 %", di.feePct === 10);
  ok("из строк импорта: брокер 50 / 1000 = 5 %", di.brokerPct === 5);
  ok("из строк импорта: выделка и транзит", di.dressing === 1220 && di.transit === 50);
  // в строках «Транспорт на выделку» лежит только 150: таможня и упаковка в inputs не восстанавливаются
  ok("из строк импорта: транспорт — строка «Транспорт на выделку» (150)", di.transport === 150);
  const e = deriveCostPlanInputs(null, base);
  ok("пустой расчёт → значения по умолчанию", e.feePct === DEFAULT_FEE_PCT && e.brokerPct === DEFAULT_BROKER_PCT && e.dressing === 0 && e.transport === 0 && e.transit === 0);
  const g0 = deriveCostPlanInputs(imported, { ...base, price: 0 });
  ok("товар 0 → проценты по умолчанию (нет деления на 0)", g0.feePct === DEFAULT_FEE_PCT && g0.brokerPct === DEFAULT_BROKER_PCT);
  const s = deriveCostPlanInputs({ inputs: { feePct: "7", dressing: "", serviceVatPct: 20 } }, base);
  ok("inputs строками: «7» → 7, пустая строка → по умолчанию", s.feePct === 7 && s.dressing === 0);
  ok("inputs: ставка услуг 20 сохраняется", s.serviceVatPct === 20);
  ok("inputs без ставки услуг — поля нет", !("serviceVatPct" in d));
}

// ───────────────────────── cost-breakdown-groups ─────────────────────────
{
  const cases: [string, string][] = [
    ["Итого таможенные платежи", "totals"],
    ["  ИТОГО себестоимость ", "totals"],
    ["Расчётный", "totals"],
    ["Корректировка", "totals"],
    ["Оплачено за сырьё", "totals"],
    ["НДС на аукционный сбор, ₽", "auctionFees"],
    ["НДС 20%", "vat"],
    ["НДС на товар", "vat"],
    ["Услуги Аукциона в т.ч. НДС", "auctionFees"],
    ["Маркетинговый сбор", "auctionFees"],
    ["Транспорт Выделка-Склад", "processing"],
    ["Транспорт на выделку и обратно, ₽", "processing"],
    ["Крашение в РФ", "processing"],
    ["Комиссия РМ, 4,5%", "commission"],
    ["Брок. % 3", "commission"],
    ["Брокерский %, 4,5% от цены, ₽", "commission"],
    ["Перевозка в т.ч. НДС", "delivery"],
    ["Пошлина 5%", "delivery"],
    ["Упаковка", "delivery"],
    ["Стоимость молоток ЛОТ без НДС", "auction"],
    ["Курс ЦБ", "auction"],
    ["Цена за ед. по курсу, ₽", "auction"],
    ["Ёлочная игрушка", "other"],
  ];
  for (const [l, k] of cases) ok(`группа «${l}» → ${k}`, classifyLabel(l) === k, `(${classifyLabel(l)})`);
  ok("единица $: «Цена за ед., $»", labelUnit("Цена за ед., $") === "$");
  ok("единица $: «(ам. долл.)»", labelUnit("Цена за ед. (ам. долл.)") === "$");
  ok("единица ₽: «, ₽», «(руб.)», «, руб.»", labelUnit("Выделка, ₽") === "₽" && labelUnit("Сумма (руб.)") === "₽" && labelUnit("Сумма, руб.") === "₽");
  ok("единица %: только «, %» в конце", labelUnit("Брокерская комиссия, %") === "%");
  ok("«Пошлина 5%», «Комиссия РМ, 4,5%» — ставка в подписи, не единица", labelUnit("Пошлина 5%") === null && labelUnit("Комиссия РМ, 4,5%") === null);
  ok("без единицы — null", labelUnit("Комиссия") === null);

  const items = [
    { label: "НДС 20%", value: 10 },
    { label: "Стоимость молоток ЛОТ без НДС", value: 1000 },
    { label: "Перевозка", value: 30 },
    { label: "Курс", value: 90 },
    { label: "Итого", value: 1130 },
  ];
  const g = groupBreakdownItems(items);
  ok("группы в порядке цепочки", g.map((x) => x.key).join(",") === "auction,delivery,vat,totals");
  ok("пустые группы не показываются", g.length === 4);
  ok("порядок внутри группы исходный", g[0].items[0].label === "Стоимость молоток ЛОТ без НДС" && g[0].items[1].label === "Курс");
  ok("все строки на месте, значения дословно", g.reduce((a, x) => a + x.items.length, 0) === items.length && g.flatMap((x) => x.items).reduce((a, x) => a + x.value, 0) === 2260);
  ok("заголовок группы из GROUPS", g[0].title === GROUPS[0].title);
  ok("пусто → пусто", groupBreakdownItems([]).length === 0);
}

// ───────────────────────── auction-cost-parts ─────────────────────────
{
  const cases: [string, string | null][] = [
    ["Расходы закупки, ₽", "expenses"],
    ["Итого себестоимость за единицу, ₽", null],
    ["Цена за ед. по курсу, ₽", null],
    ["Курс ЦБ на дату счёта", null],
    ["Аукционный сбор, маркетинговый сбор, сбор за доставку (10% от цены), ₽", "fees"],
    ["НДС на аукционный сбор, ₽", "feesVat"],
    ["НДС 22% на товар, ₽", "goodsVat"],
    ["Выделка (с НДС 22%), ₽", "processing"],
    ["Транспорт на выделку и обратно, ₽", "transport"],
    ["Брокерский %, 4,5% от цены, ₽", "broker"],
    ["Брок. % 3", "broker"],
    ["Комиссия за транзит денег, ₽", "transit"],
    ["Комиссия РМ, 4,5%", "commissionOther"],
    ["Таможня и таможенные платежи, ₽", "delivery"],
    ["Упаковка и прочее, ₽", "delivery"],
    ["Что-то ещё", "other"],
  ];
  for (const [l, k] of cases) ok(`часть «${l}» → ${k}`, partOfLabel(l) === k, `(${partOfLabel(l)})`);
}
{
  // лот из расчёта P (за единицу), 5 шт.: цена шкур 1000 × 5 = 5000, полная стоимость 2962 × 5 = 14810
  const r = lineParts({ items: JI, qty: 5, base: 5000, priceIncl: 6100, totalIncl: 14810, source: "plan" });
  const p = (k: string) => r.parts.find((x) => x.k === k);
  ok("части: цена шкур = база (5000)", p("goods")?.incl === 5000 && p("goods")?.excl === 5000);
  ok("части: сборы 100 × 5 = 500", p("fees")?.incl === 500 && p("fees")?.excl === 500);
  near("части: НДС на сборы 22 × 5 = 110, без НДС 0", p("feesVat")?.incl, 110);
  ok("части: НДС на сборы без НДС = 0", p("feesVat")?.excl === 0);
  near("части: НДС на шкуры 220 × 5 = 1100, без НДС 0", p("goodsVat")?.incl, 1100);
  ok("части: выделка 1220 × 5 = 6100", p("processing")?.incl === 6100);
  near("части: выделка без НДС = 6100 / 1,22 = 5000", p("processing")?.excl, 5000);
  ok("части: транспорт 150 × 5 = 750", p("transport")?.incl === 750);
  ok("части: таможня + упаковка (100 + 50) × 5 = 750", p("delivery")?.incl === 750);
  ok("части: брокер 250, транзит 250", p("broker")?.incl === 250 && p("transit")?.incl === 250);
  near("части: Σ с НДС = полная стоимость", r.parts.reduce((a, x) => a + x.incl, 0) + r.expIncl, 14810);
  near("части: Σ без НДС = полная стоимость без НДС (12500)", r.parts.reduce((a, x) => a + x.excl, 0), 12500);
  ok("части: расходов закупки нет", r.expIncl === 0);

  // разбивка не сходится с полной стоимостью → только цена шкур и НДС на них (6100 − 5000 = 1100)
  const bad = lineParts({ items: JI, qty: 5, base: 5000, priceIncl: 6100, totalIncl: 20000, source: "plan" });
  ok("не сходится → цена шкур + НДС на шкуры", bad.parts.length === 2 && bad.parts[1].k === "goodsVat" && bad.parts[1].incl === 1100 && bad.parts[1].excl === 0);
  // допуск: max(1 ₽, 0,02 %) → расхождение 0,5 ₽ принимается
  const tol = lineParts({ items: JI, qty: 5, base: 5000, priceIncl: 6100, totalIncl: 14810.5, source: "plan" });
  ok("расхождение в пределах допуска — разбивка принимается", tol.parts.length > 2);
  ok("источник «price» → без разбивки", lineParts({ items: JI, qty: 5, base: 5000, priceIncl: 6100, totalIncl: 14810, source: "price" }).parts.length === 2);
  ok("нет строк → без разбивки", lineParts({ items: [], qty: 5, base: 5000, priceIncl: 6100, totalIncl: 14810, source: "lot" }).parts.length === 2);
  ok("строки не массив → без разбивки", lineParts({ items: { a: 1 }, qty: 5, base: 5000, priceIncl: 6100, totalIncl: 14810, source: "lot" }).parts.length === 2);
  const noVat = lineParts({ items: [], qty: 1, base: 5000, priceIncl: 5000.004, totalIncl: 5000, source: "lot" });
  ok("НДС на шкуры меньше полкопейки — не показывается", noVat.parts.length === 1 && noVat.parts[0].k === "goods");
  // расходы закупки в строках: 10 × 2 = 20 входят в сверку; база 100, сборы 5 × 2 = 10, итого 130
  const ex = lineParts({ items: [{ label: "Расходы закупки, ₽", value: 10 }, { label: "Аукционный сбор", value: 5 }, { label: "мусор", value: "x" }, { value: 3 }], qty: 2, base: 100, priceIncl: 100, totalIncl: 130, source: "lot" });
  ok("расходы закупки — отдельно (20)", ex.expIncl === 20 && ex.parts.length === 2 && ex.parts[1].k === "fees" && ex.parts[1].incl === 10);
  // выделка с НДС 20 % в подписи: 120 → без НДС 100
  const dr = lineParts({ items: [{ label: "Выделка с НДС 20%", value: 120 }], qty: 1, base: 0, priceIncl: 0, totalIncl: 120, source: "lot" });
  near("выделка «с НДС 20%»: без НДС = 120 / 1,2", dr.parts.find((x) => x.k === "processing")?.excl, 100);
  const dr2 = lineParts({ items: [{ label: "Выделка", value: 120 }], qty: 1, base: 0, priceIncl: 0, totalIncl: 120, source: "lot" });
  ok("выделка без ставки в подписи: без НДС = с НДС", dr2.parts.find((x) => x.k === "processing")?.excl === 120);
}
{
  const r1parts = lineParts({ items: JI, qty: 5, base: 5000, priceIncl: 6100, totalIncl: 14810, source: "plan" }).parts;
  const rows: PartsRow[] = [
    { totalIncl: 14810, totalExcl: 12500, parts: r1parts, expIncl: 0, purchaseId: "P1" },
    { totalIncl: 1500, totalExcl: 1250, parts: [{ k: "goodsVat", incl: 220, excl: 0 }, { k: "goods", incl: 1000, excl: 1000 }], expIncl: 0, purchaseId: "P2" },
  ];
  const a = aggregateCostParts(rows, new Map());
  ok("свод: итоги — сумма лотов", a.totalIncl === 16310 && a.totalExcl === 13750);
  ok("свод: порядок частей по PART_META (шкуры первыми)", a.lines[0].key === "goods" && a.lines[1].key === "goodsVat");
  ok("свод: цена шкур 5000 + 1000", a.lines[0].incl === 6000);
  near("свод: НДС на шкуры 1100 + 220", a.lines[1].incl, 1320);
  const un = a.lines[a.lines.length - 1];
  // 16310 − (14810 + 1220) = 280; 13750 − (12500 + 1000) = 250
  ok("свод: последняя строка «Не разложено»", un.key === "unresolved" && un.kind === "unresolved");
  near("свод: не разложено с НДС = 280", un.incl, 280);
  near("свод: не разложено без НДС = 250", un.excl, 250);
  near("свод: Σ строк с НДС = итог", a.lines.reduce((s, x) => s + x.incl, 0), a.totalIncl);
  near("свод: Σ строк без НДС = итог", a.lines.reduce((s, x) => s + x.excl, 0), a.totalExcl);
  ok("свод: без закупок-черновиков", a.unallocatedIncl === 0 && a.unallocatedExcl === 0 && !a.skippedUnallocated);
}
{
  // закупка с распределёнными расходами 1000 (без НДС 800): 600/480 логистика, 400/320 банк; лот несёт 100 из них
  const P3: PartsPurchase = { id: "P3", unallocated: false, expIncl: 1000, expExcl: 800, expenses: [{ name: "Логистика", incl: 600, excl: 480 }, { name: "Банк", incl: 400, excl: 320 }], lineCount: 2 };
  const rows: PartsRow[] = [{ totalIncl: 1100, totalExcl: 1080, parts: [{ k: "goods", incl: 1000, excl: 1000 }], expIncl: 100, purchaseId: "P3" }];
  const a = aggregateCostParts(rows, new Map([["P3", P3]]));
  const lg = a.lines.find((x) => x.key === "exp:Логистика"), bk = a.lines.find((x) => x.key === "exp:Банк");
  // доля лота 100 / 1000: логистика 60, банк 40; без НДС: 100 × 0,8 = 80 → 480/800 × 80 = 48, 320/800 × 80 = 32
  near("расходы: логистика с НДС = 600 × 100/1000", lg?.incl, 60);
  near("расходы: логистика без НДС = 48", lg?.excl, 48);
  near("расходы: банк 40 / 32", (bk?.incl ?? 0) + (bk?.excl ?? 0), 72);
  ok("расходы: подпись строки", lg?.title === "Расходы закупки: Логистика" && lg?.kind === "expense");
  const un = a.lines[a.lines.length - 1];
  near("расходы: не разложено с НДС = 0", un.incl, 0);
  near("расходы: не разложено без НДС = 0", un.excl, 0);
  const none = aggregateCostParts([{ ...rows[0], expIncl: 0 }], new Map([["P3", P3]]));
  ok("лот без своей доли расходов — строк расходов нет", !none.lines.some((x) => x.kind === "expense"));
}
{
  // закупка-черновик: расходы 300 (без НДС 250) добавляются к итогу, только если выбраны все её лоты (2)
  const P4: PartsPurchase = { id: "P4", unallocated: true, expIncl: 300, expExcl: 250, expenses: [{ name: "Таможня", incl: 300, excl: 250 }], lineCount: 2 };
  const row = (): PartsRow => ({ totalIncl: 100, totalExcl: 100, parts: [{ k: "goods", incl: 100, excl: 100 }], expIncl: 0, purchaseId: "P4" });
  const all = aggregateCostParts([row(), row()], new Map([["P4", P4]]));
  ok("черновик, выбраны все лоты: расходы в итоге", all.totalIncl === 500 && all.totalExcl === 450 && all.unallocatedIncl === 300 && all.unallocatedExcl === 250);
  ok("черновик: строка расходов «Таможня»", all.lines.some((x) => x.key === "exp:Таможня" && x.incl === 300 && x.excl === 250));
  near("черновик: не разложено = 0", all.lines[all.lines.length - 1].incl, 0);
  const part = aggregateCostParts([row()], new Map([["P4", P4]]));
  ok("черновик, выбрана часть лотов: расходы пропущены с пометкой", part.skippedUnallocated && part.totalIncl === 100 && part.unallocatedIncl === 0 && !part.lines.some((x) => x.kind === "expense"));
  const empty = aggregateCostParts([], new Map());
  ok("пустой свод: одна строка «Не разложено» с нулём", empty.lines.length === 1 && empty.lines[0].incl === 0 && empty.totalIncl === 0);
}

// ───────────────────────── lot-sheet-calc ─────────────────────────
{
  const t = toRows([{ label: "  Комиссия ", value: "5", cat: "agent" }, { label: 1, value: 2 }, { label: "X", value: "abc" }, { label: "Y", value: 3, cat: "bad" }]);
  ok("toRows: только корректные строки", t.rows.length === 2 && t.orig.join(",") === "0,3");
  ok("toRows: подпись обрезана, значение числом", t.rows[0].label === "Комиссия" && t.rows[0].value === 5);
  ok("toRows: категория только допустимая", t.rows[0].cat === "agent" && t.rows[1].cat === null);
}
// «Лотовый» лист: 10 шкур, $10 × 90 × 10 = 9000 молоток без НДС, НДС лота 20 % (1800).
// Цена лота = 9000 + 1800 + 600 + 1000 + 400 + 500 = 13300.
const lotSheet = (): RawItem[] => [
  { label: "Цена за ед. (ам. долл.)", value: 10 },
  { label: "Курс", value: 90 },
  { label: "Стоимость молоток ЛОТ без НДС", value: 9000 },
  { label: "Стоимость молоток за ед без НДС", value: 900 },
  { label: "Стоимость молоток за ед в т.ч. НДС", value: 1080 },
  { label: "НДС на товар", value: 1800 },
  { label: "Услуги Аукциона в т.ч. НДС", value: 600 },
  { label: "Выделка (тонировка / тортора) в т.ч. НДС", value: 1000 },
  { label: "Перевозка в т.ч. НДС", value: 400 },
  { label: "Комиссия", value: 500 },
  { label: "Итого за готовое сырье к оплате в т.ч. НДС", value: 13300 },
  { label: "Итого себестоимость за единицу", value: 1330 },
];
const cLot: CompInput = { breakdown: null, vatRate: 20, qty: 10, totalIncl: 13300 };
const val = (r: RawItem[], i: number) => Number(r[i].value);
{
  const src = lotSheet();
  // Комиссия 500 → 700: цена лота +200; итог +200; за единицу +200/10 = +20
  const r = applyRowEdits(src, [{ idx: 9, value: 700 }], cLot);
  near("лист lot: правка комиссии +200 → Δ цены 200", r.deltaT, 200);
  ok("лист lot: итог с НДС 13300 → 13500", val(r.items, 10) === 13500);
  ok("лист lot: за единицу 1330 → 1350", val(r.items, 11) === 1350);
  ok("лист lot: правленая строка = 700", val(r.items, 9) === 700);
  ok("лист lot: исходный массив не изменён", val(src, 9) === 500 && val(src, 10) === 13300);
}
{
  // молоток 9000 → 9900 (×1,1): Δ цены = 900 × 1,2 = 1080
  const r = applyRowEdits(lotSheet(), [{ idx: 2, value: 9900 }], cLot);
  near("молоток +900 → Δ цены 900 × (1 + 20 %) = 1080", r.deltaT, 1080);
  near("молоток за ед без НДС = 9900 / 10", val(r.items, 3), 990);
  near("молоток за ед с НДС × 1,1 = 1188", val(r.items, 4), 1188);
  near("НДС на товар × 1,1 = 1980", val(r.items, 5), 1980);
  near("цена в $ пересчитана: 10 × 9900/9000 = 11", val(r.items, 0), 11);
  ok("курс не меняется", val(r.items, 1) === 90);
  near("итог с НДС 13300 + 1080", val(r.items, 10), 14380);
  near("за единицу 1330 + 108", val(r.items, 11), 1438);
  ok("прочие строки не тронуты", val(r.items, 6) === 600 && val(r.items, 9) === 500);
}
{
  // цена в $ 10 → 11: молоток = 11 × 90 × 10 = 9900, Δ = 1080
  const r = applyRowEdits(lotSheet(), [{ idx: 0, value: 11 }], cLot);
  ok("правка $: молоток = $ × курс × кол-во", val(r.items, 2) === 9900);
  near("правка $: Δ цены 1080", r.deltaT, 1080);
  ok("правка $: заметка о пересчёте", r.notes.length === 1 && r.notes[0].includes("Молоток лота пересчитан"));
  ok("правка $: сама строка $ = 11", val(r.items, 0) === 11);
  // курс 90 → 100: молоток 10 × 100 × 10 = 10000, Δ = 1000 × 1,2 = 1200; $ не трогается
  const k = applyRowEdits(lotSheet(), [{ idx: 1, value: 100 }], cLot);
  ok("правка курса: молоток 10000", val(k.items, 2) === 10000);
  near("правка курса: Δ цены 1200", k.deltaT, 1200);
  ok("правка курса: $ остаётся 10", val(k.items, 0) === 10);
}
{
  // лист «не сходится»: $10 × 80 × 10 = 8000 ≠ 9000 → правка $ молоток не трогает и цену не меняет
  const s = lotSheet();
  s[1].value = 80;
  const r = applyRowEdits(s, [{ idx: 0, value: 11 }], cLot);
  ok("несогласованный лист: молоток не пересчитан", val(r.items, 2) === 9000 && r.notes.length === 0);
  ok("несогласованный лист: Δ цены 0", r.deltaT === 0);
}
{
  // правка только названия/категории/источника: цена не меняется
  const r = applyRowEdits(lotSheet(), [{ idx: 9, title: "Вознаграждение", cat: "mediator", src: "Drive" }], cLot);
  ok("правка подписи: Δ 0, итоги не меняются", r.deltaT === 0 && val(r.items, 10) === 13300);
  ok("правка подписи: заметки сохранены", r.items[9].title === "Вознаграждение" && r.items[9].cat === "mediator" && r.items[9].src === "Drive");
  const back = applyRowEdits(r.items, [{ idx: 9, title: "Комиссия", cat: "", src: "" }], cLot);
  ok("название = подписи и пустые значения → заметки удаляются", !("title" in back.items[9]) && !("cat" in back.items[9]) && !("src" in back.items[9]));
  const same = applyRowEdits(lotSheet(), [{ idx: 9, value: 500 }, { idx: 99, value: 1 }, { idx: 6, value: NaN }], cLot);
  ok("то же значение, чужой индекс, NaN — ничего не меняется", same.deltaT === 0 && val(same.items, 6) === 600 && val(same.items, 10) === 13300);
}
{
  ok("якорь листа lot — строка молотка", anchorIndex(lotSheet(), cLot) === 2);
  // цена лота должна вырасти на 1080: наклон 1,2 → молоток +900
  const r = pushPriceDelta(lotSheet(), 1080, cLot);
  ok("сдвиг цены: привязан к молотку", r.anchored);
  near("сдвиг цены: молоток 9000 + 1080/1,2 = 9900", val(r.items, 2), 9900, 1e-6);
  near("сдвиг цены: Δ = 1080", r.deltaT, 1080);
  near("сдвиг цены: итог 14380", val(r.items, 10), 14380, 1e-6);
  const tiny = pushPriceDelta(lotSheet(), 0.001, cLot);
  ok("сдвиг меньше полкопейки — ничего", !tiny.anchored && tiny.deltaT === 0 && val(tiny.items, 2) === 9000);
  const unk = pushPriceDelta([{ label: "Что-то", value: 5 }], 100, cLot);
  ok("нераспознанный лист — без якоря", !unk.anchored && unk.deltaT === 0 && anchorIndex([{ label: "Что-то", value: 5 }], cLot) === null);
}
{
  // лист «plan» из расчёта P: 5 шт., состав = 14810
  const plan = (): RawItem[] => JI.map((x) => ({ ...x }));
  const cPlan: CompInput = { breakdown: null, vatRate: 22, qty: 5, totalIncl: 14810 };
  const iDress = findIdx(JI, "Выделка"), iTotal = findIdx(JI, "Итого себестоимость"), iRub = findIdx(JI, "Цена за ед. по курсу");
  // выделка 1220 → 1320 за шкуру: Δ = 100 × 5 = 500; итог за единицу +100
  const r = applyRowEdits(plan(), [{ idx: iDress, value: 1320 }], cPlan);
  near("лист plan: выделка +100 за шкуру → Δ 500", r.deltaT, 500);
  near("лист plan: итог за единицу 2962 → 3062", val(r.items, iTotal), 3062);
  ok("якорь листа plan — цена по курсу", anchorIndex(plan(), cPlan) === iRub);
  // цена лота +500: наклон 5 (за шкуру × 5) → цена по курсу 1000 + 100
  const p = pushPriceDelta(plan(), 500, cPlan);
  near("лист plan: сдвиг цены → цена по курсу 1100", val(p.items, iRub), 1100, 1e-6);
  near("лист plan: сдвиг цены → итог за единицу 3062", val(p.items, iTotal), 3062, 1e-6);
  const t = applyRowEdits(plan(), [{ idx: iTotal, value: 3000 }], cPlan);
  ok("лист plan: правка итога — справочная, Δ 0", t.deltaT === 0 && val(t.items, iTotal) === 3000);
}
{
  // лист из одних итогов: цену задаёт правка «Итого … в т.ч. НДС» (1000 → 1200)
  const r = applyRowEdits([{ label: "Итого за готовое сырье к оплате в т.ч. НДС", value: 1000 }], [{ idx: 0, value: 1200 }], cLot);
  ok("лист из итогов: Δ = 200, строка не сдвигается дважды", r.deltaT === 200 && val(r.items, 0) === 1200);
  const u = applyRowEdits([{ label: "Что-то", value: 5 }], [{ idx: 0, value: 7 }], cLot);
  ok("нераспознанный лист: Δ нет, пояснение", u.deltaT === null && u.notes.length === 1 && val(u.items, 0) === 7);
}
{
  // количество ×0,5: суммы «за лот» делятся, «за шкуру», $ и курс — нет
  const s = scaleLotRows(lotSheet(), 0.5, cLot);
  ok("масштаб: молоток лота 4500, НДС на товар 900", val(s, 2) === 4500 && val(s, 5) === 900);
  ok("масштаб: аукцион, выделка, перевозка, комиссия ×0,5", val(s, 6) === 300 && val(s, 7) === 500 && val(s, 8) === 200 && val(s, 9) === 250);
  ok("масштаб: итог за лот 6650", val(s, 10) === 6650);
  ok("масштаб: $, курс, «за ед», «за единицу» не меняются", val(s, 0) === 10 && val(s, 1) === 90 && val(s, 3) === 900 && val(s, 4) === 1080 && val(s, 11) === 1330);
  const m = scaleLotRows([{ foo: 1 }, { label: "Комиссия", value: 100 }, { label: "Стоимость молоток ЛОТ без НДС", value: 1000 }], 2, cLot);
  ok("масштаб: индексы с учётом пропущенных строк", (m[0] as { foo?: number }).foo === 1 && val(m, 1) === 200 && val(m, 2) === 2000);
}

console.log(fails ? `\nПровалов: ${fails} из ${checks}` : `\nВсё в порядке (${checks} проверок)`);
process.exit(fails ? 1 : 0);
