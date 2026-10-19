// Cashflow: сверка трат с «Оплачено всего», правило «Без НДС», единицы и деньги поступлений/продаж с итогами файла выгрузки, остаток = приход − продажи.
// Только чтение. Если выгрузка ещё не загружена (нет таблицы/строк) — проверки продаж пропускаются.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-cashflow-sales.ts
import "./stubs/server-only-shim";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { loadPaymentsOverview } from "../src/lib/payments-overview";
import { cashflowYears, currentMonthMsk, parsePeriod, PROJECT_START_MONTH, workMonthIdx, aggregateSales, buildCashflow, workByClass, goodsHeadline, headline, monthsOf, seriesOf, sliceData, sliceSales, stockSeries, vatShares, visibleMonths, workPaymentVatRate } from "../src/lib/cashflow";
import { workKindsByMonth, workWindowStats, burnRate, flowPoints, groupSales, paybackMonths, payLites, spendByArticle, spendByType, topPays, workByTz } from "../src/lib/cashflow-detail";
import { kindTotals } from "../src/lib/pay-kinds";
import { payDue } from "../src/lib/pay-display";
import { loadOrderClasses, loadPurchaseVat, loadSalesLines } from "../src/lib/cashflow-server";
import { isDiscountOnlyLine, modelCodeOfArticle, normCode, parseSheetRow } from "../src/lib/sales-receipts-core";

const prisma = new PrismaClient();
let fails = 0, checks = 0;
const eq = (what: string, got: number, want: number, tol = 0.01) => {
  checks++;
  if (Math.abs(got - want) > tol) { fails++; console.log(`  ✗ ${what}: ${got} ≠ ${want} (Δ ${(got - want).toFixed(4)})`); }
};
const ok = (what: string, cond: boolean) => { checks++; if (!cond) { fails++; console.log(`  ✗ ${what}`); } };
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

(async () => {
  // Нормализация кода модели.
  ok("код: M001A/SABLE → M001A", modelCodeOfArticle("M001A/SABLE WILD SILVER 4-5") === "M001A");
  ok("код: MH-07 SABLE → MH07", modelCodeOfArticle("MH-07 SABLE") === "MH07");
  ok("код: MSC-02 WILD SABLE SIL 3 → MSC02", modelCodeOfArticle("MSC-02 WILD SABLE SIL 3") === "MSC02");
  ok("код: M057/ SABLE → M057", modelCodeOfArticle("M057/ SABLE WILD SIL 5") === "M057");
  ok("код: кириллица М029 = M029", normCode("М029") === "M029" && normCode("МН11") === "MH11");

  // Годы и месяцы растут сами; граница месяца — по Москве.
  ok("[годы] 2026 → 2025–2026", cashflowYears(2026).join() === "2025,2026");
  ok("[годы] 2027 → добавляется сам", cashflowYears(2027).join() === "2025,2026,2027");
  ok("[период] мусор → all", parsePeriod("1999") === "all" && parsePeriod("abc") === "all" && parsePeriod("2025") === "2025");
  ok("[МСК] 30.09 21:30 UTC уже октябрь", currentMonthMsk(new Date("2026-09-30T21:30:00Z")) === "2026-10");
  ok("[МСК] 30.09 20:30 UTC ещё сентябрь", currentMonthMsk(new Date("2026-09-30T20:30:00Z")) === "2026-09");
  const org = (await prisma.organization.findFirst())!.id;
  const [ov, pv, lines] = await Promise.all([loadPaymentsOverview(org), loadPurchaseVat(org), loadSalesLines(org)]);
  const sumAll = sum(ov.map((r) => r.amount));
  const incl = buildCashflow(ov, "all");
  eq("[траты] Σ Cashflow + вне периода = «Оплачено всего»", incl.total + incl.outside, sumAll);
  const vs = vatShares(ov, pv);
  const ex = buildCashflow(ov, "all", vs.share);
  // НДС в оплате работы (счета Веллмеха: «В том числе НДС r%: X», X = сумма × r / (100 + r); ставка по дате счёта: до 2026 — 20 %, с 2026 — 22 %).
  {
    const ppRows = await prisma.productionPayment.findMany({ where: { status: "COMPLETED", amount: { not: 0 } }, select: { amount: true, docRef: true } });
    let want = 0, nNoRate = 0;
    for (const p of ppRows) { const m = /сч[её]т[^№;·]*№\s*[^\s;·,()]+\s+от\s+\d{2}\.\d{2}\.(\d{4})/i.exec(p.docRef ?? ""); if (!m) { nNoRate++; continue; } const r = Number(m[1]) <= 2025 ? 20 : 22; want += (p.amount.toNumber() * r) / (100 + r); }
    eq("[НДС работы] Σ НДС оплат производства = независимый пересчёт по счетам", vs.workVat, want, 0.01);
    eq("[НДС работы] у всех оплат производства есть счёт в основании (ставка известна)", nNoRate, 0, 0);
    const prodRows = ov.filter((r) => r.kind === "prod");
    ok("[НДС работы] доля НДС строк производства = 1/6 (2025) или 11/61 (2026)", prodRows.every((r) => { const f = vs.share.get(r.id) ?? 0; return Math.abs(f - 1 / 6) < 1e-9 || Math.abs(f - 22 / 122) < 1e-9; }));
    ok("[НДС работы] workPaymentVatRate: по дате счёта", workPaymentVatRate("п/п №1; Счёт №235 от 04.12.2025") === 20 && workPaymentVatRate("Счёт №1 от 15.01.2026 · работа") === 22 && workPaymentVatRate("без счёта") === null);
    // документальная проверка правила на реестре счетов: напечатанный в счёте НДС = сумма × r/(100+r) и ставка = ставка по дате
    const reg = JSON.parse(readFileSync(join(__dirname, "../src/data/reconciliation.json"), "utf8")) as { invoices: { section: string; no: string; date: string; amountRub: number; purpose: string }[] };
    let nDoc = 0;
    for (const inv of reg.invoices.filter((i) => i.section === "production")) {
      const m = /НДС\s*(20|22)\s*%\s*([\d\s]+(?:,\d+)?)/.exec(inv.purpose);
      if (!m) continue;
      nDoc++;
      const r = Number(m[1]), stated = Number(m[2].replace(/\s/g, "").replace(",", "."));
      eq(`[НДС работы] счёт №${inv.no}: НДС в счёте = сумма × ${r}/${100 + r}`, stated, (inv.amountRub * r) / (100 + r), 0.02);
      ok(`[НДС работы] счёт №${inv.no}: ставка ${r}% = ставка по дате ${inv.date}`, r === (inv.date < "2026-01-01" ? 20 : 22));
    }
    ok("[НДС работы] в реестре есть счета с напечатанным НДС (≥ 20)", nDoc >= 20);
  }
  eq("[без НДС] Σ без НДС + НДС платежей = Σ с НДС", ex.total + ex.outside + vs.vat, sumAll);
  ok("[без НДС] НДС между 0 и 22% суммы", vs.vat >= 0 && vs.vat <= sumAll * 0.22 / 1.22 + 1);
  ok("[без НДС] сумма без данных об НДС ≤ суммы платежей", vs.unknown >= -0.01 && vs.unknown <= sumAll + 0.01);
  for (const [i, m] of incl.months.entries()) {
    const want = sum(ov.filter((r) => r.iso.startsWith(m)).map((r) => r.amount - vs.vat * 0 - (vs.share.get(r.id) ?? 0) * r.amount));
    eq(`[без НДС] ${m}: Σ статей = Σ платежей месяца без НДС`, ex.monthTotals[i], want, 0.05);
  }
  eq("[срез] 2025 + 2026 = всё", sliceData(incl, incl.months.map((x, i) => (x.startsWith("2025") ? i : -1)).filter((i) => i >= 0)).total + sliceData(incl, incl.months.map((x, i) => (x.startsWith("2026") ? i : -1)).filter((i) => i >= 0)).total, incl.total);

  const months = monthsOf("all");
  // Работа по категориям: Σ классов = статья «Работа» по месяцам; неразнесённое не теряется.
  const wc = workByClass(ov, await loadOrderClasses(org), months);
  const workArt = incl.articles.find((a) => a.key === "work")?.byMonth ?? months.map(() => 0);
  for (const [i, m] of months.entries()) eq(`[категории] ${m}: работа одежда+аксессуары+прочее = работа всего`, wc.clothes[i] + wc.acc[i] + wc.other[i], workArt[i], 0.05);
  ok("[категории] неразнесённая работа входит в «прочее»", wc.unlinked.every((v, i) => v <= wc.other[i] + 0.005));
  // Виды платежей: Σ видов = «Оплачено всего» (одно множество видов в «Оплатах» и «Потрачено»).
  { const kt = kindTotals(ov); eq("[виды] Σ видов = Оплачено всего", sum(Object.values(kt).map((x) => x.total)), sumAll, 0.01); eq("[виды] Σ числа платежей = числу платежей", sum(Object.values(kt).map((x) => x.count)), ov.length, 0); }
  // «К доплате после зачёта аванса»: нетто = брутто − аванс (не меньше 0), остаток аванса в зачёте.
  eq("[к доплате] 7 495 755 + 9 354 005 − 15 111 600 = 1 738 160", payDue(7495755 + 9354005, 15111600).net, 1738160, 0);
  eq("[к доплате] аванс больше долга: нетто 0, остаток аванса", payDue(100, 250).creditLeft, 150, 0);
  eq("[к доплате] нетто не меньше нуля", payDue(100, 250).net, 0, 0);
  // Детали плиток: суммы деталей = значение плитки.
  const pl = payLites(ov, vs.share);
  eq("[детали] Σ по видам платежа = Потрачено (с НДС)", sum(spendByType(pl, incl.months, false).map((r) => r.total)), incl.total);
  eq("[детали] Σ по видам платежа = Потрачено (без НДС)", sum(spendByType(pl, ex.months, true).map((r) => r.total)), ex.total, 0.05);
  eq("[детали] Σ по статьям = Потрачено", sum(incl.articles.map((a) => a.total)), incl.total);
  ok("[детали] топ-5 платежей отсортированы и не больше 5", topPays(pl, incl.months, false).length <= 5 && topPays(pl, incl.months, false).every((p, i, a) => i === 0 || a[i - 1].amount >= p.amount));
  const sc0 = (c: "clothes" | "acc" | "other") => aggregateSales(lines, months, c).recPcs;
  const s = aggregateSales(lines, months);
  // Метрики работы: месяцы от PROJECT_START_MONTH до текущего включительно; ничего раньше августа 2025 (работа и приход).
  eq("[работа] N месяцев авг 2025 – окт 2026 = 15", workMonthIdx(months, "2026-10", "all").length, 15, 0);
  eq("[работа] 2026: янв–окт = 10", workMonthIdx(months, "2026-10", "2026").length, 10, 0);
  eq("[работа] 2025: авг–дек = 5", workMonthIdx(months, "2026-10", "2025").length, 5, 0);
  ok("[работа] первая оплата работы и первый приход не раньше PROJECT_START_MONTH", months.every((m, i) => m >= PROJECT_START_MONTH || (Math.abs(workArt[i]) < 0.005 && s.recPcs[i] === 0)));
  {
    const idx = workMonthIdx(months, "2026-10", "all");
    const wsum = (a: number[]) => idx.reduce((t, i) => t + a[i], 0);
    eq("[работа] Σ категорий + прочее = всего (месяцы проекта)", wsum(wc.clothes) + wsum(wc.acc) + wsum(wc.other), wsum(workArt), 0.05);
    eq("[работа] Σ единиц категорий = всего (месяцы проекта)", wsum(sc0("clothes")) + wsum(sc0("acc")) + wsum(sc0("other")), wsum(s.recPcs), 0);
  }
  const plc = payLites(ov, vs.share, await loadOrderClasses(org));
  for (const a of incl.articles) {
    const di = spendByArticle(plc, incl.months, false, a.key), de = spendByArticle(plc, ex.months, true, a.key);
    eq(`[статья] ${a.key}: итог по платежам = в таблице (с НДС)`, di.total, a.total, 0.05);
    eq(`[статья] ${a.key}: Σ по видам = итог`, sum(di.byType.map((t) => t.total)), di.total, 0.01);
    eq(`[статья] ${a.key}: Σ по месяцам = итог`, sum(di.byMonth.map((t) => t.total)), di.total, 0.01);
    eq(`[статья] ${a.key}: итог по платежам = в таблице (без НДС)`, de.total, ex.articles.find((x) => x.key === a.key)?.total ?? 0, 0.05);
  }
  { const wk = workKindsByMonth(plc, incl.months, "all"); const wsum = Object.values(wk).reduce((t, a) => t + a.reduce((x, y) => x + y, 0), 0);
    eq("[работа по видам] Σ видов = работа всего", wsum, incl.articles.find((a) => a.key === "work")?.total ?? 0, 0.05);
    for (const c of ["clothes", "acc"] as const) eq(`[работа по видам] ${c}: Σ видов = работа категории`, Object.values(workKindsByMonth(plc, incl.months, c)).reduce((t, a) => t + a.reduce((x, y) => x + y, 0), 0), wc[c].reduce((x, y) => x + y, 0), 0.05);
    for (const [i, m] of incl.months.entries()) eq(`[работа по видам] ${m}: Σ видов = работа месяца`, wk.ADVANCE[i] + wk.PARTIAL[i] + wk.FINAL[i] + wk.OTHER[i], workArt[i], 0.05); }
  eq("[работа] Σ ТЗ + неразнесённое = работа в таблице", workByTz(plc, incl.months, "all").total, incl.articles.find((a) => a.key === "work")?.total ?? 0, 0.05);
  eq("[работа] одежда+аксессуары+прочее = всё", workByTz(plc, incl.months, "clothes").total + workByTz(plc, incl.months, "acc").total + workByTz(plc, incl.months, "other").total, workByTz(plc, incl.months, "all").total, 0.05);
  const saleOnly = lines.filter((l) => l.kind === "SALE");
  for (const [cat, f] of [["all", s], ["clothes", aggregateSales(lines, months, "clothes")], ["acc", aggregateSales(lines, months, "acc")]] as const) {
    eq(`[детали] Σ выручки по сезонам = Получено (${cat}, с НДС)`, sum(groupSales(saleOnly, months, false, (l) => l.season, cat).map((g) => g.rev)), sum(f.revIncl), 0.01);
    eq(`[детали] Σ выручки по артикулам = Получено (${cat}, без НДС)`, sum(groupSales(saleOnly, months, true, (l) => l.article, cat).map((g) => g.rev)), sum(f.revEx), 0.01);
    eq(`[детали] Σ шт. по месяцам = Продано (${cat})`, sum(groupSales(saleOnly, months, false, (l) => l.iso.slice(0, 7), cat).map((g) => g.pcs)), sum(f.salePcs), 0);
  }
  for (const exm of [false, true]) {
    const g = groupSales(saleOnly, months, exm, () => "x", "all")[0];
    if (g) eq(`[цена] средняя = выручка ÷ шт. (${exm ? "без НДС" : "с НДС"})`, g.rev / g.pcs, sum(saleOnly.map((l) => (exm ? l.retailRubExVat : l.retailRub))) / sum(saleOnly.map((l) => l.pcs)), 1e-6);
  }
  eq("[детали] burn rate = среднее последних 3 месяцев", burnRate([0, 10, 20, 30, 0, 0], 3) ?? NaN, 20, 1e-9);
  eq("[детали] срок возврата = минус ÷ средний поток", paybackMonths(-300, [0, 50, 100, 150], 3) ?? NaN, 3, 1e-9);
  ok("[детали] срок возврата: нет оценки при отрицательном потоке", paybackMonths(-300, [-10, -20], 3) === null);
  eq("[детали] первая положительная и просадка", flowPoints(["a", "b", "c"], [-5, 3, 2], [-5, -2, 0]).drawdown, 0, 1e-9);
  const sc = { clothes: aggregateSales(lines, months, "clothes"), acc: aggregateSales(lines, months, "acc"), other: aggregateSales(lines, months, "other") };
  for (const [k, f] of [["recPcs", (x: typeof s) => x.recPcs], ["salePcs", (x: typeof s) => x.salePcs], ["revIncl", (x: typeof s) => x.revIncl], ["revEx", (x: typeof s) => x.revEx]] as const) {
    eq(`[категории] Σ одежда+аксессуары+прочее = всё (${k})`, sum(f(sc.clothes)) + sum(f(sc.acc)) + sum(f(sc.other)), sum(f(s)), 0.01);
    for (const [i, m] of months.entries()) eq(`[категории] ${m} ${k}`, f(sc.clothes)[i] + f(sc.acc)[i] + f(sc.other)[i], f(s)[i], 0.01);
  }
  if (s.available) console.log(`Категории (шт. прихода / продано / выручка с НДС): одежда ${sum(sc.clothes.recPcs)} / ${sum(sc.clothes.salePcs)} / ${Math.round(sum(sc.clothes.revIncl))}; аксессуары ${sum(sc.acc.recPcs)} / ${sum(sc.acc.salePcs)} / ${Math.round(sum(sc.acc.revIncl))}; прочее ${sum(sc.other.recPcs)} / ${sum(sc.other.salePcs)}`);
  console.log(`Работа: одежда ${Math.round(sum(wc.clothes))}, аксессуары ${Math.round(sum(wc.acc))}, прочее ${Math.round(sum(wc.other))} (из них без привязки к ТЗ ${Math.round(sum(wc.unlinked))}); всего ${Math.round(sum(workArt))}`);
  if (!s.available) { console.log("Выгрузка продаж не загружена — проверки продаж пропущены."); }
  else {
    const rec = lines.filter((l) => l.kind === "RECEIPT"), sale = lines.filter((l) => l.kind === "SALE");
    eq("[единицы] Σ по месяцам = Σ строк поступлений", sum(s.recPcs), sum(rec.map((l) => l.pcs)));
    eq("[единицы] Σ по месяцам = Σ строк продаж", sum(s.salePcs), sum(sale.map((l) => l.pcs)));
    eq("[деньги] Σ по месяцам с НДС = Σ строк", sum(s.revIncl), sum(sale.map((l) => l.retailRub)));
    eq("[деньги] Σ по месяцам без НДС = Σ строк", sum(s.revEx), sum(sale.map((l) => l.retailRubExVat)));
    // «Продано»: на плитке НЕТТО; валовое и возвраты — отдельно (решение владельца 2026-10-20).
    eq("[продано] нетто = валовое − возвраты (по месяцам Σ)", sum(s.salePcs), sum(s.grossPcs) - sum(s.returnsPcs), 0);
    eq("[продано] валовое = Σ положительных строк продаж", sum(s.grossPcs), sum(sale.filter((l) => l.pcs > 0).map((l) => l.pcs)), 0);
    eq("[продано] возвраты шт. = Σ |строк с минусом|", sum(s.returnsPcs), -sum(sale.filter((l) => l.pcs < 0).map((l) => l.pcs)), 0);
    eq("[продано] возвраты ₽ с НДС = Σ |минусовых строк|", sum(s.returnsRub), -sum(sale.filter((l) => l.pcs < 0).map((l) => l.retailRub)), 0.01);
    { const g0 = goodsHeadline(s, months, "all"); eq("[продано] плитка товара: нетто = валовое − возвраты", g0.sold, g0.grossSold - g0.returnsPcs, 0); eq("[продано] возвраты в деталях = возвраты в рядах", g0.returnsRub, sum(s.returnsRub), 0.01);
      const gg = groupSales(saleOnly, months, false, () => "x", "all")[0]; if (gg) { eq("[продано] детали: нетто = валовое − возвраты", gg.pcs, gg.grossPcs - gg.returnsPcs, 0); eq("[продано] детали: возвраты ₽ = ряды", gg.returnsRub, sum(s.returnsRub), 0.01); }
      const hh = headline(incl, s, s.revIncl); eq("[продано] headline: нетто = валовое − возвраты", hh.unitsSold, hh.unitsGross - hh.unitsReturns, 0); }
    // Заказ 155627: строки «только скидка» не дают ни штук, ни выручки (правило — в sales-receipts-core.ts, isDiscountOnlyLine).
    { const only = sale.filter((l) => isDiscountOnlyLine(l)); if (lines.length === 523) { eq("[155627] строк «только скидка»", only.length, 18, 0); eq("[155627] штук и розницы в них нет", sum(only.map((l) => Math.abs(l.pcs) + Math.abs(l.retailRub))), 0, 0); eq("[155627] скидка в них, ₽ с НДС", sum(only.map((l) => l.discountRub)), 2450163.87, 0.01); }
      eq("[155627] «Получено» не зависит от строк «только скидка»", sum(s.revIncl), sum(sale.filter((l) => !isDiscountOnlyLine(l)).map((l) => l.retailRub)), 0.01); }
    const st = stockSeries(s);
    eq("[остаток] на конец = приход − продажи", st.stock[st.stock.length - 1], sum(s.recPcs) - sum(s.salePcs), 0);
    const g = goodsHeadline(s, months, "all");
    eq("[товар] остаток плитки = приход − продажи", g.stock, sum(s.recPcs) - sum(s.salePcs), 0);
    // Независимый пересчёт показателей периода.
    const keep = visibleMonths(incl, s, "all");
    const d = sliceData(incl, keep, "all"), ss = sliceSales(s, keep);
    const h = headline(d, ss, keep.map((i) => s.revIncl[i]));
    eq("[плитки] получено = Σ выручки", h.received, sum(sale.map((l) => l.retailRub)));
    eq("[плитки] чистый поток = получено − потрачено", h.net, h.received - h.spent);
    if (h.avgPrice !== null) eq("[плитки] средняя цена = выручка / шт.", h.avgPrice, sum(sale.map((l) => l.retailRub)) / sum(sale.map((l) => l.pcs)), 0.01);
    const ser = seriesOf(incl, s, s.revIncl);
    eq("[накопительно] чистый на конец = получено − потрачено", ser.cumNet[ser.cumNet.length - 1], sum(s.revIncl) - incl.total);
    const wk = ser.work;
    const act = keep.filter((i) => s.recPcs[i] !== 0 || Math.abs(wk[i]) > 0.005).length;
    const hAct = headline(d, ss, keep.map((i) => s.revIncl[i]), keep.map((i) => wk[i]), "active");
    const hAll = headline(d, ss, keep.map((i) => s.revIncl[i]), keep.map((i) => wk[i]), "all");
    eq("[среднее] база «месяцы с оплатами и поставками»: N месяцев", hAct.workMonths, act, 0);
    eq("[среднее] база «все месяцы»: N = число месяцев периода", hAll.workMonths, keep.length, 0);
    eq("[среднее] работа в месяц = работа ÷ N (active)", hAct.workPerMonth ?? NaN, hAct.workTotal / act, 1e-6);
    const mk = keep.map((i) => Math.abs(incl.monthTotals[i]) > 0.005 || s.recPcs[i] !== 0 || s.salePcs[i] !== 0);
    eq("[среднее] активные месяцы = оплата, приход или продажа", headline(d, ss, keep.map((i) => s.revIncl[i]), keep.map((i) => wk[i]), "active", mk).workMonths, mk.filter(Boolean).length, 0);
    const unitsK = keep.map((i) => s.recPcs[i]);
    for (const b of ["all", "active"] as const) {
      const w = workWindowStats(keep.map((_, k) => wk[k]), unitsK, mk, b);
      const hh = headline(d, ss, keep.map((i) => s.revIncl[i]), keep.map((_, k) => wk[k]), b, mk);
      eq(`[окно работы] ${b}: итого = плитка`, w.total, hh.workTotal, 0.01);
      eq(`[окно работы] ${b}: среднее в месяц = плитка`, w.avgMonth ?? NaN, hh.workPerMonth ?? NaN, 1e-6);
      eq(`[окно работы] ${b}: на единицу = плитка`, w.perUnit ?? NaN, hh.workPerUnit ?? NaN, 1e-9);
      eq(`[окно работы] ${b}: единиц = плитка`, w.unitsTotal, hh.unitsReceived, 0);
    }
    eq("[среднее] работа на единицу не зависит от базы", hAct.workPerUnit ?? NaN, hAll.workPerUnit ?? NaN, 1e-9);
    const hex = headline(sliceData(ex, keep, "all"), ss, keep.map((i) => s.revEx[i]));
    ok("[без НДС] выручка без НДС меньше выручки с НДС", hex.received < h.received);
    // Итоги файла выгрузки (лист «Общий итог»), если загружен именно он.
    const fileTotals = { rec: 617, sale: 232, incl: 353888049, ex: 292019953.4526 };
    if (Math.abs(sum(rec.map((l) => l.pcs)) - fileTotals.rec) < 0.5 && lines.length === 523) {
      eq("[файл] поступления = 617", sum(s.recPcs), fileTotals.rec, 0);
      eq("[файл] продажи шт. = 232", sum(s.salePcs), fileTotals.sale, 0);
      eq("[файл] валовое продано 240 и возвраты 8", sum(s.grossPcs) * 1000 + sum(s.returnsPcs), 240 * 1000 + 8, 0);
      eq("[файл] выручка с НДС = 353 888 049", sum(s.revIncl), fileTotals.incl);
      eq("[файл] выручка без НДС = 292 019 953,45", sum(s.revEx), fileTotals.ex, 0.01);
      eq("[файл] 2025: поступления 184 / продано 57", sum(sliceSales(s, months.map((m, i) => (m.startsWith("2025") ? i : -1)).filter((i) => i >= 0)).recPcs), 184, 0);
      eq("[файл] 2026: поступления 433 / продано 175", sum(sliceSales(s, months.map((m, i) => (m.startsWith("2026") ? i : -1)).filter((i) => i >= 0)).recPcs), 433, 0);
    }
    // Сверка с самим xlsx, если он лежит на месте.
    const f = join(homedir(), "Downloads", "поступления и продажи 2.xlsx");
    if (existsSync(f)) {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(f);
      let fr = 0, fs = 0, fm = 0;
      for (const [kind, prefix] of [["RECEIPT", "постапления"], ["SALE", "продажи"]] as const) {
        wb.worksheets.find((w) => w.name.trim().startsWith(prefix))!.eachRow((row, rn) => {
          if (rn < 13) return;
          const cells = (row.values as unknown[]).slice(1).map((v) => (v === undefined ? null : v)) as (string | number | null)[];
          const p = parseSheetRow(kind, cells);
          if (!p) return;
          if (kind === "RECEIPT") fr += p.pcs ?? 0; else { fs += p.pcs ?? 0; fm += p.retailRub ?? 0; }
        });
      }
      eq("[xlsx] поступления в базе = в файле", sum(s.recPcs), fr, 0);
      eq("[xlsx] продажи шт. в базе = в файле", sum(s.salePcs), fs, 0);
      eq("[xlsx] выручка с НДС в базе = в файле", sum(s.revIncl), fm);
    }
  }
  console.log(fails ? `\nПровалов: ${fails} из ${checks}` : `\nВсе проверки пройдены (${checks}).`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
