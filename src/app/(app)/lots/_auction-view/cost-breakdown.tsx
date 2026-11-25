import { Fragment } from "react";
import { Decimal } from "@prisma/client/runtime/library";
import { GROUPS, classifyLabel, labelUnit, type GroupKey } from "@/lib/cost-breakdown-groups";
import { formatMoney } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/info-hint";

// Состав стоимости аукциона: из чего сложилась итоговая сумма по всем лотам (с НДС).
// Статьи берутся из расчёта каждого лота (значение на шкуру × количество); то, чего расчёт не покрывает, идёт строкой «Прочее и округление».
export function AuctionCostBreakdown({
  counted,
  fullIncl,
  totalQty,
}: {
  counted: { lines: { breakdown: unknown; i: { quantity: Decimal } }[] }[];
  fullIncl: Decimal;
  totalQty: Decimal;
}) {
  const sums = new Map<string, { group: GroupKey; label: string; sum: number }>();
  let covered = 0;
  for (const b of counted) {
    for (const l of b.lines) {
      const items = ((l.breakdown ?? {}) as { items?: { label?: unknown; value?: unknown }[] }).items;
      if (!Array.isArray(items)) continue;
      const qtyN = Number(l.i.quantity.toString());
      for (const it of items) {
        if (typeof it.label !== "string") continue;
        const v = Number(it.value);
        const g = classifyLabel(it.label);
        if (!Number.isFinite(v) || g === "totals" || labelUnit(it.label) !== "₽") continue;
        const key = `${g}|${it.label}`;
        const cur = sums.get(key) ?? { group: g, label: it.label.replace(/,\s*₽$/, ""), sum: 0 };
        cur.sum += v * qtyN;
        covered += v * qtyN;
        sums.set(key, cur);
      }
    }
  }
  const groups = GROUPS.filter((g) => [...sums.values()].some((x) => x.group === g.key)).map((g) => ({ ...g, rows: [...sums.values()].filter((x) => x.group === g.key && Math.abs(x.sum) >= 0.5) })).filter((g) => g.rows.length > 0);
  if (groups.length === 0) return null;
  const grand = Number(fullIncl.toString());
  // Статьи расчёта есть не у всех лотов: если они покрывают меньше половины суммы, строка «Прочее 97 %» ничего не объясняет — таблицу не показываем (состав по цене и НДС — ниже).
  if (covered < grand * 0.5) return null;
  const rest = grand - covered;
  const per = (v: number) => (Number(totalQty.toString()) > 0 ? formatMoney(Math.round(v / Number(totalQty.toString())).toString()) : "–");
  const share = (v: number) => (grand > 0 ? `${((v / grand) * 100).toFixed(1).replace(".", ",")}%` : "–");
  const rowCls = "border-b border-neutral-100";
  const tdn = "py-1 pl-3 text-right tabular-nums whitespace-nowrap";
  return (
    <details className="group rounded-lg border border-neutral-200 bg-white">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium hover:bg-neutral-50">
        Расшифровка по статьям расчёта лотов <span className="ml-2 text-xs font-normal text-neutral-500 group-open:hidden">развернуть ›</span>
      </summary>
    <Card className="border-0 shadow-none">
      <CardHeader>
        <CardTitle>
          Состав стоимости по статьям расчёта
          <InfoHint label="Как считается" wide>
            <p>Сумма по всем лотам аукциона с НДС. Для каждого лота берётся его расчёт: цена лота в валюте × курс, сборы аукциона и НДС на них, НДС на товар, выделка, транспорт, брокер, комиссии. Значение на шкуру умножается на количество и складывается по лотам.</p>
            <p className="mt-1">Итог совпадает с «С расходами» выше. Если в расчёте лота нет разбивки, его сумма попадает в «Прочее и округление».</p>
          </InfoHint>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th scope="col" className="py-1 pr-3 font-medium">Статья</th><th scope="col" className="py-1 pl-3 text-right font-medium">Сумма, ₽</th><th scope="col" className="py-1 pl-3 text-right font-medium">На шкуру, ₽</th><th scope="col" className="py-1 pl-3 text-right font-medium">Доля</th></tr></thead>
            <tbody>
              {groups.map((g) => {
                const sub = g.rows.reduce((a, r) => a + r.sum, 0);
                return (
                  <Fragment key={g.key}>
                    <tr className="bg-neutral-50">
                      <td className="py-1 pl-1 pr-3 text-xs font-semibold uppercase tracking-wide text-neutral-600">{g.title}</td>
                      <td className={tdn + " text-xs font-semibold text-neutral-700"}>{formatMoney(Math.round(sub).toString())}</td>
                      <td className={tdn + " text-xs text-neutral-500"}>{per(sub)}</td>
                      <td className={tdn + " text-xs text-neutral-500"}>{share(sub)}</td>
                    </tr>
                    {g.rows.length > 1 && g.rows.map((r) => (
                      <tr key={r.label} className={rowCls}><td className="py-1 pl-4 pr-3 text-neutral-700">{r.label}</td><td className={tdn}>{formatMoney(Math.round(r.sum).toString())}</td><td className={tdn + " text-neutral-500"}>{per(r.sum)}</td><td className={tdn + " text-neutral-500"}>{share(r.sum)}</td></tr>
                    ))}
                  </Fragment>
                );
              })}
              {Math.abs(rest) >= 1 && (
                <tr className={rowCls}><td className="py-1 pl-1 pr-3 text-neutral-700">Прочее и округление</td><td className={tdn}>{formatMoney(Math.round(rest).toString())}</td><td className={tdn + " text-neutral-500"}>{per(rest)}</td><td className={tdn + " text-neutral-500"}>{share(rest)}</td></tr>
              )}
              <tr className="row-total"><td className="py-1.5 pr-3">Итого с расходами, с НДС</td><td className={tdn + " font-semibold"}>{formatMoney(Math.round(grand).toString())}</td><td className={tdn}>{per(grand)}</td><td className={tdn}>100%</td></tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
    </details>
  );
}
