// Сверка чисел Главной (/dashboard) с независимым SQL. Обновлён 15.10.2026 под действующую логику (прежняя версия падала на 3379 проверках — разбор в конце файла):
//   • эталоны владельца за 09.10 (куплено 18 215 шт. и т.п.) убраны: данные выросли; те же величины сверяются с SQL (раздел 2 и 8);
//   • «Полная себестоимость» плитки = себестоимость сырья + работа подрядчика (прежний тест сравнивал без работы);
//   • в таблицах сырья «использовано» всегда без 4%, «с 4%» лежит рядом (uo) и не зависит от режима шапки;
//   • «произведено / в выпуске» считается записями ТЗ с ремонтом отдельно; «в выпуске» = завершённые + в работе;
//   • долг поставщику учитывает зачёт переплат аукционов (overpaid), оплаты заказчиков — без шкур подрядчика (hides, это сырьё).
// Правило округления на экране (сумма показанных частей = показанный итог) — scripts/test-rounding-rule.ts; расчёты сверки с документами — scripts/test-reconciliation.ts.
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
  // 1. Связи плиток мех «куплено = использовано + остаток» (эталоны владельца за 09.10 убраны — данные выросли; суммы сверяются с SQL ниже)
  const fur = await loadFurLots(prisma, org, { kind: "fur", year: "all" });
  const f = flowOf(fur);
  const on = figures(f, { vat: "incl", c4: "on" });
  const off = figures(f, { vat: "incl", c4: "off" });
  eq("мех: куплено шт = использовано + остаток", on.recvQty, on.usedQty + on.remQty, 0.002);
  eq("мех: использовано (с 4%) ≥ использовано (без 4%)", Math.max(0, off.usedValue - on.usedValue), 0, 0.001);
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
        const tile = sel.reduce((s, o) => s + (vat === "incl" ? o.costIncl : o.costExcl) + o.work, 0); // «Полная себестоимость (с работой)»
        const tot = drillTotals(drill, vat);
        eq(`[${y}/${c4}/${vat}] себестоимость плитки = Σ ТЗ`, tot.cost, tile, 0.05);
        for (const mode of Object.keys(CHAIN) as RootMode[]) {
          const l1 = levelFor(drill, mode, [], vat);
          // «По виду меха» показывает только материалы (работу подрядчика к виду меха не отнести), остальные режимы — полную себестоимость с работой.
          eq(`[${y}/${c4}/${vat}/${mode}] Σ столбцов = плитка${mode === "fur" ? " (без работы)" : ""}`, l1.total, mode === "fur" ? tile - sel.reduce((a, o) => a + o.work, 0) : tile, 0.05);
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
  const dash = await loadDashboard(org, "all", { auction: [], fur: [], color: [], batch: [], status: [], vat: [], attr: [], catgroup: [] }, "on");
  eq("произведено шт. (Сводка, ремонт отдельно) = SQL завершённые", dash.prod.done.qty + dash.prod.done.repairQty, pq.done);
  eq("произведено ТЗ (записей: производство + ремонт; уникальных номеров ТЗ меньше — у ТЗ бывает несколько позиций)", dash.prod.done.items + dash.prod.done.repairItems, pq.doneN, 0);
  eq("в работе шт. (Сводка, ремонт отдельно) = SQL план В работе+Запланировано", dash.prod.work.qty + dash.prod.work.repairQty, pq.work);
  eq("в работе ТЗ (записей)", dash.prod.work.items + dash.prod.work.repairItems, pq.workN, 0);
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
  eq("годы: Σ произведено шт.", sumOf((r) => r.prod.qty), tot.prod.qty); eq("годы: Σ «в выпуске» = завершённые + в работе (плитки)", tot.prod.qty, dash.prod.done.qty + dash.prod.work.qty);
  eq("годы: Σ себестоимость выпуска", sumOf((r) => r.prod.costIncl), tot.prod.costIncl, 0.05);
  eq("годы: Σ оплачено", sumOf((r) => r.paid), tot.paid, 0.01);
  eq("годы: Σ долга по годам = итог", sumOf((r) => r.debt), tot.debt, 0.01);
  const dinp = await loadDebtInputs(prisma, org);
  eq("годы: итог долга = долг «все годы» (loadSupplierDebt)", tot.debt, supplierDebtFromInputs(dinp, "all").debt.toNumber(), 0.01);
  for (const r of rows) if (/^\d{4}$/.test(r.key)) eq(`годы: долг ${r.key} = loadSupplierDebt(${r.key}) (до 2 коп.: доли лотов дробят копейки между годами)`, r.debt, supplierDebtFromInputs(dinp, r.key as never).debt.toNumber(), 0.02);
  eq("годы: нет строк без данных", rows.filter((r) => r.fur.incl.rq === 0 && r.lining.incl.rq === 0 && r.prod.qty === 0 && r.paid === 0 && r.debt === 0).length, 0, 0);

  // ───────── 7. ИНВАРИАНТЫ ПО РЕЖИМАМ: год (Все/2025/2026) × 4% (с/без) × фильтры Сводки; НДС проверяется в обеих ветках пар ─────────
  type Dash = Awaited<ReturnType<typeof loadDashboard>>;
  const E0 = { auction: [] as string[], fur: [] as string[], color: [] as string[], batch: [] as string[], status: [] as string[], vat: [] as string[], attr: [] as string[], catgroup: [] as string[] };
  const memo = new Map<string, Dash>();
  const dd = async (y: "all" | "2025" | "2026", f: typeof E0, c4: "on" | "off") => {
    const k = `${y}|${c4}|${JSON.stringify(f)}`;
    if (!memo.has(k)) memo.set(k, await loadDashboard(org, y, f, c4));
    return memo.get(k)!;
  };
  const base = await dd("all", E0, "on");
  const first = (k: "auction" | "fur" | "color") => base.options[k][0]?.value;
  const FSETS: [string, typeof E0][] = [
    ["без фильтров", E0],
    ["мех: " + first("fur"), { ...E0, fur: [first("fur")] }],
    ["аукцион: " + String(first("auction")).slice(0, 20), { ...E0, auction: [first("auction")] }],
    ["цвет: " + first("color"), { ...E0, color: [first("color")] }],
    ["НДС 20%", { ...E0, vat: ["20"] }],
    ["НДС 22%", { ...E0, vat: ["22"] }],
    ["статус Завершён", { ...E0, status: ["COMPLETED"] }],
    ["статус В работе", { ...E0, status: ["IN_PROGRESS"] }],
    ["партия пр-ва: без партии", { ...E0, batch: ["none"] }],
  ];
  const YS = ["all", "2025", "2026"] as const;
  const C4S = ["on", "off"] as const;
  const VATS = ["incl", "excl"] as const;
  const cellsEq = (what: string, a: Dash["years"][number]["fur"], b: Dash["years"][number]["fur"], tol = 0.02) => {
    for (const v of VATS) for (const k of ["rq", "rv", "uq", "uv", "mq", "mv"] as const) eq(`${what} [${v}] ${k}`, a[v][k], b[v][k], tol);
  };
  const kinds = ["fur", "lining"] as const;

  for (const [fname, f] of FSETS) {
    const lotOn = Boolean(f.auction.length || f.fur.length || f.color.length || f.vat.length);
    const ordOn = Boolean(f.status.length || f.batch.length);
    const anyOn = lotOn || ordOn;
    for (const c4 of C4S) {
      const all = await dd("all", f, c4);
      for (const y of YS) {
        const d = await dd(y, f, c4);
        const tag = `[${fname}|${y}|4%:${c4}]`;
        // 7.1 «Сырьё»: куплено − использовано (без 4%) = остаток (шт и ₽ обеих ставок). Фильтр по ТЗ сужает «использовано» → тогда ≥.
        for (const kd of kinds) for (const v of VATS) {
          const x = d.raw[kd][v];
          const usedBase = c4 === "on" ? x.usedValueOther : x.usedValue;
          if (!ordOn) {
            eq(`${tag} ${kd}/${v}: куплено − использовано = остаток, шт`, x.recvQty - x.usedQty, x.remQty, 0.002);
            eq(`${tag} ${kd}/${v}: куплено − использовано(без 4%) = остаток, ₽`, x.recvValue - usedBase, x.remValue, 1);
          } else {
            checks++; if (x.recvQty - x.usedQty < x.remQty - 0.002) { fails++; console.log(`  ✗ ${tag} ${kd}/${v}: при фильтре по ТЗ куплено − использовано < остатка`); }
          }
          // 4%: ровно +4% к использованному с флагом; «other» — противоположный режим
          const on_ = c4 === "on" ? x.usedValue : x.usedValueOther, off_ = c4 === "on" ? x.usedValueOther : x.usedValue;
          checks++; if (on_ < off_ - 0.01 || on_ > off_ * 1.0401 + 0.01) { fails++; console.log(`  ✗ ${tag} ${kd}/${v}: надбавка 4% вне 0…4% от использованного (${on_} vs ${off_})`); }
        }
        // 7.2 НДС: при фильтре одной ставки с НДС / без НДС = 1,20 или 1,22 по закупке (плитки сырья)
        if (f.vat.length === 1) for (const kd of kinds) {
          const x = d.raw[kd];
          if (x.incl.recvValue > 1000) {
            const k = Number(f.vat[0]) / 100 + 1;
            const maxDev = Math.abs(x.incl.recvValue / x.excl.recvValue - k);
            checks++; if (maxDev > 0.0005) { fails++; console.log(`  ✗ ${tag} ${kd}: с НДС / без НДС = ${(x.incl.recvValue / x.excl.recvValue).toFixed(5)}, ожидалось ${k}`); }
          }
        }
        // 7.3 плитка = таблица «по сырью» = строки таблицы; сумма по аукционам = строка
        for (const v of VATS) {
          const furRows = d.rawTable.filter((r) => r.kind === "fur"), linRows = d.rawTable.filter((r) => r.kind === "lining");
          for (const k of ["rq", "rv", "uq", "uv", "mq", "mv"] as const) {
            const sumR = (rows: typeof furRows) => rows.reduce((a, r) => a + r.cells[v][k], 0);
            const tile = (kd: "fur" | "lining") => ({ rq: d.raw[kd][v].recvQty, rv: d.raw[kd][v].recvValue, uq: d.raw[kd][v].usedQty, uv: c4 === "on" ? d.raw[kd][v].usedValueOther : d.raw[kd][v].usedValue, mq: d.raw[kd][v].remQty, mv: d.raw[kd][v].remValue })[k];
            eq(`${tag} плитка мех = Σ строк таблицы [${v}] ${k}`, tile("fur"), sumR(furRows), 0.05);
            eq(`${tag} плитка подкладка = Σ строк таблицы [${v}] ${k}`, tile("lining"), sumR(linRows), 0.05);
            eq(`${tag} «Всего» = мех + подкладка [${v}] ${k}`, d.rawTableTotal[v][k], tile("fur") + tile("lining"), 0.05);
            for (const r of d.rawTable) eq(`${tag} «${r.label}» = Σ по аукционам [${v}] ${k}`, r.cells[v][k], r.auctions.reduce((a, au) => a + au.cells[v][k], 0), 0.05);
          }
        }
        // 7.3а КАЖДЫЙ вид меха/ткань (и каждый аукцион внутри): штуки и деньги складываются в одной базе (без 4%),
        //      средневзвешенная «куплено» лежит между средневзвешенными «использовано (без 4%)» и «остаток».
        //      «Куплено» и «Остаток» не зависят от режима 4%; «использовано» в обеих базах показано рядом (uv/uo).
        const otherC4 = await dd(y, f, c4 === "on" ? "off" : "on");
        for (const r of d.rawTable) for (const v of VATS) {
          const o = otherC4.rawTable.find((x) => x.key === r.key);
          const groups = [{ n: r.label, c: r.cells[v], o: o?.cells[v] }, ...r.auctions.map((a) => ({ n: `${r.label}/${a.label}`, c: a.cells[v], o: o?.auctions.find((x) => x.key === a.key)?.cells[v] }))];
          for (const g of groups) {
            const c = g.c;
            const usedBaseV = c.uv, usedC4V = c.uo; // таблицы всегда показывают «использовано» без 4% (uv), «с 4%» лежит рядом (uo)
            if (g.o) { eq(`${tag} ${g.n} [${v}]: «куплено» не зависит от 4%`, c.rv, g.o.rv, 0.001); eq(`${tag} ${g.n} [${v}]: «остаток» не зависит от 4%`, c.mv, g.o.mv, 0.001); eq(`${tag} ${g.n} [${v}]: «использовано» с 4% одинаково в обоих режимах`, usedC4V, g.o.uo, 0.001); eq(`${tag} ${g.n} [${v}]: «использовано» без 4% одинаково в обоих режимах`, usedBaseV, g.o.uv, 0.001); }
            checks++; if (usedC4V < usedBaseV - 0.01) { fails++; console.log(`  ✗ ${tag} ${g.n} [${v}]: с 4% меньше, чем без 4%`); }
            if (ordOn) continue;
            eq(`${tag} ${g.n} [${v}]: куплено − использовано = остаток, шт.`, c.rq - c.uq, c.mq, 0.002);
            eq(`${tag} ${g.n} [${v}]: куплено = использовано(без 4%) + остаток, ₽`, c.rv, usedBaseV + c.mv, 1);
            if (c.uq > 0 && c.mq > 0 && c.ra != null && c.ma != null) {
              const ua = usedBaseV / c.uq, lo = Math.min(ua, c.ma) - 0.02, hi = Math.max(ua, c.ma) + 0.02;
              checks++; if (c.ra < lo || c.ra > hi) { fails++; console.log(`  ✗ ${tag} ${g.n} [${v}]: ср. цена куплено ${c.ra} вне [${lo.toFixed(2)}; ${hi.toFixed(2)}] (использовано без 4% ${ua.toFixed(2)}, остаток ${c.ma})`); }
            }
          }
        }
        // 7.4 «Динамика по годам»: строка года = вид сырья/производство при выбранном годе; «Итого» = «Все годы»
        const row = (key: string) => d.years.find((r) => r.key === key);
        const allRow = all.years.find((r) => r.key === "all")!;
        if (y === "all") {
          cellsEq(`${tag} итог years.fur = плитка`, { incl: allRow.fur.incl, excl: allRow.fur.excl }, { incl: d.raw.fur.incl as never, excl: d.raw.fur.excl as never } as never);
          eq(`${tag} итог years: «в выпуске» шт. = завершённые + в работе`, allRow.prod.qty, d.prod.done.qty + d.prod.work.qty);
          eq(`${tag} итог years: себестоимость = завершённые + в работе`, allRow.prod.costIncl, d.prod.done.costIncl + d.prod.work.costIncl, 0.05);
          eq(`${tag} итог years: себестоимость без НДС = завершённые + в работе`, allRow.prod.costExcl, d.prod.done.costExcl + d.prod.work.costExcl, 0.05);
          eq(`${tag} итог years: работа = завершённые + в работе`, allRow.prod.work, d.prod.done.workSum + d.prod.work.workSum, 0.05);
        } else {
          const yr = all.years.find((r) => r.key === y);
          // Строки года без данных в таблицу динамики не попадают (нет данных — нет строки): тогда плитка за этот год обязана быть пустой.
          const emptyYear = !yr && kinds.every((kd) => d.raw[kd].incl.recvQty === 0 && d.raw[kd].incl.recvValue === 0) && d.prod.done.qty === 0 && d.prod.work.qty === 0;
          if (!yr && !emptyYear) { checks++; fails++; console.log(`  ✗ ${tag} нет строки года в таблице динамики`); }
          else if (!yr) checks++;
          else {
            for (const kd of kinds) cellsEq(`${tag} строка ${y} ${kd} = плитка за ${y}`, yr[kd], { incl: { rq: d.raw[kd].incl.recvQty, rv: d.raw[kd].incl.recvValue, uq: d.raw[kd].incl.usedQty, uv: c4 === "on" ? d.raw[kd].incl.usedValueOther : d.raw[kd].incl.usedValue, mq: d.raw[kd].incl.remQty, mv: d.raw[kd].incl.remValue }, excl: { rq: d.raw[kd].excl.recvQty, rv: d.raw[kd].excl.recvValue, uq: d.raw[kd].excl.usedQty, uv: c4 === "on" ? d.raw[kd].excl.usedValueOther : d.raw[kd].excl.usedValue, mq: d.raw[kd].excl.remQty, mv: d.raw[kd].excl.remValue } } as never);
            eq(`${tag} строка ${y}: «в выпуске» шт. = завершённые + в работе`, yr.prod.qty, d.prod.done.qty + d.prod.work.qty);
            eq(`${tag} строка ${y}: себестоимость = завершённые + в работе`, yr.prod.costIncl, d.prod.done.costIncl + d.prod.work.costIncl, 0.05);
            eq(`${tag} строка ${y}: себестоимость без НДС = завершённые + в работе`, yr.prod.costExcl, d.prod.done.costExcl + d.prod.work.costExcl, 0.05);
            eq(`${tag} строка ${y}: работа = завершённые + в работе`, yr.prod.work, d.prod.done.workSum + d.prod.work.workSum, 0.05);
          }
        }
        void row;
        // 7.5 Производство: себестоимость = мех + подкладка + 4% + расходы/невязка; НДС: без НДС ≤ с НДС; 4% только в режиме «с 4%»
        for (const g of ["done", "work"] as const) {
          const t = d.prod[g];
          checks++; if (t.costExcl > t.costIncl + 0.01) { fails++; console.log(`  ✗ ${tag} ${g}: без НДС больше, чем с НДС`); }
          if (c4 === "off") eq(`${tag} ${g}: в режиме «без 4%» надбавка = 0`, t.c4Incl, 0, 0.001);
          else { checks++; if (t.c4Incl < -0.001 || t.c4Incl > (t.furIncl + t.liningIncl) * 0.0401 + 0.01) { fails++; console.log(`  ✗ ${tag} ${g}: 4% вне 0…4% от сырья`); } }
        }
        // 7.6 Долг и оплаты НЕ зависят от фильтров Сводки и от режима 4% (только от года)
        const clean = await dd(y, E0, "off");
        eq(`${tag} долг не зависит от фильтров и 4%`, d.debt.debt.toNumber(), clean.debt.debt.toNumber(), 0.001);
        eq(`${tag} оплачено не зависит от фильтров и 4%`, d.supplierCashPaid, clean.supplierCashPaid, 0.001);
        eq(`${tag} долг = К оплате по УПД + счета + ожидаемое`, d.debt.debt.toNumber(), d.debt.receivedNet.add(d.debt.invoiced).add(d.debt.expected).toNumber(), 0.01);
        eq(`${tag} закупки = получено + не получено (черновики)`, d.debt.total.toNumber(), d.bridge.purchases.received + d.bridge.purchases.draft, 0.01);
        // долг = закупки − оплачено − авансы (если авансы не больше остатка)
        const dueSum = d.debt.total.sub(d.debt.paid);
        // Переплаты аукционов зачтены поставщиком в долге (d.overpaid) — вычитаем и их.
        const credited = d.overpaid.reduce((a, x) => a + x.amount, 0);
        if (d.debt.unlinkedAdvances.lte(dueSum)) eq(`${tag} долг = закупки − оплачено − авансы − зачтённые переплаты`, d.debt.debt.toNumber(), d.debt.total.sub(d.debt.paid).sub(d.debt.unlinkedAdvances).toNumber() - credited, 0.01);
      }
      // 7.7 Σ по годам = «Все годы» — для сырья/производства/оплат/долга в каждом режиме и при каждом наборе фильтров
      const a = await dd("all", f, c4);
      const rows = a.years.filter((r) => r.key !== "all"), tot = a.years.find((r) => r.key === "all")!;
      const tag = `[${fname}|4%:${c4}]`;
      for (const kd of kinds) for (const v of VATS) for (const k of ["rq", "rv", "uq", "uv", "mq", "mv"] as const) eq(`${tag} Σ годов = «Все» ${kd}/${v}/${k}`, rows.reduce((s, r) => s + r[kd][v][k], 0), a.raw[kd][v][({ rq: "recvQty", rv: "recvValue", uq: "usedQty", uv: (c4 === "on" ? "usedValueOther" : "usedValue") as "usedValue", mq: "remQty", mv: "remValue" } as const)[k]], 0.05);
      eq(`${tag} Σ годов: «в выпуске» = завершённые + в работе («все годы»)`, rows.reduce((s, r) => s + r.prod.qty, 0), a.prod.done.qty + a.prod.work.qty);
      eq(`${tag} Σ годов: себестоимость = завершённые + в работе`, rows.reduce((s, r) => s + r.prod.costIncl, 0), a.prod.done.costIncl + a.prod.work.costIncl, 0.05);
      // Без фильтров: оплачено по годам = деньги поставщику + шкуры подрядчика (оплачены в составе пошива) + зачтённые переплаты аукционов;
      // при фильтрах панели «Оплачено» и долг в таблице считаются по отобранным лотам (доля оплат аукциона), поэтому сравнивать с общим числом нельзя.
      // 0,05 ₽: дробные копейки долей лотов при распределении долга по годам (≈1,4 коп.) — не ошибка расчёта.
      if (!anyOn) {
        eq(`${tag} итог долга по годам = плитка «все годы»`, tot.debt, a.debt.debt.toNumber(), 0.05);
        eq(`${tag} итог оплат по годам = деньги поставщику (без услуг по УПД) + шкуры подрядчика + зачтённые переплаты`, tot.paid, a.supplierCashPaid - a.paidByItem.services + a.hides.incl + a.overpaid.reduce((x, o) => x + o.amount, 0), 0.05);
      } else if (!lotOn) eq(`${tag} долг по годам при фильтре по ТЗ = общему долгу`, tot.debt, a.debt.debt.toNumber(), 0.05);
      // та же величина на разных блоках: годы 2025+2026 по закупкам = закупки «все годы»
      const d25 = await dd("2025", f, c4), d26 = await dd("2026", f, c4);
      eq(`${tag} закупки: 2025 + 2026 = все годы`, d25.debt.total.toNumber() + d26.debt.total.toNumber(), a.debt.total.toNumber(), 0.01);
      eq(`${tag} оплачено: 2025 + 2026 = все годы`, d25.supplierCashPaid + d26.supplierCashPaid, a.supplierCashPaid, 0.01);
      if (!anyOn) {
        // 7.8 мост «Сырьё ↔ Производство»: использовано сырья (без 4%) = мех+подкладка в завершённых ТЗ + в ТЗ в работе
        for (const v of VATS) {
          const mat = (t: typeof a.prod.done) => (v === "incl" ? t.furIncl + t.liningIncl : t.furExcl + t.liningExcl);
          eq(`${tag} мост [${v}]: использовано в «Сырьё» = сырьё в завершённых + в работе`, a.bridge.usedBase[v], mat(a.prod.done) + mat(a.prod.work), 0.05);
          eq(`${tag} мост [${v}]: себестоимость = сырьё + 4% + расходы/прочее (расходы ≥ 0)`, 0, Math.min(0, (v === "incl" ? a.prod.done.costIncl - a.prod.done.c4Incl : a.prod.done.costExcl - a.prod.done.c4Excl) - mat(a.prod.done) - 0), 0.5);
        }
        // 4%: разница режимов «с 4%» − «без 4%» одинакова в «Сырьё» (использовано) и «Производстве» (завершённые + в работе)
        const on = await dd("all", f, "on"), off = await dd("all", f, "off");
        const rawExtra = [on.raw.fur.incl, on.raw.lining.incl].reduce((s, x, i) => s + x.usedValue - [off.raw.fur.incl, off.raw.lining.incl][i].usedValue, 0);
        eq(`${tag} 4% «Сырьё» = 4% «Производство» (завершённые + в работе)`, rawExtra, on.prod.done.c4Incl + on.prod.work.c4Incl, 0.05);
        eq(`${tag} себестоимость с 4% − без 4% = надбавка 4%`, on.prod.done.costIncl - off.prod.done.costIncl, on.prod.done.c4Incl, 0.05);
        // долг заказчиков: работа ТЗ с заказчиком + без заказчика = «работа» блока «Производство»
        eq(`${tag} работа: заказчики + без заказчика = «Производство» (завершённые + в работе)`, on.bridge.clientWork.done + on.bridge.clientWork.work + on.bridge.clientWork.noClient, on.prod.done.workSum + on.prod.work.workSum, 0.05);
        eq(`${tag} «Долг заказчиков»: работы = работа ТЗ с заказчиком`, on.clientDebts.reduce((s, c) => s + c.billable, 0), on.bridge.clientWork.done + on.bridge.clientWork.work, 0.05);
      }
    }
  }

  // ───────── 8. НЕЗАВИСИМЫЙ SQL по годам: куплено/остаток/использовано/4%, производство, оплаты ─────────
  {
    const k4 = 0.04;
    const lotsSql = await prisma.$queryRawUnsafe<{ lin: boolean; yr: number; q: number; v: number; vx: number; rq: number; rv: number }[]>(`
      select (m.unit='M') lin, extract(year from coalesce(p."orderDate", l."receivedDate"))::int yr,
             sum(l."quantityReceived")::float q, sum(l."quantityReceived"*l."unitCost")::float v,
             sum(l."quantityReceived"*case when coalesce(l."materialCostExclVat",0)+coalesce(l."expenseCostExclVat",0)=0 then l."unitCost"/(1+l."vatRate"/100) else l."materialCostExclVat"+l."expenseCostExclVat" end)::float vx,
             sum(l."quantityRemaining")::float rq, sum(l."quantityRemaining"*l."unitCost")::float rv
      from "RawMaterialLot" l join "RawMaterial" m on m.id=l."rawMaterialId" left join "Purchase" p on p.id=l."purchaseId"
      where l."organizationId"='${org}' group by 1,2`);
    const useSql = await prisma.$queryRawUnsafe<{ lin: boolean; yr: number; q: number; v: number; e4: number }[]>(`
      select (m.unit='M') lin, extract(year from coalesce(p."orderDate", l."receivedDate"))::int yr,
             sum(u.quantity)::float q, sum(u."totalCost")::float v, sum(case when u."commission4" then u."totalCost"*${k4} else 0 end)::float e4
      from "ProductionMaterialUsage" u join "ProductionOrder" o on o.id=u."productionOrderId" and o.status<>'CANCELLED'
        join "RawMaterialLot" l on l.id=u."lotId" join "RawMaterial" m on m.id=l."rawMaterialId" left join "Purchase" p on p.id=l."purchaseId"
      where o."organizationId"='${org}' group by 1,2`);
    for (const c4 of C4S) for (const y of YS) {
      const d = await dd(y, E0, c4);
      for (const kd of kinds) {
        const lin = kd === "lining";
        const L = lotsSql.filter((r) => r.lin === lin && (y === "all" || String(r.yr) === y));
        const U = useSql.filter((r) => r.lin === lin && (y === "all" || String(r.yr) === y));
        const sum = (a: object[], key: string) => a.reduce((s, r) => s + (r as Record<string, number>)[key], 0);
        const tag = `[SQL|${y}|4%:${c4}|${kd}]`;
        // К лотам меха на Главной добавлены: заказанное, но не полученное (в «Куплено» и «Остаток»), и шкуры подрядчика (в «Куплено» и «Использовано»; лотов нет).
        const ordQ = kd === "fur" ? d.ordered.qty : 0, ordI = kd === "fur" ? d.ordered.incl : 0, ordX = kd === "fur" ? d.ordered.excl : 0;
        const hdI = kd === "fur" ? d.hides.incl : 0, hdX = kd === "fur" ? d.hides.excl : 0;
        eq(`${tag} куплено шт.`, d.raw[kd].incl.recvQty, sum(L, "q") + ordQ, 0.002); eq(`${tag} куплено ₽ с НДС`, d.raw[kd].incl.recvValue, sum(L, "v") + ordI + hdI, 0.5);
        eq(`${tag} куплено ₽ без НДС`, d.raw[kd].excl.recvValue, sum(L, "vx") + ordX + hdX, 1);
        eq(`${tag} остаток шт.`, d.raw[kd].incl.remQty, sum(L, "rq") + ordQ, 0.002); eq(`${tag} остаток ₽`, d.raw[kd].incl.remValue, sum(L, "rv") + ordI, 0.5);
        eq(`${tag} использовано шт.`, d.raw[kd].incl.usedQty, sum(U, "q"), 0.002);
        eq(`${tag} использовано ₽ (${c4})`, d.raw[kd].incl.usedValue, sum(U, "v") + hdI + (c4 === "on" ? sum(U, "e4") : 0), 0.5);
      }
    }
    // производство по году ТЗ: workOrderDate → endDate → startDate → год партии
    const prodSql = await prisma.$queryRawUnsafe<{ st: string; yr: number | null; n: number; q: number; plq: number; cost: number; work: number }[]>(`
      select o.status st, coalesce(extract(year from coalesce(o."workOrderDate", o."endDate", o."startDate")), b.year)::int yr, count(*)::int n,
             sum(o."producedQuantity")::float q, sum(o."plannedQuantity")::float plq,
             sum(coalesce(o."totalCost", (select coalesce(sum(u."totalCost"),0) from "ProductionMaterialUsage" u where u."productionOrderId"=o.id) + (select coalesce(sum(e.amount),0) from "ProductionExpense" e where e."productionOrderId"=o.id)))::float cost,
             sum(coalesce(o."clientWorkPricePerUnit",0)*case when o.status='COMPLETED' then o."producedQuantity" else o."plannedQuantity" end)::float work
      from "ProductionOrder" o left join "ProductionBatch" b on b.id=o."batchId"
      where o."organizationId"='${org}' and o.status<>'CANCELLED' group by 1,2`);
    for (const y of YS) {
      const d = await dd(y, E0, "off");
      const sel = (done: boolean) => prodSql.filter((r) => (r.st === "COMPLETED") === done && (y === "all" || String(r.yr) === y));
      const sm = (a: typeof prodSql, k: "n" | "q" | "plq" | "cost" | "work") => a.reduce((s, r) => s + r[k], 0);
      eq(`[SQL|${y}] ТЗ завершённых (записей)`, d.prod.done.items + d.prod.done.repairItems, sm(sel(true), "n"), 0); eq(`[SQL|${y}] произведено шт.`, d.prod.done.qty + d.prod.done.repairQty, sm(sel(true), "q"));
      eq(`[SQL|${y}] себестоимость завершённых (без 4%)`, d.prod.done.costIncl, sm(sel(true), "cost"), 0.5);
      eq(`[SQL|${y}] работа завершённых`, d.prod.done.workSum, sm(sel(true), "work"), 0.5);
      eq(`[SQL|${y}] ТЗ в работе (записей)`, d.prod.work.items + d.prod.work.repairItems, sm(sel(false), "n"), 0); eq(`[SQL|${y}] в работе шт. (план)`, d.prod.work.qty + d.prod.work.repairQty, sm(sel(false), "plq"));
      eq(`[SQL|${y}] работа в работе`, d.prod.work.workSum, sm(sel(false), "work"), 0.5);
    }
    // ТЗ без года в «Все годы»: строка «Без даты» есть, только если у завершённых ТЗ нет года
    const noYear = prodSql.filter((r) => r.yr == null && r.st === "COMPLETED");
    const allD = await dd("all", E0, "off");
    eq("годы: строка «Без даты» ⇔ есть завершённые ТЗ без года", allD.years.some((r) => r.key === "none") ? 1 : 0, noYear.some((r) => r.q !== 0 || r.cost !== 0) ? 1 : 0, 0);
    // оплаты: SQL — все COMPLETED оплаты поставщику (закупки + аукционы + авансы) = «Оплачено поставщику»
    const [pay] = await prisma.$queryRawUnsafe<{ s: number }[]>(`select coalesce(sum(amount),0)::float s from "Payment" where "organizationId"='${org}' and status='COMPLETED'`);
    console.log(`  (оплаты поставщику в БД, все COMPLETED: ${pay.s.toFixed(2)}; на Сводке: ${allD.supplierCashPaid.toFixed(2)} — разница = переплата аукционов/закупок сверх их стоимости)`);
    checks++; if (allD.supplierCashPaid > pay.s + 0.01) { fails++; console.log("  ✗ оплачено на Сводке больше, чем есть оплат в БД"); }
    // долг заказчиков: SQL — работа ТЗ с заказчиком, оплаты заказчика
    const [cl] = await prisma.$queryRawUnsafe<{ b: number; p: number }[]>(`
      select (select coalesce(sum(o."clientWorkPricePerUnit"*case when o.status='COMPLETED' then o."producedQuantity" when o.status in ('PLANNED','IN_PROGRESS') then o."plannedQuantity" else 0 end),0)::float from "ProductionOrder" o where o."organizationId"='${org}' and o."clientId" is not null) b,
             (select coalesce(sum(amount),0)::float from "ProductionPayment" where "organizationId"='${org}' and status='COMPLETED' and "clientId" is not null) p`);
    eq("долг заказчиков (все годы, без фильтров): работы = SQL", allD.clientDebts.reduce((s, c) => s + c.billable, 0), cl.b, 0.5);
    // Шкуры подрядчика, пришедшие в платежах заказчика сверх работы ТЗ, — сырьё: из «Оплачено за работу» исключены (clientDebtInfo / loadClientDebt.hides).
    eq("долг заказчиков (все годы, без фильтров): оплачено + шкуры подрядчика = SQL", allD.clientDebts.reduce((s, c) => s + c.paid, 0) + allD.hides.incl, cl.p, 0.5);
    // по годам: работы складываются в «все годы» (ТЗ без года — только в «все годы»)
    const c25 = await dd("2025", E0, "off"), c26 = await dd("2026", E0, "off");
    const bil = (x: Dash) => x.clientDebts.reduce((s, c) => s + c.billable, 0);
    console.log(`  (работы заказчиков: 2025 ${bil(c25).toFixed(2)} + 2026 ${bil(c26).toFixed(2)} + ТЗ без даты ${(bil(allD) - bil(c25) - bil(c26)).toFixed(2)} = все годы ${bil(allD).toFixed(2)})`);
    checks++; if (bil(c25) + bil(c26) > bil(allD) + 0.01) { fails++; console.log("  ✗ работы заказчиков по годам больше, чем за все годы"); }
  }

  console.log(`${checks} проверок, расхождений: ${fails}`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})();
