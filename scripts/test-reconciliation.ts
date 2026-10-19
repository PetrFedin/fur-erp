// Сверка по статьям между «Главной» (виджеты, таблицы), «Оплатами» и расчётом долга: одни и те же статьи — мех, подкладка, работа, 4% —
// должны давать одни и те же числа везде. Только чтение. Код возврата 1 — при расхождениях.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-reconciliation.ts
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { loadDashboard } from "../src/lib/dashboard-data";
import { loadPaymentsOverview, loadPaymentsLeft } from "../src/lib/payments-overview";
import { buildCashflow } from "../src/lib/cashflow";
import { loadDebtInputs, supplierDebtFromInputs } from "../src/lib/supplier-debt";

const prisma = new PrismaClient();
let fails = 0, checks = 0;
// RECON_TOL_SCALE: на обезличенной демо-базе (деньги умножены на целый коэффициент K) допуски округления тоже умножаются на K.
const TOL_SCALE = Number(process.env.RECON_TOL_SCALE) || 1;
const eq = (what: string, got: number, want: number, tol = 1) => {
  checks++;
  if (Math.abs(got - want) > tol * TOL_SCALE) { fails++; console.log(`  ✗ ${what}: ${got.toFixed(2)} ≠ ${want.toFixed(2)} (Δ ${(got - want).toFixed(2)})`); }
};
const E0 = { auction: [] as string[], fur: [] as string[], color: [] as string[], batch: [] as string[], status: [] as string[], vat: [] as string[], attr: [] as string[], catgroup: [] as string[] };

(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const [ov, left, inp] = await Promise.all([loadPaymentsOverview(org), loadPaymentsLeft(org), loadDebtInputs(prisma, org)]);
  const sumOv = (k: "fur" | "lining" | "services" | "work" | "hides", y?: string) => ov.filter((r) => !y || y === "all" || r.year === Number(y)).reduce((a, r) => a + r[k], 0);

  for (const y of ["all", "2025", "2026"] as const) {
    for (const c4 of ["on", "off"] as const) {
      const d = await loadDashboard(org, y, E0, c4);
      const tag = `[${y}/4%:${c4}]`;
      const furRows = d.rawTable.filter((r) => r.kind === "fur"), linRows = d.rawTable.filter((r) => r.kind === "lining");
      const paidRows = d.rawTable.reduce((a, r) => a + r.paid, 0), dueRows = d.rawTable.reduce((a, r) => a + r.due, 0);

      // 1. Оплачено: виджет = «Оплаты → Все» = таблица по сырью = таблица по годам
      eq(`${tag} оплачено мех: виджет = Оплаты→Все`, d.paidByItem.fur, sumOv("fur", y));
      eq(`${tag} оплачено подкладка: виджет = Оплаты→Все`, d.paidByItem.lining, sumOv("lining", y));
      // Услуги по УПД (закупки без позиций сырья) — отдельная статья: не в меху, не в подкладке, в сумму оплат входят
      eq(`${tag} оплачено услуги по УПД: виджет = Оплаты→Все`, d.paidByItem.services, sumOv("services", y));
      eq(`${tag} оплачено всего: мех + подкладка + услуги + работа = Σ оплат Оплаты→Все`, d.paidByItem.fur + d.paidByItem.lining + d.paidByItem.services + d.paidByItem.work, ov.filter((r) => y === "all" || r.year === Number(y)).reduce((a, r) => a + r.amount, 0));
      eq(`${tag} оплаты по типам: Σ типов = Σ статей`, d.paidByType.reduce((a, t) => a + t.amount, 0), d.paidByItem.fur + d.paidByItem.lining + d.paidByItem.services + d.paidByItem.work);
      eq(`${tag} оплачено сырьё: Σ строк таблицы + «не получен» = виджет`, paidRows + d.rawMoneyTotal.unreceived.paid, d.rawMoneyTotal.paid);
      eq(`${tag} оплачено подкладка: строка таблицы = виджет`, linRows.reduce((a, r) => a + r.paid, 0), d.paidByItem.lining);
      eq(`${tag} оплачено мех: Σ видов = виджет`, furRows.reduce((a, r) => a + r.paid, 0), d.paidByItem.fur);
      if (y === "all") eq(`${tag} оплачено сырьё: годы Σ = таблица`, d.years.find((r) => r.key === "all")!.paid, d.rawMoneyTotal.paid);

      // 2. Долг (К оплате): виджет = таблица = годы = Оплаты→Все = расчёт долга
      eq(`${tag} долг сырьё: Σ строк таблицы + «не получен» = виджет`, dueRows + d.rawMoneyTotal.unreceived.due, d.left.raw);
      eq(`${tag} долг: мех + подкладка + услуги = сырьё`, d.left.fur + d.left.lining + d.left.services, d.left.raw);
      // «К оплате» по работе — остаток работы по заведённым ТЗ, не меньше нуля; неразнесённый аванс подрядчику — отдельной строкой, не минусом
      eq(`${tag} долг по работе не отрицателен (аванс отдельной строкой)`, Math.min(d.left.prod, 0), 0, 0.005);
      if (y === "all") {
        eq(`${tag} аванс подрядчику: виджет = Оплаты→Все`, d.advance, left.advance);
        eq(`${tag} аванс подрядчику = неразнесённые авансы расчёта долга по работе`, d.advance, d.clientDebtInfo.unallocated, 1);
        eq(`${tag} оплачено за работу − аванс = разнесено на ТЗ`, d.paidByItem.work - d.advance, d.clientDebtInfo.allocated, 1);
      }
      eq(`${tag} долг подкладки: строка таблицы = виджет`, linRows.reduce((a, r) => a + r.due, 0), d.left.lining);
      eq(`${tag} долг меха: Σ видов = виджет`, furRows.reduce((a, r) => a + r.due, 0), d.left.fur);
      if (y === "all") {
        eq(`${tag} долг: годы Σ = виджет`, d.years.find((r) => r.key === "all")!.debt, d.left.raw);
        eq(`${tag} долг: Оплаты→Все = виджет`, left.raw, d.left.raw);
        eq(`${tag} долг: расчёт долга поставщику = виджет`, supplierDebtFromInputs(inp, "all").debt.toNumber(), d.left.raw);
        eq(`${tag} долг производство: Оплаты→Все = виджет`, left.prod, d.left.prod);
      }

      // 3. Общая стоимость = куплено (мех и подкладка, с НДС) — подкладка допускает ≤ 5 ₽ округления цен
      const F = d.raw.fur.incl, L = d.raw.lining.incl;
      if (y === "all") {
        eq(`${tag} общая стоимость меха = куплено меха`, d.paidByItem.fur + d.left.fur, F.recvValue, 5);
        eq(`${tag} общая стоимость подкладки = куплено подкладки`, d.paidByItem.lining + d.left.lining, L.recvValue, 5);
      }

      // 4. Куплено = использовано(без 4%) + остаток (штуки и рубли)
      const usedNo4 = (c4 === "on" ? F.usedValueOther : F.usedValue);
      eq(`${tag} мех: куплено шт = использовано + остаток`, F.recvQty, F.usedQty + F.remQty, 0.01);
      eq(`${tag} мех: куплено ₽ = использовано(без 4%) + остаток`, F.recvValue, usedNo4 + F.remValue, 5);
      const usedNo4L = (c4 === "on" ? L.usedValueOther : L.usedValue);
      eq(`${tag} подкладка: куплено м = использовано + остаток`, L.recvQty, L.usedQty + L.remQty, 0.01);
      eq(`${tag} подкладка: куплено ₽ = использовано(без 4%) + остаток`, L.recvValue, usedNo4L + L.remValue, 1000);

      // 5. Таблица по сырью = виджеты сырья
      for (const v of ["incl", "excl"] as const) {
        const sf = furRows.reduce((a, r) => ({ rq: a.rq + r.cells[v].rq, rv: a.rv + r.cells[v].rv, mq: a.mq + r.cells[v].mq, mv: a.mv + r.cells[v].mv, uv: a.uv + r.cells[v].uv }), { rq: 0, rv: 0, mq: 0, mv: 0, uv: 0 });
        const W = d.raw.fur[v];
        eq(`${tag}/${v} мех: Σ видов куплено шт = виджет`, sf.rq, W.recvQty, 0.01);
        eq(`${tag}/${v} мех: Σ видов куплено ₽ = виджет`, sf.rv, W.recvValue, 1);
        eq(`${tag}/${v} мех: Σ видов остаток ₽ = виджет`, sf.mv, W.remValue, 1);
        for (const r of furRows) {
          if (r.auctions.length === 0) continue;
          eq(`${tag}/${v} ${r.label}: Σ строк аукционов куплено ₽ = вид`, r.auctions.reduce((a, x) => a + x.cells[v].rv, 0), r.cells[v].rv, 2);
          eq(`${tag}/${v} ${r.label}: Σ строк аукционов оплачено = вид`, r.auctions.reduce((a, x) => a + x.paid, 0), r.paid, 2);
          eq(`${tag}/${v} ${r.label}: Σ строк аукционов долг = вид`, r.auctions.reduce((a, x) => a + x.due, 0), r.due, 2);
        }
      }

      // 6. Годы: Σ строк = итог (куплено, остаток), итог по сырью = виджеты
      if (y === "all") {
        const rows = d.years.filter((r) => r.key !== "all"), tot = d.years.find((r) => r.key === "all")!;
        eq(`${tag} годы: куплено меха ₽ = виджет`, tot.fur.incl.rv, F.recvValue);
        eq(`${tag} годы: остаток меха ₽ = виджет`, tot.fur.incl.mv, F.remValue);
        eq(`${tag} годы: Σ строк куплено меха = итог`, rows.reduce((a, r) => a + r.fur.incl.rv, 0), tot.fur.incl.rv);
        eq(`${tag} годы: куплено подкладки = виджет`, tot.lining.incl.rv, L.recvValue);
        eq(`${tag} годы: Σ строк оплачено = итог`, rows.reduce((a, r) => a + r.paid, 0), tot.paid);
        eq(`${tag} годы: Σ строк долг = итог`, rows.reduce((a, r) => a + r.debt, 0), tot.debt);
        for (const r of rows) if (/^\d{4}$/.test(r.key)) {
          eq(`${tag} годы ${r.key}: оплачено = Оплаты→Все`, r.paid, sumOv("fur", r.key) + sumOv("lining", r.key));
          eq(`${tag} годы ${r.key}: долг = Оплаты→Все`, r.debt, left.byYear.get(Number(r.key))?.raw ?? 0);
        }
      }

      // 7. Себестоимость (факт по всем ТЗ) = использовано по сырью + 4% + работа
      if (y === "all") {
        const all = (k: "furIncl" | "liningIncl" | "c4Incl" | "work") => d.prod.done[k === "work" ? "workSum" : k] + d.prod.work[k === "work" ? "workSum" : k];
        eq(`${tag} себестоимость: мех (с шкурами подрядчика) = использовано меха без 4%`, all("furIncl") + d.hides.incl, usedNo4, 5);
        eq(`${tag} себестоимость: подкладка = использовано подкладки без 4%`, all("liningIncl"), usedNo4L, 5);
        if (c4 === "on") eq(`${tag} себестоимость: 4% = использовано с 4% − без 4%`, all("c4Incl"), Math.abs(F.usedValue - F.usedValueOther) + Math.abs(L.usedValue - L.usedValueOther), 5);
        eq(`${tag} себестоимость: работа = Производство (оплачено − аванс + к оплате)`, all("work"), sumOv("work", y) - d.advance + d.left.prod, 5);
      }
    }
  }
  // Фильтры панели: деньги, таблицы и виджеты должны двигаться вместе
  const FILTERS: { name: string; f: typeof E0 }[] = [
    { name: "мех Соболь", f: { ...E0, fur: ["Соболь"] } },
    { name: "мех Свакара", f: { ...E0, fur: ["Свакара"] } },
    { name: "аукцион РП 04.26", f: { ...E0, auction: ["РП 04.26"] } },
    { name: "статус COMPLETED", f: { ...E0, status: ["COMPLETED"] } },
    { name: "партия 7", f: { ...E0, batch: ["7"] } },
    { name: "НДС 22", f: { ...E0, vat: ["22"] } },
  ];
  for (const { name, f } of FILTERS) {
    const d = await loadDashboard(org, "all", f, "on");
    const tag = `[фильтр: ${name}]`;
    const F = d.raw.fur.incl, L = d.raw.lining.incl;
    eq(`${tag} оплачено сырьё: Σ строк = виджет`, d.rawTable.reduce((a, r) => a + r.paid, 0) + d.rawMoneyTotal.unreceived.paid, d.paidByItem.fur + d.paidByItem.lining);
    eq(`${tag} долг сырьё: Σ строк = виджет`, d.rawTable.reduce((a, r) => a + r.due, 0) + d.rawMoneyTotal.unreceived.due, d.left.raw);
    eq(`${tag} мех: общая стоимость = куплено`, d.paidByItem.fur + d.left.fur, F.recvValue, 5);
    eq(`${tag} подкладка: общая стоимость = куплено`, d.paidByItem.lining + d.left.lining, L.recvValue, 300);
    // Статус ТЗ и партия сужают только «Использовано»: куплено − использовано ≠ остаток (так и задумано).
    if (!f.status.length && !f.batch.length) eq(`${tag} мех: куплено = использовано + остаток (шт)`, F.recvQty, F.usedQty + F.remQty, 0.01);
    const tot = d.years.find((r) => r.key === "all")!;
    eq(`${tag} годы: оплачено = виджет`, tot.paid, d.paidByItem.fur + d.paidByItem.lining, 2);
    eq(`${tag} годы: долг = виджет`, tot.debt, d.left.raw, 2);
    eq(`${tag} годы: куплено меха = виджет`, tot.fur.incl.rv, F.recvValue, 2);
    eq(`${tag} себестоимость: работа = Работа в оплатах`, d.prod.done.workSum + d.prod.work.workSum, d.paidByItem.work - d.advance + d.left.prod, 5);
  }
  // Cashflow (/payments/cashflow): Σ по месяцам и статьям = «Оплачено всего» (одна выборка loadPaymentsOverview, только COMPLETED).
  {
    const dAll = await loadDashboard(org, "all", E0, "on");
    const paidAllDash = dAll.paidByItem.fur + dAll.paidByItem.lining + dAll.paidByItem.services + dAll.paidByItem.work;
    const sumAll = ov.reduce((a, r) => a + r.amount, 0);
    const cfAll = buildCashflow(ov, "all");
    const art = (c: typeof cfAll, k: string) => c.articles.find((a) => a.key === k)?.total ?? 0;
    eq("[Cashflow] Σ 2025–2026 + оплаты вне периода = Σ оплат Оплаты→Все", cfAll.total + cfAll.outside, sumAll);
    eq("[Cashflow] Σ 2025–2026 + вне периода = «Оплачено всего» (Главная)", cfAll.total + cfAll.outside, paidAllDash);
    eq("[Cashflow] накопительно в конце = Итого", cfAll.cumulative[cfAll.cumulative.length - 1], cfAll.total, 0.01);
    eq("[Cashflow] Σ «Всего за месяц» = Σ статей", cfAll.monthTotals.reduce((a, v) => a + v, 0), cfAll.articles.reduce((a, x) => a + x.total, 0), 0.01);
    eq("[Cashflow] 2025 + 2026 = 2025–2026", buildCashflow(ov, "2025").total + buildCashflow(ov, "2026").total, cfAll.total, 0.01);
    if (cfAll.outside < 0.5) {
      eq("[Cashflow] мех (с шкурами подрядчика) = Оплачено мех", art(cfAll, "furAuction") + art(cfAll, "furPurchase") + art(cfAll, "hides"), dAll.paidByItem.fur);
      eq("[Cashflow] подкладка = Оплачено подкладка", art(cfAll, "lining"), dAll.paidByItem.lining);
      eq("[Cashflow] услуги по УПД = Оплачено услуги", art(cfAll, "services"), dAll.paidByItem.services);
      eq("[Cashflow] работа = Оплачено работа", art(cfAll, "work"), dAll.paidByItem.work - 0 , 1);
    }
    eq("[Cashflow] Σ видов платежа = Σ статей", cfAll.articles.reduce((a, x) => a + x.types.reduce((b, t) => b + t.total, 0), 0), cfAll.total, 0.01);
    for (const m of cfAll.months) {
      const i = cfAll.months.indexOf(m);
      eq(`[Cashflow] ${m}: Σ статей = всего за месяц`, cfAll.articles.reduce((a, x) => a + x.byMonth[i], 0), cfAll.monthTotals[i], 0.01);
      eq(`[Cashflow] ${m}: = Σ оплат месяца`, cfAll.monthTotals[i], ov.filter((r) => r.iso.startsWith(m)).reduce((a, r) => a + r.amount, 0), 0.01);
    }
  }
  console.log(`\nСверка по статьям: проверок ${checks}, расхождений ${fails}`);
  process.exit(fails ? 1 : 0);
})().finally(() => prisma.$disconnect());
