// Справочник аукционов: логика без server-only и без привязки к клиенту приложения — принимает клиент БД параметром,
// поэтому годится и для страницы (через src/lib/auction-ref.ts), и для скриптов/тестов на копии базы.
import type { AuctionKind, Prisma, PrismaClient } from "@prisma/client";
import { auctionKey, firstLine, isServiceKey, replaceFirstLine } from "@/lib/auction-key";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";

export type Db = PrismaClient | Prisma.TransactionClient;
type Full = PrismaClient;

export class AuctionError extends Error {}

export type AuctionLite = { id: string; name: string; aliases: string[]; isService: boolean; confirmed: boolean };

export const KIND_LABELS: Record<AuctionKind, string> = { FUR: "Мех", LINING: "Подкладка", MATERIALS: "Материалы", OTHER: "Прочее" };

/** Ключи всех написаний аукциона: имя + алиасы. */
export function auctionKeys(a: { name: string; aliases: string[] }): Set<string> {
  return new Set([a.name, ...a.aliases].map(auctionKey).filter(Boolean));
}

/** Найти аукцион по тексту в списке (имя, потом алиас; служебные заглушки — на служебный аукцион). Чистая функция. */
export function findAuctionIn<T extends AuctionLite>(text: string | null | undefined, list: T[]): T | null {
  const k = auctionKey(text);
  if (!k) return null;
  const byName = list.find((a) => auctionKey(a.name) === k);
  if (byName) return byName;
  const byAlias = list.find((a) => a.aliases.some((x) => auctionKey(x) === k));
  if (byAlias) return byAlias;
  if (isServiceKey(k)) return list.find((a) => a.isService) ?? null;
  return null;
}

/** Короткое имя для показа по тексту из старых полей; если аукцион не найден (или не подтверждён при onlyConfirmed) — исходная первая строка. */
export function displayAuctionNameIn(text: string | null | undefined, list: AuctionLite[], opts: { onlyConfirmed?: boolean } = {}): string {
  const a = findAuctionIn(text, list);
  if (a && (!opts.onlyConfirmed || a.confirmed)) return a.name;
  return firstLine(text);
}

export async function resolveAuctionIn(db: Db, text: string | null | undefined, orgId: string) {
  if (!auctionKey(text)) return null;
  const list = await db.auction.findMany({ where: { organizationId: orgId } });
  return findAuctionIn(text, list);
}

export type AuctionOption = {
  id: string; name: string; fullName: string | null; house: string | null; kind: AuctionKind; year: number | null; month: number | null;
  currency: string | null; auctionDate: Date | null; aliases: string[]; isService: boolean; confirmed: boolean; sortOrder: number; note: string | null;
  purchaseCount: number; total: number; updatedAt: Date;
};

/** Список для фильтров, форм и страницы справочника: число закупок и сумма (с НДС, в рублях, без отменённых). */
export async function loadAuctionOptionsIn(db: Db, orgId: string): Promise<AuctionOption[]> {
  const list = await db.auction.findMany({
    where: { organizationId: orgId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      purchases: {
        select: { status: true, exchangeRate: true, items: { select: { subtotal: true, vatRate: true, quantity: true, costPlan: true } }, expenses: { select: { amount: true, vatRate: true } } },
      },
    },
  });
  return list.map(({ purchases, ...a }) => ({
    ...a,
    purchaseCount: purchases.length,
    total: purchases.filter((p) => p.status !== "CANCELLED").reduce((s, p) => s + Number(purchaseTotalInclVat(p)), 0),
  }));
}

// ---------- валидация имени ----------

export function cleanName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 2) throw new AuctionError("Укажите короткое имя аукциона (не короче 2 символов)");
  if (name.length > 60) throw new AuctionError("Имя слишком длинное — до 60 символов");
  if (/[\r\n]/.test(raw)) throw new AuctionError("Имя должно быть в одной строке");
  return name;
}

async function assertNameFree(db: Db, orgId: string, name: string, aliases: string[], exceptId?: string) {
  const keys = new Set([name, ...aliases].map(auctionKey));
  const others = await db.auction.findMany({ where: { organizationId: orgId, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  for (const o of others) {
    for (const v of [o.name, ...o.aliases]) {
      if (keys.has(auctionKey(v))) throw new AuctionError(`«${v}» уже есть у аукциона «${o.name}». Если это один аукцион — объедините их.`);
    }
  }
}

function mergeAliases(base: string[], add: string[], name: string): string[] {
  // Дубли определяем по точному написанию: «СП 09-26» хранится как прежнее написание, хотя ключ сравнения у него тот же, что у «СП 09.26» (пример).
  const seen = new Set([name.trim()]);
  const out: string[] = [];
  for (const v of [...base, ...add]) {
    const t = v.replace(/\s+/g, " ").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

// ---------- синхронизация кэш-текстов ----------

/**
 * Привести во всех местах, где название аукциона хранится текстом, к `newName`:
 * Purchase.auctionSession (первая строка; у закупок этого аукциона — всегда, у остальных — если написание совпало с именем/алиасом),
 * Payment.auctionSession, PurchaseDocument.batch. Возвращает число изменённых строк по таблицам.
 */
export async function syncAuctionTexts(tx: Db, orgId: string, auctionId: string, keys: Set<string>, newName: string) {
  const out = { purchases: 0, payments: 0, documents: 0 };
  const mine = await tx.purchase.findMany({ where: { organizationId: orgId, auctionId }, select: { id: true, auctionSession: true } });
  for (const p of mine) {
    const next = replaceFirstLine(p.auctionSession ?? "", newName);
    if (next !== p.auctionSession) {
      await tx.purchase.update({ where: { id: p.id }, data: { auctionSession: next } });
      out.purchases++;
    }
  }
  const mineIds = new Set(mine.map((p) => p.id));
  const others = await tx.purchase.findMany({ where: { organizationId: orgId, auctionSession: { not: null } }, select: { id: true, auctionSession: true } });
  for (const p of others) {
    if (mineIds.has(p.id) || !keys.has(auctionKey(p.auctionSession))) continue;
    const next = replaceFirstLine(p.auctionSession!, newName);
    if (next !== p.auctionSession) {
      await tx.purchase.update({ where: { id: p.id }, data: { auctionSession: next } });
      out.purchases++;
    }
  }
  const pay = await tx.payment.groupBy({ by: ["auctionSession"], where: { organizationId: orgId, auctionSession: { not: null } } });
  for (const g of pay) {
    if (!keys.has(auctionKey(g.auctionSession))) continue;
    const next = replaceFirstLine(g.auctionSession!, newName);
    if (next === g.auctionSession) continue;
    const r = await tx.payment.updateMany({ where: { organizationId: orgId, auctionSession: g.auctionSession }, data: { auctionSession: next } });
    out.payments += r.count;
  }
  const docs = await tx.purchaseDocument.groupBy({ by: ["batch"], where: { organizationId: orgId, batch: { not: null } } });
  for (const g of docs) {
    if (!keys.has(auctionKey(g.batch))) continue;
    const next = replaceFirstLine(g.batch!, newName);
    if (next === g.batch) continue;
    const r = await tx.purchaseDocument.updateMany({ where: { organizationId: orgId, batch: g.batch }, data: { batch: next } });
    out.documents += r.count;
  }
  return out;
}

// ---------- действия ----------

export type AuctionInput = {
  name: string; fullName?: string | null; house?: string | null; kind?: AuctionKind; year?: number | null; month?: number | null;
  currency?: string | null; auctionDate?: Date | null; aliases?: string[]; note?: string | null; isService?: boolean;
};

export async function createAuctionIn(db: Full, orgId: string, input: AuctionInput) {
  const name = cleanName(input.name);
  const aliases = mergeAliases([], input.aliases ?? [], name);
  return db.$transaction(async (tx) => {
    await assertNameFree(tx, orgId, name, aliases);
    const max = await tx.auction.aggregate({ where: { organizationId: orgId }, _max: { sortOrder: true } });
    return tx.auction.create({
      data: {
        organizationId: orgId, name, aliases, fullName: input.fullName?.trim() || null, house: input.house?.trim() || null,
        kind: input.kind ?? "FUR", year: input.year ?? null, month: input.month ?? null, currency: input.currency?.trim() || null,
        auctionDate: input.auctionDate ?? null, note: input.note?.trim() || null, isService: input.isService ?? false,
        confirmed: true, sortOrder: (max._max.sortOrder ?? 0) + 1,
      },
    });
  });
}

/** Переименование: одна транзакция — имя, старое имя в алиасы, кэш-тексты везде. Переименование само подтверждает имя. */
export async function renameAuctionIn(db: Full, orgId: string, id: string, newNameRaw: string) {
  const name = cleanName(newNameRaw);
  return db.$transaction(async (tx) => {
    const a = await tx.auction.findFirst({ where: { id, organizationId: orgId } });
    if (!a) throw new AuctionError("Аукцион не найден");
    await assertNameFree(tx, orgId, name, a.aliases, id);
    const aliases = mergeAliases(a.aliases, a.name === name ? [] : [a.name], name);
    const keys = auctionKeys({ name: a.name, aliases: a.aliases });
    await tx.auction.update({ where: { id }, data: { name, aliases, confirmed: true } });
    const synced = await syncAuctionTexts(tx, orgId, id, keys, name);
    return { auction: { ...a, name, aliases }, synced };
  });
}

export async function confirmAuctionsIn(db: Full, orgId: string, ids: string[]) {
  const r = await db.auction.updateMany({ where: { organizationId: orgId, id: { in: ids }, confirmed: false }, data: { confirmed: true } });
  return r.count;
}

/** Правка остальных полей (без имени). */
export async function updateAuctionFieldsIn(db: Full, orgId: string, id: string, data: Omit<AuctionInput, "name" | "aliases"> & { aliases?: string[] }) {
  return db.$transaction(async (tx) => {
    const a = await tx.auction.findFirst({ where: { id, organizationId: orgId } });
    if (!a) throw new AuctionError("Аукцион не найден");
    const aliases = data.aliases ? mergeAliases([], data.aliases, a.name) : undefined;
    if (aliases) await assertNameFree(tx, orgId, a.name, aliases, id);
    return tx.auction.update({
      where: { id },
      data: {
        ...(data.fullName !== undefined ? { fullName: data.fullName?.trim() || null } : {}),
        ...(data.house !== undefined ? { house: data.house?.trim() || null } : {}),
        ...(data.kind ? { kind: data.kind } : {}),
        ...(data.year !== undefined ? { year: data.year } : {}),
        ...(data.month !== undefined ? { month: data.month } : {}),
        ...(data.currency !== undefined ? { currency: data.currency?.trim() || null } : {}),
        ...(data.auctionDate !== undefined ? { auctionDate: data.auctionDate } : {}),
        ...(data.note !== undefined ? { note: data.note?.trim() || null } : {}),
        ...(data.isService !== undefined ? { isService: data.isService } : {}),
        ...(aliases ? { aliases } : {}),
      },
    });
  });
}

/** Объединение: закупки и тексты `from` переезжают в `into`, имя и алиасы `from` становятся алиасами `into`, запись `from` удаляется. */
export async function mergeAuctionsIn(db: Full, orgId: string, fromId: string, intoId: string) {
  if (!intoId || fromId === intoId) throw new AuctionError("Выберите другой аукцион, с которым объединить");
  return db.$transaction(async (tx) => {
    const [from, into] = await Promise.all([
      tx.auction.findFirst({ where: { id: fromId, organizationId: orgId } }),
      tx.auction.findFirst({ where: { id: intoId, organizationId: orgId } }),
    ]);
    if (!from || !into) throw new AuctionError("Аукцион не найден");
    const keys = auctionKeys(from);
    const moved = await tx.purchase.updateMany({ where: { organizationId: orgId, auctionId: fromId }, data: { auctionId: intoId } });
    const synced = await syncAuctionTexts(tx, orgId, intoId, new Set([...keys, ...auctionKeys(into)]), into.name);
    await tx.auction.update({ where: { id: intoId }, data: { aliases: mergeAliases(into.aliases, [from.name, ...from.aliases], into.name), isService: into.isService && from.isService } });
    await tx.auction.delete({ where: { id: fromId } });
    return { from, into, moved: moved.count, synced };
  });
}

/** Удалить пустой аукцион (без закупок). */
export async function deleteAuctionIn(db: Full, orgId: string, id: string) {
  const a = await db.auction.findFirst({ where: { id, organizationId: orgId }, include: { _count: { select: { purchases: true } } } });
  if (!a) throw new AuctionError("Аукцион не найден");
  if (a._count.purchases > 0) throw new AuctionError(`К «${a.name}» привязано закупок: ${a._count.purchases}. Объедините с другим аукционом.`);
  await db.auction.delete({ where: { id } });
  return a;
}

/** Привязать закупки без аукциона по тексту auctionSession. Возвращает число привязанных. */
export async function linkPurchasesByText(db: Db, orgId: string): Promise<number> {
  const list = await db.auction.findMany({ where: { organizationId: orgId } });
  const ps = await db.purchase.findMany({ where: { organizationId: orgId, auctionId: null, auctionSession: { not: null } }, select: { id: true, auctionSession: true } });
  let n = 0;
  for (const p of ps) {
    const a = findAuctionIn(p.auctionSession, list);
    if (!a) continue;
    await db.purchase.update({ where: { id: p.id }, data: { auctionId: a.id } });
    n++;
  }
  return n;
}
