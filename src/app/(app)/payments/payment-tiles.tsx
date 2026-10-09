"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatMoney } from "@/lib/utils";

export type BarRow = { name: string; year: number | null; month?: number; value: number };
type Props = {
  paid: { total: number; rows: BarRow[]; unlinked: number };
  debt: { total: number; rows: BarRow[]; parts: { label: string; value: number }[] };
  paidHint?: ReactNode;
  /** Шкуры подрядчика, оплаченные в составе счетов за пошив (вкладка «За производство»): сырьё, в сумму «Оплачено» этой вкладки не входят. */
  hidesMemo?: number;
  debtHint?: ReactNode;
  deadlines?: ReactNode;
  debtWarn?: boolean;
};

const rub = (v: number) => formatMoney(v.toFixed(2));

/** Столбики по партиям закупки, сгруппированные по годам; длина — доля от максимума. */
function Bars({ rows, tone }: { rows: BarRow[]; tone: "paid" | "debt" }) {
  const years = Array.from(new Set(rows.map((r) => r.year))).sort((a, b) => (a ?? 9999) - (b ?? 9999));
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const color = tone === "paid" ? "bg-emerald-500" : "bg-amber-500";
  return (
    <div className="flex flex-col gap-4">
      {years.map((y) => {
        const list = rows.filter((r) => r.year === y).sort((a, b) => (a.month ?? 99) - (b.month ?? 99) || b.value - a.value);
        const sum = list.reduce((s, r) => s + r.value, 0);
        return (
          <section key={y ?? "none"}>
            <div className="mb-1 flex items-baseline justify-between text-sm font-semibold">
              <span>{y ?? "Прочее"}</span>
              <span className="tabular-nums">{rub(sum)}</span>
            </div>
            <ul className="flex flex-col gap-1">
              {list.map((r) => (
                <li key={r.name} className="grid grid-cols-[8.5rem_1fr_9rem] items-center gap-2 text-xs sm:text-sm">
                  <span className="truncate text-neutral-700" title={r.name}>{r.name}</span>
                  <span className="h-3 rounded-sm bg-neutral-100">
                    <span className={"block h-3 rounded-sm " + color} style={{ width: `${Math.max(1, (Math.abs(r.value) / max) * 100)}%` }} />
                  </span>
                  <span className="text-right tabular-nums">{rub(r.value)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Tile({ label, value, hint, onOpen, valueClass, children }: { label: string; value: string; hint?: ReactNode; onOpen: () => void; valueClass?: string; children?: ReactNode }) {
  return (
    <div className="relative">
      <button type="button" onClick={onOpen} aria-haspopup="dialog" className="w-full rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-sm transition hover:border-neutral-400 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">
        <div className="text-xs text-neutral-500">{label}</div>
        <div className={"mt-1 break-words text-base font-semibold sm:text-lg " + (valueClass ?? "")}>{value}</div>
        {children}
      </button>
      {hint ? <div className="absolute right-3 top-3">{hint}</div> : null}
    </div>
  );
}

export function PaymentTiles({ paid, debt, paidHint, debtHint, deadlines, debtWarn, hidesMemo }: Props) {
  const [open, setOpen] = useState<null | "paid" | "debt">(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
  }, [open]);

  return (
    <>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3" data-pay-tiles>
        <Tile label="Оплачено" value={rub(paid.total)} hint={paidHint} onOpen={() => setOpen("paid")} />
        <Tile label="Остаток к оплате (долг)" value={rub(debt.total)} hint={debtHint} onOpen={() => setOpen("debt")} valueClass={debtWarn ? "text-amber-700" : ""}>
          {deadlines}
        </Tile>
      </div>
      {open && (
        <dialog ref={ref} onClose={() => setOpen(null)} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }} className="m-auto w-[calc(100vw-2rem)] max-w-3xl rounded-xl border border-neutral-200 bg-white p-0 text-left shadow-xl backdrop:bg-black/40">
          <div className="max-h-[88vh] overflow-y-auto p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{open === "paid" ? "Оплачено" : "Остаток к оплате"}</div>
                <div className="text-xl font-semibold tabular-nums">{rub(open === "paid" ? paid.total : debt.total)}</div>
              </div>
              <button type="button" onClick={() => ref.current?.close()} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50">✕ Закрыть</button>
            </div>
            {open === "paid" ? (
              <>
                <p className="mb-3 text-xs text-neutral-500">Оплачено по партиям закупки (с НДС). Авансы без привязки к партии: {rub(paid.unlinked)}.</p>
                <Bars rows={paid.rows} tone="paid" />
                {hidesMemo && hidesMemo > 0.5 ? <p className="mt-4 rounded-md bg-neutral-50 p-3 text-xs text-neutral-600">Шкуры подрядчика, оплаченные в составе счетов за пошив: <b className="tabular-nums">{rub(hidesMemo)}</b> (п/п 22618 — 189 966,22 ₽ и аванс 27.11.2025 — 32 918,56 ₽). Это сырьё, поэтому на вкладке «За производство» они не учитываются; в сумму «Оплачено» выше не входят.</p> : null}
              </>
            ) : (
              <>
                <dl className="mb-4 grid gap-0 text-sm">
                  {debt.parts.map((p) => (
                    <div key={p.label} className="flex justify-between gap-4 border-b border-neutral-100 py-1.5">
                      <dt className="text-neutral-600">{p.label}</dt>
                      <dd className="whitespace-nowrap font-medium tabular-nums">{rub(p.value)}</dd>
                    </div>
                  ))}
                </dl>
                <h3 className="mb-2 text-sm font-semibold">Остаток по партиям закупки</h3>
                <Bars rows={debt.rows} tone="debt" />
              </>
            )}
          </div>
        </dialog>
      )}
    </>
  );
}
