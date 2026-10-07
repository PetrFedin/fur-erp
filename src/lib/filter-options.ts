import "server-only";
// Единый загрузчик вариантов для выпадающих фильтров: getFilterOptions(orgId, year, keys).
// Кэш в памяти процесса на 30 секунд (как getFurIndex): ключ `orgId|год|имя` для зависящих от года (аукционы) и
// `orgId|имя` для остальных. unstable_cache не используется (по условию задачи; в Next 16.3.6 он — отдельный кэш данных
// с тегами и ревалидацией, а справочникам хватает кэша процесса на 30 с). После правок справочников/закупок
// из server actions кэш можно сбросить сразу: invalidateFilterOptions(orgId).
import { prisma } from "@/lib/prisma";
import { auctionName, isServiceAuction, shortAuctionName } from "@/lib/auction-names";
import { canonicalFur } from "@/lib/fur-ref";
import { getFurIndex } from "@/lib/fur-ref-server";
import { purchaseYear } from "@/lib/year-scope";
import type { YearFilter } from "@/lib/year-filter";

import type { FilterOption } from "@/lib/filters";

export type { FilterOption };

export const OPTION_KEYS = ["auction", "pyear", "fur", "color", "lotcolor", "batch", "supplier", "client", "season", "category", "model", "material"] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];

/** Только эти варианты зависят от общего года шапки. */
const YEAR_DEPENDENT: ReadonlySet<OptionKey> = new Set(["auction"]);

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; data: FilterOption[] }>();
const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });
const byLabel = (a: FilterOption, b: FilterOption) => collator.compare(a.label, b.label);

async function load(orgId: string, year: YearFilter, key: OptionKey): Promise<FilterOption[]> {
  switch (key) {
    case "auction":
      return loadAuctionFilterOptions(orgId, year);
    case "pyear": {
      const rows = await prisma.purchase.findMany({ where: { organizationId: orgId }, select: { orderDate: true } });
      const counts = new Map<string, number>();
      for (const r of rows) {
        const y = String(r.orderDate.getUTCFullYear());
        counts.set(y, (counts.get(y) ?? 0) + 1);
      }
      return Array.from(counts, ([value, count]) => ({ value, label: value, count })).sort((a, b) => Number(b.value) - Number(a.value));
    }
    case "fur": {
      const [mats, idx] = await Promise.all([
        prisma.rawMaterial.findMany({ where: { organizationId: orgId, unit: { not: "M" } }, select: { name: true } }),
        getFurIndex(orgId),
      ]);
      const names = new Set(mats.map((m) => canonicalFur(m.name, idx)?.name ?? m.name));
      return Array.from(names, (value) => ({ value, label: value })).sort(byLabel);
    }
    case "color":
    case "lotcolor": {
      const rows = await prisma.colorRef.findMany({ where: { organizationId: orgId }, select: { name: true } });
      return rows.map((r) => ({ value: r.name, label: r.name })).sort(byLabel);
    }
    case "batch": {
      const rows = await prisma.productionBatch.findMany({ where: { organizationId: orgId }, select: { number: true, name: true, year: true }, orderBy: { number: "asc" } });
      return rows.map((b) => ({ value: String(b.number), label: `Партия ${b.number}${b.year ? ` (${b.year})` : ""}`, title: b.name ?? undefined }));
    }
    case "supplier": {
      const rows = await prisma.supplier.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
      return rows.map((r) => ({ value: r.id, label: r.name }));
    }
    case "client": {
      const rows = await prisma.client.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
      return rows.map((r) => ({ value: r.id, label: r.name }));
    }
    case "season": {
      // В адресе — код сезона (читаемо); страницы принимают и старые id.
      const rows = await prisma.season.findMany({ where: { organizationId: orgId }, select: { code: true }, orderBy: { code: "asc" } });
      return rows.map((r) => ({ value: r.code, label: r.code }));
    }
    case "category": {
      // Канонические названия справочника категорий + ещё не сопоставленные тексты моделей. Текст category у привязанных
      // моделей совпадает с названием справочника, поэтому фильтры по ProductModel.category работают с обоими.
      const [refs, rows] = await Promise.all([
        prisma.categoryRef.findMany({ where: { organizationId: orgId, models: { some: {} } }, select: { name: true } }),
        prisma.productModel.findMany({ where: { organizationId: orgId, category: { not: null }, categoryRefId: null }, select: { category: true } }),
      ]);
      const names = new Set([...refs.map((r) => r.name), ...rows.map((r) => (r.category ?? "").trim())].filter(Boolean));
      return Array.from(names, (value) => ({ value, label: value })).sort(byLabel);
    }
    case "model": {
      const rows = await prisma.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
      return rows.map((r) => ({ value: r.id, label: r.name })).sort(byLabel);
    }
    case "material": {
      const rows = await prisma.rawMaterial.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
      return rows.map((r) => ({ value: r.id, label: r.name })).sort(byLabel);
    }
  }
}

/**
 * ТОЧКА ПОДКЛЮЧЕНИЯ справочника аукционов. Сейчас варианты фильтра «Партия закупки» берутся из Purchase.auctionSession
 * (название = auctionName(), счётчик = число закупок, служебные записи — в конец). Когда появится справочник
 * (Auction, src/lib/auction-ref.ts), заменить тело этой функции: вернуть FilterOption[] с value = канонический ключ
 * партии, который понимают purchaseIdsByAuction() и страницы (/lots, /purchases, /payments, /production),
 * label = короткое название, count = число закупок за год `year`. Больше нигде менять не нужно.
 */
export async function loadAuctionFilterOptions(orgId: string, year: YearFilter): Promise<FilterOption[]> {
  const rows = await prisma.purchase.findMany({
    where: { organizationId: orgId, auctionSession: { not: null }, ...purchaseYear(year) },
    select: { auctionSession: true },
  });
  const counts = new Map<string, number>();
  for (const r of rows) {
    const n = auctionName(r.auctionSession);
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return Array.from(counts, ([value, count]) => ({ value, label: shortAuctionName(value, 56), count, title: value }))
    .sort((a, b) => Number(isServiceAuction(a.value)) - Number(isServiceAuction(b.value)) || byLabel(a, b));
}

export async function getFilterOptions<K extends OptionKey>(orgId: string, year: YearFilter, keys: readonly K[]): Promise<Record<K, FilterOption[]>> {
  const now = Date.now();
  const entries = await Promise.all(
    keys.map(async (key) => {
      const ck = YEAR_DEPENDENT.has(key) ? `${orgId}|${year}|${key}` : `${orgId}|${key}`;
      const hit = cache.get(ck);
      if (hit && now - hit.at < TTL_MS) return [key, hit.data] as const;
      const data = await load(orgId, year, key);
      cache.set(ck, { at: Date.now(), data });
      return [key, data] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<K, FilterOption[]>;
}

/** Сбросить кэш вариантов (после правок справочников/закупок из server actions). */
export function invalidateFilterOptions(orgId?: string) {
  if (!orgId) return cache.clear();
  for (const k of cache.keys()) if (k.startsWith(`${orgId}|`)) cache.delete(k);
}

/**
 * Закупки выбранных партий: точное название (как в списке вариантов); значение, которого нет среди названий, — вхождение
 * в название (старые ссылки с частью названия); none — закупки без аукциона. Общая для /purchases и /production.
 */
export async function purchaseIdsByAuction(orgId: string, values: string[]): Promise<string[]> {
  const rows = await prisma.purchase.findMany({ where: { organizationId: orgId }, select: { id: true, auctionSession: true } });
  const names = new Set<string>();
  for (const r of rows) {
    const n = auctionName(r.auctionSession);
    if (n) names.add(n);
  }
  const exact = new Set(values.filter((v) => names.has(v)));
  const loose = values.filter((v) => v !== "none" && !names.has(v)).map((v) => v.toLowerCase());
  const wantNone = values.includes("none");
  return rows
    .filter((r) => {
      const n = auctionName(r.auctionSession);
      const raw = (r.auctionSession ?? "").toLowerCase();
      if (!n) return wantNone || loose.some((v) => raw.includes(v));
      return exact.has(n) || loose.some((v) => raw.includes(v));
    })
    .map((r) => r.id);
}

/** Материалы (id), относящиеся к выбранным видам меха («Лиса» включает «Лиса красная»). */
export async function furMaterialIdsByKind(orgId: string, kinds: string[]): Promise<string[]> {
  const [mats, idx] = await Promise.all([
    prisma.rawMaterial.findMany({ where: { organizationId: orgId, unit: { not: "M" } }, select: { id: true, name: true } }),
    getFurIndex(orgId),
  ]);
  return mats.filter((m) => kinds.includes(canonicalFur(m.name, idx)?.name ?? m.name)).map((m) => m.id);
}
