"use client";

import { useEffect, useMemo, useState } from "react";

type Detail = { label: string; value: number; qty?: number };
type Slice = { key: "fur" | "lining" | "work"; label: string; value: number; details?: Detail[]; expandable: boolean };

const money = (v: number) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(v);

export function ProductionCostTotal({
  total,
  fur,
  lining,
  work,
  furDetails,
  liningDetails,
  products,
}: {
  total: number;
  fur: number;
  lining: number;
  work: number;
  furDetails: Detail[];
  liningDetails: Detail[];
  products: number;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>("fur");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const slices: Slice[] = [
    { key: "fur", label: "Меховое сырьё", value: fur, details: furDetails, expandable: true },
    { key: "lining", label: "Подкладка", value: lining, details: liningDetails, expandable: true },
    { key: "work", label: "Работа", value: work, expandable: false },
  ];
  const positive = slices.filter((s) => s.value > 0);
  const gradient = useMemo(() => {
    const colors = ["#171717", "#a3a3a3", "#d4d4d4"];
    let from = 0;
    const parts = positive.map((s, i) => {
      const pct = total > 0 ? (s.value / total) * 100 : 0;
      const to = from + pct;
      const part = `${colors[i % colors.length]} ${from}% ${to}%`;
      from = to;
      return part;
    });
    return `conic-gradient(${parts.join(",")})`;
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  }, [positive, total]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group w-full rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition hover:border-neutral-400 hover:shadow-md"
      >
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Общая стоимость произведённого товара</div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">{money(total)}</div>
        <div className="mt-1 text-xs text-neutral-500">{products.toLocaleString("ru-RU")} изделий · нажмите, чтобы увидеть состав</div>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4" onMouseDown={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Структура стоимости произведённого товара: сырьё, подкладка и работа"
            className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Структура стоимости: сырьё + работа</div>
                <h2 className="mt-1 text-xl font-semibold">Произведённый товар · {money(total)}</h2>
                <p className="mt-1 text-sm text-neutral-500">{products.toLocaleString("ru-RU")} изделий. Нажмите на строку расхода для детализации. Здесь «стоимость» = мех + подкладка + работа; «себестоимость» в ТЗ, партиях и аналитике — это сырьё и подкладка + расходы, без работы.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-neutral-50">Закрыть</button>
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-[280px_1fr] md:items-center">
              <div className="mx-auto">
                <div className="relative size-64 rounded-full" style={{ background: gradient }}>
                  <div className="absolute inset-[54px] flex items-center justify-center rounded-full bg-white text-center shadow-inner">
                    <div>
                      <div className="text-xs text-neutral-500">Тотал</div>
                      <div className="mt-1 text-lg font-semibold">{money(total)}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {slices.map((s, i) => {
                  const pct = total > 0 ? (s.value / total) * 100 : 0;
                  const isOpen = expanded === s.key;
                  return (
                    <div key={s.key} className="rounded-xl border border-neutral-200">
                      <button
                        type="button"
                        onClick={() => s.expandable && setExpanded(isOpen ? null : s.key)}
                        className={"flex w-full items-center gap-3 p-3 text-left " + (s.expandable ? "cursor-pointer hover:bg-neutral-50" : "cursor-default")}
                      >
                        <span className={["bg-neutral-900","bg-neutral-400","bg-neutral-300"][i] + " size-3 shrink-0 rounded-full"} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{s.label}</span>
                          <span className="block text-xs text-neutral-500">{pct.toFixed(1).replace(".", ",")}% от общей стоимости</span>
                        </span>
                        <span className="font-semibold tabular-nums">{money(s.value)}</span>
                        <span className="w-4 text-neutral-400">{s.expandable ? (isOpen ? "−" : "+") : ""}</span>
                      </button>
                      {s.expandable && isOpen ? (
                        <div className="border-t bg-neutral-50/60 p-3">
                          <div className="space-y-1.5">
                            {(s.details ?? []).map((d) => (
                              <div key={d.label} className="flex items-center justify-between gap-3 text-sm">
                                <span className="min-w-0 truncate text-neutral-700">{d.label}{d.qty != null ? <span className="text-neutral-400"> · {d.qty.toLocaleString("ru-RU")} ед.</span> : null}</span>
                                <b className="shrink-0 tabular-nums">{money(d.value)}</b>
                              </div>
                            ))}
                            {(s.details ?? []).length === 0 ? <div className="text-sm text-neutral-500">Детализации пока нет.</div> : null}
                          </div>
                        </div>
                      ) : null}
                      {!s.expandable ? <div className="border-t px-3 py-2 text-xs text-neutral-500">Детализация работы пока не ведётся — показываем только итоговую сумму.</div> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
