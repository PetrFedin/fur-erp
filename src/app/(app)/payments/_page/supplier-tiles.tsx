import { isPositive } from "@/domain/money";
import { formatMoney } from "@/lib/utils";
import { shortAuctionName } from "@/lib/auction-names";
import { PAY_EPS, type AuctionPay } from "@/lib/auction-payments";
import { InfoHint } from "@/components/info-hint";
import { SupplierDebtHint } from "@/components/supplier-debt-hint";
import { type YearFilter } from "@/lib/year-filter";
import { PaymentTiles } from "../payment-tiles";
import { type payNumbers } from "@/lib/pay-display";
import { alignColumn } from "@/lib/money-round";
import { rawRounding } from "@/lib/raw-rounding";
import { type dashboardCached } from "@/lib/mart/snapshots";
import { auctionPeriod, isPastRu } from "./helpers";
import type { SupplierDebtData } from "./load";

/** Плитки «За сырьё»: стоимость, оплачено, долг поставщику и ближайшие сроки счетов. */
export function SupplierTiles({
  debt,
  supDash,
  rawPay,
  hidesMemo,
  rawPaidAll,
  auctions,
  anyPlanned,
  sum,
  deadlines,
  year,
}: {
  debt: SupplierDebtData;
  supDash: Awaited<ReturnType<typeof dashboardCached>> | null;
  rawPay: ReturnType<typeof payNumbers> | null;
  hidesMemo: number;
  rawPaidAll: number;
  auctions: AuctionPay[];
  anyPlanned: boolean;
  sum: (f: (a: AuctionPay) => { toString(): string }) => number;
  deadlines: { auction: string; date: string; amount: number; sort: string }[];
  year: YearFilter;
}) {
  return (
              <PaymentTiles
                split={supDash ? { paid: { fur: supDash.paidByItem.fur, lining: supDash.paidByItem.lining, services: supDash.paidByItem.services }, debt: { fur: supDash.left.fur, lining: supDash.left.lining, services: supDash.left.services } } : undefined}
                hidesMemo={hidesMemo}
                rounding={supDash ? rawRounding(supDash) : 0}
                shown={rawPay ? { total: rawPay.totalAll, paid: rawPay.paidAll, left: rawPay.leftAll, round: rawPay.roundAll, totalFur: rawPay.T.fur, totalLining: rawPay.T.lining, paidFur: rawPay.P.fur, paidLining: rawPay.P.lining, leftFur: rawPay.L.fur, leftLining: rawPay.L.lining, totalServices: rawPay.T.services, paidServices: rawPay.P.services, leftServices: rawPay.L.services } : undefined}
                paid={{
                  // Та же сумма, что «Оплачено → За сырьё» в разделе «Все» (мех и подкладка по оплатам, с шкурами подрядчика и зачётом переплат).
                  total: rawPaidAll,
                  unlinked: Number(debt.unlinkedAdvances.toString()),
                  rows: (() => {
                    const rows = auctions.filter((a) => a.paid.abs().greaterThan(PAY_EPS)).map((a) => ({ name: shortAuctionName(a.name), year: auctionPeriod(a.name)?.year ?? null, month: auctionPeriod(a.name)?.month, value: Number(a.paid.toString()) }));
                    const rest = rawPaidAll - rows.reduce((acc, r) => acc + r.value, 0);
                    return isPositive(rest) ? [...rows, { name: "Закупки без аукциона", year: null, value: rest }] : rows;
                  })(),
                }}
                debt={{
                  total: Number(debt.debt.toString()),
                  parts: [
                    { label: "Стоимость закупок, с НДС", value: Number(debt.total.toString()) },
                    ...(anyPlanned ? [{ label: "Запланировано", value: sum((a) => a.planned) }] : []),
                    { label: "За поставленное: мех получен, УПД и счета", value: Number(debt.receivedNet.toString()) },
                    { label: "По заказам: счёт выставлен, мех не поставлен", value: Number(debt.invoiced.toString()) },
                    { label: "По заказам: мех не поставлен, счёта ещё нет", value: Number(debt.expected.toString()) },
                  ],
                  rows: [
                    ...debt.byAuction.filter((a) => a.due.greaterThan(PAY_EPS)).map((a) => ({ name: shortAuctionName(a.name), year: auctionPeriod(a.name)?.year ?? null, month: auctionPeriod(a.name)?.month, value: Number(a.due.toString()) })),
                    ...(debt.nonAuctionDebt.greaterThan(PAY_EPS) ? [{ name: "Закупки без аукциона", year: null, value: Number(debt.nonAuctionDebt.toString()) }] : []),
                  ],
                }}
                paidHint={
                  <InfoHint wide label="Из чего состоит «Оплачено»" align="right">
                    <p>Та же цифра, что «Оплачено поставщику» на Главной (с НДС, от фильтров и 4 % не зависит): по закупкам и аукционам {formatMoney(debt.paid.toString())} + авансы без привязки {formatMoney(debt.unlinkedAdvances.toString())}.</p>
                  </InfoHint>
                }
                debtHint={<SupplierDebtHint debt={debt} year={year} align="right" />}
                debtSplit={rawPay && isPositive(rawPay.leftAll) && Math.abs(Number(debt.debt.toString()) - rawPay.leftAll) < 2 ? (() => { const al = alignColumn([Number(debt.receivedNet.toString()), Number(debt.invoiced.add(debt.expected).toString())], rawPay.leftAll).values; return { delivered: al[0], ordered: al[1] }; })() : undefined}
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
  );
}
