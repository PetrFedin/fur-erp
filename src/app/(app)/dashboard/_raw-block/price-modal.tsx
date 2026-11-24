"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatQty, formatShare } from "@/lib/utils";
import { alignColumn, alignRows, type Trio } from "@/lib/money-round";
import { TotalLabel } from "@/components/total-label";
import { TH, THGroup } from "@/components/table-head";
import { UNIT } from "@/lib/units";
import type { FlowFigures } from "@/lib/fur-table";
import type { RawTableRow } from "@/lib/dashboard-data";
import { shortMaterialName } from "@/lib/material-name";
import { useClientSort } from "@/lib/use-client-sort";
import { usd, rub, MAIN_FUR_TILES } from "./shared";

const COL_TITLE = { recv: "Куплено", used: "Использовано", rem: "Остаток" } as const;

/** Цены по видам сырья для выбранной колонки (куплено / использовано / остаток): количество, сумма, средняя цена ₽ и $. */
export function PriceModal({ col, rows, vat, fur, lining, c4, onClose }: { col: "recv" | "used" | "rem"; rows: RawTableRow[]; vat: "incl" | "excl"; fur: FlowFigures | null; lining: FlowFigures | null; c4: "on" | "off"; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  // Суммы по видам — целые рубли, складывающиеся в итог (src/lib/money-round.ts): строки выравниваются под итог вида сырья.
  const al = (() => {
    const byKey = new Map<string, Trio>();
    const tot: Partial<Record<"fur" | "lining", Trio>> = {};
    for (const [kind, f] of [["fur", fur], ["lining", lining]] as const) {
      const rs = rows.filter((r) => r.kind === kind);
      if (rs.length === 0 || !f) continue;
      const a = alignRows(rs.map((r) => ({ r: r.cells[vat].rv, u: r.cells[vat].uv, m: r.cells[vat].mv })), { r: f.recvValue, u: c4 === "on" ? f.usedValueOther : f.usedValue, m: f.remValue });
      rs.forEach((r, i) => byKey.set(r.key, a.rows[i]));
      tot[kind] = a.total;
    }
    return { byKey, tot };
  })();
  const pickV = (t: Trio | undefined, raw: number) => (t ? (col === "recv" ? t.r : col === "used" ? t.u : t.m) : raw);
  const pick = (r: RawTableRow) => {
    const c = r.cells[vat];
    const u = r.usd;
    const base = col === "recv" ? { q: c.rq, v: pickV(al.byKey.get(r.key), c.rv), a: c.ra, d: u.bought } : col === "used" ? { q: c.uq, v: pickV(al.byKey.get(r.key), c.uv), a: c.ua, d: u.used } : { q: c.mq, v: pickV(al.byKey.get(r.key), c.mv), a: c.ma, d: u.rem };
    return { ...base, rq: c.rq };
  };
  const list = rows.map((r) => ({ r, ...pick(r) })).filter((x) => x.q > 0);
  const kinds: ("fur" | "lining")[] = ["fur", "lining"];
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [restOpen, setRestOpen] = useState(false);
  const pcs = useClientSort<{ r: RawTableRow; q: number; v: number; a: number | null; d: number | null; rq: number }>({ name: (x) => x.r.label, share: (x) => (x.rq > 0 ? x.q / x.rq : null), q: (x) => x.q, v: (x) => x.v, a: (x) => x.a, d: (x) => x.d });
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const pickYear = (c: RawTableRow["years"][number]["cells"], u: RawTableRow["usd"]) => { const x = c[vat]; const b = col === "recv" ? { q: x.rq, v: x.rv, a: x.ra, d: u.bought } : col === "used" ? { q: x.uq, v: x.uv, a: x.ua, d: u.used } : { q: x.mq, v: x.mv, a: x.ma, d: u.rem }; return { ...b, rq: x.rq }; };
  // Цена в долларах есть только у меха: в окне «Подкладка» колонки $ нет.
  const showUsd = rows.some((r) => r.kind === "fur");
  const showShare = col !== "recv";
  const cols = (showUsd ? 5 : 4) + (showShare ? 1 : 0);
  // Тонкие вертикальные линии между блоками колонок: «Количество» | «Сумма» | «Цена».
  const BL = " border-l border-neutral-200";
  const shareCell = (q: number, rq: number, cls = "px-2 py-1.5") => showShare ? <td className={`whitespace-nowrap ${cls} text-right tabular-nums text-neutral-500${BL}`}>{rq > 0 ? formatShare(q / rq) : "–"}</td> : null;
  // Итого по виду: количество, сумма, средневзвешенная цена ₽ и $ (как в карточке).
  const total = (f: FlowFigures | null, kind: "fur" | "lining") =>
    !f ? null : col === "recv" ? { q: f.recvQty, v: pickV(al.tot[kind], f.recvValue), a: f.recvAvg, d: f.usdAvg, rq: f.recvQty } : col === "used" ? { q: f.usedQty, v: pickV(al.tot[kind], c4 === "on" ? f.usedValueOther : f.usedValue), a: f.usedQty > 0 ? (c4 === "on" ? f.usedValueOther : f.usedValue) / f.usedQty : f.usedAvg, d: f.usdUsedAvg, rq: f.recvQty } : { q: f.remQty, v: pickV(al.tot[kind], f.remValue), a: f.remAvg, d: f.usdRemAvg, rq: f.recvQty };
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }} className="m-auto w-[calc(100vw-2rem)] max-w-3xl rounded-xl border border-neutral-200 bg-white p-0 text-left shadow-xl backdrop:bg-black/40">
      <div className="max-h-[88vh] overflow-y-auto p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Цена по видам сырья</div>
            <div className="text-lg font-semibold">{COL_TITLE[col]}</div>
          </div>
          <button type="button" onClick={() => ref.current?.close()} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">✕ Закрыть</button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <THGroup sep={false} colSpan={1}>{" "}</THGroup>
              <THGroup colSpan={showShare ? 2 : 1}>Количество</THGroup>
              <THGroup>Сумма</THGroup>
              <THGroup colSpan={showUsd ? 2 : 1}>Цена</THGroup>
            </tr>
            <tr className="border-b border-neutral-200">
              <TH align="left" label="Вид" {...pcs.th("name")} />
              {showShare ? <TH sep label="Доля от купленного" unit={UNIT.pct} {...pcs.th("share")} /> : null}
              <TH sep={!showShare} label="Кол-во" unit="шт. · м" {...pcs.th("q")} />
              <TH sep label="Сумма" unit={UNIT.rub} {...pcs.th("v")} />
              <TH sep label="Цена" unit="₽/шт. · ₽/м" {...pcs.th("a")} />
              {showUsd ? <TH label="Цена" unit={UNIT.usdPerPcs} {...pcs.th("d")} /> : null}
            </tr>
          </thead>
          <tbody>
            {kinds.map((k) => {
              const part = pcs.sort(list.filter((x) => x.r.kind === k).sort((a, b) => b.v - a.v));
              if (part.length === 0) return null;
              const unit = k === "lining" ? "м" : "шт.";
              // Основной мех — строками; остальное сырьё свёрнуто одной строкой, разворачивается по желанию.
              const isMain = (x: (typeof part)[number]) => k === "lining" || MAIN_FUR_TILES.includes(x.r.label);
              const mainPart = part.filter(isMain), restPart = part.filter((x) => !isMain(x));
              const restSum = restPart.reduce((t, x) => ({ q: t.q + x.q, v: t.v + x.v, rq: t.rq + x.rq }), { q: 0, v: 0, rq: 0 });
              const shown: ((typeof part)[number] | "rest")[] = restPart.length ? [...mainPart, "rest", ...(restOpen ? restPart : [])] : mainPart;
              return (
                <Fragment key={k}>
                  <tr data-hover-block={k} data-block={k} className="bg-neutral-100 text-xs font-semibold uppercase tracking-wide text-neutral-600"><td colSpan={cols} className="px-2 py-1">{k === "fur" ? "Мех" : "Подкладка"}</td></tr>
                  {k === "lining" ? (() => {
                    // Подкладка: сначала по годам и итого, потом — по видам ткани.
                    const byYear = new Map<number, { q: number; v: number; rq: number }>();
                    for (const x of part) for (const y of x.r.years) { const p = pickYear(y.cells, y.usd); if (p.q > 0) { const c = byYear.get(y.year) ?? { q: 0, v: 0, rq: 0 }; c.q += p.q; c.v += p.v; c.rq += p.rq; byYear.set(y.year, c); } }
                    {
                      // Годы подкладки складываются в итог подкладки (целые рубли, наибольшие остатки).
                      const ys = Array.from(byYear.entries()).sort((a, b) => a[0] - b[0]);
                      const ex = lining ? (col === "recv" ? lining.recvValue : col === "used" ? (c4 === "on" ? lining.usedValueOther : lining.usedValue) : lining.remValue) : undefined;
                      const a = alignColumn(ys.map(([, c]) => c.v), ex);
                      ys.forEach(([, c], i) => { c.v = a.values[i]; });
                    }
                    const t = total(lining, "lining");
                    return (
                      <>
                        {Array.from(byYear.entries()).sort((a, b) => a[0] - b[0]).map(([yr, c]) => (
                          <tr key={`y${yr}`} data-block={k} className="border-b border-neutral-100">
                            <td className="py-1.5 pr-2 font-medium">{yr}</td>
                            {shareCell(c.q, c.rq)}
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + (showShare ? "" : BL)}>{formatQty(c.q)} {unit}</td>
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{rub(c.v)}</td>
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums" + BL}>{c.q > 0 ? rub(c.v / c.q) : "–"}</td>
                          </tr>
                        ))}
                        {t ? (
                          <tr data-block={k} className="row-total">
                            <td className="py-1.5 pr-2"><TotalLabel avg /></td>
                            {shareCell(t.q, t.rq)}
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + (showShare ? "" : BL)}>{formatQty(t.q)} {unit}</td>
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{rub(t.v)}</td>
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{t.a != null ? rub(t.a) : "–"}</td>
                          </tr>
                        ) : null}
                        <tr className="text-xs text-neutral-500"><td colSpan={cols} className="px-2 pb-1 pt-2">По видам ткани (нажмите — разбивка по годам)</td></tr>
                      </>
                    );
                  })() : null}
                  {shown.map((x) => x === "rest" ? (
                    <tr key="rest" data-block={k} className="cursor-pointer border-b border-neutral-100 bg-neutral-50 hover:bg-neutral-100" onClick={() => setRestOpen((v) => !v)} aria-expanded={restOpen}>
                      <td className="py-1.5 pr-2 text-neutral-700"><span aria-hidden className="mr-1 inline-block w-3 text-neutral-600">{restOpen ? "▾" : "▸"}</span>Остальное сырьё ({restPart.length})</td>
                      {shareCell(restSum.q, restSum.rq)}
                      <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + (showShare ? "" : BL)}>{formatQty(restSum.q)} {unit}</td>
                      <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{rub(restSum.v)}</td>
                      <td className={"whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums" + BL}>{restSum.q > 0 ? rub(restSum.v / restSum.q) : "–"}</td>
                      {showUsd ? <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-neutral-700">–</td> : null}
                    </tr>
                  ) : (
                    <Fragment key={x.r.key}>
                    <tr data-block={k} className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50" onClick={() => toggle(x.r.key)} aria-expanded={open.has(x.r.key)}>
                      <td className="py-1.5 pr-2"><span aria-hidden className="mr-1 inline-block w-3 text-neutral-600">{open.has(x.r.key) ? "▾" : "▸"}</span>{k === "fur" && (x.r.lots > 0 || x.q > 0) ? <Link href={`/lots/fur/${encodeURIComponent(x.r.label)}`} onClick={(e) => e.stopPropagation()} className="hover:underline focus-visible:underline" title={`Страница вида меха «${x.r.label}»`}>{shortMaterialName(x.r.label)}<span aria-hidden className="ml-1 text-[11px] text-neutral-600">↗</span></Link> : shortMaterialName(x.r.label)}</td>
                      {shareCell(x.q, x.rq)}
                      <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + (showShare ? "" : BL)}>{formatQty(x.q)} {unit}</td>
                      <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{rub(x.v)}</td>
                      <td className={"whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums" + BL}>{x.a != null ? rub(x.a) : "–"}</td>
                      {showUsd ? <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-neutral-700">{x.d != null ? usd(x.d) : "–"}</td> : null}
                    </tr>
                    {open.has(x.r.key) ? (() => {
                      const kids = x.r.years.map((y) => ({ y, p: pickYear(y.cells, y.usd) })).filter((z) => z.p.q > 0);
                      const kv = alignColumn(kids.map((z) => z.p.v), x.v).values; // годы вида складываются в показанную сумму вида
                      return kids.map((z, i) => ({ y: z.y, p: { ...z.p, v: kv[i] } }));
                    })().map(({ y, p }) => (
                      <tr key={y.year} data-block={k} className="border-b border-neutral-100 bg-neutral-50/70 text-[13px] text-neutral-700">
                        <td className="py-1 pl-7 pr-2">{y.year}</td>
                        {shareCell(p.q, p.rq, "px-2 py-1")}
                        <td className={"whitespace-nowrap px-2 py-1 text-right tabular-nums" + (showShare ? "" : BL)}>{formatQty(p.q)} {unit}</td>
                        <td className={"whitespace-nowrap px-2 py-1 text-right tabular-nums" + BL}>{rub(p.v)}</td>
                        <td className={"whitespace-nowrap px-2 py-1 text-right tabular-nums" + BL}>{p.a != null ? rub(p.a) : "–"}</td>
                        {showUsd ? <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{p.d != null ? usd(p.d) : "–"}</td> : null}
                      </tr>
                    )) : null}
                    </Fragment>
                  ))}
                  {(() => {
                    const t = k === "fur" ? total(fur, "fur") : null;
                    return t ? (
                      <tr className="row-total">
                        <td className="py-1.5 pr-2"><TotalLabel avg /></td>
                        {shareCell(t.q, t.rq)}
                        <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + (showShare ? "" : BL)}>{formatQty(t.q)} {unit}</td>
                        <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{rub(t.v)}</td>
                        <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + BL}>{t.a != null ? rub(t.a) : "–"}</td>
                        {showUsd ? <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{t.d != null ? usd(t.d) : "–"}</td> : null}
                      </tr>
                    ) : null;
                  })()}
                </Fragment>
              );
            })}
            {list.length === 0 ? <tr><td colSpan={cols} className="px-2 py-6 text-center text-neutral-500">По выбранным фильтрам нет данных.</td></tr> : null}
          </tbody>
        </table>
        
      </div>
    </dialog>
  );
}
