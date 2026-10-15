"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { InfoHint } from "@/components/info-hint";
import { formatMoney } from "@/lib/utils";
import { WidgetRow } from "@/components/widget-row";
import { TILE_BOX, TileHead, TileValue, TileList, type TileItem } from "../dashboard/tile";

export type BarRow = { name: string; year: number | null; month?: number; value: number };
type Props = {
  paid: { total: number; rows: BarRow[]; unlinked: number };
  debt: { total: number; rows: BarRow[]; parts: { label: string; value: number }[] };
  paidHint?: ReactNode;
  /** Шкуры подрядчика, оплаченные в составе счетов за пошив (вкладка «За работу»): сырьё, в сумму «Оплачено» этой вкладки не входят. */
  hidesMemo?: number;
  debtHint?: ReactNode;
  deadlines?: ReactNode;
  debtWarn?: boolean;
  /** Мех / подкладка: оплачено и к оплате (те же числа, что на Главной). */
  split?: { paid: { fur: number; lining: number }; debt: { fur: number; lining: number } };
  /** Копеечное округление «Куплено» (сумма лотов) против документов: добавляется к «Общей стоимости» отдельной строкой, чтобы итог совпал с Главной. */
  rounding?: number;
  /** Целые рубли, сходящиеся на экране (src/lib/pay-display.ts): те же числа, что в плитках оплат на Главной. Нет — точные суммы, как раньше. */
  shown?: { total: number; paid: number; left: number; round: number; totalFur: number; totalLining: number; paidFur: number; paidLining: number; leftFur: number; leftLining: number };
};

const rub = (v: number) => formatMoney(Math.abs(v - Math.round(v)) < 0.005 ? Math.round(v) : v.toFixed(2));

/** Мех и подкладка с долей от суммы плитки. */
function stat(_value: number, whole: number, fur: number, lining: number, warn = false): TileItem[] {
  const part = (v: number) => (whole > 0.5 ? v / whole : null);
  return [
    { k: "Мех", v: rub(fur), share: part(fur), tone: warn && fur > 0 ? "text-amber-700" : undefined },
    { k: "Подкладка", v: rub(lining), share: part(lining), tone: warn && lining > 0 ? "text-amber-700" : undefined },
  ];
}

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
            <div className="mb-1 flex items-baseline justify-between text-sm font-medium">
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

function Tile({ label, value, hint, onOpen, valueClass, items, children }: { label: string; value: string; hint?: ReactNode; onOpen?: () => void; valueClass?: string; items?: TileItem[]; children?: ReactNode }) {
  return (
    <div
      className={TILE_BOX + (onOpen ? " tile-click" : "")}
      onClick={onOpen}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } } : undefined}
      aria-haspopup={onOpen ? "dialog" : undefined}
      title={onOpen ? "Показать детализацию по партиям закупки" : undefined}
    >
      <TileHead>{label}</TileHead>
      {hint ? <div className="absolute right-3 top-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{hint}</div> : null}
      <TileValue className={valueClass}>{value}</TileValue>
      {items ? <TileList items={items} /> : null}
      {children}
    </div>
  );
}

export function PaymentTiles({ paid, debt, paidHint, debtHint, deadlines, debtWarn, hidesMemo, split, rounding = 0, shown }: Props) {
  const [open, setOpen] = useState<null | "paid" | "debt">(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
  }, [open]);

  return (
    <>
      <WidgetRow id="payments" title="Оплаты — итоги" headerEnd={<Link href="/lots" className="text-xs text-blue-700 hover:underline print:hidden">→ Сырьё</Link>}>
      <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-3 print:grid-cols-3" data-pay-tiles>
        <Tile label="Общая стоимость" value={rub(shown ? shown.total : paid.total + debt.total + rounding)} hint={<InfoHint label="Что такое общая стоимость" align="right"><p>Оплачено плюс осталось оплатить за сырьё (мех с шкурами подрядчика, подкладка). Всегда с НДС; 4% отдельно не добавляются.</p></InfoHint>} items={shown ? [...stat(shown.total, shown.total, shown.totalFur, shown.totalLining), ...(shown.round !== 0 ? [{ k: "округление (лоты и документы)", v: rub(shown.round) }] : [])] : split ? [...stat(paid.total + debt.total, paid.total + debt.total, split.paid.fur + split.debt.fur, split.paid.lining + split.debt.lining), ...(rounding !== 0 ? [{ k: "Округление", v: rub(rounding) }] : [])] : undefined} />
        <Tile label="Оплачено" value={rub(shown ? shown.paid : paid.total)} hint={paidHint} onOpen={() => setOpen("paid")} items={shown ? stat(shown.paid, shown.paid, shown.paidFur, shown.paidLining) : split ? stat(paid.total, paid.total, split.paid.fur, split.paid.lining) : undefined} />
        <Tile label="К оплате" value={rub(shown ? shown.left : debt.total)} hint={debtHint} onOpen={() => setOpen("debt")} valueClass={debtWarn ? "text-amber-700" : ""} items={shown ? stat(shown.left, shown.left, shown.leftFur, shown.leftLining, true) : split ? stat(debt.total, debt.total, split.debt.fur, split.debt.lining, true) : undefined}>
          {deadlines}
        </Tile>
      </div>
      </WidgetRow>
      {open && (
        <dialog ref={ref} aria-labelledby="pay-dlg-title" onClose={() => setOpen(null)} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }} className="m-auto w-[calc(100vw-2rem)] max-w-3xl rounded-xl border border-neutral-200 bg-white p-0 text-left shadow-xl backdrop:bg-black/40">
          <div className="max-h-[88vh] overflow-y-auto p-4">
            <div className="mb-3 flex items-start justify-between gap-3 border-b border-neutral-200 pb-3">
              <div>
                <h2 id="pay-dlg-title" className="block-title">{open === "paid" ? "Оплачено" : "К оплате"}</h2>
                <div className="text-xl font-semibold tabular-nums">{rub(open === "paid" ? paid.total : debt.total)}</div>
              </div>
              <button type="button" onClick={() => ref.current?.close()} autoFocus aria-label="Закрыть окно" className="btn-accent rounded-lg border border-neutral-300 px-3 py-1.5 text-sm">✕ Закрыть</button>
            </div>
            {open === "paid" ? (
              <>
                {paid.unlinked > 0.5 ? <p className="mb-3 text-xs text-neutral-500">Авансы без привязки к партии: {rub(paid.unlinked)}</p> : null}
                <Bars rows={paid.rows} tone="paid" />
                {hidesMemo && hidesMemo > 0.5 ? <p className="mt-4 text-xs text-neutral-500">В «Мех» входят шкуры подрядчика, оплаченные в составе счетов за пошив: <b className="tabular-nums">{rub(hidesMemo)}</b>.</p> : null}
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
                <h3 className="mb-2 block-title">К оплате по партиям закупки</h3>
                <Bars rows={debt.rows} tone="debt" />
              </>
            )}
          </div>
        </dialog>
      )}
    </>
  );
}
