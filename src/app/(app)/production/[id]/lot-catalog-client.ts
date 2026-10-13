"use client";

import { loadLotCatalog, type CatalogLot } from "../lot-catalog-action";

/**
 * Каталог лотов склада ТЗ: одна копия на страницу, подгружается по требованию (когда открывают список лотов),
 * а не вшивается в разметку каждой строки. Кэш короткий: остатки меняются после каждого списания.
 */
const TTL_MS = 20_000;
const cache = new Map<string, { at: number; lots: CatalogLot[] | null; pending: Promise<CatalogLot[]> | null }>();

export function peekLotCatalog(orderId: string): CatalogLot[] | null {
  return cache.get(orderId)?.lots ?? null;
}

/** Подгружает (или освежает устаревший) каталог; возвращает промис с актуальным списком. */
export function warmLotCatalog(orderId: string): Promise<CatalogLot[]> {
  const hit = cache.get(orderId);
  if (hit?.pending) return hit.pending;
  if (hit?.lots && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.lots);
  const pending = loadLotCatalog(orderId).then(
    (lots) => { cache.set(orderId, { at: Date.now(), lots, pending: null }); return lots; },
    (e) => { cache.set(orderId, { at: 0, lots: hit?.lots ?? null, pending: null }); throw e; },
  );
  cache.set(orderId, { at: hit?.at ?? 0, lots: hit?.lots ?? null, pending });
  return pending;
}

/** Остатки изменились (сохранили списание) — следующий вызов warm перечитает каталог. */
export function invalidateLotCatalog(orderId: string) {
  const hit = cache.get(orderId);
  if (hit) cache.set(orderId, { ...hit, at: 0 });
}

export type { CatalogLot };
