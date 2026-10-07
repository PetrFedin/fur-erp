import Link from "next/link";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { RecordHistory } from "@/components/record-history";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatDate } from "@/lib/utils";
import { ACCESS, hasRole } from "@/lib/access";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cleanSearch } from "@/lib/input";
import { isServiceAuction, shortAuctionName } from "@/lib/auction-names";
import { auctionName, loadAuctionSummaries, AUCTION_PAY_STATUS_LABELS, CLOSING_NOTE, PAY_EPS, type AuctionPay, type AuctionPayStatus } from "@/lib/auction-payments";
import { rowVersion, PAYMENT_V } from "@/lib/concurrency";
import { AuctionPaymentForm, PaymentRowControls, CloseRemainderButton } from "./auction-payment-form";
import { AdvanceForm, AdvanceRowControls, AllocateAdvanceControls, type AllocTarget } from "./advance-forms";
import { DriveDocList, UploadDocument } from "@/components/drive-documents";
import { loadSupplierDebt } from "@/lib/supplier-debt";
import { toDriveView } from "@/lib/drive-docs-server";
import { InfoHint } from "@/components/info-hint";
import { SupplierDebtHint } from "@/components/supplier-debt-hint";
import { getYearFilter, inYear, yearLabel, yearRange } from "@/lib/year-filter";
import { VerifyControl } from "@/components/verify-control";
import { loadPaymentVerify } from "../verify/verify-block";
import { FilterPanel } from "@/components/filter-panel";

// Баннер ?error= показываем только для известных кодов — произвольный текст из URL не выводим.
const FLASH_ERRORS: Record<string, string> = {
  forbidden: "Недостаточно прав для этого действия",
  "not-found": "Запись не найдена или уже удалена",
  invalid: "Проверьте поля формы",
};

/** Процент с нужной точностью: малые доли не округляем до нуля. */
function fmtPct(v: number): string {
  if (v > 0 && v < 0.01) return "<0,01 %";
  return `${v.toLocaleString("ru-RU", { maximumFractionDigits: v < 1 ? 2 : 1 })} %`;
}

/** Остаток: отрицательный — «переплата X ₽». */
function fmtRemaining(r: { toString(): string; lessThan(n: number): boolean; neg(): { toString(): string } }): string {
  return r.lessThan(-0.005) ? `переплата ${formatMoney(r.neg().toString())}` : formatMoney(r.toString());
}

const FRESH_MS = 365 * 24 * 3600 * 1000;

const METHOD_LABELS: Record<string, string> = {
  CASH: "Наличные",
  BANK_TRANSFER: "Банк. перевод",
  CARD: "Карта",
  OTHER: "Другое",
};

const KIND_LABELS: Record<string, string> = {
  ADVANCE: "Аванс",
  PARTIAL: "Доплата",
  FINAL: "Окончательный расчёт",
  OTHER: "Другое",
};

const STATUS_VARIANT: Record<AuctionPayStatus, "danger" | "warning" | "success" | "info"> = {
  UNPAID: "danger",
  PARTIAL: "warning",
  PAID: "success",
  OVERPAID: "info",
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  ADVANCE: "Аванс",
  PARTIAL: "Доплата",
  FINAL: "Оплата",
};

export default async function PaymentsPage({
  searchParams,
}: PageProps<"/payments">) {
  const session = await requireSession();
  const sp = await searchParams;
  const canPay = hasRole(session.user.role, ACCESS.supplierPayments);
  const flashError = typeof sp.error === "string" ? (FLASH_ERRORS[sp.error] ?? "") : "";
  const tab: "suppliers" | "clients" =
    sp.tab === "clients" ? "clients" : "suppliers";
  const orgId = session.user.organizationId;
  const year = await getYearFilter();
  // Подтверждение оплат («Подтверждено ✓» по каждой строке): поставщику — вкладка «Поставщики», производства — «Заказчики».
  const pv = await loadPaymentVerify(tab === "clients" ? "prodPayment" : "payment");
  const auctionQ = tab === "suppliers" ? cleanSearch(sp.auction, 200) : "";
  const listQ = tab === "suppliers" ? cleanSearch(sp.q, 100) : "";
  const onlyRest = tab === "suppliers" && sp.f === "rest";
  const [payments, suppliers, clientPayments, summariesAll, auctionPurchases, plainPurchases, debt] = await Promise.all([
    prisma.payment.findMany({
      where: { organizationId: orgId },
      include: {
        supplier: true,
        purchase: { select: { id: true, number: true, auctionSession: true, invoiceNumber: true } },
        document: { select: { id: true, originalName: true, mimeType: true, storagePath: true, sizeBytes: true } },
        driveDocuments: { orderBy: [{ docDate: "asc" }, { createdAt: "asc" }] },
      },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    }),
    prisma.supplier.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
      orderBy: { name: "asc" },
    }),
    tab === "clients"
      ? prisma.productionPayment.findMany({
          where: { organizationId: session.user.organizationId, ...(yearRange(year) ? { paidAt: yearRange(year) } : {}) },
          include: {
            client: true,
            orders: { include: { productionOrder: { include: { batch: { select: { number: true } } } } } },
          },
          orderBy: { paidAt: "desc" },
        })
      : Promise.resolve([]),
    tab === "suppliers" ? loadAuctionSummaries(prisma, orgId) : Promise.resolve([] as AuctionPay[]),
    tab === "suppliers"
      ? prisma.purchase.findMany({
          where: { organizationId: orgId, auctionSession: { not: null } },
          select: { id: true, number: true, invoiceNumber: true, auctionSession: true },
        })
      : Promise.resolve([]),
    tab === "suppliers"
      ? prisma.purchase.findMany({
          where: { organizationId: orgId, auctionSession: null, status: { not: "CANCELLED" } },
          select: { id: true, number: true, invoiceNumber: true, supplierId: true },
          orderBy: { orderDate: "desc" },
        })
      : Promise.resolve([]),
    tab === "suppliers" ? loadSupplierDebt(prisma, orgId, year) : Promise.resolve(null),
  ]);

  // Общий фильтр года: аукцион — по дате его закупок, оплата вне аукционов — по дате оплаты.
  const summaries = summariesAll.filter((a) => year === "all" || (a.lastPurchaseAt !== null && inYear(a.lastPurchaseAt, year)));
  // По актуальности: 1) с остатком и свежей закупкой (≤ 12 мес.), 2) оплаченные/переплаченные,
  // 3) исторические с остатком (старые, оплаты не заведены). Внутри — свежая закупка выше, затем больший остаток.
  const nowMs = new Date().getTime();
  const rank = (a: AuctionPay) =>
    a.remaining.greaterThan(PAY_EPS)
      ? a.lastPurchaseAt && nowMs - a.lastPurchaseAt.getTime() <= FRESH_MS
        ? 0
        : 2
      : 1;
  const auctions = [...summaries].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.lastPurchaseAt?.getTime() ?? 0) - (a.lastPurchaseAt?.getTime() ?? 0) ||
      b.remaining.comparedTo(a.remaining) ||
      a.name.localeCompare(b.name, "ru"),
  );
  const listQLower = listQ.toLowerCase();
  const visibleAuctions = auctions.filter(
    (a) => (!listQLower || a.name.toLowerCase().includes(listQLower)) && (!onlyRest || a.remaining.greaterThan(PAY_EPS)),
  );
  // Служебные записи («Нет информации», «Не в реестре остатков…» и т.п.) — в конец, под группу «Прочее».
  const mainAuctions = visibleAuctions.filter((a) => !isServiceAuction(a.name));
  const serviceAuctions = visibleAuctions.filter((a) => isServiceAuction(a.name));
  const listParams = (extra: Record<string, string>) => {
    const u = new URLSearchParams();
    if (listQ) u.set("q", listQ);
    if (onlyRest) u.set("f", "rest");
    for (const [k, v] of Object.entries(extra)) {
      if (v === "") u.delete(k);
      else u.set(k, v);
    }
    const qs = u.toString();
    return `/payments${qs ? `?${qs}` : ""}`;
  };
  const selected = auctionQ ? auctions.find((a) => a.name === auctionQ) ?? null : null;
  const auctionPurchaseMap = new Map(auctionPurchases.map((p) => [p.id, p]));
  const inAuction = (p: (typeof payments)[number]) =>
    Boolean(p.auctionSession) || (p.purchase ? Boolean(auctionName(p.purchase.auctionSession)) : false);
  const outside = payments.filter((p) => !inAuction(p) && inYear(p.paidAt, year));
  const sum = (f: (a: AuctionPay) => { toString(): string }) => auctions.reduce((acc, a) => acc + Number(f(a).toString()), 0);

  const today = new Date().toISOString().slice(0, 10);

  // Имена посредников берём из данных аукционов (не хардкодим).
  const supplierNamesOf = (list: AuctionPay[]) => {
    const names = Array.from(new Set(list.flatMap((a) => a.suppliers.map((x) => x.name))));
    return names.length <= 4 ? names.join(", ") : `${names.slice(0, 4).join(", ")} и ещё ${names.length - 4}`;
  };
  const intermediaries = supplierNamesOf(auctions);
  // Поставщики для формы аванса: активные плюс те, на кого уже записаны авансы (даже неактивные).
  const advSuppliers = suppliers.map((x) => ({ id: x.id, name: x.name }));
  for (const p of payments) {
    if (!p.purchaseId && !p.auctionSession && !advSuppliers.some((x) => x.id === p.supplierId)) advSuppliers.push({ id: p.supplierId, name: p.supplier.name });
  }

  // Цели для «Привязать к аукциону»: аукционы (с поставщиками) и закупки без аукциона.
  const allocTargets: AllocTarget[] = [
    ...auctions.map((a) => ({ value: `a:${a.name}`, label: `Партия закупки: ${shortAuctionName(a.name, 60)}`, supplierIds: a.suppliers.map((x) => x.id) })),
    ...plainPurchases.map((p) => ({
      value: `p:${p.id}`,
      label: `Закупка ${p.invoiceNumber ? `счёт ${p.invoiceNumber} · ` : ""}${p.number}`,
      supplierIds: [p.supplierId],
    })),
  ];
  const payDocs = (p: (typeof payments)[number]) => p.driveDocuments.map((d) => toDriveView(d, "оплата", session.user.role));
  const canDocs = hasRole(session.user.role, ["OWNER", "ADMIN"]);
  const docBlock = (p: (typeof payments)[number]) => {
    const docs = payDocs(p);
    return docs.length > 0 || canDocs ? (
      <div className="mt-2 flex flex-col gap-1">
        {docs.length > 0 && (
          <>
            <div className="text-xs text-neutral-400">Документы ({docs.length})</div>
            <DriveDocList docs={docs} canEdit={canDocs} />
          </>
        )}
        {canDocs && <UploadDocument entity="payment" entityId={p.id} compact />}
      </div>
    ) : null;
  };
  const payFlags = (p: (typeof payments)[number]) => (
    <>
      {p.docRef && <span className="block text-xs text-neutral-500">п/п / счёт: {p.docRef}</span>}
      {!p.confirmed && (
        <span className="mt-0.5 block">
          <Badge variant="warning">без платёжки / не подтверждён</Badge>
        </span>
      )}
      {pv.verify[p.id] && p.status === "COMPLETED" && (
        <span className="mt-1 block">
          <VerifyControl v={pv.verify[p.id]} canEdit={pv.canVerify} compact />
        </span>
      )}
    </>
  );

  const anyPlanned = auctions.some((a) => a.planned.greaterThan(PAY_EPS));
  const renderAuction = (a: (typeof auctions)[number]) => {
    const active = selected?.name === a.name;
    const href = `${listParams({ auction: a.name })}#auction-block`;
    return (
      <Tr key={a.name} className={active ? "bg-neutral-50" : undefined}>
        <Td className="min-w-[10rem] max-w-[18rem] font-medium">
          <Link href={href} scroll title={a.name} className="hover:underline">
            {shortAuctionName(a.name)}
          </Link>
        </Td>
        <Td className="text-right">{a.purchases}</Td>
        <Td className="whitespace-nowrap text-right">{formatMoney(a.total.toString())}</Td>
        <Td className="whitespace-nowrap text-right">
          {formatMoney(a.paid.toString())}
          <span className="block text-xs text-neutral-400">{fmtPct(a.percentPaid)}</span>
        </Td>
        {anyPlanned && <Td className="whitespace-nowrap text-right">{a.planned.greaterThan(PAY_EPS) ? formatMoney(a.planned.toString()) : "—"}</Td>}
        <Td
          className={
            "whitespace-nowrap text-right font-semibold " +
            (a.remaining.greaterThan(0.005) ? "text-amber-600" : a.remaining.lessThan(-0.005) ? "text-blue-600" : "")
          }
        >
          {fmtRemaining(a.remaining)}
        </Td>
        <Td>
          <Badge variant={STATUS_VARIANT[a.status]}>{AUCTION_PAY_STATUS_LABELS[a.status]}</Badge>
        </Td>
        <Td>
          <Link href={href} scroll className={buttonVariants({ variant: active ? "default" : "outline", size: "sm" })}>
            Оплаты
          </Link>
        </Td>
      </Tr>
    );
  };
  // Сводная строка «Без аукциона»: все служебные группы + закупки без аукциона — чтобы Σ строк сходилась с «Остатком к оплате».
  const zeroD = new Decimal(0);
  const svcAll = auctions.filter((a) => isServiceAuction(a.name));
  const svcTotal = svcAll.reduce((acc, a) => acc.add(a.total), zeroD);
  const svcPaid = svcAll.reduce((acc, a) => acc.add(a.paid), zeroD);
  const svcRemaining = svcAll.reduce((acc, a) => acc.add(a.remaining), zeroD);
  const noAucTotal = debt ? debt.total.sub(auctions.reduce((acc, a) => acc.add(a.total), zeroD)) : zeroD;
  const noAucDebt = debt ? debt.nonAuctionDebt : zeroD;
  const noAucPaid = noAucTotal.sub(noAucDebt);
  const sumTotal = svcTotal.add(noAucTotal);
  const sumPaid = svcPaid.add(noAucPaid);
  const sumRemaining = svcRemaining.add(noAucDebt);
  // «Оплачено» в шапке — без переплат (они не гасят чужой долг), а в столбце таблицы переплата видна: подписываем разницу.
  const overpaidList = auctions.filter((a) => a.remaining.lessThan(PAY_EPS.neg()));
  const overpaidSum = overpaidList.reduce((acc, a) => acc.add(a.remaining.neg()), zeroD);
  const showServiceSum = !listQ && (svcAll.length > 0 || noAucTotal.abs().greaterThan(PAY_EPS)) && (!onlyRest || sumRemaining.greaterThan(PAY_EPS));
  const svcPurchases = svcAll.reduce((n, a) => n + a.purchases, 0) + (debt ? debt.nonAuctionPurchases : 0);
  const serviceSumRow = (
    <Tr key="__service_sum">
      <Td className="min-w-[10rem] max-w-[18rem] font-medium text-neutral-600" title="Служебные записи импорта и закупки без аукциона, все вместе">
        Служебные записи и закупки без партии закупки
      </Td>
      <Td className="text-right">{svcPurchases}</Td>
      <Td className="whitespace-nowrap text-right">{formatMoney(sumTotal.toString())}</Td>
      <Td className="whitespace-nowrap text-right">{formatMoney(sumPaid.toString())}</Td>
      {anyPlanned && <Td className="text-right">—</Td>}
      <Td className={"whitespace-nowrap text-right font-semibold " + (sumRemaining.greaterThan(0.005) ? "text-amber-600" : "")}>{fmtRemaining(sumRemaining)}</Td>
      <Td></Td>
      <Td></Td>
    </Tr>
  );
  const remClass = (r: Decimal) => (r.greaterThan(0.005) ? "text-amber-600" : r.lessThan(-0.005) ? "text-blue-600" : "");
  const auctionCard = (a: (typeof auctions)[number]) => {
    const href = `${listParams({ auction: a.name })}#auction-block`;
    return (
      <RowCard
        key={a.name}
        title={shortAuctionName(a.name)}
        href={href}
        badge={<Badge variant={STATUS_VARIANT[a.status]}>{AUCTION_PAY_STATUS_LABELS[a.status]}</Badge>}
        fields={[
          { label: "Остаток", value: <span className={remClass(a.remaining)}>{fmtRemaining(a.remaining)}</span>, strong: true },
          { label: "Стоимость", value: formatMoney(a.total.toString()) },
          { label: "Оплачено", value: `${formatMoney(a.paid.toString())} (${fmtPct(a.percentPaid)})` },
          ...(a.planned.greaterThan(PAY_EPS) ? [{ label: "Запланировано", value: formatMoney(a.planned.toString()) }] : []),
        ]}
        details={[{ label: "Закупок", value: a.purchases }]}
        extra={
          <Link href={href} scroll className={buttonVariants({ variant: "outline", size: "sm" })}>
            Оплаты
          </Link>
        }
      />
    );
  };
  const serviceSumCard = (
    <RowCard
      key="__service_sum"
      title="Служебные записи и закупки без партии закупки"
      fields={[
        { label: "Остаток", value: <span className={remClass(sumRemaining)}>{fmtRemaining(sumRemaining)}</span>, strong: true },
        { label: "Стоимость", value: formatMoney(sumTotal.toString()) },
        { label: "Оплачено", value: formatMoney(sumPaid.toString()) },
      ]}
      details={[{ label: "Закупок", value: svcPurchases }]}
    />
  );
  // «Расшифровка»: итоги по строкам таблицы и как они сходятся с «Остатком к оплате» в шапке (второй остаток и второе «оплачено» — только здесь).
  const showRecon = mainAuctions.length > 0 || showServiceSum;
  const rTotal = mainAuctions.reduce((acc, a) => acc.add(a.total), zeroD).add(showServiceSum ? sumTotal : zeroD);
  const rPaid = mainAuctions.reduce((acc, a) => acc.add(a.paid), zeroD).add(showServiceSum ? sumPaid : zeroD);
  const rPlanned = mainAuctions.reduce((acc, a) => acc.add(a.planned), zeroD);
  const rRem = mainAuctions.reduce((acc, a) => acc.add(a.remaining), zeroD).add(showServiceSum ? sumRemaining : zeroD);
  const rCount = mainAuctions.reduce((n, a) => n + a.purchases, 0) + (showServiceSum ? svcPurchases : 0);
  const reconcilable = Boolean(debt) && !listQ && !onlyRest;
  const reconRow = (label: string, value: string, strong?: boolean) => (
    <div className={"flex justify-between gap-4 py-0.5" + (strong ? " border-t border-neutral-200 pt-1 font-semibold" : "")}>
      <dt className="text-neutral-600">{label}</dt>
      <dd className="whitespace-nowrap text-right">{value}</dd>
    </div>
  );
  const reconBlock = showRecon ? (
    <details className="rounded-md border border-neutral-200 bg-white" data-payments-total>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-neutral-700">Расшифровка</summary>
      <dl className="flex max-w-xl flex-col gap-0 border-t border-neutral-100 px-3 py-2 text-sm">
        {reconRow(`Закупок в строках`, String(rCount))}
        {reconRow("Стоимость по строкам", formatMoney(rTotal.toString()))}
        {reconRow("Оплачено по строкам (с учётом переплат)", formatMoney(rPaid.toString()))}
        {rPlanned.greaterThan(PAY_EPS) && reconRow("Запланировано", formatMoney(rPlanned.toString()))}
        {reconRow("Остаток по строкам", fmtRemaining(rRem), true)}
        {reconcilable && debt && (
          <>
            {reconRow("− авансы без привязки", formatMoney(debt.unlinkedAdvances.toString()))}
            {overpaidSum.greaterThan(0) && reconRow(`+ переплата ${overpaidList.map((a) => shortAuctionName(a.name)).join(", ")}`, formatMoney(overpaidSum.toString()))}
            {reconRow("= Остаток к оплате (как в шапке)", formatMoney(debt.debt.toString()), true)}
          </>
        )}
      </dl>
    </details>
  ) : null;
  const auctionsTable = (list: typeof auctions, extraRow?: React.ReactNode) => (
    <ResponsiveRows
      table={
    <Table>
      <Thead>
        <Tr>
          <Th>Партия закупки</Th>
          <Th className="text-right">Закупок</Th>
          <Th className="text-right">Стоимость</Th>
          <Th className="text-right">Оплачено</Th>
          {anyPlanned && <Th className="text-right">Запланировано</Th>}
          <Th className="text-right">Остаток</Th>
          <Th>Статус</Th>
          <Th></Th>
        </Tr>
      </Thead>
      <Tbody>{list.map(renderAuction)}{extraRow}</Tbody>
    </Table>
      }
    >
      {list.map(auctionCard)}
      {extraRow ? serviceSumCard : null}
    </ResponsiveRows>
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
        Оплаты
        {year !== "all" && <span className="text-sm font-normal text-neutral-500">· {yearLabel(year)}</span>}
        <InfoHint wide label="О странице оплат">
          <p>Платим посреднику{intermediaries ? ` (${intermediaries})` : ""}; оплаты связываем с партиями закупки. Суммы — с НДС, это наш долг поставщику.</p>
          <p className="mt-2">Год (переключатель в шапке): партия закупки — по дате заказа, оплата без партии и от заказчиков — по дате оплаты. Оплаты внутри выбранной партии показываются все.</p>
          <p className="mt-2">Переключатель «С 4%» оплаты и долг поставщику не меняет.</p>
        </InfoHint>
      </h1>
      {flashError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{flashError}</p>
      )}

      <div className="flex gap-1 border-b border-neutral-200 pb-2">
        <Link
          href="/payments"
          className={
            "rounded-md px-3 py-1.5 text-sm " +
            (tab === "suppliers"
              ? "bg-neutral-900 text-white"
              : "text-neutral-700 hover:bg-neutral-100")
          }
        >
          Поставщикам
        </Link>
        <Link
          href="/payments?tab=clients"
          className={
            "rounded-md px-3 py-1.5 text-sm " +
            (tab === "clients"
              ? "bg-neutral-900 text-white"
              : "text-neutral-700 hover:bg-neutral-100")
          }
        >
          От заказчиков
        </Link>
      </div>

      {tab === "clients" ? (
        <>
        <p className="text-sm text-neutral-600">
          Ввести оплату — на карточке ТЗ: откройте нужное ТЗ в разделе{" "}
          <Link href="/production" className="underline hover:no-underline">
            ТЗ
          </Link>
          . Здесь оплаты заказчиков только собраны списком.
        </p>
        <ResponsiveRows table={
        <Table>
          <Thead>
            <Tr>
              <Th>Дата</Th>
              <Th>Заказчик</Th>
              <Th>ТЗ</Th>
              <Th>Тип</Th>
              <Th>Сумма</Th>
              <Th></Th>
            </Tr>
          </Thead>
          <Tbody>
            {clientPayments.map((p) => (
              <Tr key={p.id}>
                <Td>{formatDate(p.paidAt)}</Td>
                <Td>{p.client?.name ?? "—"}</Td>
                <Td>
                  {p.orders.length === 0 ? (
                    <span className="text-neutral-500">без ТЗ</span>
                  ) : p.orders.length <= 3 ? (
                    p.orders.map((o, i) => (
                      <span key={o.id}>
                        {i > 0 && ", "}
                        <Link href={`/production/${o.productionOrderId}`} className="hover:underline">
                          {o.productionOrder.number}
                        </Link>
                      </span>
                    ))
                  ) : (
                    <details>
                      <summary className="cursor-pointer whitespace-nowrap">
                        {p.orders.length} ТЗ{batchLabel(p.orders)}
                      </summary>
                      <div className="mt-1 flex max-w-xs flex-wrap gap-x-2 gap-y-0.5 text-xs">
                        {p.orders.map((o) => (
                          <Link key={o.id} href={`/production/${o.productionOrderId}`} className="hover:underline">
                            {o.productionOrder.number}
                          </Link>
                        ))}
                      </div>
                    </details>
                  )}
                </Td>
                <Td>{PAYMENT_TYPE_LABELS[p.paymentType]}</Td>
                <Td>{formatMoney(p.amount.toString())}</Td>
                <Td>
                  {p.orders[0] ? (
                    <Link href={`/production/${p.orders[0].productionOrderId}`} className="text-sm hover:underline">
                      К ТЗ
                    </Link>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                  {pv.verify[p.id] && (
                    <div className="mt-1">
                      <VerifyControl v={pv.verify[p.id]} canEdit={pv.canVerify} compact />
                    </div>
                  )}
                </Td>
              </Tr>
            ))}
            {clientPayments.length === 0 && (
              <Tr>
                <Td colSpan={6} className="py-8 text-center text-neutral-400">
                  Оплат от заказчиков пока нет
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
        }>
          {clientPayments.map((p) => (
            <RowCard
              key={p.id}
              title={p.client?.name ?? "—"}
              subtitle={PAYMENT_TYPE_LABELS[p.paymentType]}
              fields={[
                { label: "Сумма", value: formatMoney(p.amount.toString()), strong: true },
                { label: "Дата", value: formatDate(p.paidAt) },
                ...(pv.verify[p.id] ? [{ label: "Подтверждение", value: <VerifyControl v={pv.verify[p.id]} canEdit={pv.canVerify} compact /> }] : []),
                {
                  label: "ТЗ",
                  value:
                    p.orders.length === 0 ? (
                      "без ТЗ"
                    ) : p.orders.length <= 3 ? (
                      p.orders.map((o, i) => (
                        <span key={o.id}>
                          {i > 0 && ", "}
                          <Link href={`/production/${o.productionOrderId}`} className="underline">
                            {o.productionOrder.number}
                          </Link>
                        </span>
                      ))
                    ) : (
                      `${p.orders.length} ТЗ${batchLabel(p.orders)}`
                    ),
                },
              ]}
              details={p.orders.length > 3 ? [{ label: "Все ТЗ", value: p.orders.map((o, i) => (
                <span key={o.id}>{i > 0 && ", "}<Link href={`/production/${o.productionOrderId}`} className="underline">{o.productionOrder.number}</Link></span>
              )) }] : []}
            />
          ))}
          {clientPayments.length === 0 && <p className="py-6 text-center text-neutral-400">Оплат от заказчиков пока нет</p>}
        </ResponsiveRows>
        </>
      ) : (
        <>
          {debt && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
                <Stat label="Стоимость закупок, с НДС" value={formatMoney(debt.total.toString())} />
                <Stat label="Оплачено" value={formatMoney(debt.paid.toString())} />
                {debt.unlinkedAdvances.greaterThan(PAY_EPS) && <Stat label="Авансы без привязки" value={formatMoney(debt.unlinkedAdvances.toString())} />}
                {anyPlanned && <Stat label="Запланировано" value={formatMoney(sum((a) => a.planned))} />}
                <Stat
                  label="Остаток к оплате"
                  value={formatMoney(debt.debt.toString())}
                  hint={<SupplierDebtHint debt={debt} year={year} />}
                  warn={debt.debt.greaterThan(PAY_EPS)}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Stat
                  label="К оплате по УПД и счетам"
                  value={formatMoney(debt.receivedNet.toString())}
                  hint={<InfoHint wide label="К оплате по УПД и счетам"><p>Мех получен, УПД есть, а оплаты не хватает. Из этой части уже вычтены авансы без привязки ({formatMoney(debt.unlinkedAdvances.toString())}). Это то, что нужно платить в первую очередь.</p></InfoHint>}
                  warn={debt.receivedNet.greaterThan(PAY_EPS)}
                />
                <Stat
                  label="Счёт выставлен, не оплачен"
                  value={formatMoney(debt.invoiced.toString())}
                  hint={<InfoHint wide label="Счёт выставлен, не оплачен"><p>Закупка ещё не получена (черновик), но Веллмех уже выставил на неё счёт: FH 06-26 (счёт №173), СП 09-26 (счёт №271), подкладка спец. 13 (№157), доп. материалы спец. 16 (№181). Суммы счетов взяты из документов Drive; после оплаты или получения меха сумма уйдёт из этой строки.</p></InfoHint>}
                />
                <Stat
                  label="Ожидаемые закупки"
                  value={formatMoney(debt.expected.toString())}
                  hint={<InfoHint wide label="Ожидаемые закупки"><p>Закупки не получены и счёта на эту часть ещё нет (например, аванс 3 по рыси «по факту затрат» и часть СП 09-26 «оплата по готовности»). Это не долг сегодня, а то, что придётся заплатить.</p></InfoHint>}
                />
              </div>
            </>
          )}

          {auctions.length > 0 && (
            <FilterPanel title="Фильтры оплат" applied={Boolean(listQ || onlyRest || auctionQ)}>
              <div className="flex flex-wrap items-end gap-3">
                <form method="get" action="/payments" className="flex flex-wrap items-end gap-2">
                  {onlyRest && <input type="hidden" name="f" value="rest" />}
                  {auctionQ && <input type="hidden" name="auction" value={auctionQ} />}
                  <label htmlFor="auction-q" className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Партия закупки
                    <Input id="auction-q" name="q" defaultValue={listQ} placeholder="название партии закупки" className="w-64 normal-case tracking-normal" autoComplete="off" />
                  </label>
                  <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
                    Найти
                  </button>
                </form>
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Показывать</div>
                  <div className="flex gap-1" role="group" aria-label="Фильтр оплат">
                    <Link
                      href={listParams({ f: "", ...(auctionQ ? { auction: auctionQ } : {}) })}
                      className={"rounded-full border px-3 py-1.5 text-xs " + (!onlyRest ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100")}
                    >
                      Все
                    </Link>
                    <Link
                      href={listParams({ f: "rest", ...(auctionQ ? { auction: auctionQ } : {}) })}
                      className={"rounded-full border px-3 py-1.5 text-xs " + (onlyRest ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100")}
                    >
                      С остатком
                    </Link>
                  </div>
                </div>
                <span className="ml-auto text-xs text-neutral-500">
                  Показано {visibleAuctions.length} из {auctions.length}
                </span>
              </div>
            </FilterPanel>
          )}

          {(mainAuctions.length > 0 || showServiceSum) && auctionsTable(mainAuctions, showServiceSum ? serviceSumRow : undefined)}
          {reconBlock}
          {serviceAuctions.length > 0 && (
            <details className="rounded-md border border-neutral-200 bg-white" open={Boolean(listQ) || serviceAuctions.some((a) => a.name === selected?.name)}>
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-neutral-700">
                Прочее (служебные записи импорта): {serviceAuctions.length}
              </summary>
              <div className="border-t border-neutral-100 p-3">{auctionsTable(serviceAuctions)}</div>
            </details>
          )}
          {auctions.length === 0 && (
            <p className="rounded-md bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-500">
              Партий закупки пока нет: укажите «Партия закупки» в карточке закупки.
            </p>
          )}
          {auctions.length > 0 && visibleAuctions.length === 0 && (
            <p className="rounded-md bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-500">По этим фильтрам партий закупки нет.</p>
          )}

          <div id="auction-block" className="scroll-mt-4" />
          {auctionQ && !selected && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Партия закупки «{auctionQ}» не найдена. Выберите её из списка выше.
            </p>
          )}
          {selected && (() => {
            const ids = new Set(auctionPurchases.filter((p) => auctionName(p.auctionSession) === selected.name).map((p) => p.id));
            const rows = payments.filter((p) => (p.auctionSession === selected.name && !p.purchaseId) || (p.purchaseId && ids.has(p.purchaseId)));
            const total = Number(selected.total.toString());
            return (
              <Card>
                <CardHeader>
                  <CardTitle>Партия закупки: {selected.name}</CardTitle>
                  <CardDescription className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      Закупок: {selected.purchases}
                      {selected.purchasesAll > selected.purchases ? ` (+${selected.purchasesAll - selected.purchases} отменено)` : ""}
                    </span>
                    <Link href={`/lots?auction=${encodeURIComponent(selected.name)}`} className="hover:underline">
                      Лоты и себестоимость партии →
                    </Link>
                    {selected.perPurchase.map((pp) => {
                      const pu = auctionPurchaseMap.get(pp.id);
                      return pu ? (
                        <Link key={pp.id} href={`/purchases/${pp.id}`} className="hover:underline">
                          {pu.invoiceNumber ? `Счёт ${pu.invoiceNumber}` : pu.number}
                        </Link>
                      ) : null;
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
                    <Stat label="Полная стоимость, с НДС" value={formatMoney(selected.total.toString())} />
                    <Stat label="Оплачено" value={formatMoney(selected.paid.toString())} note={fmtPct(selected.percentPaid)} />
                    {selected.planned.greaterThan(PAY_EPS) && <Stat label="Запланировано" value={formatMoney(selected.planned.toString())} />}
                    <Stat label="ОСТАТОК" value={fmtRemaining(selected.remaining)} warn={selected.remaining.greaterThan(0.005)} />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <ProgressBar percent={selected.percentPaid} status={selected.status} />
                    </div>
                    <Badge variant={STATUS_VARIANT[selected.status]}>{AUCTION_PAY_STATUS_LABELS[selected.status]}</Badge>
                  </div>
                  {selected.status === "OVERPAID" && (
                    <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
                      Оплачено больше полной стоимости на {formatMoney(selected.remaining.neg().toString())}. Проверьте оплаты ниже.
                    </p>
                  )}
                  {selected.purchases > 0 && selected.paidByPurchases.greaterThan(0) && (
                    <p className="text-xs text-neutral-500">
                      В «Оплачено» входят и оплаты, внесённые прямо в закупки этой партии: {formatMoney(selected.paidByPurchases.toString())}.
                    </p>
                  )}

                  <div>
                    <h3 className="mb-2 text-sm font-semibold">История оплат ({rows.length})</h3>
                    <div className="flex flex-col gap-2">
                      {rows.map((p) => {
                        const amountN = Number(p.amount.toString());
                        const own = Boolean(p.auctionSession) && !p.purchaseId;
                        const closing = own && p.notes === CLOSING_NOTE;
                        const overdue = p.status === "PENDING" && p.paidAt.toISOString().slice(0, 10) < today;
                        const pu = p.purchaseId ? auctionPurchaseMap.get(p.purchaseId) : null;
                        return (
                          <div
                            key={p.id}
                            className={"rounded-lg border bg-white p-3 " + (p.status === "PENDING" ? "border-dashed border-amber-300" : "border-neutral-200")}
                          >
                            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-6">
                              <Cell label="Дата">{formatDate(p.paidAt)}</Cell>
                              <Cell label="Тип">
                                {own ? KIND_LABELS[p.kind] ?? p.kind : <span className="text-neutral-500">Оплата закупки</span>}
                                {closing && (
                                  <span className="mt-0.5 block">
                                    <Badge variant="info">закрытие остатка</Badge>
                                  </span>
                                )}
                                {pu && (
                                  <Link href={`/purchases/${pu.id}`} className="block text-xs hover:underline">
                                    {pu.invoiceNumber ? `Счёт ${pu.invoiceNumber}` : pu.number}
                                  </Link>
                                )}
                              </Cell>
                              <Cell label="Сумма">
                                <span className="font-semibold">{formatMoney(p.amount.toString())}</span>
                                <span className="block text-xs text-neutral-500">
                                  {total > 0 ? `${fmtPct((amountN / total) * 100)} от стоимости` : "—"}
                                </span>
                              </Cell>
                              <Cell label="Способ">{METHOD_LABELS[p.method] ?? p.method}</Cell>
                              <Cell label="Статус">
                                {p.status === "COMPLETED" ? (
                                  <Badge variant="success">Оплачено</Badge>
                                ) : p.status === "PENDING" ? (
                                  <Badge variant={overdue ? "danger" : "warning"}>{overdue ? "Запланирована, просрочена" : "Запланирована"}</Badge>
                                ) : (
                                  <Badge>Отменена</Badge>
                                )}
                              </Cell>
                              <Cell label="Платёжный документ">
                                {p.document ? (
                                  <span className="flex flex-col gap-1">
                                    <span className="break-all text-xs text-neutral-500">{p.document.originalName}</span>
                                    <span className="flex gap-1">
                                      <a
                                        href={`/api/purchase-docs/${p.document.id}?download=1&v=${encodeURIComponent(p.document.storagePath.split(/[\\/]/).pop() ?? "")}`}
                                        className={buttonVariants({ variant: "outline", size: "sm" })}
                                      >
                                        Скачать
                                      </a>
                                      <a
                                        href={`/api/purchase-docs/${p.document.id}?v=${encodeURIComponent(p.document.storagePath.split(/[\\/]/).pop() ?? "")}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                                      >
                                        Открыть
                                      </a>
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-neutral-400">нет</span>
                                )}
                              </Cell>
                            </div>
                            <div className="mt-2 text-sm">{payFlags(p)}</div>
                            {p.notes && <p className="mt-2 text-xs text-neutral-600">Заметка: {p.notes}</p>}
                            {docBlock(p)}
                            {own && canPay && (
                              <div className="mt-2 border-t border-neutral-100 pt-2">
                                <PaymentRowControls
                                  auction={selected.name}
                                  total={total}
                                  paid={Number(selected.paid.sub(p.status === "COMPLETED" ? p.amount : 0).toString())}
                                  planned={Number(selected.planned.sub(p.status === "PENDING" ? p.amount : 0).toString())}
                                  suppliers={selected.suppliers}
                                  initial={{
                                    id: p.id,
                                    kind: p.kind,
                                    status: p.status === "PENDING" ? "PENDING" : "COMPLETED",
                                    paidAt: p.paidAt.toISOString().slice(0, 10),
                                    amount: p.amount.toString(),
                                    percent: p.percent ? p.percent.toString() : null,
                                    method: p.method,
                                    notes: p.notes ?? "",
                                    docName: p.document ? p.document.originalName : null,
                                    closing,
                                    version: rowVersion(p, PAYMENT_V),
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {rows.length === 0 && (
                        <p className="rounded-md bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-400">По этой партии закупки оплат поставщику{supplierNamesOf([selected]) ? ` (${supplierNamesOf([selected])})` : ""} пока нет</p>
                      )}
                    </div>
                  </div>

                  {canPay && selected.purchases > 0 && selected.remaining.greaterThan(PAY_EPS) && (
                    <div className="flex flex-col gap-1">
                      <CloseRemainderButton auction={selected.name} remaining={formatMoney(selected.remaining.toString())} />
                      <p className="text-xs text-neutral-500">
                        Для старых партий закупки, которые уже оплачены, но подтверждение ещё не занесено в систему. Ничего не закрывается автоматически — только по вашему подтверждению.
                      </p>
                    </div>
                  )}

                  {canPay && selected.purchases > 0 ? (
                    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <h3 className="mb-2 text-sm font-semibold">Добавить оплату</h3>
                      <AuctionPaymentForm
                        auction={selected.name}
                        total={total}
                        paid={Number(selected.paid.toString())}
                        planned={Number(selected.planned.toString())}
                        suppliers={selected.suppliers}
                      />
                    </div>
                  ) : !canPay ? (
                    <p className="text-xs text-neutral-500">Добавлять оплаты могут владелец, администратор, закупщик и бухгалтер.</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })()}

          <h2 className="mt-2 text-base font-semibold">Авансы и оплаты без партии закупки</h2>
          {canPay && (
          <details className="max-w-2xl rounded-lg border border-neutral-200 bg-white" open={!selected}>
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-neutral-700">+ Аванс поставщику без привязки к партии закупки</summary>
            <div className="border-t border-neutral-100 p-3">
              <p className="mb-3 text-xs text-neutral-500">
                Гасит общий долг поставщика. Оплату по конкретной партии вносите в блоке этой партии выше («Добавить оплату»).
              </p>
              <AdvanceForm suppliers={advSuppliers.filter((x) => suppliers.some((y) => y.id === x.id))} />
            </div>
          </details>
          )}

          <div className="flex flex-col gap-2">
            {outside.map((p) => (
              <div key={p.id} className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-5">
                <Cell label="Дата">{formatDate(p.paidAt)}</Cell>
                <Cell label="Поставщик">{p.supplier.name}</Cell>
                <Cell label="Закупка">
                  {p.purchase ? (
                    <Link href={`/purchases/${p.purchase.id}`} className="hover:underline">
                      {p.purchase.number}
                    </Link>
                  ) : (
                    <span className="text-neutral-400">Аванс</span>
                  )}
                </Cell>
                <Cell label="Способ">{METHOD_LABELS[p.method]}</Cell>
                <Cell label="Сумма">
                  {formatMoney(p.amount.toString())}
                  {p.status === "PENDING" && <span className="block text-xs text-amber-600">запланирована</span>}
                </Cell>
              </div>
              <div className="mt-2 text-sm">{payFlags(p)}</div>
              {p.notes && <p className="mt-2 text-xs text-neutral-600">Заметка: {p.notes}</p>}
              {docBlock(p)}
              {canPay && !p.purchaseId && !p.auctionSession && (
                <div className="mt-2 flex flex-col gap-2 border-t border-neutral-100 pt-2">
                  {p.status !== "CANCELLED" && (
                    <AllocateAdvanceControls
                      paymentId={p.id}
                      supplierId={p.supplierId}
                      amount={p.amount.toString()}
                      targets={allocTargets}
                    />
                  )}
                  <AdvanceRowControls
                    suppliers={advSuppliers}
                    initial={{
                      id: p.id,
                      supplierId: p.supplierId,
                      amount: p.amount.toString(),
                      method: p.method,
                      paidAt: p.paidAt.toISOString().slice(0, 10),
                      notes: p.notes ?? "",
                      version: rowVersion(p, PAYMENT_V),
                    }}
                  />
                </div>
              )}
              </div>
            ))}
            {outside.length === 0 && (
              <p className="rounded-md bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-400">Оплат без партии закупки нет</p>
            )}
          </div>
        </>
      )}
      <RecordHistory model="Payment" panelModels={["Payment", "ProductionPayment"]} />
    </div>
  );
}

/** « (партия 1)» — если все ТЗ платежа из одной партии; иначе пусто. */
function batchLabel(orders: { productionOrder: { batch: { number: number } | null } }[]): string {
  const nums = new Set(orders.map((o) => o.productionOrder.batch?.number ?? null));
  if (nums.size !== 1) return "";
  const n = [...nums][0];
  return n == null ? "" : ` (партия ${n})`;
}

function Stat({ label, value, note, warn, hint }: { label: string; value: string; note?: string; warn?: boolean; hint?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">{label}{hint}</div>
      <div className={`mt-1 break-words text-base font-semibold sm:text-lg ${warn ? "text-amber-600" : ""}`}>{value}</div>
      {note && <div className="text-xs text-neutral-500">{note}</div>}
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-neutral-400">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function ProgressBar({ percent, status }: { percent: number; status: AuctionPayStatus }) {
  const color = status === "PAID" ? "bg-emerald-500" : status === "OVERPAID" ? "bg-blue-500" : status === "PARTIAL" ? "bg-amber-500" : "bg-neutral-300";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100" role="progressbar" aria-valuenow={Math.min(percent, 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </div>
      <span className="w-16 text-right text-xs text-neutral-500">{fmtPct(percent)}</span>
    </div>
  );
}
