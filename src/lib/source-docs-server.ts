import "server-only";
import { storedFileExists } from "@/lib/stored-file-check";
import { prisma } from "@/lib/prisma";
import { ACCESS, hasRole } from "@/lib/access";
import { PRODUCTION_EDIT_ROLES } from "@/lib/production-access";
import { PURCHASE_KIND_TO_TYPE } from "@/lib/doc-coverage";
import { DRIVE_DOC_TYPE_LABELS, type DriveDocTypeKey } from "@/lib/drive-docs";
import { stripServiceTags } from "@/lib/note-tags";
import { formatMb } from "@/lib/format-mb";
import { formatDate } from "@/lib/utils";
import {
  extractDocRefs,
  matchRefs,
  refFromField,
  refKey,
  type DocRef,
  type PoolDoc,
  type SourceDocFile,
  type SourceDocRow,
  type SourceDocsData,
  type SourceTarget,
} from "@/lib/source-docs";

/**
 * «Документы-основания»: собирает для карточки список документов, названных в данных (номера УПД, счетов, спецификаций,
 * приложений, платёжек), и отмечает, какие уже загружены. Загрузка — существующие server actions
 * (uploadDriveDocument / uploadDriveDocumentFile / replacePurchaseDocument), здесь только чтение.
 */

type Role = string | undefined | null;
export type SourceSession = { organizationId: string; role: Role };

/** Кто может загружать документы к какой сущности — те же роли, что в drive-actions.ts (UPLOAD_ROLES). */
const UPLOAD_ROLES: Record<SourceTarget["entity"], readonly string[]> = {
  purchase: ACCESS.purchases,
  order: PRODUCTION_EDIT_ROLES,
  batch: PRODUCTION_EDIT_ROLES,
  payment: ["OWNER", "ADMIN"],
  productionPayment: ["OWNER", "ADMIN"],
};
const can = (role: Role, t: SourceTarget) => hasRole(role, UPLOAD_ROLES[t.entity]);

type DriveRow = {
  id: string;
  title: string;
  docType: DriveDocTypeKey;
  docNumber: string | null;
  docDate: Date | null;
  storagePath: string | null;
  storedName: string | null;
  storedMime: string | null;
  storedSize: number | null;
  driveFileId: string;
};

const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sizeText = (n: number | null | undefined) => (n ? `${formatMb(n)} МБ` : "");

function fromDrive(d: DriveRow): PoolDoc {
  const file: SourceDocFile | null = storedFileExists(d.storagePath)
    ? {
        id: d.id,
        src: "drive",
        title: stripServiceTags(d.storedName || d.title),
        meta: [DRIVE_DOC_TYPE_LABELS[d.docType], d.docDate ? formatDate(d.docDate) : null, sizeText(d.storedSize)].filter(Boolean).join(" · "),
        href: `/api/drive-docs/${d.id}`,
        mime: d.storedMime,
        keepsRecord: !d.driveFileId.startsWith("local-"),
      }
    : null;
  return { file, recordId: d.id, src: "drive", docType: d.docType, number: d.docNumber, date: isoDay(d.docDate), title: d.title };
}

type PurchaseDocRow = { id: string; storagePath: string; kind: string; title: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: Date };
function fromPurchaseDoc(d: PurchaseDocRow): PoolDoc {
  const docType = PURCHASE_KIND_TO_TYPE[d.kind] ?? "OTHER";
  return {
    file: !storedFileExists(d.storagePath) ? null : {
      id: d.id,
      src: "purchase",
      title: d.title || d.originalName,
      meta: [DRIVE_DOC_TYPE_LABELS[docType], formatDate(d.createdAt), sizeText(d.sizeBytes)].filter(Boolean).join(" · "),
      href: `/api/purchase-docs/${d.id}`,
      mime: d.mimeType,
      keepsRecord: false,
    },
    recordId: d.id,
    src: "purchase",
    docType,
    number: null,
    date: null,
    title: `${d.title} ${d.originalName}`,
  };
}

const DRIVE_SELECT = { id: true, title: true, docType: true, docNumber: true, docDate: true, storagePath: true, storedName: true, storedMime: true, storedSize: true, driveFileId: true } as const;

type RefSrc = { ref: DocRef; origin: string; target: SourceTarget };

/** Упоминания → строки блока (в порядке упоминания), затем приложенные файлы, которые ни под одно упоминание не подошли. */
function buildRows(session: SourceSession, refs: RefSrc[], pool: PoolDoc[], ownTarget: SourceTarget | null, withExtras: boolean): { rows: SourceDocRow[]; hiddenLinks: number } {
  // Одинаковые упоминания (тот же вид+номер) в разных полях — одной строкой; первое поле остаётся источником.
  const firstOf = new Map<string, RefSrc>();
  const order: DocRef[] = [];
  for (const r of refs) {
    const k = refKey(r.ref);
    if (firstOf.has(k)) continue;
    firstOf.set(k, r);
    order.push(r.ref);
  }
  const { results, unclaimed } = matchRefs(order, pool);
  const rows: SourceDocRow[] = results.map(({ ref, matched }) => {
    const src = firstOf.get(refKey(ref))!;
    const withFile = matched.filter((m) => m.file);
    const linkOnly = matched.find((m) => !m.file && m.src === "drive");
    return {
      key: `r:${ref.docType}|${ref.number ?? ""}|${ref.date ?? ""}`,
      label: ref.label,
      docType: ref.docType,
      number: ref.number,
      date: ref.date,
      origin: src.origin,
      expected: true,
      files: withFile.map((m) => m.file!),
      linkId: linkOnly?.recordId ?? null,
      target: src.target,
      canUpload: can(session.role, src.target),
    };
  });
  const extra = withExtras ? unclaimed.filter((d) => d.file) : [];
  for (const d of extra) {
    rows.push({
      key: `x:${d.src}:${d.recordId}`,
      label: stripServiceTags(d.file!.title),
      docType: d.docType,
      number: d.number,
      date: d.date,
      origin: "приложен, в данных не упомянут",
      expected: false,
      files: [d.file!],
      linkId: null,
      target: ownTarget ?? { entity: "purchase", id: "" },
      canUpload: !!ownTarget && can(session.role, ownTarget),
    });
  }
  // Ключи строк уникальны: два упоминания одного вида и номера в разной записи (например, «№ 5» и «№5/1» с общей датой) не дают одинаковый key в React.
  const seenKeys = new Map<string, number>();
  for (const r of rows) {
    const n = (seenKeys.get(r.key) ?? 0) + 1;
    seenKeys.set(r.key, n);
    if (n > 1) r.key = `${r.key}#${n}`;
  }
  return { rows, hiddenLinks: withExtras ? unclaimed.filter((d) => !d.file).length : 0 };
}

function finish(session: SourceSession, refs: RefSrc[], pool: PoolDoc[], target: SourceTarget | null, withExtras = true): SourceDocsData {
  const { rows, hiddenLinks } = buildRows(session, refs, pool, target, withExtras);
  return { rows, target, canUpload: !!target && can(session.role, target), hiddenLinks };
}

const fieldRef = (type: DriveDocTypeKey, v: string | null | undefined, origin: string, target: SourceTarget): RefSrc[] => {
  const r = refFromField(type, v);
  return r ? [{ ref: r, origin, target }] : [];
};
const textRefs = (v: string | null | undefined, origin: string, target: SourceTarget): RefSrc[] => extractDocRefs(v).map((ref) => ({ ref, origin, target }));

/** Основание оплаты («п/п №…; счёт №…») — документы, на которые оплата опирается. */
const payRefs = (docRef: string | null, paidAt: Date, target: SourceTarget): RefSrc[] =>
  textRefs(docRef, `Оплата ${formatDate(paidAt)} · основание`, target);

// ------------------------------------------------------------------------------------------------ закупка

async function purchaseRefsAndPool(orgId: string, purchaseIds: string[]) {
  const purchases = await prisma.purchase.findMany({
    where: { organizationId: orgId, id: { in: purchaseIds } },
    select: {
      id: true,
      number: true,
      invoiceNumber: true,
      transferDocument: true,
      notes: true,
      auctionSession: true,
      items: { select: { lotId: true } },
      payments: { select: { id: true, docRef: true, paidAt: true, documentId: true } },
    },
    orderBy: { number: "asc" },
  });
  const lotIds = purchases.flatMap((p) => p.items.map((i) => i.lotId)).filter((x): x is string => !!x);
  const payIds = purchases.flatMap((p) => p.payments.map((x) => x.id));
  const sessions = [...new Set(purchases.map((p) => p.auctionSession?.split(/\r?\n/)[0].trim()).filter((x): x is string => !!x))];
  const [drive, pdocs] = await Promise.all([
    prisma.driveDocument.findMany({
      where: { organizationId: orgId, OR: [{ purchaseId: { in: purchaseIds } }, ...(lotIds.length ? [{ lotId: { in: lotIds } }] : []), ...(payIds.length ? [{ paymentId: { in: payIds } }] : [])] },
      select: DRIVE_SELECT,
      orderBy: [{ docDate: "asc" }, { createdAt: "asc" }],
    }),
    prisma.purchaseDocument.findMany({
      where: { organizationId: orgId, OR: [{ purchaseId: { in: purchaseIds } }, ...(sessions.length ? [{ purchaseId: null, batch: { in: sessions } }] : [])] },
      select: { id: true, storagePath: true, kind: true, title: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  // Одно и то же упоминание на нескольких закупках аукциона — не размножаем: ключ вида+номера сводит их в одну строку.
  const refs: RefSrc[] = [];
  for (const p of purchases) {
    const t: SourceTarget = { entity: "purchase", id: p.id };
    const tag = purchases.length > 1 ? `Закупка ${p.number}` : "Закупка";
    refs.push(...fieldRef("AUCTION_INVOICE", p.invoiceNumber, `${tag} · номер счёта`, t));
    refs.push(...fieldRef("UPD", p.transferDocument, `${tag} · документ передачи (УПД)`, t));
    refs.push(...textRefs(p.notes, `${tag} · примечание`, t));
    for (const x of p.payments) refs.push(...payRefs(x.docRef, x.paidAt, { entity: "payment", id: x.id }));
  }
  return { refs, pool: [...drive.map(fromDrive), ...pdocs.map(fromPurchaseDoc)] };
}

export async function loadPurchaseSourceDocs(session: SourceSession, purchaseId: string): Promise<SourceDocsData> {
  const { refs, pool } = await purchaseRefsAndPool(session.organizationId, [purchaseId]);
  return finish(session, refs, pool, { entity: "purchase", id: purchaseId });
}

/** Несколько закупок сразу (страница партии подкладки, аукцион): общий блок, общего «вообще» загружаемого адреса нет. */
export async function loadPurchasesSourceDocs(session: SourceSession, purchaseIds: string[]): Promise<SourceDocsData> {
  if (purchaseIds.length === 0) return { rows: [], target: null, canUpload: false, hiddenLinks: 0 };
  const { refs, pool } = await purchaseRefsAndPool(session.organizationId, purchaseIds);
  return finish(session, refs, pool, purchaseIds.length === 1 ? { entity: "purchase", id: purchaseIds[0] } : null);
}

// ------------------------------------------------------------------------------------------------ производство

async function productionPool(orgId: string, orderIds: string[], batchIds: string[], payIds: string[]) {
  const drive = await prisma.driveDocument.findMany({
    where: {
      organizationId: orgId,
      OR: [
        ...(orderIds.length ? [{ productionOrderId: { in: orderIds } }] : []),
        ...(batchIds.length ? [{ productionBatchId: { in: batchIds } }] : []),
        ...(payIds.length ? [{ productionPaymentId: { in: payIds } }] : []),
      ],
    },
    select: DRIVE_SELECT,
    orderBy: [{ docDate: "asc" }, { createdAt: "asc" }],
  });
  return drive.map(fromDrive);
}

type OrderRow = { id: string; number: string; contractNumber: string | null; workOrderNumber: string | null; notes: string | null };
function orderRefs(o: OrderRow, tag: string): RefSrc[] {
  const t: SourceTarget = { entity: "order", id: o.id };
  const refs: RefSrc[] = [];
  refs.push(...fieldRef("CONTRACT", o.contractNumber, `${tag} · договор`, t));
  if (o.workOrderNumber) {
    const n = o.workOrderNumber.trim();
    refs.push({ ref: { docType: "TZ_APPENDIX", number: n, date: null, label: `Приложение к договору №${n}` }, origin: `ТЗ ${o.number} · номер ТЗ (приложение к договору)`, target: t });
  }
  refs.push(...textRefs(o.notes, `ТЗ ${o.number} · примечание`, t));
  return refs;
}

export async function loadBatchSourceDocs(session: SourceSession, batchId: string): Promise<SourceDocsData> {
  const orgId = session.organizationId;
  const batch = await prisma.productionBatch.findFirst({ where: { id: batchId, organizationId: orgId }, select: { id: true, number: true, notes: true } });
  if (!batch) return { rows: [], target: null, canUpload: false, hiddenLinks: 0 };
  const orders = await prisma.productionOrder.findMany({
    where: { organizationId: orgId, batchId },
    select: { id: true, number: true, contractNumber: true, workOrderNumber: true, notes: true },
    orderBy: { number: "asc" },
  });
  const allocs = orders.length
    ? await prisma.paymentAllocation.findMany({ where: { organizationId: orgId, productionOrderId: { in: orders.map((o) => o.id) } }, select: { productionPaymentId: true } })
    : [];
  const payIds = [...new Set(allocs.map((a) => a.productionPaymentId))];
  const pays = payIds.length ? await prisma.productionPayment.findMany({ where: { organizationId: orgId, id: { in: payIds } }, select: { id: true, docRef: true, paidAt: true }, orderBy: { paidAt: "asc" } }) : [];
  const t: SourceTarget = { entity: "batch", id: batchId };
  const refs: RefSrc[] = [...textRefs(batch.notes, `Партия ${batch.number} · примечание`, t)];
  // Заметки ТЗ со служебными метками импорта не разбираем — берём только договор и номер ТЗ.
  for (const o of orders) refs.push(...orderRefs({ ...o, notes: null }, `ТЗ ${o.number}`));
  for (const p of pays) refs.push(...payRefs(p.docRef, p.paidAt, { entity: "productionPayment", id: p.id }));
  const pool = await productionPool(orgId, orders.map((o) => o.id), [batchId], payIds);
  return finish(session, refs, pool, t);
}

export async function loadOrderSourceDocs(session: SourceSession, orderId: string): Promise<SourceDocsData> {
  const orgId = session.organizationId;
  const o = await prisma.productionOrder.findFirst({
    where: { id: orderId, organizationId: orgId },
    select: { id: true, number: true, contractNumber: true, workOrderNumber: true, notes: true, batchId: true, payShares: { select: { productionPaymentId: true } } },
  });
  if (!o) return { rows: [], target: null, canUpload: false, hiddenLinks: 0 };
  const payIds = [...new Set(o.payShares.map((a) => a.productionPaymentId))];
  const pays = payIds.length ? await prisma.productionPayment.findMany({ where: { organizationId: orgId, id: { in: payIds } }, select: { id: true, docRef: true, paidAt: true }, orderBy: { paidAt: "asc" } }) : [];
  const t: SourceTarget = { entity: "order", id: orderId };
  const refs: RefSrc[] = [...orderRefs({ ...o, notes: null }, `ТЗ ${o.number}`)];
  for (const p of pays) refs.push(...payRefs(p.docRef, p.paidAt, { entity: "productionPayment", id: p.id }));
  const pool = await productionPool(orgId, [orderId], o.batchId ? [o.batchId] : [], payIds);
  return finish(session, refs, pool, t);
}

// ------------------------------------------------------------------------------------------------ оплаты

/** Пакетно для страницы оплат: по каждой оплате — её основание и документы, уже приложенные к ней (и к закупке оплаты). */
export async function loadPaymentsSourceDocs(
  session: SourceSession,
  ids: { payments?: string[]; productionPayments?: string[] },
): Promise<Record<string, SourceDocsData>> {
  const orgId = session.organizationId;
  const out: Record<string, SourceDocsData> = {};
  const payIds = [...new Set(ids.payments ?? [])];
  const ppIds = [...new Set(ids.productionPayments ?? [])];
  const [pays, pps] = await Promise.all([
    payIds.length ? prisma.payment.findMany({ where: { organizationId: orgId, id: { in: payIds } }, select: { id: true, docRef: true, paidAt: true, purchaseId: true, documentId: true } }) : [],
    ppIds.length ? prisma.productionPayment.findMany({ where: { organizationId: orgId, id: { in: ppIds } }, select: { id: true, docRef: true, paidAt: true, allocations: { select: { productionOrderId: true } } } }) : [],
  ]);
  const purchaseIds = [...new Set(pays.map((p) => p.purchaseId).filter((x): x is string => !!x))];
  const orderIds = [...new Set(pps.flatMap((p) => p.allocations.map((a) => a.productionOrderId)))];
  const [drive, pdocs] = await Promise.all([
    prisma.driveDocument.findMany({
      where: {
        organizationId: orgId,
        OR: [
          ...(payIds.length ? [{ paymentId: { in: payIds } }] : []),
          ...(purchaseIds.length ? [{ purchaseId: { in: purchaseIds } }] : []),
          ...(ppIds.length ? [{ productionPaymentId: { in: ppIds } }] : []),
          ...(orderIds.length ? [{ productionOrderId: { in: orderIds } }] : []),
        ],
      },
      select: { ...DRIVE_SELECT, paymentId: true, purchaseId: true, productionPaymentId: true, productionOrderId: true },
    }),
    purchaseIds.length
      ? prisma.purchaseDocument.findMany({
          where: { organizationId: orgId, purchaseId: { in: purchaseIds } },
          select: { id: true, storagePath: true, kind: true, title: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true, purchaseId: true },
        })
      : [],
  ]);
  const ppOrders = new Map(pps.map((p) => [p.id, new Set(p.allocations.map((a) => a.productionOrderId))]));
  for (const p of pays) {
    const t: SourceTarget = { entity: "payment", id: p.id };
    const pool = [
      ...drive.filter((d) => d.paymentId === p.id || (p.purchaseId && d.purchaseId === p.purchaseId)).map(fromDrive),
      ...pdocs.filter((d) => p.purchaseId && d.purchaseId === p.purchaseId).map(fromPurchaseDoc),
    ];
    out[p.id] = finish(session, payRefs(p.docRef, p.paidAt, t), pool, t, false);
  }
  for (const p of pps) {
    const t: SourceTarget = { entity: "productionPayment", id: p.id };
    const oset = ppOrders.get(p.id) ?? new Set<string>();
    const pool = drive.filter((d) => d.productionPaymentId === p.id || (d.productionOrderId && oset.has(d.productionOrderId))).map(fromDrive);
    out[p.id] = finish(session, payRefs(p.docRef, p.paidAt, t), pool, t, false);
  }
  return out;
}
