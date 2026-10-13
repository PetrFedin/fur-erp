import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DRIVE_DOC_TYPE_LABELS, type DriveDocTypeKey } from "@/lib/drive-docs";
import { stripServiceTags } from "@/lib/note-tags";
import { DOC_KIND_LABELS } from "@/lib/purchase-files";
import { existingStoredPaths, storedFileExists } from "@/lib/stored-file-check";

/**
 * Документы, прикреплённые к строкам: единый источник для значка «📎 N» и окна DocViewer.
 * Две таблицы: DriveDocument (1 файл = 1 строка привязки; один driveFileId может висеть на нескольких
 * сущностях) и PurchaseDocument (файлы, загруженные в приложение: к закупке или к партии-аукциону).
 * Внешние ссылки в интерфейс не отдаём — только то, что хранится в приложении.
 */

export type DocEntity = "purchase" | "lot" | "payment" | "productionPayment" | "order" | "batch";
export const DOC_ENTITIES: readonly DocEntity[] = ["purchase", "lot", "payment", "productionPayment", "order", "batch"];

const DRIVE_COL: Record<DocEntity, string> = {
  purchase: "purchaseId",
  lot: "lotId",
  payment: "paymentId",
  productionPayment: "productionPaymentId",
  order: "productionOrderId",
  batch: "productionBatchId",
};

export type DocItem = {
  /** "d:<id>" — DriveDocument, "p:<id>" — PurchaseDocument. */
  key: string;
  src: "drive" | "purchase";
  id: string;
  title: string;
  typeLabel: string;
  number: string | null;
  date: string | null;
  /** Размер в байтах (если известен). */
  size: number | null;
  mime: string | null;
  hasFile: boolean;
  /** Откуда документ: «Закупка», «Партия СП 09-26» … (если не сама строка). */
  scope: string | null;
  /** Куда ведёт файл (защищённый route handler). */
  fileUrl: string | null;
};

/** Родитель-закупка для сущности: нужен, чтобы показать документы закупки/аукциона у лота. */
async function purchaseOf(entity: DocEntity, id: string, orgId: string) {
  if (entity === "purchase") return prisma.purchase.findFirst({ where: { id, organizationId: orgId }, select: { id: true, auctionSession: true } });
  if (entity === "lot") {
    const lot = await prisma.rawMaterialLot.findFirst({ where: { id, organizationId: orgId }, select: { purchase: { select: { id: true, auctionSession: true } } } });
    return lot?.purchase ?? null;
  }
  return null;
}

/**
 * Партия: документы самой партии + её ТЗ + оплат этих ТЗ (как на карточке партии).
 * Возвращает по каждой партии id её ТЗ (с подписью) и id оплат.
 */
async function batchScopes(orgId: string, batchIds: string[]) {
  const orders = await prisma.productionOrder.findMany({
    where: { organizationId: orgId, batchId: { in: batchIds } },
    select: { id: true, batchId: true, number: true, workOrderNumber: true },
  });
  const allocs = orders.length
    ? await prisma.paymentAllocation.findMany({ where: { organizationId: orgId, productionOrderId: { in: orders.map((o) => o.id) } }, select: { productionOrderId: true, productionPaymentId: true } })
    : [];
  const out = new Map<string, { orders: Map<string, string>; payIds: Set<string> }>();
  for (const b of batchIds) out.set(b, { orders: new Map(), payIds: new Set() });
  const batchOfOrder = new Map<string, string>();
  for (const o of orders) {
    if (!o.batchId) continue;
    batchOfOrder.set(o.id, o.batchId);
    out.get(o.batchId)?.orders.set(o.id, `ТЗ №${o.workOrderNumber ?? o.number}`);
  }
  for (const a of allocs) {
    const b = batchOfOrder.get(a.productionOrderId);
    if (b) out.get(b)?.payIds.add(a.productionPaymentId);
  }
  return out;
}

export async function listDocs(orgId: string, entity: DocEntity, id: string): Promise<DocItem[]> {
  const col = DRIVE_COL[entity];
  const own = await prisma.driveDocument.findMany({
    where: { organizationId: orgId, [col]: id },
    orderBy: [{ docDate: "asc" }, { title: "asc" }],
  });
  const batchScope = entity === "batch" ? (await batchScopes(orgId, [id])).get(id) : undefined;
  const viaBatch = batchScope
    ? await prisma.driveDocument.findMany({
        where: {
          organizationId: orgId,
          OR: [
            ...(batchScope.orders.size ? [{ productionOrderId: { in: [...batchScope.orders.keys()] } }] : []),
            ...(batchScope.payIds.size ? [{ productionPaymentId: { in: [...batchScope.payIds] } }] : []),
          ],
        },
        orderBy: [{ docDate: "asc" }, { title: "asc" }],
      })
    : [];
  const purchase = await purchaseOf(entity, id, orgId);
  const viaPurchase =
    entity === "lot" && purchase
      ? await prisma.driveDocument.findMany({ where: { organizationId: orgId, purchaseId: purchase.id }, orderBy: [{ docDate: "asc" }, { title: "asc" }] })
      : [];
  const pdocs = purchase
    ? await prisma.purchaseDocument.findMany({
        where: {
          organizationId: orgId,
          OR: [{ purchaseId: purchase.id }, ...(purchase.auctionSession ? [{ purchaseId: null, batch: purchase.auctionSession }] : [])],
        },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const out: DocItem[] = [];
  const seen = new Set<string>();
  const addDrive = (d: (typeof own)[number], scope: string | null) => {
    // Один и тот же файл Drive на строке и на её закупке показываем один раз.
    const dedupe = `${d.driveFileId}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push({
      key: `d:${d.id}`,
      src: "drive",
      id: d.id,
      title: stripServiceTags(d.title),
      typeLabel: DRIVE_DOC_TYPE_LABELS[d.docType as DriveDocTypeKey] ?? d.docType,
      number: d.docNumber,
      date: d.docDate ? d.docDate.toISOString().slice(0, 10) : null,
      size: d.storedSize ?? d.sizeBytes,
      mime: d.storedMime,
      hasFile: storedFileExists(d.storagePath),
      scope,
      fileUrl: storedFileExists(d.storagePath) ? `/api/drive-docs/${d.id}` : null,
    });
  };
  own.forEach((d) => addDrive(d, null));
  viaPurchase.forEach((d) => addDrive(d, "Закупка"));
  viaBatch.forEach((d) => addDrive(d, d.productionOrderId ? (batchScope?.orders.get(d.productionOrderId) ?? "ТЗ") : "оплата"));
  for (const p of pdocs) {
    out.push({
      key: `p:${p.id}`,
      src: "purchase",
      id: p.id,
      title: p.title || p.originalName,
      typeLabel: DOC_KIND_LABELS[p.kind] ?? p.kind,
      number: null,
      date: p.createdAt.toISOString().slice(0, 10),
      size: p.sizeBytes,
      mime: p.mimeType,
      hasFile: storedFileExists(p.storagePath),
      scope: p.purchaseId ? (entity === "purchase" ? null : "Закупка") : `Партия ${p.batch ?? ""}`.trim(),
      fileUrl: storedFileExists(p.storagePath) ? `/api/purchase-docs/${p.id}` : null,
    });
  }
  return out;
}

export type DocCount = { total: number; stored: number };

/** Счётчики для набора строк одним батчем: id → {всего документов, из них с файлом в приложении}. */
export async function docCounts(orgId: string, entity: DocEntity, ids: string[]): Promise<Map<string, DocCount>> {
  const res = new Map<string, DocCount>();
  if (ids.length === 0) return res;
  if (entity === "batch") {
    const scopes = await batchScopes(orgId, ids);
    const orderIds = [...scopes.values()].flatMap((x) => [...x.orders.keys()]);
    const payIds = [...new Set([...scopes.values()].flatMap((x) => [...x.payIds]))];
    const rows = await prisma.driveDocument.findMany({
      where: {
        organizationId: orgId,
        OR: [{ productionBatchId: { in: ids } }, ...(orderIds.length ? [{ productionOrderId: { in: orderIds } }] : []), ...(payIds.length ? [{ productionPaymentId: { in: payIds } }] : [])],
      },
      select: { driveFileId: true, storagePath: true, productionBatchId: true, productionOrderId: true, productionPaymentId: true },
    });
    for (const [bid, sc] of scopes) {
      const files = new Map<string, boolean>();
      for (const d of rows) {
        const mine = d.productionBatchId === bid || (d.productionOrderId != null && sc.orders.has(d.productionOrderId)) || (d.productionPaymentId != null && sc.payIds.has(d.productionPaymentId));
        if (mine) files.set(d.driveFileId, (files.get(d.driveFileId) ?? false) || storedFileExists(d.storagePath));
      }
      if (files.size) res.set(bid, { total: files.size, stored: [...files.values()].filter(Boolean).length });
    }
    return res;
  }
  const col = Prisma.raw(`"${DRIVE_COL[entity]}"`);
  // «С файлом» — только пути, которые реально лежат на диске (пустой массив: ни одного файла).
  const okPaths = await existingStoredPaths();
  const rows =
    entity === "lot"
      ? await prisma.$queryRaw<{ id: string; total: bigint; stored: bigint }[]>`
    select l.id as id, count(distinct d."driveFileId") as total, count(distinct d."driveFileId") filter (where d."storagePath" = any(${okPaths}::text[])) as stored
    from "RawMaterialLot" l join "DriveDocument" d on d."lotId" = l.id or (l."purchaseId" is not null and d."purchaseId" = l."purchaseId")
    where l."organizationId" = ${orgId} and d."organizationId" = ${orgId} and l.id in (${Prisma.join(ids)}) group by l.id`
      : await prisma.$queryRaw<{ id: string; total: bigint; stored: bigint }[]>`
    select ${col} as id, count(distinct "driveFileId") as total, count(distinct "driveFileId") filter (where "storagePath" = any(${okPaths}::text[])) as stored
    from "DriveDocument" where "organizationId" = ${orgId} and ${col} in (${Prisma.join(ids)}) group by ${col}`;
  for (const r of rows) res.set(r.id, { total: Number(r.total), stored: Number(r.stored) });
  if (entity === "purchase" || entity === "lot") {
    const ps =
      entity === "purchase"
        ? await prisma.purchase.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true, auctionSession: true } })
        : (await prisma.rawMaterialLot.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true, purchase: { select: { auctionSession: true, id: true } } } })).map((l) => ({
            id: l.id,
            auctionSession: l.purchase?.auctionSession ?? null,
            purchaseId: l.purchase?.id ?? null,
          }));
    const pIds = [...new Set(ps.map((p) => ("purchaseId" in p ? p.purchaseId : p.id)).filter((x): x is string => !!x))];
    const sessions = [...new Set(ps.map((p) => p.auctionSession).filter((x): x is string => !!x))];
    const [byPurchase, bySession] = await Promise.all([
      pIds.length ? prisma.purchaseDocument.findMany({ where: { organizationId: orgId, purchaseId: { in: pIds } }, select: { purchaseId: true, storagePath: true } }) : [],
      sessions.length ? prisma.purchaseDocument.findMany({ where: { organizationId: orgId, purchaseId: null, batch: { in: sessions } }, select: { batch: true, storagePath: true } }) : [],
    ]);
    type PC = { total: number; stored: number };
    const pc = new Map<string | null, PC>();
    const sc = new Map<string | null, PC>();
    const bump = (m: Map<string | null, PC>, k: string | null, path: string) => {
      const c = m.get(k) ?? { total: 0, stored: 0 };
      c.total++;
      if (storedFileExists(path)) c.stored++;
      m.set(k, c);
    };
    byPurchase.forEach((r) => bump(pc, r.purchaseId, r.storagePath));
    bySession.forEach((r) => bump(sc, r.batch, r.storagePath));
    for (const p of ps) {
      const pid = ("purchaseId" in p ? p.purchaseId : p.id) as string | null;
      const a = pid ? pc.get(pid) : undefined;
      const b = p.auctionSession ? sc.get(p.auctionSession) : undefined;
      const extra = (a?.total ?? 0) + (b?.total ?? 0);
      if (!extra) continue;
      const cur = res.get(p.id) ?? { total: 0, stored: 0 };
      res.set(p.id, { total: cur.total + extra, stored: cur.stored + (a?.stored ?? 0) + (b?.stored ?? 0) });
    }
  }
  return res;
}
