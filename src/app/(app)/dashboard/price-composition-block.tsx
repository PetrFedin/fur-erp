"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TH as Head } from "@/components/table-head";
import Link from "next/link";
import { WidgetRow } from "@/components/widget-row";
import { TileCarousel } from "@/components/tile-carousel";
import { PriceCompositionChart, useChartVat } from "@/components/price-composition";
import { COMP_CATS, CAT_LABEL, sliceList, type CompCat } from "@/lib/price-composition";
import type { PCLot } from "@/lib/price-composition-server";
import { formatMoney, formatPercent, formatQty } from "@/lib/utils";

const NCAT = COMP_CATS.length;
const KEYS: string[] = [...COMP_CATS.map((c) => c.key), "nobd"];

type Agg = { cats: Record<CompCat, number>; nobd: number; vat: number; qty: number; unit: Record<string, number>; unitTotal: number; lots: PCLot[]; approx: number; nobdLots: number; planned: number };

function aggregate(lots: PCLot[]): Agg {
  const cats = Object.fromEntries(COMP_CATS.map((c) => [c.key, 0])) as Record<CompCat, number>;
  const unit: Record<string, number> = Object.fromEntries(KEYS.map((k) => [k, 0]));
  let nobd = 0, vat = 0, qty = 0, unitTotal = 0, approx = 0, nobdLots = 0, planned = 0;
  for (const l of lots) {
    COMP_CATS.forEach((c, i) => { cats[c.key] += l.excl[i]; if (l.qty > 0) unit[c.key] += l.excl[i]; });
    nobd += l.excl[NCAT]; vat += l.vat; qty += l.qty;
    if (l.qty > 0) { unit.nobd += l.excl[NCAT]; unitTotal += l.excl.reduce((a, x) => a + x, 0); }
    if (l.approx) approx++;
    if (l.kind === "lot" && l.excl[NCAT] > 0) nobdLots++;
    if (l.kind === "planned") planned++;
  }
  return { cats, nobd, vat, qty, unit, unitTotal, lots, approx, nobdLots, planned };
}

function Modal({ title, onClose, children, returnTo }: { title: string; onClose: () => void; children: React.ReactNode; returnTo: HTMLElement | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const f = Array.from(ref.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled])"));
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); document.body.style.overflow = prev; returnTo?.focus(); };
  }, [onClose, returnTo]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold">{title}</h3>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Закрыть" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg leading-none text-neutral-600 hover:bg-orange-50 hover:text-orange-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Slide({ lots, fur, label, withVat }: { lots: PCLot[]; fur: string | null; label: string; withVat: boolean }) {
  const a = useMemo(() => aggregate(lots), [lots]);
  const [open, setOpen] = useState<string | null>(null);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const slices = sliceList(a.cats, { nobd: a.nobd, vat: a.vat, withVat });
  const exclTotal = Object.values(a.cats).reduce((s, v) => s + v, 0) + a.nobd;
  const total = withVat ? exclTotal + a.vat : exclTotal;
  const unitVals = { ...a.unit, vat: a.lots.reduce((s, l) => s + (l.qty > 0 ? l.vat : 0), 0) };
  const unitTotal = withVat ? a.unitTotal + unitVals.vat : a.unitTotal;
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const k of KEYS) m[k] = lots.filter((l) => l.excl[KEYS.indexOf(k)] > 0.005).length;
    return m;
  }, [lots]);
  // Сколько шкур приходится на каждую составляющую: сумма шкур лотов, где эта составляющая есть (данные лотов, не расчёт).
  const qtyVals = useMemo(() => {
    const m: Record<string, number> = Object.fromEntries(KEYS.map((k) => [k, 0]));
    m.vat = 0;
    for (const l of lots) {
      if (!(l.qty > 0)) continue;
      KEYS.forEach((k, i) => { if (l.excl[i] > 0.005) m[k] += l.qty; });
      if (l.vat > 0.005) m.vat += l.qty;
    }
    return m;
  }, [lots]);
  const openSlice = open ? slices.find((s) => s.key === open) : null;
  const sel = (key: string) => { setOpener(document.activeElement as HTMLElement | null); setOpen(key); };
  const rows = openSlice
    ? lots
        .map((l) => ({ l, v: openSlice.key === "vat" ? l.vat : l.excl[KEYS.indexOf(openSlice.key)], tot: l.excl.reduce((s, x) => s + x, 0) + (withVat ? l.vat : 0) }))
        .filter((r) => r.v > 0.005)
        .sort((x, y) => y.v - x.v)
    : [];
  const rowsSum = rows.reduce((s, r) => s + r.v, 0);
  const href = fur ? `/lots/fur/${encodeURIComponent(fur)}` : "/lots";
  return (
    <div className="flex flex-col gap-3 pt-1">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-neutral-500">
          {a.qty > 0 ? `${formatQty(a.qty)} шт.` : "без количества"} · {lots.filter((l) => l.kind === "lot").length} лот.
          {a.planned > 0 ? ` · не получено: ${a.planned}` : ""}
          {a.nobdLots > 0 ? ` · без разбивки: ${a.nobdLots} лот.` : ""}
        </span>
        {fur ? <Link href={href} className="ml-auto text-xs text-blue-700 hover:underline print:hidden">→ {fur}</Link> : null}
      </div>
      <PriceCompositionChart
        slices={slices} total={total} qty={a.qty} unitVals={unitVals} unitTotal={unitTotal} qtyVals={qtyVals}
        totalLabel={withVat ? "Всего, с НДС" : "Всего, без НДС"}
        ariaLabel={`Из чего складывается стоимость меха: ${label}${withVat ? ", с НДС" : ", без НДС"}`}
        onSelect={sel} selectTitle="Показать лоты с этой составляющей"
        countLabel={(k) => (k === "vat" ? null : counts[k] ? `${counts[k]} лот.` : null)}
      />
      {openSlice ? (
        <Modal title={`${openSlice.label} · ${label}`} onClose={() => setOpen(null)} returnTo={opener}>
          <p className="mb-2 text-xs text-neutral-500">
            Лоты, где есть эта составляющая ({rows.length}); суммы {withVat && openSlice.key !== "vat" ? "без НДС (НДС — отдельная строка)" : "без НДС"}. {openSlice.hint}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] table-fixed text-left text-sm">
              <colgroup><col /><col className="w-[6rem]" /><col className="w-[4.5rem]" /><col className="w-[7rem]" /><col className="w-[4.5rem]" /></colgroup>
              <thead>
                <tr className="border-b border-neutral-200 text-xs font-medium text-neutral-500">
                  <th className="py-1.5 pr-2">Лот</th><th className="px-1.5 py-1.5 text-right">Вид</th><Head label="Кол-во" unit="шт." align="right" className="px-1.5" /><th className="px-1.5 py-1.5 text-right">{openSlice.label}, ₽</th><th className="whitespace-nowrap px-1.5 py-1.5 text-right">Доля, %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ l, v, tot }) => (
                  <tr key={l.id} className="border-b border-neutral-100">
                    <td className="py-1.5 pr-2">
                      {l.kind === "lot" ? <Link href={`/analytics/raw/lot/${l.id}`} className="text-blue-700 hover:underline">№ {l.num}</Link> : <span>{l.num}</span>}
                      <div className="truncate text-[11px] text-neutral-500" title={l.auction}>{l.auction}</div>
                    </td>
                    <td className="truncate px-1.5 py-1.5 text-right text-xs" title={l.fur}>{l.fur}</td>
                    <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{l.qty > 0 ? formatQty(l.qty) : "—"}</td>
                    <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{formatMoney(v.toFixed(2))}</td>
                    <td className="whitespace-nowrap px-1.5 py-1.5 text-right text-neutral-500 tabular-nums">{tot > 0 ? formatPercent((v / tot) * 100) : "—"}</td>
                  </tr>
                ))}
                <tr className="row-total">
                  <td className="py-1.5 pr-2 text-sm font-semibold" colSpan={3}>Всего, ₽</td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{formatMoney(rowsSum.toFixed(2))}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <Link href={href} className="text-blue-700 hover:underline">{fur ? `→ Страница вида меха «${fur}»` : "→ Сырьё"}</Link>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function PriceCompositionBlock({ lots }: { lots: PCLot[] }) {
  const { withVat, toggle } = useChartVat();
  const furs = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lots) m.set(l.fur, (m.get(l.fur) ?? 0) + l.excl.reduce((s, x) => s + x, 0));
    return Array.from(m).sort((a, b) => b[1] - a[1]).map(([f]) => f);
  }, [lots]);
  if (lots.length === 0) return null;
  const slides = [
    { key: "total", label: "Тотал", body: <Slide lots={lots} fur={null} label="Тотал" withVat={withVat} /> },
    ...furs.map((f) => ({ key: `fur:${f}`, label: f, body: <Slide lots={lots.filter((l) => l.fur === f)} fur={f} label={f} withVat={withVat} /> })),
  ];
  return (
    <WidgetRow id="price-comp" title="Из чего складывается стоимость меха" headerEnd={<Link href="/lots" className="text-xs text-blue-700 hover:underline print:hidden">→ Сырьё</Link>}>
      <div className="grid grid-cols-1 items-stretch gap-3">
        <TileCarousel
          clickable
          toolbar={<div className="mt-1.5">{toggle}</div>}
          title="Стоимость меха"
          hintLabel="Из чего складывается стоимость меха"
          hint={
            <>
              <p>Всё купленное сырьё по финальной рублёвой стоимости в разрезе составляющих: {COMP_CATS.map((c) => CAT_LABEL[c.key]).join(", ")}. Состав каждого лота — из его расчётного листа (карточка лота → «Из чего складывается цена»).</p>
              <p className="mt-1">Суммы секторов без НДС (цена лота ÷ (1 + ставка лота)); в режиме «с НДС» добавляется сектор НДС, и итог равен «Куплено» меха на Главной. Заказанное, но не полученное (рысь) — по расчёту позиций закупки; шкуры подрядчика и лоты без расчёта — «Без разбивки в расчёте».</p>
              <p className="mt-1">Наведите на сектор или строку — подсветится парная; клик открывает лоты с этой составляющей. Фильтры Главной действуют.</p>
            </>
          }
          slidesLabel="слайды: тотал и виды меха" dotsLabel="Вид меха"
          slides={slides}
        />
      </div>
    </WidgetRow>
  );
}
