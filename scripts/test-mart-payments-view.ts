// «Оплаты» на витрине (этап 4): сводка по аукционам и Главная на странице «Оплаты» из снимков равны живому расчёту.
// Копия базы (имя содержит «scratch»).
import "./stubs/server-only-shim";
delete process.env.SNAPSHOTS; // нужны снимки витрины, а не живой расчёт
import { prisma } from "../src/lib/prisma";

if (!/scratch/.test(process.env.DATABASE_URL ?? "")) { console.error("Отказ: DATABASE_URL не похож на копию (нет «scratch»)"); process.exit(2); }
let fails = 0, checks = 0;
const ok = (what: string, cond: boolean, extra = "") => { checks++; console.log(`${cond ? "OK  " : "FAIL"} ${what}${extra ? " " + extra : ""}`); if (!cond) fails++; };
/** Сравнение по значению: Decimal и даты — строкой, ключи объектов по алфавиту (jsonb в базе переставляет ключи). */
const canon = (v: unknown): unknown => {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Map) return canon(Array.from(v.entries()));
  if (v && typeof v === "object" && typeof (v as { toFixed?: unknown }).toFixed === "function" && !Array.isArray(v)) return String(v);
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]));
  return v;
};
/** Первое различие (числа — с допуском 0,01: дроби на границе округления); null — равны. */
const diff = (a: unknown, b: unknown, path = ""): string | null => {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 0.01 ? null : `${path}: ${a} ≠ ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) { if (a.length !== b.length) return `${path}: длина ${a.length} ≠ ${b.length}`; for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], `${path}[${i}]`); if (d) return d; } return null; }
  if (a && b && typeof a === "object" && typeof b === "object") { const ka = Object.keys(a), kb = Object.keys(b); if (ka.join() !== kb.join()) return `${path}: поля ${ka.join()} ≠ ${kb.join()}`; for (const k of ka) { const d = diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`); if (d) return d; } return null; }
  return a === b ? null : `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
};
const same = (a: unknown, b: unknown) => diff(canon(a), canon(b));

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
