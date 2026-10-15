import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/info-hint";
import { formatQty } from "@/lib/utils";

export type SizeRow = { size: string; q: number };
export const NO_SIZE = "Не указан";

const RANK = ["XXXL", "XXL", "XL", "L", "M", "S", "XS"];
/** Порядок размеров: буквенные от крупных к мелким, числовые по возрастанию, «Не указан» последним. */
export function sortSizes(a: string, b: string): number {
  if (a === NO_SIZE || b === NO_SIZE) return a === NO_SIZE ? (b === NO_SIZE ? 0 : 1) : -1;
  const ra = RANK.indexOf(a.split(",")[0]), rb = RANK.indexOf(b.split(",")[0]);
  if (ra >= 0 || rb >= 0) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || a.localeCompare(b, "ru");
  return a.localeCompare(b, "ru", { numeric: true });
}

/**
 * «Шкур по размерам»: сколько шкур взято в каждом размере по всем ТЗ артикула (размер берётся из лота, из которого списан мех).
 * Таблица с полосами: сама таблица читается скринридером, полоса — только картинка (aria-hidden). Размера в лоте нет — строка «Не указан».
 */
export function SizeChart({ rows }: { rows: SizeRow[] }) {
  const total = rows.reduce((a, r) => a + r.q, 0);
  const max = Math.max(...rows.map((r) => r.q), 0);
  const known = rows.filter((r) => r.size !== NO_SIZE).reduce((a, r) => a + r.q, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-1">
          Шкур по размерам
          <InfoHint label="Откуда размеры шкур" wide>
            <p>Шкуры, списанные в ТЗ артикула, сгруппированы по размеру лота, из которого их взяли (размер записан в лоте закупки). Если в лоте размер не указан, шкуры попадают в «{NO_SIZE}». Шкуры подрядчика без лота сюда не входят.</p>
          </InfoHint>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {total <= 0 ? (
          <p className="text-sm text-neutral-600">По ТЗ артикула шкуры из лотов ещё не списаны — размеры брать неоткуда.</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <caption className="sr-only">Сколько шкур взято в каждом размере</caption>
              <thead>
                <tr className="text-xs text-neutral-600">
                  <th scope="col" className="w-28 py-1 text-left font-medium">Размер</th>
                  <th scope="col" className="py-1 text-left font-medium"><span className="sr-only">Доля</span></th>
                  <th scope="col" className="w-20 py-1 text-right font-medium">Шкур, шт.</th>
                  <th scope="col" className="w-14 py-1 text-right font-medium">Доля</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.size} className="border-t border-neutral-100">
                    <th scope="row" className={"py-2 pr-2 text-left font-normal " + (r.size === NO_SIZE ? "text-neutral-600" : "font-medium")}>{r.size}</th>
                    <td className="py-2 pr-3">
                      <div aria-hidden className="h-4 w-full rounded-sm bg-neutral-100">
                        <div className={"h-4 rounded-sm " + (r.size === NO_SIZE ? "bg-neutral-500" : "bg-neutral-800")} style={{ width: `${max > 0 ? Math.max(2, (r.q / max) * 100) : 0}%` }} />
                      </div>
                    </td>
                    <td className="py-2 text-right font-medium tabular-nums">{formatQty(Math.round(r.q * 100) / 100)}</td>
                    <td className="py-2 text-right tabular-nums text-neutral-600">{Math.round((r.q / total) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-neutral-300 font-medium">
                  <th scope="row" className="py-2 text-left">Всего</th>
                  <td />
                  <td className="py-2 text-right tabular-nums">{formatQty(Math.round(total * 100) / 100)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
            {known <= 0 && <p className="mt-2 text-sm text-neutral-600">В лотах этого артикула размер шкур не записан — разбить по размерам нечего.</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
