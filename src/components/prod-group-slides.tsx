"use client";

import { tzCountText } from "@/lib/tz-key";
import { formatMoney, formatQty, formatShare } from "@/lib/utils";
import type { DrillOrder } from "@/lib/dashboard-drill";
import { sumOrders, sumTotal, type VatSel } from "@/lib/orders-sum";
import { TileCaption, TileList, TileValue } from "@/app/(app)/dashboard/tile";

/** Слайды «Одежда» / «Аксессуары» плиток «Произведено» и «Себестоимость»: те же показатели, что в Тотале, но только по группе категорий (ремонт не входит). */
export const PROD_GROUPS = ["Одежда", "Аксессуары"] as const;

const money = (v: number) => formatMoney(v.toFixed(2));
const share = (v: number, t: number) => (t && Math.abs(v) > 0.005 ? v / t : null);
const pctText = (v: number, t: number) => (t ? formatShare(v / t) : "—");

const Empty = ({ loading }: { loading?: boolean }) => (
  <>
    <TileValue>{loading ? "…" : "—"}</TileValue>
    <TileCaption>{loading ? "загрузка…" : "нет изделий"}</TileCaption>
  </>
);

/** `all` — все ТЗ набора (с ремонтом); группа выбирается по o.grp, ремонт отсекается. */
export function GroupProducedSlide({ all, grp, vat, loading, link, compact }: { all: DrillOrder[]; grp: string; vat: VatSel; loading?: boolean; link?: boolean; compact?: boolean }) {
  const own = all.filter((o) => o.cat !== "Ремонт");
  const rows = own.filter((o) => o.grp === grp);
  const s = sumOrders(rows, vat);
  const t = sumOrders(own, vat);
  if (loading || s.qty <= 0) return <Empty loading={loading} />;
  const years = new Map<string, number>();
  for (const o of rows) { const k = o.y == null ? "Без года" : String(o.y); years.set(k, (years.get(k) ?? 0) + o.qty); }
  return (
    <>
      <TileValue>{formatQty(s.qty)} шт.</TileValue>
      <TileCaption>{compact ? `${s.orders} ТЗ` : tzCountText(s.orders, s.items)} · {pctText(s.qty, t.qty)} от всего</TileCaption>
      <TileList items={Array.from(years, ([k, q]) => ({ k, v: `${formatQty(q)} шт.`, share: share(q, s.qty) }))} />
    </>
  );
}

export function GroupCostSlide({ all, grp, vat, c4, loading, compact }: { all: DrillOrder[]; grp: string; vat: VatSel; c4: "on" | "off"; loading?: boolean; compact?: boolean }) {
  const own = all.filter((o) => o.cat !== "Ремонт");
  const s = sumOrders(own.filter((o) => o.grp === grp), vat);
  const totalOwn = sumTotal(sumOrders(own, vat));
  if (loading || s.qty <= 0) return <Empty loading={loading} />;
  const total = sumTotal(s);
  return (
    <>
      <TileValue>{money(total)}</TileValue>
      <div className="min-h-4 text-[11px] leading-4 tabular-nums text-neutral-400">{c4 === "on" ? `${money(total - s.c4)} без 4 %` : null}</div>
      <TileCaption>{pctText(total, totalOwn)} от всего{compact ? "" : ` без ремонта · ${vat === "incl" ? "с НДС" : "без НДС"}`}</TileCaption>
      <TileList items={[
        { k: "Мех", v: money(s.fur), share: share(s.fur, total) },
        { k: "Подкладка", v: money(s.lining), share: share(s.lining, total) },
        ...(c4 === "on" ? [{ k: "Надбавка 4 %", v: money(s.c4), share: share(s.c4, total) }] : []),
        ...(Math.abs(s.other) > 0.5 && Math.abs(s.other) >= total * 0.001 ? [{ k: "Расходы ТЗ и прочее", v: money(s.other), share: share(s.other, total) }] : []),
        { k: "Работа", v: money(s.work), share: share(s.work, total) },
      ]} />
    </>
  );
}
