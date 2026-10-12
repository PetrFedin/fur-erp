"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { cn, formatMoney, formatPercent, formatQty } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";
import { InfoHint } from "@/components/info-hint";
import { TotalLabel } from "@/components/total-label";
import { TILE_BOX, TileHead, TileValue, TileCaption } from "@/app/(app)/dashboard/tile";
import type { FurKind, FurLot } from "@/lib/fur-table";

export type OrderInfo = {
  number: string; article: string; category: string; batch: string; year: number | null;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED"; units: number;
};
const STATUS: Record<OrderInfo["status"], string> = { PLANNED: "запланирован", IN_PROGRESS: "в работе", COMPLETED: "завершён" };

type Row = {
  orderId: string; number: string; info: OrderInfo | null;
  qty: number; excl: number; incl: number; extraExcl: number; extraIncl: number;
  usdQty: number; usdSum: number;
  lots: Map<string, { lot: FurLot; qty: number; excl: number; incl: number }>;
  auctions: Set<string>; remQty: number; remIncl: number; remExcl: number;
};

const D = () => <span className="text-neutral-300">—</span>;
const money = (v: number) => (Math.abs(v) < 0.5 ? <D /> : formatMoney(v));
const usd = (v: number) => `$${v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const BL = " border-l border-neutral-200";
const TH = "px-2 pb-2 pt-1 text-right align-bottom text-xs font-medium leading-tight text-neutral-500";
const TD = "whitespace-nowrap px-2 py-1.5 text-right tabular-nums";
const block = "border-b border-l border-neutral-200 px-2 pb-1 pt-2 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-600";

type SortKey = "number" | "year" | "qty" | "sum" | "avg" | "per";

/**
 * «Использование по ТЗ» на странице вида меха: одна строка = ТЗ (только списания этого меха из отфильтрованных лотов выше).
 * Шкуры, деньги без 4% и с 4%, средневзвешенные цены ₽ и $ (по лотам с ценой в $ — с охватом), на изделие, остаток в лотах ТЗ;
 * строка раскрывается до лотов и аукционов. Данные — те же списания (usages лотов), новых формул нет.
 */
export function FurOrdersTable({ lots, kind, orderInfo }: { lots: FurLot[]; kind: FurKind; orderInfo: Record<string, OrderInfo> }) {
  const { mode: vat } = useVatDisplay();
  const unit = kind === "lining" ? "м" : "шт.";
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "sum", dir: "desc" });
  const [q, setQ] = useState("");
  const [yearSel, setYearSel] = useState<number | "all">("all");

  const rows = useMemo(() => {
    const m = new Map<string, Row>();
    for (const l of lots) {
      for (const u of l.usages) {
        const r = m.get(u.orderId) ?? { orderId: u.orderId, number: u.number, info: orderInfo[u.orderId] ?? null, qty: 0, excl: 0, incl: 0, extraExcl: 0, extraIncl: 0, usdQty: 0, usdSum: 0, lots: new Map(), auctions: new Set<string>(), remQty: 0, remIncl: 0, remExcl: 0 };
        r.qty += u.qty; r.excl += u.excl; r.incl += u.incl; r.extraExcl += u.extraExcl; r.extraIncl += u.extraIncl;
        if (l.usdPrice != null) { r.usdQty += u.qty; r.usdSum += u.qty * l.usdPrice; }
        const lr = r.lots.get(l.id) ?? { lot: l, qty: 0, excl: 0, incl: 0 };
        lr.qty += u.qty; lr.excl += u.excl; lr.incl += u.incl;
        r.lots.set(l.id, lr);
        r.auctions.add(l.auctionLabel);
        m.set(u.orderId, r);
      }
    }
    for (const r of m.values()) for (const { lot } of r.lots.values()) { r.remQty += lot.rem; r.remIncl += lot.remIncl; r.remExcl += lot.remExcl; }
    return Array.from(m.values());
  }, [lots, orderInfo]);

  const base = (r: Pick<Row, "incl" | "excl">) => (vat === "excl" ? r.excl : r.incl);
  const withC4 = (r: Row) => base(r) + (vat === "excl" ? r.extraExcl : r.extraIncl);
  const needle = q.trim().toLowerCase();
  const years = useMemo(() => Array.from(new Set(rows.map((r) => r.info?.year).filter((y): y is number => y != null))).sort((a, b) => b - a), [rows]);
  const shown = useMemo(() => {
    const list = rows.filter((r) => (yearSel === "all" || r.info?.year === yearSel) && (!needle || [r.number, r.info?.article, r.info?.category, r.info?.batch].some((x) => (x ?? "").toLowerCase().includes(needle))));
    const val = (r: Row): number | string => {
      switch (sort.key) {
        case "number": return r.number;
        case "year": return r.info?.year ?? 0;
        case "qty": return r.qty;
        case "sum": return base(r);
        case "avg": return r.qty > 0 ? base(r) / r.qty : 0;
        case "per": return r.info && r.info.units > 0 ? r.qty / r.info.units : 0;
      }
    };
    const col = new Intl.Collator("ru", { numeric: true });
    return list.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : col.compare(String(x), String(y));
      return sort.dir === "asc" ? c : -c;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, needle, yearSel, sort, vat]);
  const list = all ? shown : shown.slice(0, 10);

  const T = shown.reduce((a, r) => ({
    qty: a.qty + r.qty, excl: a.excl + r.excl, incl: a.incl + r.incl, exE: a.exE + r.extraExcl, exI: a.exI + r.extraIncl,
    usdQty: a.usdQty + r.usdQty, usdSum: a.usdSum + r.usdSum, units: a.units + (r.info?.units ?? 0), remQty: a.remQty + r.remQty, remIncl: a.remIncl + r.remIncl, remExcl: a.remExcl + r.remExcl,
  }), { qty: 0, excl: 0, incl: 0, exE: 0, exI: 0, usdQty: 0, usdSum: 0, units: 0, remQty: 0, remIncl: 0, remExcl: 0 });
  const totBase = vat === "excl" ? T.excl : T.incl;
  const totC4 = totBase + (vat === "excl" ? T.exE : T.exI);
  const totalQtyAll = lots.reduce((a, l) => a + l.used, 0);

  const head = (k: SortKey, label: ReactNode, left?: boolean, bl?: boolean) => (
    <th className={cn(TH, left && "!text-left", bl && BL)} aria-sort={sort.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : "desc" }))} className={cn("hover:underline", sort.key === k && "text-[var(--ui-accent-text)]")} title="Сортировать">
        {label}{sort.key === k ? <span aria-hidden> {sort.dir === "asc" ? "▲" : "▼"}</span> : null}
      </button>
    </th>
  );
  const usdNote = (have: number, qty: number) => (have > 0 && qty - have > 0.0005 ? <div className="text-[10px] font-normal text-neutral-500">по {formatQty(have)} из {formatQty(qty)}</div> : null);
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const perUnit = (qty: number, units: number) => (units > 0 ? qty / units : null);
  const COLS = 17;

  return (
    <section aria-labelledby="fur-orders" className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 id="fur-orders" className="text-base font-semibold">Использование по ТЗ</h2>
        <InfoHint label="Как читать использование по ТЗ" wide>
          <p>Одна строка — одно ТЗ: сколько шкур (метров) этого вида ушло в него, на какую сумму, по какой средневзвешенной цене (₽ и $), сколько на изделие и сколько ещё лежит в лотах, из которых брало это ТЗ. Для ТЗ из нескольких видов меха — только списания этого вида. Фильтры таблицы выше действуют и здесь.</p>
          <p className="mt-1"><b>Сумма</b> — без 4% (режим «с НДС / без НДС» из шапки), мелко — с 4%. <b>Цена $</b> — только по лотам, где цена в $ записана в расчёте; «по N из M» — охват. «›» раскрывает лоты и аукционы ТЗ.</p>
          <p className="mt-1">Сумма по всем ТЗ = «Использовано» в таблице выше.</p>
        </InfoHint>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="tz-tiles">
        <div className={TILE_BOX}><TileHead>ТЗ</TileHead><TileValue compact>{shown.length}</TileValue><TileCaption>{rows.length !== shown.length ? `из ${rows.length}` : "уникальных ТЗ"}</TileCaption></div>
        <div className={TILE_BOX}><TileHead>{kind === "lining" ? "Метров всего" : "Шкур всего"}</TileHead><TileValue compact>{formatQty(T.qty)}</TileValue><TileCaption>{unit}</TileCaption></div>
        <div className={TILE_BOX}><TileHead>{kind === "lining" ? "Метров на изделие" : "Шкур на изделие"}</TileHead><TileValue compact>{T.units > 0 ? formatQty(Math.round((T.qty / T.units) * 100) / 100) : "—"}</TileValue><TileCaption>среднее: Σ {unit} ÷ Σ изделий</TileCaption></div>
        <div className={TILE_BOX}><TileHead>Ср. цена, ₽/{unit}</TileHead><TileValue compact>{T.qty > 0 ? formatMoney(Math.round((totBase / T.qty) * 100) / 100) : "—"}</TileValue><TileCaption>{T.usdQty > 0 ? `${usd(T.usdSum / T.usdQty)} · по ${formatQty(T.usdQty)} из ${formatQty(T.qty)}` : "цены в $ нет"}</TileCaption></div>
        <div className={TILE_BOX}><TileHead>Сумма, ₽</TileHead><TileValue compact>{formatMoney(totBase)}</TileValue><TileCaption>без 4%</TileCaption></div>
        <div className={TILE_BOX}><TileHead>Сумма с 4%, ₽</TileHead><TileValue compact>{formatMoney(totC4)}</TileValue><TileCaption>надбавка {formatMoney(totC4 - totBase)}</TileCaption></div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 print:hidden">
        <label className="flex items-center gap-1.5">
          <span>Поиск:</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="№ ТЗ, артикул, партия" aria-label="Поиск по ТЗ" className="ui-field h-8 w-52 rounded-lg border border-neutral-300 bg-white px-2 text-xs" />
        </label>
        {years.length > 1 ? (
          <div role="tablist" aria-label="Год ТЗ" className="flex items-center gap-1">
            <span>Год ТЗ:</span>
            {(["all", ...years] as const).map((y) => (
              <button key={String(y)} type="button" role="tab" aria-selected={yearSel === y} onClick={() => setYearSel(y)} className={"rounded-lg border px-2.5 py-1 text-xs " + (yearSel === y ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50")}>{y === "all" ? "Все" : y}</button>
            ))}
          </div>
        ) : null}
        <span>ТЗ: {shown.length}{totalQtyAll > 0 && Math.abs(totalQtyAll - rows.reduce((a, r) => a + r.qty, 0)) > 0.01 ? " (часть списаний без ТЗ)" : ""}</span>
      </div>

      <div className="scroll-hint overflow-x-auto rounded-xl border border-neutral-200">
        <table className="w-full table-fixed text-sm" style={{ minWidth: 1720 }}>
          <colgroup>
            {[150, 110, 56, 150, 70, 96, 84, 66, 56, 70, 120, 120, 96, 110, 84, 100, 130].map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr>
              <th colSpan={6} className={block.replace("border-l ", "")}>ТЗ</th>
              <th colSpan={4} className={block}>{kind === "lining" ? "Подкладка из этого ТЗ" : "Мех из этого ТЗ"}</th>
              <th colSpan={4} className={block}>Стоимость</th>
              <th colSpan={2} className={block}>На изделие</th>
              <th colSpan={1} className={block}>Остаток в лотах ТЗ</th>
            </tr>
            <tr className="border-b border-neutral-200">
              {head("number", "№ ТЗ", true)}
              <th className={cn(TH, "!text-left")}>Партия</th>
              {head("year", "Год")}
              <th className={cn(TH, "!text-left")}>Артикул / категория</th>
              <th className={TH}>Изделий, шт.</th>
              <th className={TH}>Статус</th>
              {head("qty", `${kind === "lining" ? "Метров" : "Шкур"}, ${unit}`, false, true)}
              <th className={TH}>Доля, %</th>
              <th className={TH}>Лотов</th>
              <th className={TH}>Аукц.</th>
              {head("sum", <>Сумма без 4%, ₽<br /><span className="font-normal">с 4% — мелко</span></>, false, true)}
              <th className={TH}>В т.ч. НДС, ₽</th>
              {head("avg", `Ср. цена, ₽/${unit}`)}
              <th className={TH}>Ср. цена, $/{unit}</th>
              {head("per", `${kind === "lining" ? "М" : "Шкур"} на изд.`, false, true)}
              <th className={TH}>Мех на изд., ₽</th>
              <th className={cn(TH, BL)}>{unit}, ₽</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const isOpen = open.has(r.orderId);
              const info = r.info;
              const pu = perUnit(r.qty, info?.units ?? 0);
              const sum = base(r);
              return (
                <Fragment key={r.orderId}>
                  <tr className="border-t border-neutral-100">
                    <td className="px-2 py-1.5 text-left">
                      <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Раскрыть"} лоты ТЗ ${r.number}`} onClick={() => toggle(r.orderId)} className="mr-1 align-middle"><span aria-hidden className={cn("inline-block w-3 text-neutral-500 transition-transform", isOpen && "rotate-90")}>›</span></button>
                      <Link href={`/production/${r.orderId}`} className="text-blue-700 hover:underline">ТЗ {r.number}</Link>
                    </td>
                    <td className="truncate px-2 py-1.5 text-left text-xs" title={info?.batch}>{info?.batch || <D />}</td>
                    <td className={TD + " text-xs"}>{info?.year ?? <D />}</td>
                    <td className="truncate px-2 py-1.5 text-left text-xs" title={`${info?.article ?? ""} · ${info?.category ?? ""}`}>{info ? <>{info.article}<span className="text-neutral-500"> · {info.category}</span></> : <D />}</td>
                    <td className={TD}>{info && info.units > 0 ? formatQty(info.units) : <D />}</td>
                    <td className={TD + " text-xs"}>{info ? STATUS[info.status] : <D />}</td>
                    <td className={TD + BL}>{formatQty(r.qty)}</td>
                    <td className={TD + " text-neutral-600"}>{T.qty > 0 ? formatPercent((r.qty / T.qty) * 100) : <D />}</td>
                    <td className={TD}>{r.lots.size}</td>
                    <td className={TD}>{r.auctions.size}</td>
                    <td className={TD + BL}>{money(sum)}<div className="text-[10px] font-normal text-neutral-500">с 4%: {money(withC4(r))}</div></td>
                    <td className={TD}>{money(r.incl - r.excl)}</td>
                    <td className={TD}>{r.qty > 0 ? formatMoney(Math.round((sum / r.qty) * 100) / 100) : <D />}</td>
                    <td className={TD}>{r.usdQty > 0 ? usd(r.usdSum / r.usdQty) : <D />}{usdNote(r.usdQty, r.qty)}</td>
                    <td className={TD + BL}>{pu != null ? formatQty(Math.round(pu * 100) / 100) : <D />}</td>
                    <td className={TD}>{info && info.units > 0 ? formatMoney(Math.round((sum / info.units) * 100) / 100) : <D />}</td>
                    <td className={TD + BL}>{r.remQty > 0.0005 ? <>{formatQty(r.remQty)}<div className="text-[10px] font-normal text-neutral-500">{formatMoney(vat === "excl" ? r.remExcl : r.remIncl)}</div></> : <D />}</td>
                  </tr>
                  {isOpen ? Array.from(r.lots.values()).sort((a, b) => b.qty - a.qty).map(({ lot, qty, excl, incl }) => (
                    <tr key={lot.id} className="border-t border-neutral-100 bg-neutral-50/40 text-[13px] text-neutral-700">
                      <td className="px-2 py-1 pl-8 text-left" colSpan={3}>
                        {lot.id.startsWith("hides") || lot.id.startsWith("ordered:") ? <span>лот № {lot.lotNumber}</span> : <Link href={`/analytics/raw/lot/${lot.id}`} className="text-blue-700 hover:underline">лот № {lot.lotNumber}<span aria-hidden className="ml-1 text-[10px] text-neutral-400">↗</span></Link>}
                      </td>
                      <td className="truncate px-2 py-1 text-left text-xs" colSpan={3}>
                        {lot.auction !== "__none" ? <Link href={`/lots?auction=${encodeURIComponent(lot.auction)}`} className="text-blue-700 hover:underline">{lot.auctionLabel}<span aria-hidden className="ml-1 text-[10px] text-neutral-400">↗</span></Link> : lot.auctionLabel}
                      </td>
                      <td className={TD + BL}>{formatQty(qty)}</td>
                      <td className={TD} colSpan={3} />
                      <td className={TD + BL}>{money(vat === "excl" ? excl : incl)}</td>
                      <td className={TD}>{money(incl - excl)}</td>
                      <td className={TD}>{qty > 0 ? formatMoney(Math.round(((vat === "excl" ? excl : incl) / qty) * 100) / 100) : <D />}</td>
                      <td className={TD}>{lot.usdPrice != null ? usd(lot.usdPrice) : <D />}</td>
                      <td className={TD + BL} colSpan={2} />
                      <td className={TD + BL}>{lot.rem > 0.0005 ? formatQty(lot.rem) : <D />}</td>
                    </tr>
                  )) : null}
                </Fragment>
              );
            })}
            {shown.length === 0 ? <tr><td colSpan={COLS} className="px-3 py-5 text-center text-neutral-500">{rows.length === 0 ? "В ТЗ не использовано." : "Нет ТЗ по выбранным условиям."}</td></tr> : (
              <tr className="row-total">
                <td className="px-2 py-2 text-left" colSpan={4}><TotalLabel unit="₽" avg /></td>
                <td className={TD}>{T.units > 0 ? formatQty(T.units) : <D />}</td>
                <td className={TD} />
                <td className={TD + BL}>{formatQty(T.qty)}</td>
                <td className={TD}>{T.qty > 0 ? formatPercent(100) : <D />}</td>
                <td className={TD} /><td className={TD} />
                <td className={TD + BL}>{money(totBase)}<div className="text-[10px] font-normal opacity-80">с 4%: {money(totC4)}</div></td>
                <td className={TD}>{money(T.incl - T.excl)}</td>
                <td className={TD}>{T.qty > 0 ? formatMoney(Math.round((totBase / T.qty) * 100) / 100) : <D />}</td>
                <td className={TD}>{T.usdQty > 0 ? usd(T.usdSum / T.usdQty) : <D />}{usdNote(T.usdQty, T.qty)}</td>
                <td className={TD + BL}>{T.units > 0 ? formatQty(Math.round((T.qty / T.units) * 100) / 100) : <D />}</td>
                <td className={TD}>{T.units > 0 ? formatMoney(Math.round((totBase / T.units) * 100) / 100) : <D />}</td>
                <td className={TD + BL} title="Лот может быть у нескольких ТЗ — остатки не суммируются"><D /></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {shown.length > 10 ? (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="text-xs text-blue-700 hover:underline">
          {all ? "Показать топ-10" : `Показать все ТЗ (${shown.length})`}
        </button>
      ) : null}
    </section>
  );
}
