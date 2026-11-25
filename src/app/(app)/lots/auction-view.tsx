import { lotsText } from "@/lib/cost-labels";
import { auctionSummariesView } from "@/lib/mart/auctions";
import { loadRawInfo } from "@/lib/raw-stage-server";
import { relabelOrders } from "@/lib/order-label-db";
import { escapeLike } from "@/lib/input";
import { NO_AUCTION_LABEL, isServiceAuction, shortAuctionName } from "@/lib/auction-names";
import { auctionName as auctionNameLib } from "@/lib/auction-payments";
import { formatMoney, isRoundingRest, OVERPAY_FROM, formatQtyTrim } from "@/lib/utils";
import { isDebtDust } from "@/lib/raw-rounding";
import Link from "next/link";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleBlock } from "@/components/collapsible-block";
import { buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { Money } from "@/components/money";
import { lotUnitCostExclVat, expenseInclVat } from "@/lib/purchase-totals";
import { ToggleAllPurchases } from "./auction-controls";
import { buildAuctionRows } from "./auction-rows";
import { docCounts } from "@/lib/doc-links";
import { LotsProvider } from "./lots-state";
import { AuctionTotalsPanel, FlatLotsPanel, PurchaseCostParts, PurchaseLotsTable } from "./lots-table";
import { CUSTOM_FIELD_ENTITY } from "@/lib/custom-fields";
import { DriveDocuments } from "@/components/drive-documents";
import { toDriveView } from "@/lib/drive-docs-server";
import { countLabel, docGroupKey, groupBy, matchDriveToFiles } from "@/lib/drive-docs-group";
import { loadSupplierDebt } from "@/lib/supplier-debt";
import { getYearFilter, type YearFilter } from "@/lib/year-filter";
import { purchaseYear } from "@/lib/year-scope";
import { YearNote, emptyForYear } from "@/components/year-note";
import { AuctionDocsPay } from "./auction-docs-pay";
import { AuctionVerify } from "../verify/verify-block";
import { classifyPurchaseSource } from "@/lib/purchase-source";
import { LevelSummary, type LevelTile } from "@/components/level-summary";
import { LevelSummaryFromTotals } from "@/components/level-tiles";
import { loadLevelTotals } from "@/lib/mart/level-totals";
import { withExtra } from "@/lib/commission4-pick";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { COMMISSION_RATE } from "@/lib/commission4-const";
import { UNIT_LABELS, parsePlan, grossUp, docVersion, rateText, auctionStatusText, pluralPurchases, type AuctionSummary } from "./_auction-view/helpers";
import { levelUsage } from "./_auction-view/level-usage";
import { AuctionCostBreakdown } from "./_auction-view/cost-breakdown";
import { DocFilesTable } from "./_auction-view/doc-files-table";

/** Название аукциона/партии — первая строка Purchase.auctionSession (так же, как у документов партии). */
export const auctionName = auctionNameLib;

export { auctionStatusText, pluralPurchases, type AuctionSummary };

/** Все аукционы организации (distinct Purchase.auctionSession): число закупок, статусы, дата последней. */
export async function loadAuctions(organizationId: string, year: YearFilter = "all"): Promise<AuctionSummary[]> {
  const rows = await prisma.purchase.findMany({
    where: { organizationId, auctionSession: { not: null }, ...purchaseYear(year) },
    select: { auctionSession: true, status: true, orderDate: true, isContractorRaw: true, auction: { select: { kind: true, house: true } } },
    orderBy: { number: "asc" },
  });
  const map = new Map<string, AuctionSummary>();
  for (const r of rows) {
    const name = auctionName(r.auctionSession);
    if (!name) continue;
    const a = map.get(name) ?? { name, count: 0, received: 0, draft: 0, cancelled: 0, lastDate: 0, src: r.isContractorRaw ? ("supplier" as const) : classifyPurchaseSource(r.auction) };
    a.count++;
    if (r.status === "RECEIVED") a.received++;
    else if (r.status === "CANCELLED") a.cancelled++;
    else a.draft++;
    a.lastDate = Math.max(a.lastDate, r.orderDate.getTime());
    map.set(name, a);
  }
  return Array.from(map.values()).sort((a, b) => b.lastDate - a.lastDate || a.name.localeCompare(b.name, "ru"));
}

export async function AuctionView({
  organizationId,
  names,
  label,
  q,
  materialIds,
  pyear = [],
  canEdit,
  view = "invoices",
}: {
  organizationId: string;
  /** Названия аукционов, подходящих под фильтр (точное совпадение, иначе — вхождение в название). */
  names: string[];
  /** Подпись в заголовке: название аукциона либо «N партий закупки». */
  label: string;
  q: string;
  /** Материалы (id), по которым сужены лоты. */
  materialIds: string[];
  /** Год закупки (локальный фильтр внутри общего года шапки). */
  pyear?: string[];
  canEdit: boolean;
  /** Вид: «По счетам» (сворачиваемые блоки) или «Списком лотов» (плоская таблица) */
  view?: "invoices" | "lots";
}) {
  const flat = view === "lots";
  const viewHref = (v: "invoices" | "lots") => {
    const qs = new URLSearchParams();
    for (const n of names) qs.append("auction", n);
    if (q) qs.set("q", q);
    for (const m of materialIds) qs.append("material", m);
    for (const y of pyear) qs.append("pyear", y);
    if (v === "lots") qs.set("view", "lots");
    return `/lots?${qs.toString()}`;
  };
  const filtering = Boolean(q || materialIds.length);
  const year = await getYearFilter();
  // Закупки аукциона: ищем по первой строке auctionSession; год — по дате заказа закупки (общий фильтр).
  const candidates = await prisma.purchase.findMany({
    where: { organizationId, auctionSession: { not: null }, ...purchaseYear(year) },
    select: { id: true, auctionSession: true, orderDate: true },
  });
  const ids = candidates
    .filter((p) => names.includes(auctionName(p.auctionSession) ?? "") && (pyear.length === 0 || pyear.includes(String(p.orderDate.getUTCFullYear()))))
    .map((p) => p.id);

  const itemWhere = {
    rawMaterial: { unit: { not: "M" as const }, ...(materialIds.length ? { id: { in: materialIds } } : {}) },
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
            lot: { include: { usages: { include: { productionOrder: true } }, attrs: { select: { attr: { select: { name: true } } } } } },
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
    auctionSummariesView(organizationId, names),
  ]);
  const payTotal = paySummaries.reduce((s, a) => s.add(a.total), new Decimal(0));
  const payPaid = paySummaries.reduce((s, a) => s.add(a.paid), new Decimal(0));
  const payRemaining = payTotal.sub(payPaid);
  const payDust = isRoundingRest(payRemaining.toNumber()) || isDebtDust(payRemaining.toNumber());
  // Авансы без привязки к аукциону не относятся к этому аукциону — только короткая отсылка в «Оплаты».
  const hasUnlinkedAdvances = paySummaries.length > 0 ? (await loadSupplierDebt(prisma, organizationId)).unlinkedAdvances.greaterThan(0.005) : false;
  // Без фильтра показываем все закупки аукциона (и пустые); с фильтром — только те, где что-то нашлось.
  const purchases = filtering ? purchasesRaw.filter((p) => p.items.length > 0) : purchasesRaw;

  const rawInfo = await loadRawInfo(organizationId, purchases.map((p) => p.id));
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
    const expIncl = p.expenses.reduce((s, e) => s.add(expenseInclVat(e)), zero());
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
  // «Лот» — полученная партия; строка заказа без лота — «позиция» (единое правило LOTS_RULE).
  const orderedPositions = counted.reduce((s, b) => s + b.lines.filter((l) => !l.i.lot).length, 0);
  const priceIncl = counted.reduce((s, b) => s.add(b.pPriceIncl), zero());
  const priceExcl = counted.reduce((s, b) => s.add(b.pPriceExcl), zero());
  const fullIncl = counted.reduce((s, b) => s.add(b.pFullIncl), zero());
  const fullExcl = counted.reduce((s, b) => s.add(b.pFullExcl), zero());
  // Единая полоса итогов уровня: куплено → использовано → остаток → оплачено → долг (режимы НДС и 4 % — как в шапке).
  const c4 = await getCommission4Mode();
  const k4 = new Decimal(COMMISSION_RATE);
  const { usedQty, usedIncl, usedExcl, extraIncl, extraExcl, remQty, remIncl, remExcl, usdSum, usdQty } = levelUsage(counted, k4);
  const perMoney = (vi: Decimal, ve: Decimal, q: Decimal) => (q.greaterThan(0) ? <Money incl={vi.div(q)} excl={ve.div(q)} /> : "–");
  const pct = (part: Decimal, whole: Decimal) => (whole.greaterThan(0) ? ` · ${Math.round((Number(part) / Number(whole)) * 100)} %` : "");
  // Единое правило режима «4 %» (commission4-pick): одна сумма «Использовано» по режиму шапки.
  const on4 = withExtra(c4);
  const usedShownIncl = on4 ? usedIncl.add(extraIncl) : usedIncl;
  const usedShownExcl = on4 ? usedExcl.add(extraExcl) : usedExcl;
  const payLink = paySummaries.length === 1 ? `/payments?auction=${encodeURIComponent(paySummaries[0].name)}#auction-block` : "/payments";
  const martTotals = !filtering && year === "all" && pyear.length === 0 ? await loadLevelTotals(organizationId, { auctions: names, unit: "PCS" }) : null;
  const sumTiles: LevelTile[] = [
    { key: "bought", title: "Куплено", main: <Money incl={fullIncl} excl={fullExcl} />, lines: [
      { k: "Шкур", v: `${formatQtyTrim(totalQty.toString())} · закупок ${counted.length} · ${lotsText(totalLots - orderedPositions, orderedPositions)}` },
      { k: "₽/шт.", v: perMoney(fullIncl, fullExcl, totalQty) },
      ...(usdQty > 0 ? [{ k: "$/шт.", v: `$${Math.round(usdSum / usdQty).toLocaleString("ru-RU")}` }] : []),
    ] },
    { key: "used", title: "Использовано", main: <Money incl={usedShownIncl} excl={usedShownExcl} />, lines: [
      { k: "Шкур", v: `${formatQtyTrim(usedQty.toString())}${pct(usedQty, totalQty)}` },
      { k: "₽/шт.", v: perMoney(usedShownIncl, usedShownExcl, usedQty) },
      ...(on4 && extraIncl.greaterThanOrEqualTo(0.5) ? [{ k: "из них надбавка 4 %", v: <Money incl={extraIncl} excl={extraExcl} /> }] : []),
    ] },
    { key: "rem", title: "Остаток", main: <Money incl={remIncl} excl={remExcl} />, lines: [
      { k: "Шкур", v: `${formatQtyTrim(remQty.toString())}${pct(remQty, totalQty)}` },
      { k: "₽/шт.", v: perMoney(remIncl, remExcl, remQty) },
    ] },
    ...(paySummaries.length > 0 ? [
      { key: "paid", title: "Оплачено", main: <span>{formatMoney(payPaid.toString())}</span>, lines: [
        { k: "по счетам", v: formatMoney(payTotal.toString()) },
        { k: "", v: <Link href={payLink} className="text-blue-600 hover:underline">Оплаты →</Link> },
      ] } satisfies LevelTile,
      { key: "debt", title: payRemaining.lessThan(-OVERPAY_FROM) ? "Переплата" : "Долг", tone: payRemaining.greaterThan(0.005) && !payDust ? ("warn" as const) : undefined,
        main: payDust ? <span title={`округление (${formatMoney(payRemaining.abs().toFixed(2))})`}>0 ₽</span> : <span>{formatMoney(payRemaining.lessThan(-OVERPAY_FROM) ? payRemaining.abs().toFixed(2) : payRemaining.toFixed(2))}</span>,
        lines: hasUnlinkedAdvances ? [{ k: "", v: <Link href="/payments" className="text-blue-600 hover:underline">Авансы без привязки →</Link> }] : [] } satisfies LevelTile,
    ] : []),
  ];
  // Свои столбцы организации и плоские данные лотов для клиентских таблиц (фильтры, выбор, «Итого»).
  const customFields = await prisma.customField.findMany({
    where: { organizationId, entity: CUSTOM_FIELD_ENTITY },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, type: true, position: true },
  });
  const lotsData = buildAuctionRows(blocks, UNIT_LABELS, canEdit);
  await relabelOrders(organizationId, lotsData.rows.flatMap((r) => r.usages), (u) => ({ orderId: u.orderId, number: u.number, wo: u.wo }));
  const lotDocCnt = await docCounts(organizationId, "lot", lotsData.rows.map((r) => r.lotId).filter((x): x is string => !!x));
  for (const r of lotsData.rows) if (r.lotId) r.docs = lotDocCnt.get(r.lotId)?.total ?? 0;

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
  const viewerRole = (await requireSession()).user.role;
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
      viewerRole,
    ),
  );

  // Один файл — одна строка: привязки того же файла (по имени и размеру) сворачиваются в строку файла,
  // повторы файлов (то же имя + тип + размер) схлопываются в «×N».
  const driveMatch = matchDriveToFiles(
    docRows.map((r) => ({ names: [r.d.originalName, r.d.title], size: r.d.sizeBytes })),
    driveDocs.map((d) => ({ titles: [d.title, d.storedName ?? ""], size: d.storedSize })),
  );
  const pairedDrive = new Set(driveMatch.flat());
  const driveOnly = driveDocs.filter((_, i) => !pairedDrive.has(i));
  const fileEntries = docRows.map((r) => ({ ...r }));
  const fileGroups = groupBy(fileEntries, (r) => docGroupKey(r.d.originalName || r.d.title, r.d.kind, r.d.sizeBytes));
  const driveGroupCount = groupBy(driveOnly, (d) => docGroupKey(d.title, d.docType, d.storedSize)).length;
  const docGroupTotal = fileGroups.length + driveGroupCount;
  const docRecords = docRows.length + driveDocs.length;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle title={label}>
            {names.length > 1 ? `Аукционы / закупки: ${names.length}` : isServiceAuction(label) ? NO_AUCTION_LABEL : `Аукцион: ${shortAuctionName(label, 70)}`}
            <YearNote year={year} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {names.length > 1 && (
            <p className="text-xs text-neutral-500">Под запрос подходят аукционы: {names.map((n) => shortAuctionName(n, 60)).join(", ")}.</p>
          )}
          {/* Числа — из витрины (DmLot, DmAuction): единый источник; витрина устарела, есть фильтры или год — считаем вживую, как раньше. */}
          {martTotals ? <LevelSummaryFromTotals t={martTotals} c4={c4} payHref={payLink} label="Итоги аукциона" /> : <LevelSummary tiles={sumTiles} label="Итоги аукциона" />}
          {filtering && (
            <p className="text-xs text-amber-700">Поиск включён: итоги — по найденным лотам, без расходов закупок.</p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Вид аукциона" data-auction-view-switch>
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
            {blocks.length > 0 && !flat && <ToggleAllPurchases />}
          </div>
        </CardContent>
      </Card>

      <AuctionCostBreakdown counted={counted} fullIncl={fullIncl} totalQty={totalQty} />

      {blocks.length === 0 && (
        <p className="rounded-md bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-500">
          {filtering ? "По этому аукциону лоты с такими условиями не найдены." : emptyForYear(year, "закупок этого аукциона", "У аукциона нет закупок.")}
        </p>
      )}

      <LotsProvider rows={lotsData.rows} purchases={lotsData.purchases} fields={customFields} canEdit={canEdit}>
      {!flat && blocks.map(({ p, lines, qty, pFullIncl, pFullExcl, expIncl, expExcl, unallocated, invoice }) => {
        const isReceived = p.status === "RECEIVED";
        return (
          <details
            key={p.id}
            data-auction-purchase
            open={filtering || blocks.length === 1}
            className="group rounded-lg border border-neutral-200 bg-white"
          >
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
              <span className="inline-block text-neutral-500 transition-transform group-open:rotate-90">›</span>
              <span className="font-medium">{p.invoiceNumber ? `Счёт ${p.invoiceNumber}${p.invoiceDate ? ` от ${formatDate(p.invoiceDate)}` : ""}` : p.number}</span>
              <span className="text-xs text-neutral-500">
                {p.number} · {formatDate(p.orderDate)}
              </span>
              <span className="text-xs text-neutral-500">
                {lines.length} лот. · {formatQtyTrim(qty.toString())} шт.
              </span>
              {rawInfo.get(p.id) && (
                <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${rawInfo.get(p.id)!.overdue ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800"}`} title={`Где сырьё: ${rawInfo.get(p.id)!.line}`}>{rawInfo.get(p.id)!.chip}</span>
              )}
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
                  <span className="text-xs text-neutral-500">счёта в документах нет</span>
                )}
                {p.currency !== "RUB" && (
                  <span className="text-xs text-neutral-500">
                    Валюта {p.currency}, курс {rateText(p.exchangeRate)}
                  </span>
                )}
                {p.transferDocument && <span className="text-xs text-neutral-500">УПД {p.transferDocument}</span>}
              </div>
              {p.notes && (
                <details className="text-xs text-neutral-600">
                  <summary className="cursor-pointer text-neutral-500 hover:text-neutral-800">Примечание: {p.notes.split("\n")[0].slice(0, 110)}{p.notes.length > 110 || p.notes.includes("\n") ? "…" : ""}</summary>
                  <p className="mt-1 whitespace-pre-line">{p.notes}</p>
                </details>
              )}
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

      {blocks.length > 0 && (flat ? <FlatLotsPanel /> : <AuctionTotalsPanel />)}
      </LotsProvider>

      {/* Карточка: развёрнуты только цифры, остальное — по клику */}
      <CollapsibleBlock title="Подтверждение закупок аукциона" summary="что мешает подтвердить: документы, оплата, суммы">
        <p className="mb-2 text-xs text-neutral-500">«Сверка» — сравнение закупки с документами: сумма в базе должна равняться УПД или счёту, должна быть платёжка на каждую оплату. Закупка подтверждается, когда замечаний нет; иначе можно подтвердить с замечанием текстом.</p>
        <AuctionVerify organizationId={organizationId} names={names} />
      </CollapsibleBlock>

      {/* Один блок вместо двух: платёжные документы партии и файлы закупок лежат вместе. */}
      <CollapsibleBlock title="Документы и платёжки аукциона" summary={countLabel(docGroupTotal, docRecords)}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-neutral-500">Сверху: какие документы нужны, что оплачено и что осталось. Ниже: сами файлы, их можно открыть, скачать или поправить.</p>
          <AuctionDocsPay organizationId={organizationId} names={names} />
          {fileGroups.length > 0 ? (
            <details className="group rounded-lg border border-neutral-200">
              <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium hover:bg-neutral-50">
                Все файлы аукциона ({fileGroups.length}) <span className="ml-2 text-xs font-normal text-neutral-500 group-open:hidden">развернуть ›</span>
              </summary>
              <div className="border-t border-neutral-100 p-2">
            <DocFilesTable fileGroups={fileGroups} canEdit={canEdit} editPurchaseId={editPurchaseId} />
              </div>
            </details>
          ) : (
            driveOnly.length === 0 ? <p className="text-sm text-neutral-500">Документов у аукциона пока нет</p> : null
          )}
          <div className="border-t border-neutral-100 pt-3">
            <DriveDocuments
              docs={driveOnly}
              entity="purchase"
              entityId={editPurchaseId}
              canEdit={canEdit && Boolean(editPurchaseId)}
              options={purchasesRaw.map((p) => ({
                id: p.id,
                label: `${p.invoiceNumber ? `Счёт ${p.invoiceNumber} · ` : ""}${p.number}`,
              }))}
            />
          </div>
        </div>
      </CollapsibleBlock>
    </div>
  );
}
