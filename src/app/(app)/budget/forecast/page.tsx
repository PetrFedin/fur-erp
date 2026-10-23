import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireSession } from "@/lib/session";
import { LinesTable } from "./lines-table";
import { loadRawForecast } from "@/lib/raw-forecast";
import { formatInt } from "@/lib/utils";

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
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Бюджеты и прогнозы", href: "/budget" }, { label: "Прогноз сырья на FW26" }]} />
      <div>
        <h1 className="text-xl font-semibold">Прогноз сырья на остаток FW26</h1>
        <p className="mt-1 text-xs text-neutral-500">Остаток заказа: {formatInt(f.leftPcs)} изд. (заказано − поступило по отчёту о товарах{f.asOf ? ` на ${f.asOf.split("-").reverse().join(".")}` : ""}). Шкур, цены меха и подкладки, работа на изделие — средние по ТЗ артикула (у новых — по категории), ₽ с НДС, 4% на мех и подкладку; суммы до тысяч.</p>
      </div>
      <h2 className="text-base font-semibold">Артикулы в заказе: примерный расход и себестоимость</h2>
      <LinesTable lines={f.lines} noData={f.noData} />
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
