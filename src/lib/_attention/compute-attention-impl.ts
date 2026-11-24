import { tzCountText, uniqueOrderCount } from "@/lib/tz-key";
import { auctionSummariesView } from "@/lib/mart/auctions";
import { memoRequest, objId } from "@/lib/req-memo";
import { loadSupplierArticleIds } from "@/lib/supplier-articles";
import { batchNameText } from "@/lib/batch-name";
import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auctionName, loadAuctionSummaries, PAY_EPS, STATUS_EPS } from "@/lib/auction-payments";
import { isServiceAuction } from "@/lib/auction-names";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { formatDate, formatMoney } from "@/lib/utils";
import { cleanNote } from "@/lib/note-tags";
import { inYear, type YearFilter } from "@/lib/year-filter";
import { orderDateOf } from "@/lib/year-scope";
import { articleLabel } from "@/lib/article-label";
import { summarizeStages, summaryLine } from "@/lib/raw-stage";
import { type AttentionPriority, type AttentionKind, type AttentionProblem, type AttentionEntity } from "./shared";
import { KIND_ORDER, KIND_SECTION, normalizeModelName } from "./section-labels";

const PRIORITY_ORDER: Record<AttentionPriority, number> = { red: 0, yellow: 1, gray: 2 };

/** Дата импорта: подставлена скриптом, а не взята из документа. */
const IMPORT_DAY_FROM = new Date("2026-10-01T00:00:00.000Z");

const IMPORT_DAY_TO = new Date("2026-10-02T00:00:00.000Z");

const isImportDay = (d: Date | null | undefined) => !!d && d >= IMPORT_DAY_FROM && d < IMPORT_DAY_TO;

/** Сырьё не со склада (лоскут, бобр, давальческое): по пометке в заметках. */
const NON_STOCK_RE = /лоскут|бобр|фонди|подрядчик|давальч|сырь[её]\s+(заказчик|клиент|подрядчик)|тут нет продаж/i;

const cut = (s: string, n = 140) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** Номер ТЗ как число из «П-2026-0113» → 113 (для правил по конкретным ТЗ). */
const tzOrdinal = (num: string) => {
  const m = /(\d+)\s*$/.exec(num);
  return m ? parseInt(m[1], 10) : NaN;
};

async function computeAttentionImpl(db: PrismaClient, organizationId: string, year: YearFilter = "all"): Promise<AttentionEntity[]> {
  const today = new Date();
  const entities = new Map<string, AttentionEntity>();
  /** Сущность создаётся при первой проблеме; повторные проблемы дописываются в неё же. */
  const flag = (
    kind: AttentionKind,
    key: string,
    base: { title: string; sub?: string; href: string; year?: number | null; amount?: number },
    problem: AttentionProblem
  ) => {
    const id = `${kind}:${key}`;
    let e = entities.get(id);
    if (!e) {
      e = { id, kind, section: KIND_SECTION[kind], year: null, ...base, problems: [], priority: "gray" };
      e.year = base.year ?? null;
      entities.set(id, e);
    }
    e.problems.push(problem);
  };

  // ---------------------------------------------------------------- ЗАКУПКИ
  const [purchases, lotsWithStub, supplierPayments, summaries] = await Promise.all([
    db.purchase.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      select: {
        id: true, number: true, status: true, auctionSession: true, orderDate: true, receivedDate: true,
        expectedDate: true, isContractorRaw: true, invoiceNumber: true, supplier: { select: { name: true } },
        payments: { where: { status: "COMPLETED" }, select: { amount: true } },
      },
      orderBy: { number: "asc" },
    }),
    db.rawMaterialLot.findMany({
      where: { organizationId, receivedDate: { gte: IMPORT_DAY_FROM, lt: IMPORT_DAY_TO } },
      select: { purchaseId: true, purchase: { select: { number: true, status: true } } },
    }),
    db.payment.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      select: {
        id: true, amount: true, currency: true, paidAt: true, confirmed: true, docRef: true,
        purchaseId: true, auctionSession: true,
        supplier: { select: { name: true } },
        purchase: { select: { number: true } },
      },
      orderBy: { paidAt: "asc" },
    }),
    (db === prisma ? auctionSummariesView(organizationId) : loadAuctionSummaries(db, organizationId)),
  ]);

  const pHref = (id: string) => `/purchases/${id}`;
  const purchaseById = new Map(purchases.map((p) => [p.id, p]));
  const flagPurchase = (id: string, problem: AttentionProblem) => {
    const p = purchaseById.get(id);
    if (!p) return;
    const a = auctionName(p.auctionSession);
    flag("purchase", id, { title: `Закупка ${p.number}`, sub: `${p.supplier.name}${a ? `, ${a}` : ""}${p.status === "RECEIVED" ? "" : " · черновик"}`, href: pHref(id), year: p.orderDate ? p.orderDate.getUTCFullYear() : null }, problem);
  };

  // Аукцион не указан / «Нет информации». Сырьё подрядчика (isContractorRaw) и закупка со своим счётом Веллмех
  // (invoiceNumber: оплаты привязаны к самой закупке, не к аукциону) аукциона не имеют по природе — не пробел.
  for (const p of purchases) {
    const raw = p.auctionSession?.split(/\r?\n/)[0].trim() ?? "";
    if (!auctionName(p.auctionSession) && !p.isContractorRaw) {
      if (raw && isServiceAuction(raw)) flagPurchase(p.id, { text: `аукцион — «${raw}»`, priority: "yellow", group: "no-auction-info" });
      else if (!raw && !p.invoiceNumber?.trim()) flagPurchase(p.id, { text: "аукцион не указан", priority: "yellow", group: "no-auction" });
    }
    // Даты
    if (isImportDay(p.orderDate)) flagPurchase(p.id, { text: `дата заказа ${formatDate(p.orderDate)} — дата импорта`, priority: "yellow", group: "stub-lots" });
    if (p.status === "RECEIVED" && !p.receivedDate) flagPurchase(p.id, { text: "принята, но даты прихода нет", priority: "yellow", group: "stub-lots" });
    // Ожидаемые поставки (мех не принят)
    if (p.status !== "RECEIVED" && p.expectedDate) {
      const late = p.expectedDate < today;
      flagPurchase(p.id, {
        text: `мех не принят: ожидается ${formatDate(p.expectedDate)}${late ? " — срок прошёл" : ""}`,
        priority: late ? "yellow" : "gray",
        group: late ? "late-delivery" : "awaiting",
      });
    }
  }

  // Этапы сырья, внесённые Веллмехом: ожидаемая дата прошла, а мех ещё не принят.
  const stageRows = await db.supplierRawStage.findMany({
    where: { organizationId, purchase: { status: { notIn: ["RECEIVED", "CANCELLED"] } } },
    select: { purchaseId: true, stage: true, status: true, place: true, plannedStart: true, plannedEnd: true, factStart: true, factEnd: true },
  });
  const stagesByPurchase = new Map<string, typeof stageRows>();
  for (const r of stageRows) (stagesByPurchase.get(r.purchaseId) ?? stagesByPurchase.set(r.purchaseId, []).get(r.purchaseId)!).push(r);
  for (const [id, list] of stagesByPurchase) {
    const sum = summarizeStages(list, today);
    if (sum?.overdue) flagPurchase(id, { text: `сырьё: ${summaryLine(sum)}`, priority: "yellow", group: "raw-overdue" });
  }

  // Лоты с датой-заглушкой
  const stubByPurchase = new Map<string, number>();
  let stubNoPurchase = 0;
  for (const l of lotsWithStub) {
    if (!l.purchaseId || !l.purchase) stubNoPurchase++;
    else stubByPurchase.set(l.purchaseId, (stubByPurchase.get(l.purchaseId) ?? 0) + 1);
  }
  for (const [id, n] of stubByPurchase)
    flagPurchase(id, { text: `лотов с датой прихода 01.10.2026 (дата импорта): ${n}`, priority: "yellow", group: "stub-lots" });
  if (stubNoPurchase > 0)
    flag("purchase", "no-purchase-lots", { title: "Лоты без закупки", sub: "склад", href: "/lots" }, { text: `лотов с датой прихода 01.10.2026 (дата импорта): ${stubNoPurchase}`, priority: "gray", group: "stub-lots" });

  // Оплаты поставщику
  const payLabel = (p: (typeof supplierPayments)[number]) => ({
    title: `${p.supplier.name}, ${formatMoney(p.amount.toString())}${p.currency !== "RUB" ? ` (${p.currency})` : ""}`,
    sub: `${formatDate(p.paidAt)} · ${p.purchase ? `закупка ${p.purchase.number}` : p.auctionSession ? `аукцион ${auctionName(p.auctionSession)}` : "без привязки"}`,
  });
  const payHref = (p: (typeof supplierPayments)[number]) =>
    p.purchaseId ? pHref(p.purchaseId) : p.auctionSession ? `/payments?auction=${encodeURIComponent(auctionName(p.auctionSession) ?? "")}#auction-block` : "/payments";
  const flagPayment = (p: (typeof supplierPayments)[number], problem: AttentionProblem) =>
    flag("payment", p.id, { ...payLabel(p), href: payHref(p), year: p.paidAt.getUTCFullYear(), amount: p.amount.toNumber() }, problem);

  for (const p of supplierPayments) {
    if (!p.confirmed)
      flagPayment(p, { text: `платёжки нет${p.docRef ? ` (основание: ${cut(p.docRef, 60)})` : ""}; пока её нет, долг занижен на эту сумму`, priority: "red", group: "no-receipt" });
  }
  // Авансы без привязки. Аукционы «без единой оплаты» привязываем к этому же авансу: это одна причина, а не две записи.
  const advances = supplierPayments.filter((p) => !p.purchaseId && !p.auctionSession);
  const mainAdvance = [...advances].sort((a, b) => b.amount.comparedTo(a.amount))[0];
  for (const p of advances)
    flagPayment(p, { text: "аванс не привязан ни к аукциону, ни к закупке", href: "/payments", linkLabel: "Привязать", priority: "red", group: "advance-unlinked" });

  // Аукционы: остаток без оплат и переплаты. Аукцион из одной закупки — проблема этой закупки, не отдельная запись;
  // принятый аукцион без оплат при наличии непривязанного аванса — часть записи этого аванса.
  const activeSummaries = summaries.filter((a) => a.purchases > 0);
  for (const a of activeSummaries) {
    const href = `/payments?auction=${encodeURIComponent(a.name)}#auction-block`;
    const single = a.perPurchase.length === 1 ? a.perPurchase[0].id : null;
    const attach = (problem: AttentionProblem) =>
      single && purchaseById.has(single)
        ? flagPurchase(single, { ...problem, href })
        : flag("auction", a.name, { title: `Аукцион ${a.name}`, sub: `${a.perPurchase.length} закуп.`, href, year: a.lastPurchaseAt ? a.lastPurchaseAt.getUTCFullYear() : null }, problem);

    if (a.remaining.greaterThan(PAY_EPS) && a.paid.lessThanOrEqualTo(PAY_EPS)) {
      const draftOnly = a.perPurchase.every((x) => x.status !== "RECEIVED");
      const text = `оплат по аукциону нет, остаток ${formatMoney(a.remaining.toString())}${draftOnly ? " (мех ещё не принят)" : ""}${a.planned.greaterThan(0) ? `, запланировано ${formatMoney(a.planned.toString())}` : ""}`;
      if (!draftOnly && mainAdvance)
        flagPayment(mainAdvance, { text: `аукцион ${a.name}: ${text}; возможно, этот аванс — за него`, href, priority: "red", group: "advance-unlinked" });
      else attach({ text, priority: draftOnly ? "gray" : "red", group: draftOnly ? "awaiting" : "auction-unpaid" });
    }
    // Переплата, зачтённая документом (расчёт AME по счёту №253), — не вопрос: те же правила в integrity/known.ts.
    const settledByDocs = /^(SAGA 03[-.]26|Подкладка 05[-.]26)$/i.test(a.name);
    if (a.remaining.lessThan(STATUS_EPS.neg()) && !settledByDocs)
      attach({ text: `оплачено больше стоимости аукциона на ${formatMoney(a.remaining.neg().toString())}`, priority: "yellow", group: "overpaid" });
  }
  // Закупки без аукциона: переплата считается по самой закупке.
  const purchaseTotals = await db.purchase.findMany({
    where: { organizationId, status: { not: "CANCELLED" }, auctionSession: null },
    include: { items: true, expenses: true },
  });
  const paidById = new Map(purchases.map((l) => [l.id, l.payments.reduce((s, x) => s.add(x.amount), new Decimal(0))]));
  for (const p of purchaseTotals) {
    const over = (paidById.get(p.id) ?? new Decimal(0)).sub(purchaseTotalInclVat(p));
    if (over.greaterThan(STATUS_EPS)) flagPurchase(p.id, { text: `оплачено больше стоимости на ${formatMoney(over.toString())}`, priority: "yellow", group: "overpaid" });
  }

  // --------------------------------------------------------- ПРОИЗВОДСТВО
  const [orders, batches, productionPayments, bomRows, lotRemain] = await Promise.all([
    db.productionOrder.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      select: {
        id: true, number: true, workOrderNumber: true, status: true, notes: true, batchNotRequired: true, materialDescription: true, workOrderDate: true,
        endDate: true, startDate: true, batchId: true, clientId: true, contractNumber: true, productModelId: true,
        plannedQuantity: true, producedQuantity: true,
        productModel: { select: { name: true, category: true, salesCode: true, salesName: true } },
        client: { select: { name: true } },
        batch: { select: { year: true } },
        materialUsages: { select: { rawMaterialId: true, commission4: true } },
      },
      orderBy: { number: "asc" },
    }),
    db.productionBatch.findMany({
      where: { organizationId },
      select: { id: true, number: true, name: true, year: true, orders: { where: { status: { not: "CANCELLED" } }, select: { id: true, number: true, workOrderNumber: true } } },
      orderBy: { number: "asc" },
    }),
    db.productionPayment.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      select: {
        id: true, amount: true, paidAt: true, confirmed: true, docRef: true, clientId: true,
        client: { select: { name: true } },
        orders: { select: { productionOrderId: true } },
      },
      orderBy: { paidAt: "asc" },
    }),
    db.productModelMaterial.findMany({
      where: { productModel: { organizationId } },
      select: { productModelId: true, rawMaterialId: true, rawMaterial: { select: { name: true, unit: true } } },
    }),
    db.rawMaterialLot.groupBy({ by: ["rawMaterialId"], where: { organizationId }, _sum: { quantityRemaining: true } }),
  ]);

  const tHref = (id: string) => `/production/${id}`;
  const flagTz = (o: (typeof orders)[number], problem: AttentionProblem) =>
    flag("tz", o.id, { title: `ТЗ ${o.workOrderNumber?.trim() || o.number}`, sub: `${articleLabel(o.productModel)}${o.client ? `, ${o.client.name}` : ""}`, href: tHref(o.id), year: orderDateOf(o)?.getUTCFullYear() ?? o.batch?.year ?? null }, problem);
  /** Сырьё не со склада: пометка в заметках либо все списания без надбавки 4%. */
  const nonStock = (o: (typeof orders)[number]) =>
    NON_STOCK_RE.test(`${o.notes ?? ""} ${o.materialDescription ?? ""}`) ||
    (o.materialUsages.length > 0 && o.materialUsages.every((u) => !u.commission4));

  // Шаблонные даты: 12.01.2026 (копия из ТЗ 97–115) и 17.03.2026 (ТЗ 118, возможно 17.06).
  const T_JAN = [2026, 1, 12];
  const T_MAR = [2026, 3, 17];
  const SUSPECT = new Map<number, number[][]>([[113, [T_JAN]], [114, [T_JAN]], [115, [T_JAN]], [118, [T_MAR, T_JAN]]]);

  const remainByMaterial = new Map(lotRemain.map((r) => [r.rawMaterialId, r._sum.quantityRemaining ?? new Decimal(0)]));
  const bomByModel = new Map<string, typeof bomRows>();
  for (const b of bomRows) bomByModel.set(b.productModelId, [...(bomByModel.get(b.productModelId) ?? []), b]);

  for (const o of orders) {
    if (o.status === "PLANNED" && o.producedQuantity.greaterThan(0)) {
      flagTz(o, {
        text: `статус «Запланировано», но уже указано произведено ${o.producedQuantity.toString()} из ${o.plannedQuantity.toString()} — нужна ручная проверка статуса`,
        priority: "yellow",
        group: "production-status",
      });
    }
    if (o.status === "COMPLETED" && o.producedQuantity.isZero() && o.plannedQuantity.greaterThan(0)) {
      flagTz(o, {
        text: `статус «Завершено», но произведено 0 из ${o.plannedQuantity.toString()} — нужна ручная проверка количества`,
        priority: "red",
        group: "production-status",
      });
    }
    // Списания сырья
    if (o.materialUsages.length === 0) {
      const ns = NON_STOCK_RE.test(`${o.notes ?? ""} ${o.materialDescription ?? ""}`);
      flagTz(o, {
        text: `списаний сырья нет${cleanNote(o.notes) ? ` — «${cut(cleanNote(o.notes)!, 60)}»` : ""}`,
        priority: ns ? "gray" : o.status === "PLANNED" ? "yellow" : "red",
        group: ns ? "no-usage" : "tz-requisites",
      });
    }
    // Даты ТЗ: нет даты / дата импорта / шаблонная дата (одна группа проблем)
    if (!o.workOrderDate) flagTz(o, { text: "даты ТЗ нет", priority: "yellow", group: "tz-no-date" });
    else {
      const s = SUSPECT.get(tzOrdinal(o.workOrderNumber ?? o.number)); // номер ТЗ из документа (113–115, 118), а не внутренний П-2026-xxxx
      const d = o.workOrderDate;
      if (s?.some(([y, m, day]) => d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m && d.getUTCDate() === day))
        flagTz(o, { text: `дата ТЗ ${formatDate(d)} — похожа на шаблон, проверьте`, priority: "yellow", group: "suspect-date" });
    }
    if (o.status === "COMPLETED" && (!o.endDate || isImportDay(o.endDate)))
      flagTz(o, { text: o.endDate ? `дата выпуска ${formatDate(o.endDate)} — дата импорта` : "даты выпуска нет", priority: "yellow", group: "tz-end-date" });
    // Реквизиты
    // ТЗ 116/117 вне партий — документально (письмо Коношенко 10.07.2026); признак «партия не нужна» стоит у самого ТЗ.
    if (!o.batchId && o.batchNotRequired !== true) flagTz(o, { text: "партия не указана", priority: "yellow", group: "tz-requisites" });
    if (!o.clientId) flagTz(o, { text: "заказчик не указан", priority: "yellow", group: "tz-requisites" });
    else if (!o.contractNumber?.trim()) flagTz(o, { text: "номер договора не указан", priority: "gray", group: "dict" });
    // Запланированные с нулевым остатком сырья
    if (o.status === "PLANNED") {
      const used = new Set(o.materialUsages.map((u) => u.rawMaterialId));
      const empty = (bomByModel.get(o.productModelId) ?? []).filter(
        (b) => !used.has(b.rawMaterialId) && !(remainByMaterial.get(b.rawMaterialId) ?? new Decimal(0)).greaterThan(0)
      );
      if (empty.length > 0)
        flagTz(o, {
          text: `запланировано, но на складе нулевой остаток: ${empty.map((b) => b.rawMaterial.name).join(", ")}`,
          priority: nonStock(o) || NON_STOCK_RE.test(`${o.notes ?? ""}`) ? "gray" : "red",
          group: nonStock(o) || NON_STOCK_RE.test(`${o.notes ?? ""}`) ? "no-usage" : "tz-requisites",
        });
    }
  }

  // Оплаты производства без подтверждающего документа — красный разрыв evidence.
  for (const p of productionPayments) {
    if (!p.confirmed) {
      const first = p.orders[0]?.productionOrderId;
      flag(
        "payment",
        `production:${p.id}`,
        {
          title: `${p.client?.name ?? "Заказчик не указан"}, ${formatMoney(p.amount.toString())}`,
          sub: `${formatDate(p.paidAt)} · оплата производства${p.orders.length ? ` · ${p.orders.length} ТЗ` : " · аванс без ТЗ"}`,
          href: first ? `/production/${first}` : "/production",
          year: p.paidAt.getUTCFullYear(),
          amount: p.amount.toNumber(),
        },
        {
          text: `оплата производства не подтверждена${p.docRef ? ` (основание: ${cut(p.docRef, 60)})` : ""}; нужна платёжка/выписка`,
          priority: "red",
          group: "no-receipt",
        }
      );
    }
  }

  // Партии: без оплат за работу
  const paidOrderIds = new Set<string>();
  for (const p of productionPayments) for (const l of p.orders) paidOrderIds.add(l.productionOrderId);
  for (const b of batches) {
    if (b.orders.length === 0 || b.orders.some((o) => paidOrderIds.has(o.id))) continue;
    flag(
      "batch",
      b.id,
      { title: `Партия ${b.number}${batchNameText(b.name) ? ` «${batchNameText(b.name)}»` : ""}`, sub: tzCountText(uniqueOrderCount(b.orders), b.orders.length), href: `/production/batches/${b.number}`, year: b.year ?? null },
      { text: "оплат за работу нет", priority: "yellow", group: "batch-no-pay" }
    );
  }

  // --------------------------------------------------------------- ДАННЫЕ
  const [models, materialsNoCat, suppliersNoInn, clientsNoInn] = await Promise.all([
    db.productModel.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    db.rawMaterial.findMany({ where: { organizationId, isActive: true, categoryId: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.supplier.findMany({ where: { organizationId, isActive: true, OR: [{ inn: null }, { inn: "" }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.client.findMany({ where: { organizationId, isActive: true, OR: [{ inn: null }, { inn: "" }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const byNorm = new Map<string, typeof models>();
  for (const m of models) {
    const k = normalizeModelName(m.name);
    if (!k) continue;
    byNorm.set(k, [...(byNorm.get(k) ?? []), m]);
  }
  for (const g of byNorm.values()) {
    if (g.length < 2) continue;
    flag(
      "model",
      g[0].id,
      { title: `Модель «${g[0].name}»`, href: `/models/${g[0].id}` },
      { text: `заведена дважды (кириллица и латиница): ${g.map((m) => `«${m.name}»`).join(" и ")}`, priority: "yellow", group: "model-dup" }
    );
  }
  // Артикулы, внесённые поставщиком (по журналу изменений), у которых ещё нет розничной цены: задача «проставьте цену».
  const supplierIds = await loadSupplierArticleIds(db, organizationId);
  if (supplierIds.size > 0) {
    const fresh = await db.productModel.findMany({ where: { organizationId, id: { in: [...supplierIds.keys()] }, sellingPrice: null, isActive: true }, select: { id: true, name: true } });
    for (const m of fresh)
      flag("model", m.id, { title: `Артикул «${m.name}»`, sub: "внёс Веллмех", href: `/models/${m.id}` }, { text: "от Веллмеха: нет розничной цены", priority: "yellow", group: "supplier-new-article" });
  }
  for (const m of materialsNoCat)
    flag("material", m.id, { title: `Материал «${m.name}»`, href: `/materials/${m.id}` }, { text: "категория не указана", priority: "gray", group: "dict" });
  for (const s of suppliersNoInn)
    flag("supplier", s.id, { title: `Поставщик «${s.name}»`, href: `/suppliers/${s.id}` }, { text: "ИНН не указан", priority: "gray", group: "dict" });
  for (const c of clientsNoInn)
    flag("client", c.id, { title: `Заказчик «${c.name}»`, href: `/clients/${c.id}` }, { text: "ИНН не указан", priority: "gray", group: "dict" });

  // Итог: проблемы по важности, сущности — по важности и названию.
  const out = Array.from(entities.values());
  for (const e of out) {
    e.problems.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    e.priority = e.problems[0].priority;
  }
  if (year !== "all") {
    // Общий фильтр года: записи с датой — по её году, справочники (без даты) при выборе года не показываются.
    for (let i = out.length - 1; i >= 0; i--) if (!inYear(out[i].year ? new Date(Date.UTC(out[i].year!, 5, 1)) : null, year)) out.splice(i, 1);
  }
  out.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      a.title.localeCompare(b.title, "ru", { numeric: true })
  );
  return out;
}

/** Сколько СУЩНОСТЕЙ требует внимания: с красной или жёлтой проблемой (main); только с серыми — gray (справочно). */
export function countAttention(entities: AttentionEntity[]) {
  let main = 0;
  let gray = 0;
  let red = 0;
  for (const e of entities) {
    if (e.priority === "gray") gray++;
    else {
      main++;
      if (e.priority === "red") red++;
    }
  }
  return { main, gray, red };
}

export const computeAttention = memoRequest("attention", computeAttentionImpl, (db, orgId, year = "all") => `${objId(db)}|${orgId}|${year}`);
