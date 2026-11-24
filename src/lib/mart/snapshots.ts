import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { loadDashboard, type DashboardData } from "@/lib/dashboard-data";
import { parseDashFilters } from "@/lib/dashboard-calc";
import { loadFurLots } from "@/lib/fur-table-server";
import { getFurIndex } from "@/lib/fur-ref-server";
import { loadFurKinds } from "@/lib/fur-kinds-server";
import { availableYears, type YearFilter } from "@/lib/year-filter";
import type { FurLot } from "@/lib/fur-table";

/**
 * Снимки готовых расчётов экранов в витрине: «Главная» и «Сырьё» читают их вместо пересчёта на каждый заход.
 * Ключи: dash:<год>:<on|off> (режим 4 %), furlots:<fur|lining>:<год>, furkinds, pay:overview, pay:left, pay:auctions (сводка по аукционам), purchases:tree. НДС в числах лежит в обоих вариантах, поэтому в ключе его нет.
 * Снимок годен, пока после его сборки не было записей (метка data-version, ставится в revalidateAll) и ему меньше SNAPSHOT_MAX_AGE_MS (12 часов — страховка на случай, если метка не записалась; записи вне приложения — после них mart:refresh);
 * иначе экран считает по-старому вживую — число всегда верное, быстрым оно становится после следующей фоновой пересборки.
 */
const VERSION_KEY = "data-version";
// MART_SNAPSHOT_MAX_AGE_MS — только для сценариев сверки (scripts/mart-vs-legacy.ts), чтобы снимок не «старел» посреди проверки.
const SNAPSHOT_MAX_AGE_MS = Number(process.env.MART_SNAPSHOT_MAX_AGE_MS) || 12 * 3600 * 1000;

export async function markDataChanged(orgId: string): Promise<void> {
  const value = Date.now();
  try {
    // Сырым SQL, мимо журнала изменений: служебная отметка не должна попадать в «Журнал» на каждую запись данных.
    await prisma.$executeRaw`INSERT INTO "SystemState" ("id", "organizationId", "key", "value", "createdAt", "updatedAt") VALUES (${crypto.randomUUID()}, ${orgId}, ${VERSION_KEY}, to_jsonb(${value}::bigint), now(), now()) ON CONFLICT ("organizationId", "key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()`;
  } catch { /* метка не записалась — снимки всё равно живут не дольше SNAPSHOT_MAX_AGE_MS */ }
}

async function dataVersion(orgId: string): Promise<number> {
  const r = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: VERSION_KEY } }, select: { value: true } });
  return typeof r?.value === "number" ? r.value : 0;
}

/** Decimal и даты в JSON теряют тип: помечаем их ({"$d": "…"}, {"$t": "…"}) и возвращаем при чтении, чтобы экраны получали ровно те же значения, что от живого расчёта. */
function encode(payload: unknown): unknown {
  return JSON.parse(JSON.stringify(payload, function (this: Record<string, unknown>, k: string, v: unknown) {
    const o = this[k] as { toNumber?: unknown; toFixed?: unknown; toString(): string } | Date | null;
    if (o && typeof o === "object") {
      if (o instanceof Date) return { $t: o.toISOString() };
      if (typeof o.toNumber === "function" && typeof o.toFixed === "function") return { $d: o.toString() };
    }
    return v;
  }));
}
function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length === 1 && keys[0] === "$d") return new Decimal(o.$d as string);
    if (keys.length === 1 && keys[0] === "$t") return new Date(o.$t as string);
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = decode(o[k]);
    return out;
  }
  return v;
}

async function save(orgId: string, key: string, payload: unknown, started: number, buildMs: number): Promise<void> {
  const body = encode(payload) as object;
  const builtAt = new Date(started);
  await prisma.dmSnapshot.upsert({ where: { organizationId_key: { organizationId: orgId, key } }, update: { payload: body, builtAt, buildMs }, create: { organizationId: orgId, key, payload: body, builtAt, buildMs } });
}

/** Годы, по которым собираем снимки: «все» и каждый год учёта. */
async function snapshotYears(orgId: string): Promise<YearFilter[]> {
  const max = (await prisma.dmLot.aggregate({ where: { organizationId: orgId }, _max: { purchaseYear: true } }))._max.purchaseYear;
  return ["all", ...(availableYears(max) as YearFilter[])];
}

export async function buildSnapshots(orgId: string): Promise<{ keys: number; ms: number }> {
  const { whileBuildingMart } = await import("@/lib/mart/cached");
  return whileBuildingMart(() => buildSnapshotsImpl(orgId));
}

async function buildSnapshotsImpl(orgId: string): Promise<{ keys: number; ms: number }> {
  const t0 = Date.now();
  // Сначала все расчёты (в общей памяти загрузок: лоты, ТЗ, оплаты грузятся один раз на все годы и режимы), потом запись.
  // Запись в БД сбрасывает память загрузок, поэтому снимки пишутся после расчётов, а не между ними.
  const { withMemoScope } = await import("@/lib/req-memo");
  const out: { key: string; payload: unknown; started: number; ms: number }[] = [];
  const put = async (key: string, compute: () => Promise<unknown>) => { const started = Date.now(); const payload = await compute(); out.push({ key, payload, started, ms: Date.now() - started }); };
  await withMemoScope(async () => {
    const years = await snapshotYears(orgId);
    const furIdx = await getFurIndex(orgId);
    for (const y of years) {
      for (const c4 of ["on", "off"] as const) await put(`dash:${y}:${c4}`, () => loadDashboard(orgId, y, parseDashFilters({}), c4));
      for (const kind of ["fur", "lining"] as const) await put(`furlots:${kind}:${y}`, () => loadFurLots(prisma, orgId, { kind, year: y, furIdx } as never));
    }
    const { loadPaymentsOverviewLive, loadPaymentsLeftLive, paymentsLeftToStored } = await import("@/lib/payments-overview");
    await put("pay:overview", () => loadPaymentsOverviewLive(orgId));
    await put("pay:left", async () => paymentsLeftToStored(await loadPaymentsLeftLive(orgId)));
    const { loadAuctionSummaries } = await import("@/lib/auction-payments");
    await put("pay:auctions", () => loadAuctionSummaries(prisma, orgId));
    const { computePurchaseView } = await import("@/lib/mart/purchase-view");
    await put("purchases:tree", () => computePurchaseView(orgId));
    await put("furkinds", () => loadFurKinds(orgId));
  });
  for (const o of out) await save(orgId, o.key, o.payload, o.started, o.ms);
  return { keys: out.length, ms: Date.now() - t0 };
}

export async function readSnapshot<T>(orgId: string, key: string): Promise<T | null> {
  if (process.env.SNAPSHOTS === "0") return null;
  const [snap, ver] = await Promise.all([prisma.dmSnapshot.findUnique({ where: { organizationId_key: { organizationId: orgId, key } } }), dataVersion(orgId)]);
  if (!snap) return null;
  const t = snap.builtAt.getTime();
  if (t < ver || Date.now() - t > SNAPSHOT_MAX_AGE_MS) return null;
  return decode(snap.payload) as T;
}

/** Главная/«Сырьё» без фильтров панели: снимок, а если он устарел — расчёт вживую. */
export async function dashboardCached(orgId: string, year: YearFilter, c4: "on" | "off"): Promise<DashboardData> {
  return (await readSnapshot<DashboardData>(orgId, `dash:${year}:${c4}`)) ?? loadDashboard(orgId, year, parseDashFilters({}), c4);
}

export async function furLotsCached(orgId: string, kind: "fur" | "lining", year: YearFilter): Promise<FurLot[] | null> {
  return readSnapshot<FurLot[]>(orgId, `furlots:${kind}:${year}`);
}
export async function furKindsCached<T>(orgId: string): Promise<T | null> {
  return readSnapshot<T>(orgId, "furkinds");
}

/** Лоты меха или подкладки: снимок из витрины, а если он устарел — расчёт вживую (те же цифры, что раньше). */
export async function furLotsOrLive(orgId: string, kind: "fur" | "lining", year: YearFilter, furIdx?: Awaited<ReturnType<typeof getFurIndex>>): Promise<FurLot[]> {
  return (await furLotsCached(orgId, kind, year)) ?? loadFurLots(prisma, orgId, { kind, year, furIdx } as never);
}

/** Витрина свежа, если после её сборки не было записей (метка data-version ставится в revalidateAll). Иначе экраны считают вживую. */
export async function isMartFresh(orgId: string): Promise<boolean> {
  if (process.env.SNAPSHOTS === "0") return false;
  const [agg, ver] = await Promise.all([prisma.dmLot.aggregate({ where: { organizationId: orgId }, _max: { builtAt: true } }), dataVersion(orgId)]);
  const t = agg._max.builtAt?.getTime();
  return t != null && t >= ver;
}

/** Строки раздела «Закупки» из витрины; устарела — тот же расчёт вживую. */
export async function purchaseViewCached(orgId: string): Promise<import("@/lib/mart/purchase-view").PurchaseViewData> {
  const snap = await readSnapshot<import("@/lib/mart/purchase-view").PurchaseViewData>(orgId, "purchases:tree");
  if (snap) return snap;
  const { computePurchaseView } = await import("@/lib/mart/purchase-view");
  return computePurchaseView(orgId);
}
