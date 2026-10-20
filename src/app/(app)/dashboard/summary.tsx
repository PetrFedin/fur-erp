import Link from "next/link";
import type { ReactNode } from "react";
import { InfoHint } from "@/components/info-hint";
import { TERMS, DUE_HINT } from "@/lib/terms";
import { formatMoney, formatMoneyCompact, formatQty } from "@/lib/utils";
import { TILE_BOX, TileHead } from "./tile";

const dash = (v: number, f: (n: number) => string = formatMoney) => (Math.abs(v) < 0.5 ? "—" : f(v));

/** Плитка-ссылка: вся плитка ведёт в раздел (≥44 px по высоте). */
function SumTile({ href, label, value, sub, hint, tone = "" }: { href: string; label: string; value: string; sub?: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className={TILE_BOX + " min-h-[104px] hover:border-neutral-400"}>
      <TileHead>
        <Link href={href} className="after:absolute after:inset-0 after:content-['']">{label}</Link>
        {hint ? <span className="relative z-10 ml-auto"><InfoHint label={`Пояснение: ${label}`} align="right" wide>{hint}</InfoHint></span> : null}
      </TileHead>
      <div className={"mt-1 flex min-h-7 items-center text-xl font-semibold leading-7 tabular-nums " + tone}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs leading-4 text-neutral-500">{sub}</div> : null}
    </div>
  );
}

export type SummaryProps = {
  spent: number;
  received: number | null;
  dueRaw: number;
  workRest: number;
  advance: number;
  /** Остаток сырья: шт. и ₽. */
  stockQty: number;
  stockValue: number;
  inProdQty: number;
  inProdOrders: number;
  prodAvg: number | null;
  /** Заказано, но не принято: «Предоплачено, ждём поставку». */
  prepaid: { qty: number; ordered: number; paid: number; due: number };
  decisions: { label: string; href: string; count?: number; sum?: number }[];
  chart: { months: string[]; spent: number[]; received: number[] | null };
};

export function DashboardSummary(p: SummaryProps) {
  const before = p.dueRaw + p.workRest;
  const after = Math.max(0, before - p.advance);
  return (
    <div className="flex flex-col gap-4">
      {p.decisions.length > 0 && (
        <section aria-label="Требует решения" className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <h2 className="text-sm font-semibold text-amber-900">Требует решения</h2>
          <ul className="mt-1 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-6">
            {p.decisions.map((x) => (
              <li key={x.label}>
                <Link href={x.href} className="inline-flex min-h-11 items-center gap-2 text-sm text-amber-950 hover:underline">
                  <span>{x.label}</span>
                  {x.count ? <b className="tabular-nums">{x.count}</b> : null}
                  {x.sum ? <b className="tabular-nums">{formatMoney(x.sum)}</b> : null}
                  <span aria-hidden>→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Ключевые цифры" className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 xl:grid-cols-3">
        <SumTile href="/cashflow" label={TERMS.spent} value={dash(p.spent)} sub="все платежи за период" />
        <SumTile href="/cashflow" label={TERMS.received} value={p.received == null ? "—" : dash(p.received)} sub="розничная выручка по продажам" />
        <SumTile
          href="/payments" label={TERMS.due} value={dash(after)} tone={after > 0.5 ? "text-red-700" : ""}
          sub={`до зачёта аванса ${formatMoneyCompact(before, { unit: true })}`}
          hint={<><p>{DUE_HINT}</p><dl className="mt-2 space-y-0.5 text-xs"><div className="flex justify-between gap-4"><dt>{TERMS.rawDebt}</dt><dd className="tabular-nums">{dash(p.dueRaw)}</dd></div><div className="flex justify-between gap-4"><dt>{TERMS.workRest}</dt><dd className="tabular-nums">{dash(p.workRest)}</dd></div><div className="flex justify-between gap-4"><dt>до зачёта</dt><dd className="tabular-nums">{dash(before)}</dd></div><div className="flex justify-between gap-4"><dt>− {TERMS.advance}</dt><dd className="tabular-nums">{dash(p.advance)}</dd></div></dl></>}
        />
        <SumTile href="/lots" label="Остаток сырья" value={dash(p.stockValue)} sub={`${formatQty(p.stockQty)} шт. на складе`} />
        <SumTile href="/production" label={TERMS.inProduction} value={`${formatQty(p.inProdQty)} шт.`} sub={`${p.inProdOrders} ТЗ${p.prodAvg ? ` · ${formatMoney(p.prodAvg)} на изделие` : ""}`} />
        <SumTile href="/analytics/margin" label="Маржа" value="Открыть" sub="цена, себестоимость и маржа по моделям" />
      </section>

      {p.prepaid.ordered > 0.5 && (
        <section aria-label="Предоплачено, ждём поставку" className="rounded-lg border border-neutral-200 bg-white p-3">
          <h2 className="text-sm font-semibold">Предоплачено, ждём поставку</h2>
          <p className="mt-1 text-sm text-neutral-700">
            Заказано {formatMoney(p.prepaid.ordered)} ({formatQty(p.prepaid.qty)} шт.), предоплачено {formatMoney(p.prepaid.paid)}, остаток к оплате {dash(p.prepaid.due)}.
            <Link href="/lots" className="ml-2 inline-flex min-h-11 items-center text-blue-700 hover:underline">В «Сырьё» →</Link>
          </p>
          <p className="text-xs text-neutral-500">В «Куплено», «Использовано» и «Остаток» сырья эти шкуры не входят, пока поставка не принята.</p>
        </section>
      )}

      <Link href="/sales" data-testid="dash-sales-link" className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm hover:border-neutral-400">
        <b>Продажи и остатки</b>
        <span className="text-neutral-600">Произведено → Готовая продукция → Принято → Продано → Остаток</span>
        <span className="ml-auto text-blue-700">Открыть →</span>
      </Link>

      <CumChart {...p.chart} />
    </div>
  );
}

/** Один главный график: накопительно потрачено и получено (SVG, без клиентского кода). */
function CumChart({ months, spent, received }: { months: string[]; spent: number[]; received: number[] | null }) {
  if (months.length < 2) return null;
  const W = 640, H = 160, P = 8;
  const max = Math.max(1, ...spent, ...(received ?? []));
  const x = (i: number) => P + (i * (W - 2 * P)) / (months.length - 1);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const path = (a: number[]) => a.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <section aria-label="Накопительно потрачено и получено" className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Накопительно: {TERMS.spent.toLowerCase()} и {TERMS.received.toLowerCase()}</h2>
        <Link href="/cashflow" className="inline-flex min-h-11 items-center text-xs text-blue-700 hover:underline">Cashflow →</Link>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Потрачено ${formatMoneyCompact(spent[spent.length - 1], { unit: true })}${received ? `, получено ${formatMoneyCompact(received[received.length - 1], { unit: true })}` : ""}`} className="mt-1 h-40 w-full">
        <path d={path(spent)} fill="none" stroke="#d93a0e" strokeWidth="2" />
        {received && <path d={path(received)} fill="none" stroke="#2f7f8f" strokeWidth="2" />}
      </svg>
      <ul className="flex flex-wrap gap-x-4 text-xs text-neutral-700">
        <li className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-0.5 w-4" style={{ background: "#d93a0e" }} />{TERMS.spent}: {formatMoneyCompact(spent[spent.length - 1], { unit: true })}</li>
        {received && <li className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-0.5 w-4" style={{ background: "#2f7f8f" }} />{TERMS.received}: {formatMoneyCompact(received[received.length - 1], { unit: true })}</li>}
      </ul>
    </section>
  );
}
