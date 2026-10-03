import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import type { PrismaClient } from "@prisma/client";
import { auctionName, loadAuctionSummaries, PAY_EPS } from "@/lib/auction-payments";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { formatDate, formatMoney } from "@/lib/utils";

/**
 * «Что не заведено»: живые проверки полноты данных, ничего не хранится.
 * Отменённые закупки, ТЗ и оплаты не считаются. Документные пробелы — на /documents (doc-coverage.ts).
 */

export type AttentionPriority = "red" | "yellow" | "gray";
export type AttentionSection = "purchases" | "production" | "data";
export type AttentionKind = "purchase" | "payment" | "auction" | "tz" | "batch" | "model" | "material" | "supplier" | "client";

/** Одна проблема сущности: короткая формулировка (бейдж). */
export type AttentionProblem = {
  text: string;
  priority: AttentionPriority;
  /** Ссылка именно на эту проблему (если ведёт не туда же, куда сама сущность). */
  href?: string;
  linkLabel?: string;
};

/**
 * Принцип «одна запись — один источник»: каждая сущность (закупка, оплата, аукцион, ТЗ, партия, справочник)
 * показывается один раз, а все её проблемы — списком бейджей. Проблемы про ДОКУМЕНТЫ здесь не считаются —
 * они живут только на странице «Покрытие документами» (/documents).
 */
export type AttentionEntity = {
  id: string;
  kind: AttentionKind;
  section: AttentionSection;
  /** Что это: «Закупка З-2026-0010». */
  title: string;
  sub?: string;
  href: string;
  problems: AttentionProblem[];
  /** Высший приоритет среди проблем. */
  priority: AttentionPriority;
};

export const SECTION_LABELS: Record<AttentionSection, string> = {
  purchases: "Закупки",
  production: "Производство",
  data: "Данные",
};

export const KIND_LABELS: Record<AttentionKind, string> = {
  purchase: "Закупки",
  payment: "Оплаты поставщику",
  auction: "Аукционы",
  tz: "ТЗ",
  batch: "Партии производства",
  model: "Модели изделий",
  material: "Материалы",
  supplier: "Поставщики",
  client: "Заказчики",
};
export const KIND_ORDER: AttentionKind[] = ["purchase", "payment", "auction", "tz", "batch", "model", "material", "supplier", "client"];
export const KIND_SECTION: Record<AttentionKind, AttentionSection> = {
  purchase: "purchases", payment: "purchases", auction: "purchases",
  tz: "production", batch: "production",
  model: "data", material: "data", supplier: "data", client: "data",
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


export async function computeAttention(db: PrismaClient, organizationId: string): Promise<AttentionEntity[]> {
  const today = new Date();
  const entities = new Map<string, AttentionEntity>();
  /** Сущность создаётся при первой проблеме; повторные проблемы дописываются в неё же. */
  const flag = (
    kind: AttentionKind,
    key: string,
    base: { title: string; sub?: string; href: string },
    problem: AttentionProblem
  ) => {
    const id = `${kind}:${key}`;
    let e = entities.get(id);
    if (!e) {
      e = { id, kind, section: KIND_SECTION[kind], ...base, problems: [], priority: "gray" };
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
        expectedDate: true, supplier: { select: { name: true } },
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
    loadAuctionSummaries(db, organizationId),
  ]);

  const pHref = (id: string) => `/purchases/${id}`;
  const purchaseById = new Map(purchases.map((p) => [p.id, p]));
  const flagPurchase = (id: string, problem: AttentionProblem) => {
    const p = purchaseById.get(id);
    if (!p) return;
    const a = auctionName(p.auctionSession);
    flag("purchase", id, { title: `Закупка ${p.number}`, sub: `${p.supplier.name}${a ? `, ${a}` : ""}${p.status === "RECEIVED" ? "" : " · черновик"}`, href: pHref(id) }, problem);
  };

  // Аукцион без аукциона / «Нет информации»
  for (const p of purchases) {
    const n = auctionName(p.auctionSession);
    if (!n || /^нет информации/i.test(n.trim()))
      flagPurchase(p.id, { text: n ? "аукцион — «Нет информации»" : "аукцион не указан", priority: "yellow" });
    // Даты
    if (isImportDay(p.orderDate)) flagPurchase(p.id, { text: `дата заказа ${formatDate(p.orderDate)} — дата импорта`, priority: "yellow" });
    if (p.status === "RECEIVED" && !p.receivedDate) flagPurchase(p.id, { text: "принята, но даты прихода нет", priority: "yellow" });
    // Ожидаемые поставки (мех не принят)
    if (p.status !== "RECEIVED" && p.expectedDate) {
      const late = p.expectedDate < today;
      flagPurchase(p.id, {
        text: `мех не принят: ожидается ${formatDate(p.expectedDate)}${late ? " — срок прошёл" : ""}`,
        priority: late ? "yellow" : "gray",
      });
    }
  }

  // Лоты с датой-заглушкой
  const stubByPurchase = new Map<string, number>();
  let stubNoPurchase = 0;
  for (const l of lotsWithStub) {
    if (!l.purchaseId || !l.purchase) stubNoPurchase++;
    else stubByPurchase.set(l.purchaseId, (stubByPurchase.get(l.purchaseId) ?? 0) + 1);
  }
  for (const [id, n] of stubByPurchase)
    flagPurchase(id, { text: `лотов с датой прихода 01.10.2026 (дата импорта): ${n}`, priority: "yellow" });
  if (stubNoPurchase > 0)
    flag("purchase", "no-purchase-lots", { title: "Лоты без закупки", sub: "склад", href: "/lots" }, { text: `лотов с датой прихода 01.10.2026 (дата импорта): ${stubNoPurchase}`, priority: "gray" });

  // Оплаты поставщику
  const payLabel = (p: (typeof supplierPayments)[number]) => ({
    title: `${p.supplier.name}, ${formatMoney(p.amount.toString())}${p.currency !== "RUB" ? ` (${p.currency})` : ""}`,
    sub: `${formatDate(p.paidAt)} · ${p.purchase ? `закупка ${p.purchase.number}` : p.auctionSession ? `аукцион ${auctionName(p.auctionSession)}` : "без привязки"}`,
  });
  const payHref = (p: (typeof supplierPayments)[number]) =>
    p.purchaseId ? pHref(p.purchaseId) : p.auctionSession ? `/payments?auction=${encodeURIComponent(auctionName(p.auctionSession) ?? "")}#auction-block` : "/payments";
  const flagPayment = (p: (typeof supplierPayments)[number], problem: AttentionProblem) =>
    flag("payment", p.id, { ...payLabel(p), href: payHref(p) }, problem);

  for (const p of supplierPayments) {
    if (!p.confirmed)
      flagPayment(p, { text: `платёжки нет${p.docRef ? ` (основание: ${cut(p.docRef, 60)})` : ""}; пока её нет, долг занижен на эту сумму`, priority: "red" });
  }
  // Авансы без привязки. Аукционы «без единой оплаты» привязываем к этому же авансу: это одна причина, а не две записи.
  const advances = supplierPayments.filter((p) => !p.purchaseId && !p.auctionSession);
  const mainAdvance = [...advances].sort((a, b) => b.amount.comparedTo(a.amount))[0];
  for (const p of advances)
    flagPayment(p, { text: "аванс не привязан ни к аукциону, ни к закупке", href: "/payments", linkLabel: "Привязать", priority: "red" });

  // Аукционы: остаток без оплат и переплаты. Аукцион из одной закупки — проблема этой закупки, не отдельная запись;
  // принятый аукцион без оплат при наличии непривязанного аванса — часть записи этого аванса.
  const activeSummaries = summaries.filter((a) => a.purchases > 0);
  for (const a of activeSummaries) {
    const href = `/payments?auction=${encodeURIComponent(a.name)}#auction-block`;
    const single = a.perPurchase.length === 1 ? a.perPurchase[0].id : null;
    const attach = (problem: AttentionProblem) =>
      single && purchaseById.has(single)
        ? flagPurchase(single, { ...problem, href })
        : flag("auction", a.name, { title: `Аукцион ${a.name}`, sub: `${a.perPurchase.length} закуп.`, href }, problem);

    if (a.remaining.greaterThan(PAY_EPS) && a.paid.lessThanOrEqualTo(PAY_EPS)) {
      const draftOnly = a.perPurchase.every((x) => x.status !== "RECEIVED");
      const text = `оплат по аукциону нет, остаток ${formatMoney(a.remaining.toString())}${draftOnly ? " (мех ещё не принят)" : ""}${a.planned.greaterThan(0) ? `, запланировано ${formatMoney(a.planned.toString())}` : ""}`;
      if (!draftOnly && mainAdvance)
        flagPayment(mainAdvance, { text: `аукцион ${a.name}: ${text}; возможно, этот аванс — за него`, href, priority: "red" });
      else attach({ text, priority: draftOnly ? "gray" : "red" });
    }
    if (a.remaining.lessThan(PAY_EPS.neg()))
      attach({ text: `оплачено больше стоимости аукциона на ${formatMoney(a.remaining.neg().toString())}`, priority: "yellow" });
  }
  // Закупки без аукциона: переплата считается по самой закупке.
  const purchaseTotals = await db.purchase.findMany({
    where: { organizationId, status: { not: "CANCELLED" }, auctionSession: null },
    include: { items: true, expenses: true },
  });
  const paidById = new Map(purchases.map((l) => [l.id, l.payments.reduce((s, x) => s.add(x.amount), new Decimal(0))]));
  for (const p of purchaseTotals) {
    const over = (paidById.get(p.id) ?? new Decimal(0)).sub(purchaseTotalInclVat(p));
    if (over.greaterThan(PAY_EPS)) flagPurchase(p.id, { text: `оплачено больше стоимости на ${formatMoney(over.toString())}`, priority: "yellow" });
  }

  // --------------------------------------------------------- ПРОИЗВОДСТВО
  const [orders, batches, productionPayments, bomRows, lotRemain] = await Promise.all([
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
    db.productionPayment.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      select: { orders: { select: { productionOrderId: true } } },
    }),
    db.productModelMaterial.findMany({
      where: { productModel: { organizationId } },
      select: { productModelId: true, rawMaterialId: true, rawMaterial: { select: { name: true, unit: true } } },
    }),
    db.rawMaterialLot.groupBy({ by: ["rawMaterialId"], where: { organizationId }, _sum: { quantityRemaining: true } }),
  ]);

  const tHref = (id: string) => `/production/${id}`;
  const flagTz = (o: (typeof orders)[number], problem: AttentionProblem) =>
    flag("tz", o.id, { title: `ТЗ ${o.number}`, sub: `${o.productModel.name}${o.client ? `, ${o.client.name}` : ""}`, href: tHref(o.id) }, problem);
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
    // Списания сырья
    if (o.materialUsages.length === 0) {
      const ns = NON_STOCK_RE.test(`${o.notes ?? ""} ${o.materialDescription ?? ""}`);
      flagTz(o, {
        text: `списаний сырья нет${o.notes ? ` — «${cut(o.notes, 60)}»` : ""}`,
        priority: ns ? "gray" : o.status === "PLANNED" ? "yellow" : "red",
      });
    }
    // Даты ТЗ: нет даты / дата импорта / шаблонная дата (одна группа проблем)
    if (!o.workOrderDate) flagTz(o, { text: "даты ТЗ нет", priority: "yellow" });
    else {
      const s = SUSPECT.get(tzOrdinal(o.number));
      const d = o.workOrderDate;
      if (s?.some(([y, m, day]) => d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m && d.getUTCDate() === day))
        flagTz(o, { text: `дата ТЗ ${formatDate(d)} — похожа на шаблон, проверьте`, priority: "yellow" });
    }
    if (o.status === "COMPLETED" && (!o.endDate || isImportDay(o.endDate)))
      flagTz(o, { text: o.endDate ? `дата выпуска ${formatDate(o.endDate)} — дата импорта` : "даты выпуска нет", priority: "yellow" });
    // Реквизиты
    if (!o.batchId) flagTz(o, { text: "партия не указана", priority: "yellow" });
    if (!o.clientId) flagTz(o, { text: "заказчик не указан", priority: "yellow" });
    else if (!o.contractNumber?.trim()) flagTz(o, { text: "номер договора не указан", priority: "gray" });
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
        });
    }
  }

  // Партии: без оплат заказчика
  const paidOrderIds = new Set<string>();
  for (const p of productionPayments) for (const l of p.orders) paidOrderIds.add(l.productionOrderId);
  for (const b of batches) {
    if (b.orders.length === 0 || b.orders.some((o) => paidOrderIds.has(o.id))) continue;
    flag(
      "batch",
      b.id,
      { title: `Партия ${b.number}${b.name ? ` «${b.name}»` : ""}`, sub: `${b.orders.length} ТЗ`, href: `/production/batches/${b.number}` },
      { text: "оплат заказчика нет", priority: "yellow" }
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
      { text: `заведена дважды (кириллица и латиница): ${g.map((m) => `«${m.name}»`).join(" и ")}`, priority: "yellow" }
    );
  }
  for (const m of materialsNoCat)
    flag("material", m.id, { title: `Материал «${m.name}»`, href: `/materials/${m.id}` }, { text: "категория не указана", priority: "gray" });
  for (const s of suppliersNoInn)
    flag("supplier", s.id, { title: `Поставщик «${s.name}»`, href: `/suppliers/${s.id}` }, { text: "ИНН не указан", priority: "gray" });
  for (const c of clientsNoInn)
    flag("client", c.id, { title: `Заказчик «${c.name}»`, href: `/clients/${c.id}` }, { text: "ИНН не указан", priority: "gray" });

  // Итог: проблемы по важности, сущности — по важности и названию.
  const out = Array.from(entities.values());
  for (const e of out) {
    e.problems.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    e.priority = e.problems[0].priority;
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
