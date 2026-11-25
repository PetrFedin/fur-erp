import type { Decimal } from "@prisma/client/runtime/library";
import type { Commission4Mode } from "@/lib/commission4-mode";
import { sumUsagesWith4 } from "@/lib/commission4";
import { orderUnits } from "@/lib/production-totals";
import type { ListOrder } from "./config";

export type Full = { incl: Decimal; excl: Decimal };
export type Deliv = "off" | "partial" | "on";

// Колонки списка: те же функции, что у карточки (sumUsagesWith4); «без 4%» — мелко под цифрой, если надбавка есть.
export function makeStatOf(c4Mode: Commission4Mode) {
  return (o: ListOrder, full: { incl: Decimal; excl: Decimal }) => {
    const furU = o.materialUsages.filter((u) => u.rawMaterial.unit !== "M");
    const linU = o.materialUsages.filter((u) => u.rawMaterial.unit === "M");
    const fur = sumUsagesWith4(furU, c4Mode);
    const lining = sumUsagesWith4(linU, c4Mode);
    const diffOf = (a: { incl: Decimal; excl: Decimal }, b: { incl: Decimal; excl: Decimal }) => (a.incl.sub(b.incl).abs().lt(0.5) ? null : b);
    const furNoC4 = c4Mode === "on" ? diffOf(fur, sumUsagesWith4(furU, "off")) : null;
    const liningNoC4 = c4Mode === "on" ? diffOf(lining, sumUsagesWith4(linU, "off")) : null;
    const extra = fur.extraIncl.add(lining.extraIncl);
    const extraE = fur.extraExcl.add(lining.extraExcl);
    const noC4 = c4Mode === "on" && extra.gt(0.5) ? { incl: full.incl.sub(extra), excl: full.excl.sub(extraE) } : null;
    return {
      units: orderUnits(o),
      hides: furU.reduce((a, u) => a + u.quantity.toNumber(), 0),
      liningQty: linU.reduce((a, u) => a + u.quantity.toNumber(), 0),
      fur, lining, furNoC4, liningNoC4, noC4,
      work: o.clientWorkPricePerUnit ? o.clientWorkPricePerUnit.toNumber() * orderUnits(o) : 0,
    };
  };
}
export type StatOf = ReturnType<typeof makeStatOf>;
