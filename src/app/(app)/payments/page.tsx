import Link from "next/link";
import { cleanNote } from "@/lib/note-tags";
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
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatDate } from "@/lib/utils";
import { ACCESS, hasRole } from "@/lib/access";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { isServiceAuction, shortAuctionName } from "@/lib/auction-names";
import { resolveAuctionValues } from "@/lib/auction-ref";
import { auctionName, loadAuctionSummaries, AUCTION_PAY_STATUS_LABELS, CLOSING_NOTE, PAY_EPS, type AuctionPay, type AuctionPayStatus } from "@/lib/auction-payments";
import { rowVersion, PAYMENT_V } from "@/lib/concurrency";
import { AuctionPaymentForm, PaymentRowControls, CloseRemainderButton } from "./auction-payment-form";
import { PaymentForm } from "@/components/payment-form";
import { AdvanceRowControls, AllocateAdvanceControls, type AllocTarget } from "./advance-forms";
import { DriveDocList, UploadDocument } from "@/components/drive-documents";
import { loadSupplierDebt } from "@/lib/supplier-debt";
import { toDriveView } from "@/lib/drive-docs-server";
import { InfoHint } from "@/components/info-hint";
import { SupplierDebtHint } from "@/components/supplier-debt-hint";
import { getYearFilter, inYear, yearLabel, yearRange } from "@/lib/year-filter";
import { VerifyControl } from "@/components/verify-control";
import { loadPaymentVerify } from "../verify/verify-block";
import { FilterBar } from "@/components/filters/filter-bar";
import { NONE, activeCount, dateRange, defineFilters, filterHref, parseFilters, pick } from "@/lib/filters";
import { getFilterOptions } from "@/lib/filter-options";
import { DocBadge } from "@/components/doc-viewer";
import { ClientDebtBlock } from "./client-debt-block";
import { RawTab } from "@/components/raw-tabs";
import { docCounts } from "@/lib/doc-links";

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
function isPastRu(date: string): boolean {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 23, 59, 59).getTime() < Date.now() : false;
}

function fmtRemaining(r: { toString(): string; lessThan(n: number): boolean; neg(): { toString(): string } }): string {
  return r.lessThan(-0.005) ? `переплата ${formatMoney(r.neg().toString())}` : formatMoney(r.toString());
}

const FRESH_MS = 365 * 24 * 3600 * 1000;

// Фильтры вкладок: поставщикам — партия закупки (мультивыбор), поиск по названию, поставщик, остаток, подтверждение, период оплат;
// от заказчиков — заказчик, подтверждение, период. `f=rest` — старое имя «С остатком».
const PAY_FILTERS = defineFilters({
  ...pick(["auction", "q", "supplier", "status", "verified", "from", "to", "tab"], {
    q: { aliases: ["dq"], label: "Название партии" },
    status: { aliases: ["f"], allowed: ["rest", "paid"], label: "Оплата" },
    verified: { allowed: ["yes", "no"], label: "Подтверждение" },
    from: { label: "Оплата с" },
    to: { label: "Оплата по" },
  }),
});
const PAY_STATUS_OPTIONS = [
  { value: "rest", label: "С остатком" },
  { value: "paid", label: "Оплачено полностью" },
];
const PAY_VERIFIED_OPTIONS = [
  { value: "yes", label: "Подтверждено" },
  { value: "no", label: "Ждёт проверки (нет платёжки)" },
];

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

/** Допуск округления: остаток меньше 50 ₽ — партия считается оплаченной («Оплачен ≈»). */
const ROUND_TOL = 50;
function statusBadge(a: AuctionPay) {
  const nearly = a.status === "PARTIAL" && a.remaining.greaterThan(PAY_EPS) && a.remaining.lessThan(ROUND_TOL);
  return nearly ? (
    <Badge variant="success" title={`Остаток ${a.remaining.toFixed(2)} ₽ — копейки округления, партия считается оплаченной`}>
      Оплачен ≈
    </Badge>
  ) : (
    <Badge variant={STATUS_VARIANT[a.status]}>{AUCTION_PAY_STATUS_LABELS[a.status]}</Badge>
  );
}

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
  const pf = parseFilters(PAY_FILTERS, sp);
  const clientsTab = tab === "clients";
  // Фильтры вкладки «Поставщикам» не действуют на «От заказчиков» и наоборот.
  const fAuction = clientsTab ? [] : pf.auction;
  const listQ = clientsTab ? "" : pf.q;
  const fSupplier = clientsTab ? [] : pf.supplier;
  const fStatus = clientsTab ? [] : pf.status;
  const fVerified = pf.verified;
  const period = dateRange(pf.from, pf.to);
  const listFiltered = !clientsTab && activeCount(PAY_FILTERS, { ...pf, tab: "" }) > 0;
  const payOpts = await getFilterOptions(orgId, year, ["auction", "supplier"]);
  // Если выбрана ровно одна партия — под списком открывается её карточка с оплатами.
  const auctionQ = fAuction.length === 1 && fAuction[0] !== NONE ? (await resolveAuctionValues(orgId, fAuction))[0] : "";
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
          where: {
            organizationId: session.user.organizationId,
            ...(yearRange(year) ? { paidAt: yearRange(year) } : {}),
            ...(period ? { AND: [{ paidAt: period }] } : {}),
            ...(fVerified.length === 1 ? { confirmed: fVerified[0] === "yes" } : {}),
          },
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
  // Оплаты по партиям (название партии → оплаты): для фильтров «подтверждение» и «период оплат».
  const payAuction = (p: (typeof payments)[number]) => auctionName(p.auctionSession) ?? auctionName(p.purchase?.auctionSession);
  const paysByAuction = new Map<string, (typeof payments)>();
  for (const p of payments) {
    const n = payAuction(p);
    if (n) paysByAuction.set(n, [...(paysByAuction.get(n) ?? []), p]);
  }
  const knownNames = new Set(auctions.map((a) => a.name));
  const looseAuction = fAuction.filter((v) => v !== NONE && !knownNames.has(v)).map((v) => v.toLowerCase());
  const matchesAuction = (a: AuctionPay) =>
    fAuction.length === 0 ||
    fAuction.includes(a.name) ||
    (fAuction.includes(NONE) && isServiceAuction(a.name)) ||
    looseAuction.some((v) => a.name.toLowerCase().includes(v));
  const visibleAuctions = auctions.filter((a) => {
    if (!matchesAuction(a)) return false;
    if (listQLower && !a.name.toLowerCase().includes(listQLower)) return false;
    if (fSupplier.length && !a.suppliers.some((x) => fSupplier.includes(x.id))) return false;
    if (fStatus.length) {
      const rest = a.remaining.greaterThan(PAY_EPS);
      if (!(fStatus.includes("rest") && rest) && !(fStatus.includes("paid") && !rest)) return false;
    }
    const pays = paysByAuction.get(a.name) ?? [];
    if (fVerified.length === 1) {
      const unconfirmed = pays.some((p) => p.status === "COMPLETED" && !(p.confirmed && p.confirmedAt));
      if (fVerified[0] === "yes" ? unconfirmed || pays.length === 0 : !unconfirmed) return false;
    }
    if (period && !pays.some((p) => (!period.gte || p.paidAt >= period.gte) && (!period.lte || p.paidAt <= period.lte))) return false;
    return true;
  });
  // Служебные записи («Нет информации», «Не в реестре остатков…» и т.п.) — в конец, под группу «Прочее».
  const mainAuctions = visibleAuctions.filter((a) => !isServiceAuction(a.name));
  const serviceAuctions = visibleAuctions.filter((a) => isServiceAuction(a.name));
  // Ссылка на одну партию (остальные фильтры сохраняются).
  const auctionHref = (name: string) => filterHref(PAY_FILTERS, "/payments", pf, { auction: [name] });
  const selected = auctionQ ? auctions.find((a) => a.name === auctionQ) ?? null : null;
  const auctionPurchaseMap = new Map(auctionPurchases.map((p) => [p.id, p]));
  const inAuction = (p: (typeof payments)[number]) =>
    Boolean(p.auctionSession) || (p.purchase ? Boolean(auctionName(p.purchase.auctionSession)) : false);
  const outside = payments.filter(
    (p) =>
      !inAuction(p) &&
      inYear(p.paidAt, year) &&
      (!period || ((!period.gte || p.paidAt >= period.gte) && (!period.lte || p.paidAt <= period.lte))) &&
      (fSupplier.length === 0 || fSupplier.includes(p.supplierId)) &&
      (fVerified.length !== 1 || (fVerified[0] === "yes") === (p.confirmed && !!p.confirmedAt)),
  );
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
  const ppDocCnt = await docCounts(orgId, "productionPayment", clientPayments.map((p) => p.id));
  const payDocs = (p: (typeof payments)[number]) => p.driveDocuments.map((d) => toDriveView(d, "оплата", session.user.role));
  const canDocs = hasRole(session.user.role, ["OWNER", "ADMIN"]);
  const docBlock = (p: (typeof payments)[number]) => {
    const docs = payDocs(p);
    return docs.length > 0 || canDocs ? (
      <div className="mt-2 flex flex-col gap-1">
        {docs.length > 0 && (
          <>
            <div className="text-xs text-neutral-500">Документы ({docs.length})</div>
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

  // Ближайшие сроки счетов (из документов Drive «срок дд.мм.гггг»), как на Сводке.
  const deadlines = (debt?.byAuction ?? [])
    .filter((a) => a.dueInvoiced.greaterThan(0) && a.invoiceDocs)
    .map((a) => {
      const m = /срок\s+(\d{2})\.(\d{2})\.(\d{4})/i.exec(a.invoiceDocs ?? "");
      return m ? { auction: shortAuctionName(a.name), date: `${m[1]}.${m[2]}.${m[3]}`, amount: a.dueInvoiced.toNumber(), sort: `${m[3]}${m[2]}${m[1]}` } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => a.sort.localeCompare(b.sort));
  const anyPlanned = auctions.some((a) => a.planned.greaterThan(PAY_EPS));
  const renderAuction = (a: (typeof auctions)[number]) => {
    const active = selected?.name === a.name;
    const href = `${auctionHref(a.name)}#auction-block`;
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
          <span className="block text-xs text-neutral-500">{fmtPct(a.percentPaid)}</span>
        </Td>
        {anyPlanned && <Td className="whitespace-nowrap text-right">{a.planned.greaterThan(PAY_EPS) ? formatMoney(a.planned.toString()) : "—"}</Td>}
        <Td
          className={
            "whitespace-nowrap text-right font-semibold " +
            (a.remaining.greaterThan(0.005) ? "text-amber-700" : a.remaining.lessThan(-0.005) ? "text-blue-600" : "")
          }
        >
          {fmtRemaining(a.remaining)}
        </Td>
        <Td>
          {statusBadge(a)}
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
  const showServiceSum = !listFiltered && (svcAll.length > 0 || noAucTotal.abs().greaterThan(PAY_EPS));
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
      <Td className={"whitespace-nowrap text-right font-semibold " + (sumRemaining.greaterThan(0.005) ? "text-amber-700" : "")}>{fmtRemaining(sumRemaining)}</Td>
      <Td></Td>
      <Td></Td>
    </Tr>
  );
  const remClass = (r: Decimal) => (r.greaterThan(0.005) ? "text-amber-700" : r.lessThan(-0.005) ? "text-blue-600" : "");
  const auctionCard = (a: (typeof auctions)[number]) => {
    const href = `${auctionHref(a.name)}#auction-block`;
    return (
      <RowCard
        key={a.name}
        title={shortAuctionName(a.name)}
        href={href}
        badge={statusBadge(a)}
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
  const reconcilable = Boolean(debt) && !listFiltered;
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
      {/* «i» и метка года — рядом с заголовком, а не внутри: иначе имя заголовка читается как «Оплаты О странице оплат». */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Оплаты</h1>
        {year !== "all" && <span className="text-sm font-normal text-neutral-600">· {yearLabel(year)}</span>}
        <InfoHint wide label="О странице оплат">
          <p>Платим посреднику{intermediaries ? ` (${intermediaries})` : ""}; оплаты связываем с партиями закупки. Суммы — с НДС, это наш долг поставщику.</p>
          <p className="mt-2">Год (переключатель в шапке): партия закупки — по дате заказа, оплата без партии и от заказчиков — по дате оплаты. Оплаты внутри выбранной партии показываются все.</p>
          <p className="mt-2">Переключатель «С 4%» оплаты и долг поставщику не меняет.</p>
        </InfoHint>
      </div>
      {flashError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{flashError}</p>
      )}

      <div role="navigation" aria-label="Разделы оплат" className="flex flex-wrap gap-1 border-b border-neutral-200 pb-2">
        <RawTab href="/payments" active={tab === "suppliers"}>
          Поставщикам
        </RawTab>
        <RawTab href="/payments?tab=clients" active={tab === "clients"}>
          От заказчиков
        </RawTab>
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
        <ClientDebtBlock orgId={orgId} year={year} role={session.user.role} />
        <FilterBar
          title="Фильтры оплат"
          controls={[
            { type: "multi", name: "verified", label: "Подтверждение", options: PAY_VERIFIED_OPTIONS, allLabel: "Любое" },
            { type: "date", name: "from", label: "Оплата с" },
            { type: "date", name: "to", label: "Оплата по" },
          ]}
        />
        <ResponsiveRows table={
        <Table anchor="table:payments" label="Таблица оплат" stickyHeader>
          <Thead>
            <Tr>
              <Th>Дата</Th>
              <Th>Заказчик</Th>
              <Th>ТЗ</Th>
              <Th>Тип</Th>
              <Th>Сумма</Th>
              <Th>Документы</Th>
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
                <Td><DocBadge entity="productionPayment" id={p.id} count={ppDocCnt.get(p.id)?.total ?? 0} title={`Оплата ${formatDate(p.paidAt)}`} /></Td>
                <Td>
                  {p.orders[0] ? (
                    <Link href={`/production/${p.orders[0].productionOrderId}`} className="text-sm hover:underline">
                      К ТЗ
                    </Link>
                  ) : (
                    <span className="text-neutral-500">—</span>
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
                <Td colSpan={7} className="py-8 text-center text-neutral-500">
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
                { label: "Документы", value: <DocBadge entity="productionPayment" id={p.id} count={ppDocCnt.get(p.id)?.total ?? 0} title={`Оплата ${formatDate(p.paidAt)}`} /> },
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
          {clientPayments.length === 0 && <p className="py-6 text-center text-neutral-500">Оплат от заказчиков пока нет</p>}
        </ResponsiveRows>
        </>
      ) : (
        <>
          {debt && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4" data-pay-tiles>
                <Stat
                  label="Остаток к оплате (долг)"
                  value={formatMoney(debt.debt.toString())}
                  hint={<SupplierDebtHint debt={debt} year={year} />}
                  warn={debt.debt.greaterThan(PAY_EPS)}
                />
                <Stat
                  label="Платить в первую очередь"
                  value={formatMoney(debt.receivedNet.toString())}
                  hint={<InfoHint wide label="Платить в первую очередь"><p>«К оплате по УПД и счетам»: мех получен, УПД есть, а оплаты не хватает. Авансы без привязки ({formatMoney(debt.unlinkedAdvances.toString())}) уже вычтены. Это часть общего долга слева.</p></InfoHint>}
                  warn={debt.receivedNet.greaterThan(PAY_EPS)}
                  note={deadlines.length > 0 ? undefined : "сроков по счетам нет"}
                  extra={
                    deadlines.length > 0 ? (
                      <div className="mt-1 text-xs text-neutral-600">
                        {deadlines.map((x) => {
                          const late = isPastRu(x.date);
                          return (
                            <div key={x.auction + x.date} className={late ? "text-red-700" : undefined}>
                              срок {x.date} · {x.auction} · <b className="tabular-nums">{formatMoney(x.amount.toFixed(0))}</b>
                              {late ? " · просрочен" : ""}
                            </div>
                          );
                        })}
                      </div>
                    ) : null
                  }
                />
                <Stat
                  label="Оплачено"
                  value={formatMoney(debt.paid.add(debt.unlinkedAdvances).toString())}
                  hint={
                    <InfoHint wide label="Из чего состоит «Оплачено»">
                      <p>Та же цифра, что «Оплачено поставщику» на Сводке (с НДС, от фильтров и 4% не зависит).</p>
                      <dl className="mt-2 flex flex-col gap-1">
                        <div className="flex justify-between gap-4"><dt>По закупкам и аукционам</dt><dd className="whitespace-nowrap tabular-nums">{formatMoney(debt.paid.toString())}</dd></div>
                        <div className="flex justify-between gap-4"><dt>+ авансы без привязки</dt><dd className="whitespace-nowrap tabular-nums">{formatMoney(debt.unlinkedAdvances.toString())}</dd></div>
                        <div className="flex justify-between gap-4 border-t border-neutral-200 pt-1 font-semibold"><dt>= Оплачено</dt><dd className="whitespace-nowrap tabular-nums">{formatMoney(debt.paid.add(debt.unlinkedAdvances).toString())}</dd></div>
                      </dl>
                    </InfoHint>
                  }
                />
                <Stat
                  label="Неразнесённые авансы"
                  value={formatMoney(debt.unlinkedAdvances.toString())}
                  hint={<InfoHint wide label="Неразнесённые авансы"><p>Деньги отправлены поставщику, но не привязаны ни к закупке, ни к партии. Они уже входят в «Оплачено» и вычтены из долга; привяжите их к партии кнопкой «Привязать» в списке оплат.</p></InfoHint>}
                  note={debt.unlinkedAdvances.greaterThan(PAY_EPS) ? undefined : "всё разнесено"}
                />
              </div>
              <details className="rounded-md border border-neutral-200 bg-white" data-pay-more>
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-neutral-700">Подробнее: из чего состоит долг</summary>
                <dl className="grid max-w-xl gap-0 border-t border-neutral-100 px-3 py-2 text-sm">
                  {[
                    ["Стоимость закупок, с НДС", debt.total],
                    ...(anyPlanned ? [["Запланировано", new Decimal(sum((a) => a.planned))] as [string, Decimal]] : []),
                    ["К оплате по УПД и счетам", debt.receivedNet],
                    ["Счёт выставлен, не оплачен (мех не получен)", debt.invoiced],
                    ["Ожидаемые закупки (счёта ещё нет)", debt.expected],
                  ].map(([l, v]) => (
                    <div key={String(l)} className="flex justify-between gap-4 py-0.5"><dt className="text-neutral-600">{String(l)}</dt><dd className="whitespace-nowrap text-right tabular-nums">{formatMoney((v as Decimal).toString())}</dd></div>
                  ))}
                </dl>
              </details>
            </>
          )}

          {auctions.length > 0 && (
            <>
            <FilterBar
              title="Фильтры оплат"
              controls={[
                { type: "multi", name: "auction", label: "Партия закупки (аукцион)", aliases: ["auc"], options: payOpts.auction, noneLabel: "Служебные записи", allLabel: "Все партии" },
                { type: "text", name: "q", label: "Название партии", aliases: ["dq"], placeholder: "часть названия" },
                { type: "multi", name: "supplier", label: "Поставщик", options: payOpts.supplier },
                { type: "multi", name: "status", label: "Оплата", aliases: ["f"], options: PAY_STATUS_OPTIONS, allLabel: "Любая" },
                { type: "multi", name: "verified", label: "Подтверждение", options: PAY_VERIFIED_OPTIONS, allLabel: "Любое" },
                { type: "date", name: "from", label: "Оплата с" },
                { type: "date", name: "to", label: "Оплата по" },
              ]}
            />
            <p className="-mt-2 text-xs text-neutral-500">
              Показано {visibleAuctions.length} из {auctions.length} партий
              {fAuction.length === 1 && fAuction[0] !== NONE ? " · карточка выбранной партии — под списком" : fAuction.length > 1 ? " · чтобы увидеть оплаты партии, выберите одну" : ""}
            </p>
            </>
          )}

          {(mainAuctions.length > 0 || showServiceSum) && auctionsTable(mainAuctions, showServiceSum ? serviceSumRow : undefined)}
          {reconBlock}
          {serviceAuctions.length > 0 && (
            <details className="rounded-md border border-neutral-200 bg-white" open={listFiltered || serviceAuctions.some((a) => a.name === selected?.name)}>
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
              Партия закупки «{auctionQ}» не найдена{year === "all" ? "" : ` за ${year} год`}. Выберите её в фильтре «Партия закупки».
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
                    {statusBadge(selected)}
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
                              <Cell label="Дата">
                                {formatDate(p.paidAt)}
                                <span className="block"><DocBadge entity="payment" id={p.id} count={new Set(p.driveDocuments.map((d) => d.driveFileId)).size} title="Оплата" /></span>
                              </Cell>
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
                                  <span className="text-neutral-500">нет</span>
                                )}
                              </Cell>
                            </div>
                            <div className="mt-2 text-sm">{payFlags(p)}</div>
                            {cleanNote(p.notes) && <p className="mt-2 text-xs text-neutral-600">Заметка: {cleanNote(p.notes)}</p>}
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
                        <p className="rounded-md bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-500">По этой партии закупки оплат поставщику{supplierNamesOf([selected]) ? ` (${supplierNamesOf([selected])})` : ""} пока нет</p>
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

          <h2 className="mt-2 flex items-center gap-2 text-base font-semibold">
            Авансы и оплаты без партии
            <InfoHint wide label="Что здесь">
              <p>Оплаты, не привязанные к партии закупки (авансы). Здесь же можно внести новую оплату — по аукциону, закупке, авансом или по работе.</p>
            </InfoHint>
          </h2>
          {canPay && (
          <details className="max-w-2xl rounded-lg border border-neutral-200 bg-white" open={!selected}>
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-neutral-700">+ Внести оплату: аукцион, закупка, аванс или оплата по работе (мастер)</summary>
            <div className="border-t border-neutral-100 p-3">
              <PaymentForm />
            </div>
          </details>
          )}

          <div className="flex flex-col gap-2">
            {outside.map((p) => (
              <div key={p.id} className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-4">
                <Cell label="Дата">{formatDate(p.paidAt)}</Cell>
                <Cell label="Поставщик">{p.supplier.name}</Cell>
                <Cell label="Закупка">
                  {p.purchase ? (
                    <Link href={`/purchases/${p.purchase.id}`} className="hover:underline">
                      {p.purchase.number}
                    </Link>
                  ) : (
                    <span className="text-neutral-500">Аванс</span>
                  )}
                </Cell>
                <Cell label="Сумма">
                  <span className="font-semibold">{formatMoney(p.amount.toString())}</span>
                  {p.status === "PENDING" && <span className="block text-xs text-amber-700">запланирована</span>}
                </Cell>
              </div>
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer list-none text-neutral-500 hover:text-neutral-800">
                  {!p.confirmed ? <span className="text-amber-700">без платёжки</span> : "платёжка есть"} · {METHOD_LABELS[p.method]} · подробнее ›
                </summary>
                <div className="mt-2 text-sm">{payFlags(p)}</div>
                {cleanNote(p.notes) && <p className="mt-2 text-xs text-neutral-600">Заметка: {cleanNote(p.notes)}</p>}
                {docBlock(p)}
              </details>
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
              <p className="rounded-md bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-500">Оплат без партии закупки нет</p>
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

function Stat({ label, value, note, warn, hint, extra }: { label: string; value: string; note?: string; warn?: boolean; hint?: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">{label}{hint}</div>
      <div className={`mt-1 break-words text-base font-semibold sm:text-lg ${warn ? "text-amber-700" : ""}`}>{value}</div>
      {note && <div className="text-xs text-neutral-500">{note}</div>}
      {extra}
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-neutral-500">{label}</div>
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
