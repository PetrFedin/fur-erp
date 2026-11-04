"use client";

// «Приход по месяцам» — вкладка отчёта «Заказ и продажи по сезонам» (04.11.2026, по просьбе владельца).
// По каждому сезону: фактический приход по месяцам из файла поступлений (структура категория 1 → мех → категория 2 → артикул).
// FW 26/27 дополнительно: заказ и поступило по отчёту + прогноз ноябрь/декабрь: в ноябре ждём то, что заведено в ТЗ,
// но ещё не пришло; остаток заказа без ТЗ делим пополам между ноябрём и декабрём (пропорция ТЗ-доли общая на сезон,
// на строки разносится пропорционально их «ждём» — оценка, не обещание поставки).
import { Fragment, useMemo, useState } from "react";
import { InfoHint } from "@/components/info-hint";
import type { ReportSizeRow } from "@/lib/margin-tree";
import type { SLine } from "@/lib/sales-section";
import { btn, DASH, n0, seg, segGroup } from "./sales-fmt";

const SEASONS = ["FW26/27", "SS26", "FW25/26"] as const;
type Season = (typeof SEASONS)[number];
const SEASON_LABEL: Record<Season, string> = { "FW26/27": "FW26", SS26: "SS26", "FW25/26": "FW25" };
const SEASON_BG: Record<Season, string> = { "FW26/27": "bg-sky-50/60", SS26: "bg-amber-50/60", "FW25/26": "bg-emerald-50/50" };
/** Сезон строки прихода (файл) → ключ отчёта. */
const SALES_TO_REPORT: Record<string, Season> = { "FW 25/26": "FW25/26", "SS 2026": "SS26", "FW 26/27": "FW26/27" };
const FUR_RU: Record<string, string> = { SABLE: "Соболь", MINK: "Норка", FOX: "Лиса", SWAKARA: "Свакара", LYNX: "Рысь", BEAVER: "Бобр", CHINCHILLA: "Шиншилла" };
const furRu = (k: string) => FUR_RU[k] ?? k;
const MONTH_RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const monthLabel = (k: string) => `${MONTH_RU[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;

/** Артикул в файле и в отчёте пишется по-разному («MH-03 SABLE…» и «MH-03/SABLE…»): сравнение без знаков и пробелов. */
const key = (a: string) => a.toUpperCase().replace(/[^A-ZА-Я0-9]/g, "");

type RNode = { id: string; label: string; conf: number; deliv: number; months: Map<string, number>; nov: number; dec: number; children: RNode[] };

export type TzAwait = { fur: string; cls: string; qty: number };

export function SeasonReceipts({ sizes, lines, tzAwait }: { sizes: ReportSizeRow[]; lines: SLine[]; tzAwait: TzAwait[] }) {
  const [season, setSeason] = useState<Season | "all">("all");
  const [open, setOpen] = useState<Set<string>>(new Set());

  /** Приход по месяцам: артикул (нормализованный) → сезон отчёта → месяц → шт. */
  const byArt = useMemo(() => {
    const m = new Map<string, Map<Season, Map<string, number>>>();
    for (const l of lines) {
      if (l.kind !== "RECEIPT" || !l.pcs) continue;
      const s = SALES_TO_REPORT[l.season]; if (!s) continue;
      const k = key(l.article), mk = l.iso.slice(0, 7);
      const a = m.get(k) ?? new Map(); m.set(k, a);
      const sm = a.get(s) ?? new Map(); a.set(s, sm);
      sm.set(mk, (sm.get(mk) ?? 0) + l.pcs);
    }
    return m;
  }, [lines]);

  /** Пропорция «в ноябре придёт то, что в ТЗ»: доля ждём по ТЗ в общем ждём FW26 (по отчёту). */
  const tzShare = useMemo(() => {
    let awaitTotal = 0;
    for (const r of sizes) awaitTotal += Math.max(0, (r.seas?.["FW26/27"]?.conf ?? 0) - (r.seas?.["FW26/27"]?.deliv ?? 0));
    const tz = tzAwait.reduce((a, t) => a + t.qty, 0);
    return awaitTotal > 0 ? Math.min(1, tz / awaitTotal) : 0;
  }, [sizes, tzAwait]);

  const buildSeason = (s: Season): { months: string[]; roots: RNode[]; total: RNode } => {
    const rows = sizes.filter((r) => r.seas?.[s]);
    const months = [...new Set(rows.flatMap((r) => [...(byArt.get(key(r.acode))?.get(s)?.keys() ?? [])]))].sort();
    const roots: RNode[] = [];
    const node = (id: string, label: string): RNode => ({ id, label, conf: 0, deliv: 0, months: new Map(), nov: 0, dec: 0, children: [] });
    const cat1s = new Map<string, RNode>();
    const total = node("total", "Всего");
    for (const r of rows) {
      const c = r.seas?.[s] ?? {};
      const conf = s === "FW26/27" ? c.conf ?? 0 : c.conf ?? c.deliv ?? 0, deliv = c.deliv ?? 0;
      const mm = byArt.get(key(r.acode))?.get(s);
      const inRows = conf || deliv || mm;
      if (!inRows) continue;
      const l1 = (r.l3 || "(без категории)").trim(), fur = furRu(r.fur ?? "Не указан"), l2 = (r.l4 || r.l5 || "(без категории)").trim();
      let n1 = cat1s.get(l1); if (!n1) { n1 = node(`c1:${l1}`, l1); cat1s.set(l1, n1); roots.push(n1); }
      let n2 = n1.children.find((x) => x.label === fur); if (!n2) { n2 = node(`${n1.id}/f:${fur}`, fur); n1.children.push(n2); }
      let n3 = n2.children.find((x) => x.label === l2); if (!n3) { n3 = node(`${n2.id}/c2:${l2}`, l2); n2.children.push(n3); }
      const artKey = `${r.acode} · ${r.color}`;
      let leaf = n3.children.find((x) => x.id === `${n3.id}/a:${artKey}`);
      if (!leaf) { leaf = node(`${n3.id}/a:${artKey}`, r.acode); n3.children.push(leaf); }
      const aw = s === "FW26/27" ? Math.max(0, conf - deliv) : 0;
      const nov = Math.round(aw * tzShare + (aw - aw * tzShare) / 2), dec = aw - nov;
      for (const n of [leaf, n3, n2, n1, total]) {
        n.conf += conf; n.deliv += deliv; n.nov += nov; n.dec += dec;
        if (mm) for (const [mk, pcs] of mm) n.months.set(mk, (n.months.get(mk) ?? 0) + pcs);
      }
    }
    const sortRec = (ns: RNode[]) => { ns.sort((a, b) => b.deliv - a.deliv || b.conf - a.conf || a.label.localeCompare(b.label)); for (const n of ns) sortRec(n.children); };
    sortRec(roots);
    return { months, roots, total };
  };

  const bySeason = useMemo(() => Object.fromEntries(SEASONS.map((s) => [s, buildSeason(s)])) as Record<Season, ReturnType<typeof buildSeason>>, [sizes, byArt, tzShare]); // eslint-disable-line react-hooks/exhaustive-deps

  const flip = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const expandAll = (s: Season) => { const ids = new Set<string>(); const walk = (n: RNode) => { if (n.children.length) { ids.add(n.id); n.children.forEach(walk); } }; bySeason[s].roots.forEach(walk); setOpen((o) => new Set([...o, ...ids])); };

  const renderRow = (n: RNode, s: Season, depth: number, months: string[]): React.ReactNode => {
    const isOpen = open.has(n.id), can = n.children.length > 0;
    return (
      <Fragment key={n.id}>
        <tr className="border-t border-neutral-200 hover:bg-neutral-50">
          <td className="sticky left-0 z-[5] bg-white px-2 py-1.5" style={{ paddingLeft: 8 + depth * 14 }}>
            <div className="flex items-center gap-2">
              {can ? <button type="button" onClick={() => flip(n.id)} aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Развернуть"}: ${n.label}`} className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-neutral-300 text-base hover:bg-neutral-100">{isOpen ? "−" : "+"}</button> : <span className="inline-block size-11 shrink-0" />}
              <span className={"truncate " + (depth <= 1 ? "font-semibold" : "")} title={n.label}>{n.label}</span>
            </div>
          </td>
          {s === "FW26/27" ? <td className="border-l border-neutral-300 px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{n0(n.conf)}</td> : null}
          <td className={`${s === "FW26/27" ? "" : "border-l border-neutral-300"} px-2 py-1.5 text-right tabular-nums whitespace-nowrap`}>{n0(n.deliv)}</td>
          {months.map((mk) => <td key={mk} className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{n.months.get(mk) ? n0(n.months.get(mk)!) : DASH}</td>)}
          {s === "FW26/27" ? <>
            <td className="border-l border-neutral-300 bg-sky-100/60 px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{n.nov ? n0(n.nov) : DASH}</td>
            <td className="bg-sky-100/60 px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{n.dec ? n0(n.dec) : DASH}</td>
          </> : null}
        </tr>
        {isOpen ? n.children.map((c) => renderRow(c, s, depth + 1, months)) : null}
      </Fragment>
    );
  };

  const table = (s: Season) => {
    const { months, roots, total } = bySeason[s];
    return (
      <div key={s} className="overflow-x-auto rounded-lg border border-neutral-300 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <th className="sticky left-0 z-10 bg-neutral-50 px-2 py-2 text-left text-xs font-semibold">Категория 1 → мех → категория 2 → артикул</th>
              {s === "FW26/27" ? <th className={`px-2 py-2 text-right text-xs font-semibold ${SEASON_BG[s]}`}>Заказано</th> : null}
              <th className={`px-2 py-2 text-right text-xs font-semibold ${SEASON_BG[s]}`}>Пришло</th>
              {months.map((mk) => <th key={mk} className="px-2 py-2 text-right text-xs font-semibold whitespace-nowrap">{monthLabel(mk)}</th>)}
              {s === "FW26/27" ? <>
                <th className="bg-sky-100/60 px-2 py-2 text-right text-xs font-semibold whitespace-nowrap">ноя 26*</th>
                <th className="bg-sky-100/60 px-2 py-2 text-right text-xs font-semibold whitespace-nowrap">дек 26*</th>
              </> : null}
            </tr>
          </thead>
          <tbody>{roots.map((n) => renderRow(n, s, 0, months))}</tbody>
          <tfoot className="bg-neutral-100">
            <tr className="border-t-2 border-neutral-400 font-semibold">
              <td className="sticky left-0 bg-neutral-100 px-2 py-2">Всего</td>
              {s === "FW26/27" ? <td className="px-2 py-2 text-right tabular-nums">{n0(total.conf)}</td> : null}
              <td className="px-2 py-2 text-right tabular-nums">{n0(total.deliv)}</td>
              {months.map((mk) => <td key={mk} className="px-2 py-2 text-right tabular-nums">{total.months.get(mk) ? n0(total.months.get(mk)!) : DASH}</td>)}
              {s === "FW26/27" ? <>
                <td className="bg-sky-100/60 px-2 py-2 text-right tabular-nums">{n0(total.nov)}</td>
                <td className="bg-sky-100/60 px-2 py-2 text-right tabular-nums">{n0(total.dec)}</td>
              </> : null}
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Сезон" className={segGroup}>
          {(["all", ...SEASONS] as const).map((s) => <button key={s} type="button" aria-pressed={season === s} onClick={() => setSeason(s)} className={seg(season === s)}>{s === "all" ? "Все сезоны" : SEASON_LABEL[s]}</button>)}
        </div>
        {season !== "all" ? <button type="button" onClick={() => expandAll(season)} className={btn}>Развернуть всё</button> : null}
        <InfoHint label="Прогноз ноября и декабря" wide>
          <p>По FW26: «ноя 26*» = ждём по заведённым ТЗ (пришло по ним ещё ничего) плюс половина остатка заказа без ТЗ; «дек 26*» — вторая половина. Доля ТЗ в сезоне общая, на строки разнесена пропорционально их «ждём» — это оценка для планирования, не обещание поставщика.</p>
          <p className="mt-1">«Заказано» и «Пришло» — из отчёта «заказ и продажи»; месяцы — фактический приход из файла поступлений (по датам поставки).</p>
        </InfoHint>
      </div>
      {(season === "all" ? [...SEASONS] : [season]).map((s) => (
        <Fragment key={s}>
          <h3 className="mt-1 text-sm font-semibold">{SEASON_LABEL[s]}{s === "FW26/27" ? " — заказ, приход и прогноз" : " — приход по месяцам"}</h3>
          {table(s)}
        </Fragment>
      ))}
    </div>
  );
}
