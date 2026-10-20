// Маркап, валовая прибыль и сезоны: независимый пересчёт из сырых строк; печатает сводку. Только чтение.
// Если выгрузка/прайс не загружены — проверки пропускаются.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-margin.ts
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { loadMarginInput } from "../src/lib/margin-server";
import { buildMargin, priceIndex, RETAIL_VAT_PCT } from "../src/lib/margin";
import { buildTreeBy, totalNode, TREE_ORDER, TREE_ORDERS, monthlyBySeason, sellNote, buildTree, CUT_ORDER, makeCtx, metricsOf, seasonsOf, sizeAgg, type TreeNode } from "../src/lib/margin-tree";
import { loadReportSizes } from "../src/lib/margin-server";

const prisma = new PrismaClient();
let fails = 0, checks = 0;
const eq = (what: string, got: number | null, want: number | null, tol = 1e-6) => { checks++; if (got === null || want === null ? got !== want : Math.abs(got - want) > tol) { fails++; console.log(`  ✗ ${what}: ${got} ≠ ${want}`); } };
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pct = (v: number | null, d = 1) => (v === null ? "нет данных" : v.toFixed(d).replace(".", ","));

(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const inp = await loadMarginInput(org, "on");
  if (!inp) { console.log("Выгрузка продаж не загружена — проверки пропущены."); process.exit(0); }
  const m = buildMargin(inp);
  const sale = inp.lines.filter((l) => l.kind === "SALE"), rec = inp.lines.filter((l) => l.kind === "RECEIPT");
  console.log(`Прайс: ${inp.prices.length} строк; моделей с себестоимостью ${inp.costs.size}; цен модели ${inp.modelPrice.size}`);
  // 0. Категории: Σ(одежда)+Σ(аксессуары)+Σ(прочее) = Σ всё по единицам и выручке; маржа по категории пересчитывается из строк категории.
  const byCls = (c: "clothes" | "acc" | "other") => inp.lines.filter((l) => l.cls === c);
  const tot = (a: typeof inp.lines, k: "pcs" | "retailRubExVat", kind: "SALE" | "RECEIPT") => sum(a.filter((l) => l.kind === kind).map((l) => l[k]));
  for (const [k, kind] of [["pcs", "SALE"], ["pcs", "RECEIPT"], ["retailRubExVat", "SALE"]] as const) {
    eq(`категории: Σ одежда+аксессуары+прочее = всё (${k}, ${kind})`, tot(byCls("clothes"), k, kind) + tot(byCls("acc"), k, kind) + tot(byCls("other"), k, kind), tot(inp.lines, k, kind), 0.01);
  }
  for (const c of ["clothes", "acc"] as const) {
    const mc = buildMargin(inp, c);
    eq(`категория ${c}: проданных по сезонам = Σ строк`, sum(mc.seasons.map((x) => x.sold)), tot(byCls(c), "pcs", "SALE"));
    eq(`категория ${c}: выручка без НДС по сезонам = Σ строк`, sum(mc.seasons.map((x) => x.revenueEx)), tot(byCls(c), "retailRubExVat", "SALE"), 0.01);
    console.log(`${c}: проданных ${mc.totals.sold}, выручка без НДС ${Math.round(mc.totals.revenueEx)}, маржа ${mc.totals.grossMarginPct === null ? "—" : mc.totals.grossMarginPct.toFixed(1)} %, маркап по приходу ${mc.weightedByReceipts?.toFixed(2) ?? "—"}, по продажам ${mc.weightedBySales?.toFixed(2) ?? "—"}`);
  }
  // Дерево разрезов: итоги узла = сумма детей (штуки, выручка), столбцы сезонов = таблица сезонов; для каждой категории и каждого разреза.
  const ctx = makeCtx(inp);
  for (const cat of ["all", "clothes", "acc"] as const) {
    const lines = cat === "all" ? inp.lines : inp.lines.filter((l) => l.cls === cat);
    const seasons = seasonsOf(lines);
    const mm = buildMargin(inp, cat);
    for (const cut of Object.keys(CUT_ORDER) as (keyof typeof CUT_ORDER)[]) {
      const tree = buildTree(ctx, lines, CUT_ORDER[cut], seasons);
      const walk = (n: TreeNode) => {
        if (n.children.length) for (const k of ["sold", "received", "revenueEx", "revenueIncl"] as const) eq(`дерево ${cat}/${cut}/${n.label}: ${k} = Σ детей`, sum(n.children.map((c) => c.cols[0][k])), n.cols[0][k], 0.01);
        n.children.forEach(walk);
      };
      tree.forEach(walk);
      for (const k of ["sold", "received", "revenueEx"] as const) eq(`дерево ${cat}/${cut}: Σ верхнего уровня (${k}) = итог`, sum(tree.map((n) => n.cols[0][k])), metricsOf(ctx, lines)[k], 0.01);
      seasons.forEach((sn, i) => { eq(`дерево ${cat}/${cut}: ${sn} выручка = таблица сезонов`, sum(tree.map((n) => n.cols[i + 1].revenueEx)), mm.seasons.find((x) => x.season === sn)!.revenueEx, 0.01); });
    }
  }
  // Единая иерархия категория → тип меха → артикул → цвет, столбцы «Месяцы»: итоги уровня = сумма детей, «Всего» = Σ верхнего уровня; Discount файла.
  for (const cat of ["all", "clothes", "acc"] as const) {
    const lines = cat === "all" ? inp.lines : inp.lines.filter((l) => l.cls === cat);
    const months = [...new Set(lines.map((l) => l.iso.slice(0, 7)))].sort();
    const preds = months.map((mo) => (l: (typeof lines)[number]) => l.iso.startsWith(mo));
    const top = buildTreeBy(ctx, lines, TREE_ORDER, preds);
    const root = totalNode(ctx, lines, preds, top);
    const walk = (n: TreeNode) => {
      if (n.children.length) for (let c = 0; c < n.cols.length; c++) for (const k of ["sold", "received", "revenueEx", "revenueIncl"] as const) eq(`иерархия ${cat}/${n.label}/колонка ${c}: ${k} = Σ детей`, sum(n.children.map((x) => x.cols[c][k])), n.cols[c][k], 0.01);
      n.children.forEach(walk);
    };
    walk(root);
    const sale = lines.filter((l) => l.kind === "SALE");
    const d = sum(sale.map((l) => l.discountRub)), r = sum(sale.map((l) => l.retailRub));
    const dx = sum(sale.map((l) => l.discountRubExVat)), rx = sum(sale.map((l) => l.retailRubExVat));
    eq(`скидка при продаже ${cat} = Discount ÷ (Retail + Discount), без НДС`, root.cols[0].discountGiven, rx + dx > 0 ? dx / (rx + dx) : null, 1e-9);
    void d; void r;
  }
  // Обе структуры дерева (А: категория 1 → категория 2 → мех…, Б: мех → категории…): итог узла = сумма детей, столбцы Тотал/Сезоны.
  for (const key of ["a", "b"] as const) {
    const lines = inp.lines;
    const seasons = seasonsOf(lines);
    const preds = seasons.map((sn) => (l: (typeof lines)[number]) => l.season === sn);
    const root = totalNode(ctx, lines, preds, buildTreeBy(ctx, lines, TREE_ORDERS[key], preds));
    const walk = (n: TreeNode) => {
      if (n.children.length) for (let c = 0; c < n.cols.length; c++) for (const k of ["sold", "received", "revenueEx", "revenueIncl", "discountSum", "revenue"] as const) eq(`структура ${key}/${n.label}/колонка ${c}: ${k} = Σ детей`, sum(n.children.map((x) => x.cols[c][k])), n.cols[c][k], 0.01);
      for (let c = 0; c < n.cols.length; c++) eq(`Gross = Выручка + Скидка: ${key}/${n.label}/колонка ${c}`, n.cols[c].revenue + n.cols[c].discountSum, n.cols[c].revenue + n.cols[c].discountSum, 0.01);
      n.children.forEach(walk);
    };
    walk(root);
    eq(`структура ${key}: продано во «Всего» = 232`, root.cols[0].sold, tot(lines, "pcs", "SALE"), 0);
  }
  // Прибыль/розница: розничная стоимость без НДС делится на ставку по дате строки (20% до 2026, 22% с 01.2026); маржа считается по строкам со штуками.
  {
    const ctx2 = makeCtx(inp);
    const sale = inp.lines.filter((l) => l.kind === "SALE" && l.pcs !== 0 && ctx2.hasCost(l) && ctx2.unitPrice(l) !== null);
    if (sale.length) {
      const want = sum(sale.map((l) => l.retailRubExVat - ctx2.unitExcl(l) * l.pcs)) / sum(sale.map((l) => ctx2.unitPrice(l)! * l.pcs / (l.iso < "2026-01-01" ? 1.2 : 1.22)));
      eq("прибыль/розница: НДС по дате строки (20%/22%)", metricsOf(ctx2, inp.lines).gpOfRetail, want, 1e-9);
    }
    const mAll = buildMargin(inp);
    const withU = inp.lines.filter((l) => l.kind === "SALE" && l.pcs !== 0 && ctx2.hasCost(l));
    eq("маржа: ВП ÷ выручка строк со штуками", mAll.totals.grossMarginPct, withU.length ? (sum(withU.map((l) => l.retailRubExVat - ctx2.unitExcl(l) * l.pcs)) / sum(withU.map((l) => l.retailRubExVat))) * 100 : null, 1e-9);
    eq("выручка вне ВП = выручка без НДС − выручка строк со штуками", mAll.totals.excludedRevenueEx, mAll.totals.revenueEx - sum(withU.map((l) => l.retailRubExVat)), 0.01);
    const sold = inp.lines.filter((l) => l.kind === "SALE");
    eq("Discount (без НДС): Σ строк = мера «Скидка»", metricsOf(ctx2, inp.lines).discountSum, sum(sold.map((l) => l.discountRubExVat)), 0.01);
  }
  // Режимы С НДС / Без НДС и ₽ / €: итог узла = сумма детей по всем мерам-суммам; ВП = выручка − себестоимость в режиме.
  for (const vatMode of ["ex", "in"] as const) {
    const cx = makeCtx(inp, vatMode);
    const lines = inp.lines;
    const root = totalNode(cx, lines, [], buildTreeBy(cx, lines, TREE_ORDERS.a, []));
    const walk = (n: TreeNode) => {
      if (n.children.length) for (const k of ["revenue", "revenueEur", "discountSum", "discountEurSum", "sold", "received"] as const) eq(`режим ${vatMode}/${n.label}: ${k} = Σ детей`, sum(n.children.map((x) => x.cols[0][k])), n.cols[0][k], 0.01);
      n.children.forEach(walk);
    };
    walk(root);
    const sale = lines.filter((l) => l.kind === "SALE");
    eq(`режим ${vatMode}: выручка в ₽ из файла`, root.cols[0].revenue, sum(sale.map((l) => (vatMode === "in" ? l.retailRub : l.retailRubExVat))), 0.01);
    eq(`режим ${vatMode}: выручка в € из файла`, root.cols[0].revenueEur, sum(sale.map((l) => (vatMode === "in" ? l.retailEur : l.retailEurExVat))), 0.01);
    const withU = sale.filter((l) => l.pcs !== 0 && cx.hasCost(l));
    eq(`режим ${vatMode}: ВП = выручка − себестоимость ТЗ в режиме`, root.cols[0].grossProfit, withU.length ? sum(withU.map((l) => (vatMode === "in" ? l.retailRub - cx.unitIncl(l) * l.pcs : l.retailRubExVat - cx.unitExcl(l) * l.pcs))) : null, 0.01);
  }
  // Розница по месяцам: итог сезона = сумма месяцев; Σ сезонов = Σ продаж; sell-through без обрезки.
  for (const cat of ["all", "clothes", "acc"] as const) {
    const lines = cat === "all" ? inp.lines : inp.lines.filter((l) => l.cls === cat);
    const mb = monthlyBySeason(ctx, lines, seasonsOf(lines));
    for (const r of mb) for (const k of ["sold", "revenueEx", "revenueIncl"] as const) eq(`розница ${cat}/${r.season}: ${k} = Σ месяцев`, sum(r.months.map((x) => x.m[k])), r.total[k], 0.01);
    eq(`розница ${cat}: Σ сезонов (шт.) = Σ продаж`, sum(mb.map((r) => r.total.sold)), tot(lines, "pcs", "SALE"), 0);
    for (const sn of seasonsOf(lines)) {
      const mt = metricsOf(ctx, lines.filter((l) => l.season === sn));
      if (mt.received > 0) eq(`sell-through ${cat}/${sn} = продано/получено без обрезки`, mt.sellThrough, mt.sold / mt.received);
      else eq(`sell-through ${cat}/${sn}: получено 0 → нет значения`, mt.sellThrough, null);
      void sellNote;
    }
  }
  if (Math.abs(tot(inp.lines, "pcs", "RECEIPT") - 617) < 0.5) { eq("продано = 232", tot(inp.lines, "pcs", "SALE"), 232, 0); eq("остаток = 385", tot(inp.lines, "pcs", "RECEIPT") - tot(inp.lines, "pcs", "SALE"), 385, 0); }
  // Размеры из отчёта о товарах (если загружены): Σ = итоги отчёта.
  const szRows = await loadReportSizes(org);
  if (szRows.length) {
    const agg = sizeAgg(szRows);
    eq("размеры: Σ получено = 617 (итог отчёта)", sum(agg.map((x) => x.received)), sum(szRows.map((r) => r.deliv)), 0);
    eq("размеры: Σ продано = Σ строк", sum(agg.map((x) => x.sold)), sum(szRows.map((r) => r.sold)), 0);
    eq("размеры: категории дают всё", sum(["clothes", "acc", "other"].map((c) => sum(sizeAgg(szRows, (r) => r.cls === c).map((x) => x.sold)))), sum(agg.map((x) => x.sold)), 0);
  }
  // 1. Σ по сезонам = итоги.
  eq("Σ проданных по сезонам = Σ строк", sum(m.seasons.map((s) => s.sold)), sum(sale.map((l) => l.pcs)));
  eq("Σ выручки без НДС по сезонам = Σ строк", sum(m.seasons.map((s) => s.revenueEx)), sum(sale.map((l) => l.retailRubExVat)), 0.01);
  eq("Σ прихода по сезонам = Σ строк", sum(m.seasons.map((s) => s.received)), sum(rec.map((l) => l.pcs)));
  eq("Σ прихода по моделям = Σ строк", sum(m.models.map((x) => x.received)), sum(rec.filter((l) => l.modelCode).map((l) => l.pcs)));
  // 2. Маркап модели пересчитывается независимо: цена / себестоимость.
  const pidx = priceIndex(inp.prices);
  for (const x of m.models.filter((y) => y.markup !== null)) {
    const c = inp.costs.get(x.code)!;
    eq(`маркап ${x.name} = цена ${Math.round(x.price!)} / себестоимость ${Math.round(c.unitIncl)}`, x.markup, x.price! / c.unitIncl);
    eq(`наценка % ${x.name}`, x.markupPct, (x.price! / c.unitIncl - 1) * 100, 1e-6);
    eq(`валовая на единицу ${x.name}`, x.grossPerUnit, x.price! / (1 + RETAIL_VAT_PCT / 100) - c.unitExcl, 1e-6);
  }
  // 3. Средневзвешенные: Σ(цена·вес) / Σ(себестоимость·вес).
  for (const [k, w] of [["по приходу", (x: (typeof m.models)[number]) => x.received], ["по продажам", (x: (typeof m.models)[number]) => x.sold]] as const) {
    const sel = m.models.filter((x) => x.markup !== null && w(x) > 0);
    const want = sel.length ? sum(sel.map((x) => x.price! * w(x))) / sum(sel.map((x) => x.unitIncl! * w(x))) : null;
    eq(`средневзвешенный маркап ${k}`, k === "по приходу" ? m.weightedByReceipts : m.weightedBySales, want);
  }
  const ok = m.models.filter((x) => x.markup !== null);
  eq("простой средний маркап", m.avgMarkup, ok.length ? sum(ok.map((x) => x.markup!)) / ok.length : null);
  // 3b. Цены (решение владельца 2026-10-20): главная — карточка (ProductModel.sellingPrice), прайс — справочная; фактическая — средневзвешенная по штукам.
  const lines = inp.lines, seasons = seasonsOf(lines);
  for (const vat of ["in", "ex"] as const) for (const key of ["a", "b"] as const) {
    const cx = makeCtx(inp, vat);
    const preds = seasons.map((sn) => (l: (typeof lines)[number]) => l.season === sn);
    const root = totalNode(cx, lines, preds, buildTreeBy(cx, lines, TREE_ORDERS[key], preds));
    const tag = `[цены ${key}|${vat}]`;
    const walk = (n: TreeNode) => {
      if (n.children.length) for (const c of ["cardVal", "cardPcs", "cardRecPrcVal", "cardRecPrcPcs", "listVal", "listPcs", "listRecVal", "listRecPcs", "cardRecVal", "cardRecValEx", "cardCostIncl", "cardCostEx", "toCardRev", "toCardBasis", "toListRev", "toListBasis"] as const) {
        // основы цен у узла = сумма детей (по каждому столбцу: Тотал и сезоны)
        n.cols.forEach((col, i) => eq(`${tag} «${n.label}» ${c} (столбец ${i}) = Σ детей`, col[c] ?? 0, sum(n.children.map((ch) => ch.cols[i][c] ?? 0)), 0.01));
      }
      n.children.forEach(walk);
    };
    walk(root);
    // независимый пересчёт цены карточки и прайса для всего набора (средневзвешенно по проданным штукам)
    const modelPrice = (l: (typeof lines)[number]) => (l.modelCode ? inp.modelPrice.get(l.modelCode) ?? null : null);
    const pvx = (l: (typeof lines)[number], p: number) => (vat === "in" ? p : p / (1 + (l.iso < "2026-01-01" ? 20 : 22) / 100));
    const ls = lines.filter((l) => l.kind === "SALE" && l.pcs > 0 && modelPrice(l) !== null);
    if (ls.length) {
      eq(`${tag} цена по карточке (средневзв.)`, root.cols[0].cardPrice ?? null, sum(ls.map((l) => pvx(l, modelPrice(l)!) * l.pcs)) / sum(ls.map((l) => l.pcs)), 1e-6);
      eq(`${tag} «К карточке %»`, root.cols[0].toCardPct ?? null, (sum(ls.map((l) => (vat === "in" ? l.retailRub : l.retailRubExVat))) / sum(ls.map((l) => pvx(l, modelPrice(l)!) * l.pcs))) * 100, 1e-6);
    }
    const sl = lines.filter((l) => l.kind === "SALE");
    const soldNet = sum(sl.map((l) => l.pcs));
    if (soldNet > 0) eq(`${tag} фактическая цена = выручка ÷ штуки (${vat === "in" ? "с НДС" : "без НДС"})`, (vat === "in" ? root.cols[0].actualPriceIncl : root.cols[0].actualPriceEx) ?? null, sum(sl.map((l) => (vat === "in" ? l.retailRub : l.retailRubExVat))) / soldNet, 1e-6);
  }
  for (const mr of m.models) if (mr.sold <= 0 && mr.cardPrice !== null) { eq(`модель ${mr.code}: без продаж цена = карточка`, mr.price, mr.cardPrice, 1e-9); }

  // 4. Валовая прибыль по сезонам из сырых строк.
  for (const s of m.seasons) {
    const l = sale.filter((x) => x.season === s.season && x.modelCode && (inp.costs.get(x.modelCode)?.qty ?? 0) > 0 && x.pcs !== 0);
    const gp = l.length ? sum(l.map((x) => x.retailRubExVat - inp.costs.get(x.modelCode!)!.unitExcl * x.pcs)) : null;
    eq(`валовая прибыль ${s.season}`, s.grossProfit, gp, 0.01);
    if (s.sold > 0 && s.received > 0) eq(`sell-through ${s.season}`, s.sellThrough, s.sold / s.received);
  }
  void pidx;
  console.log(`\nСредний маркап ${pct(m.avgMarkup, 2)} (моделей ${m.avgMarkupN}); средневзвешенный по приходу ${pct(m.weightedByReceipts, 2)}; по продажам ${pct(m.weightedBySales, 2)}`);
  console.log(`Охват проданных единиц: себестоимость ${pct(m.costCoverage === null ? null : m.costCoverage * 100, 0)} %, цена по артикулу+цвету ${pct(m.priceCoverage === null ? null : m.priceCoverage * 100, 0)} %`);
  for (const s of m.seasons) console.log(`${s.season}: продано ${s.sold} из ${s.received} (${pct(s.sellThrough === null ? null : s.sellThrough * 100, 0)} %), выручка без НДС ${Math.round(s.revenueEx).toLocaleString("ru-RU")}, ср. цена ${s.avgPrice ? Math.round(s.avgPrice).toLocaleString("ru-RU") : "—"}, скидка от розницы ${pct(s.discountVsRetail === null ? null : s.discountVsRetail * 100)} %, ВП ${s.grossProfit === null ? "—" : Math.round(s.grossProfit).toLocaleString("ru-RU")}, маржа ${pct(s.grossMarginPct)} %, ВП/розница ${pct(s.gpOfRetail === null ? null : s.gpOfRetail * 100)} %, маркап прихода ${pct(s.markupW, 2)}`);
  console.log(fails ? `\nПровалов: ${fails} из ${checks}` : `\nВсе проверки пройдены (${checks}).`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
