/**
 * Анализ сектора «Прочее» виджета Главной «Из чего складывается стоимость меха» (read-only, ничего не пишет в базу).
 * «Прочее» = «Прочие расходы» (остаток до цены лота и нераспознанное в расчётном листе) + «Без разбивки» (лоты без расчёта, шкуры подрядчика).
 * Пишет docs-inventory/prochee-audit-data.json и печатает сводные таблицы.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/analyze-prochee.ts
 */
import "./stubs/server-only-shim";
import { writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { loadDashboard } from "../src/lib/dashboard-data";
import { priceComposition } from "../src/lib/price-composition-server";
import { COMP_CATS, itemsOfBreakdown, lotComposition } from "../src/lib/price-composition";

const prisma = new PrismaClient();
const E0 = { auction: [] as string[], fur: [] as string[], color: [] as string[], batch: [] as string[], status: [] as string[], vat: [] as string[], attr: [] as string[], catgroup: [] as string[] };
const f = (v: number) => v.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
const r2 = (x: number) => Math.round(x * 100) / 100;

(async () => {
  const org = (await prisma.organization.findFirst())!.id;
  const d = await loadDashboard(org, "all" as never, E0 as never, "off" as never);
  const pc = await priceComposition(org, d);
  const NCAT = COMP_CATS.length;
  const otherIdx = COMP_CATS.findIndex((c) => c.key === "other");
  const ids = d.priceLots.map((l) => l.id);
  const rows = await prisma.rawMaterialLot.findMany({
    where: { id: { in: ids }, organizationId: org },
    select: { id: true, costBreakdown: true, unitCost: true, purchase: { select: { number: true, supplier: { select: { name: true } }, auctionSession: true } }, purchaseItems: { select: { costPlan: true, unitPrice: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pcById = new Map(pc.lots.map((l) => [l.id, l]));

  type Rec = {
    id: string; lot: string; purchase: string | null; auction: string; year: number; fur: string; qty: number; unitIncl: number; totalIncl: number; totalExcl: number; vatRate: number;
    kind: string; // nobd-plan | nobd-sheet | nobd-totals | other | hides
    format: string | null; nobdExcl: number; otherExcl: number; otherIncl: number; unused: string[]; labels: string[]; supplier: string | null;
  };
  const recs: Rec[] = [];
  for (const l of d.priceLots) {
    const r = byId.get(l.id);
    const p = pcById.get(l.id)!;
    const nobd = p.excl[NCAT];
    const other = p.excl[otherIdx];
    const comp = lotComposition({ breakdown: r?.costBreakdown, plans: (r?.purchaseItems ?? []).map((i) => i.costPlan), vatRate: l.vatRate, qty: l.recv, totalIncl: l.recvIncl, purchaseNumber: l.purchaseNumber, lotNumber: l.lotNumber });
    const labels = itemsOfBreakdown(r?.costBreakdown).map((x) => `${x.label}=${x.value}`);
    const planLabels = (r?.purchaseItems ?? []).flatMap((i) => itemsOfBreakdown((i.costPlan as { costBreakdown?: unknown } | null)?.costBreakdown).map((x) => `[план] ${x.label}=${x.value}`));
    let otherIncl = 0;
    if (comp) otherIncl = comp.incl.other;
    if (nobd === 0 && Math.abs(other) < 0.005) continue;
    let kind = "other";
    if (!comp) kind = labels.length === 0 && planLabels.length === 0 ? "nobd-sheet" : "nobd-totals";
    recs.push({
      id: l.id, lot: l.lotNumber, purchase: l.purchaseNumber ?? null, auction: l.auctionLabel, year: l.year, fur: l.item, qty: l.recv, unitIncl: l.recv ? r2(l.recvIncl / l.recv) : 0,
      totalIncl: r2(l.recvIncl), totalExcl: r2(l.recvExcl), vatRate: l.vatRate, kind, format: comp?.format ?? null, nobdExcl: r2(nobd), otherExcl: r2(other), otherIncl: r2(otherIncl),
      unused: comp?.unused ?? [], labels: [...labels, ...planLabels], supplier: r?.purchase?.supplier?.name ?? null,
    });
  }
  const hides = pc.lots.filter((x) => x.kind === "hides").map((x) => ({ id: x.id, num: x.num, fur: x.fur, auction: x.auction, nobdExcl: r2(x.excl[NCAT]), vat: r2(x.vat) }));

  // Сводка
  const tot = pc.lots.reduce((a, l) => a + l.excl[NCAT] + l.excl[otherIdx], 0);
  const totNobd = pc.lots.reduce((a, l) => a + l.excl[NCAT], 0);
  const totOther = pc.lots.reduce((a, l) => a + l.excl[otherIdx], 0);
  const planned = pc.lots.filter((l) => l.kind === "planned").map((l) => ({ id: l.id, fur: l.fur, auction: l.auction, other: r2(l.excl[otherIdx]), nobd: r2(l.excl[NCAT]) }));
  console.log(`Прочее всего (без НДС): ${f(tot)}  = без разбивки ${f(totNobd)} + прочие расходы ${f(totOther)}`);
  const sumBy = (k: "nobd-sheet" | "nobd-totals" | "other") => recs.filter((x) => x.kind === k).reduce((a, x) => a + x.nobdExcl + x.otherExcl, 0);
  console.log(`  лоты без расчётного листа: ${recs.filter((x) => x.kind === "nobd-sheet").length} лотов, ${f(sumBy("nobd-sheet"))}`);
  console.log(`  лоты с расчётом без разбивки (только итоги): ${recs.filter((x) => x.kind === "nobd-totals").length}, ${f(sumBy("nobd-totals"))}`);
  console.log(`  лоты с остатком до цены: ${recs.filter((x) => x.kind === "other").length}, ${f(sumBy("other"))}`);
  console.log(`  шкуры подрядчика: ${f(hides.reduce((a, x) => a + x.nobdExcl, 0))}`, hides);
  console.log("  planned:", planned);
  const byAuc = new Map<string, { nb: number; nbN: number; ot: number; otN: number; un: Map<string, number> }>();
  for (const x of recs) {
    const a = byAuc.get(x.auction) ?? { nb: 0, nbN: 0, ot: 0, otN: 0, un: new Map() };
    if (x.kind !== "other") { a.nb += x.nobdExcl; a.nbN++; }
    else { a.ot += x.otherExcl; a.otN++; }
    byAuc.set(x.auction, a);
  }
  for (const [k, v] of [...byAuc].sort((a, b) => b[1].nb + b[1].ot - (a[1].nb + a[1].ot))) console.log(`${k.padEnd(40)} без разбивки ${v.nbN} / ${f(v.nb)}   остаток ${v.otN} / ${f(v.ot)}`);
  writeFileSync(join(__dirname, "..", "docs-inventory", "prochee-audit-data.json"), JSON.stringify({ generated: new Date().toISOString(), total: r2(tot), totNobd: r2(totNobd), totOther: r2(totOther), recs, hides, planned }, null, 1));
  await prisma.$disconnect();
})();
