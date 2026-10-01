import { escapeLike } from "@/lib/input";
import { auctionName as auctionNameLib, loadAuctionSummaries, AUCTION_PAY_STATUS_LABELS } from "@/lib/auction-payments";
import { formatMoney } from "@/lib/utils";
import Link from "next/link";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatDate, formatQty } from "@/lib/utils";
import { Money } from "@/components/money";
import { lotUnitCostExclVat } from "@/lib/purchase-totals";
import { DOC_KIND_LABELS } from "@/lib/purchase-files";
import { AuctionDocUpload, DocEditControls, ToggleAllPurchases } from "./auction-controls";
import { buildAuctionRows } from "./auction-rows";
import { LotsProvider } from "./lots-state";
import { AuctionTotalsPanel, FlatLotsPanel, PurchaseCostParts, PurchaseLotsTable } from "./lots-table";
import { CUSTOM_FIELD_ENTITY } from "@/lib/custom-fields";
import { DriveDocuments } from "@/components/drive-documents";
import { toDriveView } from "@/lib/drive-docs-server";

const UNIT_LABELS: Record<string, string> = { PIECE: "шт.", KG: "кг", M2: "м²", M: "м", SET: "компл." };

/** Название аукциона/партии — первая строка Purchase.auctionSession (так же, как у документов партии). */
export const auctionName = auctionNameLib;

export type AuctionSummary = {
  name: string;
  count: number;
  received: number;
  draft: number;
  cancelled: number;
  lastDate: number;
};

export function auctionStatusText(a: Pick<AuctionSummary, "count" | "received" | "draft" | "cancelled">): string {
  const parts: string[] = [];
  if (a.received && !a.draft && !a.cancelled) parts.push("принято");
  else if (a.draft && !a.received && !a.cancelled) parts.push("черновики");
  else {
    if (a.received) parts.push(`принято ${a.received}`);
    if (a.draft) parts.push(`черновиков ${a.draft}`);
    if (a.cancelled) parts.push(`отменено ${a.cancelled}`);
  }
  return parts.join(", ");
}

export function pluralPurchases(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} закупка`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} закупки`;
  return `${n} закупок`;
}

/** Все аукционы организации (distinct Purchase.auctionSession): число закупок, статусы, дата последней. */
export async function loadAuctions(organizationId: string): Promise<AuctionSummary[]> {
  const rows = await prisma.purchase.findMany({
    where: { organizationId, auctionSession: { not: null } },
    select: { auctionSession: true, status: true, orderDate: true },
  });
  const map = new Map<string, AuctionSummary>();
  for (const r of rows) {
    const name = auctionName(r.auctionSession);
    if (!name) continue;
    const a = map.get(name) ?? { name, count: 0, received: 0, draft: 0, cancelled: 0, lastDate: 0 };
    a.count++;
    if (r.status === "RECEIVED") a.received++;
    else if (r.status === "CANCELLED") a.cancelled++;
    else a.draft++;
    a.lastDate = Math.max(a.lastDate, r.orderDate.getTime());
    map.set(name, a);
  }
  return Array.from(map.values()).sort((a, b) => b.lastDate - a.lastDate || a.name.localeCompare(b.name, "ru"));
}

type Plan = { unitCostInclVat: Decimal; materialExclVat: Decimal; expenseExclVat: Decimal; costBreakdown: unknown };

function parsePlan(raw: unknown): Plan | null {
  const c = raw as Record<string, unknown> | null | undefined;
  if (!c || typeof c !== "object") return null;
  try {
    if (c.unitCostInclVat == null || c.materialExclVat == null || c.expenseExclVat == null) return null;
    return {
      unitCostInclVat: new Decimal(String(c.unitCostInclVat)),
      materialExclVat: new Decimal(String(c.materialExclVat)),
      expenseExclVat: new Decimal(String(c.expenseExclVat)),
      costBreakdown: c.costBreakdown,
    };
  } catch {
    return null;
  }
}

const grossUp = (base: Decimal, vat: Decimal) => base.add(base.mul(vat).div(100));

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
}

/** Версия файла для ссылки (сброс кэша при замене) — по имени файла на диске, а не по дате документа. */
const docVersion = (storagePath: string) => encodeURIComponent(storagePath.split(/[\\/]/).pop() ?? "");

const rateText = (r: Decimal) => Number(r.toString()).toLocaleString("ru-RU", { maximumFractionDigits: 6 });

export async function AuctionView({
  organizationId,
  names,
  label,
  q,
  materialId,
  canEdit,
  view = "invoices",
}: {
  organizationId: string;
  /** Названия аукционов, подходящих под фильтр (точное совпадение, иначе — вхождение в название). */
  names: string[];
  label: string;
  q: string;
  materialId: string;
  canEdit: boolean;
  /** Вид: «По счетам» (сворачиваемые блоки) или «Списком лотов» (плоская таблица) */
  view?: "invoices" | "lots";
}) {
  const flat = view === "lots";
  const viewHref = (v: "invoices" | "lots") => {
    const qs = new URLSearchParams({ auction: label });
    if (q) qs.set("q", q);
    if (materialId) qs.set("material", materialId);
    if (v === "lots") qs.set("view", "lots");
    return `/lots?${qs.toString()}`;
  };
  const filtering = Boolean(q || materialId);
  // Закупки аукциона: ищем по первой строке auctionSession.
  const candidates = await prisma.purchase.findMany({
    where: { organizationId, auctionSession: { not: null } },
    select: { id: true, auctionSession: true },
  });
  const ids = candidates.filter((p) => names.includes(auctionName(p.auctionSession) ?? "")).map((p) => p.id);

  const itemWhere = {
    rawMaterial: { unit: { not: "M" as const }, ...(materialId ? { id: materialId } : {}) },
    ...(q
      ? {
          OR: [
            { lotNumber: { contains: escapeLike(q), mode: "insensitive" as const } },
            { color: { contains: escapeLike(q), mode: "insensitive" as const } },
            { grade: { contains: escapeLike(q), mode: "insensitive" as const } },
            { notes: { contains: escapeLike(q), mode: "insensitive" as const } },
            { rawMaterial: { name: { contains: escapeLike(q), mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [purchasesRaw, batchDocs, paySummaries] = await Promise.all([
    prisma.purchase.findMany({
      where: { organizationId, id: { in: ids } },
      include: {
        supplier: true,
        expenses: { include: { category: true }, orderBy: { date: "asc" } },
        documents: { orderBy: { createdAt: "asc" } },
        items: {
          where: itemWhere,
          include: {
            rawMaterial: true,
            lot: { include: { usages: { include: { productionOrder: true } } } },
          },
          orderBy: { id: "asc" },
        },
      },
      orderBy: [{ orderDate: "asc" }, { number: "asc" }],
    }),
    prisma.purchaseDocument.findMany({
      where: { organizationId, purchaseId: null, batch: { in: names } },
      orderBy: { createdAt: "asc" },
    }),
    loadAuctionSummaries(prisma, organizationId, names),
  ]);
  const payTotal = paySummaries.reduce((s, a) => s.add(a.total), new Decimal(0));
  const payPaid = paySummaries.reduce((s, a) => s.add(a.paid), new Decimal(0));
  const payPlanned = paySummaries.reduce((s, a) => s.add(a.planned), new Decimal(0));
  const payRemaining = payTotal.sub(payPaid);
  // Без фильтра показываем все закупки аукциона (и пустые); с фильтром — только те, где что-то нашлось.
  const purchases = filtering ? purchasesRaw.filter((p) => p.items.length > 0) : purchasesRaw;

  const zero = () => new Decimal(0);
  const blocks = purchases.map((p) => {
    const counted = p.status !== "CANCELLED";
    const lines = p.items.map((i) => {
      const plan = parsePlan(i.costPlan);
      const base = i.subtotal.mul(p.exchangeRate);
      const lotPriceIncl = grossUp(base, i.vatRate);
      let unitIncl: Decimal;
      let unitExcl: Decimal;
      let totalIncl: Decimal;
      let totalExcl: Decimal;
      let breakdown: unknown = null;
      let source: "lot" | "plan" | "price";
      if (i.lot) {
        unitIncl = i.lot.unitCost;
        unitExcl = lotUnitCostExclVat(i.lot);
        totalIncl = i.lot.totalCost;
        totalExcl = unitExcl.mul(i.quantity);
        breakdown = i.lot.costBreakdown;
        source = "lot";
      } else if (plan) {
        unitIncl = plan.unitCostInclVat;
        unitExcl = plan.materialExclVat.add(plan.expenseExclVat);
        totalIncl = unitIncl.mul(i.quantity);
        totalExcl = unitExcl.mul(i.quantity);
        breakdown = plan.costBreakdown;
        source = "plan";
      } else {
        totalIncl = lotPriceIncl;
        totalExcl = base;
        unitIncl = i.quantity.isZero() ? zero() : totalIncl.div(i.quantity);
        unitExcl = i.quantity.isZero() ? zero() : totalExcl.div(i.quantity);
        source = "price";
      }
      return { i, unitIncl, unitExcl, totalIncl, totalExcl, lotPriceIncl, base, breakdown, source };
    });
    // Расходы закупки у принятой уже распределены по лотам; у черновика — отдельной строкой.
    const expIncl = p.expenses.reduce((s, e) => s.add(grossUp(e.amount, e.vatRate)), zero());
    const expExcl = p.expenses.reduce((s, e) => s.add(e.amount), zero());
    const unallocated = p.status !== "RECEIVED" && p.status !== "CANCELLED" && !filtering;
    const sum = (f: (l: (typeof lines)[number]) => Decimal) => lines.reduce((acc, l) => acc.add(f(l)), zero());
    const qty = sum((l) => l.i.quantity);
    const pFullIncl = sum((l) => l.totalIncl).add(unallocated ? expIncl : zero());
    const pFullExcl = sum((l) => l.totalExcl).add(unallocated ? expExcl : zero());
    const pPriceIncl = sum((l) => l.lotPriceIncl);
    const pPriceExcl = sum((l) => l.base);
    const invoice = p.documents.find((d) => d.kind === "AUCTION_INVOICE") ?? null;
    return { p, counted, lines, qty, pFullIncl, pFullExcl, pPriceIncl, pPriceExcl, expIncl, expExcl, unallocated, invoice };
  });

  const counted = blocks.filter((b) => b.counted);
  const totalQty = counted.reduce((s, b) => s.add(b.qty), zero());
  const totalLots = counted.reduce((s, b) => s + b.lines.length, 0);
  const priceIncl = counted.reduce((s, b) => s.add(b.pPriceIncl), zero());
  const priceExcl = counted.reduce((s, b) => s.add(b.pPriceExcl), zero());
  const fullIncl = counted.reduce((s, b) => s.add(b.pFullIncl), zero());
  const fullExcl = counted.reduce((s, b) => s.add(b.pFullExcl), zero());
  const received = purchases.filter((p) => p.status === "RECEIVED").length;
  const cancelled = purchases.filter((p) => p.status === "CANCELLED").length;
  const drafts = purchases.length - received - cancelled;

  const statusParts = [
    received ? `принято: ${received}` : null,
    drafts ? `черновиков: ${drafts}` : null,
    cancelled ? `отменено: ${cancelled}` : null,
  ].filter(Boolean);

  // Свои столбцы организации и плоские данные лотов для клиентских таблиц (фильтры, выбор, «Итого»).
  const customFields = await prisma.customField.findMany({
    where: { organizationId, entity: CUSTOM_FIELD_ENTITY },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, type: true, position: true },
  });
  const lotsData = buildAuctionRows(blocks, UNIT_LABELS, canEdit);

  const docRows: { d: (typeof batchDocs)[number]; batch: boolean; purchaseId: string; purchaseLabel: string }[] = [
    ...batchDocs.map((d) => ({ d, batch: true, purchaseId: purchasesRaw[0]?.id ?? "", purchaseLabel: "" })),
    ...purchasesRaw.flatMap((p) =>
      p.documents.map((d) => ({ d, batch: false, purchaseId: p.id, purchaseLabel: p.invoiceNumber || p.number })),
    ),
  ];
  const editPurchaseId = purchasesRaw[0]?.id ?? "";

  // Документы Google Drive: закупок аукциона, их лотов и оплат.
  const driveLotIds = purchasesRaw.flatMap((p) => p.items.map((i) => i.lotId)).filter((x): x is string => !!x);
  const drivePayments = await prisma.payment.findMany({
    where: { organizationId, OR: [{ purchaseId: { in: ids } }, { auctionSession: { in: names } }] },
    select: { id: true },
  });
  const driveRows = await prisma.driveDocument.findMany({
    where: {
      organizationId,
      OR: [
        { purchaseId: { in: ids } },
        ...(driveLotIds.length ? [{ lotId: { in: driveLotIds } }] : []),
        ...(drivePayments.length ? [{ paymentId: { in: drivePayments.map((p) => p.id) } }] : []),
      ],
    },
    include: { lot: { select: { lotNumber: true } }, purchase: { select: { number: true, invoiceNumber: true } } },
    orderBy: [{ docDate: "asc" }, { createdAt: "asc" }],
  });
  const driveDocs = driveRows.map((d) =>
    toDriveView(
      d,
      d.lotId
        ? `лот ${d.lot?.lotNumber ?? "без номера"}`
        : d.paymentId
          ? "оплата"
          : d.purchase
            ? `закупка ${d.purchase.invoiceNumber || d.purchase.number}`
            : null,
    ),
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Аукцион: {label}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {names.length > 1 && (
            <p className="text-xs text-neutral-500">Под запрос подходят аукционы: {names.join(", ")}.</p>
          )}
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-neutral-500">Закупок / счетов</dt>
              <dd className="text-lg font-semibold">{counted.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Шкур всего</dt>
              <dd className="text-lg font-semibold">
                {formatQty(totalQty.toString())}
                <span className="ml-1 text-xs font-normal text-neutral-400">({totalLots} лот.)</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Статус</dt>
              <dd className="text-sm font-medium">{statusParts.join(" · ") || "—"}</dd>
            </div>
            <div>
              <dt
                className="text-xs text-neutral-500"
                title="Без сборов аукциона, выделки, транспорта и брокерских"
              >
                Стоимость шкур по счетам (цена лота × курс + НДС)
              </dt>
              <dd className="text-lg font-semibold">
                <Money incl={priceIncl} excl={priceExcl} />
              </dd>
              <dd className="text-xs text-neutral-400">без сборов аукциона, выделки, транспорта и брокерских</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Расходы сверх цены лотов</dt>
              <dd className="text-lg font-semibold">
                <Money incl={fullIncl.sub(priceIncl)} excl={fullExcl.sub(priceExcl)} />
              </dd>
              <dd className="text-xs text-neutral-400">сборы, выделка, транспорт, брокер</dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500">Полная себестоимость (с расходами)</dt>
              <dd className="text-lg font-semibold">
                <Money incl={fullIncl} excl={fullExcl} />
              </dd>
              <dd className="text-xs text-neutral-400">= стоимость шкур + расходы сверх цены лотов</dd>
            </div>
            {paySummaries.length > 0 && (
              <>
                <div>
                  <dt className="text-xs text-neutral-500">Оплачено поставщику (с НДС)</dt>
                  <dd className="text-lg font-semibold">{formatMoney(payPaid.toString())}</dd>
                  {payPlanned.greaterThan(0) && (
                    <dd className="text-xs text-neutral-400">запланировано {formatMoney(payPlanned.toString())}</dd>
                  )}
                </div>
                <div>
                  <dt className="text-xs text-neutral-500">Остаток к оплате (с НДС)</dt>
                  <dd className={"text-lg font-semibold " + (payRemaining.greaterThan(0.005) ? "text-amber-600" : "")}>
                    {formatMoney(payRemaining.toString())}
                  </dd>
                  <dd className="text-xs text-neutral-400">
                    {paySummaries.length === 1 ? AUCTION_PAY_STATUS_LABELS[paySummaries[0].status] : ""}
                  </dd>
                </div>
              </>
            )}
          </dl>
          {paySummaries.length > 0 && (
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {paySummaries.map((a) => (
                <Link key={a.name} href={`/payments?auction=${encodeURIComponent(a.name)}#auction-block`} className="text-blue-600 hover:underline">
                  Оплаты аукциона{paySummaries.length > 1 ? ` «${a.name}»` : ""} →
                </Link>
              ))}
            </p>
          )}
          {filtering && (
            <p className="text-xs text-amber-700">
              Включён фильтр по лотам/материалу — итоги считаются только по показанным лотам, расходы закупок в них не
              входят.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Вид аукциона" data-auction-view-switch>
            <span className="text-xs text-neutral-500">Вид:</span>
            {(
              [
                ["invoices", "По счетам"],
                ["lots", "Списком лотов"],
              ] as const
            ).map(([v, text]) => (
              <Link
                key={v}
                href={viewHref(v)}
                aria-current={view === v ? "page" : undefined}
                className={
                  "rounded-md border px-3 py-1 text-sm " +
                  (view === v ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700 hover:bg-neutral-100")
                }
              >
                {text}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-neutral-500">
              «Полная себестоимость» — расчёт лотов (сборы аукциона, выделка, транспорт, НДС) плюс расходы закупок. У
              черновиков лотов на складе ещё нет — цифры из расчёта.
            </p>
            {blocks.length > 0 && !flat && <ToggleAllPurchases />}
          </div>
        </CardContent>
      </Card>

      {blocks.length === 0 && (
        <p className="rounded-md bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-500">
          {filtering ? "По этому аукциону лоты с такими условиями не найдены." : "У аукциона нет закупок."}
        </p>
      )}

      <LotsProvider rows={lotsData.rows} purchases={lotsData.purchases} fields={customFields} canEdit={canEdit}>
      {!flat && blocks.map(({ p, lines, qty, pFullIncl, pFullExcl, expIncl, expExcl, unallocated, invoice }) => {
        const isReceived = p.status === "RECEIVED";
        const statusBadge =
          p.status === "RECEIVED" ? (
            <Badge variant="success">Принято на склад</Badge>
          ) : p.status === "CANCELLED" ? (
            <Badge variant="danger">Отменено</Badge>
          ) : (
            <Badge>Черновик</Badge>
          );
        return (
          <details
            key={p.id}
            data-auction-purchase
            open
            className="group rounded-lg border border-neutral-200 bg-white"
          >
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
              <span className="inline-block text-neutral-400 transition-transform group-open:rotate-90">›</span>
              <span className="font-medium">{p.invoiceNumber ? `Счёт ${p.invoiceNumber}` : p.number}</span>
              <span className="text-xs text-neutral-500">
                {p.number} · {formatDate(p.orderDate)} · {p.supplier.name}
              </span>
              {statusBadge}
              <span className="text-xs text-neutral-500">
                {lines.length} лот. · {formatQty(qty.toString())} шт.
              </span>
              <span className="ml-auto text-sm font-semibold">
                <Money incl={pFullIncl} excl={pFullExcl} />
              </span>
            </summary>
            <div className="flex flex-col gap-2 border-t border-neutral-100 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/purchases/${p.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Карточка закупки {p.number} →
                </Link>
                {canEdit && !isReceived && p.status !== "CANCELLED" && (
                  <Link
                    href={`/purchases/${p.id}`}
                    className={buttonVariants({ variant: "default", size: "sm" })}
                    title="Курс, документы и расходы закупки; цена, количество и расходы лота — кнопкой «Править расчёт» у строки лота"
                  >
                    Править закупку →
                  </Link>
                )}
                {invoice ? (
                  <a
                    href={`/api/purchase-docs/${invoice.id}?v=${docVersion(invoice.storagePath)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    📄 {invoice.title}
                  </a>
                ) : (
                  <span className="text-xs text-neutral-400">счёта аукциона в документах нет</span>
                )}
                {p.currency !== "RUB" && (
                  <span className="text-xs text-neutral-500">
                    Валюта {p.currency}, курс {rateText(p.exchangeRate)}
                  </span>
                )}
              </div>
              <PurchaseLotsTable
                purchaseId={p.id}
                currency={p.currency}
                hasEditCol={canEdit && !isReceived && p.status !== "CANCELLED"}
              />
              {p.expenses.length > 0 && (
                <div className="text-xs text-neutral-600">
                  <span className="font-medium">Расходы закупки</span>{" "}
                  {isReceived ? "(уже распределены по лотам): " : unallocated ? "(добавлены в итог закупки): " : ": "}
                  {p.expenses
                    .map((e) => `${e.category.name}${e.description ? ` — ${e.description}` : ""}`)
                    .join("; ")}
                  {" · "}
                  <Money incl={expIncl} excl={expExcl} />
                </div>
              )}
              <PurchaseCostParts purchaseId={p.id} />
            </div>
          </details>
        );
      })}

      {blocks.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
          <span className="text-neutral-600">
            Итого по показанным лотам: {totalLots} лот., {formatQty(totalQty.toString())} шт.
          </span>
          <span className="flex flex-wrap gap-x-4">
            <span>
              <span className="text-neutral-500">стоимость шкур по счетам: </span>
              <span className="font-semibold">
                <Money incl={priceIncl} excl={priceExcl} />
              </span>
            </span>
            <span>
              <span className="text-neutral-500">полная себестоимость (с расходами): </span>
              <span className="font-semibold">
                <Money incl={fullIncl} excl={fullExcl} />
              </span>
            </span>
          </span>
        </div>
      )}

      {blocks.length > 0 && (flat ? <FlatLotsPanel /> : <AuctionTotalsPanel />)}
      </LotsProvider>

      <Card>
        <CardHeader>
          <CardTitle>Документы аукциона ({docRows.length + driveDocs.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {docRows.length > 0 ? (
            <Table className="max-md:block">
              <Thead className="max-md:hidden">
                <Tr>
                  <Th>Документ</Th>
                  <Th>Тип</Th>
                  <Th>Относится к</Th>
                  <Th>Дата</Th>
                  <Th>Размер</Th>
                  <Th>Файл</Th>
                  {canEdit && <Th>Корректировка</Th>}
                </Tr>
              </Thead>
              <Tbody className="max-md:block">
                {docRows.map(({ d, batch, purchaseId, purchaseLabel }) => {
                  const v = docVersion(d.storagePath);
                  return (
                    <Tr key={d.id} className="align-top max-md:block max-md:space-y-1 max-md:p-3">
                      <Td className="min-w-40 font-medium max-md:block max-md:px-0 max-md:py-0">
                        {d.title}
                        <div className="text-xs font-normal text-neutral-400">{d.originalName}</div>
                      </Td>
                      <Td className="whitespace-nowrap max-md:block max-md:px-0 max-md:py-0">{DOC_KIND_LABELS[d.kind]}</Td>
                      <Td className="text-xs max-md:block max-md:px-0 max-md:py-0">{batch ? `вся партия ${d.batch ?? ""}` : `закупка ${purchaseLabel}`}</Td>
                      <Td className="whitespace-nowrap max-md:inline-block max-md:px-0 max-md:py-0 max-md:pr-3">{formatDate(d.createdAt)}</Td>
                      <Td className="whitespace-nowrap max-md:inline-block max-md:px-0 max-md:py-0">{fmtSize(d.sizeBytes)}</Td>
                      <Td className="max-md:block max-md:px-0 max-md:py-1">
                        <div className="flex flex-wrap gap-1">
                          <a
                            href={`/api/purchase-docs/${d.id}?download=1&v=${v}`}
                            className={buttonVariants({ variant: "outline", size: "sm" })}
                          >
                            Скачать
                          </a>
                          <a
                            href={`/api/purchase-docs/${d.id}?v=${v}`}
                            target="_blank"
                            rel="noreferrer"
                            className={buttonVariants({ variant: "ghost", size: "sm" })}
                          >
                            Открыть
                          </a>
                        </div>
                      </Td>
                      {canEdit && (
                        <Td className="min-w-56 max-md:block max-md:min-w-0 max-md:px-0 max-md:py-1">
                          <DocEditControls
                            documentId={d.id}
                            purchaseId={purchaseId || editPurchaseId}
                            title={d.title}
                            kind={d.kind}
                            isBatch={batch}
                            batchName={d.batch}
                          />
                        </Td>
                      )}
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          ) : (
            <p className="text-sm text-neutral-400">Документов у аукциона пока нет</p>
          )}
          <div className="border-t border-neutral-100 pt-3">
            <DriveDocuments
              docs={driveDocs}
              entity="purchase"
              entityId={editPurchaseId}
              canEdit={canEdit && Boolean(editPurchaseId)}
              options={purchasesRaw.map((p) => ({
                id: p.id,
                label: `${p.invoiceNumber ? `Счёт ${p.invoiceNumber} · ` : ""}${p.number}`,
              }))}
            />
          </div>
          {canEdit && (
            <AuctionDocUpload
              purchases={purchasesRaw.map((p) => ({
                id: p.id,
                label: `${p.invoiceNumber ? `Счёт ${p.invoiceNumber} · ` : ""}${p.number}`,
              }))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
