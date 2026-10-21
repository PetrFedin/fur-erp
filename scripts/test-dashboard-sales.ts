// Блок «Продажи и остатки» на Главной: числа блока равны разделу /sales (те же функции) и независимому SQL, итог таблицы = плитки, дети = родитель, место блока и закрытость для подрядчика.
// Только чтение.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-dashboard-sales.ts
import "./stubs/server-only-shim";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { loadSalesInput } from "../src/lib/sales-server";
import { makeCtx } from "../src/lib/margin-tree";
import { applyFilters, extOf, lastMonthOf, openingStock } from "../src/lib/sales-section";
import { buildSalesBlock, salesFilters, salesHref, type SalesRow } from "../src/app/(app)/dashboard/sales-block-data";
import type { YearFilter } from "../src/lib/year-filter";

const prisma = new PrismaClient();
let fails = 0, checks = 0;
const eq = (what: string, got: number | null, want: number | null, tol = 1e-6) => { checks++; if (got === null || want === null ? got !== want : Math.abs(got - want) > tol) { fails++; console.log(`  ✗ ${what}: ${got} ≠ ${want}`); } };
const ok = (what: string, cond: boolean) => { checks++; if (!cond) { fails++; console.log(`  ✗ ${what}`); } };
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

function walk(r: SalesRow, fn: (r: SalesRow) => void) { fn(r); r.children.forEach((c) => walk(c, fn)); }

(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const data = await loadSalesInput(org, "off");
  const all = data.lines;
  const env = { lastMonth: lastMonthOf(all) };

  // 1. Число блока = число /sales (те же функции) для «все годы», 2025 и 2026
  for (const year of ["all", "2025", "2026"] as YearFilter[]) {
    const b = buildSalesBlock(data.input, year);
    const f = salesFilters(year);
    const lines = applyFilters(all, f);
    for (const v of ["in", "ex"] as const) {
      const e = extOf(makeCtx(data.input, v), lines, env);
      eq(`[${year}/${v}] получено`, b.received, e.received); eq(`[${year}/${v}] продано`, b.sold, e.sold);
      eq(`[${year}/${v}] валовое`, b.gross, e.gross); eq(`[${year}/${v}] возвраты`, b.returns, e.returns);
      eq(`[${year}/${v}] выручка`, b.money[v].revenue, e.revenue, 0.01); eq(`[${year}/${v}] средняя цена`, b.money[v].avgPrice, e.avgPrice, 0.01);
      eq(`[${year}/${v}] скидка`, b.money[v].discount, e.discountSum, 0.01);
      eq(`[${year}/${v}] итог таблицы: выручка`, b.total.revenue[v], e.revenue, 0.01);
      eq(`[${year}/${v}] итог таблицы: цена`, b.total.avgPrice[v], e.avgPrice, 0.01);
    }
    const eIn = extOf(makeCtx(data.input, "in"), lines, env);
    eq(`[${year}] остаток = начало + получено − продано (как в /sales)`, b.stock, openingStock(all, f) + eIn.received - eIn.sold);
    eq(`[${year}] sell-through`, b.sellThrough, eIn.sellThrough);
    // таблица: итог = плитки
    eq(`[${year}] итог таблицы: получено`, b.total.received, b.received); eq(`[${year}] итог таблицы: продано`, b.total.sold, b.sold); eq(`[${year}] итог таблицы: остаток`, b.total.stock, b.stock);
    // дети = родитель по всем узлам; верхний уровень = итог
    let bad = 0;
    for (const r of b.rows) walk(r, (n) => { if (n.children.length) { for (const k of ["received", "sold", "stock"] as const) if (Math.abs(sum(n.children.map((c) => c[k])) - n[k]) > 1e-9) bad++; if (Math.abs(sum(n.children.map((c) => c.revenue.in)) - n.revenue.in) > 0.01) bad++; } });
    eq(`[${year}] дети = родитель (число расхождений)`, bad, 0);
    for (const k of ["received", "sold", "stock"] as const) eq(`[${year}] Σ типов меха = итог (${k})`, sum(b.rows.map((r) => r[k])), b.total[k]);
    // сезоны: Σ = итог; месяцы: Σ получено/продано = итог, последний остаток = остаток
    eq(`[${year}] Σ сезонов получено`, sum(b.seasons.map((s) => s.received)), b.received); eq(`[${year}] Σ сезонов продано`, sum(b.seasons.map((s) => s.sold)), b.sold);
    eq(`[${year}] Σ сезонов выручка`, sum(b.seasons.map((s) => s.revenue.in)), b.money.in.revenue, 0.01);
    eq(`[${year}] Σ месяцев получено`, sum(b.months.map((m) => m.received)), b.received); eq(`[${year}] Σ месяцев продано`, sum(b.months.map((m) => m.sold)), b.sold);
    eq(`[${year}] остаток по месяцам на конец = остаток`, b.months.length ? b.months[b.months.length - 1].stock : b.stock, b.stock);
    ok(`[${year}] ссылка ведёт в /sales с периодом`, b.href.in === salesHref(year, "in") && b.href.in.startsWith("/sales") && (year === "all" ? b.href.in === "/sales" : b.href.in.includes(`from=${year}-01-01`)) && b.href.ex.includes("vat=ex"));
  }

  // 2. Независимый SQL по таблице строк выгрузки (все годы)
  const [r] = await prisma.$queryRawUnsafe<{ rec: number; sold: number; gross: number; ret: number; rev: number; revex: number }[]>(
    `select coalesce(sum(case when kind='RECEIPT' then pcs end),0)::float rec,
            coalesce(sum(case when kind='SALE' then pcs end),0)::float sold,
            coalesce(sum(case when kind='SALE' and pcs>0 then pcs end),0)::float gross,
            coalesce(-sum(case when kind='SALE' and pcs<0 then pcs end),0)::float ret,
            coalesce(sum(case when kind='SALE' then "retailRub" end),0)::float rev,
            coalesce(sum(case when kind='SALE' then "retailRubExVat" end),0)::float revex
     from "SalesReceiptLine" where "organizationId"='${org}'`);
  const b = buildSalesBlock(data.input, "all");
  eq("SQL получено", b.received, r.rec); eq("SQL продано", b.sold, r.sold); eq("SQL валовое", b.gross, r.gross); eq("SQL возвраты", b.returns, r.ret);
  eq("SQL выручка с НДС", b.money.in.revenue, r.rev, 0.5); eq("SQL выручка без НДС", b.money.ex.revenue, r.revex, 0.5);
  eq("SQL остаток", b.stock, r.rec - r.sold);

  // 3. Эталон владельца на 20.10.2026 (выгрузка не менялась): 617 / 232 (240 − 8) / 385; выручка 353 888 049 ₽ с НДС, 292 019 953 ₽ без НДС
  if (b.received === 617) {
    eq("эталон: получено", b.received, 617); eq("эталон: продано нетто", b.sold, 232); eq("эталон: валовое", b.gross, 240); eq("эталон: возвраты", b.returns, 8); eq("эталон: остаток", b.stock, 385);
    eq("эталон: выручка с НДС", Math.round(b.money.in.revenue), 353888049, 1); eq("эталон: выручка без НДС", Math.round(b.money.ex.revenue), 292019953, 1);
  } else console.log(`  (выгрузка изменилась: получено ${b.received}, эталон 617 пропущен)`);

  // 4. Охват сумм: не больше штук, 0 ≤ покрытие
  for (const v of ["in", "ex"] as const) {
    const m = b.money[v];
    ok(`[${v}] охват прихода по себестоимости и прайсу не больше прихода`, m.recvCostPcs <= b.received && m.recvListPcs <= b.received);
    ok(`[${v}] охват остатка не больше остатка`, m.stockCostPcs <= b.stock && m.stockListPcs <= b.stock);
  }
  ok("сумма прайса без НДС меньше с НДС", b.money.ex.recvList < b.money.in.recvList && b.money.ex.stockList < b.money.in.stockList);

  // 5. Место блока, закрытость для подрядчика, формулировки
  const page = readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
  const code = page.replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  ok("блок стоит после «Оплат» (PayTiles → Производство → SalesBlockView) внутри панели «Сезон» SeasonWrap, последним на странице", /<PayTiles[\s\S]*?\/>[\s\S]*<SeasonWrap>[\s\S]*<ProductionBlock[\s\S]*\{salesBlock \? <SalesBlockView b=\{salesBlock\} \/> : null\}\s*<\/SeasonWrap>\s*<\/div>\s*\);\s*\}\s*$/.test(code));
  ok("для SUPPLIER данные продаж не грузятся", /session\.user\.role === "SUPPLIER" \? null : await loadSalesBlock/.test(page));
  ok("страница Главной без allowSupplier (подрядчика уводит в /supplier)", /requireSession\(\)/.test(page) && !/allowSupplier/.test(page));
  for (const f of ["sales-block.tsx", "sales-block-charts.tsx", "sales-block-data.ts"]) {
    const src = readFileSync(`src/app/(app)/dashboard/${f}`, "utf8");
    ok(`${f}: без «MVST» и «Google Диск»`, !/MVST|Google Диск/i.test(src));
  }
  const view = readFileSync("src/app/(app)/dashboard/sales-block.tsx", "utf8");
  ok("таблица на table-keep", /table-keep/.test(readFileSync("src/app/(app)/dashboard/sales-block-table.tsx", "utf8")));
  ok("плитки tile-click, окно по клику", /tile-click/.test(view) && /SalesModal/.test(view));
  // «Требует решения» убрана с Главной (решение владельца 21.10.2026): ссылка на раздел остаётся только у блока.
  ok("ссылка на раздел есть у блока «Продажи и остатки»", /dash-sales-link/.test(view));

  console.log(fails ? `\nПровалено ${fails} из ${checks}` : `\nВсе ${checks} проверок пройдены`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})();
