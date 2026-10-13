import "server-only";
import { storedFileExists } from "@/lib/stored-file-check";
import type { PrismaClient } from "@prisma/client";
import { DRIVE_DOC_TYPES, DRIVE_DOC_TYPE_LABELS, type DriveDocTypeKey } from "@/lib/drive-docs";

/**
 * Общий список документов для блока «Все документы» на странице /documents:
 * ссылки Google Drive (DriveDocument) и файлы закупок (PurchaseDocument).
 * Строка списка = одна привязка (один файл Drive, привязанный к трём сущностям, — три строки).
 */

export type DocLinkKind = "purchase" | "auction" | "lot" | "tz" | "batch" | "payment" | "prodPayment" | "client" | "supplier";
export const DOC_LINK_LABELS: Record<DocLinkKind, string> = {
  purchase: "Закупка",
  auction: "Партия закупок (аукцион)",
  lot: "Лот",
  tz: "ТЗ",
  batch: "Партия производства",
  payment: "Оплата поставщику",
  prodPayment: "Оплата производства",
  client: "Заказчик",
  supplier: "Поставщик",
};

export type DocListItem = {
  id: string;
  source: "drive" | "app";
  title: string;
  docType: DriveDocTypeKey;
  number: string | null;
  date: Date | null;
  year: number | null;
  hasOriginal: boolean;
  /** Размер файла в байтах (если известен): часть ключа схлопывания одинаковых файлов. */
  size: number | null;
  /** Ссылка «открыть документ» (файл приложения или Drive) или null, если открыть нечем. */
  openHref: string | null;
  links: { kind: DocLinkKind; label: string; href: string }[];
};

export type DocListFilters = {
  q: string;
  /** Мультивыбор типов документа; пусто — все. */
  type: DriveDocTypeKey[];
  year: number | null;
  /** Мультивыбор привязки (none — не привязан); пусто — любая. */
  link: Array<DocLinkKind | "none">;
  page: number;
};

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : "");
const many = (v: string | string[] | undefined): string[] => Array.from(new Set((Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => String(x).trim()).filter(Boolean))).slice(0, 60);

export function parseDocListFilters(sp: Record<string, string | string[] | undefined>): DocListFilters {
  const year = parseInt(one(sp.dyear), 10);
  const page = parseInt(one(sp.page) || one(sp.dpage), 10);
  return {
    // Один поиск `q` (прежнее имя `dq` читается как псевдоним).
    q: (one(sp.q) || one(sp.dq)).trim().slice(0, 100),
    type: many(sp.dtype).filter((t): t is DriveDocTypeKey => (DRIVE_DOC_TYPES as readonly string[]).includes(t)),
    year: Number.isFinite(year) ? year : null,
    link: many(sp.dlink).filter((l): l is DocLinkKind | "none" => l === "none" || l in DOC_LINK_LABELS),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

const PURCHASE_KIND_TO_TYPE: Record<string, DriveDocTypeKey> = {
  AUCTION_INVOICE: "AUCTION_INVOICE",
  SPECIFICATION: "SPECIFICATION",
  ADVANCE_INVOICE: "PAYMENT_INVOICE",
  CALC_SHEET: "CALC_SHEET",
  UPD: "UPD",
  PAYMENT_PROOF: "PAYMENT_PROOF",
  OTHER: "OTHER",
};

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

export async function loadDocList(db: PrismaClient, organizationId: string): Promise<DocListItem[]> {
  const [drive, app] = await Promise.all([
    db.driveDocument.findMany({
      where: { organizationId },
      select: {
        id: true, title: true, docType: true, docNumber: true, docDate: true, year: true, storagePath: true, viewUrl: true, createdAt: true, sizeBytes: true, storedSize: true,
        purchase: { select: { id: true, number: true } },
        lot: { select: { purchaseId: true, lotNumber: true } },
        productionOrder: { select: { id: true, number: true } },
        productionBatch: { select: { number: true } },
        payment: { select: { id: true, purchaseId: true, auctionSession: true, supplier: { select: { name: true } } } },
        productionPayment: { select: { id: true, client: { select: { name: true } }, orders: { select: { productionOrderId: true }, take: 1 } } },
        client: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
    }),
    db.purchaseDocument.findMany({
      where: { organizationId },
      select: { id: true, title: true, kind: true, batch: true, createdAt: true, sizeBytes: true, purchase: { select: { id: true, number: true } } },
    }),
  ]);

  const items: DocListItem[] = [];
  for (const d of drive) {
    const links: DocListItem["links"] = [];
    if (d.purchase) links.push({ kind: "purchase", label: `Закупка ${d.purchase.number}`, href: `/purchases/${d.purchase.id}` });
    if (d.lot) links.push({ kind: "lot", label: `Лот${d.lot.lotNumber ? ` ${d.lot.lotNumber}` : ""}`, href: d.lot.purchaseId ? `/purchases/${d.lot.purchaseId}` : "/lots" });
    if (d.productionOrder) links.push({ kind: "tz", label: `ТЗ ${d.productionOrder.number}`, href: `/production/${d.productionOrder.id}` });
    if (d.productionBatch) links.push({ kind: "batch", label: `Партия ${d.productionBatch.number}`, href: `/production/batches/${d.productionBatch.number}` });
    if (d.payment) links.push({ kind: "payment", label: `Оплата · ${d.payment.supplier.name}`, href: d.payment.purchaseId ? `/purchases/${d.payment.purchaseId}` : "/payments" });
    if (d.productionPayment) {
      const o = d.productionPayment.orders[0]?.productionOrderId;
      links.push({ kind: "prodPayment", label: `Оплата · ${d.productionPayment.client?.name ?? "заказчик"}`, href: o ? `/production/${o}` : "/production" });
    }
    if (d.client) links.push({ kind: "client", label: `Заказчик «${d.client.name}»`, href: `/clients/${d.client.id}` });
    if (d.supplier) links.push({ kind: "supplier", label: `Поставщик «${d.supplier.name}»`, href: `/suppliers/${d.supplier.id}` });
    const date = d.docDate;
    items.push({
      id: `d-${d.id}`, source: "drive", title: d.title, docType: d.docType, number: d.docNumber, date,
      year: d.year ?? (date ? date.getUTCFullYear() : null),
      hasOriginal: storedFileExists(d.storagePath),
      size: d.sizeBytes ?? d.storedSize,
      openHref: storedFileExists(d.storagePath) ? `/api/drive-docs/${d.id}` : null,
      links,
    });
  }
  for (const d of app) {
    const links: DocListItem["links"] = d.purchase
      ? [{ kind: "purchase", label: `Закупка ${d.purchase.number}`, href: `/purchases/${d.purchase.id}` }]
      : d.batch
        ? [{ kind: "auction", label: `Аукцион ${d.batch.split(/\r?\n/)[0].trim()}`, href: `/payments?auction=${encodeURIComponent(d.batch.split(/\r?\n/)[0].trim())}#auction-block` }]
        : [];
    items.push({
      id: `a-${d.id}`, source: "app", title: d.title, docType: PURCHASE_KIND_TO_TYPE[d.kind] ?? "OTHER", number: null, date: null,
      year: d.createdAt.getUTCFullYear(), hasOriginal: true, size: d.sizeBytes, openHref: `/api/purchase-docs/${d.id}`, links,
    });
  }
  return items;
}

export function filterDocList(items: DocListItem[], f: DocListFilters, ignore?: "type"): DocListItem[] {
  const q = norm(f.q);
  return items.filter((i) => {
    if (q && !norm(`${i.title} ${i.number ?? ""}`).includes(q)) return false;
    if (ignore !== "type" && f.type.length && !f.type.includes(i.docType)) return false;
    if (f.year !== null && i.year !== f.year) return false;
    if (f.link.length) {
      const ok = (f.link.includes("none") && i.links.length === 0) || i.links.some((l) => (f.link as string[]).includes(l.kind));
      if (!ok) return false;
    }
    return true;
  });
}

export const DOC_PAGE_SIZE = 50;
export { DRIVE_DOC_TYPE_LABELS };

/** Одно название подряд — одна строка: файл, привязанный (или загруженный) к нескольким записям, показывается один раз с «×N». */
export type DocGroup = Omit<DocListItem, "id" | "links" | "source"> & {
  key: string;
  count: number;
  /** Привязки всех строк группы (без повторов), в порядке следования. */
  links: DocListItem["links"];
  /** Сколько строк группы вообще без привязки. */
  unlinked: number;
};

/** Ключ схлопывания: название без пробелов и регистра + тип + размер. */
export const docGroupKey = (i: Pick<DocListItem, "title" | "docType" | "size">) =>
  `${norm(i.title).replace(/\s+/g, "")}|${i.docType}|${i.size ?? ""}`;

export function groupDocList(items: DocListItem[]): DocGroup[] {
  const map = new Map<string, DocGroup>();
  for (const i of items) {
    const key = docGroupKey(i);
    let g = map.get(key);
    if (!g) {
      g = { key, title: i.title, docType: i.docType, number: i.number, date: i.date, year: i.year, hasOriginal: i.hasOriginal, size: i.size, openHref: i.openHref, count: 0, links: [], unlinked: 0 };
      map.set(key, g);
    }
    g.count++;
    if (i.links.length === 0) g.unlinked++;
    g.hasOriginal ||= i.hasOriginal;
    g.openHref ??= i.openHref;
    g.number ??= i.number;
    g.date ??= i.date;
    for (const l of i.links) if (!g.links.some((x) => x.kind === l.kind && x.label === l.label && x.href === l.href)) g.links.push(l);
  }
  return Array.from(map.values());
}
