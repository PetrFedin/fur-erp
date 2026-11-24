import { tzCountText, uniqueOrderCount } from "@/lib/tz-key";
import { memoRequest, objId } from "@/lib/req-memo";
import { batchNameText } from "@/lib/batch-name";
import { storedFileExists } from "@/lib/stored-file-check";
import "server-only";
import type { PrismaClient } from "@prisma/client";
import { auctionName } from "@/lib/auction-payments";
import { isServiceAuction } from "@/lib/auction-names";
import { formatDate, formatMoney } from "@/lib/utils";
import type { DriveDocTypeKey } from "@/lib/drive-docs";
import { REG_NONE, registryCell, type RegCell } from "@/lib/registry-coverage";
import { articleLabel } from "@/lib/article-label";
import { type ColKey, type RowRules, type SectionKey, type Cell, type Gap, type CovDoc } from "./shared";
import { COLUMNS, noAuctionInvoice, purchaseRules, tzRules, batchRules, paymentRules, contractRules, SECTION_ORDER, normTitle, PURCHASE_KIND_TO_TYPE, uniq, evaluate } from "./columns";

const COL_BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]));

const ENTITY_LABELS: Record<SectionKey, string> = {
  purchases: "Закупка",
  tz: "ТЗ",
  batches: "Партия",
  payments: "Оплата поставщику",
  prodPayments: "Оплата производства",
  contracts: "Договор",
};

export type CovRow = {
  id: string;
  section: SectionKey;
  entity: string;
  /** Номер / название для списка и CSV. */
  number: string;
  title: string;
  sub: string;
  href: string;
  year: number | null;
  auction: string | null;
  groupKey: string;
  groupTitle: string;
  groupSort: number;
  cells: Record<ColKey, Cell>;
  /** Дополнительные проверки, не привязанные к столбцу (напр. «оплата без документа»). */
  extras: { text: string; ok: boolean }[];
  gaps: Gap[];
  /** Покрытие реестром (сверка xlsx-реестра с базой, не влияет на пробелы и проценты). */
  registry: RegCell;
  required: number;
  have: number;
  origHave: number;
  origTotal: number;
  search: string;
};

export type SectionStat = { key: SectionKey; rows: number; rowsWithGaps: number; required: number; have: number; percent: number | null };

export type DocCoverage = { rows: CovRow[]; sections: SectionStat[]; total: SectionStat };

const push = <T,>(m: Map<string, T[]>, k: string | null | undefined, v: T) => {
  if (!k) return;
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
};

const get = <T,>(m: Map<string, T[]>, k: string | null | undefined): T[] => (k ? (m.get(k) ?? []) : []);

const yearOf = (d: Date | null | undefined) => (d ? d.getUTCFullYear() : null);

async function computeDocCoverageImpl(db: PrismaClient, organizationId: string): Promise<DocCoverage> {
  const [purchases, pdocsAll, ddocsAll, payments, batches, orders, prodPayments, suppliers, clients] = await Promise.all([
    db.purchase.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      select: { id: true, number: true, status: true, auctionSession: true, orderDate: true, isContractorRaw: true, supplier: { select: { name: true } } },
      orderBy: { number: "asc" },
    }),
    db.purchaseDocument.findMany({
      where: { organizationId },
      select: { id: true, storagePath: true, purchaseId: true, batch: true, kind: true, title: true, originalName: true },
    }),
    db.driveDocument.findMany({
      where: { organizationId },
      select: {
        id: true, driveFileId: true, docType: true, title: true, storagePath: true,
        purchaseId: true, productionOrderId: true, productionBatchId: true, paymentId: true,
        productionPaymentId: true, clientId: true, supplierId: true,
        lot: { select: { purchaseId: true } },
      },
    }),
    db.payment.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      select: {
        id: true, amount: true, paidAt: true, confirmed: true, docRef: true, purchaseId: true,
        auctionSession: true, documentId: true,
        supplier: { select: { name: true } },
        purchase: { select: { number: true, auctionSession: true } },
      },
      orderBy: { paidAt: "asc" },
    }),
    db.productionBatch.findMany({
      where: { organizationId },
      select: { id: true, number: true, name: true, year: true, orders: { where: { status: { not: "CANCELLED" } }, select: { id: true, number: true, workOrderNumber: true } } },
      orderBy: { number: "asc" },
    }),
    db.productionOrder.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      select: {
        id: true, number: true, status: true, batchId: true, workOrderDate: true, createdAt: true,
        productModel: { select: { name: true, category: true, salesCode: true, salesName: true } },
      },
      orderBy: { number: "asc" },
    }),
    db.productionPayment.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      select: {
        id: true, amount: true, paidAt: true, confirmed: true, docRef: true,
        client: { select: { id: true, name: true } },
        orders: { select: { productionOrderId: true } },
      },
      orderBy: { paidAt: "asc" },
    }),
    db.supplier.findMany({ where: { organizationId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.client.findMany({ where: { organizationId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  // Документ «есть» только если файл физически прикреплён; записи без файла («не прикреплён») в расчёт не идут.
  const pdocs = pdocsAll.filter((d) => storedFileExists(d.storagePath));
  const ddocs = ddocsAll.filter((d) => storedFileExists(d.storagePath));

  // ---- индексы документов: к какой сущности что привязано
  const dPurchase = new Map<string, CovDoc[]>();
  const dOrder = new Map<string, CovDoc[]>();
  const dBatch = new Map<string, CovDoc[]>();
  const dPayment = new Map<string, CovDoc[]>();
  const dProdPayment = new Map<string, CovDoc[]>();
  const dClient = new Map<string, CovDoc[]>();
  const dSupplier = new Map<string, CovDoc[]>();
  for (const d of ddocs) {
    const doc: CovDoc = {
      type: d.docType,
      keys: [`${d.docType}|t:${normTitle(d.title)}`, `${d.docType}|f:${d.driveFileId}`],
      original: storedFileExists(d.storagePath),
    };
    push(dPurchase, d.purchaseId ?? d.lot?.purchaseId, doc);
    push(dOrder, d.productionOrderId, doc);
    push(dBatch, d.productionBatchId, doc);
    push(dPayment, d.paymentId, doc);
    push(dProdPayment, d.productionPaymentId, doc);
    push(dClient, d.clientId, doc);
    push(dSupplier, d.supplierId, doc);
  }
  const pdocById = new Map<string, CovDoc>();
  const pdocOfPurchase = new Map<string, CovDoc[]>();
  const pdocOfAuction = new Map<string, CovDoc[]>();
  for (const d of pdocs) {
    const type = PURCHASE_KIND_TO_TYPE[d.kind] ?? "OTHER";
    const doc: CovDoc = { type, keys: [`${type}|t:${normTitle(d.title)}`, `${type}|t:${normTitle(d.originalName)}`], original: storedFileExists(d.storagePath) };
    pdocById.set(d.id, doc);
    if (d.purchaseId) push(pdocOfPurchase, d.purchaseId, doc);
    else push(pdocOfAuction, d.batch ? auctionName(d.batch) : null, doc);
  }

  const rows: CovRow[] = [];
  const nowYear = new Date().getUTCFullYear();

  const finish = (
    base: Pick<CovRow, "id" | "section" | "number" | "title" | "sub" | "href" | "year" | "auction" | "groupKey" | "groupTitle" | "groupSort">,
    rules: RowRules,
    docs: CovDoc[],
    opts: { docRef?: boolean; docsFor?: Partial<Record<ColKey, CovDoc[]>>; extras?: { text: string; ok: boolean }[]; searchExtra?: string; registry?: RegCell; unconfirmed?: boolean } = {}
  ) => {
    const uniqDocs = uniq(docs);
    const res = evaluate(rules, uniqDocs, !!opts.docRef, opts.docsFor && Object.fromEntries(Object.entries(opts.docsFor).map(([k, v]) => [k, uniq(v ?? [])])));
    const extras = opts.extras ?? [];
    const gaps = [...res.gaps];
    let required = res.required;
    let have = res.have;
    for (const e of extras) {
      required++;
      if (e.ok) have++;
      else gaps.push({ label: e.text, attach: "Платёжка или счёт к оплате — в карточке оплаты" });
    }
    // Оплата поставщику «не подтверждена» (confirmed = false) — это пробел «нет платёжки»: тот же счёт, что на /attention.
    // Он заменяет пробел «Документ к оплате», если тот и так был (одна запись — один пробел).
    if (opts.unconfirmed) {
      const docGap = gaps.findIndex((g) => g.label === "Документ к оплате");
      const gap = { label: "Платёжки нет (оплата не подтверждена)", attach: "Приложите платёжное поручение и подтвердите оплату в карточке оплаты" };
      if (docGap >= 0) gaps[docGap] = gap;
      else {
        gaps.push(gap);
        required++;
      }
      extras.push({ text: "Оплата не подтверждена: платёжки нет", ok: false });
    }
    rows.push({
      ...base,
      entity: ENTITY_LABELS[base.section],
      cells: res.cells,
      extras,
      gaps,
      registry: opts.registry ?? REG_NONE,
      required,
      have,
      origHave: uniqDocs.filter((d) => d.original).length,
      origTotal: uniqDocs.length,
      search: `${base.title} ${base.number} ${base.sub} ${base.groupTitle} ${opts.searchExtra ?? ""}`.toLowerCase().replace(/ё/g, "е"),
    });
  };

  // ---- закупки
  const paymentsByPurchase = new Map<string, typeof payments>();
  const paymentsByAuction = new Map<string, typeof payments>();
  for (const pay of payments) {
    if (pay.purchaseId) push(paymentsByPurchase, pay.purchaseId, pay);
    else push(paymentsByAuction, auctionName(pay.auctionSession), pay);
  }
  const payDocs = (pay: (typeof payments)[number]): CovDoc[] => [
    ...get(dPayment, pay.id),
    ...(pay.documentId && pdocById.get(pay.documentId) ? [pdocById.get(pay.documentId)!] : []),
  ];
  const payTypes: DriveDocTypeKey[] = ["PAYMENT_PROOF", "PAYMENT_INVOICE"];
  for (const p of purchases) {
    const auction = auctionName(p.auctionSession);
    const own = [...get(dPurchase, p.id), ...get(pdocOfPurchase, p.id), ...get(pdocOfAuction, auction)];
    const pays = [...get(paymentsByPurchase, p.id), ...get(paymentsByAuction, auction)];
    const fromPayments = pays.flatMap(payDocs).filter((d) => payTypes.includes(d.type));
    const year = yearOf(p.orderDate);
    finish(
      {
        id: p.id, section: "purchases", number: p.number, title: `Закупка ${p.number}`,
        sub: `${p.supplier.name}${p.status === "RECEIVED" ? "" : " · черновик"}`,
        href: `/purchases/${p.id}`, year, auction,
        groupKey: `${auction ?? "–"}|${year ?? ""}`,
        groupTitle: `${auction ? (isServiceAuction(auction) ? "Без аукциона" : auction) : "Без аукциона"}${year ? ` · ${year}` : ""}`,
        groupSort: year ?? nowYear + 1,
      },
      purchaseRules({
        status: p.status,
        realAuction: !!auction && !isServiceAuction(auction) && !noAuctionInvoice(auction),
        hasPayments: pays.length > 0,
        contractorRaw: p.isContractorRaw === true,
      }),
      [...own, ...fromPayments],
      { searchExtra: auction ?? "", registry: registryCell("purchases", p.number, p.orderDate) }
    );
  }

  // ---- партии производства и ТЗ
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const ordersByBatch = new Map<string, string[]>();
  for (const o of orders) if (o.batchId) push(ordersByBatch, o.batchId, o.id);
  const prodPayHasDoc = (pp: (typeof prodPayments)[number]) =>
    get(dProdPayment, pp.id).some((d) => (paymentRules().PAYMENT!.accepts as DriveDocTypeKey[]).includes(d.type)) || !!pp.docRef?.trim();

  for (const b of batches) {
    if (b.orders.length === 0) continue; // пустые партии (поставка без ТЗ) не считаем
    const orderIds = new Set(b.orders.map((o) => o.id));
    const docs = [...get(dBatch, b.id), ...b.orders.flatMap((o) => get(dOrder, o.id))];
    const bpays = prodPayments.filter((pp) => pp.orders.some((x) => orderIds.has(x.productionOrderId)));
    const extras: { text: string; ok: boolean }[] = [];
    if (bpays.length > 0) {
      const withDoc = bpays.filter(prodPayHasDoc).length;
      extras.push({ text: `Оплата с документом: ${withDoc} из ${bpays.length}`, ok: withDoc === bpays.length });
    }
    finish(
      {
        id: b.id, section: "batches", number: String(b.number), title: `Партия ${b.number}`,
        sub: `${batchNameText(b.name) ? `«${batchNameText(b.name)}» · ` : ""}${tzCountText(uniqueOrderCount(b.orders), b.orders.length)}`,
        href: `/production/batches/${b.number}`, year: b.year, auction: null,
        groupKey: "batches", groupTitle: "Партии производства", groupSort: 0,
      },
      batchRules(),
      docs,
      { extras, registry: registryCell("batches", String(b.number)) }
    );
  }

  for (const o of orders) {
    const b = o.batchId ? batchById.get(o.batchId) : undefined;
    const own = get(dOrder, o.id);
    const viaBatch = b ? [...own, ...get(dBatch, b.id), ...(ordersByBatch.get(b.id) ?? []).flatMap((id) => get(dOrder, id))] : own;
    const year = b?.year ?? yearOf(o.workOrderDate) ?? yearOf(o.createdAt);
    finish(
      {
        id: o.id, section: "tz", number: o.number, title: `ТЗ ${o.number}`,
        sub: articleLabel(o.productModel), href: `/production/${o.id}`, year, auction: null,
        groupKey: b ? `b${b.number}` : "nob",
        groupTitle: b ? `Партия ${b.number}${batchNameText(b.name) ? ` «${batchNameText(b.name)}»` : ""}` : "Вне партий",
        groupSort: b ? b.number : 9999,
      },
      tzRules({ status: o.status }),
      viaBatch,
      { docsFor: { TZ_APPENDIX: own }, registry: registryCell("tz", o.number, o.workOrderDate) }
    );
  }

  // ---- оплаты поставщику
  for (const pay of payments) {
    const auction = auctionName(pay.auctionSession) ?? auctionName(pay.purchase?.auctionSession);
    const year = yearOf(pay.paidAt);
    finish(
      {
        id: pay.id, section: "payments",
        number: pay.purchase?.number ?? (auctionName(pay.auctionSession) ?? "–"),
        title: `${pay.supplier.name} · ${formatMoney(pay.amount.toString())} от ${formatDate(pay.paidAt)}`,
        sub: `${pay.purchase ? `закупка ${pay.purchase.number}` : auctionName(pay.auctionSession) ? `аукцион ${auctionName(pay.auctionSession)}` : "без привязки"}${pay.confirmed ? "" : " · не подтверждена"}`,
        href: pay.purchaseId ? `/purchases/${pay.purchaseId}` : auctionName(pay.auctionSession) ? `/payments?auction=${encodeURIComponent(auctionName(pay.auctionSession)!)}#auction-block` : "/payments",
        year, auction, groupKey: "payments", groupTitle: "Оплаты поставщику", groupSort: 0,
      },
      paymentRules(),
      payDocs(pay),
      { docRef: !!pay.docRef?.trim(), unconfirmed: !pay.confirmed }
    );
  }

  // ---- оплаты производства
  for (const pp of prodPayments) {
    const first = pp.orders[0]?.productionOrderId;
    finish(
      {
        id: pp.id, section: "prodPayments", number: pp.docRef?.trim() || "–",
        title: `${pp.client?.name ?? "Заказчик не указан"} · ${formatMoney(pp.amount.toString())} от ${formatDate(pp.paidAt)}`,
        sub: `${pp.orders.length > 0 ? `${pp.orders.length} ТЗ` : "аванс без ТЗ"}${pp.confirmed ? "" : " · не подтверждена"}`,
        href: first ? `/production/${first}` : pp.client ? `/clients/${pp.client.id}` : "/production",
        year: yearOf(pp.paidAt), auction: null, groupKey: "prodPayments", groupTitle: "Оплаты производства", groupSort: 0,
      },
      paymentRules(),
      get(dProdPayment, pp.id),
      { docRef: !!pp.docRef?.trim(), unconfirmed: !pp.confirmed }
    );
  }

  // ---- договоры
  for (const s of suppliers) {
    finish(
      { id: `s-${s.id}`, section: "contracts", number: s.name, title: `Поставщик «${s.name}»`, sub: "поставщик", href: `/suppliers/${s.id}`, year: null, auction: null, groupKey: "contracts", groupTitle: "Договоры", groupSort: 0 },
      contractRules(),
      get(dSupplier, s.id)
    );
  }
  for (const c of clients) {
    finish(
      { id: `c-${c.id}`, section: "contracts", number: c.name, title: `Заказчик «${c.name}»`, sub: "заказчик", href: `/clients/${c.id}`, year: null, auction: null, groupKey: "contracts", groupTitle: "Договоры", groupSort: 0 },
      contractRules(),
      get(dClient, c.id)
    );
  }

  return { rows, ...summarize(rows) };
}

const stat = (key: SectionKey, rs: CovRow[]): SectionStat => {
  const required = rs.reduce((s, r) => s + r.required, 0);
  const have = rs.reduce((s, r) => s + r.have, 0);
  return {
    key,
    rows: rs.length,
    rowsWithGaps: rs.filter((r) => r.gaps.length > 0).length,
    required,
    have,
    // Округляем вниз: «100%» только при нуле пробелов (иначе 99% при одном пробеле из сотни).
    percent: required === 0 ? null : rs.some((r) => r.gaps.length > 0) ? Math.min(99, Math.floor((have / required) * 100)) : 100,
  };
};

/** Покрытие в процентах: сколько обязательных документов есть из тех, что нужны по правилам. */
export function summarize(rows: CovRow[]): { sections: SectionStat[]; total: SectionStat } {
  return {
    sections: SECTION_ORDER.map((k) => stat(k, rows.filter((r) => r.section === k))),
    total: stat("purchases", rows),
  };
}

// ====================================================================== ФИЛЬТРЫ

export type CovFilters = {
  /** Мультивыбор (повтор параметра); пусто — все. */
  section: SectionKey[];
  year: number | null;
  auction: string[];
  gaps: boolean;
  q: string;
  sort: "" | "gaps";
};

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : "");

const many = (v: string | string[] | undefined, max = 60): string[] =>
  Array.from(new Set((Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => String(x).trim().slice(0, 200)).filter(Boolean))).slice(0, max);

export function parseCovFilters(sp: Record<string, string | string[] | undefined>): CovFilters {
  const year = parseInt(one(sp.year), 10);
  return {
    section: many(sp.section).filter((k): k is SectionKey => (SECTION_ORDER as string[]).includes(k)),
    year: Number.isFinite(year) ? year : null,
    auction: many(sp.auction),
    gaps: one(sp.gaps) === "1",
    // `dq` — прежнее имя поиска по списку документов: теперь один поиск `q` и для матрицы, и для списка.
    q: (one(sp.q) || one(sp.dq)).trim().slice(0, 100),
    sort: one(sp.sort) === "gaps" ? "gaps" : "",
  };
}

export function filterCovRows(rows: CovRow[], f: CovFilters): CovRow[] {
  const q = f.q.toLowerCase().replace(/ё/g, "е");
  return rows.filter((r) => {
    if (f.section.length && !f.section.includes(r.section)) return false;
    if (f.year !== null && r.section !== "contracts" && r.year !== f.year) return false;
    if (f.auction.length && !(r.auction && f.auction.includes(r.auction))) return false;
    if (f.gaps && r.gaps.length === 0) return false;
    if (q && !r.search.includes(q)) return false;
    return true;
  });
}

export const docCoverageHint = (col: ColKey) => COL_BY_KEY.get(col)?.attach ?? "";

export const computeDocCoverage = memoRequest("docCoverage", computeDocCoverageImpl, (db, orgId) => `${objId(db)}|${orgId}`);
