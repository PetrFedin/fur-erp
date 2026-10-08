"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney } from "@/lib/utils";
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

const pct = (v: number) => `${(v * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;

export function ProductionModal({
  scope, search, totals, onClose, title,
}: {
  scope: "done" | "work";
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
  const matches = level && path.length === 0 ? Math.abs(level.total - tileTotal) < 0.02 : null;

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
        className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 p-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Стоимость производства · {scope === "done" ? "произведено" : "в работе"}</div>
            <h2 id="prod-modal-title" className="mt-0.5 text-lg font-semibold">{title}</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {vat === "incl" ? "С НДС" : "Без НДС"} · {data?.c4 === "on" ? "с 4%" : "без 4%"} · без работы
              <InfoHint label="Что в столбцах" wide>
                <p><b>Столбец = себестоимость</b> ТЗ: мех + подкладка + надбавка 4% (в режиме «С 4%») + расходы ТЗ. <b>Работа</b> в себестоимость не входит и показана отдельно («стоимость = себестоимость + работа»).</p>
                <p className="mt-1">{scope === "done" ? "Здесь только ТЗ в статусе «Завершён» (выпуск)." : "Здесь только ТЗ «В работе» и «Запланировано» (план; сырьё — по списаниям на сегодня)."} Произведено и в работе не смешиваются.</p>
                <p className="mt-1">Сумма столбцов каждого уровня равна родительскому столбцу; на первом уровне — итогу плитки. Режимы НДС, 4% и год — те же, что в шапке.</p>
              </InfoHint>
            </p>
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
                {level.totalWork != null && level.totalWork !== 0 ? (
                  <div className="text-xs text-neutral-600">+ работа <b className="tabular-nums">{formatMoney(level.totalWork)}</b> · всего <b className="tabular-nums">{formatMoney(level.total + level.totalWork)}</b></div>
                ) : null}
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

              {/* Таблица тех же данных: точные суммы, доли, ссылки */}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                      <th className="py-1.5 pr-2 font-medium">{level.kind === "composition" ? "Составляющая" : level.kind === "lines" ? "Лот" : "Строка"}</th>
                      <th className="px-2 py-1.5 text-right font-medium">Кол-во</th>
                      <th className="px-2 py-1.5 text-right font-medium">Себестоимость</th>
                      <th className="px-2 py-1.5 text-right font-medium">Доля</th>
                      {level.totalWork != null ? <th className="px-2 py-1.5 text-right font-medium">Работа</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {level.items.map((it) => (
                      <tr key={it.key} className="border-b border-neutral-100 hover:bg-neutral-50" onMouseEnter={() => setHover(it)} onMouseLeave={() => setHover(null)}>
                        <td className="py-1.5 pr-2">
                          <span className="mr-2 inline-block size-2.5 rounded-sm align-middle" style={{ background: it.outside ? "#e87ba4" : it.tone ? TONE[it.tone] : BAR }} aria-hidden />
                          {it.drillable && !it.outside ? (
                            <button type="button" onClick={() => pick(it)} className="text-left text-blue-700 underline-offset-2 hover:underline">{it.label} ›</button>
                          ) : it.href ? (
                            <Link href={it.href} className="text-blue-700 underline-offset-2 hover:underline">{it.label}</Link>
                          ) : <span>{it.label}</span>}
                          {it.sub ? <div className="ml-[18px] text-xs text-neutral-500">{it.sub}</div> : null}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right text-neutral-600">{it.qtyText}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums">{formatMoney(it.value)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-neutral-600">{it.outside ? "—" : pct(it.share)}</td>
                        {level.totalWork != null ? <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-neutral-600">{it.work ? formatMoney(it.work) : "—"}</td> : null}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <td className="py-1.5 pr-2">Итого</td>
                      <td />
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formatMoney(level.total)}</td>
                      <td className="px-2 py-1.5 text-right">100%</td>
                      {level.totalWork != null ? <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{formatMoney(level.totalWork)}</td> : null}
                    </tr>
                  </tfoot>
                </table>
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
