"use client";

import { useMemo, useState } from "react";
import { InfoHint } from "@/components/info-hint";
import { SEG_GROUP, segCls } from "@/components/segmented";
import { classifyLotSource } from "@/lib/purchase-source";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import type { FurLot } from "@/lib/fur-table";

// Сравнение закупок меха между аукционами и поставщиком: средняя цена в $ (по тем штукам, где она есть в расчёте лота)
// и итоговая средняя в рублях на шкуру («Куплено, ₽ ÷ шт.»). Помогает понять, на каком аукционе какой мех покупать выгоднее.

type Row = { key: string; label: string; supplier: boolean; qty: number; value: number; usdQty: number; usdSum: number; lots: number };

const FUR_ORDER_LIMIT = 6;
const K = (v: number) => formatMoney(Math.round(v));

export function AuctionCompare({ lots }: { lots: FurLot[] }) {
  const { mode } = useVatDisplay();
  const ex = mode === "excl";
  const real = useMemo(() => lots.filter((l) => l.recv > 0 && !l.id.startsWith("hides")), [lots]);
  const furs = useMemo(() => {
    const q = new Map<string, number>();
    for (const l of real) q.set(l.item, (q.get(l.item) ?? 0) + l.recv);
    return [...q].sort((a, b) => b[1] - a[1]).slice(0, FUR_ORDER_LIMIT).map(([k]) => k);
  }, [real]);
  const [fur, setFur] = useState<string>("");
  const cur = fur && furs.includes(fur) ? fur : furs[0] ?? "";

  const { rows, all } = useMemo(() => {
    const by = new Map<string, Row>();
    for (const l of real) {
      if (cur && l.item !== cur) continue;
      const supplier = classifyLotSource(l) === "supplier";
      const key = supplier ? "__supplier" : l.auction;
      const r = by.get(key) ?? { key, label: supplier ? "У поставщика (без аукциона)" : l.auctionLabel || l.auction, supplier, qty: 0, value: 0, usdQty: 0, usdSum: 0, lots: 0 };
      r.qty += l.recv; r.value += ex ? l.recvExcl : l.recvIncl; r.usdQty += l.usdQty; r.usdSum += l.usdSubtotal; r.lots += 1;
      by.set(key, r);
    }
    const list = [...by.values()].filter((r) => r.qty > 0.0005).sort((a, b) => a.value / a.qty - b.value / b.qty);
    const q = list.reduce((a, r) => a + r.qty, 0), v = list.reduce((a, r) => a + r.value, 0);
    return { rows: list, all: { qty: q, avg: q > 0 ? v / q : 0 } };
  }, [real, cur, ex]);

  if (furs.length === 0) return null;
  const maxAvg = Math.max(...rows.map((r) => r.value / r.qty), 1);
  const tone = (d: number) => (d <= -0.05 ? "text-[#17613c]" : d >= 0.05 ? "text-[#b4310b]" : "text-neutral-900");

  return (
    <section aria-label="Сравнение закупок по аукционам" className="rounded-lg border border-neutral-300 bg-white p-3" data-testid="auction-compare">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1 text-sm font-semibold">Сравнение закупок по аукционам
          <InfoHint label="Как читать сравнение" wide>
            <p><b>Итого, ₽/шт.</b> — всё, что заплатили за купленные шкуры ({ex ? "без НДС" : "с НДС"}), ÷ штуки. <b>Ср. цена, $</b> — по штукам, у которых цена в $ есть в расчёте лота (сколько из скольких — под ценой).</p>
            <p className="mt-1">Зелёный — дешевле среднего по этому меху на 5 % и больше, красный — дороже на 5 % и больше. Строки отсортированы от дешёвых к дорогим.</p>
          </InfoHint>
        </h2>
        <div role="group" aria-label="Вид меха" className={SEG_GROUP + " print:hidden"}>
          {furs.map((f) => <button key={f} type="button" aria-pressed={cur === f} onClick={() => setFur(f)} className={segCls(cur === f)}>{f}</button>)}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-neutral-200" data-keep-scroll tabIndex={0}>
        <table className="table-keep w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-600">
              <th scope="col" className="px-2 py-2 text-left font-semibold">Аукцион / закупка</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Куплено, шт.</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Ср. цена, $/шт.</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Итого, ₽/шт.</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">К среднему</th>
              <th scope="col" className="w-[34%] px-2 py-2 text-left font-semibold">Итого, ₽/шт.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const avg = r.value / r.qty, d = all.avg > 0 ? avg / all.avg - 1 : 0;
              return (
                <tr key={r.key} className="border-b border-neutral-100">
                  <td className="px-2 py-1.5 text-left">{r.label}<div className="text-[11px] leading-4 text-neutral-500">{r.lots} лот.</div></td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(r.qty)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.usdQty > 0 ? `$${Math.round(r.usdSum / r.usdQty).toLocaleString("ru-RU")}` : "—"}<div className="text-[11px] leading-4 text-neutral-500">по {formatQty(r.usdQty)} из {formatQty(r.qty)} шт.</div></td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{K(avg)}</td>
                  <td className={"px-2 py-1.5 text-right tabular-nums " + tone(d)}>{rows.length > 1 ? `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d * 100).toFixed(0)} %` : "—"}</td>
                  <td className="px-2 py-1.5">
                    <div className="h-3 w-full rounded-sm bg-neutral-100" role="img" aria-label={`${r.label}: ${K(avg)} за шт.`}>
                      <div className="h-3 rounded-sm" style={{ width: `${Math.max(2, (avg / maxAvg) * 100)}%`, background: r.supplier ? "#4f6bb5" : "#d93a0e" }} />
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr className="row-total border-t-2 border-neutral-400 font-semibold">
              <td className="px-2 py-1.5 text-left">Среднее по {cur}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(all.qty)}</td>
              <td className="px-2 py-1.5" />
              <td className="px-2 py-1.5 text-right tabular-nums">{K(all.avg)}</td>
              <td className="px-2 py-1.5" />
              <td className="px-2 py-1.5" />
            </tr>
          </tbody>
        </table>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700">
        <li className="inline-flex items-center gap-1.5"><i aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: "#d93a0e" }} />Аукцион</li>
        <li className="inline-flex items-center gap-1.5"><i aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: "#4f6bb5" }} />У поставщика</li>
      </ul>
    </section>
  );
}
