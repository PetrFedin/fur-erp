import { Fragment } from "react";
import Link from "next/link";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
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
import { auctionName, loadAuctionSummaries, payStatus, AUCTION_PAY_STATUS_LABELS, CLOSING_NOTE, PAY_EPS, type AuctionPay, type AuctionPayStatus } from "@/lib/auction-payments";
import { rowVersion, PAYMENT_V } from "@/lib/concurrency";
import { PaymentRowControls } from "./auction-payment-form";
import { PaymentFormButton } from "@/components/payment-form";
import { loadSupplierDebt } from "@/lib/supplier-debt";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { tidyDocRef } from "@/lib/pay-ref";
import { cleanNote } from "@/lib/note-tags";
import { loadOrderRows } from "@/lib/analytics-orders";
import { InfoHint } from "@/components/info-hint";
import { SupplierDebtHint } from "@/components/supplier-debt-hint";
import { getYearFilter, inYear, yearLabel, yearRange } from "@/lib/year-filter";
import { VerifyControl } from "@/components/verify-control";
import { loadPaymentVerify } from "../verify/verify-block";
import { FilterBar } from "@/components/filters/filter-bar";
import { NONE, activeCount, dateRange, defineFilters, filterHref, parseFilters, pick } from "@/lib/filters";
import { getFilterOptions } from "@/lib/filter-options";
import { ClientPaymentsTable, type ClientPayRow } from "./client-payments-table";
import { ClientDateDetail } from "./client-date-detail";
import { PaymentTiles } from "./payment-tiles";
import { GoodsTiles, type BatchRow, type OwedOrder } from "./goods-tiles";
import { PaymentsOverview } from "./payments-overview";
import { OVERPAY_NOTE } from "@/lib/overpay-notes";
import { loadPaymentsOverview, loadPaymentsLeft } from "@/lib/payments-overview";

async function overviewLeft(orgId: string) {
  const l = await loadPaymentsLeft(orgId);
  return { byYear: Object.fromEntries(l.byYear), raw: l.raw, prod: l.prod };
}
import { loadClientDebt } from "@/lib/payment-alloc";
import { RawTab } from "@/components/raw-tabs";
import { PaymentLinesTable, PurchaseLinesTable, type PayLine, type PurchaseLine } from "./payment-lines";
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
  return r.lessThan(-0.005) ? `+${formatMoney(r.neg().toString())}` : formatMoney(r.toString());
}

const FRESH_MS = 365 * 24 * 3600 * 1000;

// Фильтры вкладок: поставщикам — партия закупки (мультивыбор), поиск по названию, поставщик, остаток, подтверждение, период оплат;
// от заказчиков — заказчик, подтверждение, период. `f=rest` — старое имя «С остатком».
const PAY_FILTERS = defineFilters({
  ptype: { kind: "multi", label: "Тип оплаты", allowed: ["ADVANCE", "PARTIAL", "FINAL"] },
  ...pick(["auction", "q", "supplier", "status", "verified", "from", "to", "tab", "batch"], {
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
  OVERPAID: "success",
};

/** Допуск округления: остаток меньше 50 ₽ — партия считается оплаченной («Оплачен ≈»). */
const ROUND_TOL = 50;
/** Статус по сумме и оплате — тот же, что у строки партии (остаток меньше 50 ₽ — «Оплачен ≈»), для итоговых строк. */
function totalsBadge(total: Decimal, paid: Decimal) {
  const st = payStatus(total, paid);
  const rem = total.sub(paid);
  if (st === "PARTIAL" && rem.greaterThan(PAY_EPS) && rem.lessThan(ROUND_TOL)) return <Badge variant="success" title={`Остаток ${rem.toFixed(2)} ₽ — копейки округления`}>Оплачен ≈</Badge>;
  return <Badge variant={STATUS_VARIANT[st]}>{st === "OVERPAID" ? "Оплачен" : AUCTION_PAY_STATUS_LABELS[st]}</Badge>;
}

function statusBadge(a: AuctionPay) {
  const nearly = a.status === "PARTIAL" && a.remaining.greaterThan(PAY_EPS) && a.remaining.lessThan(ROUND_TOL);
  return nearly ? (
    <Badge variant="success" title={`Остаток ${a.remaining.toFixed(2)} ₽ — копейки округления, партия считается оплаченной`}>
      Оплачен ≈
    </Badge>
  ) : (
    <Badge variant={STATUS_VARIANT[a.status]}>{a.status === "OVERPAID" ? "Оплачен" : AUCTION_PAY_STATUS_LABELS[a.status]}</Badge>
  );
}

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  ADVANCE: "Аванс",
  PARTIAL: "Доплата",
  FINAL: "Оплата",
};

const INVOICE_RX = /сч[её]т[^№;·]*№\s*([^\s;·]+)(?:\s+от\s+(\d{2}\.\d{2}\.\d{4}))?/i;

/** Счёт оплаты: «№103 от 03.07.2025» (слово «счёт» — в заголовке колонки). Берём из основания платежа, иначе из закупки. */
function payInvoice(docRef: string | null, purchase?: { id: string; number: string; invoiceNumber: string | null } | null): { text: string; href?: string } | undefined {
  const m = INVOICE_RX.exec(docRef ?? "");
  const text = m ? `№${m[1]}${m[2] ? ` от ${m[2]}` : ""}` : purchase?.invoiceNumber ? `№${purchase.invoiceNumber.replace(/^сч[её]т\s*/i, "")}` : "";
  if (!text) return undefined;
  return { text, href: purchase ? `/purchases/${purchase.id}` : undefined };
}

/** Комментарий к оплате: основание без п/п (своя колонка), без счёта (своя колонка) и без повтора даты платежа. */
function payComment(docRef: string | null, dateText: string): string {
  return tidyDocRef(docRef, dateText)
    .split(" · ")
    .filter((x) => !/^п\/п\s*№?\s*\d+/i.test(x) && !INVOICE_RX.test(x))
    .join(" · ");
}

export default async function PaymentsPage({
  searchParams,
}: PageProps<"/payments">) {
  const session = await requireSession();
  const sp = await searchParams;
  const canPay = hasRole(session.user.role, ACCESS.supplierPayments);
  const flashError = typeof sp.error === "string" ? (FLASH_ERRORS[sp.error] ?? "") : "";
  // Раздел: «Все» (по умолчанию), «За сырьё» (suppliers) или «За производство» (clients). Ссылки с параметрами аукциона ведут в «За сырьё».
  const supplierParams = ["auction", "auc", "q", "dq", "supplier", "f", "noauction"].some((k) => sp[k] !== undefined);
  const tab: "all" | "suppliers" | "clients" =
    sp.tab === "clients" ? "clients" : sp.tab === "suppliers" ? "suppliers" : sp.tab === "all" ? "all" : supplierParams ? "suppliers" : "all";
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
  const [payments, clientPayments, summariesAll, auctionPurchases, debt] = await Promise.all([
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
    tab === "clients"
      ? prisma.productionPayment.findMany({
          where: {
            organizationId: session.user.organizationId,
            ...(yearRange(year) ? { paidAt: yearRange(year) } : {}),
            ...(period ? { AND: [{ paidAt: period }] } : {}),
            ...(fVerified.length === 1 ? { confirmed: fVerified[0] === "yes" } : {}),
            ...(clientsTab && pf.ptype.length ? { paymentType: { in: pf.ptype as ("ADVANCE" | "PARTIAL" | "FINAL")[] } } : {}),
            ...(clientsTab && pf.batch.length ? { orders: { some: { productionOrder: { batch: { number: { in: pf.batch.map(Number) } } } } } } : {}),
          },
          include: {
            client: true,
            allocations: { select: { productionOrderId: true, amount: true, productionOrder: { include: { batch: { select: { number: true } }, productModel: { select: { name: true, salesName: true } } } } } },
            orders: { include: { productionOrder: { include: { batch: { select: { number: true } }, productModel: { select: { name: true, salesName: true } } } } } },
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
  const auctions = summaries
    .filter((x) => !(x.purchases === 0 && x.total.abs().lessThan(PAY_EPS) && x.paid.abs().lessThan(PAY_EPS) && x.planned.abs().lessThan(PAY_EPS)))
    .sort(
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
  const sum = (f: (a: AuctionPay) => { toString(): string }) => auctions.reduce((acc, a) => acc + Number(f(a).toString()), 0);

  const today = new Date().toISOString().slice(0, 10);

  // Имена посредников берём из данных аукционов (не хардкодим).
  const supplierNamesOf = (list: AuctionPay[]) => {
    const names = Array.from(new Set(list.flatMap((a) => a.suppliers.map((x) => x.name))));
    return names.length <= 4 ? names.join(", ") : `${names.slice(0, 4).join(", ")} и ещё ${names.length - 4}`;
  };
  const intermediaries = supplierNamesOf(auctions);
  const ppDocCnt = await docCounts(orgId, "productionPayment", clientPayments.map((p) => p.id));
  // Ближайшие сроки счетов (из документов Drive «срок дд.мм.гггг»), как на Главной.
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
        <Td className="whitespace-nowrap text-right">{formatMoney(a.total.toString())}</Td>
        <Td className="whitespace-nowrap text-right">
          <span className="inline-flex items-baseline justify-end gap-2">
            <span>{formatMoney(a.paid.toString())}</span>
            <span className={"text-xs font-medium " + (a.percentPaid < 99.95 ? "text-red-600" : "font-normal text-neutral-500")}>{fmtPct(a.percentPaid)}</span>
          </span>
        </Td>
        {anyPlanned && <Td className="whitespace-nowrap text-right">{a.planned.greaterThan(PAY_EPS) ? formatMoney(a.planned.toString()) : "—"}</Td>}
        <Td
          className={
            "whitespace-nowrap text-right font-semibold " +
            (a.remaining.greaterThan(0.005) ? "text-amber-700" : a.remaining.lessThan(-0.005) ? "text-emerald-700" : "")
          }
        >
          {fmtRemaining(a.remaining)}
          {a.remaining.lessThan(-0.005) && OVERPAY_NOTE.some((n) => n.rx.test(a.name)) ? <sup className="ml-0.5"><a href="#overpay-notes" title="Где учтена переплата" className="text-emerald-700 hover:underline">{OVERPAY_NOTE.find((n) => n.rx.test(a.name))!.mark}</a></sup> : null}
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
  const showServiceSum = !listFiltered && (svcAll.length > 0 || noAucTotal.abs().greaterThan(PAY_EPS));
  const svcPurchases = svcAll.reduce((n, a) => n + a.purchases, 0) + (debt ? debt.nonAuctionPurchases : 0);
  const serviceSumRow = (
    <Tr key="__service_sum">
      <Td className="min-w-[10rem] max-w-[18rem] font-medium text-neutral-600" title="Закупки, купленные не на аукционе: З-2026-0001, 0008–0013 (шкуры, оплаты 2025 — начало 2026) и З-2026-0059 (красная лиса, счёт №209)">
        <Link href="/payments?noauction=1#noauction-block" scroll className="hover:underline">Закупки без аукциона</Link>
      </Td>
      <Td className="whitespace-nowrap text-right">{formatMoney(sumTotal.toString())}</Td>
      <Td className="whitespace-nowrap text-right">{formatMoney(sumPaid.toString())}</Td>
      {anyPlanned && <Td className="text-right">—</Td>}
      <Td className={"whitespace-nowrap text-right font-semibold " + (sumRemaining.greaterThan(0.005) ? "text-amber-700" : "")}>{fmtRemaining(sumRemaining)}</Td>
      <Td>
        {totalsBadge(sumTotal, sumPaid)}
      </Td>
      <Td>
        <Link href="/payments?noauction=1#noauction-block" scroll className={buttonVariants({ variant: "outline", size: "sm" })}>Оплаты</Link>
      </Td>
    </Tr>
  );
  const remClass = (r: Decimal) => (r.greaterThan(0.005) ? "text-amber-700" : r.lessThan(-0.005) ? "text-emerald-700" : "");
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
      title="Закупки без аукциона"
      fields={[
        { label: "Остаток", value: <span className={remClass(sumRemaining)}>{fmtRemaining(sumRemaining)}</span>, strong: true },
        { label: "Стоимость", value: formatMoney(sumTotal.toString()) },
        { label: "Оплачено", value: formatMoney(sumPaid.toString()) },
      ]}
      details={[{ label: "Закупок", value: svcPurchases }]}
    />
  );
  // Год и месяц партии закупки — из названия («СП 09.26» → 2026-09); без года — в конце.
  const auctionPeriod = (name: string) => {
    const m = /(\d{2})[-.](\d{2})\s*$/.exec(name.trim());
    return m ? { year: 2000 + Number(m[2]), month: Number(m[1]) } : null;
  };
  const sortByPeriod = (list: typeof auctions) =>
    [...list].sort((a, b) => {
      const pa = auctionPeriod(a.name), pb = auctionPeriod(b.name);
      if (!pa || !pb) return pa ? -1 : pb ? 1 : 0;
      return pa.year - pb.year || pa.month - pb.month;
    });
  const auctionsTable = (rawList: typeof auctions, extraRow?: React.ReactNode) => {
    const list = sortByPeriod(rawList);
    const groups: { year: number | null; items: typeof auctions }[] = [];
    for (const a of list) {
      const y = auctionPeriod(a.name)?.year ?? null;
      const g = groups.find((x) => x.year === y);
      if (g) g.items.push(a); else groups.push({ year: y, items: [a] });
    }
    return (
    <ResponsiveRows
      table={
    <Table>
      <Thead>
        <Tr>
          <Th>Аукцион</Th>
          <Th className="text-right">К оплате</Th>
          <Th className="text-right">Оплачено</Th>
          {anyPlanned && <Th className="text-right">Запланировано</Th>}
          <Th className="text-right">Остаток</Th>
          <Th>Статус</Th>
          <Th></Th>
        </Tr>
      </Thead>
      <Tbody>
        {groups.map((g) => {
          const gt = g.items.reduce((acc, a) => acc.add(a.total), zeroD);
          const gp = g.items.reduce((acc, a) => acc.add(a.paid), zeroD);
          const gr = g.items.reduce((acc, a) => acc.add(a.remaining), zeroD);
          return (
            <Fragment key={g.year ?? "none"}>
              {!(groups.length === 1 && g.items.length === 1) && (
              <tr className="border-y border-neutral-300 bg-neutral-100 text-sm font-semibold text-neutral-900">
                <td className="px-3 py-2">
                  <span className="text-base">{g.year ?? "Без года"}</span>
                  <span className="ml-2 text-xs font-normal text-neutral-600">{g.items.length} {g.items.length === 1 ? "партия" : g.items.length < 5 ? "партии" : "партий"} · итого за год</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(gt.toString())}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  <span className="inline-flex items-baseline justify-end gap-2">
                    <span>{formatMoney(gp.toString())}</span>
                    <span className={"text-xs font-medium " + (gt.greaterThan(0) && gp.div(gt).mul(100).lessThan(99.95) ? "text-red-600" : "font-normal text-neutral-500")}>{gt.greaterThan(0) ? fmtPct(Number(gp.div(gt).mul(100).toString())) : "—"}</span>
                  </span>
                </td>
                {anyPlanned && <td className="px-3 py-2 text-right">—</td>}
                <td className={"whitespace-nowrap px-3 py-2 text-right tabular-nums " + remClass(gr)}>{fmtRemaining(gr)}</td>
                <td className="px-3 py-2">
                  {totalsBadge(gt, gp)}
                </td>
                <td />
              </tr>
              )}
              {g.items.map(renderAuction)}
            </Fragment>
          );
        })}
        {extraRow}
      </Tbody>
    </Table>
      }
    >
      {list.map(auctionCard)}
      {extraRow ? serviceSumCard : null}
    </ResponsiveRows>
    );
  };

  const pdate = clientsTab && typeof sp.pdate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.pdate) ? sp.pdate : "";
  const orderInfo = clientsTab ? new Map((await loadOrderRows(orgId, "all", "on")).map((o) => [o.id, o])) : new Map<string, Awaited<ReturnType<typeof loadOrderRows>>[number]>();
  // Всего оплачено по каждому ТЗ (все платежи) — для расхождений внутри даты.
  const allocTotals = new Map<string, number>();
  if (clientsTab) {
    const sums = await prisma.paymentAllocation.groupBy({ by: ["productionOrderId"], where: { organizationId: orgId, productionPayment: { status: "COMPLETED" } }, _sum: { amount: true } });
    for (const x of sums) allocTotals.set(x.productionOrderId, x._sum.amount?.toNumber() ?? 0);
  }
  const owedWorkTotal = Array.from(orderInfo.values()).filter((o) => o.clientName && o.work - (allocTotals.get(o.id) ?? 0) > 0.5 && (year === "all" || o.year === Number(year))).reduce((a, o) => a + (o.work - (allocTotals.get(o.id) ?? 0)), 0);
  const advancesTotal = clientPayments.filter((p) => p.allocations.length === 0 && /сч[её]т/i.test(p.docRef ?? "") && !p.amount.isZero()).reduce((a, p) => a + p.amount.toNumber(), 0);
  // Счета на оплату из Drive: у оплаты нет файлов напрямую, но счёт, названный в основании («Счёт №65»), лежит в Drive — показываем ссылку на него.
  const invoiceDocs = clientsTab
    ? await prisma.driveDocument.findMany({
        where: { organizationId: orgId, docType: "PAYMENT_INVOICE", viewUrl: { not: null }, docDate: { gte: new Date("2026-01-01T00:00:00Z") } },
        select: { title: true, viewUrl: true, docDate: true },
      })
    : [];
  const invoiceLinkFor = (docRef: string | null, paidAt: Date) => {
    const m = INVOICE_RX.exec(docRef ?? "");
    if (!m) return [];
    const num = m[1].replace(/\D/g, "");
    if (!num) return [];
    const seen = new Set<string>();
    return invoiceDocs
      .filter((d) => new RegExp(`№\\s*${num}(?!\\d)`).test(d.title) && d.docDate && d.docDate <= paidAt)
      .filter((d) => (seen.has(d.viewUrl!) ? false : (seen.add(d.viewUrl!), true)))
      .slice(0, 2)
      .map((d) => ({ title: `счёт №${num}`, url: d.viewUrl! }));
  };
  const clientVerify: Record<string, React.ReactNode> = {};
  for (const p of clientPayments) if (pv.verify[p.id]) clientVerify[p.id] = <VerifyControl v={pv.verify[p.id]} canEdit={pv.canVerify} compact />;
  // Нулевые оплаты (сумма целиком вынесена в оплату закупки) в списке не нужны — деньги видны в «За сырьё».
  const clientRows: ClientPayRow[] = clientPayments.filter((p) => !p.amount.isZero()).map((p) => ({
    id: p.id,
    date: formatDate(p.paidAt),
    iso: p.paidAt.toISOString().slice(0, 10),
    year: p.paidAt.getUTCFullYear(),
    amount: Number(p.amount.toString()),
    type: PAYMENT_TYPE_LABELS[p.paymentType] ?? p.paymentType,
    client: p.client?.name ?? "—",
    // ТЗ оплаты: связанные с платежом и те, на которые есть разнесение (запись разнесения без связи — тоже ТЗ этой оплаты).
    goods: (() => {
      const byId = new Map<string, (typeof p.orders)[number]["productionOrder"]>();
      for (const o of p.orders) byId.set(o.productionOrderId, o.productionOrder);
      for (const x of p.allocations) if (!byId.has(x.productionOrderId)) byId.set(x.productionOrderId, x.productionOrder);
      return Array.from(byId, ([oid, po]) => ({
        id: oid,
        number: po.number,
        label: po.workOrderNumber || po.number,
        model: po.productModel?.salesName || po.productModel?.name || "—",
        qty: Number(po.plannedQuantity.toString()),
        batch: po.batch?.number ?? null,
        article: orderInfo.get(oid)?.modelName ?? po.productModel?.name ?? null,
        fur: orderInfo.get(oid)?.fur ?? null,
        cost: orderInfo.get(oid)?.costIncl ?? null,
        work: orderInfo.get(oid)?.work ?? null,
        paidTotal: allocTotals.get(oid) ?? null,
        paid: p.allocations.find((x) => x.productionOrderId === oid)?.amount.toNumber() ?? null,
      })).sort((x, y) => (x.batch ?? 0) - (y.batch ?? 0) || x.number.localeCompare(y.number, "ru", { numeric: true }));
    })(),
    // К оплате по дате: работа каждого ТЗ делится между его платежами пропорционально разнесению (сумма по датам = работа ТЗ, без повторов);
    // шкуры подрядчика из остатка платежа — в «К оплате» и «Оплачено»; аванс без ТЗ — только «Оплачено» (оплачено вперёд).
    due: (() => {
      const amount = p.amount.toNumber();
      let d = 0;
      for (const x of p.allocations) {
        const w = orderInfo.get(x.productionOrderId)?.work ?? 0;
        const tot = allocTotals.get(x.productionOrderId) ?? 0;
        if (w > 0 && tot > 0) d += (w * x.amount.toNumber()) / tot;
      }
      // Аванс по выставленному счёту, ТЗ ещё не назначены: к оплате — сумма счёта (оплачен целиком).
      if (p.allocations.length === 0 && /сч[её]т/i.test(p.docRef ?? "") && advancesTotal > 0) {
        // Аванс без ТЗ: к оплате — неоплаченная работа ТЗ, под которую он внесён (доля аванса от всех таких авансов); сходится с виджетом «Остаток».
        d = owedWorkTotal * (amount / advancesTotal);
      }
      return Math.round(d * 100) / 100;
    })(),
    basis: tidyDocRef(p.docRef, formatDate(p.paidAt)),
    note: cleanNote(p.notes) ?? undefined,
    invoiceDocs: invoiceLinkFor(p.docRef, p.paidAt),
    paid: Math.round((p.amount.toNumber() - (/шкур/i.test(`${p.docRef ?? ""} ${p.notes ?? ""}`) ? Math.max(0, p.amount.toNumber() - p.allocations.reduce((a, x) => a + x.amount.toNumber(), 0)) : 0)) * 100) / 100,
    allocated: p.allocations.reduce((acc, x) => acc + x.amount.toNumber(), 0),
    hidesNote: /шкур/i.test(`${p.docRef ?? ""} ${p.notes ?? ""}`),
    movedTo: /закупки\s+(З-[\d-]+)/.exec(p.docRef ?? "")?.[1] ?? null,
    docCount: ppDocCnt.get(p.id)?.total ?? 0,
    confirmed: p.confirmedAt != null,
    docTitle: `Оплата ${formatDate(p.paidAt)}`,
    verify: clientVerify[p.id],
  }));
  // ТЗ с неоплаченной работой (в том числе совсем без оплат) — расшифровка остатка в виджете.
  const owedOrders: OwedOrder[] = Array.from(orderInfo.values())
      .filter((o) => o.clientName && o.work - (allocTotals.get(o.id) ?? 0) > 0.5 && (year === "all" || o.year === Number(year)))
    .map((o) => ({ id: o.id, label: o.workOrderNumber || o.number, article: o.modelName, fur: o.fur, batch: o.batchNumber, year: o.year, qty: o.qty, work: o.work, paid: allocTotals.get(o.id) ?? 0 }));
  // «За производство»: общие виджеты — работа, оплачено, долг заказчиков и разбивка по партиям.
  let goodsTotals: { work: number; hides: number; surcharge: number; total: number; paid: number; balance: number; unallocated: number; rows: BatchRow[] } | null = null;
  if (clientsTab) {
    const [cd, allAlloc] = await Promise.all([
      loadClientDebt(prisma, orgId, { year }),
      prisma.paymentAllocation.groupBy({ by: ["productionOrderId"], where: { organizationId: orgId }, _sum: { amount: true } }),
    ]);
    const allocBy = new Map(allAlloc.map((x) => [x.productionOrderId, x._sum.amount?.toNumber() ?? 0]));
    const byBatch = new Map<string, BatchRow>();
    for (const o of orderInfo.values()) {
      if (!o.clientName || (year !== "all" && o.year !== Number(year))) continue;
      const key = o.batchNumber != null ? String(o.batchNumber) : "—";
      const cur = byBatch.get(key) ?? { key, label: o.batchNumber != null ? `Партия ${o.batchNumber}` : "Без партии", year: o.year, work: 0, paid: 0 };
      cur.work += o.work;
      cur.paid += allocBy.get(o.id) ?? 0;
      byBatch.set(key, cur);
    }
    goodsTotals = { work: cd.work, hides: cd.hides, surcharge: Math.round(Array.from(orderInfo.values()).filter((o) => o.clientName && (year === "all" || o.year === Number(year))).reduce((a, o) => a + o.c4PotIncl, 0) * 100) / 100, total: cd.billable, paid: cd.paid, balance: cd.balance, unallocated: cd.unallocated, rows: Array.from(byBatch.values()).filter((r) => r.work > 0 || r.paid > 0) };
  }
  const hidesMemo = tab === "suppliers" ? (await loadClientDebt(prisma, orgId, { year })).hides : 0;
  const clientBatchOptions = clientsTab ? (await getFilterOptions(orgId, year, ["batch"])).batch : [];
  // «Закупки без аукциона»: что куплено, что и когда оплачено, чего нет — по каждой закупке (открывается по клику на строку таблицы).
  const showNoAuction = tab === "suppliers" && sp.noauction === "1";
  const noAuc = showNoAuction
    ? (await prisma.purchase.findMany({
        where: { organizationId: orgId, status: { not: "CANCELLED" } },
        include: { items: true, expenses: true, payments: { where: { status: "COMPLETED" }, include: { driveDocuments: { select: { driveFileId: true } }, document: { select: { id: true } } }, orderBy: { paidAt: "asc" } } },
        orderBy: { number: "asc" },
      })).filter((p) => !p.auctionSession || isServiceAuction(p.auctionSession))
    : [];
  const noAucLines: PurchaseLine[] = noAuc.map((p) => {
    const total = purchaseTotalInclVat(p);
    const paid = p.payments.reduce((acc, x) => acc.add(x.amount), new Decimal(0));
    const note = /fix-drive:fox-209/.test(p.notes ?? "") ? "красная лиса, УПД №209" : /master-0|шкуры подрядчика/i.test(p.notes ?? "") ? "шкуры подрядчика" : null;
    return { id: p.id, number: p.number, invoice: p.invoiceNumber ?? null, note, total: total.toString(), paid: paid.toString(), due: total.sub(paid).toString(), received: p.status === "RECEIVED" };
  });
  const noAucPayLines: PayLine[] = noAuc.flatMap((p) =>
    p.payments.map((x) => ({
      id: x.id,
      date: formatDate(x.paidAt),
      amount: x.amount.toString(),
      what: "Оплата закупки",
      invoice: payInvoice(x.docRef, p) ?? { text: p.number, href: `/purchases/${p.id}` },
      comment: payComment(x.docRef, formatDate(x.paidAt)) || undefined,
      ppNo: /п\/п\s*№?\s*(\d+)/.exec(x.docRef ?? "")?.[1] ?? null,
      confirmed: x.confirmedAt != null,
      status: "COMPLETED" as const,
      docCount: new Set(x.driveDocuments.map((d) => d.driveFileId)).size + (x.document ? 1 : 0),
    })),
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
        {canPay && <span className="ml-auto"><PaymentFormButton label="+ Внести оплату" variant="default" size="default" requireYear /></span>}
      </div>
      {flashError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{flashError}</p>
      )}

      <div role="navigation" aria-label="Разделы оплат" className="flex flex-wrap gap-1 border-b border-neutral-200 pb-2">
        <RawTab href="/payments?tab=all" active={tab === "all"}>
          Все
        </RawTab>
        <RawTab href="/payments?tab=suppliers" active={tab === "suppliers"}>
          За сырьё
        </RawTab>
        <RawTab href="/payments?tab=clients" active={tab === "clients"}>
          За производство
        </RawTab>
      </div>

      {tab === "all" ? (
        <PaymentsOverview rows={await loadPaymentsOverview(orgId)} left={await overviewLeft(orgId)} c4={Math.round((await loadOrderRows(orgId, "all", "on")).filter((o) => o.clientName).reduce((a, o) => a + o.c4PotIncl, 0) * 100) / 100} />
      ) : tab === "clients" ? (
        <>
        <h2 className="flex items-center gap-1.5 text-base font-semibold">Оплаты заказчиков за производство
          <InfoHint label="Как внести оплату" wide>
            <p>Ввести оплату — на карточке ТЗ: откройте нужное ТЗ в разделе «ТЗ». Здесь оплаты только собраны списком: по годам, с указанием, за какой товар (ТЗ, изделие, количество) они пришли.</p>
          </InfoHint>
        </h2>
        {pdate ? (
          <ClientDateDetail
            date={formatDate(new Date(`${pdate}T00:00:00Z`))}
            back="/payments?tab=clients"
            rows={clientRows.filter((r) => r.iso === pdate).map((r) => ({ ...r, verifySlot: clientVerify[r.id] }))}
            owedGoods={owedOrders.map((o) => ({ id: o.id, number: o.label, label: o.label, model: o.article, qty: o.qty, batch: o.batch, article: o.article, fur: o.fur, work: o.work, paidTotal: owedWorkTotal > 0 ? (o.work * advancesTotal) / owedWorkTotal : 0, paid: null }))}
            owedNote={{ orders: owedOrders.length, batches: Array.from(new Set(owedOrders.map((o) => o.batch).filter((b): b is number => b != null))).sort((x, y) => x - y).join(", ") }}
          />
        ) : (
          <>
        <FilterBar
          title="Фильтры оплат"
          oneRow
          hideChips
          controls={[
            { type: "multi", name: "batch", label: "Партия", options: clientBatchOptions, allLabel: "Все партии" },
            { type: "multi", name: "ptype", label: "Тип оплаты", options: [{ value: "ADVANCE", label: "Аванс" }, { value: "PARTIAL", label: "Доплата" }, { value: "FINAL", label: "Оплата" }], allLabel: "Любой" },
            { type: "multi", name: "verified", label: "Подтверждение", options: PAY_VERIFIED_OPTIONS, allLabel: "Любое" },
            { type: "date", name: "from", label: "Оплата с" },
            { type: "date", name: "to", label: "Оплата по" },
          ]}
        />
        {goodsTotals && !pdate && <GoodsTiles {...goodsTotals} owed={owedOrders} />}
                <ClientPaymentsTable rows={clientRows} />
          </>
        )}
        </>
      ) : (
        <>
          {auctions.length > 0 && (
            <>
            <FilterBar
              title="Фильтры оплат"
          oneRow
          hideChips
              controls={[
                { type: "multi", name: "auction", label: "Аукцион", aliases: ["auc"], options: payOpts.auction, noneLabel: "Служебные записи", allLabel: "Все партии" },
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
          {debt && (
            <>
              {!selected && !showNoAuction && (
              <PaymentTiles
                hidesMemo={hidesMemo}
                paid={{
                  total: Number(debt.paid.add(debt.unlinkedAdvances).toString()),
                  unlinked: Number(debt.unlinkedAdvances.toString()),
                  rows: (() => {
                    const rows = auctions.filter((a) => a.paid.abs().greaterThan(PAY_EPS)).map((a) => ({ name: shortAuctionName(a.name), year: auctionPeriod(a.name)?.year ?? null, month: auctionPeriod(a.name)?.month, value: Number(a.paid.toString()) }));
                    const rest = Number(debt.paid.add(debt.unlinkedAdvances).toString()) - rows.reduce((acc, r) => acc + r.value, 0);
                    return rest > 0.5 ? [...rows, { name: "Закупки без аукциона", year: null, value: rest }] : rows;
                  })(),
                }}
                debt={{
                  total: Number(debt.debt.toString()),
                  parts: [
                    { label: "Стоимость закупок, с НДС", value: Number(debt.total.toString()) },
                    ...(anyPlanned ? [{ label: "Запланировано", value: sum((a) => a.planned) }] : []),
                    { label: "К оплате по УПД и счетам", value: Number(debt.receivedNet.toString()) },
                    { label: "Счёт выставлен, не оплачен (мех не получен)", value: Number(debt.invoiced.toString()) },
                    { label: "Ожидаемые закупки (счёта ещё нет)", value: Number(debt.expected.toString()) },
                  ],
                  rows: [
                    ...debt.byAuction.filter((a) => a.due.greaterThan(PAY_EPS)).map((a) => ({ name: shortAuctionName(a.name), year: auctionPeriod(a.name)?.year ?? null, month: auctionPeriod(a.name)?.month, value: Number(a.due.toString()) })),
                    ...(debt.nonAuctionDebt.greaterThan(PAY_EPS) ? [{ name: "Закупки без аукциона", year: null, value: Number(debt.nonAuctionDebt.toString()) }] : []),
                  ],
                }}
                paidHint={
                  <InfoHint wide label="Из чего состоит «Оплачено»" align="right">
                    <p>Та же цифра, что «Оплачено поставщику» на Главной (с НДС, от фильтров и 4% не зависит): по закупкам и аукционам {formatMoney(debt.paid.toString())} + авансы без привязки {formatMoney(debt.unlinkedAdvances.toString())}.</p>
                  </InfoHint>
                }
                debtHint={<SupplierDebtHint debt={debt} year={year} align="right" />}
                debtWarn={debt.debt.greaterThan(PAY_EPS)}
                deadlines={
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
              )}
            </>
          )}


          {(mainAuctions.length > 0 || showServiceSum) && auctionsTable(mainAuctions, showServiceSum ? serviceSumRow : undefined)}
          {mainAuctions.some((a) => a.remaining.lessThan(-0.005) && OVERPAY_NOTE.some((n) => n.rx.test(a.name))) && (
            <ol id="overpay-notes" className="space-y-1 text-xs text-neutral-600">
              {OVERPAY_NOTE.filter((n) => mainAuctions.some((a) => a.remaining.lessThan(-0.005) && n.rx.test(a.name))).map((n) => (
                <li key={n.mark}><sup className="mr-1 text-emerald-700">{n.mark}</sup>{n.text}</li>
              ))}
            </ol>
          )}
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

          <div id="noauction-block" className="scroll-mt-4" />
          {showNoAuction && (
            <Card>
              <CardHeader>
                <CardTitle>Закупки без аукциона</CardTitle>
                <CardDescription>Куплено не на аукционе: мех подрядчика и отдельные закупки. Ниже видно, за что оплачено и за что нет.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <section>
                  <h3 className="mb-2 text-sm font-semibold">За что платим ({noAucLines.length})</h3>
                  <PurchaseLinesTable lines={noAucLines} withPaid />
                </section>
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Оплаты ({noAucPayLines.length})</h3>
                  <PaymentLinesTable lines={noAucPayLines} emptyText="Оплат по этим закупкам нет" />
                </section>
                <p className="text-xs text-neutral-500">Добавить оплату закупки: откройте закупку (ссылка в таблице) → «Внести оплату», либо общая форма «+ Внести оплату» ниже.</p>
              </CardContent>
            </Card>
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
            const lines: PayLine[] = rows.map((p) => {
              const own = Boolean(p.auctionSession) && !p.purchaseId;
              const closing = own && p.notes === CLOSING_NOTE;
              const pu = p.purchaseId ? auctionPurchaseMap.get(p.purchaseId) : null;
              return {
                id: p.id,
                date: formatDate(p.paidAt),
                amount: p.amount.toString(),
                what: closing ? "Закрытие остатка" : own ? KIND_LABELS[p.kind] ?? p.kind : "Оплата закупки",
                invoice: payInvoice(p.docRef, pu),
                comment: payComment(p.docRef, formatDate(p.paidAt)) || undefined,
                ppNo: /п\/п\s*№?\s*(\d+)/.exec(p.docRef ?? "")?.[1] ?? null,
                confirmed: p.confirmedAt != null,
                status: p.status === "PENDING" ? "PENDING" : p.status === "COMPLETED" ? "COMPLETED" : "CANCELLED",
                overdue: p.status === "PENDING" && p.paidAt.toISOString().slice(0, 10) < today,
                docCount: new Set(p.driveDocuments.map((d) => d.driveFileId)).size + (p.document ? 1 : 0),
                controls: own && canPay ? (
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
                ) : undefined,
              };
            });
            return (
              <Card>
                <CardHeader>
                  <CardTitle>{selected.name}</CardTitle>
                  <CardDescription className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>Закупок: {selected.purchases}{selected.purchasesAll > selected.purchases ? ` (+${selected.purchasesAll - selected.purchases} отменено)` : ""}</span>
                    <Link href={`/lots?auction=${encodeURIComponent(selected.name)}`} className="hover:underline">Лоты и себестоимость →</Link>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <section>
                    <h3 className="mb-2 text-sm font-semibold">Оплаты ({lines.length})</h3>
                    <PaymentLinesTable lines={lines} emptyText={`По этой партии оплат поставщику${supplierNamesOf([selected]) ? ` (${supplierNamesOf([selected])})` : ""} пока нет`} />
                  </section>

                </CardContent>
              </Card>
            );
          })()}

        </>
      )}
    </div>
  );
}


