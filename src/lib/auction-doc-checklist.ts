import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma, PrismaClient } from "@prisma/client";
import { auctionName, loadAuctionSummaries } from "@/lib/auction-payments";
import { isServiceAuction } from "@/lib/auction-names";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { CONTRACTOR_RAW_TAG, PURCHASE_KIND_TO_TYPE, normTitle, noAuctionInvoice, purchaseRules, type Need } from "@/lib/doc-coverage";
import { DRIVE_DOC_TYPE_LABELS, safeViewUrl, type DriveDocTypeKey } from "@/lib/drive-docs";
import { auctionMentions, driveFileUrl, mentionDocText, mentionPayText, type MentionDocKind } from "@/lib/doc-mentions";
import { buildPanelPay, isManualRef, type Panel, type PanelDoc, type PanelItem, type PanelMention, type PanelPayment, type UploadTarget } from "@/lib/doc-panel";
import { DOC_KIND_LABELS } from "@/lib/purchase-files";
import { formatDate, formatMoney } from "@/lib/utils";

/**
 * ОДНА функция «что нужно подгрузить и что оплачено» для аукциона (или отдельной закупки без аукциона).
 * Единица = аукцион (все его закупки) либо одна закупка вне аукциона.
 *
 * Правила «какие документы нужны» — НЕ здесь, а в purchaseRules (src/lib/doc-coverage.ts, матрица /documents):
 * здесь они только объединяются по закупкам аукциона. Отдельно от матрицы — только «Счёт Веллмех на оплату»
 * (в матрице он и платёжка — одна колонка) и платёжка по каждой оплате.
 * Документ «есть», если он привязан к любой закупке аукциона, к самому аукциону (документ партии) или к его оплате.
 * Источники «что упомянуто»: docs-inventory/chain-*.json (только чтение).
 */

type Db = PrismaClient | Prisma.TransactionClient;

const KIND_TEXT: Record<string, string> = { ADVANCE: "Аванс", PARTIAL: "Доплата", FINAL: "Окончательный расчёт", OTHER: "Оплата" };
const PROOF_TYPES: DriveDocTypeKey[] = ["PAYMENT_PROOF", "PAYMENT_INVOICE", "APPROVAL_EMAIL", "UPD"];
const MAX_MENTIONS = 6;

type ItemDef = {
  key: string;
  label: string;
  types: DriveDocTypeKey[];
  /** Какие колонки purchaseRules задают «нужен ли». */
  rule: ("AUCTION_INVOICE" | "UPD" | "SPECIFICATION" | "CALC_SHEET")[] | null;
  uploadKinds: { kind: string; label: string }[];
  mention: MentionDocKind[];
  what: string;
};

const ITEMS: ItemDef[] = [
  { key: "AUCTION_INVOICE", label: "Счёт / инвойс аукциона", types: ["AUCTION_INVOICE"], rule: ["AUCTION_INVOICE"], uploadKinds: [{ kind: "AUCTION_INVOICE", label: "счёт аукциона" }], mention: ["AUCTION_INVOICE"], what: "счёт или инвойс аукциона на лоты" },
  { key: "WELLMECH_INVOICE", label: "Счёт Веллмех на оплату", types: ["PAYMENT_INVOICE"], rule: null, uploadKinds: [{ kind: "ADVANCE_INVOICE", label: "счёт Веллмех" }], mention: ["PAYMENT_INVOICE"], what: "счёт Веллмех на оплату" },
  { key: "UPD", label: "УПД", types: ["UPD"], rule: ["UPD"], uploadKinds: [{ kind: "UPD", label: "УПД" }], mention: ["UPD"], what: "УПД (передаточный документ)" },
  { key: "SPECIFICATION", label: "Спецификация", types: ["SPECIFICATION"], rule: ["SPECIFICATION"], uploadKinds: [{ kind: "SPECIFICATION", label: "спецификацию" }], mention: ["SPECIFICATION"], what: "спецификацию к договору" },
  { key: "CALC_SHEET", label: "Расчёт себестоимости", types: ["CALC_SHEET"], rule: ["CALC_SHEET"], uploadKinds: [{ kind: "CALC_SHEET", label: "расчётный лист" }], mention: ["CALC_SHEET"], what: "расчёт себестоимости (расчётный лист)" },
];

function pluralPurchasesText(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} закупка`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} закупки`;
  return `${n} закупок`;
}

const rank: Record<Need, number> = { na: 0, optional: 1, required: 2 };
const maxNeed = (a: Need, b: Need): Need => (rank[a] >= rank[b] ? a : b);

export type AuctionPanelData = {
  /** Название аукциона либо номер закупки (если вне аукциона). */
  key: string;
  kind: "auction" | "purchase";
  panel: Panel;
  purchaseIds: string[];
  /** Годы дат заказа закупок (для фильтра года). */
  years: number[];
  lastAt: number;
  /** Для сводки: номера закупок. */
  purchaseNumbers: string[];
};

export type LoadOpts = {
  /** Только эти аукционы (по названию). */
  names?: string[];
  /** Единица «одна закупка» (для закупки вне аукциона; для закупки аукциона берётся её аукцион). */
  purchaseId?: string;
  canUpload: boolean;
  canMark: boolean;
};

export async function loadAuctionPanels(db: Db, organizationId: string, opts: LoadOpts): Promise<AuctionPanelData[]> {
  // 1) Закупки единиц.
  let units: { key: string; kind: "auction" | "purchase"; ids: string[] }[] = [];
  const base = await db.purchase.findMany({
    where: { organizationId, ...(opts.names ? { auctionSession: { not: null } } : opts.purchaseId ? { OR: [{ id: opts.purchaseId }] } : { auctionSession: { not: null } }) },
    select: { id: true, number: true, status: true, auctionSession: true, orderDate: true, notes: true, supplierId: true, invoiceNumber: true },
    orderBy: [{ orderDate: "asc" }, { number: "asc" }],
  });
  type P = (typeof base)[number];
  let purchases: P[] = base;
  if (opts.purchaseId) {
    const me = base[0];
    if (!me) return [];
    const an = auctionName(me.auctionSession);
    if (an && !isServiceAuction(an)) {
      purchases = await db.purchase.findMany({
        where: { organizationId, auctionSession: { not: null } },
        select: { id: true, number: true, status: true, auctionSession: true, orderDate: true, notes: true, supplierId: true, invoiceNumber: true },
        orderBy: [{ orderDate: "asc" }, { number: "asc" }],
      });
      purchases = purchases.filter((p) => auctionName(p.auctionSession) === an);
      units = [{ key: an, kind: "auction", ids: purchases.map((p) => p.id) }];
    } else {
      units = [{ key: me.number, kind: "purchase", ids: [me.id] }];
    }
  } else {
    const byName = new Map<string, string[]>();
    for (const p of base) {
      const n = auctionName(p.auctionSession);
      if (!n || (opts.names && !opts.names.includes(n))) continue;
      byName.set(n, [...(byName.get(n) ?? []), p.id]);
    }
    units = [...byName.entries()].map(([key, ids]) => ({ key, kind: "auction" as const, ids }));
    purchases = base.filter((p) => units.some((u) => u.ids.includes(p.id)));
  }
  if (units.length === 0) return [];

  const allIds = units.flatMap((u) => u.ids);
  const auctionNames = units.filter((u) => u.kind === "auction").map((u) => u.key);
  const unitOf = new Map<string, number>();
  units.forEach((u, i) => u.ids.forEach((id) => unitOf.set(id, i)));
  const unitOfAuction = new Map<string, number>();
  units.forEach((u, i) => u.kind === "auction" && unitOfAuction.set(u.key, i));

  // 2) Суммы: аукционы — общей функцией (как «Остаток к оплате» и «Долг поставщикам»), закупка вне аукциона — по итогу закупки.
  const summaries = auctionNames.length > 0 ? await loadAuctionSummaries(db, organizationId, auctionNames) : [];
  const summaryByName = new Map(summaries.map((s) => [s.name, s]));
  const plainIds = units.filter((u) => u.kind === "purchase").flatMap((u) => u.ids);
  const plainFull = plainIds.length
    ? await db.purchase.findMany({ where: { organizationId, id: { in: plainIds } }, include: { items: true, expenses: true } })
    : [];

  // 3) Оплаты, документы.
  const payments = await db.payment.findMany({
    where: {
      organizationId,
      status: { in: ["COMPLETED", "PENDING"] },
      OR: [{ purchaseId: { in: allIds } }, ...(auctionNames.length ? [{ auctionSession: { in: auctionNames } }] : [])],
    },
    select: {
      id: true, amount: true, paidAt: true, status: true, kind: true, docRef: true, confirmed: true, documentId: true,
      purchaseId: true, auctionSession: true, notes: true,
      document: { select: { id: true, title: true } },
      purchase: { select: { number: true } },
    },
    orderBy: { paidAt: "asc" },
  });
  const [pdocs, ddocs] = await Promise.all([
    db.purchaseDocument.findMany({
      where: { organizationId, OR: [{ purchaseId: { in: allIds } }, ...(auctionNames.length ? [{ batch: { in: auctionNames } }] : [])] },
      select: { id: true, purchaseId: true, batch: true, kind: true, title: true, originalName: true, createdAt: true, sizeBytes: true },
      orderBy: { createdAt: "asc" },
    }),
    db.driveDocument.findMany({
      where: {
        organizationId,
        OR: [
          { purchaseId: { in: allIds } },
          { lot: { purchaseId: { in: allIds } } },
          ...(payments.length ? [{ paymentId: { in: payments.map((p) => p.id) } }] : []),
        ],
      },
      select: {
        id: true, driveFileId: true, docType: true, title: true, viewUrl: true, storagePath: true, storedName: true,
        docNumber: true, docDate: true, purchaseId: true, paymentId: true, lot: { select: { purchaseId: true } },
      },
      orderBy: [{ docDate: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const out: AuctionPanelData[] = [];
  for (let ui = 0; ui < units.length; ui++) {
    const u = units[ui];
    const ps = purchases.filter((p) => u.ids.includes(p.id));
    const live = ps.filter((p) => p.status !== "CANCELLED");
    const anchor = (live[0] ?? ps[0])!;
    const isAuction = u.kind === "auction";
    const scope: "batch" | "purchase" = isAuction ? "batch" : "purchase";

    // --- сумма и оплачено
    let total = new Decimal(0);
    let paid = new Decimal(0);
    let planned = new Decimal(0);
    if (isAuction) {
      const s = summaryByName.get(u.key);
      if (s) {
        total = s.total;
        paid = s.paid;
        planned = s.planned;
      }
    } else {
      const full = plainFull.find((x) => x.id === anchor.id);
      if (full) total = purchaseTotalInclVat(full);
      for (const pay of payments) {
        if (pay.purchaseId !== anchor.id) continue;
        if (pay.status === "COMPLETED") paid = paid.add(pay.amount);
        else planned = planned.add(pay.amount);
      }
    }

    // --- оплаты единицы
    const myPays = payments.filter((p) => (p.purchaseId ? unitOf.get(p.purchaseId) === ui : unitOfAuction.get(auctionName(p.auctionSession) ?? "") === ui));
    const myPayIds = new Set(myPays.map((p) => p.id));

    // --- документы единицы (по типу)
    const seen = new Set<string>();
    const docsByType = new Map<DriveDocTypeKey, PanelDoc[]>();
    const driveFileIds = new Set<string>();
    const addDoc = (type: DriveDocTypeKey, keys: string[], d: PanelDoc) => {
      if (keys.some((k) => seen.has(k))) return;
      keys.forEach((k) => seen.add(k));
      docsByType.set(type, [...(docsByType.get(type) ?? []), d]);
    };
    for (const d of pdocs) {
      const mine = d.purchaseId ? unitOf.get(d.purchaseId) === ui : unitOfAuction.get(auctionName(d.batch) ?? "") === ui;
      if (!mine) continue;
      const type = PURCHASE_KIND_TO_TYPE[d.kind] ?? "OTHER";
      addDoc(type, [`${type}|t:${normTitle(d.title)}`, `${type}|t:${normTitle(d.originalName)}`], {
        id: d.id,
        title: d.title,
        meta: `${DOC_KIND_LABELS[d.kind] ?? d.kind} · ${d.purchaseId ? "эта закупка" : "весь аукцион"} · ${formatDate(d.createdAt)}`,
        href: `/api/purchase-docs/${d.id}`,
        driveUrl: null,
        replace: { action: "purchaseDoc", id: d.id },
      });
    }
    for (const d of ddocs) {
      const pid = d.purchaseId ?? d.lot?.purchaseId ?? null;
      const mine = pid ? unitOf.get(pid) === ui : d.paymentId ? myPayIds.has(d.paymentId) : false;
      if (!mine) continue;
      driveFileIds.add(d.driveFileId);
      addDoc(d.docType, [`${d.docType}|t:${normTitle(d.title)}`, `${d.docType}|f:${d.driveFileId}`], {
        id: d.id,
        title: d.title,
        meta: `${DRIVE_DOC_TYPE_LABELS[d.docType]}${d.docNumber ? ` №${d.docNumber}` : ""}${d.docDate ? ` · ${formatDate(d.docDate)}` : ""}${d.storagePath ? " · файл в приложении" : " · ссылка Drive"}`,
        href: d.storagePath ? `/api/drive-docs/${d.id}` : null,
        driveUrl: safeViewUrl(d.viewUrl),
        replace: { action: "driveDoc", id: d.id },
      });
    }
    // Платёжки, приложенные к самим оплатам.
    for (const p of myPays) {
      if (p.document) {
        addDoc("PAYMENT_PROOF", [`PAYMENT_PROOF|t:${normTitle(p.document.title)}`, `pd:${p.document.id}`], {
          id: p.document.id,
          title: p.document.title,
          meta: `Платёжка · ${formatDate(p.paidAt)}`,
          href: `/api/purchase-docs/${p.document.id}`,
          driveUrl: null,
          replace: { action: "purchaseDoc", id: p.document.id },
        });
      }
    }
    const docsOf = (types: DriveDocTypeKey[]) => types.flatMap((t) => docsByType.get(t) ?? []);

    // --- нужность документов: объединение purchaseRules по закупкам
    const realAuction = isAuction && !isServiceAuction(u.key) && !noAuctionInvoice(u.key);
    const completed = myPays.filter((p) => p.status === "COMPLETED");
    const needs: Record<string, Need> = { AUCTION_INVOICE: "na", UPD: "na", SPECIFICATION: "na", CALC_SHEET: "na" };
    let allContractor = live.length > 0;
    for (const p of live) {
      const contractorRaw = !!p.notes?.includes(CONTRACTOR_RAW_TAG);
      if (!contractorRaw) allContractor = false;
      const r = purchaseRules({ status: p.status, realAuction, hasPayments: completed.length > 0, contractorRaw });
      for (const k of ["AUCTION_INVOICE", "UPD", "SPECIFICATION", "CALC_SHEET"] as const) needs[k] = maxNeed(needs[k], r[k]?.need ?? "na");
    }
    const anyReceived = live.some((p) => p.status === "RECEIVED");

    const mentions = isAuction ? auctionMentions(u.key) : null;
    const items: PanelItem[] = [];
    for (const def of ITEMS) {
      let need: Need;
      let note: string | null = null;
      if (def.rule) need = def.rule.reduce<Need>((acc, k) => maxNeed(acc, needs[k]), "na");
      else need = allContractor ? "na" : isServiceAuction(u.key) ? "optional" : "required"; // счёт Веллмех
      if (def.key === "AUCTION_INVOICE" && need === "na") note = !isAuction ? "закупка без аукциона" : isServiceAuction(u.key) ? "не реальный аукцион" : "счёта аукциона здесь не бывает (ферма, подкладка, доп. материалы)";
      if (def.key === "UPD" && need === "optional" && !anyReceived) note = "появится после приёмки на склад";
      if (def.key === "UPD" && need === "na") note = allContractor ? "сырьё подрядчика — УПД поставщика нет" : "появится после приёмки на склад";
      if (def.key === "CALC_SHEET" && need === "optional") note = "желателен";
      if (def.key === "SPECIFICATION" && need === "na") note = "не требуется";
      const docs = docsOf(def.types);
      const ok = docs.length > 0;
      const uploads: UploadTarget[] = def.uploadKinds.map((k) => ({ action: "purchaseDoc", purchaseId: anchor.id, kind: k.kind, scope, label: `Загрузить ${k.label}` }));
      // Что названо в папке Drive, но здесь не привязано.
      const ment: PanelMention[] = [];
      let mentionedMore = 0;
      if (!ok && need !== "na" && mentions) {
        for (const m of mentions.docs.filter((x) => def.mention.includes(x.kind))) {
          if (m.fileId && driveFileIds.has(m.fileId)) continue;
          if (ment.length >= MAX_MENTIONS) {
            mentionedMore++;
            continue;
          }
          ment.push({
            text: mentionDocText(m),
            driveUrl: m.fileId ? driveFileUrl(m.fileId) : null,
            attach: m.fileId
              ? {
                  entity: "purchase",
                  id: anchor.id,
                  fileId: m.fileId,
                  title: m.title ?? mentionDocText(m),
                  docType: def.types[0],
                  docNumber: m.no,
                  docDate: m.date && /^\d{4}-\d{2}-\d{2}$/.test(m.date) ? m.date : null,
                }
              : null,
          });
        }
      }
      if (mentionedMore > 0) ment.push({ text: `…и ещё ${mentionedMore}`, driveUrl: null, attach: null });
      items.push({
        key: def.key,
        label: def.label,
        need,
        ok,
        docs,
        mentions: ment,
        missing: need === "required" && !ok ? `НЕТ — подгрузить: ${def.what}${ment.length > 0 ? " (в папке Drive такой документ назван — можно привязать)" : ""}` : null,
        note,
        uploads,
      });
    }

    // --- оплаты → строки и платёжка
    const payRows: PanelPayment[] = myPays.map((p) => {
      const driveProofs = ddocs.filter((d) => d.paymentId === p.id && PROOF_TYPES.includes(d.docType));
      const hasDoc = !!p.documentId || driveProofs.length > 0;
      const hasProof = p.confirmed && (hasDoc || !!p.docRef?.trim());
      const manual = isManualRef(p.docRef);
      const proofDoc = p.document ?? null;
      return {
        id: p.id,
        dateIso: p.paidAt.toISOString().slice(0, 10),
        dateText: formatDate(p.paidAt),
        amountText: formatMoney(p.amount.toString()),
        kindText: KIND_TEXT[p.kind] ?? "Оплата",
        docRef: p.docRef?.trim() || null,
        confirmed: p.confirmed,
        hasProof,
        proofTitle: proofDoc?.title ?? driveProofs[0]?.title ?? null,
        proofHref: proofDoc ? `/api/purchase-docs/${proofDoc.id}` : driveProofs[0]?.storagePath ? `/api/drive-docs/${driveProofs[0].id}` : null,
        scopeText: p.purchaseId ? `закупка ${p.purchase?.number ?? ""}` : null,
        manual,
        rollback: manual ? (p.purchaseId ? { action: "purchase", id: p.id, ownerId: p.purchaseId } : { action: "auction", id: p.id, ownerId: null }) : null,
        attachProof: hasProof ? null : "supplier",
        planned: p.status === "PENDING",
      };
    });
    const doneRows = payRows.filter((r) => !r.planned);
    const noProofRows = doneRows.filter((r) => !r.hasProof);

    // Платёжка как пункт чек-листа: по каждой оплате.
    const proofDocs = docsOf(["PAYMENT_PROOF"]);
    const proofNeed: Need = doneRows.length > 0 ? "required" : "optional";
    const proofOk = doneRows.length > 0 ? noProofRows.length === 0 : proofDocs.length > 0;
    items.push({
      key: "PAYMENT_PROOF",
      label: "Платёжка / подтверждение оплаты",
      need: proofNeed,
      ok: proofOk,
      docs: proofDocs,
      mentions: [],
      missing:
        proofNeed === "required" && !proofOk
          ? `НЕТ — подгрузить платёжку: ${noProofRows.length === 1 ? "по оплате" : `по оплатам (${noProofRows.length})`} ${noProofRows.map((r) => `${r.dateText} ${r.amountText}`).join("; ")}`
          : null,
      note: doneRows.length === 0 ? "оплат нет — платёжка не нужна" : null,
      uploads: [],
    });

    const mentionTexts = mentions ? mentions.payments.map(mentionPayText) : [];
    const pay = buildPanelPay(total, paid, { noProof: noProofRows.length, mentions: mentionTexts, planned });
    const missingCount = items.filter((i) => i.need === "required" && !i.ok).length;

    const label = isAuction ? u.key : `Закупка ${anchor.number}`;
    const hint = [
      `Единица: ${isAuction ? `аукцион «${u.key}» — все его закупки (${live.length}${ps.length > live.length ? `, отменённых ${ps.length - live.length}` : ""})` : `закупка ${anchor.number} вне аукциона`}.`,
      `К оплате: ${formatMoney(total.toString())} (итоги закупок с НДС, без отменённых). Оплачено: ${formatMoney(paid.toString())}${planned.greaterThan(0) ? `; запланировано (в «оплачено» не входит): ${formatMoney(planned.toString())}` : ""}. Остаток: ${pay.remainingText}. Та же цифра, что «Остаток к оплате» и «Долг поставщикам».`,
      "Список обязательных документов берётся из правил «Покрытия документами» (страница «Документы»); «Счёт Веллмех на оплату» и платёжка по каждой оплате — отдельные пункты.",
      "Документ засчитан, если он привязан к любой закупке аукциона, к самому аукциону или к оплате. Платёжка по оплате засчитана, если оплата подтверждена и к ней приложен файл/ссылка либо указан номер платёжки.",
      mentions ? `Что названо в папке Drive: группа «${mentions.group}» (docs-inventory).` : "В инвентаризации Drive по этому аукциону записей нет.",
      "4%: на закупки не начисляется, режим «С 4%» эти суммы не меняет.",
    ];

    out.push({
      key: u.key,
      kind: u.kind,
      purchaseIds: u.ids,
      purchaseNumbers: ps.map((p) => p.number),
      years: [...new Set(ps.map((p) => p.orderDate.getUTCFullYear()))],
      lastAt: Math.max(...ps.map((p) => p.orderDate.getTime())),
      panel: {
        id: `auction-${u.key}`,
        title: label,
        subtitle: pluralPurchasesText(live.length),
        href: isAuction ? `/lots?auction=${encodeURIComponent(u.key)}` : `/purchases/${anchor.id}`,
        pay,
        payments: payRows,
        mentionedPayments: mentionTexts.slice(0, 8).concat(mentionTexts.length > 8 ? [`…и ещё ${mentionTexts.length - 8}`] : []),
        items,
        missingCount,
        proofMissing: noProofRows.length,
        hint,
        mark: live.length === 0 ? null : isAuction ? { kind: "auction", name: u.key } : { kind: "purchase", id: anchor.id },
        canUpload: opts.canUpload,
        canMark: opts.canMark,
        markBlocked: live.length === 0 ? "все закупки отменены" : null,
        alert:
          docsByType.size === 0 && myPays.length === 0
            ? "Нет сопоставимых документов и оплат — подгрузите счёт и спецификацию в «Сырьё»/закупку и отметьте, была ли оплата."
            : null,
        year: null,
      },
    });
  }
  return out.sort((a, b) => b.lastAt - a.lastAt);
}
