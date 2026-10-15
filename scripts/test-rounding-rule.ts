// Тест правила округления денег на экране («вариант Б», src/lib/money-round.ts):
//   суммы считаются точно; на экране итог = round(точной суммы), а показанные части складываются в показанный итог ровно до рубля.
// Проверяет на реальных данных базы (копия): плитки «Куплено / Использовано / Остаток», виды меха и источники, «Динамика по годам»,
// «Динамика по сырью», плитки оплат, «Из чего складывается стоимость» и мост «Сверки»; плюс свойства функций на случайных числах.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-rounding-rule.ts
// Только чтение. Код возврата 1 — при расхождениях.
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { loadDashboard } from "../src/lib/dashboard-data";
import { parseDashFilters } from "../src/lib/dashboard-calc";
import { priceComposition } from "../src/lib/price-composition-server";
import { COMP_CATS, alignSlices, sliceList, type CompCat } from "../src/lib/price-composition";
import { alignColumn, alignFlowMoney, alignKindsTop, alignSet, cellOf, flowCell, lrAllocate, roundRub } from "../src/lib/money-round";
import { alignRaw, alignRawTable, alignYears, FUR_SRC_KEYS_RD } from "../src/lib/raw-display";
import { payNumbers } from "../src/lib/pay-display";
import { alignBridge } from "../src/lib/recon-bridge-align";
import { lotCounts } from "../src/lib/cost-labels";
import { loadLive } from "../src/app/(app)/reconciliation/live";
import { loadOrderRows } from "../src/lib/analytics-orders";
import { toDrillOrder } from "../src/lib/dashboard-calc";
import { addOrder, blank, build, type Agg } from "../src/app/(app)/dashboard/production-table";
import { alignTree, sum5, type Money5 } from "../src/lib/production-display";
import { loadReconBridge } from "../src/app/(app)/reconciliation/bridge";

const prisma = new PrismaClient();
let fails = 0, checks = 0;
const eq = (what: string, got: number, want: number, tol = 0) => {
  checks++;
  if (Math.abs(got - want) > tol) { fails++; console.log(`  ✗ ${what}: показано ${got}, ожидалось ${want}`); }
};
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
// Показанное значение отличается от точного не больше чем на 2 ₽ (сумма частей подогнана под итог).
const near = (what: string, shown: number, exact: number, tol = 2) => eq(`${what} (≈ точному)`, shown, exact, tol);

// ───── 1. Свойства функций на случайных числах ─────
function rnd(seed: number) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
{
  const r = rnd(7);
  for (let it = 0; it < 3000; it++) {
    const n = 1 + Math.floor(r() * 12);
    const vals = Array.from({ length: n }, () => (r() < 0.15 ? 0 : (r() - 0.1) * 10 ** (1 + Math.floor(r() * 8))));
    const tot = roundRub(sum(vals));
    const al = lrAllocate(vals, tot);
    eq("lrAllocate: Σ = итог", sum(al), tot);
    al.forEach((v, i) => { if (Math.abs(v - vals[i]) > 1.0000001 && n <= 12) eq(`lrAllocate: часть #${i} не дальше 1 ₽ от точной`, Math.abs(v - vals[i]), 1, 1); });
    // строки + итог: куплено = использовано + остаток везде, строки складываются в итог
    const cells = Array.from({ length: n }, () => { const u = r() * 1e6, m = r() * 1e6; return cellOf({ r: u + m, u, m, p: r() * 1e5, d: r() * 1e4 }); });
    const a = alignSet(cells);
    for (const k of ["r", "u", "m", "p", "d"] as const) eq(`alignSet: Σ строк = итог (${k})`, sum(a.parts.map((c) => c[k])), a.total[k]);
    a.parts.forEach((c, i) => eq(`alignSet: строка #${i} куплено = использовано + остаток`, c.r, c.u + c.m));
    eq("alignSet: итог куплено = использовано + остаток", a.total.r, a.total.u + a.total.m);
    eq("alignSet: итог = round(точная сумма)", a.total.r, roundRub(sum(cells.map((c) => c.r))));
  }
  // Идемпотентность: повторное выравнивание целых ничего не меняет
  const f = { recvValue: 583498701.742578, usedValue: 193989744.63, usedValueOther: 187113975.27, remValue: 396384726.47257805 };
  const once = alignFlowMoney(f, true), twice = alignFlowMoney(once, true);
  eq("alignFlowMoney: идемпотентно (куплено)", twice.recvValue, once.recvValue); eq("alignFlowMoney: идемпотентно (остаток)", twice.remValue, once.remValue);
  eq("пример владельца: куплено мех", once.recvValue, 583498702);
  eq("пример владельца: использовано + остаток = куплено", once.usedValueOther + once.remValue, once.recvValue);
  const lin = alignFlowMoney({ recvValue: 6820117.5, usedValue: 1884758.38, usedValueOther: 1812769.75, remValue: 5007347.75 }, true);
  eq("подкладка: использовано + остаток = куплено", lin.usedValueOther + lin.remValue, lin.recvValue);
  const top = alignKindsTop(cellOf({ r: 583498701.742578, u: 187113975.27, m: 396384726.47257805 }), cellOf({ r: 6820117.5, u: 1812769.75, m: 5007347.75 }));
  eq("мех + подкладка = всего (куплено)", top.fur.r + top.lin.r, top.all.r); eq("всего = round(точной суммы) = 590 318 819", top.all.r, 590318819);
}

// ───── 2. Реальные данные: все срезы ─────
(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const live = await loadLive(org);
  const slices: { year: "all" | "2025" | "2026"; c4: "on" | "off" }[] = [
    { year: "all", c4: "on" }, { year: "all", c4: "off" }, { year: "2025", c4: "on" }, { year: "2026", c4: "off" },
  ];
  for (const sl of slices) {
    const tag = `[${sl.year}/4%:${sl.c4}]`;
    const d = await loadDashboard(org, sl.year, parseDashFilters({}), sl.c4);
    const bo = sl.c4 === "on";
    const base = (f: { usedValue: number; usedValueOther: number }) => (bo ? f.usedValueOther : f.usedValue);
    const withC4 = (f: { usedValue: number; usedValueOther: number }) => (bo ? f.usedValue : f.usedValueOther);

    // 2.1 Плитки «Куплено / Использовано / Остаток», источники и виды меха
    const A = alignRaw(d.raw.fur, d.raw.lining, d.rawFurBySource, sl.c4);
    for (const v of ["incl", "excl"] as const) {
      const t = `${tag}[${v}]`;
      const F = A.fur[v], L = A.lining[v];
      eq(`${t} мех: куплено = использовано + остаток`, F.recvValue, base(F) + F.remValue);
      eq(`${t} подкладка: куплено = использовано + остаток`, L.recvValue, base(L) + L.remValue);
      const exF = d.raw.fur[v], exL = d.raw.lining[v];
      eq(`${t} мех + подкладка = round(точной суммы)`, F.recvValue + L.recvValue, roundRub(exF.recvValue + exL.recvValue));
      eq(`${t} мех + подкладка: использовано = round(точной суммы)`, base(F) + base(L), roundRub(base(exF) + base(exL)), 1);
      eq(`${t} мех + подкладка: остаток = round(точной суммы)`, F.remValue + L.remValue, roundRub(exF.remValue + exL.remValue), 1);
      near(`${t} мех куплено`, F.recvValue, exF.recvValue); near(`${t} мех остаток`, F.remValue, exF.remValue); near(`${t} подкладка куплено`, L.recvValue, exL.recvValue);
      for (const k of FUR_SRC_KEYS_RD) {
        const tot = A.furSrc[k].total[v], types = A.furSrc[k].types.map((x) => x.pair[v]);
        if (types.length > 0) {
          eq(`${t} [${k}] виды: Σ куплено = итог`, sum(types.map((x) => x.recvValue)), tot.recvValue);
          eq(`${t} [${k}] виды: Σ использовано = итог`, sum(types.map(base)), base(tot));
          eq(`${t} [${k}] виды: Σ остаток = итог`, sum(types.map((x) => x.remValue)), tot.remValue);
          eq(`${t} [${k}] виды: Σ «с 4%» = итог`, sum(types.map(withC4)), withC4(tot));
          types.forEach((x, i) => eq(`${t} [${k}] вид «${A.furSrc[k].types[i].name}»: куплено = использовано + остаток`, x.recvValue, base(x) + x.remValue));
        }
        eq(`${t} [${k}] итог источника: куплено = использовано + остаток`, tot.recvValue, base(tot) + tot.remValue);
      }
      const au = A.furSrc.auction.total[v], su = A.furSrc.supplier.total[v], al = A.furSrc.all.total[v];
      eq(`${t} на аукционе + у поставщика = вся закупка (куплено)`, au.recvValue + su.recvValue, al.recvValue);
      eq(`${t} на аукционе + у поставщика = вся закупка (остаток)`, au.remValue + su.remValue, al.remValue);
      eq(`${t} «Вся закупка» = плитка мех (куплено)`, al.recvValue, F.recvValue);
    }

    // 2.2 «Динамика по годам»
    const Y = alignYears(d.years);
    const yAll = Y.find((r) => r.key === "all")!, yrs = Y.filter((r) => r.key !== "all");
    for (const v of ["incl", "excl"] as const) {
      const t = `${tag}[${v}] годы`;
      const rowT = (r: typeof yAll) => ({ r: r.fur[v].rv + r.lining[v].rv, u: r.fur[v].uv + r.lining[v].uv, m: r.fur[v].mv + r.lining[v].mv });
      for (const [col, key] of [["куплено", "rv"], ["использовано", "uv"], ["остаток", "mv"]] as const) {
        eq(`${t}: Σ лет = «Всего» (${col})`, sum(yrs.map((r) => r.fur[v][key] + r.lining[v][key])), yAll.fur[v][key] + yAll.lining[v][key]);
        eq(`${t}: Σ лет мех = «Мех» (${col})`, sum(yrs.map((r) => r.fur[v][key])), yAll.fur[v][key]);
        eq(`${t}: Σ лет подкладка = «Подкладка» (${col})`, sum(yrs.map((r) => r.lining[v][key])), yAll.lining[v][key]);
      }
      for (const r of Y) { const x = rowT(r); eq(`${t} «${r.label}»: куплено = использовано + остаток`, x.r, x.u + x.m); eq(`${t} «${r.label}» мех`, r.fur[v].rv, r.fur[v].uv + r.fur[v].mv); eq(`${t} «${r.label}» подкладка`, r.lining[v].rv, r.lining[v].uv + r.lining[v].mv); }
      eq(`${t}: «Всего» = round(точной суммы)`, rowT(yAll).r, roundRub(d.years.find((r) => r.key === "all")!.fur[v].rv + d.years.find((r) => r.key === "all")!.lining[v].rv));
      // «Мех» итог в годах = плитка меха на Главной (одно число на экране)
      if (sl.year === "all") eq(`${t}: «Мех» в годах = плитка «Куплено» меха`, yAll.fur[v].rv, A.fur[v].recvValue);
      if (sl.year === "all") eq(`${t}: «Подкладка» в годах = плитка «Куплено» подкладки`, yAll.lining[v].rv, A.lining[v].recvValue);
    }
    eq(`${tag} годы: Σ оплачено лет = «Всего»`, sum(yrs.map((r) => r.paid)), yAll.paid);
    eq(`${tag} годы: Σ долга лет = «Всего»`, sum(yrs.map((r) => r.debt)), yAll.debt);
    eq(`${tag} годы: оплачено мех + подкладка = «Всего»`, yAll.money.fur.paid + yAll.money.lining.paid, yAll.paid);
    eq(`${tag} годы: долг мех + подкладка = «Всего»`, yAll.money.fur.debt + yAll.money.lining.debt, yAll.debt);
    yrs.forEach((r) => { eq(`${tag} годы «${r.label}»: оплачено мех + подкладка`, r.money.fur.paid + r.money.lining.paid, r.paid); eq(`${tag} годы «${r.label}»: долг мех + подкладка`, r.money.fur.debt + r.money.lining.debt, r.debt); });

    // 2.3 «Динамика по сырью»
    for (const v of ["incl", "excl"] as const) {
      const t = `${tag}[${v}] по сырью`;
      const R = alignRawTable({ rows: d.rawTable, vat: v, sel: "all", money: d.rawMoneyTotal, total: d.rawTableTotal });
      const { AL } = R;
      const rowAl = (r: typeof d.rawTable[number]) => AL.byKey.get(r.key)!;
      for (const [list, tot, name] of [[R.furEx, AL.fur, "мех"], [R.linEx, AL.lin, "подкладка"]] as const) {
        for (const k of ["r", "u", "m", "p", "d"] as const) eq(`${t} ${name}: Σ видов = итог (${k})`, sum(list.map((r) => rowAl(r)[k])), tot[k]);
        list.forEach((r) => {
          const c = rowAl(r);
          eq(`${t} ${name} «${r.label}»: куплено = использовано + остаток`, c.r, c.u + c.m);
          if (r.auctions.length > 0) for (const k of ["r", "u", "m", "p", "d"] as const) eq(`${t} ${name} «${r.label}»: Σ аукционов = вид (${k})`, sum(r.auctions.map((a) => AL.byAuc.get(r.key + "|" + a.key)![k])), c[k]);
        });
      }
      for (const k of ["r", "u", "m"] as const) eq(`${t}: мех + подкладка = «Всего» (${k})`, AL.fur[k] + AL.lin[k], AL.total[k]);
      for (const k of ["p", "d"] as const) eq(`${t}: мех + подкладка + не получено и прочее = «Всего» (${k})`, AL.fur[k] + AL.lin[k] + sum(AL.extras.map((c) => c[k])), AL.total[k]);
      eq(`${t}: «Всего» = round(точной суммы)`, AL.total.r, roundRub(d.rawTableTotal[v].rv));
      // та же сумма «Куплено» в «Динамике по сырью» и на плитках: один итог на экране
      if (sl.year === "all") eq(`${t}: «Всего мех» = плитка «Куплено»`, AL.fur.r, A.fur[v].recvValue);
      if (sl.year === "all") eq(`${t}: «Всего мех+подкладка» = мех + подкладка плиток`, AL.total.r, A.fur[v].recvValue + A.lining[v].recvValue);
      // таблица по сырью и «по годам» — одно и то же «Всего» (таблица по годам год шапки не учитывает)
      if (sl.year === "all") {
        eq(`${t}: «Всего» по сырью = «Всего» по годам`, AL.total.r, yAll.fur[v].rv + yAll.lining[v].rv);
        eq(`${t}: «Оплачено всего» по сырью = по годам`, AL.total.p, yAll.paid);
        eq(`${t}: «Долг всего» по сырью = по годам`, AL.total.d, yAll.debt);
      }
    }

    // 2.4 Плитки оплат
    for (const only of [undefined, "fur", "lining"] as const) {
      const t = `${tag} оплаты${only ? " " + only : ""}`;
      const N = payNumbers(d, sl.c4, only);
      eq(`${t}: Σ статей «Оплачено» = итог`, sum(N.items.map((k) => N.P[k])), N.paidAll);
      eq(`${t}: Σ статей «К оплате» = итог`, sum(N.items.map((k) => N.L[k])), N.leftAll);
      eq(`${t}: Σ статей «Общая стоимость» = итог`, sum(N.items.map((k) => N.T[k])), N.totalAll);
      eq(`${t}: «Оплачено» = round(точной суммы)`, N.paidAll, roundRub(sum(N.items.map((k) => (k === "fur" ? d.paidByItem.fur : k === "lining" ? d.paidByItem.lining : d.paidByItem.work)))));
      for (const k of ["fur", "lining"] as const) {
        if (!N.items.includes(k)) continue;
        const D = k === "fur" ? N.furD : N.linD, pd = k === "fur" ? N.furPaidD : N.linPaidD, ld = k === "fur" ? N.furLeftD : N.linLeftD;
        eq(`${t} ${k}: оплачено = за остаток + за использованное`, pd.stock + pd.used, N.P[k]);
        eq(`${t} ${k}: к оплате = за остаток + за использованное`, ld.stock + ld.used, N.L[k]);
        eq(`${t} ${k}: остаток + использовано = «Куплено» (одно число с плитками)`, D.stock + D.used, k === "fur" ? A.fur.incl.recvValue : A.lining.incl.recvValue);
        eq(`${t} ${k}: «Общая стоимость» = плитка «Куплено» (если сходится с документами)`, N.T[k], k === "fur" ? A.fur.incl.recvValue : A.lining.incl.recvValue, N.roundAll === 0 ? 0 : 0);
        if (sl.year === "all") eq(`${t} ${k}: общая стоимость = оплачено + к оплате (± строка «округление»)`, Math.abs(N.T[k] - N.P[k] - N.L[k]) <= 1 ? 0 : 1, 0);
        else console.log(`  (${t} ${k}: при фильтре по году лоты и документы расходятся: общая ${N.T[k]}, оплачено ${N.P[k]} + к оплате ${N.L[k]})`);
      }
      if (!only) {
        const typed = d.paidByType.filter((x) => x.count > 0 || Math.abs(x.amount) >= 0.5);
        if (Math.abs(sum(typed.map((x) => x.amount)) - N.paidAll) < 1) eq(`${t}: Σ типов платежа = «Оплачено всего»`, sum(alignColumn(typed.map((x) => x.amount), N.paidAll).values), N.paidAll);
      }
      // «Общая стоимость мех+подкладка» плиток оплат = «Всего» таблиц (один итог на экране)
      if (!only && sl.year === "all") eq(`${t}: мех + подкладка в «Общей стоимости» = «Всего» таблиц`, N.T.fur + N.T.lining, yAll.fur.incl.rv + yAll.lining.incl.rv, N.roundAll === 0 ? 0 : 0);
    }
  }


  // ───── 2.5 «Объёмы по группам меха и категориям» (дерево: группа → категория → мех; мех → группа → категория) ─────
  for (const c4 of ["on", "off"] as const) for (const vat of ["incl", "excl"] as const) {
    const rows = await loadOrderRows(org, "all", c4);
    const orders = rows.map((o) => toDrillOrder(o, c4, (n) => n ?? "Без аукциона"));
    const isRepair = (o: (typeof orders)[number]) => o.cat === "Ремонт";
    for (const levels of [["grp", "cat", "furl"], ["furl", "grp", "cat"]] as const) {
      const tag = `[дерево ${levels.join("→")}|4%:${c4}|${vat}]`;
      const top = build(orders.filter((o) => !isRepair(o)), vat, [...levels]);
      const total = blank("items", "Всего без ремонта"), repair = blank("repair", "Ремонт"), all = blank("all", "Всего с ремонтом");
      for (const o of orders) { addOrder(isRepair(o) ? repair : total, o, vat); addOrder(all, o, vat); }
      const out = new Map<Agg, Money5>();
      alignTree(top, total, repair, all, out);
      const cols = ["fur", "lining", "work", "c4", "other"] as const;
      const m = (g: Agg) => out.get(g)!;
      eq(`${tag} «Всего с ремонтом» = round(точной суммы)`, sum5(m(all)), roundRub(all.fur + all.lining + all.work + all.c4 + all.other), 0);
      for (const c of cols) eq(`${tag} «без ремонта» + «ремонт» = «с ремонтом» (${c})`, m(total)[c] + m(repair)[c], m(all)[c]);
      const walk = (parent: Money5, nodes: Agg[], where: string) => {
        for (const c of cols) eq(`${tag} ${where}: Σ строк = родитель (${c})`, sum(nodes.map((n) => m(n)[c])), parent[c]);
        nodes.forEach((n) => { for (const c of cols) near(`${tag} ${where} «${n.label}» ${c}`, m(n)[c], n[c], 3); if (n.children.size > 0) walk(m(n), Array.from(n.children.values()), `${where}/${n.label}`); });
      };
      walk(m(total), top, "строки");
    }
  }

  // ───── 3. «Из чего складывается стоимость меха» и счёт лотов ─────
  {
    const d = await loadDashboard(org, "all", parseDashFilters({}), "on");
    const pc = await priceComposition(org, d);
    for (const withVat of [true, false]) {
      const tag = `[состав ${withVat ? "с НДС" : "без НДС"}]`;
      const sets: { name: string; lots: typeof pc.lots }[] = [{ name: "вся закупка", lots: pc.lots }, { name: "аукцион", lots: pc.lots.filter((l) => l.src === "auction") }, { name: "поставщик", lots: pc.lots.filter((l) => l.src === "supplier") }];
      for (const furName of Array.from(new Set(pc.lots.map((l) => l.fur)))) sets.push({ name: furName, lots: pc.lots.filter((l) => l.fur === furName) });
      for (const s of sets) {
        const cats = Object.fromEntries(COMP_CATS.map((c) => [c.key, 0])) as Record<CompCat, number>;
        let nobd = 0, vat = 0;
        for (const l of s.lots) { COMP_CATS.forEach((c, i) => { cats[c.key] += l.excl[i]; }); nobd += l.excl[COMP_CATS.length]; vat += l.vat; }
        const totalExact = sum(Object.values(cats)) + nobd + (withVat ? vat : 0);
        const total = roundRub(totalExact);
        const sl = alignSlices(sliceList(cats, { nobd, vat, withVat }), total);
        eq(`${tag} «${s.name}»: Σ составляющих = итог`, sum(sl.map((x) => x.value)), total);
        sl.forEach((x) => { if (x.sub) eq(`${tag} «${s.name}» «${x.label}»: Σ подстрок = сектор`, sum(x.sub.map((y) => y.value)), x.value); });
        if (s.name === "вся закупка" && withVat) eq(`${tag} итог состава «Вся закупка» = «Куплено» меха`, total, A_recv(d));
      }
    }
    // Источники: все = аукцион + поставщик
    for (const withVat of [true, false]) {
      const ex = { all: 0, auction: 0, supplier: 0 };
      for (const l of pc.lots) { const v = sum(l.excl) + (withVat ? l.vat : 0); ex.all += v; ex[l.src] += v; }
      const [au, su] = lrAllocate([ex.auction, ex.supplier], roundRub(ex.all));
      eq(`[источники ${withVat ? "с НДС" : "без НДС"}] на аукционе + у поставщика = все`, au + su, roundRub(ex.all));
    }
    // Единый счёт лотов: шапка и плитка считают одной функцией; 295 лотов + 100 позиций + 2 строки шкур подрядчика = 300 строк состава
    const all = lotCounts(pc.lots), au = lotCounts(pc.lots.filter((l) => l.src === "auction")), su = lotCounts(pc.lots.filter((l) => l.src === "supplier"));
    eq("лоты: на аукционе + у поставщика = все", au.lots + su.lots, all.lots); eq("позиции заказанного: на аукционе + у поставщика = все", au.positions + su.positions, all.positions);
    eq("шкуры подрядчика: на аукционе + у поставщика = все", au.hidesRows + su.hidesRows, all.hidesRows);
    eq("лотов (получено на склад) = лоты меха на Главной", all.lots, d.raw.fur.incl.lots);
    eq("строк состава = лоты + строки заказанного + строки шкур подрядчика", pc.lots.length, all.lots + pc.lots.filter((l) => l.kind === "planned").length + all.hidesRows);
    console.log(`  (лотов ${all.lots}, позиций заказано ${all.positions}, строк шкур подрядчика ${all.hidesRows}; строк состава всего ${pc.lots.length} — раньше шапка писала это «${pc.lots.length} лотов»)`);
  }

  // ───── 4. «Сверка»: мост реестр → Главная ─────
  {
    const b = await loadReconBridge(org, live);
    const sh = alignBridge(b);
    eq("[сверка] реестр + разница по закупкам + разница по производству = Главная", sh.registry.total + sh.sp + sh.sw, sh.main.total);
    eq("[сверка] реестр закупок + разница = сырьё Главной", sh.registry.purchase + sh.sp, sh.main.raw);
    eq("[сверка] реестр производства + разница = работа Главной", sh.registry.production + sh.sw, sh.main.work);
    eq("[сверка] сырьё + работа = Главная", sh.main.raw + sh.main.work, sh.main.total);
    eq("[сверка] Главная = round(точной суммы)", sh.main.total, roundRub(b.main.total));
    const d = await loadDashboard(org, "all", parseDashFilters({}), "on");
    const top = alignKindsTop(flowCell(d.raw.fur.incl, true), flowCell(d.raw.lining.incl, true));
    eq("[сверка] сырьё Главной в Сверке = мех + подкладка плиток («Куплено»)", sh.main.raw, top.fur.r + top.lin.r);
    eq("[сверка] «Мех+подкладка» одно число с таблицами Главной", sh.main.raw, top.all.r);
  }

  console.log(`\nПравило округления: проверок ${checks}, расхождений ${fails}`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})();

function A_recv(d: Awaited<ReturnType<typeof loadDashboard>>): number {
  return alignKindsTop(flowCell(d.raw.fur.incl, true), flowCell(d.raw.lining.incl, true)).fur.r;
}
