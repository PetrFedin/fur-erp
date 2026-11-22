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
 * Ключи: dash:<год>:<on|off> (режим 4 %), furlots:<fur|lining>:<год>, furkinds. НДС в числах лежит в обоих вариантах, поэтому в ключе его нет.
 * Снимок годен, пока после его сборки не было записей (метка data-version, ставится в revalidateAll) и ему меньше SNAPSHOT_MAX_AGE_MS;
 * иначе экран считает по-старому вживую — число всегда верное, быстрым оно становится после следующей фоновой пересборки.
 */
const VERSION_KEY = "data-version";
const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;

export async function markDataChanged(orgId: string): Promise<void> {
  const value = Date.now();
  try {
    await prisma.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key: VERSION_KEY } }, update: { value }, create: { organizationId: orgId, key: VERSION_KEY, value } });
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

async function save(orgId: string, key: string, payload: unknown, started: number): Promise<void> {
  const body = encode(payload) as object;
  const builtAt = new Date(started);
  const buildMs = Date.now() - started;
  await prisma.dmSnapshot.upsert({ where: { organizationId_key: { organizationId: orgId, key } }, update: { payload: body, builtAt, buildMs }, create: { organizationId: orgId, key, payload: body, builtAt, buildMs } });
}

/** Годы, по которым собираем снимки: «все» и каждый год учёта. */
async function snapshotYears(orgId: string): Promise<YearFilter[]> {
  const max = (await prisma.dmLot.aggregate({ where: { organizationId: orgId }, _max: { purchaseYear: true } }))._max.purchaseYear;
  return ["all", ...(availableYears(max) as YearFilter[])];
}

export async function buildSnapshots(orgId: string): Promise<{ keys: number; ms: number }> {
  const t0 = Date.now();
  let keys = 0;
  const years = await snapshotYears(orgId);
  const furIdx = await getFurIndex(orgId);
  for (const y of years) {
    for (const c4 of ["on", "off"] as const) {
      const started = Date.now();
      await save(orgId, `dash:${y}:${c4}`, await loadDashboard(orgId, y, parseDashFilters({}), c4), started); keys++;
    }
    for (const kind of ["fur", "lining"] as const) {
      const started = Date.now();
      await save(orgId, `furlots:${kind}:${y}`, await loadFurLots(prisma, orgId, { kind, year: y, furIdx } as never), started); keys++;
    }
  }
  const started = Date.now();
  await save(orgId, "furkinds", await loadFurKinds(orgId), started); keys++;
  return { keys, ms: Date.now() - t0 };
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
