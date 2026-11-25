import Link from "next/link";
import { formatMoney } from "@/lib/utils";
import { shortAuctionName } from "@/lib/auction-names";
import { auctionName, type AuctionPay } from "@/lib/auction-payments";
import { rowVersion, PAYMENT_V } from "@/lib/concurrency";
import { AdvanceRowControls, AllocateAdvanceControls, type AllocTarget } from "../advance-forms";
import { FilterBar } from "@/components/filters/filter-bar";
import { type SearchParamsLike } from "@/lib/filters";
import { PaymentsOverview } from "../payments-overview";
import { KindBar } from "../kind-bar";
import { parseKind } from "@/lib/pay-kinds";
import { loadPaymentsOverview } from "@/lib/payments-overview";
import { type YearFilter } from "@/lib/year-filter";
import { overviewLeft, type PayFilterValues } from "./helpers";
import { auctionPayControls } from "./auction-pay-controls";
import { loadLoosePurchases, loadSupplierOptions, type PaymentRow } from "./load";

/** Вкладка «Все» (?tab=all): разбор оплат по статьям, остатки и правка платежей на месте. */
export async function AllTab({
  sp,
  orgId,
  year,
  pf,
  canPay,
  payments,
  summariesAll,
}: {
  sp: SearchParamsLike;
  orgId: string;
  year: YearFilter;
  pf: PayFilterValues;
  canPay: boolean;
  payments: PaymentRow[];
  summariesAll: AuctionPay[];
}) {
  return (
        <>
        {await (async () => {
          const kind = parseKind(sp.kind);
          const base = (await loadPaymentsOverview(orgId)).filter((r) => (year === "all" || r.year === Number(year)) && (pf.stat.length === 0 || pf.stat.includes(r.kind)) && (!pf.from || r.iso >= pf.from) && (!pf.to || r.iso <= pf.to));
          const keep = Object.entries(sp).flatMap(([k, v]) => (k === "kind" || v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((x) => [k, x] as [string, string])));
          const href = (k: string | null) => { const q = new URLSearchParams(keep); if (k) q.set("kind", k); return `/payments?${q.toString()}`; };
          return <KindBar rows={base} active={kind} hrefFor={href} />;
        })()}
        <div className="print:hidden">
        <FilterBar
          title="Фильтры оплат"
          oneRow
          hideChips
          controls={[
            { type: "multi", name: "stat", label: "Статья", options: [{ value: "raw", label: "За сырьё" }, { value: "prod", label: "За работу" }], allLabel: "Все" },
            { type: "date", name: "from", label: "Оплата с" },
            { type: "date", name: "to", label: "Оплата по" },
          ]}
        />
        </div>
        {await (async () => {
          const lf = await overviewLeft(orgId);
          const yearsLeft = Object.entries(lf.byYear).filter(([y]) => year === "all" || Number(y) === Number(year));
          const left = { byYear: Object.fromEntries(yearsLeft), raw: yearsLeft.reduce((a, [, v]) => a + v.raw, 0), prod: yearsLeft.reduce((a, [, v]) => a + v.prod, 0), advance: yearsLeft.reduce((a, [, v]) => a + v.adv, 0) };
          const rows = (await loadPaymentsOverview(orgId)).filter((r) => (year === "all" || r.year === Number(year)) && (pf.stat.length === 0 || pf.stat.includes(r.kind)) && (!pf.from || r.iso >= pf.from) && (!pf.to || r.iso <= pf.to) && (!parseKind(sp.kind) || r.type === parseKind(sp.kind)));
          // Кнопки правки и удаления в описании платежа: оплата партии / аванс — на месте; оплата закупки и производства — переход в карточку.
          const controls: Record<string, React.ReactNode> = {};
          const advTargets: AllocTarget[] = [];
          let allSuppliers: { id: string; name: string }[] = [];
          if (canPay && rows.some((r) => r.edit === "advance")) {
            allSuppliers = await loadSupplierOptions(orgId);
            for (const a of summariesAll) if (a.purchases > 0) advTargets.push({ value: `a:${a.name}`, label: `Аукцион «${shortAuctionName(a.name)}», остаток ${formatMoney(a.remaining.toString())}`, supplierIds: a.suppliers.map((x) => x.id) });
            const loose = await loadLoosePurchases(orgId);
            for (const pu of loose) advTargets.push({ value: `p:${pu.id}`, label: `Закупка ${pu.number}`, supplierIds: [pu.supplierId] });
          }
          const payById = new Map(payments.map((p) => [p.id, p]));
          for (const r of rows) {
            if (r.kind === "prod") {
              if (r.links[0]) controls[r.id] = <Link href={r.links[0].href} className="text-blue-700 hover:underline">Править в карточке ТЗ →</Link>;
              continue;
            }
            const p = payById.get(r.id);
            if (!p) continue;
            if (r.edit === "purchase" && p.purchase) controls[r.id] = <Link href={`/purchases/${p.purchase.id}`} className="text-blue-700 hover:underline">Править в карточке закупки →</Link>;
            else if (!canPay) continue;
            else if (r.edit === "auction") {
              const a = summariesAll.find((x) => x.name === auctionName(p.auctionSession));
              if (a) controls[r.id] = auctionPayControls(p, a);
            } else if (r.edit === "advance") {
              controls[r.id] = (
                <div className="flex flex-wrap items-start gap-3">
                  <AdvanceRowControls suppliers={allSuppliers} initial={{ id: p.id, supplierId: p.supplierId, amount: p.amount.toString(), method: p.method, paidAt: p.paidAt.toISOString().slice(0, 10), notes: p.notes ?? "", version: rowVersion(p, PAYMENT_V) }} />
                  <AllocateAdvanceControls paymentId={p.id} supplierId={p.supplierId} amount={p.amount.toString()} targets={advTargets} />
                </div>
              );
            }
          }
          return <PaymentsOverview rows={rows} left={left} controls={controls} />;
        })()}
        </>
  );
}
