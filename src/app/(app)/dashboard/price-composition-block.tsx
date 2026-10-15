"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TH as Head } from "@/components/table-head";
import Link from "next/link";
import { WidgetRow } from "@/components/widget-row";
import { TileCarousel } from "@/components/tile-carousel";
import { PriceCompositionChart, useChartVat } from "@/components/price-composition";
import { COMP_CATS, CAT_LABEL, COMP_COLOR, alignSlices, sliceList, type CompCat, type CompSlice } from "@/lib/price-composition";
import type { PCLot } from "@/lib/price-composition-server";
import { formatMoney, formatPercent, formatQty } from "@/lib/utils";
import { ScopeBadge, useFurScope } from "@/components/fur-scope";
import { useClientSort } from "@/lib/use-client-sort";
import { lotCounts, lotCountsText, LOTS_RULE } from "@/lib/cost-labels";
import { alignColumn, lrAllocate, roundRub } from "@/lib/money-round";

const NCAT = COMP_CATS.length;
const KEYS: string[] = [...COMP_CATS.map((c) => c.key), "nobd"];

const RAW_IDX = KEYS.indexOf("raw");
const OTHER_IDX = KEYS.indexOf("other");
const NOBD_IDX = KEYS.indexOf("nobd");

/** Вес строки в счёте «лотов»: заказанное, но не полученное (лотов ещё нет) считается по позициям закупки — каждая станет лотом. */
const wt = (l: PCLot) => (l.kind === "planned" ? l.positions ?? 1 : 1);
/** «лотов 23, позиций заказано 71» (единый подсчёт lotCounts / LOTS_RULE): настоящие лоты, позиции заказанного и шкуры подрядчика — раздельно. */
const lotsLine = (lots: PCLot[]) => lotCountsText(lotCounts(lots));
const lotsWord = (n: number) => { const m = n % 100, d = n % 10; return m >= 11 && m <= 14 ? "лотов" : d === 1 ? "лот" : d >= 2 && d <= 4 ? "лота" : "лотов"; };

/** «Нет расчётного листа» входит в сектор «Сырьё» (в цене лота без разбивки в основном шкуры) подстрокой; сумма сектора = сумма подстрок. */
function mergeOther(list: CompSlice[], nobdLots: number): CompSlice[] {
  const r = list.find((s) => s.key === "raw");
  const n = list.find((s) => s.key === "nobd");
  if (!n) return list;
  const base: CompSlice = r ?? { key: "raw", label: "Сырьё", value: 0, color: COMP_COLOR.raw };
  const sub: CompSlice[] = [
    { key: "raw_o", label: "Шкуры по расчётному листу", value: base.value, color: COMP_COLOR.raw, hint: base.hint },
    { key: "nobd", label: `Нет расчётного листа (${nobdLots} ${lotsWord(nobdLots)})`, value: n.value, color: COMP_COLOR.nobd, hint: "Лоты и шкуры подрядчика без расчётного листа: цена лота не разложена на составляющие, по сути это сырьё; учтена в «Сырьё» целиком." },
  ];
  const merged: CompSlice = { ...base, value: base.value + n.value, sub };
  const at = list.findIndex((s) => s.key === "raw" || s.key === "nobd");
  return list.flatMap((s, i) => (i === at ? [merged] : s.key === "raw" || s.key === "nobd" ? [] : [s]));
}

type Agg = { cats: Record<CompCat, number>; nobd: number; vat: number; qty: number; lots: PCLot[]; approx: number; nobdLots: number; planned: number };

function aggregate(lots: PCLot[]): Agg {
  const cats = Object.fromEntries(COMP_CATS.map((c) => [c.key, 0])) as Record<CompCat, number>;
  let nobd = 0, vat = 0, qty = 0, approx = 0, nobdLots = 0, planned = 0;
  for (const l of lots) {
    COMP_CATS.forEach((c, i) => { cats[c.key] += l.excl[i]; });
    nobd += l.excl[NCAT]; vat += l.vat; qty += l.qty;
    if (l.approx) approx++;
    if (l.kind === "lot" && l.excl[NCAT] > 0) nobdLots++;
    if (l.kind === "planned") planned++;
  }
  return { cats, nobd, vat, qty, lots, approx, nobdLots, planned };
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

function Slide({ lots, fur, label, withVat, hideLink = false, totalTitle = "Вся закупка" }: { /** Заголовок слайда «все виды»: «Вся закупка» или выбранный источник. */ totalTitle?: string; lots: PCLot[]; fur: string | null; label: string; withVat: boolean; /** Страница самого вида меха: ссылка на себя не нужна. */ hideLink?: boolean }) {
  const a = useMemo(() => aggregate(lots), [lots]);
  const [open, setOpen] = useState<string | null>(null);
  const rcs = useClientSort<{ l: PCLot; v: number; tot: number }>({ lot: (x) => x.l.num, fur: (x) => x.l.fur, qty: (x) => x.l.qty, v: (x) => x.v, share: (x) => (x.tot > 0 ? x.v / x.tot : null) });
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const nobdLotsN = useMemo(() => lots.filter((l) => l.excl[NOBD_IDX] > 0.005).reduce((n, l) => n + wt(l), 0), [lots]);
  // «Прочие расходы» раскрываются по сути: упаковка (строка расчёта) и остаток до цены лота (округления, не разложенное).
  const otherGroups = useMemo(() => {
    const defs = [
      { k: "other_g:pack", label: "Упаковка", hint: "Строка «Упаковка» в расчёте (за шкуру, в долларах × курс ЦБ): упаковка шкур для отправки." },
      { k: "other_g:rest", label: "Округления и не разложенный остаток", hint: "Разница между ценой лота и суммой строк расчёта: копейки округления и мелочи, для которых в расчёте нет отдельной строки." },
    ];
    const g = defs.map((d) => ({ ...d, value: 0, unit: 0, qty: 0, n: 0 }));
    for (const l of lots) {
      const v = l.excl[OTHER_IDX];
      if (!(Math.abs(v) >= 0.005)) continue;
      const parts = [l.pack, v - l.pack];
      parts.forEach((x, i) => {
        if (!(Math.abs(x) >= 0.005)) return;
        g[i].value += x; g[i].n += wt(l);
        if (l.qty > 0) { g[i].unit += x; g[i].qty += l.qty; }
      });
    }
    return g.filter((e) => Math.abs(e.value) >= 0.005).map((e) => [e.k, e] as const);
  }, [lots]);
  // Рысь: пояснение «i» у «Выделки» и «Прочих расходов» (по документам, решение 13.10.2026; суммы и расчёт не меняются).
  const LYNX_NOTE = "Выделка — предварительная оценка Веллмех ($11 за шкуру × курс): в счёте аукциона Fur Harvesters шкуры сырые, документа от фабрики пока нет, сумма уточняется. Упаковка — отдельная статья: $11 за шкуру, сбор аукциона (сбор за обработку), подтверждена счётом аукциона №32324.";
  const slices = mergeOther(sliceList(a.cats, { nobd: a.nobd, vat: a.vat, withVat }), nobdLotsN).map((sl) =>
    sl.key === "other" && otherGroups.length > 0
      ? { ...sl, note: fur === "Рысь" ? LYNX_NOTE : undefined, sub: otherGroups.map(([k, e]) => ({ key: k, label: `${e.label} (${e.n} ${lotsWord(e.n)})`, value: e.value, color: COMP_COLOR.other, hint: e.hint })) }
      : fur === "Рысь" && (sl.key === "other" || sl.key === "dress") ? { ...sl, note: LYNX_NOTE } : sl);
  const exclTotal = Object.values(a.cats).reduce((s, v) => s + v, 0) + a.nobd;
  const totalExact = withVat ? exclTotal + a.vat : exclTotal;
  const total = roundRub(totalExact);
  const slicesShown = alignSlices(slices, total);
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const k of KEYS) m[k] = lots.filter((l) => l.excl[KEYS.indexOf(k)] > 0.005).reduce((n, l) => n + wt(l), 0);
    m.raw = lots.filter((l) => l.excl[RAW_IDX] > 0.005 || l.excl[NOBD_IDX] > 0.005).reduce((n, l) => n + wt(l), 0);
    m.raw_o = lots.filter((l) => l.excl[RAW_IDX] > 0.005).reduce((n, l) => n + wt(l), 0);
    return m;
  }, [lots]);
  // Сколько шкур приходится на каждую составляющую: сумма шкур лотов, где эта составляющая есть (данные лотов, не расчёт).
  const qtyVals = useMemo(() => {
    const m: Record<string, number> = Object.fromEntries(KEYS.map((k) => [k, 0]));
    m.vat = 0; m.raw_o = 0;
    for (const [k, e] of otherGroups) m[k] = e.qty;
    for (const l of lots) {
      if (!(l.qty > 0)) continue;
      if (l.excl[RAW_IDX] > 0.005) m.raw_o += l.qty;
      KEYS.forEach((k, i) => { if (k !== "raw" && l.excl[i] > 0.005) m[k] += l.qty; });
      if (l.excl[RAW_IDX] > 0.005 || l.excl[NOBD_IDX] > 0.005) m.raw += l.qty;
      if (l.vat > 0.005) m.vat += l.qty;
    }
    return m;
  }, [lots, otherGroups]);
  const openSlice = open ? slicesShown.find((s) => s.key === open) : null;
  const sel = (key: string) => { setOpener(document.activeElement as HTMLElement | null); setOpen(key); };
  const rows = openSlice
    ? lots
        .map((l) => ({ l, v: openSlice.key === "vat" ? l.vat : openSlice.key === "raw" ? l.excl[RAW_IDX] + l.excl[NOBD_IDX] : l.excl[KEYS.indexOf(openSlice.key)], tot: l.excl.reduce((s, x) => s + x, 0) + (withVat ? l.vat : 0) }))
        .filter((r) => r.v > 0.005)
        .sort((x, y) => y.v - x.v)
    : [];
  const rowsAl = alignColumn(rows.map((r) => r.v)); // лоты составляющей складываются в показанный итог окна
  const rowsShown = rows.map((r, i) => ({ ...r, v: rowsAl.values[i] }));
  const rowsSum = rowsAl.total;
  const href = fur ? `/lots/fur/${encodeURIComponent(fur)}` : "/lots";
  return (
    <div className="flex w-full flex-col gap-3 pt-1">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Вид меха</div>
          <h3 className="truncate text-base font-semibold leading-tight">{fur ?? totalTitle}</h3>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-neutral-500 tabular-nums">
            <span>{withVat ? "с НДС" : "без НДС"}</span>
            <span className="font-semibold text-neutral-900">{formatMoney(total)}</span>
            <span>{a.qty > 0 ? `${formatQty(a.qty)} шт.` : "без количества"} · {lotsLine(lots)}</span>
          </div>
        </div>
        {fur && !hideLink ? <Link href={href} className="shrink-0 text-xs text-blue-700 hover:underline print:hidden">→ {fur}</Link> : null}
      </div>
      <PriceCompositionChart
        slices={slicesShown} total={total} qty={a.qty} qtyVals={qtyVals}
        stacked totalLabel={withVat ? "Всего, с НДС" : "Всего, без НДС"}
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
                  <Head label="Лот" align="left" className="px-0 pr-2" {...rcs.th("lot")} /><Head label="Вид" align="right" className="px-1.5" {...rcs.th("fur")} /><Head label="Кол-во" unit="шт." align="right" className="px-1.5" {...rcs.th("qty")} /><Head label={`${openSlice.label}, ₽`} align="right" className="px-1.5" {...rcs.th("v")} /><Head label="Доля, %" align="right" className="px-1.5" {...rcs.th("share")} />
                </tr>
              </thead>
              <tbody>
                {rcs.sort(rowsShown).map(({ l, v, tot }) => (
                  <tr key={l.id} className="border-b border-neutral-100">
                    <td className="py-1.5 pr-2">
                      {l.kind === "lot" ? <Link href={`/analytics/raw/lot/${l.id}`} className="text-blue-700 hover:underline">№ {l.num}</Link> : <span>{l.num}</span>}
                      <div className="truncate text-[11px] text-neutral-500" title={l.auction}>{l.auction}{openSlice.key === "raw" && l.excl[NOBD_IDX] > 0.005 ? " · нет расчётного листа" : ""}</div>
                    </td>
                    <td className="truncate px-1.5 py-1.5 text-right text-xs" title={l.fur}>{l.fur}</td>
                    <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{l.qty > 0 ? formatQty(l.qty) : "—"}</td>
                    <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{formatMoney(v)}</td>
                    <td className="whitespace-nowrap px-1.5 py-1.5 text-right text-neutral-500 tabular-nums">{tot > 0 ? formatPercent((v / tot) * 100) : "—"}</td>
                  </tr>
                ))}
                <tr className="row-total">
                  <td className="py-1.5 pr-2 text-sm font-semibold" colSpan={3}>Всего, ₽</td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{formatMoney(rowsSum)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            {hideLink ? null : <Link href={href} className="text-blue-700 hover:underline">{fur ? `→ Страница вида меха «${fur}»` : "→ Сырьё"}</Link>}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

type Src = "all" | "auction" | "supplier";
const SRC_LABEL: Record<Src, string> = { all: "Все", auction: "Куплено на аукционе", supplier: "Куплено у поставщика" };
const SRC_KEYS: Src[] = ["all", "auction", "supplier"];

/** `onlyFur` — страница вида меха («Сырьё → Мех → Лиса»): тот же блок и те же лоты, что на Главной, но один слайд этого вида. */
export function PriceCompositionBlock({ lots: allLots, onlyFur, href = "/lots" }: { lots: PCLot[]; onlyFur?: string; /** «→ Сырьё» с фильтрами Главной. */ href?: string }) {
  const { withVat, toggle } = useChartVat();
  const scope = useFurScope();
  const [localSrc, setSrc] = useState<Src>("all");
  const src: Src = scope ? scope.src : localSrc;
  // Сумма «Куплено» по источнику (цена лота без НДС + НДС в режиме «с НДС»): Все = на аукционе + у поставщика, до рубля.
  // Все = round(точной суммы), «на аукционе» и «у поставщика» выравниваются под неё (src/lib/money-round.ts). Счёт лотов — единый (lotCounts): лоты, позиции заказанного, шкуры подрядчика.
  const sums = useMemo(() => {
    const ex: Record<Src, number> = { all: 0, auction: 0, supplier: 0 };
    const rowsBy: Record<Src, PCLot[]> = { all: allLots, auction: [], supplier: [] };
    for (const l of allLots) {
      const v = l.excl.reduce((s, x) => s + x, 0) + (withVat ? l.vat : 0);
      ex.all += v; ex[l.src] += v; rowsBy[l.src].push(l);
    }
    const total = roundRub(ex.all);
    const [au, su] = lrAllocate([ex.auction, ex.supplier], total);
    const shown: Record<Src, number> = { all: total, auction: au, supplier: su };
    return Object.fromEntries((["all", "auction", "supplier"] as Src[]).map((k) => [k, { v: shown[k], text: lotCountsText(lotCounts(rowsBy[k])) }])) as Record<Src, { v: number; text: string }>;
  }, [allLots, withVat]);
  const lots = useMemo(() => (src === "all" ? allLots : allLots.filter((l) => l.src === src)), [allLots, src]);
  const furs = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lots) m.set(l.fur, (m.get(l.fur) ?? 0) + l.excl.reduce((s, x) => s + x, 0));
    return Array.from(m).sort((a, b) => b[1] - a[1]).map(([f]) => f);
  }, [lots]);
  if (allLots.length === 0) return null;
  const label = SRC_LABEL[src];
  const slides = onlyFur ? [{ key: `${src}:fur:${onlyFur}`, label: onlyFur, body: <Slide lots={lots} fur={onlyFur} label={`${onlyFur} · ${label}`} withVat={withVat} hideLink /> }] : [
    { key: `${src}:total`, label: src === "all" ? "Вся закупка" : label, body: <Slide lots={lots} fur={null} label={src === "all" ? "Вся закупка" : label} totalTitle={src === "all" ? "Вся закупка" : label} withVat={withVat} /> },
    ...furs.map((f) => ({ key: `${src}:fur:${f}`, label: f, body: <Slide lots={lots.filter((l) => l.fur === f)} fur={f} label={`${f} · ${label}`} withVat={withVat} /> })),
  ];
  const sourceSwitch = (
    <div className="flex flex-col gap-1">
      {scope ? <div className="flex flex-wrap gap-1.5" data-testid="pc-source-switch"><ScopeBadge />{SRC_KEYS.map((k) => <span key={k} className={"rounded-md border px-2 py-1 text-[11px] tabular-nums " + (src === k ? "border-orange-300 bg-orange-50 text-orange-900" : "border-neutral-200 text-neutral-600")}>{SRC_LABEL[k]}: {formatMoney(sums[k].v)} · {sums[k].text}</span>)}</div> : <div role="group" aria-label="Источник закупки" data-testid="pc-source-switch" className="flex flex-wrap gap-1.5 print:hidden">
        {SRC_KEYS.map((k) => (
          <button key={k} type="button" aria-pressed={src === k} onClick={() => setSrc(k)}
            className={"inline-flex min-h-11 flex-col items-start justify-center rounded-md border px-3 py-1 text-left text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 " + (src === k ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50")}>
            <span className="font-medium">{SRC_LABEL[k]}</span>
            <span className="tabular-nums opacity-80">{formatMoney(sums[k].v)} · {sums[k].text}</span>
          </button>
        ))}
      </div>}
      <p className="text-[11px] leading-4 text-neutral-500" data-testid="pc-source-check">
        Все = на аукционе + у поставщика: {formatMoney(sums.auction.v)} + {formatMoney(sums.supplier.v)} = {formatMoney(sums.all.v)}. {LOTS_RULE}
      </p>
    </div>
  );
  return (
    <WidgetRow id="price-comp" title="Из чего складывается стоимость меха" headerEnd={onlyFur ? undefined : <Link href={href} className="text-xs text-blue-700 hover:underline print:hidden">→ Сырьё</Link>}>
      <div className="grid grid-cols-1 items-stretch gap-3">
        <TileCarousel
          clickable twoUp
          toolbar={<div className="mt-1.5 flex flex-col gap-2">{sourceSwitch}{toggle}</div>}
          title="Стоимость меха"
          hintLabel="Из чего складывается стоимость меха"
          hint={
            <>
              <p>Всё купленное сырьё по финальной рублёвой стоимости в разрезе составляющих: {COMP_CATS.map((c) => CAT_LABEL[c.key]).join(", ")}. Состав каждого лота — из его расчётного листа (карточка лота → «Из чего складывается цена»).</p>
              <p className="mt-1">Суммы секторов без НДС (цена лота ÷ (1 + ставка лота)); в режиме «с НДС» добавляется сектор НДС, и итог равен «Куплено» меха на Главной. Сектор «Прочее» раскрывается: «Упаковка и прочее» и лоты, у которых нет расчётного листа (и шкуры подрядчика).</p>
              <p className="mt-1"><b>Все / Куплено на аукционе / Куплено у поставщика</b> — переключатель источника; суммы статей пересчитываются под выбор. На аукционе — закупки, привязанные к аукциону справочника (включая заказанное, но не полученное); у поставщика — остальные и шкуры подрядчика. «Все» = на аукционе + у поставщика.</p>
              <p className="mt-1">Наведите на сектор или строку — подсветится парная; клик открывает лоты с этой составляющей. Фильтры Главной действуют.</p>
            </>
          }
          slidesLabel="слайды: вся закупка и отдельные виды меха" dotsLabel="Вид меха"
          slides={slides}
        />
      </div>
    </WidgetRow>
  );
}
