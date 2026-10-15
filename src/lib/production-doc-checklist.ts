import { orderLabel } from "@/lib/order-label";
import { tzCountText, uniqueOrderCount } from "@/lib/tz-key";
import { storedFileExists } from "@/lib/stored-file-check";
import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma, PrismaClient } from "@prisma/client";
import { batchExtraName, batchOrderInclude, batchTotals, orderStat } from "@/lib/batch-stats";
import type { Commission4Mode } from "@/lib/commission4-mode";
import { batchRules, normTitle, paymentRules, tzRules, uniq, type CovDoc, type Need } from "@/lib/doc-coverage";
import { DRIVE_DOC_TYPE_LABELS, type DriveDocTypeKey } from "@/lib/drive-docs";
import { batchMentions, mentionDocText, mentionPayText, type MentionDocKind } from "@/lib/doc-mentions";
import { buildPanelPay, isManualRef, overallTone, payShort, type Panel, type PanelDoc, type PanelItem, type PanelMention, type PanelPay, type PanelPayment, type Tone, type UploadTarget } from "@/lib/doc-panel";
import { formatDate, formatMoney, formatPercent } from "@/lib/utils";

/**
 * ОДНА функция «что подгрузить и что оплачено» для производства: партия, ТЗ и список ТЗ.
 * Правила «какие документы нужны» — в doc-coverage (tzRules / batchRules / paymentRules), здесь они только применяются.
 * Оплата — подрядчику за работу (клиентская цена работы × количество), как в карточке партии (batchTotals):
 * одна оплата засчитывается партии один раз, даже если связана с несколькими ТЗ. Сумма по ТЗ в базе не хранится,
 * поэтому для ТЗ в партии показывается оплата партии.
 */

type Db = PrismaClient | Prisma.TransactionClient;

const KIND_TEXT: Record<string, string> = { ADVANCE: "Аванс", PARTIAL: "Доплата", FINAL: "Окончательная оплата" };
const PROOF_TYPES = paymentRules().PAYMENT!.accepts as DriveDocTypeKey[];
const MAX_MENTIONS = 6;

type OrderRow = Awaited<ReturnType<typeof loadRaw>>["orders"][number];
type DocRow = Awaited<ReturnType<typeof loadRaw>>["docs"][number];

async function loadRaw(db: Db, organizationId: string) {
  const [batches, orders, docs] = await Promise.all([
    db.productionBatch.findMany({ where: { organizationId }, orderBy: { number: "asc" } }),
    db.productionOrder.findMany({
      where: { organizationId },
      include: batchOrderInclude,
      orderBy: { createdAt: "asc" },
    }),
    db.driveDocument.findMany({
      where: { organizationId, OR: [{ productionBatchId: { not: null } }, { productionOrderId: { not: null } }, { productionPaymentId: { not: null } }] },
      select: {
        id: true, driveFileId: true, docType: true, title: true, viewUrl: true, storagePath: true, docNumber: true, docDate: true,
        productionBatchId: true, productionOrderId: true, productionPaymentId: true,
      },
      orderBy: [{ docDate: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  return { batches, orders, docs };
}

const orderTitle = (o: { workOrderNumber: string | null; number: string }) => orderLabel(o);

const toDoc = (d: DocRow): PanelDoc => ({
  id: d.id,
  title: d.title,
  meta: `${DRIVE_DOC_TYPE_LABELS[d.docType]}${d.docNumber ? ` №${d.docNumber}` : ""}${d.docDate ? ` · ${formatDate(d.docDate)}` : ""}${storedFileExists(d.storagePath) ? " · файл в приложении" : " · файл не загружен"}`,
  href: storedFileExists(d.storagePath) ? `/api/drive-docs/${d.id}` : null,
  replace: { action: "driveDoc", id: d.id },
});

const covDoc = (d: DocRow): CovDoc => ({ type: d.docType, keys: [`${d.docType}|t:${normTitle(d.title)}`, `${d.docType}|f:${d.driveFileId}`], original: storedFileExists(d.storagePath) });

/** Уникальные документы (один и тот же файл, привязанный несколько раз, считается один раз). */
function uniqueDocs(rows: DocRow[]): DocRow[] {
  const keep = new Set(uniq(rows.map(covDoc)).map((c) => c.keys[0]));
  const seen = new Set<string>();
  return rows.filter((d) => {
    const k = covDoc(d).keys[0];
    if (!keep.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export type Ctx = { c4Mode: Commission4Mode; canUpload: boolean; canMark: boolean };

type Model = {
  raw: Awaited<ReturnType<typeof loadRaw>>;
  ordersByBatch: Map<string, OrderRow[]>;
  docsByBatch: Map<string, DocRow[]>;
  docsByOrder: Map<string, DocRow[]>;
  docsByPayment: Map<string, DocRow[]>;
};

export async function loadProductionModel(db: Db, organizationId: string): Promise<Model> {
  const raw = await loadRaw(db, organizationId);
  const ordersByBatch = new Map<string, OrderRow[]>();
  for (const o of raw.orders) if (o.batchId) ordersByBatch.set(o.batchId, [...(ordersByBatch.get(o.batchId) ?? []), o]);
  const docsByBatch = new Map<string, DocRow[]>();
  const docsByOrder = new Map<string, DocRow[]>();
  const docsByPayment = new Map<string, DocRow[]>();
  const push = (m: Map<string, DocRow[]>, k: string | null, d: DocRow) => k && m.set(k, [...(m.get(k) ?? []), d]);
  for (const d of raw.docs) {
    push(docsByBatch, d.productionBatchId, d);
    push(docsByOrder, d.productionOrderId, d);
    push(docsByPayment, d.productionPaymentId, d);
  }
  return { raw, ordersByBatch, docsByBatch, docsByOrder, docsByPayment };
}

const rankNeed: Record<Need, number> = { na: 0, optional: 1, required: 2 };

type PayRowsResult = { rows: PanelPayment[]; noProof: number; paid: Decimal };

function paymentRowsOf(m: Model, orders: OrderRow[], rollbackOwner: string | null): PayRowsResult {
  const pays = new Map<string, OrderRow["paymentAllocations"][number]["productionPayment"]>();
  for (const o of orders) for (const a of o.paymentAllocations) if (a.productionPayment.status !== "CANCELLED") pays.set(a.productionPayment.id, a.productionPayment);
  const rows: PanelPayment[] = [];
  let noProof = 0;
  // Оплачено по этим ТЗ = суммы, РАЗНЕСЁННЫЕ на них (PaymentAllocation), а не валовая сумма платежей: неразнесённый аванс в партию не входит.
  let paid = new Decimal(0);
  for (const o of orders) for (const sh of o.payShares) if (sh.productionPayment.status !== "CANCELLED") paid = paid.add(sh.amount);
  for (const p of [...pays.values()].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())) {
    const driveProofs = (m.docsByPayment.get(p.id) ?? []).filter((d) => PROOF_TYPES.includes(d.docType));
    const hasProof = p.confirmed && (driveProofs.length > 0 || !!p.docRef?.trim());
    if (!hasProof) noProof++;
    const manual = isManualRef(p.docRef);
    rows.push({
      id: p.id,
      dateIso: p.paidAt.toISOString().slice(0, 10),
      dateText: formatDate(p.paidAt),
      amountText: formatMoney(p.amount.toString()),
      kindText: KIND_TEXT[p.paymentType] ?? "Оплата",
      docRef: p.docRef?.trim() || null,
      confirmed: p.confirmed,
      hasProof,
      proofTitle: driveProofs[0]?.title ?? null,
      proofHref: storedFileExists(driveProofs[0]?.storagePath) ? `/api/drive-docs/${driveProofs[0].id}` : null,
      scopeText: null,
      manual,
      rollback: manual && rollbackOwner ? { action: "production", id: p.id, ownerId: rollbackOwner } : null,
      attachProof: hasProof ? null : "production",
      planned: false,
    });
  }
  return { rows, noProof, paid };
}

function mentionsFor(kinds: MentionDocKind[], docType: DriveDocTypeKey, batchNumber: number | null, driveIds: Set<string>, entity: "batch" | "order", id: string, shown: { n: number }): PanelMention[] {
  const m = batchNumber != null ? batchMentions(batchNumber) : null;
  if (!m) return [];
  const out: PanelMention[] = [];
  let more = 0;
  for (const d of m.docs.filter((x) => kinds.includes(x.kind))) {
    if (d.fileId && driveIds.has(d.fileId)) continue;
    if (out.length >= MAX_MENTIONS) {
      more++;
      continue;
    }
    out.push({
      text: mentionDocText(d),
            attach: d.fileId
        ? { entity, id, fileId: d.fileId, title: d.title ?? mentionDocText(d), docType, docNumber: d.no, docDate: d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : null }
        : null,
    });
  }
  shown.n += out.length;
  if (more > 0) out.push({ text: `…и ещё ${more}`, attach: null });
  return out;
}

export type BatchPanelData = {
  batchId: string;
  number: number;
  year: number | null;
  panel: Panel;
  tone: Tone;
  ordersCount: number;
  /** Нет ни одного документа у партии и её ТЗ. */
  unmatched: boolean;
  lastAt: number;
};

export function buildBatchPanel(m: Model, batch: Model["raw"]["batches"][number], ctx: Ctx): BatchPanelData | null {
  const allOrders = m.ordersByBatch.get(batch.id) ?? [];
  const live = allOrders.filter((o) => o.status !== "CANCELLED");
  if (live.length === 0) return null;
  const t = batchTotals(allOrders, ctx.c4Mode);
  const own = m.docsByBatch.get(batch.id) ?? [];
  const orderDocs = live.flatMap((o) => m.docsByOrder.get(o.id) ?? []);
  const poolRows = uniqueDocs([...own, ...orderDocs]);
  const driveIds = new Set(poolRows.map((d) => d.driveFileId));
  const rules = batchRules();
  const shown = { n: 0 };
  const items: PanelItem[] = [];

  // ТЗ-приложения: у каждого ТЗ своё.
  const withAppendix = live.filter((o) => (m.docsByOrder.get(o.id) ?? []).some((d) => d.docType === "TZ_APPENDIX"));
  const withoutAppendix = live.filter((o) => !withAppendix.includes(o));
  const appendixDocs = uniqueDocs(live.flatMap((o) => (m.docsByOrder.get(o.id) ?? []).filter((d) => d.docType === "TZ_APPENDIX")));
  const tzNeed: Need = live.some((o) => tzRules({ status: o.status }).TZ_APPENDIX?.need === "required") ? "required" : "optional";
  items.push({
    key: "TZ_APPENDIX",
    label: "ТЗ-приложения",
    need: tzNeed,
    ok: withoutAppendix.length === 0,
    docs: appendixDocs.map(toDoc),
    mentions: [],
    missing: withoutAppendix.length > 0 ? `НЕТ — подгрузить приложение к ТЗ: ${withoutAppendix.map(orderTitle).join(", ")}` : null,
    note: `есть у ${withAppendix.length} из ${live.length} ${live.length === uniqueOrderCount(live) ? "ТЗ" : "позиций ТЗ"}`,
    uploads: withoutAppendix.map((o) => ({ action: "driveDoc", entity: "order", id: o.id, docType: "TZ_APPENDIX", label: `Загрузить для ${orderTitle(o)}` })),
  });

  const defs: { key: string; label: string; types: DriveDocTypeKey[]; need: Need; docType: DriveDocTypeKey; what: string; kinds: MentionDocKind[]; note?: string }[] = [
    { key: "CALC_SHEET", label: "Расчёт доплаты", types: ["CALC_SHEET"], need: rules.CALC_SHEET?.need ?? "required", docType: "CALC_SHEET", what: "расчёт доплаты по партии (расчётный лист)", kinds: ["CALC_SHEET"] },
    { key: "PAYMENT_INVOICE", label: "Счёт на аванс / доплату", types: ["PAYMENT_INVOICE"], need: rules.PAYMENT?.need ?? "required", docType: "PAYMENT_INVOICE", what: "счёт на аванс или доплату по партии", kinds: ["PAYMENT_INVOICE"] },
    { key: "UPD", label: "УПД", types: ["UPD"], need: rules.UPD?.need ?? "optional", docType: "UPD", what: "УПД", kinds: ["UPD"], note: "желателен" },
  ];
  for (const d of defs) {
    const docs = poolRows.filter((x) => d.types.includes(x.docType));
    const ok = docs.length > 0;
    const ment = !ok && d.need !== "na" ? mentionsFor(d.kinds, d.docType, batch.number, driveIds, "batch", batch.id, shown) : [];
    items.push({
      key: d.key,
      label: d.label,
      need: d.need,
      ok,
      docs: docs.map(toDoc),
      mentions: ment,
      missing: d.need === "required" && !ok ? `НЕТ — подгрузить: ${d.what}${ment.length > 0 ? " (в папке Drive такой документ назван — можно привязать)" : ""}` : null,
      note: null,
      uploads: [{ action: "driveDoc", entity: "batch", id: batch.id, docType: d.docType, label: `Загрузить ${d.what.split(" (")[0]}` }],
    });
  }

  // Платежи партии и платёжка по каждому.
  const ownerOrder = live[0].id;
  const pr = paymentRowsOf(m, live, ownerOrder);
  const proofNeed: Need = pr.rows.length > 0 ? "required" : "optional";
  const proofDocs = poolRows.filter((d) => d.docType === "PAYMENT_PROOF");
  const noProofRows = pr.rows.filter((r) => !r.hasProof);
  items.push({
    key: "PAYMENT_PROOF",
    label: "Платёжка / подтверждение оплаты",
    need: proofNeed,
    ok: pr.rows.length > 0 ? noProofRows.length === 0 : proofDocs.length > 0,
    docs: proofDocs.map(toDoc),
    mentions: [],
    missing:
      proofNeed === "required" && noProofRows.length > 0
        ? `НЕТ — подгрузить платёжку или указать номер п/п: ${noProofRows.map((r) => `${r.dateText} ${r.amountText}`).join("; ")}`
        : null,
    note: pr.rows.length === 0 ? "оплат нет — платёжка не нужна" : null,
    uploads: [],
  });

  const mentions = batchMentions(batch.number);
  const mentionTexts = mentions ? mentions.payments.map(mentionPayText) : [];
  const pay = buildPanelPay(t.work, pr.paid, {
    noProof: noProofRows.length,
    mentions: mentionTexts,
    noBaseText: "Цена работы по ТЗ партии не задана — сумма к оплате неизвестна",
  });
  const missingCount = items.filter((i) => i.need === "required" && !i.ok).length;
  const unmatched = poolRows.length === 0;
  const name = batchExtraName(batch.name);
  const hintLines = [
    `Партия ${batch.number}${name ? ` «${name}»` : ""}: ${tzCountText(uniqueOrderCount(live), live.length)}.`,
    `К оплате заказчиком (работа): ${formatMoney(t.work.toString())} = цена работы × количество по ТЗ партии. Оплачено: ${formatMoney(pr.paid.toString())} — считаются суммы, разнесённые на ТЗ партии (неразнесённый аванс в партию не входит). Остаток: ${pay.remainingText}.`,
    `Себестоимость партии: ${formatMoney(t.cost.toString())}${ctx.c4Mode === "on" ? " (режим «С 4%»: надбавка 4% к сырью и подкладке уже включена)" : " (режим «Без 4%»)"}. Оплата за работу заказчику 4% не облагается, поэтому остаток к оплате от режима не зависит.`,
    "Правила документов — из «Покрытия документами»: у каждого ТЗ своё приложение, у партии — расчёт доплаты и счёт на аванс/доплату; платёжка по каждой оплате (или номер п/п в поле «документ»).",
    mentions ? `Что названо в папке Drive: «${mentions.group}» (docs-inventory).` : "В инвентаризации Drive по этой партии записей нет.",
    "Отметка оплаты создаёт запись «не подтверждена», пока не приложена платёжка; откатывается кнопкой «Откатить» здесь же.",
  ];

  const dates = live.map((o) => (o.workOrderDate ?? o.startDate ?? o.endDate ?? o.createdAt).getTime());
  const panel: Panel = {
    id: `batch-${batch.id}`,
    title: `Партия ${batch.number}${name ? ` «${name}»` : ""}`,
    subtitle: `${tzCountText(uniqueOrderCount(live), live.length)} · в выпуске ${t.producedUnits.toDecimalPlaces(0).toString()} шт.`,
    href: `/production/batches/${batch.number}`,
    pay,
    payments: pr.rows,
    mentionedPayments: mentionTexts.slice(0, 8).concat(mentionTexts.length > 8 ? [`…и ещё ${mentionTexts.length - 8}`] : []),
    items,
    missingCount,
    proofMissing: noProofRows.length,
    hint: hintLines,
    mark: { kind: "batch", id: batch.id },
    canUpload: ctx.canUpload,
    canMark: ctx.canMark,
    markBlocked: null,
    alert: unmatched ? "Нет сопоставимых документов — подгрузите ТЗ-приложения, расчёт и счёт; затем отметьте, оплачено всё или частично." : null,
    year: batch.year,
  };
  return { batchId: batch.id, number: batch.number, year: batch.year, panel, tone: overallTone(missingCount, pay, noProofRows.length), ordersCount: live.length, unmatched, lastAt: Math.max(...dates) };
}

export async function loadBatchPanels(db: Db, organizationId: string, ctx: Ctx, numbers?: number[]): Promise<BatchPanelData[]> {
  const m = await loadProductionModel(db, organizationId);
  const out: BatchPanelData[] = [];
  for (const b of m.raw.batches) {
    if (numbers && !numbers.includes(b.number)) continue;
    const p = buildBatchPanel(m, b, ctx);
    if (p) out.push(p);
  }
  return out;
}

// ----------------------------------------------------------------- ТЗ

export type OrderIndicator = {
  orderId: string;
  /** Подписи недостающих обязательных документов. */
  missing: string[];
  noDocs: boolean;
  pay: PanelPay;
  /** «оплата партии 60%», «оплата 100%», «не оплачено». */
  payText: string;
  payScope: "batch" | "order";
  batchNumber: number | null;
  tone: Tone;
  proofMissing: number;
};

function orderPieces(m: Model, o: OrderRow, ctx: Ctx) {
  const batch = o.batchId ? m.raw.batches.find((b) => b.id === o.batchId) ?? null : null;
  const siblings = batch ? (m.ordersByBatch.get(batch.id) ?? []).filter((x) => x.status !== "CANCELLED") : [];
  const own = m.docsByOrder.get(o.id) ?? [];
  const viaBatch = uniqueDocs(batch ? [...own, ...(m.docsByBatch.get(batch.id) ?? []), ...siblings.flatMap((s) => m.docsByOrder.get(s.id) ?? [])] : own);
  const rules = tzRules({ status: o.status });
  const payOrders = batch ? siblings : [o];
  const pr = paymentRowsOf(m, payOrders, o.id);
  const work = batch ? batchTotals(m.ordersByBatch.get(batch.id) ?? [], ctx.c4Mode).work : orderStat(o, ctx.c4Mode).work;
  const mentions = batch ? batchMentions(batch.number) : null;
  const mentionTexts = mentions ? mentions.payments.map(mentionPayText) : [];
  const noProof = pr.rows.filter((r) => !r.hasProof).length;
  const pay = buildPanelPay(work, pr.paid, { noProof, mentions: mentionTexts, noBaseText: "Цена работы по ТЗ не задана — сумма к оплате неизвестна" });
  return { batch, siblings, own, viaBatch, rules, pr, pay, mentionTexts, noProof, work };
}

function orderMissing(o: OrderRow, own: DocRow[], viaBatch: DocRow[], rules: ReturnType<typeof tzRules>): string[] {
  const out: string[] = [];
  for (const [key, rule] of Object.entries(rules)) {
    if (!rule || rule.need !== "required") continue;
    const accepts = (rule.accepts ?? [key]) as DriveDocTypeKey[];
    const pool = key === "TZ_APPENDIX" ? own : viaBatch;
    if (!pool.some((d) => accepts.includes(d.docType))) out.push(key === "TZ_APPENDIX" ? "ТЗ-приложение" : rule.label ?? "Расчёт");
  }
  void o;
  return out;
}

export function indicatorOf(m: Model, o: OrderRow, ctx: Ctx): OrderIndicator {
  const p = orderPieces(m, o, ctx);
  const missing = orderMissing(o, p.own, p.viaBatch, p.rules);
  const scope: "batch" | "order" = p.batch ? "batch" : "order";
  const pct = formatPercent(p.pay.percent);
  const payText = p.pay.state === "NOBASE" ? "цена работы не задана" : `${scope === "batch" ? "партия: " : ""}${p.pay.state === "PARTIAL" ? `оплата ${pct}` : payShort(p.pay)}`;
  return {
    orderId: o.id,
    missing,
    noDocs: p.viaBatch.length === 0,
    pay: p.pay,
    payText,
    payScope: scope,
    batchNumber: p.batch?.number ?? null,
    tone: p.pay.state === "NOBASE" && missing.length === 0 ? "muted" : overallTone(missing.length, p.pay, p.noProof),
    proofMissing: p.noProof,
  };
}

export async function loadOrderIndicators(db: Db, organizationId: string, ctx: Ctx): Promise<Map<string, OrderIndicator>> {
  const m = await loadProductionModel(db, organizationId);
  const out = new Map<string, OrderIndicator>();
  for (const o of m.raw.orders) if (o.status !== "CANCELLED") out.set(o.id, indicatorOf(m, o, ctx));
  return out;
}

export type OrderPanelData = { panel: Panel; batchNumber: number | null; indicator: OrderIndicator };

export async function loadOrderPanel(db: Db, organizationId: string, orderId: string, ctx: Ctx): Promise<OrderPanelData | null> {
  const m = await loadProductionModel(db, organizationId);
  const o = m.raw.orders.find((x) => x.id === orderId);
  if (!o) return null;
  const p = orderPieces(m, o, ctx);
  const items: PanelItem[] = [];
  const driveIds = new Set(p.viaBatch.map((d) => d.driveFileId));
  const shown = { n: 0 };
  const bn = p.batch?.number ?? null;
  const entity = "order" as const;

  const add = (key: string, label: string, types: DriveDocTypeKey[], pool: DocRow[], need: Need, what: string, docType: DriveDocTypeKey, kinds: MentionDocKind[], note: string | null) => {
    const docs = pool.filter((d) => types.includes(d.docType));
    const ok = docs.length > 0;
    const ment = !ok && need !== "na" && key !== "TZ_APPENDIX" ? mentionsFor(kinds, docType, bn, driveIds, entity, o.id, shown) : [];
    items.push({
      key,
      label,
      need,
      ok,
      docs: docs.map(toDoc),
      mentions: ment,
      missing: need === "required" && !ok ? `НЕТ — подгрузить: ${what}${ment.length > 0 ? " (в папке Drive такой документ назван — можно привязать)" : ""}` : null,
      note,
      uploads: [{ action: "driveDoc", entity: "order", id: o.id, docType, label: `Загрузить ${what.split(" (")[0]}` }],
    });
  };
  const tz = p.rules.TZ_APPENDIX?.need ?? "required";
  add("TZ_APPENDIX", "ТЗ-приложение", ["TZ_APPENDIX"], p.own, tz, "приложение к ТЗ (техническое задание заказчика)", "TZ_APPENDIX", [], null);
  const calcRule = p.rules.CALC_SHEET;
  add(
    "CALC_SHEET",
    "Расчёт доплаты",
    (calcRule?.accepts ?? ["CALC_SHEET"]) as DriveDocTypeKey[],
    p.viaBatch,
    calcRule?.need ?? "optional",
    "расчёт партии (расчётный лист) или УПД",
    "CALC_SHEET",
    ["CALC_SHEET"],
    calcRule ? "своё или партии" : "нужен после завершения ТЗ",
  );
  add("PAYMENT_INVOICE", "Счёт на аванс / доплату", ["PAYMENT_INVOICE"], p.viaBatch, "optional", "счёт на аванс или доплату", "PAYMENT_INVOICE", ["PAYMENT_INVOICE"], p.batch ? "на уровне партии" : null);
  add("UPD", "УПД", ["UPD"], p.viaBatch, p.rules.UPD?.need ?? "optional", "УПД", "UPD", ["UPD"], null);

  const noProofRows = p.pr.rows.filter((r) => !r.hasProof);
  items.push({
    key: "PAYMENT_PROOF",
    label: "Платёжка / подтверждение оплаты",
    need: p.pr.rows.length > 0 ? "required" : "optional",
    ok: p.pr.rows.length > 0 ? noProofRows.length === 0 : true,
    docs: p.viaBatch.filter((d) => d.docType === "PAYMENT_PROOF").map(toDoc),
    mentions: [],
    missing: p.pr.rows.length > 0 && noProofRows.length > 0 ? `НЕТ — подгрузить платёжку или указать номер п/п: ${noProofRows.map((r) => `${r.dateText} ${r.amountText}`).join("; ")}` : null,
    note: p.pr.rows.length === 0 ? "оплат нет — платёжка не нужна" : null,
    uploads: [],
  });
  const missingCount = items.filter((i) => i.need === "required" && !i.ok).length;
  const ind = indicatorOf(m, o, ctx);
  const unmatched = p.viaBatch.length === 0;
  const title = orderTitle(o);
  const panel: Panel = {
    id: `order-${o.id}`,
    title: `${title} · документы и оплата`,
    subtitle: p.batch ? `Партия ${p.batch.number} — оплата общая на партию` : null,
    href: null,
    pay: p.pay,
    payments: p.pr.rows,
    mentionedPayments: p.mentionTexts.slice(0, 8),
    items,
    missingCount,
    proofMissing: noProofRows.length,
    hint: [
      `Оплата за работу заказчику: ${formatMoney(p.work.toString())}${p.batch ? ` — это работа всей партии ${p.batch.number} (оплаты ведутся по партии, сумма по одному ТЗ в базе не хранится)` : " — работа этого ТЗ"}. Оплачено ${formatMoney(p.pr.paid.toString())}, остаток ${p.pay.remainingText}.`,
      "Документы расчёта/УПД/счёта берутся у самого ТЗ, его партии и других ТЗ партии — как в «Покрытии документами».",
      "4%: оплата за работу 4% не облагается; режим «С 4%» меняет только себестоимость (она на этой странице ниже).",
      p.batch ? `Отметить оплату по партии — на карточке партии ${p.batch.number}.` : "Отметка создаёт оплату «не подтверждена», пока не приложена платёжка; откатывается здесь же.",
    ],
    mark: p.batch ? null : { kind: "order", id: o.id },
    canUpload: ctx.canUpload,
    canMark: ctx.canMark,
    markBlocked: o.status === "CANCELLED" ? "ТЗ отменено" : p.batch ? `оплата ведётся по партии ${p.batch.number}` : null,
    alert: unmatched ? "Нет сопоставимых документов — подгрузите приложение к ТЗ, расчёт и счёт; затем отметьте, оплачено всё или частично." : null,
    year: p.batch?.year ?? null,
  };
  return { panel, batchNumber: bn, indicator: ind };
}

