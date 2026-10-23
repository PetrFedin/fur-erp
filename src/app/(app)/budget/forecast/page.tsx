import { Fragment } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireSession } from "@/lib/session";
import { loadRawForecast } from "@/lib/raw-forecast";
import { formatInt, formatMoney } from "@/lib/utils";

export const metadata = { title: "Прогноз сырья на FW26" };

const TH = "px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-neutral-500";
const TD = "px-3 py-2 text-right text-sm tabular-nums";

export default async function RawForecastPage() {
  const session = await requireSession();
  const f = await loadRawForecast(session.user.organizationId);
  const mixed = f.furs.filter((x) => x.fur.includes(" + "));
  const all = f.furs.filter((x) => !x.fur.includes(" + ") && (x.stock > 0 || x.need > 0));
  const big = all.filter((x) => x.stock + x.need >= 100);
  const small = all.filter((x) => x.stock + x.need < 100);
  const rows = small.length ? [...big, { fur: "Остальной мех", stock: small.reduce((a, x) => a + x.stock, 0), need: small.reduce((a, x) => a + x.need, 0), rest: small.reduce((a, x) => a + x.rest, 0), articles: [] as typeof big[number]["articles"] }] : big;
  const sum = (k: "stock" | "need") => rows.reduce((a, x) => a + x[k], 0);
  const L = f.lines;
  type Sums = { left: number; hides: number; fur$: number; meters: number; lining$: number; c4$: number; work$: number; total$: number };
  const sumOf = (g: Sums[]): Sums => g.reduce((a, x) => ({ left: a.left + x.left, hides: a.hides + x.hides, fur$: a.fur$ + x.fur$, meters: a.meters + x.meters, lining$: a.lining$ + x.lining$, c4$: a.c4$ + x.c4$, work$: a.work$ + x.work$, total$: a.total$ + x.total$ }), { left: 0, hides: 0, fur$: 0, meters: 0, lining$: 0, c4$: 0, work$: 0, total$: 0 });
  const m = (v: number) => formatMoney(Math.round(v / 1000) * 1000);
  const cells = (x: Sums, n: number) => (
    <>
      <td className={TD}>{formatInt(n)}</td><td className={TD}>{formatInt(x.hides)}</td><td className={TD}>{m(x.fur$)}</td><td className={TD}>{formatInt(x.meters)}</td><td className={TD}>{m(x.lining$)}</td><td className={TD}>{m(x.c4$)}</td><td className={TD}>{m(x.work$)}</td><td className={TD + " font-semibold"}>{m(x.total$)}</td><td className={TD}>{m(x.total$ / (n || 1))}</td>
    </>
  );
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Бюджеты и прогнозы", href: "/budget" }, { label: "Прогноз сырья на FW26" }]} />
      <div>
        <h1 className="text-xl font-semibold">Прогноз сырья на остаток FW26</h1>
        <p className="mt-1 text-xs text-neutral-500">Остаток заказа: {formatInt(f.leftPcs)} изд. (заказано − поступило по отчёту о товарах{f.asOf ? ` на ${f.asOf.split("-").reverse().join(".")}` : ""}). Шкур, цены меха и подкладки, работа на изделие — средние по ТЗ артикула (у новых — по категории), ₽ с НДС, 4% на мех и подкладку; суммы до тысяч.</p>
      </div>
      <h2 className="text-base font-semibold">Артикулы в заказе: примерный расход и себестоимость</h2>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[900px]">
          <thead><tr className="border-b border-neutral-200">
            <th className={TH + " text-left"}>Категория 2</th><th className={TH + " text-left"}>Артикул</th><th className={TH}>Изд.</th><th className={TH}>Шкур</th><th className={TH}>Мех, ₽</th><th className={TH}>Подкладка, м</th><th className={TH}>Подкладка, ₽</th><th className={TH}>4%, ₽</th><th className={TH}>Работа, ₽</th><th className={TH}>Себестоимость, ₽</th><th className={TH}>На 1 изд., ₽</th>
          </tr></thead>
          <tbody>
            {([["clothes", "Одежда"], ["acc", "Аксессуары"]] as const).map(([cls, title]) => {
              const g = L.filter((x) => x.cls === cls);
              if (!g.length) return null;
              return (
                <Fragment key={cls}>
                  <tr className="bg-neutral-100"><td colSpan={11} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-600">{title}</td></tr>
                  {g.map((x, i) => (
                    <tr key={x.acode + i} className="border-b border-neutral-100">
                      <td className="px-3 py-2 text-sm text-neutral-600">{x.cat2}</td>
                      <td className="px-3 py-2 text-sm">{x.acode}{x.source === "категория" ? <span className="ml-1 text-[11px] text-neutral-400">по категории</span> : null}</td>
                      {cells(x, x.left)}
                    </tr>
                  ))}
                  <tr className="bg-neutral-50 font-semibold"><td colSpan={2} className="px-3 py-2 text-sm">Итого: {title.toLowerCase()}</td>{cells(sumOf(g), sumOf(g).left)}</tr>
                </Fragment>
              );
            })}
            <tr className="border-t-2 border-neutral-300 bg-neutral-100 font-semibold"><td colSpan={2} className="px-3 py-2 text-sm">Общий итог</td>{cells(sumOf(L), sumOf(L).left)}</tr>
          </tbody>
        </table>
      </div>
      <h2 className="mt-2 text-base font-semibold">Сырьё по типам меха, шкур</h2>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[560px]">
          <thead><tr className="border-b border-neutral-200">
            <th className={TH + " text-left"}>Тип меха</th><th className={TH}>Сейчас на остатке</th><th className={TH}>Будет использовано</th><th className={TH}>Останется</th>
          </tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.fur} className="border-b border-neutral-100">
                <td className="px-3 py-2 text-sm">{x.fur}</td>
                <td className={TD}>{formatInt(x.stock)}</td><td className={TD}>{x.need > 0 ? formatInt(x.need) : "—"}</td>
                <td className={TD + (x.rest < 0 ? " font-semibold text-red-700" : " font-semibold")}>{x.rest < 0 ? `не хватает ${formatInt(-x.rest)}` : formatInt(x.rest)}</td>
              </tr>
            ))}
            <tr className="bg-neutral-50 font-semibold"><td className="px-3 py-2 text-sm">Итого</td><td className={TD}>{formatInt(sum("stock"))}</td><td className={TD}>{formatInt(sum("need"))}</td><td className={TD}>{formatInt(sum("stock") - sum("need"))}</td></tr>
          </tbody>
        </table>
      </div>
      <ul className="space-y-1 text-xs text-neutral-600">
        <li>«Сейчас на остатке» — шкуры по лотам, включая заказанное, но ещё не полученное.</li>
        {mixed.map((x) => <li key={x.fur}>{x.fur}: {formatInt(x.need)} шк. нужно по ТЗ смешанных артикулов; по видам меха ТЗ не делит, поэтому в таблицу типов они не входят (в таблицу артикулов — входят).</li>)}
        {f.noData.length ? <li>Без данных ТЗ и категории, в расчёт не вошли: {f.noData.map((n) => `${n.acode} (${n.left} изд.)`).join(", ")}.</li> : null}
      </ul>
    </div>
  );
}
