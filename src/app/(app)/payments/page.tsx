import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { resolveAuctionValues } from "@/lib/auction-ref";
import { PaymentWizardButton } from "@/components/payment-wizard";
import { InfoHint } from "@/components/info-hint";
import { getYearFilter, yearLabel } from "@/lib/year-filter";
import { loadPaymentVerify } from "../verify/verify-block";
import { NONE, activeCount, dateRange, parseFilters } from "@/lib/filters";
import { getFilterOptions } from "@/lib/filter-options";
import { PaymentsNav } from "./payments-nav";
import { PaymentsRegistry } from "./registry-tab";
import { docCounts } from "@/lib/doc-links";
import { loadPaymentsSourceDocs } from "@/lib/source-docs-server";
import { FLASH_ERRORS, PAY_FILTERS } from "./_page/helpers";
import { loadPaymentsBase } from "./_page/load";
import { AllTab } from "./_page/all-tab";
import { ClientsTab } from "./_page/clients-tab";
import { SuppliersTab } from "./_page/suppliers-tab";

export const metadata = { title: "Оплаты" };

export default async function PaymentsPage({
  searchParams,
}: PageProps<"/payments">) {
  const session = await requireSession();
  const sp = await searchParams;
  const canPay = hasRole(session.user.role, ACCESS.supplierPayments);
  const flashError = typeof sp.error === "string" ? (FLASH_ERRORS[sp.error] ?? "") : "";
  // Раздел: «Все» (по умолчанию), «За сырьё» (suppliers) или «За работу» (clients). Ссылки с параметрами аукциона ведут в «За сырьё».
  const supplierParams = ["auction", "auc", "q", "dq", "supplier", "f", "noauction"].some((k) => sp[k] !== undefined);
  // По умолчанию — «Реестр» (одна таблица всех оплат); прежний разбор по статьям («Все») — ?tab=all.
  const tab: "registry" | "all" | "suppliers" | "clients" =
    sp.tab === "clients" ? "clients" : sp.tab === "suppliers" ? "suppliers" : sp.tab === "all" ? "all" : supplierParams ? "suppliers" : "registry";
  const orgId = session.user.organizationId;
  const year = await getYearFilter();
  if (tab === "registry") return <PaymentsRegistry sp={sp} orgId={orgId} year={year} canPay={canPay} flashError={flashError} />;
  // Подтверждение оплат («Подтверждено ✓» по каждой строке): поставщику — вкладка «Поставщики», производства — «За работу».
  const pv = await loadPaymentVerify(tab === "clients" ? "prodPayment" : "payment");
  const pf = parseFilters(PAY_FILTERS, sp);
  const clientsTab = tab === "clients";
  // Фильтры вкладки «Поставщикам» не действуют на «От заказчиков» и наоборот.
  const fAuction = clientsTab ? [] : pf.auction;
  const listQ = clientsTab ? "" : pf.q;
  const period = dateRange(pf.from, pf.to);
  const listFiltered = !clientsTab && activeCount(PAY_FILTERS, { ...pf, tab: "" }) > 0;
  const payOpts = await getFilterOptions(orgId, year, ["auction"]);
  // Если выбрана ровно одна партия — под списком открывается её карточка с оплатами.
  const auctionQ = fAuction.length === 1 && fAuction[0] !== NONE ? (await resolveAuctionValues(orgId, fAuction))[0] : "";
  const [payments, clientPayments, summariesAll, auctionPurchases, debt] = await loadPaymentsBase(orgId, tab, year, period, clientsTab, pf);

  // Имена посредников берём из данных аукционов (не хардкодим).
  const ppDocCnt = await docCounts(orgId, "productionPayment", clientPayments.map((p) => p.id));
  // «Документы-основания» по каждой оплате (свёрнуто в строке): что названо в основании и что из этого уже загружено.
  const srcDocs = await loadPaymentsSourceDocs(
    { organizationId: orgId, role: session.user.role },
    tab === "clients" ? { productionPayments: clientPayments.map((p) => p.id) } : { payments: payments.map((p) => p.id) },
  );
  // «Закупки без аукциона»: что куплено, что и когда оплачено, чего нет — по каждой закупке (открывается по клику на строку таблицы).
  const showNoAuction = tab === "suppliers" && sp.noauction === "1";

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs
        items={
          tab === "all"
            ? [{ label: "Оплаты" }]
            : tab === "clients"
              ? [{ label: "Оплаты", href: "/payments" }, { label: "За работу" }]
              : showNoAuction
                ? [{ label: "Оплаты", href: "/payments" }, { label: "За сырьё", href: "/payments?tab=suppliers" }, { label: "Закупки без аукциона" }]
                : [{ label: "Оплаты", href: "/payments" }, { label: "За сырьё" }]
        }
      />
      {/* «i» и метка года — рядом с заголовком, а не внутри: иначе имя заголовка читается как «Оплаты О странице оплат». */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Оплаты</h1>
        {year !== "all" && <span className="text-sm font-normal text-neutral-600">· {yearLabel(year)}</span>}
        <InfoHint wide label="О странице оплат">
          <p>Суммы с НДС. Год оплаты — по дате платежа; в таблице партий закупки год — по дате заказа.</p>
        </InfoHint>
        {canPay && <span className="ml-auto"><PaymentWizardButton label="+ Внести оплату" defaultSide={tab === "clients" ? "work" : undefined} /></span>}
      </div>
      {flashError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{flashError}</p>
      )}

      <PaymentsNav tab={tab} />

      {tab === "all" ? (
        <AllTab sp={sp} orgId={orgId} year={year} pf={pf} canPay={canPay} payments={payments} summariesAll={summariesAll} />
      ) : tab === "clients" ? (
        <ClientsTab sp={sp} orgId={orgId} year={year} pf={pf} role={session.user.role} clientPayments={clientPayments} pv={pv} ppDocCnt={ppDocCnt} srcDocs={srcDocs} />
      ) : (
        <SuppliersTab
          sp={sp}
          orgId={orgId}
          year={year}
          pf={pf}
          canPay={canPay}
          payments={payments}
          summariesAll={summariesAll}
          auctionPurchases={auctionPurchases}
          debt={debt}
          srcDocs={srcDocs}
          payOpts={payOpts}
          fAuction={fAuction}
          listQ={listQ}
          period={period}
          listFiltered={listFiltered}
          auctionQ={auctionQ}
          showNoAuction={showNoAuction}
        />
      )}
    </div>
  );
}
