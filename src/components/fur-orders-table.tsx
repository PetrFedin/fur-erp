"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { cn, formatMoney, formatPercent, formatQty } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";
import { InfoHint } from "@/components/info-hint";
import { TotalLabel } from "@/components/total-label";
import { TILE_BOX, TileHead, TileValue, TileCaption } from "@/app/(app)/dashboard/tile";
import type { FurKind, FurLot } from "@/lib/fur-table";
import { TH, THGroup } from "@/components/table-head";
import { UNIT } from "@/lib/units";

export type OrderInfo = {
  number: string; article: string; category: string; batch: string; year: number | null;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED"; units: number;
  /** Группа категории артикула: «Одежда», «Аксессуары» или пусто (без группы, ремонт). */
  group: string;
};
type Grp = "all" | "cloth" | "acc";
const GRP_NAME: Record<Exclude<Grp, "all">, string> = { cloth: "Одежда", acc: "Аксессуары" };

type Row = {
  orderId: string; number: string; label: string; info: OrderInfo | null;
  qty: number; excl: number; incl: number; extraExcl: number; extraIncl: number;
  usdQty: number; usdSum: number;
  lots: Map<string, { lot: FurLot; qty: number; excl: number; incl: number }>;
  auctions: Set<string>; remQty: number; remIncl: number; remExcl: number;
  /** НДС внутри суммы списаний по ставке лота: ставка → ₽ (с НДС − без НДС). */
  vatBy: Map<number, number>;
};

const D = () => <span className="text-neutral-300">—</span>;
const money = (v: number) => (Math.abs(v) < 0.5 ? <D /> : formatMoney(v));
const usd = (v: number) => `$${v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const BL = " border-l border-neutral-200";
const TD = "whitespace-nowrap px-2 py-1.5 text-right tabular-nums";

type SortKey = "number" | "year" | "qty" | "sum" | "avg" | "per" | "article" | "units" | "lots" | "usd";

/**
 * «Использование по ТЗ» на странице вида меха: одна строка = ТЗ (только списания этого меха из отфильтрованных лотов выше).
 * Шкуры, деньги без 4% и с 4%, средневзвешенные цены ₽ и $ (по лотам с ценой в $ — с охватом), на изделие, остаток в лотах ТЗ;
 * строка раскрывается до лотов и аукционов. Данные — те же списания (usages лотов), новых формул нет.
 */
export function FurOrdersTable({ lots, kind, orderInfo, initialGrp }: { lots: FurLot[]; kind: FurKind; orderInfo: Record<string, OrderInfo>; initialGrp?: string }) {
  const { mode: vat } = useVatDisplay();
  const unit = kind === "lining" ? "м" : "шт.";
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "sum", dir: "desc" });
  const [q, setQ] = useState("");
  const [yearSel, setYearSel] = useState<number | "all">("all");
  // Группа ТЗ (Одежда / Аксессуары) — в адресе (?grp=cloth|acc): аксессуары расходуют мало шкур и занижают средние, поэтому группы смотрим отдельно.
  const [grp, setGrpState] = useState<Grp>(initialGrp === "cloth" || initialGrp === "acc" ? initialGrp : "all");
  const setGrp = (g: Grp) => {
    setGrpState(g);
    try {
      const url = new URL(window.location.href);
      if (g === "all") url.searchParams.delete("grp"); else url.searchParams.set("grp", g);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch { /* адресная строка недоступна */ }
  };

  const rows = useMemo(() => {
    const m = new Map<string, Row>();
    for (const l of lots) {
      for (const u of l.usages) {
        const r = m.get(u.orderId) ?? { orderId: u.orderId, number: u.number, label: u.label, info: orderInfo[u.orderId] ?? null, qty: 0, excl: 0, incl: 0, extraExcl: 0, extraIncl: 0, usdQty: 0, usdSum: 0, lots: new Map(), auctions: new Set<string>(), remQty: 0, remIncl: 0, remExcl: 0, vatBy: new Map<number, number>() };
        r.qty += u.qty; r.excl += u.excl; r.incl += u.incl; r.extraExcl += u.extraExcl; r.extraIncl += u.extraIncl;
        if (l.usdPrice != null) { r.usdQty += u.qty; r.usdSum += u.qty * l.usdPrice; }
        r.vatBy.set(l.vatRate, (r.vatBy.get(l.vatRate) ?? 0) + (u.incl - u.excl));
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
  const inGrp = useMemo(() => rows.filter((r) => grp === "all" || r.info?.group === GRP_NAME[grp]), [rows, grp]);
  // Сводка по обеим группам — всегда видна (не зависит от выбранной группы), чтобы сравнивать.
  const gsum = useMemo(() => {
    const f = (name: string) => {
      const l = rows.filter((r) => r.info?.group === name);
      const qty = l.reduce((a, r) => a + r.qty, 0), units = l.reduce((a, r) => a + (r.info?.units ?? 0), 0), sum = l.reduce((a, r) => a + (vat === "excl" ? r.excl : r.incl), 0);
      return { n: l.length, qty, per: units > 0 ? qty / units : null, price: qty > 0 ? sum / qty : null };
    };
    return { cloth: f("Одежда"), acc: f("Аксессуары") };
  }, [rows, vat]);
  const years = useMemo(() => Array.from(new Set(rows.map((r) => r.info?.year).filter((y): y is number => y != null))).sort((a, b) => b - a), [rows]);
  const shown = useMemo(() => {
    const list = inGrp.filter((r) => (yearSel === "all" || r.info?.year === yearSel) && (!needle || [r.number, r.label, r.info?.article, r.info?.category, r.info?.batch].some((x) => (x ?? "").toLowerCase().includes(needle))));
    const val = (r: Row): number | string => {
      switch (sort.key) {
        case "number": return r.label;
        case "year": return r.info?.year ?? 0;
        case "qty": return r.qty;
        case "sum": return base(r);
        case "avg": return r.qty > 0 ? base(r) / r.qty : 0;
        case "per": return r.info && r.info.units > 0 ? r.qty / r.info.units : 0;
        case "article": return r.info?.article ?? "";
        case "units": return r.info?.units ?? 0;
        case "lots": return r.lots.size;
        case "usd": return r.usdQty > 0 ? r.usdSum / r.usdQty : 0;
      }
    };
    const col = new Intl.Collator("ru", { numeric: true });
    return list.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : col.compare(String(x), String(y));
      return sort.dir === "asc" ? c : -c;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inGrp, needle, yearSel, sort, vat]);
  const list = all ? shown : shown.slice(0, 10);

  const T = shown.reduce((a, r) => ({
    qty: a.qty + r.qty, excl: a.excl + r.excl, incl: a.incl + r.incl, exE: a.exE + r.extraExcl, exI: a.exI + r.extraIncl,
    usdQty: a.usdQty + r.usdQty, usdSum: a.usdSum + r.usdSum, units: a.units + (r.info?.units ?? 0), remQty: a.remQty + r.remQty, remIncl: a.remIncl + r.remIncl, remExcl: a.remExcl + r.remExcl,
  }), { qty: 0, excl: 0, incl: 0, exE: 0, exI: 0, usdQty: 0, usdSum: 0, units: 0, remQty: 0, remIncl: 0, remExcl: 0 });
  const totVat = new Map<number, number>();
  for (const r of shown) for (const [k, v] of r.vatBy) totVat.set(k, (totVat.get(k) ?? 0) + v);
  const totBase = vat === "excl" ? T.excl : T.incl;
  const totC4 = totBase + (vat === "excl" ? T.exE : T.exI);
  const totalQtyAll = lots.reduce((a, l) => a + l.used, 0);

  const head = (k: SortKey, label: ReactNode, unit?: string, o: { left?: boolean; bl?: boolean; after?: ReactNode } = {}) => (
    <TH label={label} unit={unit} align={o.left ? "left" : "right"} sep={o.bl} after={o.after} sort={sort.key === k ? sort.dir : "none"} onSort={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : "desc" }))} />
  );
  const usdNote = (have: number, qty: number) => (have > 0 && qty - have > 0.0005 ? <div className="text-[10px] font-normal text-neutral-500">по {formatQty(have)} из {formatQty(qty)}</div> : null);
  const rateText = (rates: number[]) => `${vat === "excl" ? "без НДС" : "с НДС"} ${rates.sort((a, b) => a - b).map((r) => `${r}%`).join(" · ")}`;
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const perUnit = (qty: number, units: number) => (units > 0 ? qty / units : null);
  
  return (
    <section aria-labelledby="fur-orders" className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 id="fur-orders" className="block-title">Использование по ТЗ</h2>
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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-neutral-500">
        <div role="tablist" aria-label="Группа ТЗ" className="flex items-center gap-1 print:hidden">
          <span>Группа ТЗ:</span>
          {([["all", "Все"], ["cloth", "Одежда"], ["acc", "Аксессуары"]] as const).map(([g, label]) => (
            <button key={g} type="button" role="tab" aria-selected={grp === g} onClick={() => setGrp(g)} className={"rounded-lg border px-3 py-1 text-xs " + (grp === g ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50")}>{label}</button>
          ))}
        </div>
        <span data-testid="grp-summary" className="tabular-nums">
          Одежда: {formatQty(gsum.cloth.qty)} {unit}{gsum.cloth.per != null ? ` · ${formatQty(Math.round(gsum.cloth.per * 100) / 100)} ${unit}/изд.` : ""}{gsum.cloth.price != null ? ` · ${formatMoney(Math.round(gsum.cloth.price))}/${unit}` : ""}
          {"; "}
          Аксессуары: {formatQty(gsum.acc.qty)} {unit}{gsum.acc.per != null ? ` · ${formatQty(Math.round(gsum.acc.per * 100) / 100)} ${unit}/изд.` : ""}{gsum.acc.price != null ? ` · ${formatMoney(Math.round(gsum.acc.price))}/${unit}` : ""}
          <InfoHint label="Почему группы смотрят отдельно" wide>Аксессуары расходуют мало шкур на изделие, поэтому общие средние (шкур на изделие, цена меха на изделие) занижены; смотрите группы отдельно. ТЗ без группы категории (ремонт и прочие) — только в «Все».</InfoHint>
        </span>
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
        <table className="w-full table-fixed text-sm" style={{ minWidth: 1124 }}>
          <colgroup>
            {[170, 130, 52, 40, 66, 46, 46, 104, 80, 84, 50, 70, 90].map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr>
              <THGroup sep={false} colSpan={4} className="sticky left-0 z-[2] bg-white">ТЗ</THGroup>
              <THGroup colSpan={7}>{kind === "lining" ? "Подкладка из этого ТЗ" : "Мех из этого ТЗ"}</THGroup>
              <THGroup colSpan={2}>На изделие</THGroup>
            </tr>
            <tr className="border-b border-neutral-200">
              <TH align="left" className="sticky left-0 z-[2] bg-white" label="№ ТЗ / партия" sort={sort.key === "number" ? sort.dir : "none"} onSort={() => setSort((s) => ({ key: "number", dir: s.key === "number" && s.dir === "desc" ? "asc" : "desc" }))} />
              {head("article", "Артикул", undefined, { left: true })}
              {head("units", "Изд.", UNIT.pcs)}
              {head("year", "Год")}
              {head("qty", kind === "lining" ? "Метров" : "Шкур", unit, { bl: true })}
              {head("lots", "Лотов")}
              <TH label="Аукц." />
              {head("sum", "Сумма", `${UNIT.rub} · без 4%`)}
              {head("avg", "Ср. цена", `₽/${unit}`, { after: <InfoHint label="Что такое средневзвешенная цена" align="right">Средневзвешенное значение: сумма ÷ {kind === "lining" ? "метры" : "шкуры"} по лотам этого ТЗ.</InfoHint> })}
              <TH className="!px-1" label={grp === "all" ? "Доля" : "Доля от группы"} unit={UNIT.pct} />
              <TH label="Ср. цена" unit={`$/${unit}`} sort={sort.key === "usd" ? sort.dir : "none"} onSort={() => setSort((s) => ({ key: "usd", dir: s.key === "usd" && s.dir === "desc" ? "asc" : "desc" }))} after={<InfoHint label="Что такое средневзвешенная цена в долларах" align="right">Средневзвешенное значение: сумма ÷ {kind === "lining" ? "метры" : "шкуры"} по лотам этого ТЗ — только по лотам с ценой в $ (охват «по N из M»).</InfoHint>} />
              {head("per", kind === "lining" ? "Метров на изд." : "Шкур на изд.", unit, { bl: true })}
              <TH label={kind === "lining" ? "Подкладка на изд." : "Мех на изд."} unit={UNIT.rub} />
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
                  <tr className="border-t border-neutral-100 bg-white">
                    <td className="sticky left-0 z-[1] bg-white px-2 py-1.5 text-left">
                      <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Раскрыть"} лоты ${r.label}`} onClick={() => toggle(r.orderId)} className="mr-1 align-middle"><span aria-hidden className={cn("inline-block w-3 text-neutral-500 transition-transform", isOpen && "rotate-90")}>›</span></button>
                      <Link href={`/production/${r.orderId}`} className="whitespace-nowrap text-blue-700 hover:underline" title={`Внутренний номер заказа ${r.number}`}>{r.label}</Link>
                      <div className="truncate pl-4 text-[11px] text-neutral-500" title={info?.batch}>{info?.batch ?? " "}</div>
                    </td>
                    <td className="truncate px-2 py-1.5 text-left text-xs" title={`${info?.article ?? ""} · ${info?.category ?? ""}`}>{info ? <>{info.article.split(" · ")[0]}<div className="truncate text-[11px] text-neutral-500">{info.category}</div></> : <D />}</td>
                    <td className={TD}>{info && info.units > 0 ? formatQty(info.units) : <D />}</td>
                    <td className={TD + " text-xs"}>{info?.year ?? <D />}</td>
                    <td className={TD + BL}>{formatQty(r.qty)}</td>
                    <td className={TD}>{r.lots.size}</td>
                    <td className={TD}>{r.auctions.size}</td>
                    <td className={TD} title={`в т.ч. НДС: ${formatMoney(r.incl - r.excl)}`}>{money(sum)}<div className="text-[10px] font-normal text-neutral-500">с 4%: {money(withC4(r))}</div><div className="text-[10px] font-normal text-neutral-500">{rateText([...r.vatBy.keys()])}</div></td>
                    <td className={TD}>{r.qty > 0 ? formatMoney(Math.round((sum / r.qty) * 100) / 100) : <D />}</td>
                    <td className="whitespace-nowrap px-1 py-1.5 text-right tabular-nums text-neutral-600">{T.qty > 0 ? formatPercent((r.qty / T.qty) * 100) : <D />}</td>
                    <td className={TD}>{r.usdQty > 0 ? usd(r.usdSum / r.usdQty) : <D />}{usdNote(r.usdQty, r.qty)}</td>
                    <td className={TD + BL}>{pu != null ? formatQty(Math.round(pu * 100) / 100) : <D />}</td>
                    <td className={TD}>{info && info.units > 0 ? formatMoney(Math.round((sum / info.units) * 100) / 100) : <D />}</td>
                  </tr>
                  {isOpen ? Array.from(r.lots.values()).sort((a, b) => b.qty - a.qty).map(({ lot, qty, excl, incl }) => (
                    <tr key={lot.id} className="border-t border-neutral-100 bg-neutral-50/40 text-[13px] text-neutral-700">
                      <td className="sticky left-0 z-[1] bg-white px-2 py-1 pl-8 text-left">
                        {lot.id.startsWith("hides") || lot.id.startsWith("ordered:") ? <span>лот № {lot.lotNumber}</span> : <Link href={`/analytics/raw/lot/${lot.id}`} className="whitespace-nowrap text-blue-700 hover:underline">лот № {lot.lotNumber}<span aria-hidden className="ml-1 text-[10px] text-neutral-400">↗</span></Link>}
                      </td>
                      <td className="truncate px-2 py-1 text-left text-xs" colSpan={3}>
                        {lot.auction !== "__none" ? <Link href={`/lots?auction=${encodeURIComponent(lot.auction)}`} className="text-blue-700 hover:underline">{lot.auctionLabel}<span aria-hidden className="ml-1 text-[10px] text-neutral-400">↗</span></Link> : lot.auctionLabel}
                      </td>
                      <td className={TD + BL}>{formatQty(qty)}</td>
                      <td className={TD} colSpan={2} />
                      <td className={TD}>{money(vat === "excl" ? excl : incl)}<div className="text-[10px] font-normal text-neutral-500">НДС {lot.vatRate}%{lot.year < 2026 ? ", куплено до 2026" : ", с 2026"}</div></td>
                      <td className={TD}>{qty > 0 ? formatMoney(Math.round(((vat === "excl" ? excl : incl) / qty) * 100) / 100) : <D />}</td>
                      <td className="px-1" />
                      <td className={TD}>{lot.usdPrice != null ? usd(lot.usdPrice) : <D />}</td>
                      <td className={TD + BL} colSpan={2} />
                    </tr>
                  )) : null}
                </Fragment>
              );
            })}
            {shown.length === 0 ? <tr><td colSpan={13} className="px-3 py-5 text-center text-neutral-500">{rows.length === 0 ? "В ТЗ не использовано." : "Нет ТЗ по выбранным условиям."}</td></tr> : (
              <tr className="row-total">
                <td className="sticky left-0 z-[1] bg-inherit px-2 py-2 text-left"><TotalLabel unit="₽" avg /></td>
                <td className={TD} />
                <td className={TD}>{T.units > 0 ? formatQty(T.units) : <D />}</td>
                <td className={TD} />
                <td className={TD + BL}>{formatQty(T.qty)}</td>
                <td className={TD} /><td className={TD} />
                <td className={TD} title={`в т.ч. НДС: ${formatMoney(T.incl - T.excl)}`}>{money(totBase)}<div className="text-[10px] font-normal opacity-80">с 4%: {money(totC4)}</div><div className="text-[10px] font-normal opacity-80">{[...totVat.keys()].sort((a, b) => a - b).map((r) => `${r}%`).join(" · ")}</div><div className="text-[10px] font-normal opacity-80">НДС: {[...totVat.keys()].sort((a, b) => a - b).map((r) => `${r}% — ${formatMoney(totVat.get(r) ?? 0)}`).join(" · ")}</div></td>
                <td className={TD}>{T.qty > 0 ? formatMoney(Math.round((totBase / T.qty) * 100) / 100) : <D />}</td>
                <td className="whitespace-nowrap px-1 py-1.5 text-right tabular-nums">{T.qty > 0 ? formatPercent(100) : <D />}</td>
                <td className={TD}>{T.usdQty > 0 ? usd(T.usdSum / T.usdQty) : <D />}{usdNote(T.usdQty, T.qty)}</td>
                <td className={TD + BL}>{T.units > 0 ? formatQty(Math.round((T.qty / T.units) * 100) / 100) : <D />}</td>
                <td className={TD}>{T.units > 0 ? formatMoney(Math.round((totBase / T.units) * 100) / 100) : <D />}</td>
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
