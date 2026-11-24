import Link from "next/link";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { TILE_BOX, TileHead, TileValue, TileCaption } from "../../dashboard/tile";
import { Money } from "@/components/money";
import { VatLabel } from "@/components/vat-label";
import { formatCurrency, formatMoney, formatDec1, isRoundingRest, OVERPAY_FROM, roundingRestHint } from "@/lib/utils";
import { withExtra } from "@/lib/commission4-pick";
import { lotUnitCostExclVat } from "@/lib/purchase-totals";
import { usageExclVat } from "@/lib/commission4";
import { COMMISSION_RATE } from "@/lib/commission4-const";
import type { Commission4Mode } from "@/lib/commission4-mode";
import type { AuctionPay } from "@/lib/auction-payments";

/**
 * Плитки итогов закупки, когда витрина устарела (после правок, до фоновой пересборки): прежний расчёт по лотам закупки —
 * куплено, использовано, остаток, оплачено и долг (доля закупки в оплатах партии).
 */
export async function PurchaseFallbackTiles(p: {
  organizationId: string;
  lotIds: string[];
  c4Mode: Commission4Mode;
  currency: string;
  isForeignCurrency: boolean;
  grandTotalRub: Decimal;
  itemsTotalExclVatRub: Decimal;
  expensesTotalExclVat: Decimal;
  goodsExclVatRub: Decimal;
  extraExclVat: Decimal;
  vatTotal: Decimal;
  itemsTotal: Decimal;
  auctionPay: AuctionPay | null;
  shareDue: { paid: Decimal; rest: Decimal };
  balanceDue: Decimal;
}) {
  const { c4Mode, grandTotalRub, itemsTotalExclVatRub, expensesTotalExclVat, goodsExclVatRub, extraExclVat, vatTotal, isForeignCurrency, itemsTotal, auctionPay, shareDue, balanceDue } = p;
  const purchase = { currency: p.currency };
  const session = { user: { organizationId: p.organizationId } };
  const lotIdsOfPurchase = p.lotIds;
  const lotRows = lotIdsOfPurchase.length
    ? await prisma.rawMaterialLot.findMany({
        where: { organizationId: session.user.organizationId, id: { in: lotIdsOfPurchase } },
        select: { quantityReceived: true, quantityRemaining: true, unitCost: true, vatRate: true, materialCostExclVat: true, expenseCostExclVat: true, usages: { select: { quantity: true, totalCost: true, commission4: true, vatRate: true } } },
      })
    : [];
  const lvl = (() => {
    const z = () => new Decimal(0);
    const k4 = new Decimal(COMMISSION_RATE);
    const r = { usedQty: z(), usedIncl: z(), usedExcl: z(), extraIncl: z(), extraExcl: z(), remQty: z(), remIncl: z(), remExcl: z(), recvQty: z() };
    for (const l of lotRows) {
      const unitExcl = lotUnitCostExclVat(l);
      r.recvQty = r.recvQty.add(l.quantityReceived);
      for (const u of l.usages) {
        r.usedQty = r.usedQty.add(u.quantity); r.usedIncl = r.usedIncl.add(u.totalCost);
        const ex = usageExclVat(u, unitExcl);
        r.usedExcl = r.usedExcl.add(ex);
        if (u.commission4) { r.extraIncl = r.extraIncl.add(u.totalCost.mul(k4)); r.extraExcl = r.extraExcl.add(ex.mul(k4)); }
      }
      r.remQty = r.remQty.add(l.quantityRemaining);
      r.remIncl = r.remIncl.add(l.quantityRemaining.mul(l.unitCost));
      r.remExcl = r.remExcl.add(l.quantityRemaining.mul(unitExcl));
    }
    return r;
  })();
  const on4Purchase = withExtra(c4Mode);
  const pctOf = (part: Decimal, whole: Decimal) => (whole.greaterThan(0) ? ` · ${Math.round((Number(part) / Number(whole)) * 100)} %` : "");
  return (
      <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          label={<VatLabel base="Куплено, ₽" />}
          value={<Money incl={grandTotalRub} excl={itemsTotalExclVatRub.add(expensesTotalExclVat)} />}
          note={`сырьё ${formatMoney(goodsExclVatRub.toString())}${extraExclVat.isZero() ? "" : ` · расходы без НДС ${formatMoney(extraExclVat.toString())}`} · НДС ${formatMoney(vatTotal.toString())}${isForeignCurrency ? ` · позиции ${formatCurrency(itemsTotal.toString(), purchase.currency)}` : ""}`}
          emphasis
        />
        <SummaryCard
          label="Использовано"
          value={lotRows.length ? <Money incl={on4Purchase ? lvl.usedIncl.add(lvl.extraIncl) : lvl.usedIncl} excl={on4Purchase ? lvl.usedExcl.add(lvl.extraExcl) : lvl.usedExcl} /> : "–"}
          note={lotRows.length ? `${formatDec1(lvl.usedQty.toString())} из ${formatDec1(lvl.recvQty.toString())}${pctOf(lvl.usedQty, lvl.recvQty)}${on4Purchase && lvl.extraIncl.greaterThan(0) ? " · с 4 %" : ""}` : "лотов ещё нет"}
        />
        <SummaryCard
          label="Остаток на складе"
          value={lotRows.length ? <Money incl={lvl.remIncl} excl={lvl.remExcl} /> : "–"}
          note={lotRows.length ? `${formatDec1(lvl.remQty.toString())}${pctOf(lvl.remQty, lvl.recvQty)}` : "лотов ещё нет"}
        />
        {auctionPay ? (
          <>
            <SummaryCard
              label={
                <Link href={`/payments?auction=${encodeURIComponent(auctionPay.name)}#auction-block`} className="inline-block text-blue-600 hover:underline max-md:py-2" title={`Оплаты ведутся по партии «${auctionPay.name}» целиком; на закупку приходится её доля — как в списке закупок`}>
                  Оплачено
                </Link>
              }
              value={shareDue.paid.greaterThan(0.005) ? formatMoney(shareDue.paid.toString()) : "–"}
              note={`по закупке · партия «${auctionPay.name}»: ${formatMoney(auctionPay.paid.toString())} из ${formatMoney(auctionPay.total.toString())}`}
            />
            <SummaryCard
              label="Долг"
              value={isRoundingRest(shareDue.rest.toNumber(), grandTotalRub.toNumber()) ? "оплачено" : shareDue.rest.lessThan(-OVERPAY_FROM) ? `Переплата ${formatMoney(shareDue.rest.abs().toString())}` : formatMoney(shareDue.rest.abs().lessThan(0.005) ? "0" : shareDue.rest.toString())}
              note={isRoundingRest(shareDue.rest.toNumber(), grandTotalRub.toNumber()) ? roundingRestHint(shareDue.rest.toNumber()) : "по закупке"}
              warn={shareDue.rest.greaterThan(0) && !isRoundingRest(shareDue.rest.toNumber(), grandTotalRub.toNumber())}
            />
          </>
        ) : (
          <>
            <SummaryCard label="Оплачено" note="по закупке" value={formatMoney(grandTotalRub.sub(balanceDue).toString())} />
            <SummaryCard label="Долг" note={isRoundingRest(balanceDue.toNumber(), grandTotalRub.toNumber()) ? roundingRestHint(balanceDue.toNumber()) : "по закупке"} value={isRoundingRest(balanceDue.toNumber(), grandTotalRub.toNumber()) ? "оплачено" : balanceDue.lessThan(-OVERPAY_FROM) ? `Переплата ${formatMoney(balanceDue.abs().toString())}` : formatMoney(balanceDue.toString())} warn={balanceDue.greaterThan(0) && !isRoundingRest(balanceDue.toNumber(), grandTotalRub.toNumber())} />
          </>
        )}
      </div>
  );
}

function SummaryCard({
  label,
  value,
  emphasis,
  warn,
  note,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  emphasis?: boolean;
  warn?: boolean;
  note?: string;
}) {
  return (
    <div className={TILE_BOX}>
      <TileHead>{label}</TileHead>
      <TileValue className={"text-xl " + (warn ? "text-amber-700" : emphasis ? "text-neutral-900" : "text-neutral-700")}>{value}</TileValue>
      {note ? <TileCaption>{note}</TileCaption> : null}
    </div>
  );
}
