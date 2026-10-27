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

type Row = { key: string; label: string; supplier: boolean; qty: number; value: number; usdQty: number; usdSum: number; lots: number; placeholder?: boolean };
type Node = Row & { depth: 0 | 1 | 2; children: Node[] };
/** «SAGA 03.26» → «SAGA»: аукционный дом без даты сессии; названия без даты остаются как есть. */
const houseOf = (label: string) => label.replace(/[\s-]*\d{2}[.-]\d{2}$/, "").trim() || label;
/** Тип аукциона: РП, СП (российские), у поставщика, иностранные (SAGA, FH, AME и др.). */
const typeOf = (label: string, supplier: boolean) => (supplier ? "У поставщика" : /^(РП|СП)$/.test(houseOf(label)) ? houseOf(label) : "Иностранные аукционы");

/** Страна аукционного дома по названию дома из сессии («SAGA 03.26» → SAGA). Страна — по документам и названию дома (AME = American Legend, США — из письма по спецификации 11); неизвестный дом — без подписи. */
const COUNTRY: Record<string, string> = { "РП": "Россия", "СП": "Россия", "SAGA": "Финляндия", "FH": "Канада", "AME": "США", /* письмо «Аукцион American Legend — Спецификация 11 норка махагон» */ "KOPENHAGEN": "Дания", "KOPENHAGEN FUR": "Дания", "KF": "Дания" };
const countryOf = (label: string) => COUNTRY[houseOf(label).toUpperCase()] ?? null;
const ALL = "__all";

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
  const cur = fur === ALL ? "" : fur && furs.includes(fur) ? fur : furs[0] ?? "";

  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const { byHouse, byYear, all, keys } = useMemo(() => {
    const add = (r: Row, l: FurLot) => {
      r.qty += l.recv; r.value += ex ? l.recvExcl : l.recvIncl;
      // Заказано, но не получено: молоток по позициям закупки уже оплачен — берём его как цену в $ (лотов с ценой ещё нет).
      r.usdQty += l.usdQty > 0 ? l.usdQty : l.usdPlanQty ?? 0; r.usdSum += l.usdQty > 0 ? l.usdSubtotal : l.usdPlanSubtotal ?? 0; r.lots += 1;
    };
    const mk = (key: string, label: string, supplier: boolean, depth: 0 | 1 | 2): Node => ({ key, label, supplier, qty: 0, value: 0, usdQty: 0, usdSum: 0, lots: 0, depth, children: [] });
    const child = (p: Node, key: string, label: string, supplier: boolean, depth: 0 | 1 | 2) => { let c = p.children.find((x) => x.key === key); if (!c) { c = mk(key, label, supplier, depth); p.children.push(c); } return c; };
    const A = new Map<string, Node>(), B = new Map<string, Node>();
    const tot = mk("tot", "", false, 0);
    for (const l of real) {
      if (cur && l.item !== cur) continue;
      const supplier = classifyLotSource(l) === "supplier";
      const full = supplier ? "У поставщика" : l.auctionLabel || l.auction;
      const yk = String(l.year || 0), yl = l.year ? yk : "Без года";
      add(tot, l);
      // A: аукцион (дом) → год → сессия.
      const hk = supplier ? "__supplier" : houseOf(full);
      const h = A.get(hk) ?? mk("A|" + hk, supplier ? full : hk, supplier, 0); A.set(hk, h); add(h, l);
      const hy = child(h, `A|${hk}|${yk}`, yl, supplier, 1); add(hy, l);
      if (!supplier) add(child(hy, `A|${hk}|${yk}|${l.auction}`, full, false, 2), l);
      // B: год → тип аукциона (РП / СП / у поставщика / остальные) → сессия.
      const y = B.get(yk) ?? mk("B|" + yk, yl, false, 0); B.set(yk, y); add(y, l);
      const type = typeOf(full, supplier), yt = child(y, `B|${yk}|${type}`, type, supplier, 1); add(yt, l);
      if (!supplier) add(child(yt, `B|${yk}|${type}|${l.auction}`, full, false, 2), l);
    }
    const avg = (n: Node) => n.value / n.qty;
    const prune = (list: Node[], yearTop: boolean): Node[] => list.filter((n) => n.qty > 0.0005).map((n) => ({ ...n, children: prune(n.children, yearTop) }))
      .sort((a, b) => (yearTop && a.depth === 0) || (!yearTop && a.depth === 1) ? Number(b.key.split("|")[yearTop ? 1 : 2] ?? b.key) - Number(a.key.split("|")[yearTop ? 1 : 2] ?? a.key) : avg(a) - avg(b));
    const byHouse = prune([...A.values()], false), byYear = prune([...B.values()], true);
    const keys: string[] = []; const walk = (ns: Node[]) => ns.forEach((n) => { if (n.children.length) keys.push(n.key); walk(n.children); }); walk(byHouse); walk(byYear);
    return { byHouse, byYear, all: { qty: tot.qty, avg: tot.qty > 0 ? tot.value / tot.qty : 0, usdQty: tot.usdQty, usd: tot.usdQty > 0 ? tot.usdSum / tot.usdQty : 0 }, keys };
  }, [real, cur, ex]);
  const flatA: Node[] = [], flatB: Node[] = [];
  const emit = (out: Node[], ns: Node[]) => ns.forEach((n) => { out.push(n); if (open.has(n.key)) emit(out, n.children); });
  emit(flatA, byHouse); emit(flatB, byYear);
  const flat = [...flatA, ...flatB];

  if (furs.length === 0) return null;
  const maxAvg = Math.max(...flat.filter((r) => !r.placeholder).map((r) => r.value / r.qty), 1);
  const tone = (d: number) => (d <= -0.05 ? "text-[#17613c]" : d >= 0.05 ? "text-[#b4310b]" : "text-neutral-900");

  const renderRow = (r: Node) => {
              const avg = r.value / r.qty, d = all.avg > 0 ? avg / all.avg - 1 : 0;
              const can = r.children.length > 0, isOpen = open.has(r.key);
              return (
                <tr key={r.key} className={"border-b border-neutral-100 " + (r.depth === 0 ? "" : "bg-neutral-50/60")}>
                  <td className="px-2 py-1.5 text-left" style={{ paddingLeft: 8 + r.depth * 20 }}>
                    <div className="flex items-start gap-1">
                      {can ? <button type="button" onClick={() => toggle(r.key)} aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Развернуть"}: ${r.label}`} className="inline-flex size-7 shrink-0 items-center justify-center text-neutral-500 hover:text-neutral-900"><span aria-hidden className={"inline-block transition-transform " + (isOpen ? "rotate-90" : "")}>›</span></button> : <span className="w-7 shrink-0" />}
                      <div><span className={r.depth === 0 ? "font-medium" : ""}>{r.label}</span>{r.depth !== 1 && (r.supplier ? "Россия" : countryOf(r.label)) ? <span className="ml-1 text-[11px] font-normal text-neutral-500">· {r.supplier ? "Россия" : countryOf(r.label)}</span> : null}<div className="text-[11px] leading-4 text-neutral-500">{r.lots} лот.</div></div>
                    </div>
                  </td>
                  <td className="border-l border-neutral-200 px-2 py-1.5 text-right tabular-nums">{formatQty(r.qty)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{r.usdQty > 0 ? `$${Math.round(r.usdSum / r.usdQty).toLocaleString("ru-RU")}` : "—"}<div className="text-[11px] leading-4 text-neutral-500">{r.usdQty > 0 ? `по ${formatQty(r.usdQty)} из ${formatQty(r.qty)} шт.` : ""}</div></td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{K(avg)}</td>
                  <td className={"border-l border-neutral-200 px-2 py-1.5 text-right tabular-nums " + tone(d)}>{all.qty > 0 && (byHouse.length > 1 || byYear.length > 1) ? `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d * 100).toFixed(0)} %` : "—"}</td>
                  <td className="border-l border-neutral-200 px-2 py-1.5">
                    <div className="h-3 w-full rounded-sm bg-neutral-100" role="img" aria-label={`${r.label}: ${K(avg)} за шт.`}>
                      <div className="h-3 rounded-sm" style={{ width: `${Math.max(2, (avg / maxAvg) * 100)}%`, background: r.supplier ? "#4f6bb5" : "#d93a0e" }} />
                    </div>
                  </td>
                </tr>
              );
            };

  return (
    <section aria-label="Сравнение закупок по аукционам" className="rounded-lg border border-neutral-300 bg-white p-3" data-testid="auction-compare">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1 text-sm font-semibold">Сравнение закупок по аукционам
          <InfoHint label="Как читать сравнение" wide>
            <p><b>Итого, ₽/шт.</b> — всё, что заплатили за купленные шкуры ({ex ? "без НДС" : "с НДС"}), ÷ штуки. <b>Ср. цена, $</b> — по штукам, у которых цена в $ есть в расчёте лота (сколько из скольких — под ценой).</p>
            <p className="mt-1">Зелёный — дешевле среднего по этому меху на 5 % и больше, красный — дороже на 5 % и больше. Строки отсортированы от дешёвых к дорогим.</p>
          </InfoHint>
        </h2>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button type="button" onClick={() => setOpen(open.size ? new Set() : new Set(keys))} className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-xs hover:border-neutral-500">{open.size ? "Свернуть всё" : "Развернуть всё"}</button>
        <div role="group" aria-label="Вид меха" className={SEG_GROUP}>
          <button type="button" aria-pressed={fur === ALL} onClick={() => setFur(ALL)} className={segCls(fur === ALL)}>Все виды</button>
          {furs.map((f) => <button key={f} type="button" aria-pressed={cur === f && fur !== ALL} onClick={() => setFur(f)} className={segCls(cur === f && fur !== ALL)}>{f}</button>)}
        </div>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-neutral-200" data-keep-scroll tabIndex={0}>
        <table className="table-keep w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-600">
              <th scope="col" className="px-2 py-2 text-left font-semibold">Аукцион → год → сессия</th>
              <th scope="col" className="border-l border-neutral-200 px-2 py-2 text-right font-semibold">Куплено, шт.</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Ср. цена, $/шт.</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Итого, ₽/шт.</th>
              <th scope="col" className="border-l border-neutral-200 px-2 py-2 text-right font-semibold">К среднему</th>
              <th scope="col" className="w-[34%] border-l border-neutral-200 px-2 py-2 text-left font-semibold">Сравнение цен</th>
            </tr>
          </thead>
          <tbody>
            {flatA.map(renderRow)}
            <tr className="row-total border-b-2 border-neutral-400 bg-neutral-50 font-semibold">
              <td className="px-2 py-1.5 text-left">Итого по {cur || "всему меху"}, средневзвешенно</td>
              <td className="border-l border-neutral-200 px-2 py-1.5 text-right tabular-nums">{formatQty(all.qty)}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{all.usdQty > 0 ? `$${Math.round(all.usd).toLocaleString("ru-RU")}` : "—"}<div className="text-[11px] font-normal leading-4 text-neutral-500">{all.usdQty > 0 ? `по ${formatQty(all.usdQty)} из ${formatQty(all.qty)} шт.` : ""}</div></td>
              <td className="px-2 py-1.5 text-right tabular-nums">{K(all.avg)}</td>
              <td className="border-l border-neutral-200 px-2 py-1.5" />
              <td className="border-l border-neutral-200 px-2 py-1.5" />
            </tr>
            {flatB.map(renderRow)}
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
