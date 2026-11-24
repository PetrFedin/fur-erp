// «Оплаты» на витрине (этап 4): сводка по аукционам и Главная на странице «Оплаты» из снимков равны живому расчёту.
// Копия базы (имя содержит «scratch»).
import "./stubs/server-only-shim";
delete process.env.SNAPSHOTS; // нужны снимки витрины, а не живой расчёт
import { prisma } from "../src/lib/prisma";

if (!/scratch/.test(process.env.DATABASE_URL ?? "")) { console.error("Отказ: DATABASE_URL не похож на копию (нет «scratch»)"); process.exit(2); }
let fails = 0, checks = 0;
const ok = (what: string, cond: boolean, extra = "") => { checks++; console.log(`${cond ? "OK  " : "FAIL"} ${what}${extra ? " " + extra : ""}`); if (!cond) fails++; };
import { same } from "./lib/deep-same";

(async () => {
  const { buildMart } = await import("../src/lib/mart/build");
  const { dashboardCached, readSnapshot } = await import("../src/lib/mart/snapshots");
  const { auctionSummariesView } = await import("../src/lib/mart/auctions");
  const { loadAuctionSummaries } = await import("../src/lib/auction-payments");
  const { loadDashboard } = await import("../src/lib/dashboard-data");
  const { DASH_FILTERS } = await import("../src/lib/dashboard-calc");
  const { parseFilters } = await import("../src/lib/filters");
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  await buildMart(prisma, org); // всегда: в копии может лежать витрина, собранная прежним кодом (без новых снимков)
  ok("снимок сводки по аукционам есть", (await readSnapshot(org, "pay:auctions")) !== null);

  const live = await loadAuctionSummaries(prisma, org);
  const view = await auctionSummariesView(org);
  const d0 = same(live, view);
  ok(`сводка по аукционам: витрина = живой расчёт (${live.length} аукционов)`, d0 === null, d0 ?? "");
  let bad: string[] = [];
  for (const s of live) {
    const [one] = await loadAuctionSummaries(prisma, org, [s.name]);
    const [fromView] = await auctionSummariesView(org, [s.name]);
    if (same(one, fromView)) bad.push(s.name);
  }
  ok("каждый аукцион: отбор из витрины = расчёт по одному имени", bad.length === 0, bad.slice(0, 5).join(", "));

  // Главная на странице «Оплаты»: раньше — живой расчёт с пустыми фильтрами панели, теперь — снимок.
  bad = [];
  for (const y of ["all", "2025", "2026"] as const) for (const c4 of ["on", "off"] as const) {
    const was = await loadDashboard(org, y, { status: [], ...parseFilters(DASH_FILTERS, {}) } as never, c4);
    const now = await dashboardCached(org, y, c4);
    { const d = same(was, now); if (d) bad.push(`${y}/${c4}: ${d}`); }
  }
  ok("Главная в «Оплатах»: снимок = прежний живой расчёт (годы и режим 4 %)", bad.length === 0, bad.slice(0, 2).join(" | "));

  console.log(fails ? `\nПровалов: ${fails} из ${checks}` : `\nВсё в порядке (${checks} проверок)`);
  await prisma.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
