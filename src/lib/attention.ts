import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import type { PrismaClient } from "@prisma/client";
import { auctionName, loadAuctionSummaries, CLOSING_NOTE, PAY_EPS } from "@/lib/auction-payments";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { formatDate, formatMoney } from "@/lib/utils";

/**
 * «Что не заведено»: живые проверки полноты данных. Каждая проверка — свой запрос
 * к базе, ничего не хранится. Отменённые закупки, ТЗ и оплаты не считаются.
 */

export type AttentionPriority = "red" | "yellow" | "gray";
export type AttentionSection = "purchases" | "production" | "data";

export type AttentionItem = {
  id: string;
  /** Формулировка: что именно не так с этой записью. */
  text: string;
  /** Ссылка на саму запись. */
  href: string;
  /** Текст ссылки (по умолчанию — «Открыть»). */
  linkLabel?: string;
  priority: AttentionPriority;
};

export type AttentionCheck = {
  key: string;
  section: AttentionSection;
  title: string;
  /** Почему это важно. */
  why: string;
  items: AttentionItem[];
};

export const SECTION_LABELS: Record<AttentionSection, string> = {
  purchases: "Закупки",
  production: "Производство",
  data: "Данные",
};

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

// Латиница, похожая на кириллицу (после toLowerCase).
const LATIN_TO_CYR: Record<string, string> = {
  a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у",
};
export function normalizeModelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[a-z]/g, (ch) => LATIN_TO_CYR[ch] ?? ch)
    .replace(/[^а-я0-9a-z]/g, "");
}

export async function computeAttention(db: PrismaClient, organizationId: string): Promise<AttentionCheck[]> {
  const today = new Date();
  const checks: AttentionCheck[] = [];
  const add = (c: Omit<AttentionCheck, "items"> & { items: AttentionItem[] }) => {
    c.items.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    checks.push(c);
  };

  // ---------------------------------------------------------------- ЗАКУПКИ
  const [purchases, purchaseDocs, driveDocsOfPurchases, lotsWithStub, supplierPayments, summaries] = await Promise.all([
    db.purchase.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      select: {
        id: true, number: true, status: true, auctionSession: true, orderDate: true, receivedDate: true,
        expectedDate: true, supplier: { select: { name: true } },
        payments: { where: { status: "COMPLETED" }, select: { amount: true } },
      },
      orderBy: { number: "asc" },
    }),
    db.purchaseDocument.findMany({ where: { organizationId }, select: { purchaseId: true, batch: true } }),
    db.driveDocument.findMany({
      where: { organizationId, OR: [{ purchaseId: { not: null } }, { lotId: { not: null } }] },
      select: { purchaseId: true, lot: { select: { purchaseId: true } } },
    }),
    db.rawMaterialLot.findMany({
      where: { organizationId, receivedDate: { gte: IMPORT_DAY_FROM, lt: IMPORT_DAY_TO } },
      select: { purchaseId: true, purchase: { select: { number: true, status: true } } },
    }),
    db.payment.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      select: {
        id: true, amount: true, currency: true, paidAt: true, confirmed: true, notes: true, docRef: true,
        purchaseId: true, auctionSession: true, documentId: true,
        supplier: { select: { name: true } },
        purchase: { select: { number: true } },
        driveDocuments: { select: { id: true }, take: 1 },
      },
      orderBy: { paidAt: "asc" },
    }),
    loadAuctionSummaries(db, organizationId),
  ]);

  const pHref = (id: string) => `/purchases/${id}`;
  const docBatches = new Set(purchaseDocs.map((d) => d.batch).filter((b): b is string => !!b));
  const docPurchases = new Set<string>();
  for (const d of purchaseDocs) if (d.purchaseId) docPurchases.add(d.purchaseId);
  for (const d of driveDocsOfPurchases) {
    if (d.purchaseId) docPurchases.add(d.purchaseId);
    if (d.lot?.purchaseId) docPurchases.add(d.lot.purchaseId);
  }
  const pLabel = (p: (typeof purchases)[number]) => `Закупка ${p.number} (${p.supplier.name}${auctionName(p.auctionSession) ? `, ${auctionName(p.auctionSession)}` : ""})`;

  // 1. Закупки без документов
  add({
    key: "purchases-no-docs",
    section: "purchases",
    title: "Закупки без документов",
    why: "Нет ни счёта, ни УПД, ни расчётного листа: сумму закупки нечем подтвердить, а долг поставщику — проверить.",
    items: purchases
      .filter((p) => {
        const name = auctionName(p.auctionSession);
        return !docPurchases.has(p.id) && !(name && docBatches.has(name));
      })
      .map((p) => ({
        id: p.id,
        text: `${pLabel(p)}: документов нет${p.status === "RECEIVED" ? "" : " (мех ещё не принят)"}`,
        href: pHref(p.id),
        priority: p.status === "RECEIVED" ? "red" : "gray",
      })),
  });

  // 2. Даты закупок
  add({
    key: "purchases-dates",
    section: "purchases",
    title: "Закупки с датой импорта или без даты прихода",
    why: "Дата заказа 01.10.2026 — это день загрузки данных, а не реальная дата. Принятая закупка без даты прихода не попадёт в отчёты по периодам.",
    items: purchases.flatMap<AttentionItem>((p) => {
      const out: AttentionItem[] = [];
      if (isImportDay(p.orderDate))
        out.push({ id: `${p.id}-o`, text: `${pLabel(p)}: дата заказа ${formatDate(p.orderDate)} — дата импорта`, href: pHref(p.id), priority: "yellow" });
      if (p.status === "RECEIVED" && !p.receivedDate)
        out.push({ id: `${p.id}-r`, text: `${pLabel(p)}: принята, но даты прихода нет`, href: pHref(p.id), priority: "yellow" });
      return out;
    }),
  });

  // 3. Лоты с датой-заглушкой
  const stubByPurchase = new Map<string, { number: string; n: number }>();
  let stubNoPurchase = 0;
  for (const l of lotsWithStub) {
    if (!l.purchaseId || !l.purchase) {
      stubNoPurchase++;
      continue;
    }
    const e = stubByPurchase.get(l.purchaseId) ?? { number: l.purchase.number, n: 0 };
    e.n++;
    stubByPurchase.set(l.purchaseId, e);
  }
  add({
    key: "lots-stub-date",
    section: "purchases",
    title: "Лоты с датой прихода 01.10.2026",
    why: "Это дата импорта, а не дата получения мехa: от неё зависят дата проводок на складе и отчёты по периодам. Нужна дата из УПД.",
    items: [
      ...Array.from(stubByPurchase, ([id, e]) => ({
        id,
        text: `Закупка ${e.number}: лотов с датой импорта — ${e.n}`,
        href: pHref(id),
        priority: "yellow" as const,
      })),
      ...(stubNoPurchase > 0
        ? [{ id: "no-purchase", text: `Лоты без закупки с датой импорта: ${stubNoPurchase}`, href: "/lots", priority: "gray" as const }]
        : []),
    ],
  });

  // 4. Без аукциона / «Нет информации»
  add({
    key: "purchases-no-auction",
    section: "purchases",
    title: "Закупки без аукциона или с пометкой «Нет информации»",
    why: "Оплаты и долг считаются по аукционам. Закупка без аукциона не видна в разделе «Оплаты» — её долг приходится считать вручную.",
    items: purchases
      .filter((p) => {
        const n = auctionName(p.auctionSession);
        return !n || /^нет информации/i.test(n.trim());
      })
      .map((p) => ({
        id: p.id,
        text: `Закупка ${p.number} (${p.supplier.name}): ${auctionName(p.auctionSession) ? "аукцион — «Нет информации»" : "аукцион не указан"}`,
        href: pHref(p.id),
        priority: "yellow" as const,
      })),
  });

  // 5. Ожидаемые поставки (мех не принят)
  const notReceived = purchases.filter((p) => p.status !== "RECEIVED" && p.expectedDate);
  add({
    key: "purchases-expected",
    section: "purchases",
    title: "Черновики с ожидаемой датой: мех ещё не принят",
    why: "Пока закупка не принята, мех не на складе и не может быть списан в ТЗ. Просроченная дата — повод уточнить у поставщика.",
    items: notReceived.map((p) => {
      const late = p.expectedDate! < today;
      return {
        id: p.id,
        text: `${pLabel(p)}: ожидается ${formatDate(p.expectedDate!)}${late ? " — срок прошёл" : ""}`,
        href: pHref(p.id),
        priority: late ? ("yellow" as const) : ("gray" as const),
      };
    }),
  });

  // 6a/6b. Платежи поставщику без платёжки / без документа
  const payLabel = (p: (typeof supplierPayments)[number]) => {
    const where = p.purchase ? `по закупке ${p.purchase.number}` : p.auctionSession ? `по аукциону ${auctionName(p.auctionSession)}` : "без привязки";
    return `${p.supplier.name}, ${formatMoney(p.amount.toString())}${p.currency !== "RUB" ? ` (${p.currency})` : ""}, ${formatDate(p.paidAt)}, ${where}`;
  };
  const payHref = (p: (typeof supplierPayments)[number]) =>
    p.purchaseId ? pHref(p.purchaseId) : p.auctionSession ? `/payments?auction=${encodeURIComponent(auctionName(p.auctionSession) ?? "")}#auction-block` : "/payments";
  add({
    key: "payments-unconfirmed",
    section: "purchases",
    title: "Оплаты поставщику без платёжки",
    why: "Оплата записана по письмам и счетам, но платёжного поручения нет: это может быть не фактический платёж. Пока нет платёжки, долг занижен на эту сумму.",
    items: supplierPayments
      .filter((p) => !p.confirmed)
      .map((p) => ({
        id: p.id,
        text: `${payLabel(p)}: платёжки нет${p.docRef ? ` (основание: ${cut(p.docRef, 60)})` : ""}`,
        href: payHref(p),
        priority: "red" as const,
      })),
  });
  add({
    key: "payments-no-doc",
    section: "purchases",
    title: "Оплаты поставщику без документа",
    why: "К оплате не приложен ни скан платёжки, ни ссылка на Drive: сумму нечем подтвердить при сверке.",
    items: supplierPayments
      .filter((p) => p.confirmed && !p.documentId && p.driveDocuments.length === 0)
      .map((p) => {
        const closing = p.notes === CLOSING_NOTE;
        return {
          id: p.id,
          text: `${payLabel(p)}: документа нет${closing ? " (закрытие остатка до начала учёта)" : ""}`,
          href: payHref(p),
          priority: closing ? ("gray" as const) : ("yellow" as const),
        };
      }),
  });

  // 7. Авансы без привязки
  add({
    key: "advances-unlinked",
    section: "purchases",
    title: "Авансы без привязки к аукциону",
    why: "Деньги ушли поставщику, но не отнесены ни к аукциону, ни к закупке: в «Оплатах» остаток аукциона завышен, а на Сводке аванс гасит общий долг.",
    items: supplierPayments
      .filter((p) => !p.purchaseId && !p.auctionSession)
      .map((p) => ({
        id: p.id,
        text: `${p.supplier.name}: аванс ${formatMoney(p.amount.toString())} от ${formatDate(p.paidAt)} не привязан`,
        href: "/payments",
        linkLabel: "Привязать",
        priority: "red" as const,
      })),
  });

  // 8. Аукционы без оплат
  const activeSummaries = summaries.filter((a) => a.purchases > 0);
  add({
    key: "auctions-unpaid",
    section: "purchases",
    title: "Аукционы с остатком к оплате и без единой оплаты",
    why: "Мех принят (или заказан), а ни одной оплаты нет: либо платёж не внесён, либо долг реальный и его пора платить.",
    items: activeSummaries
      .filter((a) => a.remaining.greaterThan(PAY_EPS) && a.paid.lessThanOrEqualTo(PAY_EPS))
      .map((a) => {
        const draftOnly = a.perPurchase.every((x) => x.status !== "RECEIVED");
        return {
          id: a.name,
          text: `${a.name}: остаток ${formatMoney(a.remaining.toString())}, оплат нет${draftOnly ? " (мех ещё не принят)" : ""}${a.planned.greaterThan(0) ? `, запланировано ${formatMoney(a.planned.toString())}` : ""}`,
          href: `/payments?auction=${encodeURIComponent(a.name)}#auction-block`,
          priority: draftOnly ? ("gray" as const) : ("red" as const),
        };
      }),
  });

  // 9. Переплаты
  const overItems: AttentionItem[] = activeSummaries
    .filter((a) => a.remaining.lessThan(PAY_EPS.neg()))
    .map((a) => ({
      id: `a-${a.name}`,
      text: `${a.name}: оплачено больше стоимости на ${formatMoney(a.remaining.neg().toString())}`,
      href: `/payments?auction=${encodeURIComponent(a.name)}#auction-block`,
      priority: "yellow" as const,
    }));
  // Закупки без аукциона: переплата считается по самой закупке.
  const purchaseTotals = await db.purchase.findMany({
    where: { organizationId, status: { not: "CANCELLED" }, auctionSession: null },
    include: { items: true, expenses: true },
  });
  const paidById = new Map(purchases.map((l) => [l.id, l.payments.reduce((s, x) => s.add(x.amount), new Decimal(0))]));
  for (const p of purchaseTotals) {
    const over = (paidById.get(p.id) ?? new Decimal(0)).sub(purchaseTotalInclVat(p));
    if (over.greaterThan(PAY_EPS))
      overItems.push({
        id: `p-${p.id}`,
        text: `Закупка ${p.number}: оплачено больше стоимости на ${formatMoney(over.toString())}`,
        href: pHref(p.id),
        priority: "yellow",
      });
  }
  add({
    key: "overpaid",
    section: "purchases",
    title: "Переплаты поставщикам",
    why: "Оплачено больше, чем стоит мех. Либо оплата привязана не к той закупке, либо поставщик должен вернуть или зачесть деньги.",
    items: overItems,
  });

  // --------------------------------------------------------- ПРОИЗВОДСТВО
  const [orders, batches, tzAppendix, productionPayments, bomRows, lotRemain] = await Promise.all([
    db.productionOrder.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      select: {
        id: true, number: true, status: true, notes: true, materialDescription: true, workOrderDate: true,
        endDate: true, batchId: true, clientId: true, contractNumber: true, productModelId: true,
        productModel: { select: { name: true } },
        client: { select: { name: true } },
        materialUsages: { select: { rawMaterialId: true, commission4: true } },
      },
      orderBy: { number: "asc" },
    }),
    db.productionBatch.findMany({
      where: { organizationId },
      select: { id: true, number: true, name: true, orders: { where: { status: { not: "CANCELLED" } }, select: { id: true } } },
      orderBy: { number: "asc" },
    }),
    db.driveDocument.findMany({
      where: { organizationId, OR: [{ docType: "TZ_APPENDIX", productionOrderId: { not: null } }, { productionBatchId: { not: null } }, { productionOrderId: { not: null } }] },
      select: { docType: true, productionOrderId: true, productionBatchId: true },
    }),
    db.productionPayment.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      select: {
        id: true, amount: true, paidAt: true, confirmed: true, paymentType: true,
        client: { select: { name: true } },
        driveDocuments: { select: { id: true }, take: 1 },
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
  const tLabel = (o: (typeof orders)[number]) => `ТЗ ${o.number} (${o.productModel.name}${o.client ? `, ${o.client.name}` : ""})`;
  /** Сырьё не со склада: пометка в заметках либо все списания без надбавки 4%. */
  const nonStock = (o: (typeof orders)[number]) =>
    NON_STOCK_RE.test(`${o.notes ?? ""} ${o.materialDescription ?? ""}`) ||
    (o.materialUsages.length > 0 && o.materialUsages.every((u) => !u.commission4));

  // 10. ТЗ без списаний сырья
  add({
    key: "tz-no-usage",
    section: "production",
    title: "ТЗ без списаний сырья",
    why: "Себестоимость такого ТЗ — ноль или неполная, а склад не знает, откуда взят мех. Если сырьё не со склада (лоскут, бобр, давальческое), укажите это в заметках ТЗ.",
    items: orders
      .filter((o) => o.materialUsages.length === 0)
      .map((o) => {
        const ns = NON_STOCK_RE.test(`${o.notes ?? ""} ${o.materialDescription ?? ""}`);
        return {
          id: o.id,
          text: `${tLabel(o)}: списаний нет${o.notes ? ` — «${cut(o.notes)}»` : ""}`,
          href: tHref(o.id),
          priority: ns ? ("gray" as const) : o.status === "PLANNED" ? ("yellow" as const) : ("red" as const),
        };
      }),
  });

  // 11–13. Реквизиты ТЗ
  add({
    key: "tz-no-date",
    section: "production",
    title: "ТЗ без даты",
    why: "Без даты ТЗ нельзя разместить на оси времени и сверить с документами заказчика. (В ТЗ 1–96 дата в документах шаблонная — решение владельца, см. «Проверьте дату ТЗ».)",
    items: orders.filter((o) => !o.workOrderDate).map((o) => ({ id: o.id, text: `${tLabel(o)}: даты ТЗ нет`, href: tHref(o.id), priority: "yellow" as const })),
  });
  add({
    key: "tz-no-batch",
    section: "production",
    title: "ТЗ без партии",
    why: "Партия связывает ТЗ с поставкой, счётом и оплатой заказчика. Вне партии ТЗ не попадает в сверку по поставкам.",
    items: orders.filter((o) => !o.batchId).map((o) => ({ id: o.id, text: `${tLabel(o)}: партия не указана`, href: tHref(o.id), priority: "yellow" as const })),
  });
  add({
    key: "tz-no-client",
    section: "production",
    title: "ТЗ без клиента или договора",
    why: "Без заказчика ТЗ не попадает в «Долг заказчиков». Если это собственное производство — ничего делать не нужно.",
    items: orders
      .filter((o) => !o.clientId || !o.contractNumber?.trim())
      .map((o) => ({
        id: o.id,
        text: `${tLabel(o)}: ${!o.clientId ? "заказчик не указан" : "номер договора не указан"}`,
        href: tHref(o.id),
        priority: !o.clientId ? ("yellow" as const) : ("gray" as const),
      })),
  });

  // 14. Завершённые без даты выпуска / с датой импорта
  add({
    key: "tz-end-date",
    section: "production",
    title: "Завершённые ТЗ без даты выпуска или с датой импорта",
    why: "Дата 01.10.2026 — день загрузки данных, а не поставки. Из-за неё выпуск попадает не в тот период, а отгрузки и оплаты не сходятся по срокам.",
    items: orders
      .filter((o) => o.status === "COMPLETED" && (!o.endDate || isImportDay(o.endDate)))
      .map((o) => ({
        id: o.id,
        text: `${tLabel(o)}: ${o.endDate ? `дата выпуска ${formatDate(o.endDate)} — дата импорта` : "даты выпуска нет"}`,
        href: tHref(o.id),
        priority: "yellow" as const,
      })),
  });

  // 15–16. Партии
  const paidOrderIds = new Set<string>();
  for (const p of productionPayments) for (const l of p.orders) paidOrderIds.add(l.productionOrderId);
  const docBatchIds = new Set<string>();
  const docOrderIds = new Set<string>();
  const appendixOrderIds = new Set<string>();
  for (const d of tzAppendix) {
    if (d.productionBatchId) docBatchIds.add(d.productionBatchId);
    if (d.productionOrderId) docOrderIds.add(d.productionOrderId);
    if (d.docType === "TZ_APPENDIX" && d.productionOrderId) appendixOrderIds.add(d.productionOrderId);
  }
  const bLabel = (b: (typeof batches)[number]) => `Партия ${b.number}${b.name ? ` «${b.name}»` : ""}`;
  const nonEmptyBatches = batches.filter((b) => b.orders.length > 0);
  add({
    key: "batch-no-payment",
    section: "production",
    title: "Партии без оплат",
    why: "По партии не заведено ни одной оплаты заказчика: непонятно, оплачена она или нет, а «Долг заказчиков» завышен.",
    items: nonEmptyBatches
      .filter((b) => !b.orders.some((o) => paidOrderIds.has(o.id)))
      .map((b) => ({ id: b.id, text: `${bLabel(b)} (${b.orders.length} ТЗ): оплат нет`, href: `/production/batches/${b.number}`, priority: "yellow" as const })),
  });
  add({
    key: "batch-no-docs",
    section: "production",
    title: "Партии без документов",
    why: "К партии не приложены ни счёт, ни расчёт, ни акт: сумму партии нечем подтвердить.",
    items: nonEmptyBatches
      .filter((b) => !docBatchIds.has(b.id) && !b.orders.some((o) => docOrderIds.has(o.id)))
      .map((b) => ({ id: b.id, text: `${bLabel(b)} (${b.orders.length} ТЗ): документов нет`, href: `/production/batches/${b.number}`, priority: "yellow" as const })),
  });

  // 17. ТЗ без приложения
  add({
    key: "tz-no-appendix",
    section: "production",
    title: "ТЗ без документа-приложения",
    why: "Приложение к договору (ТЗ заказчика) — основание цены и количества. Без него спор с заказчиком нечем закрыть.",
    items: orders
      .filter((o) => !appendixOrderIds.has(o.id))
      .map((o) => ({ id: o.id, text: `${tLabel(o)}: приложения ТЗ нет`, href: tHref(o.id), priority: "yellow" as const })),
  });

  // 18. Запланированные ТЗ с нулевым остатком сырья
  const remainByMaterial = new Map(lotRemain.map((r) => [r.rawMaterialId, r._sum.quantityRemaining ?? new Decimal(0)]));
  const bomByModel = new Map<string, typeof bomRows>();
  for (const b of bomRows) bomByModel.set(b.productModelId, [...(bomByModel.get(b.productModelId) ?? []), b]);
  add({
    key: "tz-planned-no-stock",
    section: "production",
    title: "ТЗ «Запланировано» с нулевым остатком сырья",
    why: "Запустить ТЗ нечем: на складе нет сырья по составу изделия. Нужна закупка (или сырьё не со склада — тогда отметьте это в заметках).",
    items: orders
      .filter((o) => o.status === "PLANNED")
      .flatMap<AttentionItem>((o) => {
        const used = new Set(o.materialUsages.map((u) => u.rawMaterialId));
        const empty = (bomByModel.get(o.productModelId) ?? []).filter(
          (b) => !used.has(b.rawMaterialId) && !(remainByMaterial.get(b.rawMaterialId) ?? new Decimal(0)).greaterThan(0)
        );
        if (empty.length === 0) return [];
        const names = empty.map((b) => b.rawMaterial.name).join(", ");
        return [{
          id: o.id,
          text: `${tLabel(o)}: на складе нулевой остаток — ${names}`,
          href: tHref(o.id),
          priority: nonStock(o) || NON_STOCK_RE.test(`${o.notes ?? ""}`) ? ("gray" as const) : ("red" as const),
        }];
      }),
  });

  // 19. Оплаты производства без документа
  add({
    key: "prod-payments-no-doc",
    section: "production",
    title: "Оплаты заказчиков без документа",
    why: "К поступлению денег не приложена платёжка или счёт: сумму нечем подтвердить, особенно если платёж помечен как неподтверждённый.",
    items: productionPayments
      .filter((p) => p.driveDocuments.length === 0)
      .map((p) => ({
        id: p.id,
        text: `${p.client?.name ?? "Заказчик не указан"}: ${formatMoney(p.amount.toString())} от ${formatDate(p.paidAt)}${p.confirmed ? "" : ", платёжка не подтверждена"} — документа нет`,
        href: p.orders[0] ? tHref(p.orders[0].productionOrderId) : "/production",
        priority: p.confirmed ? ("yellow" as const) : ("red" as const),
      })),
  });

  // «Проверьте дату ТЗ»: шаблонные даты из документов
  // Шаблонные даты: 12.01.2026 (копия из ТЗ 97–115) и 17.03.2026 (ТЗ 118, возможно 17.06).
  const T_JAN = [2026, 1, 12];
  const T_MAR = [2026, 3, 17];
  const SUSPECT = new Map<number, number[][]>([[113, [T_JAN]], [114, [T_JAN]], [115, [T_JAN]], [118, [T_MAR, T_JAN]]]);
  add({
    key: "tz-check-date",
    section: "production",
    title: "Проверьте дату ТЗ",
    why: "Дата стоит такая же, как на других ТЗ (шаблон), хотя счёт и поставка — летом 2026. Для ТЗ 118 возможна опечатка: 17.03 вместо 17.06. Поправьте в карточке или подтвердите.",
    items: orders.flatMap<AttentionItem>((o) => {
      const s = SUSPECT.get(tzOrdinal(o.number));
      const d = o.workOrderDate;
      if (!s || !d) return [];
      if (!s.some(([y, m, day]) => d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m && d.getUTCDate() === day)) return [];
      return [{ id: o.id, text: `${tLabel(o)}: дата ТЗ ${formatDate(d)} — похожа на шаблон`, href: tHref(o.id), priority: "yellow" as const }];
    }),
  });

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
  add({
    key: "models-dupes",
    section: "data",
    title: "Модели-дубли (кириллица и латиница)",
    why: "Одна и та же модель заведена дважды (например, «МН07» русской и английской буквой): остатки, ТЗ и цены разъезжаются по двум карточкам.",
    items: Array.from(byNorm.values())
      .filter((g) => g.length > 1)
      .map((g) => ({
        id: g[0].id,
        text: `Совпадают после нормализации: ${g.map((m) => `«${m.name}»`).join(" и ")}`,
        href: `/models/${g[0].id}`,
        priority: "yellow" as const,
      })),
  });
  add({
    key: "materials-no-category",
    section: "data",
    title: "Материалы без категории",
    why: "Без категории материал не попадает в группировки и фильтры справочника.",
    items: materialsNoCat.map((m) => ({ id: m.id, text: `Материал «${m.name}»: категория не указана`, href: `/materials/${m.id}`, priority: "gray" as const })),
  });
  add({
    key: "suppliers-no-inn",
    section: "data",
    title: "Поставщики без ИНН",
    why: "ИНН нужен, чтобы сверять счета и УПД и не плодить дубли поставщиков.",
    items: suppliersNoInn.map((s) => ({ id: s.id, text: `Поставщик «${s.name}»: ИНН не указан`, href: `/suppliers/${s.id}`, priority: "gray" as const })),
  });
  add({
    key: "clients-no-inn",
    section: "data",
    title: "Заказчики без ИНН",
    why: "ИНН нужен, чтобы сверять договоры и счета с документами заказчика.",
    items: clientsNoInn.map((c) => ({ id: c.id, text: `Заказчик «${c.name}»: ИНН не указан`, href: `/clients/${c.id}`, priority: "gray" as const })),
  });

  return checks;
}

/** Сколько записей требует внимания: красные и жёлтые (серые — справочно). */
export function countAttention(checks: AttentionCheck[]) {
  let main = 0;
  let gray = 0;
  let red = 0;
  for (const c of checks)
    for (const i of c.items) {
      if (i.priority === "gray") gray++;
      else {
        main++;
        if (i.priority === "red") red++;
      }
    }
  return { main, gray, red };
}
