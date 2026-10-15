// Переключатель «Вся закупка / На аукционах / У поставщика» в разделе «Сырьё» (/lots, /purchases, /lots/fur, /lots/lining, шкуры подрядчика):
// «На аукционах» + «У поставщика» = «Вся закупка» по плиткам, годам, видам меха, аукционам и счётчикам лотов; цифры /lots = Главная;
// источник закупки (Purchase.auction/isContractorRaw) совпадает с источником её лотов; подкладка и шкуры подрядчика — у поставщика.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-source-scope.ts
// Только чтение. Код возврата 1 — при расхождениях.
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { loadDashboard } from "../src/lib/dashboard-data";
import { parseDashFilters } from "../src/lib/dashboard-calc";
import { loadFurLots } from "../src/lib/fur-table-server";
import { getFurIndex } from "../src/lib/fur-ref-server";
import { figures, flowOf, type FlowFigures, type FurLot } from "../src/lib/fur-table";
import { alignRaw } from "../src/lib/raw-display";
import { alignFurBySource, lotInSrc } from "../src/lib/fur-src-data";
import { classifyPurchaseSource } from "../src/lib/purchase-source";
import { lotCounts } from "../src/lib/cost-labels";
import { FUR_SRC_KEYS, type FurSrc } from "../src/lib/fur-src";

const prisma = new PrismaClient();
let fails = 0, checks = 0;
const eq = (what: string, got: number, want: number, tol = 0) => {
  checks++;
  if (Math.abs(got - want) > tol) { fails++; console.log(`  ✗ ${what}: ${got} ≠ ${want} (Δ ${got - want})`); }
};
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const SRC2 = ["auction", "supplier"] as const;

/** Показатели потока в точных числах: куплено / использовано / остаток (шт. и ₽ с НДС и без). */
function exact(ls: FurLot[]) {
  const fl = flowOf(ls);
  const i = figures(fl, { vat: "incl", c4: "off" }), e = figures(fl, { vat: "excl", c4: "off" });
  return { rq: i.recvQty, rvI: i.recvValue, rvE: e.recvValue, uq: i.usedQty, uvI: i.usedValue, uvE: e.usedValue, mq: i.remQty, mvI: i.remValue, mvE: e.remValue, n: ls.length };
}
function partition(tag: string, all: FurLot[], by: (l: FurLot) => boolean = () => true) {
  const ls = all.filter(by);
  const a = exact(ls), x = exact(ls.filter((l) => lotInSrc("auction", l))), s = exact(ls.filter((l) => lotInSrc("supplier", l)));
  for (const k of Object.keys(a) as (keyof typeof a)[]) eq(`${tag}: ${k}: на аукционах + у поставщика = вся закупка`, x[k] + s[k], a[k], k === "n" || k === "rq" || k === "uq" || k === "mq" ? 0 : 0.01);
}

(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const furIdx = await getFurIndex(org);

  for (const year of ["all", "2025", "2026"] as const) {
    for (const c4 of ["on", "off"] as const) {
      const tag = `[${year}/4%:${c4}]`;
      const d = await loadDashboard(org, year, parseDashFilters({}), c4);
      const tableLots = await loadFurLots(prisma, org, { kind: "fur", year, furIdx });
      const withMoney = (l: FurLot) => ({ ...l, paid: d.lotMoney[l.id]?.paid ?? 0, due: d.lotMoney[l.id]?.due ?? 0 });
      // Те же лоты, что у таблицы «Мех» на /lots: лоты + «заказано, не получено» + шкуры подрядчика.
      const lots = [...tableLots.map(withMoney), ...d.syntheticLots];

      // 1. Точные суммы: «аукцион + поставщик = все» — всего, по годам закупки, по видам меха, по аукционам.
      if (c4 === "off") {
        partition(`${tag} всего`, lots);
        for (const y of [...new Set(lots.map((l) => l.year))]) partition(`${tag} год ${y}`, lots, (l) => l.year === y);
        for (const k of [...new Set(lots.map((l) => l.item))]) partition(`${tag} вид «${k}»`, lots, (l) => l.item === k);
        // Аукцион (партия закупки) — целиком один источник: «разрезать» его между режимами нельзя.
        const srcsByAuction = new Map<string, Set<FurSrc>>();
        for (const l of lots) { const set = srcsByAuction.get(l.auction) ?? new Set(); set.add(l.source === "auction" ? "auction" : "supplier"); srcsByAuction.set(l.auction, set); }
        const mixed = [...srcsByAuction].filter(([, set]) => set.size > 1).map(([n]) => n);
        eq(`${tag} партий закупки с лотами двух источников`, mixed.length, 0);
        if (mixed.length) console.log(`  (смешанные партии: ${mixed.join(", ")})`);
        // Счётчики лотов (lotCounts): лоты, позиции заказанного, шкуры подрядчика.
        const rowsOf = (s: FurSrc) => lots.filter((l) => lotInSrc(s, l)).map((l) => ({ id: l.id }));
        const cnt = (s: FurSrc) => lotCounts(rowsOf(s) as unknown as Parameters<typeof lotCounts>[0]);
        for (const k of ["lots", "positions", "hidesRows"] as const) eq(`${tag} lotCounts.${k}: на аукционах + у поставщика = все`, cnt("auction")[k] + cnt("supplier")[k], cnt("all")[k]);
        // Шкуры подрядчика — сырьё поставщика: на аукционах их нет.
        eq(`${tag} шкур подрядчика среди лотов «На аукционах»`, lots.filter((l) => l.id.startsWith("hides") && lotInSrc("auction", l)).length, 0);
        // Подкладка — закупка у поставщика, не на аукционе.
        const lin = await loadFurLots(prisma, org, { kind: "lining", year, furIdx });
        eq(`${tag} лотов подкладки с источником «аукцион»`, lin.filter((l) => l.source === "auction").length, 0);
      }

      // 2. На экране (плитки /lots): мех по источникам и видам в целых рублях, как на Главной.
      const typesBySrc: Partial<Record<FurSrc, string[]>> = {};
      for (const s of FUR_SRC_KEYS) typesBySrc[s] = [...new Set(lots.filter((l) => lotInSrc(s, l)).map((l) => l.item))].sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
      const A = alignFurBySource(lots, typesBySrc, c4, { fur: d.raw.fur, lining: d.raw.lining });
      const H = alignRaw(d.raw.fur, d.raw.lining, d.rawFurBySource, c4); // Главная
      const base = (f: FlowFigures) => (c4 === "on" ? f.usedValueOther : f.usedValue);
      const other = (f: FlowFigures) => (c4 === "on" ? f.usedValue : f.usedValueOther);
      for (const v of ["incl", "excl"] as const) {
        const t = `${tag}[${v}]`;
        const al = A.furSrc.all.total[v], au = A.furSrc.auction.total[v], su = A.furSrc.supplier.total[v];
        for (const [n, g] of [["куплено", (f: FlowFigures) => f.recvValue], ["использовано", base], ["«с 4%»", other], ["остаток", (f: FlowFigures) => f.remValue], ["куплено, шт.", (f: FlowFigures) => f.recvQty], ["использовано, шт.", (f: FlowFigures) => f.usedQty], ["остаток, шт.", (f: FlowFigures) => f.remQty]] as const) {
          eq(`${t} ${n}: на аукционах + у поставщика = вся закупка`, g(au) + g(su), g(al));
          for (const s of FUR_SRC_KEYS) {
            const types = A.furSrc[s].types.map((x) => x.pair[v]);
            eq(`${t} [${s}] ${n}: сумма видов = «Все типы»`, sum(types.map(g)), g(A.furSrc[s].total[v]));
          }
        }
        eq(`${t} «Вся закупка»: куплено = использовано + остаток`, al.recvValue, base(al) + al.remValue);
        for (const s of SRC2) eq(`${t} [${s}]: куплено = использовано + остаток`, A.furSrc[s].total[v].recvValue, base(A.furSrc[s].total[v]) + A.furSrc[s].total[v].remValue);
        // Те же числа, что на Главной (блок «Сырьё», слайды источников), и точные суммы лотов совпадают с плитками Главной.
        for (const s of FUR_SRC_KEYS) {
          eq(`${t} [${s}] /lots = Главная: куплено`, A.furSrc[s].total[v].recvValue, H.furSrc[s].total[v].recvValue);
          eq(`${t} [${s}] /lots = Главная: использовано`, base(A.furSrc[s].total[v]), base(H.furSrc[s].total[v]));
          eq(`${t} [${s}] /lots = Главная: остаток`, A.furSrc[s].total[v].remValue, H.furSrc[s].total[v].remValue);
          for (const ty of H.furSrc[s].types) {
            const mine = A.furSrc[s].types.find((x) => x.name === ty.name);
            eq(`${t} [${s}] вид «${ty.name}» есть на /lots`, mine ? 1 : 0, 1);
            if (mine) { eq(`${t} [${s}] «${ty.name}» /lots = Главная: куплено`, mine.pair[v].recvValue, ty.pair[v].recvValue); eq(`${t} [${s}] «${ty.name}» /lots = Главная: остаток`, mine.pair[v].remValue, ty.pair[v].remValue); }
          }
        }
        eq(`${t} лоты /lots = плитка Главной: куплено (до рубля)`, exact(lots)[v === "incl" ? "rvI" : "rvE"], d.raw.fur[v].recvValue, 1);
      }
    }
  }

  // 3. Закупки (/purchases): источник закупки совпадает с источником её лотов; подкладка и шкуры подрядчика — у поставщика.
  {
    const purchases = await prisma.purchase.findMany({ where: { organizationId: org }, include: { auction: true, items: { include: { rawMaterial: true } } } });
    const srcOf = new Map(purchases.map((p) => [p.id, p.isContractorRaw ? "supplier" : classifyPurchaseSource(p.auction)] as const));
    const lots = [...(await loadFurLots(prisma, org, { kind: "fur", year: "all", furIdx })), ...(await loadFurLots(prisma, org, { kind: "lining", year: "all", furIdx }))];
    let bad = 0;
    for (const l of lots) if (l.purchaseId && srcOf.has(l.purchaseId) && (l.source === "auction" ? "auction" : "supplier") !== srcOf.get(l.purchaseId)) bad++;
    eq("[закупки] лотов, у которых источник ≠ источнику закупки", bad, 0);
    const lining = purchases.filter((p) => p.items.length > 0 && p.items.every((i) => i.rawMaterial.unit === "M"));
    eq("[закупки] закупок подкладки с источником «аукцион»", lining.filter((p) => srcOf.get(p.id) === "auction").length, 0);
    eq("[закупки] закупок шкур подрядчика с источником «аукцион»", purchases.filter((p) => p.isContractorRaw && srcOf.get(p.id) === "auction").length, 0);
    const nA = purchases.filter((p) => srcOf.get(p.id) === "auction").length, nS = purchases.filter((p) => srcOf.get(p.id) === "supplier").length;
    eq("[закупки] на аукционах + у поставщика = все закупки", nA + nS, purchases.length);
    console.log(`  (закупок ${purchases.length}: на аукционах ${nA}, у поставщика ${nS})`);
  }

  console.log(`\nИсточник закупки в разделе «Сырьё»: проверок ${checks}, расхождений ${fails}`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})();
