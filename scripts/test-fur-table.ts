// Проверка расчёта таблицы «Мех / Подкладка» (src/lib/fur-table.ts) на данных БД: сверка с SQL по каждому виду
// меха и каждому году, во всех режимах НДС × 4%, плюс эталоны владельца и свойства (Σ строк = итог, выбор, фильтры, URL).
//   node --env-file=.env node_modules/.bin/tsx scripts/test-fur-table.ts
// Только чтение. Код возврата 1 — если есть расхождения.
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { canonicalFur, buildFurIndex } from "../src/lib/fur-ref";
import {
  buildFurTable, emptyFilters, figures, filterLots, filterOptions, flowIssues, flowOf, parseFilters, filtersToEntries, round2,
  type FlowMode, type FurFilters, type FurKind, type FurLot,
} from "../src/lib/fur-table";
import { loadFurLots } from "../src/lib/fur-table-server";
import { safeRatio } from "../src/lib/weighted";
import type { YearFilter } from "../src/lib/year-filter";

const prisma = new PrismaClient();
let fails = 0;
let checks = 0;
const eq = (what: string, got: number | null, want: number | null, tol = 0.011) => {
  checks++;
  const ok = got == null || want == null ? got === want : Math.abs(got - want) <= tol;
  if (!ok) {
    fails++;
    console.log(`  ✗ ${what}: получено ${got}, SQL ${want}`);
  }
};
const ok = (what: string, cond: boolean, detail = "") => {
  checks++;
  if (!cond) {
    fails++;
    console.log(`  ✗ ${what} ${detail}`);
  }
};

type SqlRow = { name: string; year: number; recv: number; used: number; rem: number; recv_incl: number; recv_excl: number; used_incl: number; used_excl: number; extra_incl: number; extra_excl: number; rem_incl: number; rem_excl: number };

/** Эталон: те же суммы одним SQL по лотам (материал × год закупки), без единой строки JS-логики таблицы. */
async function sqlRows(org: string, kind: FurKind): Promise<SqlRow[]> {
  const unitCond = kind === "lining" ? `m.unit = 'M'` : `m.unit <> 'M'`;
  return prisma.$queryRawUnsafe<SqlRow[]>(`
    with lot as (
      select l.id, m.name, extract(year from p."orderDate")::int as year,
             l."quantityReceived" as recv, l."quantityRemaining" as rem, l."unitCost" as unit_incl,
             case when l."materialCostExclVat" + l."expenseCostExclVat" = 0 and l."unitCost" > 0
                  then l."unitCost" / (1 + l."vatRate" / 100)
                  else l."materialCostExclVat" + l."expenseCostExclVat" end as unit_excl
      from "RawMaterialLot" l
      join "RawMaterial" m on m.id = l."rawMaterialId"
      join "Purchase" p on p.id = l."purchaseId"
      where l."organizationId" = '${org}' and ${unitCond}
    ), use as (
      select u."lotId", sum(u.quantity) q, sum(u."totalCost") incl,
             sum(case when u.commission4 then u."totalCost" * 0.04 else 0 end) extra_incl
      from "ProductionMaterialUsage" u join "ProductionOrder" o on o.id = u."productionOrderId"
      where o.status <> 'CANCELLED' group by u."lotId"
    ), ue as (
      select u."lotId",
             sum(u.quantity * (case when l."materialCostExclVat" + l."expenseCostExclVat" = 0 and l."unitCost" > 0 then l."unitCost" / (1 + l."vatRate" / 100) else l."materialCostExclVat" + l."expenseCostExclVat" end)) excl,
             sum(case when u.commission4 then u.quantity * (case when l."materialCostExclVat" + l."expenseCostExclVat" = 0 and l."unitCost" > 0 then l."unitCost" / (1 + l."vatRate" / 100) else l."materialCostExclVat" + l."expenseCostExclVat" end) * 0.04 else 0 end) extra_excl
      from "ProductionMaterialUsage" u join "RawMaterialLot" l on l.id = u."lotId" join "ProductionOrder" o on o.id = u."productionOrderId"
      where o.status <> 'CANCELLED' group by u."lotId"
    )
    select lot.name, lot.year,
           sum(lot.recv)::float8 recv, coalesce(sum(use.q), 0)::float8 used, sum(lot.rem)::float8 rem,
           sum(lot.recv * lot.unit_incl)::float8 recv_incl, sum(lot.recv * lot.unit_excl)::float8 recv_excl,
           coalesce(sum(use.incl), 0)::float8 used_incl, coalesce(sum(ue.excl), 0)::float8 used_excl,
           coalesce(sum(use.extra_incl), 0)::float8 extra_incl, coalesce(sum(ue.extra_excl), 0)::float8 extra_excl,
           sum(lot.rem * lot.unit_incl)::float8 rem_incl, sum(lot.rem * lot.unit_excl)::float8 rem_excl
    from lot left join use on use."lotId" = lot.id left join ue on ue."lotId" = lot.id
    group by lot.name, lot.year`);
}

const MODES: FlowMode[] = [
  { vat: "incl", c4: "off" }, { vat: "incl", c4: "on" }, { vat: "excl", c4: "off" }, { vat: "excl", c4: "on" },
];
const modeName = (m: FlowMode) => `${m.vat === "incl" ? "с НДС" : "без НДС"}/${m.c4 === "on" ? "с 4%" : "без 4%"}`;

function sqlFigures(rows: SqlRow[], m: FlowMode) {
  const s = (f: (r: SqlRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const excl = m.vat === "excl";
  const recvValue = s((r) => (excl ? r.recv_excl : r.recv_incl));
  const usedBase = s((r) => (excl ? r.used_excl : r.used_incl));
  const extra = s((r) => (excl ? r.extra_excl : r.extra_incl));
  const usedValue = m.c4 === "on" ? usedBase + extra : usedBase;
  const remValue = s((r) => (excl ? r.rem_excl : r.rem_incl));
  const recv = s((r) => r.recv), used = s((r) => r.used), rem = s((r) => r.rem);
  return { recv, used, rem, recvValue, usedValue, remValue, recvAvg: safeRatio(recvValue, recv), usedAvg: safeRatio(usedValue, used), remAvg: safeRatio(remValue, rem) };
}

async function main() {
  const org = (await prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }))!.id;
  const furRefs = await prisma.furRef.findMany({ where: { organizationId: org }, select: { id: true, name: true, nameEn: true, aliases: true, note: true } });
  const furIdx = furRefs.length ? buildFurIndex(furRefs) : undefined;
  const canon = (name: string, kind: FurKind) => (kind === "lining" ? name : canonicalFur(name, furIdx)?.name ?? name);

  const years: YearFilter[] = ["all", "2025", "2026"];
  const data: Record<string, FurLot[]> = {};
  for (const kind of ["fur", "lining"] as FurKind[]) {
    const sql = await sqlRows(org, kind);
    for (const y of years) {
      const lots = await loadFurLots(prisma, org, { kind, year: y, furIdx });
      data[`${kind}:${y}`] = lots;
      const sqlY = y === "all" ? sql : sql.filter((r) => String(r.year) === y);
      console.log(`== ${kind === "fur" ? "Мех" : "Подкладка"}, год ${y}: лотов ${lots.length}`);
      for (const mode of MODES) {
        const tag = `${kind}/${y}/${modeName(mode)}`;
        const t = buildFurTable({ lots, filters: emptyFilters(), selected: [], mode });
        // итог против SQL
        const want = sqlFigures(sqlY, mode);
        const f = t.totalFigures;
        eq(`${tag} куплено шт`, f.recvQty, want.recv, 0.0011);
        eq(`${tag} использовано шт`, f.usedQty, want.used, 0.0011);
        eq(`${tag} остаток шт`, f.remQty, want.rem, 0.0011);
        eq(`${tag} куплено ₽`, f.recvValue, want.recvValue);
        eq(`${tag} использовано ₽`, f.usedValue, want.usedValue);
        eq(`${tag} остаток ₽`, f.remValue, want.remValue);
        eq(`${tag} ср.цена куплено`, f.recvAvg, want.recvAvg, 0.0051);
        eq(`${tag} ср.цена использовано`, f.usedAvg, want.usedAvg, 0.0051);
        eq(`${tag} ср.цена остаток`, f.remAvg, want.remAvg, 0.0051);
        // по каждому виду (материалы SQL → канонический вид)
        const byItem = new Map<string, SqlRow[]>();
        for (const r of sqlY) byItem.set(canon(r.name, kind), [...(byItem.get(canon(r.name, kind)) ?? []), r]);
        ok(`${tag} набор видов`, t.allRows.length === byItem.size, `JS ${t.allRows.map((r) => r.key)} / SQL ${[...byItem.keys()]}`);
        for (const row of t.allRows) {
          const w = sqlFigures(byItem.get(row.key) ?? [], mode);
          const g = row.figures;
          eq(`${tag} [${row.key}] куплено шт`, g.recvQty, w.recv, 0.0011);
          eq(`${tag} [${row.key}] использовано шт`, g.usedQty, w.used, 0.0011);
          eq(`${tag} [${row.key}] остаток шт`, g.remQty, w.rem, 0.0011);
          eq(`${tag} [${row.key}] куплено ₽`, g.recvValue, w.recvValue);
          eq(`${tag} [${row.key}] использовано ₽`, g.usedValue, w.usedValue);
          eq(`${tag} [${row.key}] остаток ₽`, g.remValue, w.remValue);
          eq(`${tag} [${row.key}] ср.цена куплено`, g.recvAvg, w.recvAvg, 0.0051);
          eq(`${tag} [${row.key}] ср.цена остаток`, g.remAvg, w.remAvg, 0.0051);
        }
        // Σ строк = итог
        const sumRows = t.allRows.reduce((a, r) => a + r.figures.remValue, 0);
        ok(`${tag} Σ строк остаток ₽ = итог`, Math.abs(sumRows - f.remValue) < 0.05, `${sumRows} vs ${f.remValue}`);
      }
      // остаток = куплено − использовано (без 4%), шт и ₽ — внутренняя сверка по лотам и по строкам
      const issues = flowIssues(flowOf(lots));
      ok(`${kind}/${y} куплено − использовано = остаток`, issues.length === 0, issues.join("; "));
      for (const row of buildFurTable({ lots, filters: emptyFilters(), selected: [], mode: MODES[0] }).allRows) {
        const i = flowIssues(row.flow);
        ok(`${kind}/${y} [${row.key}] куплено − использовано = остаток`, i.length === 0, i.join("; "));
      }
    }
    // год: 2025 + 2026 = все
    const a = flowOf(data[`${kind}:2025`]), b = flowOf(data[`${kind}:2026`]), all = flowOf(data[`${kind}:all`]);
    eq(`${kind} 2025+2026 остаток ₽ = все`, round2(a.remIncl + b.remIncl), round2(all.remIncl));
    eq(`${kind} 2025+2026 остаток шт = все`, a.rem + b.rem, all.rem, 0.0011);
    eq(`${kind} 2025+2026 использовано ₽ = все`, round2(a.usedIncl + b.usedIncl), round2(all.usedIncl));
    // локальный фильтр «Год» внутри «Все годы» = загрузка за год
    const lotsAll = data[`${kind}:all`];
    for (const y of ["2025", "2026"]) {
      const viaFilter = flowOf(filterLots(lotsAll, { ...emptyFilters(), year: [y] }));
      const loaded = flowOf(data[`${kind}:${y}`]);
      eq(`${kind} фильтр year=${y} = загрузка за год (остаток ₽)`, round2(viaFilter.remIncl), round2(loaded.remIncl));
      eq(`${kind} фильтр year=${y} = загрузка за год (куплено ₽)`, round2(viaFilter.recvIncl), round2(loaded.recvIncl));
    }
  }

  // ───── эталоны владельца ─────
  console.log("== Эталоны владельца");
  const fm: FlowMode = { vat: "incl", c4: "off" };
  const furAll = figures(flowOf(data["fur:all"]), fm);
  const fur25 = figures(flowOf(data["fur:2025"]), fm);
  const fur26 = figures(flowOf(data["fur:2026"]), fm);
  const lin = figures(flowOf(data["lining:all"]), fm);
  eq("мех: остаток шт (все годы)", furAll.remQty, 9909, 0.0011);
  eq("мех: остаток ₽ (все годы)", furAll.remValue, 226_704_828.65);
  eq("мех: остаток ₽ 2025", fur25.remValue, 74_182_766.31);
  eq("мех: остаток ₽ 2026", fur26.remValue, 152_522_062.34);
  eq("подкладка: остаток м", lin.remQty, 259.5, 0.0011);
  eq("подкладка: остаток ₽", lin.remValue, 555_330);
  const lisa = buildFurTable({ lots: data["fur:all"], filters: emptyFilters(), selected: [], mode: fm }).allRows.map((r) => r.key);
  ok("«Лиса красная» слита в «Лиса»", lisa.includes("Лиса") && !lisa.includes("Лиса красная"), lisa.join(","));
  const lisaLots = data["fur:all"].filter((l) => l.item === "Лиса");
  ok("у лотов «Лиса красная» цвет «Красный»", lisaLots.filter((l) => l.materialName === "Лиса красная").every((l) => l.color === "Красный"));

  // ───── свойства: выбор, «только выбранные», фильтры, URL ─────
  console.log("== Свойства");
  const lots = data["fur:all"];
  const mode: FlowMode = { vat: "incl", c4: "on" };
  const full = buildFurTable({ lots, filters: emptyFilters(), selected: [], mode });
  ok("без выбора тотал «по всем»", full.totalOf === "all");
  const keys = full.allRows.map((r) => r.key);
  const pick = keys.slice(0, 2);
  const sel = buildFurTable({ lots, filters: emptyFilters(), selected: pick, mode });
  const manual = flowOf(lots.filter((l) => pick.includes(l.item)));
  eq("Σ выбранных: остаток шт = тотал", sel.totalFigures.remQty, figures(manual, mode).remQty, 0.0011);
  eq("Σ выбранных: остаток ₽ = тотал", sel.totalFigures.remValue, figures(manual, mode).remValue);
  eq("Σ выбранных: использовано ₽ = тотал (с 4%)", sel.totalFigures.usedValue, figures(manual, mode).usedValue);
  eq("Σ выбранных: ср.цена купл. = Σ₽/Σшт", sel.totalFigures.recvAvg, safeRatio(figures(manual, mode).recvValue, figures(manual, mode).recvQty), 0.0051);
  ok("тотал «по выбранным»", sel.totalOf === "selected" && sel.selectedKeys.length === pick.length);
  const only = buildFurTable({ lots, filters: emptyFilters(), selected: pick, onlySelected: true, mode });
  ok("«Только выбранные» показывает только их", only.rows.length === pick.length && only.rows.every((r) => pick.includes(r.key)));
  eq("«Только выбранные» тотал не меняется", only.totalFigures.remValue, sel.totalFigures.remValue);
  // фильтр скрывает выбранное — оно выпадает из тотала
  const flt: FurFilters = { ...emptyFilters(), item: [pick[0]] };
  const hidden = buildFurTable({ lots, filters: flt, selected: pick, mode });
  ok("выбранное, скрытое фильтром, не входит в тотал", hidden.selectedKeys.length === 1 && hidden.selectedKeys[0] === pick[0]);
  // каскад опций
  const yearOpts = filterOptions(lots, emptyFilters(), "year").map((o) => o.value);
  ok("опции года 2026, 2025", yearOpts.join() === "2026,2025", yearOpts.join());
  const colorOpts = filterOptions(lots, { ...emptyFilters(), item: ["Лиса"] }, "color").map((o) => o.value);
  ok("цвета под «Лиса» включают «Красный»", colorOpts.includes("Красный"), colorOpts.join());
  // URL
  const f2: FurFilters = { ...emptyFilters(), item: ["Соболь", "Лиса"], year: ["2025"], rest: ["with"] };
  const sp = new URLSearchParams(filtersToEntries(f2, "fur"));
  ok("URL: fur=a&fur=b", sp.toString() === "fur=%D0%A1%D0%BE%D0%B1%D0%BE%D0%BB%D1%8C&fur=%D0%9B%D0%B8%D1%81%D0%B0&pyear=2025&rest=with", sp.toString());
  const back = parseFilters({ fur: sp.getAll("fur"), year: sp.getAll("pyear"), rest: sp.getAll("rest") }, "fur");
  assert.deepEqual(back, f2);
  checks++;
  const alias = parseFilters({ species: "Норка", years: ["2026"] }, "fur");
  ok("URL: псевдонимы species/years", alias.item[0] === "Норка" && alias.year[0] === "2026");

  console.log(`\nПроверок: ${checks}, расхождений: ${fails}`);
  if (fails > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
