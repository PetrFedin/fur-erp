"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import type { FlowFigures } from "@/lib/fur-table";
import type { RawTableRow } from "@/lib/dashboard-data";
import { TILE_BOX, TileHead } from "./tile";
import { BridgeHint, type ModeInfo } from "./mode-line";

type Pair = { incl: FlowFigures; excl: FlowFigures };

const usd = (v: number) => `$${v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rub = (v: number) => formatMoney(v.toFixed(2));

function Card({ title, children, hint, onOpen }: { title: string; children: React.ReactNode; hint?: React.ReactNode; onOpen?: () => void }) {
  return (
    <div className={TILE_BOX + (onOpen ? " cursor-pointer transition hover:border-neutral-400 hover:shadow-md" : "")} onClick={onOpen} role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} onKeyDown={onOpen ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } } : undefined} aria-haspopup={onOpen ? "dialog" : undefined} title={onOpen ? "Показать цены по видам сырья" : undefined}>
      <TileHead>{title}</TileHead>
      {hint ? <div className="absolute right-3 top-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{hint}</div> : null}
      {children}
    </div>
  );
}

/** Строка плитки: подпись, цифра, пояснение — высоты зарезервированы, чтобы строки трёх плиток стояли на одном уровне. */
function Row({ k, v, sub, strong, onClick }: { k: string; v: React.ReactNode; sub?: React.ReactNode; strong?: boolean; onClick?: () => void }) {
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-haspopup="dialog" title="Показать по видам сырья" className="mt-2 block w-full rounded text-left first:mt-1 hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">
        <div className="min-h-4 text-[11px] leading-4 text-neutral-500">{k}</div>
        <div className={(strong ? "text-xl font-semibold " : "text-base font-medium ") + "min-h-7 break-words leading-7 tabular-nums text-neutral-900 underline decoration-dotted decoration-neutral-300 underline-offset-4"}>{v}</div>
        {sub ? <div className="text-[11px] leading-4 text-neutral-500">{sub}</div> : null}
      </button>
    );
  }
  return (
    <div className="mt-2 first:mt-1">
      <div className="min-h-4 text-[11px] leading-4 text-neutral-500">{k}</div>
      <div className={(strong ? "text-xl font-semibold " : "text-base font-medium ") + "min-h-7 break-words leading-7 tabular-nums text-neutral-900"}>{v}</div>
      {sub ? <div className="text-[11px] leading-4 text-neutral-500">{sub}</div> : null}
    </div>
  );
}

function RawCards({ view, rows, fur, lining, c4 }: { view: "fur" | "lining"; rows: RawTableRow[]; fur: Pair; lining: Pair; c4: "on" | "off" }) {
  const { mode: vat } = useVatDisplay();
  const [priceCol, setPriceCol] = useState<null | "recv" | "used" | "rem">(null);
  const F = fur[vat];
  const L = lining[vat];
  const unit = view === "lining" ? "м" : "шт.";
  const cur = view === "lining" ? L : F;
  const all = false as boolean; // «Всё» убрано: мех и подкладка — отдельными рядами плиток
  const usdTile = view === "fur";

  const usdBought = (() => {
    if (view === "lining") return { main: "нет данных в USD", note: "подкладка закупается без цены в долларах" };
    if (F.usdQty <= 0 || F.usdAvg == null) return { main: "нет данных в USD", note: "в выбранном срезе нет лотов с закупочной ценой в USD" };
    const share = F.recvQty > 0 ? (F.usdQty / F.recvQty) * 100 : 0;
    const b = F.usdBySource;
    const parts = [
      b.direct > 0 ? `в долларах в расчёте лота — ${formatQty(b.direct)}` : null,
      b.eur > 0 ? `евро × курс EUR→USD из расчёта — ${formatQty(b.eur)}` : null,
      b.rub > 0 ? `молоток ₽ ÷ курс USD/RUB из расчёта — ${formatQty(b.rub)}` : null,
      b.calc > 0 ? `цена $ из расчётного листа — ${formatQty(b.calc)}` : null,
    ].filter(Boolean).join("; ");
    return {
      main: `${usd(F.usdAvg)} / шт.`,
      note: `по ${formatQty(F.usdQty)} из ${formatQty(F.recvQty)} шт. с ценой в USD (${share.toLocaleString("ru-RU", { maximumFractionDigits: 0 })}%)`,
      hint: `Источники цены, шт.: ${parts || "—"}. Остальные лоты — без цены в USD (только рубли или нет курса в документах).`,
    };
  })();

  const px = (q: number | null | undefined, of: number) => (q != null && q > 0 ? `по ${formatQty(q)} из ${formatQty(of)} шт.` : "");
  const sumNow = (k: "recvValue" | "remValue" | "usedValue" | "usedValueOther") => (all ? F[k] + L[k] : cur[k]);
  // «Использовано»: сумма без 4% и под ней с 4% — независимо от режима шапки.
  const usedNo4 = c4 === "on" ? sumNow("usedValueOther") : sumNow("usedValue");
  const usedWith4 = c4 === "on" ? sumNow("usedValue") : sumNow("usedValueOther");
  const usedQtyNow = all ? 0 : cur.usedQty;

  const priceUnit = unit === "м" ? "м" : "шт.";

  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{view === "fur" ? "Мех" : "Подкладка"}</div>
      <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-3 print:grid-cols-3">
        <Card title="Куплено" onOpen={() => setPriceCol("recv")} hint={all ? undefined : (
          <InfoHint label="О «Куплено»" align="right">
            <p>Сумма — всегда без 4%. Цена — средневзвешенная.</p>
            {usdTile && usdBought ? <p className="mt-1">Цена $: {usdBought.note}.</p> : null}
            {view === "lining" ? <p className="mt-1">Подкладка закупается без цены в долларах.</p> : null}
          </InfoHint>
        )}>
          {all ? (
            <Row k="Сумма, ₽ (мех + подкладка)" v={rub(F.recvValue + L.recvValue)} strong />
          ) : (
            <>
              <Row k="Количество" v={`${formatQty(cur.recvQty)} ${unit}`} strong />
              <Row k="Сумма" v={rub(cur.recvValue)} />
              <Row k={`Цена, ₽/${priceUnit}`} v={cur.recvAvg != null ? rub(cur.recvAvg) : "—"} />
              {usdTile && usdBought ? <Row k="Цена, $/шт." v={usdBought.main} /> : null}
            </>
          )}
        </Card>

        <Card title="Использовано" onOpen={() => setPriceCol("used")} hint={
          <InfoHint label="О «Использовано»" align="right">
            <p>Показаны обе суммы: без 4% и под ней с 4% (надбавка начисляется при списании в ТЗ). Режим шапки на эти две строки не влияет.</p>
            {usdTile && F.usdUsedAvg != null ? <p className="mt-1">Цена $ — {px(F.usdUsedQty, F.usedQty)} с ценой в USD.</p> : null}
          </InfoHint>
        }>
          {all ? (
            <>
              <Row k="Сумма без 4%, ₽ (мех + подкладка)" v={rub(usedNo4)} strong sub={`с 4%: ${rub(usedWith4)} · надбавка ${rub(usedWith4 - usedNo4)}`} />
            </>
          ) : (
            <>
              <Row k="Количество" v={`${formatQty(cur.usedQty)} ${unit}`} strong />
              <Row k="Сумма без 4%" v={rub(usedNo4)} sub={`с 4%: ${rub(usedWith4)} · надбавка ${rub(usedWith4 - usedNo4)}`} />
              <Row k={`Цена без 4%, ₽/${priceUnit}`} v={usedQtyNow > 0 ? rub(usedNo4 / usedQtyNow) : "—"} sub={usedQtyNow > 0 ? `с 4%: ${rub(usedWith4 / usedQtyNow)} · надбавка ${rub((usedWith4 - usedNo4) / usedQtyNow)}` : undefined} />
              {usdTile ? <Row k="Цена, $/шт." v={F.usdUsedAvg != null ? usd(F.usdUsedAvg) : "нет данных в USD"} /> : null}
            </>
          )}
        </Card>

        <Card title="Остаток" onOpen={() => setPriceCol("rem")} hint={all ? undefined : (
          <InfoHint label="Об «Остатке»" align="right">
            <p>На складе по цене закупки лотов; всегда без 4%.</p>
            {usdTile && F.usdRemAvg != null ? <p className="mt-1">Цена $ — {px(F.usdRemQty, F.remQty)} с ценой в USD.</p> : null}
          </InfoHint>
        )}>
          {all ? (
            <Row k="Сумма, ₽ (мех + подкладка)" v={rub(F.remValue + L.remValue)} strong />
          ) : (
            <>
              <Row k="Количество" v={`${formatQty(cur.remQty)} ${unit}`} strong />
              <Row k="Сумма" v={rub(cur.remValue)} />
              <Row k={`Цена, ₽/${priceUnit}`} v={cur.remAvg != null ? rub(cur.remAvg) : "—"} />
              {usdTile ? <Row k="Цена, $/шт." v={F.usdRemAvg != null ? usd(F.usdRemAvg) : "нет данных в USD"} /> : null}
            </>
          )}
        </Card>
      </div>
      {priceCol ? <PriceModal col={priceCol} rows={rows.filter((r) => r.kind === view)} vat={vat} fur={view === "lining" ? null : F} lining={view === "fur" ? null : L} onClose={() => setPriceCol(null)} /> : null}
    </div>
  );
}

export function RawBlock({ rows, fur, lining, c4, lots, info, orderFilters }: { rows: RawTableRow[]; fur: Pair; lining: Pair; c4: "on" | "off"; lots: number; info: ModeInfo; orderFilters: boolean }) {
  void info;
  const { mode: vat } = useVatDisplay();
  const vatW = vat === "incl" ? "с НДС" : "без НДС";
  const c4W = c4 === "on" ? "с 4%" : "без 4%";
  return (
    <section aria-labelledby="dash-raw" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="dash-raw" className="text-base font-semibold">Сырьё</h2>
          <InfoHint label="Как считаются плитки сырья" wide>
            <p><b>Цена</b> — средневзвешенная: Σ ₽ ÷ Σ шт. (подкладка — ÷ Σ м), а не среднее цен лотов. Совпадает с таблицей «Сырьё». Нажмите на плитку — цены по видам сырья.</p>
            <p className="mt-1"><b>Режимы.</b> Цены {vatW}; «Использовано» — {c4W}. 4% начисляется только при списании в ТЗ, поэтому «Куплено» и «Остаток» всегда без 4%. НДС берётся по ставке каждого лота (20% или 22%).</p>
            <p className="mt-1"><b>Как сходится.</b> Куплено = использовано (без 4%) + остаток — отдельно для меха (шт.) и для подкладки (м).</p>
            <p className="mt-1"><b>Цена в долларах</b> — молоток за шкуру (до сборов), только из документов лота: строка в долларах; евро × записанный курс EUR→USD; молоток в ₽ ÷ записанный курс USD/RUB; цена $ из расчётного листа. У подкладки цен в долларах нет. Остальные лоты в среднюю $ не входят и по курсу ЦБ не пересчитываются.</p>
          </InfoHint>
          <span className="text-xs text-neutral-500">{lots} лотов</span>
          {orderFilters ? (
            <BridgeHint label="Фильтр по ТЗ" warn>
              <p>Выбран фильтр по ТЗ: «Использовано» — только в выбранных ТЗ, остальное списание в «Остаток» не попадает, поэтому куплено − использовано ≠ остаток.</p>
            </BridgeHint>
          ) : null}
        </div>
        <Link href="/lots" className="text-xs text-blue-700 hover:underline print:hidden">→ Сырьё</Link>
      </div>
      <RawCards view="fur" rows={rows} fur={fur} lining={lining} c4={c4} />
      <RawCards view="lining" rows={rows} fur={fur} lining={lining} c4={c4} />
    </section>
  );
}

const COL_TITLE = { recv: "Куплено", used: "Использовано", rem: "Остаток" } as const;

/** Цены по видам сырья для выбранной колонки (куплено / использовано / остаток): количество, сумма, средняя цена ₽ и $. */
function PriceModal({ col, rows, vat, fur, lining, onClose }: { col: "recv" | "used" | "rem"; rows: RawTableRow[]; vat: "incl" | "excl"; fur: FlowFigures | null; lining: FlowFigures | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const pick = (r: RawTableRow) => {
    const c = r.cells[vat];
    const u = r.usd;
    return col === "recv" ? { q: c.rq, v: c.rv, a: c.ra, d: u.bought } : col === "used" ? { q: c.uq, v: c.uv, a: c.ua, d: u.used } : { q: c.mq, v: c.mv, a: c.ma, d: u.rem };
  };
  const list = rows.map((r) => ({ r, ...pick(r) })).filter((x) => x.q > 0);
  const kinds: ("fur" | "lining")[] = ["fur", "lining"];
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const pickYear = (c: RawTableRow["years"][number]["cells"], u: RawTableRow["usd"]) => { const x = c[vat]; return col === "recv" ? { q: x.rq, v: x.rv, a: x.ra, d: u.bought } : col === "used" ? { q: x.uq, v: x.uv, a: x.ua, d: u.used } : { q: x.mq, v: x.mv, a: x.ma, d: u.rem }; };
  // Цена в долларах есть только у меха: в окне «Подкладка» колонки $ нет.
  const showUsd = rows.some((r) => r.kind === "fur");
  const cols = showUsd ? 5 : 4;
  // Итого по виду: количество, сумма, средневзвешенная цена ₽ и $ (как в карточке).
  const total = (f: FlowFigures | null) =>
    !f ? null : col === "recv" ? { q: f.recvQty, v: f.recvValue, a: f.recvAvg, d: f.usdAvg } : col === "used" ? { q: f.usedQty, v: f.usedValue, a: f.usedAvg, d: f.usdUsedAvg } : { q: f.remQty, v: f.remValue, a: f.remAvg, d: f.usdRemAvg };
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
            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <th className="py-1.5 pr-2 font-medium">Вид</th>
              <th className="px-2 py-1.5 text-right font-medium">Кол-во</th>
              <th className="px-2 py-1.5 text-right font-medium">Сумма</th>
              <th className="px-2 py-1.5 text-right font-medium">Цена, ₽</th>
              {showUsd ? <th className="px-2 py-1.5 text-right font-medium">Цена, $</th> : null}
            </tr>
          </thead>
          <tbody>
            {kinds.map((k) => {
              const part = list.filter((x) => x.r.kind === k).sort((a, b) => b.v - a.v);
              if (part.length === 0) return null;
              const unit = k === "lining" ? "м" : "шт.";
              return (
                <Fragment key={k}>
                  <tr className="bg-neutral-100 text-xs font-semibold uppercase tracking-wide text-neutral-600"><td colSpan={cols} className="px-2 py-1">{k === "fur" ? "Мех" : "Подкладка"}</td></tr>
                  {k === "lining" ? (() => {
                    // Подкладка: сначала по годам и итого, потом — по видам ткани.
                    const byYear = new Map<number, { q: number; v: number }>();
                    for (const x of part) for (const y of x.r.years) { const p = pickYear(y.cells, y.usd); if (p.q > 0) { const c = byYear.get(y.year) ?? { q: 0, v: 0 }; c.q += p.q; c.v += p.v; byYear.set(y.year, c); } }
                    const t = total(lining);
                    return (
                      <>
                        {Array.from(byYear.entries()).sort((a, b) => a[0] - b[0]).map(([yr, c]) => (
                          <tr key={`y${yr}`} className="border-b border-neutral-100">
                            <td className="py-1.5 pr-2 font-medium">{yr}</td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formatQty(c.q)} {unit}</td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rub(c.v)}</td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums">{c.q > 0 ? rub(c.v / c.q) : "—"}</td>
                          </tr>
                        ))}
                        {t ? (
                          <tr className="border-y-2 border-neutral-300 bg-neutral-50 font-semibold">
                            <td className="py-1.5 pr-2">Итого подкладка · средневзвешенная</td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formatQty(t.q)} {unit}</td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rub(t.v)}</td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{t.a != null ? rub(t.a) : "—"}</td>
                          </tr>
                        ) : null}
                        <tr className="text-xs text-neutral-500"><td colSpan={cols} className="px-2 pb-1 pt-2">По видам ткани (нажмите — разбивка по годам)</td></tr>
                      </>
                    );
                  })() : null}
                  {part.map((x) => (
                    <Fragment key={x.r.key}>
                    <tr className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50" onClick={() => toggle(x.r.key)} aria-expanded={open.has(x.r.key)}>
                      <td className="py-1.5 pr-2"><span aria-hidden className="mr-1 inline-block w-3 text-neutral-400">{open.has(x.r.key) ? "▾" : "▸"}</span>{x.r.label}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formatQty(x.q)} {unit}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rub(x.v)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums">{x.a != null ? rub(x.a) : "—"}</td>
                      {showUsd ? <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-neutral-700">{x.d != null ? usd(x.d) : "—"}</td> : null}
                    </tr>
                    {open.has(x.r.key) ? x.r.years.map((y) => ({ y, p: pickYear(y.cells, y.usd) })).filter((z) => z.p.q > 0).map(({ y, p }) => (
                      <tr key={y.year} className="border-b border-neutral-100 bg-neutral-50/70 text-[13px] text-neutral-700">
                        <td className="py-1 pl-7 pr-2">{y.year}</td>
                        <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{formatQty(p.q)} {unit}</td>
                        <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{rub(p.v)}</td>
                        <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{p.a != null ? rub(p.a) : "—"}</td>
                        {showUsd ? <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{p.d != null ? usd(p.d) : "—"}</td> : null}
                      </tr>
                    )) : null}
                    </Fragment>
                  ))}
                  {(() => {
                    const t = k === "fur" ? total(fur) : null;
                    return t ? (
                      <tr className="border-t-2 border-neutral-300 bg-neutral-50 font-semibold">
                        <td className="py-1.5 pr-2">Итого {k === "fur" ? "мех" : "подкладка"} · средневзвешенная</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formatQty(t.q)} {unit}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{rub(t.v)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{t.a != null ? rub(t.a) : "—"}</td>
                        {showUsd ? <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{t.d != null ? usd(t.d) : "—"}</td> : null}
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
