"use client";

import { useClientSort } from "@/lib/use-client-sort";
import Link from "next/link";
import { useMemo } from "react";
import { cn, formatMoney, formatPercent, formatQty, formatDec1 } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";
import { InfoHint } from "@/components/info-hint";
import { TotalLabel } from "@/components/total-label";
import { LotUsageMini } from "@/components/lot-usage-bar";
import { shortMaterialName } from "@/lib/material-name";
import type { FurLot } from "@/lib/fur-table";
import { TH, THGroup } from "@/components/table-head";
import { UNIT } from "@/lib/units";

const D = () => <span className="text-neutral-300">—</span>;
const money = (v: number) => (Math.abs(v) < 0.5 ? <D /> : formatMoney(v.toFixed(2)));
const TD = "whitespace-nowrap px-2 py-1.5 text-right tabular-nums";
const BL = " border-l border-neutral-200";

/** Таблица тканей партии подкладки: метры, цена ₽/м, сумма, НДС, использовано (м, %, полоса), остаток; ткань → карточка лота (одна закупка ткани) или её лоты. */
export function LiningFabrics({ lots }: { lots: FurLot[] }) {
  const { mode: vat } = useVatDisplay();
  const rows = useMemo(() => {
    const m = new Map<string, FurLot[]>();
    for (const l of lots) m.set(l.item, [...(m.get(l.item) ?? []), l]);
    return Array.from(m, ([item, ls]) => ({ item, ls })).sort((a, b) => a.item.localeCompare(b.item, "ru", { numeric: true }));
  }, [lots]);
  const sum = (ls: FurLot[]) => ({
    recv: ls.reduce((a, l) => a + l.recv, 0), used: ls.reduce((a, l) => a + l.used, 0), rem: ls.reduce((a, l) => a + l.rem, 0),
    incl: ls.reduce((a, l) => a + l.recvIncl, 0), excl: ls.reduce((a, l) => a + l.recvExcl, 0),
    usedV: ls.reduce((a, l) => a + (vat === "excl" ? l.usedExcl : l.usedIncl), 0), remV: ls.reduce((a, l) => a + (vat === "excl" ? l.remExcl : l.remIncl), 0),
  });
  const vatBy = (ls: FurLot[]) => {
    const m = new Map<number, number>();
    for (const l of ls) m.set(l.vatRate, (m.get(l.vatRate) ?? 0) + (l.recvIncl - l.recvExcl));
    const rates = [...m.keys()].sort((a, b) => a - b);
    return { rates, total: [...m.values()].reduce((a, v) => a + v, 0), detail: rates.map((r) => `${r} %: ${formatMoney(m.get(r) ?? 0)}`).join(" · ") };
  };
  // Сортировка по клику на заголовок (▲/▼, повторный клик — наоборот).
  const val0 = (ls: FurLot[]) => { const t = sum(ls); return vat === "excl" ? t.excl : t.incl; };
  const cs = useClientSort<{ item: string; ls: FurLot[] }>({
    name: (r) => r.item, recv: (r) => sum(r.ls).recv, price: (r) => { const t = sum(r.ls); return t.recv > 0 ? val0(r.ls) / t.recv : null; }, sum: (r) => val0(r.ls),
    rate: (r) => Math.max(0, ...r.ls.map((l) => l.vatRate)), vat: (r) => vatBy(r.ls).total, used: (r) => sum(r.ls).used, share: (r) => { const t = sum(r.ls); return t.recv > 0 ? t.used / t.recv : null; }, rem: (r) => sum(r.ls).rem,
  });
  const line = (item: string, ls: FurLot[], total = false) => {
    const s = sum(ls), v = vatBy(ls), val = vat === "excl" ? s.excl : s.incl;
    const pct = s.recv > 0 ? (s.used / s.recv) * 100 : 0;
    return (
      <tr key={item} className={total ? "row-total" : "border-t border-neutral-100"}>
        <td className="px-2 py-1.5 text-left">
          {total ? <TotalLabel unit="₽" avg /> : (
            <>
              {ls.length === 1 ? (
                <Link href={`/analytics/raw/lot/${ls[0].id}`} className="font-medium text-blue-700 hover:underline" title="Карточка лота">{shortMaterialName(item)}<span aria-hidden className="ml-1 text-[11px] text-neutral-400">↗</span></Link>
              ) : (
                <Link href={`/lots?tab=lining&lmat=${encodeURIComponent(item)}`} className="font-medium text-blue-700 hover:underline" title="Лоты этой ткани">{shortMaterialName(item)}<span aria-hidden className="ml-1 text-[11px] text-neutral-400">↗</span></Link>
              )}
              {ls.length > 1 ? <span className="ml-1.5 text-xs text-neutral-500">{ls.length} лот.</span> : null}
            </>
          )}
        </td>
        <td className={TD + BL}>{formatDec1(s.recv)}</td>
        <td className={TD}>{s.recv > 0 ? formatMoney(Math.round((val / s.recv) * 100) / 100) : <D />}</td>
        <td className={TD}>{money(val)}</td>
        <td className={TD + BL}>{v.rates.length ? v.rates.map((r) => `${r} %`).join(" · ") : <D />}</td>
        <td className={TD} title={v.detail}>{money(v.total)}</td>
        <td className={TD + BL}>{s.used > 0 ? <>{formatDec1(s.used)}<div className="text-[11px] font-normal text-neutral-500">{formatMoney(s.usedV)}</div></> : <D />}</td>
        <td className={cn(TD, "w-28")}>{s.recv > 0 ? (
          total ? formatPercent(pct) : <LotUsageMini recv={s.recv} used={s.used} unit="м" className="ml-auto w-full max-w-24" />
        ) : <D />}</td>
        <td className={TD + BL}>{s.rem > 0.0005 ? <>{formatDec1(s.rem)}<div className="text-[11px] font-normal text-neutral-500">{formatMoney(s.remV)}</div></> : <D />}</td>
      </tr>
    );
  };
  return (
    <section aria-labelledby="lb-fabrics" className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 id="lb-fabrics" className="text-base font-semibold">Ткани партии</h2>
        <InfoHint label="Как читать таблицу тканей" wide>
          <p>Что куплено в этой партии: метры, средневзвешенная цена ₽/м и сумма (режим «с НДС / без НДС» из шапки), ставка НДС и НДС в сумме, сколько метров использовано в ТЗ (без 4 %) и что осталось. Название ткани — ссылка на карточку лота (если ткань в партии одной строкой) или на её лоты.</p>
        </InfoHint>
      </div>
      <div className="scroll-hint overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full table-fixed text-sm" style={{ minWidth: 960 }}>
          <thead>
            <tr>
              <THGroup sep={false} colSpan={1}>{" "}</THGroup>
              <THGroup colSpan={3}>Куплено</THGroup>
              <THGroup colSpan={2}>НДС</THGroup>
              <THGroup colSpan={2}>Использовано</THGroup>
              <THGroup colSpan={1}>Остаток</THGroup>
            </tr>
            <tr className="border-b border-neutral-200">
              <TH align="left" label="Ткань" {...cs.th("name")} />
              <TH sep label="Кол-во" unit={UNIT.m} {...cs.th("recv")} />
              <TH label="Цена" unit={UNIT.rubPerM} {...cs.th("price")} />
              <TH label="Сумма" unit={UNIT.rub} {...cs.th("sum")} />
              <TH sep label="Ставка" unit={UNIT.pct} {...cs.th("rate")} />
              <TH label="НДС" unit={UNIT.rub} {...cs.th("vat")} />
              <TH sep label="Кол-во" unit={`${UNIT.m} · ${UNIT.rub}`} {...cs.th("used")} />
              <TH label="Доля" unit={UNIT.pct} {...cs.th("share")} />
              <TH sep label="Кол-во" unit={`${UNIT.m} · ${UNIT.rub}`} {...cs.th("rem")} />
            </tr>
          </thead>
          <tbody>
            {cs.sort(rows).map((r) => line(r.item, r.ls))}
            {rows.length === 0 ? <tr><td colSpan={9} className="px-3 py-5 text-center text-neutral-500">В партии нет тканей.</td></tr> : line("total", lots, true)}
          </tbody>
        </table>
      </div>
    </section>
  );
}
