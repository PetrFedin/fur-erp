// Cashflow: сверка трат с «Оплачено всего», правило «Без НДС», единицы и деньги поступлений/продаж с итогами файла выгрузки, остаток = приход − продажи.
// Только чтение. Если выгрузка ещё не загружена (нет таблицы/строк) — проверки продаж пропускаются.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-cashflow-sales.ts
import "./stubs/server-only-shim";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { loadPaymentsOverview } from "../src/lib/payments-overview";
import { aggregateSales, buildCashflow, workByClass, goodsHeadline, headline, monthsOf, seriesOf, sliceData, sliceSales, stockSeries, vatShares, visibleMonths } from "../src/lib/cashflow";
import { burnRate, flowPoints, groupSales, paybackMonths, payLites, spendByArticle, spendByType, topPays, workByTz } from "../src/lib/cashflow-detail";
import { loadOrderClasses, loadPurchaseVat, loadSalesLines } from "../src/lib/cashflow-server";
import { modelCodeOfArticle, normCode, parseSheetRow } from "../src/lib/sales-receipts-core";

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

  const org = (await prisma.organization.findFirst())!.id;
  const [ov, pv, lines] = await Promise.all([loadPaymentsOverview(org), loadPurchaseVat(org), loadSalesLines(org)]);
  const sumAll = sum(ov.map((r) => r.amount));
  const incl = buildCashflow(ov, "all");
  eq("[траты] Σ Cashflow + вне периода = «Оплачено всего»", incl.total + incl.outside, sumAll);
  const vs = vatShares(ov, pv);
  const ex = buildCashflow(ov, "all", vs.share);
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
  // Детали плиток: суммы деталей = значение плитки.
  const pl = payLites(ov, vs.share);
  eq("[детали] Σ по видам платежа = Потрачено (с НДС)", sum(spendByType(pl, incl.months, false).map((r) => r.total)), incl.total);
  eq("[детали] Σ по видам платежа = Потрачено (без НДС)", sum(spendByType(pl, ex.months, true).map((r) => r.total)), ex.total, 0.05);
  eq("[детали] Σ по статьям = Потрачено", sum(incl.articles.map((a) => a.total)), incl.total);
  ok("[детали] топ-5 платежей отсортированы и не больше 5", topPays(pl, incl.months, false).length <= 5 && topPays(pl, incl.months, false).every((p, i, a) => i === 0 || a[i - 1].amount >= p.amount));
  const s = aggregateSales(lines, months);
  const plc = payLites(ov, vs.share, await loadOrderClasses(org));
  for (const a of incl.articles) {
    const di = spendByArticle(plc, incl.months, false, a.key), de = spendByArticle(plc, ex.months, true, a.key);
    eq(`[статья] ${a.key}: итог по платежам = в таблице (с НДС)`, di.total, a.total, 0.05);
    eq(`[статья] ${a.key}: Σ по видам = итог`, sum(di.byType.map((t) => t.total)), di.total, 0.01);
    eq(`[статья] ${a.key}: Σ по месяцам = итог`, sum(di.byMonth.map((t) => t.total)), di.total, 0.01);
    eq(`[статья] ${a.key}: итог по платежам = в таблице (без НДС)`, de.total, ex.articles.find((x) => x.key === a.key)?.total ?? 0, 0.05);
  }
  eq("[работа] Σ ТЗ + неразнесённое = работа в таблице", workByTz(plc, incl.months, "all").total, incl.articles.find((a) => a.key === "work")?.total ?? 0, 0.05);
  eq("[работа] одежда+аксессуары+прочее = всё", workByTz(plc, incl.months, "clothes").total + workByTz(plc, incl.months, "acc").total + workByTz(plc, incl.months, "other").total, workByTz(plc, incl.months, "all").total, 0.05);
  const saleOnly = lines.filter((l) => l.kind === "SALE");
  for (const [cat, f] of [["all", s], ["clothes", aggregateSales(lines, months, "clothes")], ["acc", aggregateSales(lines, months, "acc")]] as const) {
    eq(`[детали] Σ выручки по сезонам = Получено (${cat}, с НДС)`, sum(groupSales(saleOnly, months, false, (l) => l.season, cat).map((g) => g.rev)), sum(f.revIncl), 0.01);
    eq(`[детали] Σ выручки по артикулам = Получено (${cat}, без НДС)`, sum(groupSales(saleOnly, months, true, (l) => l.article, cat).map((g) => g.rev)), sum(f.revEx), 0.01);
    eq(`[детали] Σ шт. по месяцам = Продано (${cat})`, sum(groupSales(saleOnly, months, false, (l) => l.iso.slice(0, 7), cat).map((g) => g.pcs)), sum(f.salePcs), 0);
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
    const hex = headline(sliceData(ex, keep, "all"), ss, keep.map((i) => s.revEx[i]));
    ok("[без НДС] выручка без НДС меньше выручки с НДС", hex.received < h.received);
    // Итоги файла выгрузки (лист «Общий итог»), если загружен именно он.
    const fileTotals = { rec: 617, sale: 232, incl: 353888049, ex: 292019953.4526 };
    if (Math.abs(sum(rec.map((l) => l.pcs)) - fileTotals.rec) < 0.5 && lines.length === 523) {
      eq("[файл] поступления = 617", sum(s.recPcs), fileTotals.rec, 0);
      eq("[файл] продажи шт. = 232", sum(s.salePcs), fileTotals.sale, 0);
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
