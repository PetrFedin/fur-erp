// Раздел «Продажи и остатки»: итоги, деревья структур А–Е (итог узла = сумма детей), согласованность периодов, фильтры, ссылки, закрытость для подрядчика.
// Только чтение. Если выгрузка продаж не загружена — проверки данных пропускаются.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-sales-section.ts
import "./stubs/server-only-shim";
import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { loadSalesInput } from "../src/lib/sales-server";
import { makeCtx, sizeAgg } from "../src/lib/margin-tree";
import {
  applyFilters, bucketsOf, buildSalesTree, extOf, groupBy, lastMonthOf, movements, NO_FILTERS, openingStock, sortSeasons, STRUCTS, totalSalesNode, walkTree,
  type Ext, type Gran, type SLine, type Filters,
} from "../src/lib/sales-section";
import { movementHref, parseUi, uiQuery } from "../src/lib/sales-url";
import { navLinksFor } from "../src/components/nav-links";
import { n0 } from "../src/app/(app)/sales/sales-fmt";

const prisma = new PrismaClient();
let fails = 0, checks = 0;
const eq = (what: string, got: number | null, want: number | null, tol = 1e-6) => { checks++; if (got === null || want === null ? got !== want : Math.abs(got - want) > tol) { fails++; console.log(`  ✗ ${what}: ${got} ≠ ${want}`); } };
const ok = (what: string, cond: boolean) => { checks++; if (!cond) { fails++; console.log(`  ✗ ${what}`); } };
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const SUMKEYS: (keyof Ext)[] = ["received", "sold", "gross", "returns", "revenueIncl", "revenueEx", "discountSum", "grossRev"];

(async () => {
  // Статические проверки: закрытость для подрядчика, ссылки, формулировки.
  ok("SUPPLIER не видит пункт меню «Продажи и остатки»", !navLinksFor("SUPPLIER").some((l) => l.href === "/sales"));
  ok("внутренние роли видят пункт меню", ["OWNER", "ADMIN", "TECHNOLOGIST", "PURCHASER", "ACCOUNTANT", "WAREHOUSE"].every((r) => navLinksFor(r).some((l) => l.href === "/sales")));
  const nav = navLinksFor("OWNER").map((l) => l.href);
  ok("пункт идёт сразу после «Изделий»", nav[nav.indexOf("/articles") + 1] === "/sales");
  for (const f of ["src/app/(app)/sales/page.tsx", "src/app/(app)/sales/movement/page.tsx"]) {
    const src = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "");
    ok(`${f}: requireSession без allowSupplier`, /requireSession\(\)/.test(src) && !/allowSupplier/.test(src));
  }
  for (const f of ["src/app/(app)/sales/page.tsx", "src/app/(app)/sales/sales-view.tsx", "src/app/(app)/sales/sales-tree.tsx", "src/app/(app)/sales/sales-tabs.tsx", "src/app/(app)/sales/movement/movement-view.tsx"]) {
    const src = readFileSync(f, "utf8");
    ok(`${f}: без «MVST» и «Google Диск»`, !/MVST|Google Диск/i.test(src));
  }
  const srcOf = (f: string) => readFileSync(`src/app/(app)/sales/${f}`, "utf8");
  const metrics = ["sales-view.tsx", "sales-charts.tsx", "sales-tree.tsx", "sales-tabs.tsx"].flatMap((f) => [...srcOf(f).matchAll(/data-metric=(?:\{def\.id\}|"([\w-]+)")/g)].map((m) => m[1] ?? "tile"));
  ok("дубли: каждое data-metric в одном месте", metrics.filter((m) => m !== "tile").length === new Set(metrics.filter((m) => m !== "tile")).size);
  ok("дубли: плитки только received/sold/stock/sellThrough", [...srcOf("sales-view.tsx").matchAll(/\{ id: "(\w+)", label:/g)].map((m) => m[1]).filter((id) => !["produced", "fg", "shipped"].includes(id)).join() === "received,sold,stock,sellThrough");
  ok("дубли: корневая строка дерева не выводится (итог только в плитках)", !/renderNode\(tree, 0\)/.test(srcOf("sales-tree.tsx")));
  ok("дубли: нет вкладки «Заказы» и таблицы по периодам", !/key: "orders"/.test(readFileSync("src/lib/sales-url.ts", "utf8")) && !/Таблица по периодам/.test(srcOf("sales-charts.tsx")));
  ok("нет мер «по карточке»", !/К карточке|Цена по карточке/.test(srcOf("sales-tree.tsx") + srcOf("sales-view.tsx")));
  ok("страница ленты движений существует", existsSync("src/app/(app)/sales/movement/page.tsx"));
  ok("ссылка ленты ведёт на /sales/movement", (movementHref("M001A/SABLE", "SILVER", null) ?? "").startsWith("/sales/movement?a=M001A%2FSABLE&c=SILVER"));
  ok("страницы изделия и ТЗ существуют (ссылки из ленты)", existsSync("src/app/(app)/models/[id]/page.tsx") && existsSync("src/app/(app)/production/[id]/page.tsx"));
  ok("нули — прочерком", n0(0) === "–");
  const u = parseUi({ from: "2026-01-01", cat: "acc", s: "a", vat: "ex", tab: "stock", cols: "sold,stock,bad", fur: "SABLE|MINK" });
  ok("адрес: разбор и сборка состояния", uiQuery(u) === "from=2026-01-01&fur=SABLE%7CMINK&cat=acc&vat=ex&tab=stock&s=a&cols=sold%2Cstock" && u.cols?.length === 2);

  const org = (await prisma.organization.findFirst())!.id;
  const data = await loadSalesInput(org, "on");
  const all: SLine[] = data.lines;
  if (!all.length) {
    // Демо: данных нет — пустые наборы не должны падать.
    const e = extOf(makeCtx(data.input, "in"), [], { lastMonth: "2026-01" });
    ok("пустые данные: показатели без падений", e.sold === 0 && e.received === 0 && e.sellThrough === null && e.coverMonths === null);
    ok("пустые данные: фильтры и ряды", applyFilters([], NO_FILTERS).length === 0 && bucketsOf(makeCtx(data.input, "in"), { lastMonth: "2026-01" }, [], "month").length === 0);
    console.log(`Выгрузка продаж не загружена — проверки данных пропущены. Проверок: ${checks}, ошибок: ${fails}`);
    process.exit(fails ? 1 : 0);
  }
  const env = { lastMonth: lastMonthOf(all) };
  for (const vat of ["in", "ex"] as const) {
    const ctx = makeCtx(data.input, vat);
    const t = extOf(ctx, all, env);
    // 1. Контрольные итоги выгрузки.
    eq("Σ приход = 617", t.received, 617);
    eq("Σ продано нетто = 232", t.sold, 232);
    eq("валовое = 240", t.gross, 240);
    eq("возвраты = 8", t.returns, 8);
    eq("остаток = 617 − 232 = 385", t.stock, 385);
    eq("выручка с НДС = 353 888 049", t.revenueIncl, 353888049, 0.5);
    eq("выручка без НДС = 292 019 953,45", t.revenueEx, 292019953.45, 0.01);
    eq("режим НДС: выручка выбранного режима", t.revenue, vat === "in" ? t.revenueIncl : t.revenueEx, 0.01);
    eq("нетто = валовое − возвраты", t.sold, t.gross - t.returns);
    eq("Gross = Выручка + Скидка", t.grossRev, t.revenue + t.discountSum, 0.01);
    ok("18 строк продаж без штук (заказ 155627)", t.noPcs === 18);

    // 2. Итог узла = сумма детей для каждой структуры и каждого уровня (все столбцы: Тотал, сезоны, месяцы).
    const seasons = sortSeasons(all.map((l) => l.season));
    const preds = seasons.map((sn) => (l: SLine) => l.season === sn);
    for (const st of STRUCTS) {
      const tree = totalSalesNode(ctx, env, all, preds, buildSalesTree(ctx, env, all, st.order, preds));
      let nodes = 0;
      walkTree(tree, (n) => {
        nodes++;
        if (!n.children.length) return;
        n.cols.forEach((col, g) => {
          for (const k of SUMKEYS) {
            const got = sum(n.children.map((c) => c.cols[g][k] as number)), want = col[k] as number;
            if (Math.abs(got - want) > 0.01) { eq(`${st.key}/${vat}: ${n.id} ${k} столбец ${g}`, got, want); return; }
          }
          if (Math.abs(col.grossRev - col.revenue - col.discountSum) > 0.01) eq(`Gross = выручка + скидка в узле ${n.id}`, col.grossRev, col.revenue + col.discountSum);
        });
      });
      ok(`структура ${st.key}: есть узлы`, nodes > 1);
      for (const k of ["received", "sold", "revenue"] as const) eq(`структура ${st.key}: Σ верхнего уровня = Тотал (${k})`, sum(tree.children.map((c) => c.cols[0][k])), t[k], 0.01);
      for (let g = 0; g < preds.length; g++) eq(`структура ${st.key}: сезон ${seasons[g]} Σ групп = Σ строк`, sum(tree.children.map((c) => c.cols[g + 1].sold)), extOf(ctx, all.filter(preds[g]), env).sold);
      eq(`структура ${st.key}: Σ сезонов = Тотал (продано)`, sum(tree.cols.slice(1).map((c) => c.sold)), tree.cols[0].sold);
    }
    ok("структур ровно две: Мех→… и Категория 1→…", STRUCTS.length === 2 && STRUCTS[0].order[0] === "fur" && STRUCTS[1].order.slice(0, 3).join() === "cls,c2,fur");

    // 3. Σ по месяцам = Σ по заказам = Σ по артикулам = Σ по сезонам.
    const byMonth = bucketsOf(ctx, env, all, "month"), byOrder = groupBy(ctx, env, all, "order"), byArt = groupBy(ctx, env, all, "article"), byColor = groupBy(ctx, env, all, "color");
    for (const [name, rows] of [["месяцам", byMonth.map((b) => b.m)], ["заказам", byOrder.map((g) => g.m)], ["артикулам", byArt.map((g) => g.m)], ["артикулу+цвету", byColor.map((g) => g.m)]] as const) {
      eq(`Σ по ${name}: приход`, sum(rows.map((m) => m.received)), t.received);
      eq(`Σ по ${name}: продано`, sum(rows.map((m) => m.sold)), t.sold);
      eq(`Σ по ${name}: выручка`, sum(rows.map((m) => m.revenue)), t.revenue, 0.01);
    }

    // 4. График = таблица: все гранулярности дают одни итоги, остаток нарастающий заканчивается итоговым остатком.
    for (const g of ["month", "season"] as Gran[]) {
      const b = bucketsOf(ctx, env, all, g, 0);
      eq(`${g}: Σ приход`, sum(b.map((x) => x.m.received)), 617);
      eq(`${g}: Σ продано`, sum(b.map((x) => x.m.sold)), 232);
      eq(`${g}: Σ выручка`, sum(b.map((x) => x.m.revenue)), t.revenue, 0.01);
      eq(`${g}: последний остаток = 385`, b[b.length - 1].stock, 385);
      let run = 0;
      b.forEach((x, i) => { run += x.m.received - x.m.sold; if (x.stock !== run) eq(`${g}: остаток нарастающий в корзине ${i}`, x.stock, run); });
      ok(`${g}: корзины по порядку`, g === "season" || b.every((x, i) => i === 0 || b[i - 1].key < x.key));
    }
  }

  // 5. Фильтры пересчитывают.
  const ctx = makeCtx(data.input, "in");
  const T = (f: Partial<Filters>) => extOf(ctx, applyFilters(all, { ...NO_FILTERS, ...f }), env);
  eq("категории: одежда + аксессуары + прочее = всё (приход)", T({ cat: "clothes" }).received + T({ cat: "acc" }).received + all.filter((l) => l.cls === "other" && l.kind === "RECEIPT").reduce((a, l) => a + l.pcs, 0), 617);
  eq("категории: одежда + аксессуары + прочее = всё (продано)", T({ cat: "clothes" }).sold + T({ cat: "acc" }).sold + all.filter((l) => l.cls === "other" && l.kind === "SALE").reduce((a, l) => a + l.pcs, 0), 232);
  const seasons = sortSeasons(all.map((l) => l.season));
  eq("сезоны: Σ сезонов = всё (продано)", sum(seasons.map((s) => T({ seasons: [s] }).sold)), 232);
  eq("сезоны: Σ сезонов = всё (приход)", sum(seasons.map((s) => T({ seasons: [s] }).received)), 617);
  eq("период: 2025 + 2026 = всё (продано)", T({ from: "2025-01-01", to: "2025-12-31" }).sold + T({ from: "2026-01-01", to: "2026-12-31" }).sold, 232);
  eq("период: 2025 + 2026 = всё (выручка)", T({ from: "2025-01-01", to: "2025-12-31" }).revenueIncl + T({ from: "2026-01-01", to: "2026-12-31" }).revenueIncl, 353888049, 0.5);
  const a0 = all.find((l) => l.kind === "SALE" && l.pcs > 0)!;
  const q = T({ q: a0.article.toLowerCase() });
  ok("поиск по артикулу сужает выборку", q.sold > 0 && q.sold < 232);
  eq("фильтр меха сужает", T({ furs: ["__нет__"] }).received, 0);
  eq("поиск по заказу: заказ 155627 — только скидка без штук", T({ q: "155627" }).sold, 0);
  eq("остаток на начало периода + движение = остаток на конец", openingStock(all, { ...NO_FILTERS, from: "2026-01-01" }) + T({ from: "2026-01-01" }).stock, 385);
  const bOpen = bucketsOf(ctx, env, applyFilters(all, { ...NO_FILTERS, from: "2026-01-01" }), "month", openingStock(all, { ...NO_FILTERS, from: "2026-01-01" }));
  eq("график с периодом: последний остаток = 385", bOpen[bOpen.length - 1].stock, 385);
  ok("НДС: выручка без НДС меньше выручки с НДС", extOf(makeCtx(data.input, "ex"), all, env).revenue < extOf(ctx, all, env).revenue);

  // 6. Лента движений: остаток по артикулу = приход − продано; число строк = число строк выгрузки.
  for (const g of groupBy(ctx, env, all, "article")) {
    const mv = movements(g.lines);
    eq(`лента ${g.label}: строк`, mv.length, g.lines.length);
    eq(`лента ${g.label}: остаток`, mv[mv.length - 1].stock, g.m.stock);
  }

  // 7. Report: расчётный остаток против Report на 19.10.
  if (data.sizes.length) {
    const rep = sum(data.sizes.map((r) => r.stock));
    eq("Report: остаток 379", rep, 379);
    eq("Report: размеры дают тот же остаток", sum(sizeAgg(data.sizes).map((s) => s.stock)), 379);
    eq("разница расчёта и Report = 6", 385 - rep, 6);
  } else console.log("  (размеры Report не загружены — сравнение пропущено)");

  console.log(`Проверок: ${checks}, ошибок: ${fails}`);
  process.exit(fails ? 1 : 0);
})().finally(() => prisma.$disconnect());
