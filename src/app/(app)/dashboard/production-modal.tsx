"use client";

import { TH, THGroup } from "@/components/table-head";
import { TotalLabel } from "@/components/total-label";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty, formatShare } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { formatCompactMoney } from "./compact";
import { loadProductionDrill } from "./actions";
import { levelFor, ROOT_MODES, type DrillData, type Item, type PathStep, type RootMode } from "@/lib/dashboard-drill";

// Палитра — валидированная категориальная (навык dataviz): одна серия — синий, состав — фиксированный порядок оттенков.
const TONE: Record<string, string> = {
  fur: "#2a78d6", lining: "#eb6834", c4: "#1baf7a", exp: "#eda100", res: "#4a3aa7", work: "#e87ba4",
};
const BAR = "#2a78d6";
const BAR_ACTIVE = "#184f95";

const sharePct = (part: number, whole: number) => (whole ? formatShare(part / whole) : "—");

/** Ячейка состава: сумма и рядом аккуратная доля от себестоимости строки. */
function PartCell({ v, whole, hide }: { v: number; whole: number; hide?: boolean }) {
  if (hide) return <td className="px-2 py-1.5 text-right text-neutral-400">—</td>;
  return (
    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
      {v === 0 ? <span className="text-neutral-400">—</span> : <>{formatMoney(v)}<span className="ml-1 text-[11px] text-neutral-500">{sharePct(v, whole)}</span></>}
    </td>
  );
}

const pct = (v: number) => formatShare(v);

export function ProductionModal({
  scope, search, totals, onClose, title, hides, workTotal,
}: {
  /** Работа по всем ТЗ окна: входит в себестоимость столбцов (кроме группировки «Мех», где её не к чему отнести). */
  workTotal: number;
  /** Шкуры подрядчика (в ТЗ не списаны): добавляются к итогу на верхнем уровне окна «все ТЗ». */
  hides?: number;
  scope: "done" | "work" | "all";
  search: Record<string, string[]>;
  /** Итог плитки (то, с чем должна сходиться сумма столбцов). */
  totals: { costIncl: number; costExcl: number; qty: number; orders: number };
  onClose: () => void;
  title: string;
}) {
  const { mode: vat } = useVatDisplay();
  const [data, setData] = useState<DrillData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RootMode>("batch");
  const [path, setPath] = useState<PathStep[]>([]);
  const [hover, setHover] = useState<Item | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    loadProductionDrill(scope, search).then((d) => alive && setData(d)).catch(() => alive && setError("Не удалось загрузить данные. Закройте окно и откройте снова."));
    return () => { alive = false; };
  }, [scope, search]);

  // Esc закрывает окно; Tab не выходит за его пределы; фокус возвращается на кнопку, открывшую окно.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const f = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])")).filter((el) => !el.hasAttribute("disabled"));
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [onClose]);

  const level = useMemo(() => (data ? levelFor(data.orders, mode, path, vat) : null), [data, mode, path, vat]);
  const tileTotal = vat === "incl" ? totals.costIncl : totals.costExcl;
  const expectTotal = tileTotal + (mode === "fur" ? 0 : workTotal);
  const matches = level && path.length === 0 ? Math.abs(level.total - expectTotal) < 0.02 : null;

  const pick = useCallback((it: Item) => {
    if (!level || !it.drillable || it.outside) return;
    setHover(null);
    if (level.kind === "dim" && level.dim) setPath((p) => [...p, { dim: level.dim!, key: it.key, label: it.label }]);
    else if (level.kind === "composition") setPath((p) => [...p, { dim: "part", key: it.key, label: it.label }]);
  }, [level]);

  const changeMode = (m: RootMode) => { setMode(m); setPath([]); setHover(null); };
  const max = level ? Math.max(1, ...level.items.map((i) => Math.abs(i.value))) : 1;
  const shown = hover;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 sm:items-center sm:p-4 print:hidden" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prod-modal-title"
        className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 p-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Стоимость производства · {scope === "done" ? "произведено" : scope === "all" ? "факт списания по всем ТЗ" : "в работе"}</div>
            <h2 id="prod-modal-title" className="mt-0.5 text-lg font-semibold">{title}</h2>
            <div className="mt-0.5 text-xs text-neutral-500">
              {vat === "incl" ? "С НДС" : "Без НДС"} · {data?.c4 === "on" ? "с 4%" : "без 4%"} · с работой
              <InfoHint label="Что в столбцах" wide>
                <p><b>Себестоимость</b> = мех + подкладка + надбавка 4% (в режиме «С 4%») + работа. Столбец <b>«Работа»</b> показывает работу и доп. расходы ТЗ («Доп. расходы · статья»): у строки состава, которая сама является работой или доп. расходом, «Себестоимость» — «—», а в итог уровня она входит как раньше. «Шкур, шт.» и «Подкладка, м» — сколько использовано по списаниям.</p>
                <p className="mt-1">{scope === "all" ? "Здесь все ТЗ — завершённые и в работе: учитывается фактическое списание меха и подкладки, работа и 4%, отметка о завершении ТЗ не важна." : scope === "done" ? "Здесь только ТЗ в статусе «Завершён» (выпуск)." : "Здесь только ТЗ «В работе» и «Запланировано» (план; сырьё — по списаниям на сегодня)."}</p>
                <p className="mt-1">Сумма столбцов каждого уровня равна родительскому столбцу; на первом уровне — итогу плитки. Режимы НДС, 4% и год — те же, что в шапке.</p>
              </InfoHint>
            </div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Закрыть окно" className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">✕ Закрыть</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
          {!data && !error ? <p className="text-sm text-neutral-500" aria-live="polite">Загрузка…</p> : null}
          {data && level ? (
            <>
              <div role="tablist" aria-label="Группировка столбцов" className="flex flex-wrap gap-1">
                {ROOT_MODES.map((m) => (
                  <button key={m.id} role="tab" aria-selected={mode === m.id} type="button" onClick={() => changeMode(m.id)}
                    className={"rounded-md border px-3 py-1 text-sm " + (mode === m.id ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50")}>
                    {m.label}
                  </button>
                ))}
              </div>

              <nav aria-label="Путь" className="mt-3 flex flex-wrap items-center gap-1 text-sm">
                <button type="button" onClick={() => setPath([])} disabled={path.length === 0} className={"rounded px-1.5 py-0.5 " + (path.length === 0 ? "font-semibold text-neutral-900" : "text-blue-700 underline hover:bg-blue-50")}>Все</button>
                {path.map((s, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <span aria-hidden className="text-neutral-500">›</span>
                    {i === path.length - 1 && level.kind === "dim" ? (
                      <span className="font-semibold">{s.label}</span>
                    ) : (
                      <button type="button" onClick={() => setPath(path.slice(0, i + 1))} className={"rounded px-1.5 py-0.5 " + (i === path.length - 1 ? "font-semibold" : "text-blue-700 underline hover:bg-blue-50")}>{s.label}</button>
                    )}
                  </span>
                ))}
                {level.kind === "composition" ? <><span aria-hidden className="text-neutral-500">›</span><span className="font-semibold">состав</span></> : null}
              </nav>

              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div>
                  <span className="text-xl font-semibold tabular-nums">{formatMoney(level.total)}</span>
                  <span className="ml-2 text-xs text-neutral-500">{level.title} · {level.orders} ТЗ</span>
                </div>
                <div className="text-xs text-neutral-600">
                  {level.totalWork != null && level.totalWork !== 0 ? <>в том числе «Работа» <b className="tabular-nums">{formatMoney(level.totalWork)}</b></> : null}
                </div>
              </div>

              {/* Гистограмма */}
              <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-200 bg-neutral-50/60 p-3">
                <div className="flex items-end gap-[2px]" style={{ height: 230, minWidth: Math.max(0, level.items.length * 38) }} role="list" aria-label={`Гистограмма ${level.title}`}>
                  {level.items.map((it) => {
                    const h = Math.max(it.value === 0 ? 0 : 3, (Math.abs(it.value) / max) * 170);
                    const color = it.outside ? undefined : it.tone ? TONE[it.tone] : BAR;
                    const can = it.drillable && !it.outside;
                    const active = shown?.key === it.key;
                    return (
                      <div key={it.key} role="listitem" className="flex min-w-[34px] flex-1 flex-col items-center justify-end">
                        <div className="mb-0.5 text-[11px] leading-3 tabular-nums text-neutral-700">{formatCompactMoney(it.value).replace(" ₽", "")}</div>
                        <button
                          type="button"
                          onClick={() => pick(it)}
                          onMouseEnter={() => setHover(it)}
                          onMouseLeave={() => setHover(null)}
                          onFocus={() => setHover(it)}
                          onBlur={() => setHover(null)}
                          disabled={!can && !it.href}
                          aria-label={`${it.label}: ${formatMoney(it.value)}, ${pct(it.share)}${it.qtyText ? `, ${it.qtyText}` : ""}${can ? ". Нажмите, чтобы раскрыть" : ""}`}
                          className={"w-full max-w-[64px] rounded-t-[4px] outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 " + (can ? "cursor-pointer" : "cursor-default")}
                          style={{
                            height: h,
                            background: it.outside ? "repeating-linear-gradient(45deg,#e87ba4 0 4px,#fff 4px 7px)" : active && !it.tone ? BAR_ACTIVE : color,
                            border: it.outside ? "1px solid #e87ba4" : undefined,
                            opacity: shown && !active ? 0.75 : 1,
                          }}
                        />
                        <div className="mt-1 line-clamp-2 h-7 w-full break-words text-center text-[11px] leading-[14px] text-neutral-600" title={it.label}>{it.label}</div>
                      </div>
                    );
                  })}
                  {level.items.length === 0 ? <p className="m-auto text-sm text-neutral-500">Нет данных за выбранный срез.</p> : null}
                </div>
                <div className="mt-2 min-h-[20px] text-xs text-neutral-700" aria-live="polite">
                  {shown ? (
                    <><b>{shown.label}</b>: <b className="tabular-nums">{formatMoney(shown.value)}</b>{shown.outside ? "" : <> · {pct(shown.share)} от уровня</>}{shown.qtyText ? <> · {shown.qtyText}</> : null}{shown.work ? <> · работа {formatMoney(shown.work)}</> : null}</>
                  ) : <span className="text-neutral-500">Наведите на столбец — сумма и доля. Нажмите, чтобы раскрыть.</span>}
                </div>
              </div>

              {/* Таблица тех же данных: изделия, себестоимость и из чего она состоит (с долями), работа */}
              <div className="mt-3 overflow-x-auto">
                {(() => {
                  const rich = level.kind === "dim" && level.items.some((i) => i.parts);
                  const perUnit = level.kind === "dim" && level.items.some((i) => i.qty && !i.outside);
                  // Столбец «Работа» есть → в нём работа + доп. расходы ТЗ, а «Прочее» — только разница снимка ТЗ и строк.
                  const workCol = level.totalWork != null;
                  const othOf = (i: Item) => (i.parts ? i.parts.other - (workCol ? i.parts.exp : 0) : 0);
                  const showOther = level.items.some((i) => Math.abs(othOf(i)) > 0.005);
                  const workOf = (i: Item) => (i.asWork ? i.value : (i.work ?? 0) + (i.parts?.exp ?? 0));
                  const sumP = (k: "fur" | "lining" | "c4") => level.items.reduce((x, i) => x + (i.parts?.[k] ?? 0), 0);
                  const sumOther = level.items.reduce((x, i) => x + othOf(i), 0);
                  const showFurQ = level.items.some((i) => (i.furQ ?? 0) > 0);
                  const showLinQ = level.items.some((i) => (i.liningQ ?? 0) > 0);
                  const GL = " border-l border-neutral-200";
                  const nq = (v?: number) => (v && v > 0 ? formatQty(v) : "—");
                  return (
                    <table className={"w-full text-sm " + (rich ? "min-w-[900px]" : "min-w-[520px]")}>
                      <thead>
                        {(rich || showFurQ || showLinQ || workCol) ? (
                          <tr>
                            <th colSpan={2 + (perUnit ? 1 : 0)} />
                            {showFurQ || showLinQ ? <THGroup colSpan={(showFurQ ? 1 : 0) + (showLinQ ? 1 : 0)}>Использовано</THGroup> : null}
                            <THGroup colSpan={1 + (rich ? 3 + (showOther ? 1 : 0) : 0) + (workCol ? 1 : 0)}>Себестоимость и состав</THGroup>
                            <th className={GL} />
                          </tr>
                        ) : null}
                        <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                          <th className="min-w-[150px] py-1.5 pr-2 text-left font-medium">{level.kind === "composition" ? "Составляющая" : level.kind === "lines" ? "Лот" : "Строка"}</th>
                          <TH label="Кол-во" unit="шт." />
                          {perUnit ? <TH label="На 1 изд." unit="₽" /> : null}
                          {showFurQ ? <TH label="Шкур" unit="шт." sep /> : null}
                          {showLinQ ? <TH label="Подкладка" unit="м" sep={!showFurQ} /> : null}
                          <TH label="Себестоимость" unit="₽" sep />
                          {rich ? <><TH label="Мех" unit="₽" /><TH label="Подкладка" unit="₽" /><TH label="4%" unit="₽" />{showOther ? <TH label={workCol ? "Прочее" : "Расходы и прочее"} unit="₽" /> : null}</> : null}
                          {workCol ? <TH label="Работа" unit="₽" /> : null}
                          <TH label="Доля уровня" unit="%" sep />
                        </tr>
                      </thead>
                      <tbody>
                        {level.items.map((it) => (
                          <tr key={it.key} className="border-b border-neutral-100 hover:bg-neutral-50" onMouseEnter={() => setHover(it)} onMouseLeave={() => setHover(null)}>
                            <td className="min-w-[150px] py-1.5 pr-2">
                              <span className="mr-2 inline-block size-2.5 rounded-sm align-middle" style={{ background: it.outside ? "#e87ba4" : it.tone ? TONE[it.tone] : BAR }} aria-hidden />
                              {it.drillable && !it.outside ? (
                                <button type="button" onClick={() => pick(it)} className="text-left text-blue-700 underline-offset-2 hover:underline">{it.label} ›</button>
                              ) : it.href ? (
                                <Link href={it.href} className="text-blue-700 underline-offset-2 hover:underline">{it.label}</Link>
                              ) : <span>{it.label}</span>}
                              {it.sub ? <div className="ml-[18px] text-xs text-neutral-500">{it.sub}</div> : null}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right text-neutral-600">{it.qtyText}</td>
                            {perUnit ? <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-neutral-700">{it.qty && !it.outside ? formatMoney(it.value / it.qty) : "—"}</td> : null}
                            {showFurQ ? <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-neutral-700" + GL}>{nq(it.furQ)}</td> : null}
                            {showLinQ ? <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-neutral-700" + (showFurQ ? "" : GL)}>{nq(it.liningQ)}</td> : null}
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums" + GL}>{it.asWork ? <span className="font-normal text-neutral-400">—</span> : formatMoney(it.value)}</td>
                            {rich ? (
                              <>
                                <PartCell v={it.parts?.fur ?? 0} whole={it.value} hide={!it.parts} />
                                <PartCell v={it.parts?.lining ?? 0} whole={it.value} hide={!it.parts} />
                                <PartCell v={it.parts?.c4 ?? 0} whole={it.value} hide={!it.parts} />
                                {showOther ? <PartCell v={othOf(it)} whole={it.value} hide={!it.parts} /> : null}
                              </>
                            ) : null}
                            {workCol ? <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-neutral-700">{workOf(it) ? formatMoney(workOf(it)) : "—"}</td> : null}
                            <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-neutral-600" + GL}>{it.outside ? "—" : pct(it.share)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="row-total">
                          <td className="py-1.5 pr-2"><TotalLabel /></td>
                          <td />
                          {perUnit ? <td /> : null}
                          {showFurQ ? <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + GL}>{nq(level.items.reduce((x, i) => x + (i.furQ ?? 0), 0))}</td> : null}
                          {showLinQ ? <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + (showFurQ ? "" : GL)}>{nq(level.items.reduce((x, i) => x + (i.liningQ ?? 0), 0))}</td> : null}
                          <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums" + GL}>{formatMoney(level.total)}</td>
                          {rich ? (
                            <>
                              <PartCell v={sumP("fur")} whole={level.total} />
                              <PartCell v={sumP("lining")} whole={level.total} />
                              <PartCell v={sumP("c4")} whole={level.total} />
                              {showOther ? <PartCell v={sumOther} whole={level.total} /> : null}
                            </>
                          ) : null}
                          {workCol ? <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{level.items.reduce((x, i) => x + workOf(i), 0) ? formatMoney(level.items.reduce((x, i) => x + workOf(i), 0)) : "—"}</td> : null}
                          <td className={"px-2 py-1.5 text-right" + GL}>100,0%</td>
                        </tr>
                      </tfoot>
                    </table>
                  );
                })()}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600">
                {matches != null ? (
                  <span className={matches ? "text-emerald-700" : "text-red-700"}>{matches ? "✓ Σ столбцов равна итогу плитки" : `Σ столбцов ${formatMoney(level.total)} ≠ плитка ${formatMoney(tileTotal)} — число ТЗ в окне ограничено`}</span>
                ) : null}
                {level.links.map((l) => <Link key={l.href} href={l.href} className="text-blue-700 underline-offset-2 hover:underline">{l.label} →</Link>)}
                {level.kind === "composition" ? <span>Нажмите составляющую — лоты и закупки.</span> : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
