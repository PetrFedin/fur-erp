// Сверка чисел Сводки (/dashboard) с SQL: куплено / использовано / остаток (мех), производство, Σ столбцов гистограммы по уровням.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-dashboard-numbers.ts
// Только чтение. Код возврата 1 — при расхождениях.
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { loadFurLots } from "../src/lib/fur-table-server";
import { figures, flowOf } from "../src/lib/fur-table";
import { loadOrderRows } from "../src/lib/analytics-orders";
import { toDrillOrder } from "../src/lib/dashboard-calc";
import { loadDashboard } from "../src/lib/dashboard-data";
import { loadDebtInputs, supplierDebtFromInputs } from "../src/lib/supplier-debt";
import { productionSplit } from "../src/lib/production-totals";
import { readFileSync } from "node:fs";
import { CHAIN, levelFor, drillTotals, type PathStep, type RootMode, type VatSel } from "../src/lib/dashboard-drill";

const prisma = new PrismaClient();
let fails = 0, checks = 0;
const eq = (what: string, got: number, want: number, tol = 0.02) => {
  checks++;
  if (Math.abs(got - want) > tol) { fails++; console.log(`  ✗ ${what}: получено ${got}, ожидалось ${want}`); }
};

(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  // 1. Эталоны владельца (мех, все годы, с НДС)
  const fur = await loadFurLots(prisma, org, { kind: "fur", year: "all" });
  const f = flowOf(fur);
  const on = figures(f, { vat: "incl", c4: "on" });
  const off = figures(f, { vat: "incl", c4: "off" });
  eq("куплено шт", on.recvQty, 18215); eq("куплено ₽", on.recvValue, 399225945.58);
  eq("остаток шт", on.remQty, 9909); eq("остаток ₽", on.remValue, 226704828.65);
  eq("использовано шт", on.usedQty, 8306); eq("использовано без 4%", off.usedValue, 172521116.93); eq("использовано с 4%", on.usedValue, 178822087.35);
  eq("USD: куплено = использовано + остаток (шт на USD-лотах)", on.usdQty, on.usdUsedQty + on.usdRemQty);

  // 2. SQL независимо: куплено/остаток по лотам меха
  const [r] = await prisma.$queryRawUnsafe<{ q: number; rem: number }[]>(
    `select sum(l."quantityReceived")::float q, sum(l."quantityRemaining")::float rem from "RawMaterialLot" l join "RawMaterial" m on m.id=l."rawMaterialId" where l."organizationId"='${org}' and m.unit<>'M'`);
  eq("SQL куплено шт", on.recvQty, r.q); eq("SQL остаток шт", on.remQty, r.rem);

  // 3. Производство и Σ столбцов гистограммы на трёх срезах: все годы / 2025 / 2026, оба режима 4% и НДС
  for (const c4 of ["on", "off"] as const) {
    const rows = await loadOrderRows(org, "all", c4);
    for (const y of ["all", "2025", "2026"]) {
      const sel = rows.filter((o) => o.status === "COMPLETED" && (y === "all" || o.year === Number(y)));
      const drill = sel.map((o) => toDrillOrder(o, c4, (n) => n ?? "Без аукциона"));
      for (const vat of ["incl", "excl"] as VatSel[]) {
        const tile = sel.reduce((s, o) => s + (vat === "incl" ? o.costIncl : o.costExcl), 0);
        const tot = drillTotals(drill, vat);
        eq(`[${y}/${c4}/${vat}] себестоимость плитки = Σ ТЗ`, tot.cost, tile, 0.05);
        for (const mode of Object.keys(CHAIN) as RootMode[]) {
          const l1 = levelFor(drill, mode, [], vat);
          eq(`[${y}/${c4}/${vat}/${mode}] Σ столбцов = плитка`, l1.total, tile, 0.05);
          // уровень 2 и 3 по первому столбцу, дальше — до состава
          let path: PathStep[] = [];
          let level = l1;
          for (let d = 0; d < 6 && level.kind === "dim" && level.items.length > 0; d++) {
            const it = level.items[0];
            path = [...path, { dim: level.dim!, key: it.key, label: it.label }];
            const next = levelFor(drill, mode, path, vat);
            eq(`[${y}/${c4}/${vat}/${mode}] Σ уровня ${d + 2} = столбец «${it.label}»`, next.total, it.value, 0.05);
            level = next;
          }
          if (level.kind === "composition") {
            for (const part of level.items.filter((i) => i.drillable)) {
              const ln = levelFor(drill, mode, [...path, { dim: "part", key: part.key, label: part.label }], vat);
              eq(`[${y}/${c4}/${vat}/${mode}] Σ лотов «${part.label}»`, ln.total, part.value, 0.05);
            }
          }
        }
      }
    }
  }

  // 4. Цена в USD: покрытие и средневзвешенная $/шт. независимо от кода (SQL + файл расчётов Drive)
  eq("USD: лотов с ценой", fur.filter((l) => l.usdPrice != null).length, 263, 0);
  eq("USD: куплено шт. с ценой", on.usdQty, 16790);
  eq("USD: Σ по источникам = usdQty", on.usdBySource.direct + on.usdBySource.eur + on.usdBySource.rub + on.usdBySource.calc, on.usdQty);
  const sqlUsd = await prisma.$queryRawUnsafe<{ q: number; s: number }[]>(`
    with x as (select l."quantityReceived" q, l."vatRate" v, l."costBreakdown"->'items' it from "RawMaterialLot" l join "RawMaterial" m on m.id=l."rawMaterialId" where l."organizationId"='${org}' and m.unit<>'M'),
    y as (select q,
      (select (e->>'value')::numeric from jsonb_array_elements(it) e where e->>'label' in ('Цена за ед. (ам. долл.)','Цена за ед., $') limit 1) direct,
      (select (e->>'value')::numeric from jsonb_array_elements(it) e where e->>'label'='НДС на шкуры')/(v/100)/nullif((select (e->>'value')::numeric from jsonb_array_elements(it) e where e->>'label'='Курс ЦБ (фиксация)'),0) rub
      from x)
    select coalesce(sum(q),0)::float q, coalesce(sum(q*coalesce(direct,rub)),0)::float s from y where coalesce(direct,rub) is not null and coalesce(direct,rub)>0`);
  // Остальное — из расчётов Drive: строки src/data/lot-usd-sources.json (EUR × курс инвойса из лота, либо $ из расчёта)
  const refs = JSON.parse(readFileSync("src/data/lot-usd-sources.json", "utf8")).lots as Record<string, { currency: string; price: number }>;
  let refQ = 0, refS = 0;
  for (const l of fur) {
    if (l.usdSource !== "eur×rate" && l.usdSource !== "calc") continue;
    const r = refs[`${l.purchaseNumber}|${l.lotNumber}`];
    const [lot] = await prisma.$queryRawUnsafe<{ inv: number | null }[]>(`select (select (e->>'value')::float from jsonb_array_elements(l."costBreakdown"->'items') e where e->>'label'='Валютный курс инвойса') inv from "RawMaterialLot" l where l.id='${l.id}'`);
    refQ += l.recv; refS += l.recv * r.price * (r.currency === "EUR" ? (lot.inv as number) : 1);
  }
  eq("USD: независимое Σ шт.", on.usdQty, sqlUsd[0].q + refQ);
  eq("USD: независимая средневзвешенная $/шт.", on.usdAvg ?? 0, (sqlUsd[0].s + refS) / (sqlUsd[0].q + refQ), 0.005);
  console.log(`  USD: ${on.usdQty} из ${on.recvQty} шт. (${((on.usdQty / on.recvQty) * 100).toFixed(1)}%), $/шт. ${on.usdAvg?.toFixed(2)}`);

  // 5. «Произведено» и «в работе» — одна логика (production-totals.ts)
  const [pq] = await prisma.$queryRawUnsafe<{ done: number; doneN: number; work: number; workN: number }[]>(
    `select coalesce(sum("producedQuantity") filter (where status='COMPLETED'),0)::float done, count(*) filter (where status='COMPLETED')::int "doneN",
            coalesce(sum("plannedQuantity") filter (where status in ('PLANNED','IN_PROGRESS')),0)::float work, count(*) filter (where status in ('PLANNED','IN_PROGRESS'))::int "workN"
     from "ProductionOrder" where "organizationId"='${org}'`);
  const dash = await loadDashboard(org, "all", { auction: [], fur: [], color: [], batch: [], status: [], vat: [] }, "on");
  eq("произведено шт. (Сводка) = SQL завершённые", dash.prod.done.qty, pq.done);
  eq("произведено ТЗ", dash.prod.done.orders, pq.doneN, 0);
  eq("в работе шт. (Сводка) = SQL план В работе+Запланировано", dash.prod.work.qty, pq.work);
  eq("в работе ТЗ", dash.prod.work.orders, pq.workN, 0);
  const allOrders = await prisma.productionOrder.findMany({ where: { organizationId: org }, select: { status: true, plannedQuantity: true, producedQuantity: true } });
  const sp = productionSplit(allOrders);
  eq("productionSplit.произведено", sp.producedUnits, pq.done); eq("productionSplit.в работе", sp.inWorkUnits, pq.work);
  const [pa] = await prisma.$queryRawUnsafe<{ s: number }[]>(`select coalesce(sum("producedQuantity"),0)::float s from "ProductionOrder" where "organizationId"='${org}' and status<>'CANCELLED'`);
  console.log(`  (старое «выпущено» = Σ producedQuantity по всем статусам: ${pa.s}; новое «произведено»: ${pq.done}; в работе отдельно: ${pq.work})`);

  // 6. «Динамика по годам»: итог = сумма строк по каждой аддитивной колонке; долг года = loadSupplierDebt(год)
  const rows = dash.years.filter((r) => r.key !== "all"), tot = dash.years.find((r) => r.key === "all")!;
  const sumOf = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  for (const vat of ["incl", "excl"] as const) {
    for (const k of ["rq", "rv", "uq", "uv", "mq", "mv"] as const) {
      eq(`годы [${vat}] Σ строк = итог: сырьё мех ${k}`, sumOf((r) => r.fur[vat][k]), tot.fur[vat][k], 0.01);
      eq(`годы [${vat}] Σ строк = итог: подкладка ${k}`, sumOf((r) => r.lining[vat][k]), tot.lining[vat][k], 0.01);
    }
  }
  eq("годы: Σ произведено шт.", sumOf((r) => r.prod.qty), tot.prod.qty); eq("годы: Σ произведено = плитка", tot.prod.qty, dash.prod.done.qty);
  eq("годы: Σ себестоимость произведённого", sumOf((r) => r.prod.costIncl), tot.prod.costIncl, 0.05);
  eq("годы: Σ оплачено", sumOf((r) => r.paid), tot.paid, 0.01);
  eq("годы: Σ долга по годам = итог", sumOf((r) => r.debt), tot.debt, 0.01);
  const dinp = await loadDebtInputs(prisma, org);
  eq("годы: итог долга = долг «все годы» (loadSupplierDebt)", tot.debt, supplierDebtFromInputs(dinp, "all").debt.toNumber(), 0.01);
  for (const r of rows) if (/^\d{4}$/.test(r.key)) eq(`годы: долг ${r.key} = loadSupplierDebt(${r.key})`, r.debt, supplierDebtFromInputs(dinp, r.key as never).debt.toNumber(), 0.01);
  eq("годы: нет строк без данных", rows.filter((r) => r.fur.incl.rq === 0 && r.lining.incl.rq === 0 && r.prod.qty === 0 && r.paid === 0 && r.debt === 0).length, 0, 0);
  console.log(`${checks} проверок, расхождений: ${fails}`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})();
