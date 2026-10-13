import { uniqueOrderCount } from "@/lib/tz-key";
import { batchNameText } from "@/lib/batch-name";
import "server-only";
// Единый загрузчик вариантов для выпадающих фильтров: getFilterOptions(orgId, year, keys).
// Кэш в памяти процесса на 30 секунд (как getFurIndex): ключ `orgId|год|имя` для зависящих от года (аукционы) и
// `orgId|имя` для остальных. unstable_cache не используется (по условию задачи; в Next 16.3.6 он — отдельный кэш данных
// с тегами и ревалидацией, а справочникам хватает кэша процесса на 30 с). После правок справочников/закупок
// из server actions кэш можно сбросить сразу: invalidateFilterOptions(orgId).
import { prisma } from "@/lib/prisma";
import { auctionName, isServiceAuction, shortAuctionName } from "@/lib/auction-names";
import { findAuctionIn } from "@/lib/auction-ref-core";
import { canonicalFur } from "@/lib/fur-ref";
import { getFurIndex } from "@/lib/fur-ref-server";
import { purchaseYear } from "@/lib/year-scope";
import { batchLabel } from "@/lib/batch-label";
import { ATTR_GROUP_ORDER } from "@/lib/fur-attr";
import type { YearFilter } from "@/lib/year-filter";

import type { FilterOption } from "@/lib/filters";

export type { FilterOption };

export const OPTION_KEYS = ["auction", "pyear", "fur", "color", "lotcolor", "batch", "supplier", "client", "season", "category", "model", "material", "attr"] as const;
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
      // Цвета лотов: только те, что реально есть у лотов (каноническое название справочника), со счётчиком лотов.
      const rows = await prisma.rawMaterialLot.findMany({ where: { organizationId: orgId }, select: { color: true, colorRef: { select: { name: true } } } });
      const counts = new Map<string, number>();
      for (const r of rows) {
        const n = r.colorRef?.name ?? r.color?.trim();
        if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
      }
      return Array.from(counts, ([value, count]) => ({ value, label: value, count })).sort(byLabel);
    }
    case "attr": {
      // Признаки меха из справочника: только те, что есть у лотов или ТЗ, со счётчиком лотов; порядок — по группам.
      const refs = await prisma.furAttrRef.findMany({
        where: { organizationId: orgId, OR: [{ lots: { some: {} } }, { orders: { some: {} } }] },
        select: { name: true, group: true, furKind: true, description: true, _count: { select: { lots: true } } },
      });
      const rank = (g: string | null) => { const i = g ? ATTR_GROUP_ORDER.indexOf(g) : -1; return i < 0 ? ATTR_GROUP_ORDER.length : i; };
      return refs
        .sort((a, b) => rank(a.group) - rank(b.group) || collator.compare(a.name, b.name))
        .map((r) => ({ value: r.name, label: r.name, count: r._count.lots, title: [r.group, r.furKind, r.description].filter(Boolean).join(" · ") || undefined }));
    }
    case "batch": {
      const rows = await prisma.productionBatch.findMany({
        where: { organizationId: orgId },
        select: { number: true, name: true, year: true, orders: { select: { number: true, workOrderNumber: true, workOrderDate: true, endDate: true, startDate: true } } },
        orderBy: { number: "asc" },
      });
      // Год обязателен в подписи: «Партия 5 · 2025»; нет года — «≈год по ТЗ» или «пусто» (batch-label.ts).
      // Группа списка — год партии (batch.year); без года — «Без года». Серверный разбор значений не меняется.
      return rows.map((b) => ({ value: String(b.number), label: batchLabel(b.number, b.year, b.orders), count: uniqueOrderCount(b.orders), title: batchNameText(b.name) ?? undefined, group: b.year ? String(b.year) : "Без года" }));
    }
    case "supplier": {
      // Только поставщики, у которых есть закупки или оплаты: остальные фильтр ничем не сужают.
      const rows = await prisma.supplier.findMany({
        where: { organizationId: orgId, OR: [{ purchases: { some: {} } }, { payments: { some: {} } }] },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
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
 * Варианты фильтра «Партия закупки (аукцион)» из СПРАВОЧНИКА аукционов (Auction, src/lib/auction-ref.ts).
 * value = ключ группы, который понимают purchaseIdsByAuction() и страницы (/lots, /purchases, /payments, /production):
 * название аукциона из Purchase.auctionSession (auctionName()); у переименованного аукцион это его короткое имя.
 * label = короткое имя из справочника, title = полное название · дом · год; count = число закупок за год `year`.
 * Закупки, чей аукцион в справочнике не найден, остаются в списке под своим текстом.
 */
export async function loadAuctionFilterOptions(orgId: string, year: YearFilter): Promise<FilterOption[]> {
  const [rows, list] = await Promise.all([
    prisma.purchase.findMany({
      where: { organizationId: orgId, auctionSession: { not: null }, ...purchaseYear(year) },
      select: { auctionSession: true, orderDate: true },
    }),
    prisma.auction.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, aliases: true, isService: true, confirmed: true, fullName: true, house: true, year: true } }),
  ]);
  const counts = new Map<string, number>();
  // Год партии закупки — по дате закупки (год проведения аукциона): самый частый год закупок партии.
  const years = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const n = auctionName(r.auctionSession);
    if (!n) continue;
    counts.set(n, (counts.get(n) ?? 0) + 1);
    const y = r.orderDate.getUTCFullYear();
    const ym = years.get(n) ?? new Map<number, number>();
    ym.set(y, (ym.get(y) ?? 0) + 1);
    years.set(n, ym);
  }
  const yearOf = (n: string, refYear: unknown) => {
    const ym = years.get(n);
    if (ym && ym.size) return String(Array.from(ym).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]);
    return typeof refYear === "number" || (typeof refYear === "string" && /^\d{4}$/.test(refYear)) ? String(refYear) : "Без года";
  };
  return Array.from(counts, ([value, count]) => {
    const a = findAuctionIn(value, list);
    const label = shortAuctionName(a && !a.isService ? a.name : value, 56);
    const title = a && !a.isService ? [a.fullName ?? a.name, a.house, a.year].filter(Boolean).join(" · ") : value;
    return { value, label, count, title, group: yearOf(value, a?.year) };
  }).sort((a, b) => Number(isServiceAuction(a.value)) - Number(isServiceAuction(b.value)) || byLabel(a, b));
}

/**
 * Подписи партий закупки из справочника аукционов для любого списка названий (Purchase.auctionSession):
 * label — короткое имя справочника («СП 03.25»), title — полное название · дом · год. Название, которого нет в справочнике,
 * остаётся как есть. Так все фильтры «Партия закупки (аукцион)» (lots, документы, аналитика, проверка…) подписаны одинаково.
 */
export async function auctionLabeler(orgId: string): Promise<(name: string) => { label: string; title: string }> {
  const all = (await getFilterOptions(orgId, "all", ["auction"])).auction;
  const m = new Map(all.map((o) => [o.value, o] as const));
  return (name) => {
    const o = m.get(auctionName(name) ?? name) ?? m.get(name);
    return o ? { label: o.label, title: o.title ?? name } : { label: shortAuctionName(name, 56), title: name };
  };
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
  const [rows, list] = await Promise.all([
    prisma.purchase.findMany({ where: { organizationId: orgId }, select: { id: true, auctionSession: true, auctionId: true } }),
    prisma.auction.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, aliases: true, isService: true, confirmed: true } }),
  ]);
  const names = new Set<string>();
  for (const r of rows) {
    const n = auctionName(r.auctionSession);
    if (n) names.add(n);
  }
  // Значение из старой ссылки (прежнее написание аукциона) -> запись справочника: ищем закупки по её id и по всем её написаниям.
  const byRef = new Set<string>();
  for (const v of values) {
    if (v === "none" || names.has(v)) continue;
    const a = findAuctionIn(v, list);
    if (a && !a.isService) byRef.add(a.id);
  }
  const exact = new Set(values.filter((v) => names.has(v)));
  const loose = values.filter((v) => v !== "none" && !names.has(v) && !(findAuctionIn(v, list) && !findAuctionIn(v, list)!.isService)).map((v) => v.toLowerCase());
  const wantNone = values.includes("none");
  return rows
    .filter((r) => {
      const n = auctionName(r.auctionSession);
      const raw = (r.auctionSession ?? "").toLowerCase();
      if (r.auctionId && byRef.has(r.auctionId)) return true;
      if (byRef.size && findAuctionIn(r.auctionSession, list) && byRef.has(findAuctionIn(r.auctionSession, list)!.id)) return true;
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
