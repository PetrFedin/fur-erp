import { Decimal } from "@prisma/client/runtime/library";
import { usageExclVat } from "@/lib/commission4";
import { lotUsdListed } from "@/lib/lot-hammer";

type UsageLot = {
  id: string;
  quantityRemaining: Decimal;
  unitCost: Decimal;
  usages: { quantity: Decimal; totalCost: Decimal; vatRate?: Decimal | null; commission4: boolean }[];
};
type UsageLine = { i: { quantity: Decimal; lot: UsageLot | null }; breakdown: unknown; totalIncl: Decimal; totalExcl: Decimal; unitExcl: Decimal };

/** Использовано, надбавка 4 %, остаток и средний $ за шкуру по учитываемым закупкам аукциона (для полосы итогов). */
export function levelUsage(counted: { lines: UsageLine[] }[], k4: Decimal) {
  const zero = () => new Decimal(0);
  let usedQty = zero(), usedIncl = zero(), usedExcl = zero(), extraIncl = zero(), extraExcl = zero(), remQty = zero(), remIncl = zero(), remExcl = zero();
  let usdSum = 0, usdQty = 0;
  const seenLots = new Set<string>();
  for (const b of counted) {
    for (const l of b.lines) {
      const q = Number(l.i.quantity.toString());
      const usd = lotUsdListed(l.breakdown, []);
      if (usd != null && q > 0) { usdSum += usd * q; usdQty += q; }
      const lot = l.i.lot;
      // Заказано, но не получено (лота ещё нет): входит в «Куплено», значит и в остаток целиком (как на Главной и в верхней полосе).
      if (!lot) { remQty = remQty.add(l.i.quantity); remIncl = remIncl.add(l.totalIncl); remExcl = remExcl.add(l.totalExcl); continue; }
      if (seenLots.has(lot.id)) continue;
      seenLots.add(lot.id);
      for (const u of lot.usages) {
        usedQty = usedQty.add(u.quantity); usedIncl = usedIncl.add(u.totalCost);
        const ex = usageExclVat(u, l.unitExcl);
        usedExcl = usedExcl.add(ex);
        if (u.commission4) { extraIncl = extraIncl.add(u.totalCost.mul(k4)); extraExcl = extraExcl.add(ex.mul(k4)); }
      }
      remQty = remQty.add(lot.quantityRemaining);
      remIncl = remIncl.add(lot.quantityRemaining.mul(lot.unitCost));
      remExcl = remExcl.add(lot.quantityRemaining.mul(l.unitExcl));
    }
  }
  return { usedQty, usedIncl, usedExcl, extraIncl, extraExcl, remQty, remIncl, remExcl, usdSum, usdQty };
}
