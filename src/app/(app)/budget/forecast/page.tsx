import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireSession } from "@/lib/session";
import { loadRawForecast } from "@/lib/raw-forecast";
import { formatInt } from "@/lib/utils";

export const metadata = { title: "Прогноз сырья на FW26" };

const TH = "px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-neutral-500";
const TD = "px-3 py-2 text-right text-sm tabular-nums";

export default async function RawForecastPage() {
  const session = await requireSession();
  const f = await loadRawForecast(session.user.organizationId);
  const mixed = f.furs.filter((x) => x.fur.includes(" + "));
  const rows = f.furs.filter((x) => !x.fur.includes(" + ") && (x.stock > 0 || x.need > 0));
  const sum = (k: "stock" | "need") => rows.reduce((a, x) => a + x[k], 0);
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Бюджеты и прогнозы", href: "/budget" }, { label: "Прогноз сырья на FW26" }]} />
      <div>
        <h1 className="text-xl font-semibold">Прогноз сырья на остаток FW26</h1>
        <p className="mt-1 text-xs text-neutral-500">Остаток заказа: {formatInt(f.leftPcs)} изд. (заказано − поступило по отчёту о товарах{f.asOf ? ` на ${f.asOf.split("-").reverse().join(".")}` : ""}). Шкур на изделие — из ТЗ артикула, у новых — по категории.</p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[560px]">
          <thead><tr className="border-b border-neutral-200">
            <th className={TH + " text-left"}>Тип меха</th><th className={TH}>Сырья сейчас, шт.</th><th className={TH}>Уйдёт на остаток заказа, шт.</th><th className={TH}>Останется, шт.</th>
          </tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.fur} className="border-b border-neutral-100 align-top">
                <td className="px-3 py-2 text-sm">
                  {x.articles.length ? (
                    <details><summary className="cursor-pointer">{x.fur}</summary>
                      <ul className="mt-1 space-y-0.5 text-xs text-neutral-600">
                        {x.articles.map((a, i) => <li key={a.acode + i}>{a.acode}: {formatInt(a.left)} изд. × {a.hidesPer?.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} шк. = {formatInt(a.hides)} шк.{a.source === "категория" ? " (по категории)" : ""}</li>)}
                      </ul>
                    </details>
                  ) : x.fur}
                </td>
                <td className={TD}>{formatInt(x.stock)}</td><td className={TD}>{x.need > 0 ? formatInt(x.need) : "—"}</td>
                <td className={TD + (x.rest < 0 ? " font-semibold text-red-700" : " font-semibold")}>{x.rest < 0 ? `не хватает ${formatInt(-x.rest)}` : formatInt(x.rest)}</td>
              </tr>
            ))}
            <tr className="bg-neutral-50 font-semibold"><td className="px-3 py-2 text-sm">Итого</td><td className={TD}>{formatInt(sum("stock"))}</td><td className={TD}>{formatInt(sum("need"))}</td><td className={TD}>{formatInt(sum("stock") - sum("need"))}</td></tr>
          </tbody>
        </table>
      </div>
      <ul className="space-y-1 text-xs text-neutral-600">
        <li>«Сырья сейчас» — остаток шкур по лотам, включая заказанное, но ещё не полученное.</li>
        {mixed.map((x) => <li key={x.fur}>{x.fur}: {formatInt(x.need)} шк. нужно по ТЗ смешанных артикулов; по видам меха ТЗ не делит, поэтому в строки выше они не входят.</li>)}
        {f.noData.length ? <li>Без данных ТЗ и категории, в расчёт не вошли: {f.noData.map((n) => `${n.acode} (${n.left} изд.)`).join(", ")}.</li> : null}
      </ul>
    </div>
  );
}
