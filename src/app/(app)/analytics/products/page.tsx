import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix } from "@/lib/commission4";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Money } from "@/components/money";
import { InfoHint } from "@/components/info-hint";
import { YearNote } from "@/components/year-note";
import { Mode4Badge } from "@/components/c4-note";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { formatMoney, formatQty } from "@/lib/utils";
import { loadOrderRows, type OrderRow } from "@/lib/analytics-orders";
import {
  GROUPS,
  GROUP_KEYS,
  STATUS_LABEL,
  aggregate,
  applyFilters,
  applyStatus,
  buildMatrix,
  distinct,
  groupRows,
  parseProductFilters,
  per,
  productQuery,
  type Agg,
  type GroupKey,
  type Matrix,
  type ProductFilters,
} from "@/lib/analytics-products";
import { SOURCE_LABEL, UNDEFINED_CATEGORY } from "@/lib/product-category";

export const metadata = { title: "Что произведено" };

const f1 = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;
const q2 = (x: number | null) => (x == null ? "—" : formatQty(Math.round(x * 100) / 100));
const orderLabel = (r: OrderRow) => (r.workOrderNumber && r.workOrderNumber !== r.number ? `${r.number} (заказчика ${r.workOrderNumber})` : r.number);
const FILTER_KEY: Partial<Record<GroupKey, keyof ProductFilters>> = { category: "cat", fur: "fur", size: "size", batch: "batch" };

export default async function ProductsAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const year = await getYearFilter();
  const c4Mode = await getCommission4Mode();
  const c4 = c4Suffix(c4Mode);
  const f = parseProductFilters(await searchParams);

  const all = await loadOrderRows(session.user.organizationId, year, c4Mode);
  const rows = applyFilters(all, f);
  const groups = groupRows(rows, f.g);
  const total = aggregate("Итого", rows);

  // Сводка по статусам — по всем ТЗ года, без фильтров таблицы.
  const sumFor = (rs: OrderRow[]) => ({
    orders: rs.length,
    units: aggregate("", rs).units,
    batches: new Set(rs.filter((r) => r.batchNumber != null).map((r) => r.batchNumber)).size,
    work: aggregate("", rs).work,
    a: aggregate("", rs),
  });
  const sDone = sumFor(applyStatus(all, "done"));
  const sWork = sumFor(applyStatus(all, "work"));
  const sAll = sumFor(all);

  // Качество данных — по всем ТЗ года.
  const undefCat = all.filter((r) => r.category === UNDEFINED_CATEGORY);
  const noUsagesDone = all.filter((r) => r.group === "done" && r.usageCount === 0);
  const noUsagesWork = all.filter((r) => r.group === "work" && r.usageCount === 0);
  const noWork = all.filter((r) => !(r.work > 0));
  const zeroCostDone = all.filter((r) => r.group === "done" && !(r.costIncl > 0));
  const zeroCostWork = all.filter((r) => r.group === "work" && !(r.costIncl > 0));
  const noFurUsage = all.filter((r) => r.group === "done" && !r.furFromUsage);
  const noBatch = all.filter((r) => r.batchNumber == null);

  const q = (over: Partial<ProductFilters> = {}) => `/analytics/products${productQuery(f, over)}`;
  const exportQs = productQuery(f).replace(/^\?/, "");
  const hasFilter = !!(f.cat || f.fur || f.size || f.batch || f.q || f.st !== "done");

  const example = groups.find((g) => g.unitsCosted > 0 && g.orders > 1) ?? groups.find((g) => g.unitsCosted > 0);

  const cat = distinct(all, "category");
  const furs = distinct(all, "fur");
  const sizes = distinct(all, "size");
  const batches = distinct(all, "batch");

  const avgCostCell = (a: Agg) => {
    const i = per(a.costIncl, a.unitsCosted);
    const e = per(a.costExcl, a.unitsCosted);
    return i == null ? "—" : <Money incl={i} excl={e} />;
  };
  const sumCostCell = (a: Agg) => (a.costIncl > 0 ? <Money incl={a.costIncl} excl={a.costExcl} /> : "—");
  const workCell = (a: Agg) => {
    const w = per(a.work, a.unitsWork);
    return w == null ? "—" : formatMoney(w.toFixed(2));
  };

  const orderList = (a: Agg) => (
    <div className="mt-2 flex flex-col gap-1 text-xs font-normal text-neutral-600">
      {[...a.rows]
        .sort((x, y) => x.number.localeCompare(y.number, "ru", { numeric: true }))
        .map((r) => (
          <div key={r.id} className="flex flex-wrap gap-x-2">
            <Link href={`/production/${r.id}`} className="font-medium text-neutral-800 underline underline-offset-2">
              ТЗ {orderLabel(r)}
            </Link>
            <span>{r.modelName}</span>
            <span>разм. {r.sizeRaw || "—"}</span>
            <span>{formatQty(r.qty)} ед.</span>
            <span>{r.group === "done" ? "сделано" : "в работе"}</span>
            <span>{r.costIncl > 0 ? <Money incl={r.costIncl / Math.max(r.qty, 1)} excl={r.costExcl / Math.max(r.qty, 1)} /> : "себестоимость 0"} за ед.</span>
            {r.work > 0 && <span>работа {formatMoney((r.work / Math.max(r.qty, 1)).toFixed(2))}</span>}
          </div>
        ))}
    </div>
  );

  const filterLink = (a: Agg) => {
    const k = FILTER_KEY[f.g];
    if (!k) return null;
    const val = f.g === "batch" ? a.label.replace(/\D/g, "") : a.label;
    if (!val) return null;
    return (
      <Link href={q({ [k]: val })} className="ml-2 text-xs font-normal text-neutral-500 underline underline-offset-2">
        только эти
      </Link>
    );
  };

  const heat = (m: Matrix) => {
    const max = f.mx === "cost" ? m.maxCost : m.maxUnits;
    return (
      <Table>
        <Thead>
          <Tr>
            <Th className="sticky left-0 bg-neutral-50"> </Th>
            {m.colLabels.map((c) => (
              <Th key={c} className="text-right">{c}</Th>
            ))}
            <Th className="text-right">Σ</Th>
          </Tr>
        </Thead>
        <Tbody>
          {m.rowLabels.map((r) => (
            <Tr key={r}>
              <Td className="sticky left-0 whitespace-nowrap bg-white font-medium">{r}</Td>
              {m.colLabels.map((c) => {
                const x = m.cell(r, c);
                const v = f.mx === "cost" ? x.costIncl : x.units;
                const a = max > 0 ? 0.08 + 0.55 * (v / max) : 0;
                return (
                  <Td
                    key={c}
                    className="whitespace-nowrap text-right tabular-nums"
                    style={v > 0 ? { backgroundColor: `rgba(16,185,129,${a.toFixed(2)})` } : undefined}
                    title={v > 0 ? `${r} × ${c}: ${formatQty(x.units)} ед., ТЗ: ${x.orders}` : undefined}
                  >
                    {v > 0 ? (
                      f.mx === "cost" ? (
                        <Money incl={x.costIncl} excl={x.costExcl} />
                      ) : (
                        formatQty(x.units)
                      )
                    ) : (
                      <span className="text-neutral-300">·</span>
                    )}
                  </Td>
                );
              })}
              <Td className="whitespace-nowrap text-right font-semibold tabular-nums">
                {f.mx === "cost" ? <Money incl={m.rowTotals.get(r)!.costIncl} excl={m.rowTotals.get(r)!.costExcl} /> : formatQty(m.rowTotals.get(r)!.units)}
              </Td>
            </Tr>
          ))}
          <Tr>
            <Td className="sticky left-0 bg-white font-semibold">Σ</Td>
            {m.colLabels.map((c) => (
              <Td key={c} className="whitespace-nowrap text-right font-semibold tabular-nums">
                {f.mx === "cost" ? <Money incl={m.colTotals.get(c)!.costIncl} excl={m.colTotals.get(c)!.costExcl} /> : formatQty(m.colTotals.get(c)!.units)}
              </Td>
            ))}
            <Td />
          </Tr>
        </Tbody>
      </Table>
    );
  };

  const mxCat = buildMatrix(rows, "category", "fur");
  const mxSize = buildMatrix(rows, "category", "size");

  const linkList = (rs: OrderRow[], limit = 40) => (
    <span className="flex flex-wrap gap-x-2 gap-y-1">
      {rs.slice(0, limit).map((r) => (
        <Link key={r.id} href={`/production/${r.id}`} className="underline underline-offset-2">
          {orderLabel(r)}
        </Link>
      ))}
      {rs.length > limit && <span className="text-neutral-500">…и ещё {rs.length - limit}</span>}
    </span>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">
          Что произведено
          <YearNote year={year} />
          <Mode4Badge mode={c4Mode} />
          <InfoHint label="О странице" wide>
            <p>Какие ТЗ сделаны и что они дали: по категориям изделий, видам меха, размерам, моделям, партиям, годам и цветам. Одна строка источника = одно ТЗ (отменённые не считаются).</p>
            <p className="mt-1">
              <b>Себестоимость</b> = сырьё + подкладка (по лотам) + расходы ТЗ; в режиме «С 4%» к сырью и подкладке добавляется 4% (работа не облагается). Это та же себестоимость, что на страницах «Партии» и «Изделия». <b>Работа</b> (цена работы по ТЗ × количество) в неё не входит и показана отдельно.
            </p>
            <p className="mt-1">
              <b>Среднее — только средневзвешенное:</b> Σ суммы ÷ Σ единиц. Средняя себестоимость считается по ТЗ, у которых она известна (больше 0); работа — по ТЗ с ценой работы; расход меха и подкладки — по ТЗ, где есть списания.
            </p>
            {example && example.unitsCosted > 0 && (
              <p className="mt-1">
                Пример — «{example.label}»: Σ себестоимости {formatMoney(example.costIncl.toFixed(2))} ÷ {formatQty(example.unitsCosted)} ед. = {formatMoney((example.costIncl / example.unitsCosted).toFixed(2))} за единицу (с НДС{c4 ? `, ${c4.trim().replace(/[()]/g, "")}` : ""}).
              </p>
            )}
            <p className="mt-1">
              <b>Категория</b> определена по названию (текст «категория» у модели, затем описание материала в ТЗ) правилом из файла <code>src/lib/product-category.ts</code>; не определилась — отдельная строка «{UNDEFINED_CATEGORY}». <b>Вид меха</b> — по сырью, списанному в ТЗ (несколько видов — «A + B»), без списаний — по названию.
            </p>
            <p className="mt-1">Фурнитура в учёте не списывается (в ТЗ только мех и подкладка), поэтому расход фурнитуры не показан. «Набор размеров» — ТЗ сразу на несколько размеров: сколько единиц какого размера, в ТЗ не записано.</p>
          </InfoHint>
        </h1>
        <div className="flex flex-wrap gap-2">
          <a href={`/analytics/products/export?${exportQs}&part=groups`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            CSV: таблица
          </a>
          <a href={`/analytics/products/export?${exportQs}&part=orders`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            CSV: список ТЗ
          </a>
        </div>
      </div>

      {/* Сводка по статусам */}
      <Table>
        <Thead>
          <Tr>
            <Th>Всего за {year === "all" ? "все годы" : `${year} год`}</Th>
            <Th className="text-right">Сделано</Th>
            <Th className="text-right">В работе и план</Th>
            <Th className="text-right">Итого</Th>
          </Tr>
        </Thead>
        <Tbody>
          <Tr>
            <Td>ТЗ</Td>
            <Td className="text-right tabular-nums">{sDone.orders}</Td>
            <Td className="text-right tabular-nums">{sWork.orders}</Td>
            <Td className="text-right font-semibold tabular-nums">{sAll.orders}</Td>
          </Tr>
          <Tr>
            <Td>Единиц</Td>
            <Td className="text-right tabular-nums">{formatQty(sDone.units)}</Td>
            <Td className="text-right tabular-nums">{formatQty(sWork.units)}</Td>
            <Td className="text-right font-semibold tabular-nums">{formatQty(sAll.units)}</Td>
          </Tr>
          <Tr>
            <Td>Партий</Td>
            <Td className="text-right tabular-nums">{sDone.batches}</Td>
            <Td className="text-right tabular-nums">{sWork.batches}</Td>
            <Td className="text-right font-semibold tabular-nums">{sAll.batches}</Td>
          </Tr>
          <Tr>
            <Td>
              Σ работы
              <InfoHint label="Что такое работа">Цена работы по ТЗ × количество (как в «Партиях»). В себестоимость системы не входит.</InfoHint>
            </Td>
            <Td className="text-right tabular-nums">{formatMoney(sDone.work.toFixed(2))}</Td>
            <Td className="text-right tabular-nums">{formatMoney(sWork.work.toFixed(2))}</Td>
            <Td className="text-right font-semibold tabular-nums">{formatMoney(sAll.work.toFixed(2))}</Td>
          </Tr>
          <Tr>
            <Td>
              Σ себестоимости{c4}
              <InfoHint label="Что в сумме" wide>
                Сумма по ТЗ, у которых себестоимость известна (больше 0): сырьё и подкладка + расходы ТЗ{c4Mode === "on" ? " + 4%" : ""}. У ТЗ «в работе» часто ещё нет списаний — они в сумму не попадают (см. «Качество данных»).
              </InfoHint>
            </Td>
            <Td className="text-right tabular-nums"><Money incl={sDone.a.costIncl} excl={sDone.a.costExcl} /></Td>
            <Td className="text-right tabular-nums"><Money incl={sWork.a.costIncl} excl={sWork.a.costExcl} /></Td>
            <Td className="text-right font-semibold tabular-nums"><Money incl={sAll.a.costIncl} excl={sAll.a.costExcl} /></Td>
          </Tr>
        </Tbody>
      </Table>

      {/* Фильтры */}
      <form method="get" className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 bg-white p-3">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Группировать по
          <Select name="g" defaultValue={f.g} className="h-9 w-44">
            {GROUP_KEYS.map((k) => (
              <option key={k} value={k}>
                {GROUPS[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          ТЗ
          <Select name="st" defaultValue={f.st} className="h-9 w-44">
            {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((k) => (
              <option key={k} value={k}>
                {STATUS_LABEL[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Категория
          <Select name="cat" defaultValue={f.cat} className="h-9 w-44">
            <option value="">Все</option>
            {cat.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Мех
          <Select name="fur" defaultValue={f.fur} className="h-9 w-44">
            <option value="">Все</option>
            {furs.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Размер
          <Select name="size" defaultValue={f.size} className="h-9 w-36">
            <option value="">Все</option>
            {sizes.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Партия
          <Select name="batch" defaultValue={f.batch} className="h-9 w-32">
            <option value="">Все</option>
            {batches
              .filter((b) => /\d/.test(b))
              .map((b) => (
                <option key={b} value={b.replace(/\D/g, "")}>
                  {b}
                </option>
              ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Поиск
          <Input name="q" defaultValue={f.q} placeholder="№ ТЗ, модель, цвет" className="h-9 w-44" />
        </label>
        <input type="hidden" name="mx" value={f.mx} />
        <Button type="submit" size="sm" className="h-9">
          Показать
        </Button>
        {hasFilter && (
          <Link href={`/analytics/products${f.g !== "category" ? `?g=${f.g}` : ""}`} className="pb-2 text-sm text-neutral-500 underline underline-offset-2">
            Сбросить
          </Link>
        )}
      </form>

      {/* Сводная таблица */}
      <div className="text-sm text-neutral-500">
        Группировка: <b className="text-neutral-800">{GROUPS[f.g]}</b> · {STATUS_LABEL[f.st]} · ТЗ: {total.orders} · единиц: {formatQty(total.units)}
        {total.units === 0 && <span className="ml-2 text-neutral-400">нет данных за выбранный год и фильтры</span>}
      </div>

      <ResponsiveRows
        table={
          <Table>
            <Thead>
              <Tr>
                <Th>{GROUPS[f.g]}</Th>
                <Th className="text-right">ТЗ</Th>
                <Th className="text-right">Единиц</Th>
                <Th className="text-right">Доля</Th>
                <Th className="text-right">
                  Работа за ед.
                  <InfoHint label="Средняя работа" align="right">Σ работы ÷ Σ единиц по ТЗ с ценой работы (средневзвешенная по количеству).</InfoHint>
                </Th>
                <Th className="text-right">
                  Мех, шк. за ед.
                  <InfoHint label="Расход меха" align="right">Σ списанных шкур ÷ Σ единиц по ТЗ, где есть списания. Подкладка — метры. Фурнитура в учёте не списывается.</InfoHint>
                </Th>
                <Th className="text-right">Подкладка, м за ед.</Th>
                <Th className="text-right">Себестоимость за ед.{c4}</Th>
                <Th className="text-right">Σ себестоимости{c4}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {groups.map((a) => (
                <Tr key={a.label}>
                  <Td className="font-medium">
                    <details>
                      <summary className="cursor-pointer hover:underline">
                        {a.label}
                        {f.g === "category" && a.label === UNDEFINED_CATEGORY && <span className="ml-1 text-xs font-normal text-amber-700">(модели без названия категории — список ниже)</span>}
                      </summary>
                      {orderList(a)}
                      {filterLink(a)}
                    </details>
                  </Td>
                  <Td className="text-right tabular-nums">{a.orders}</Td>
                  <Td className="text-right tabular-nums">{formatQty(a.units)}</Td>
                  <Td className="text-right tabular-nums">{total.units > 0 ? f1(a.units / total.units) : "—"}</Td>
                  <Td className="text-right tabular-nums">{workCell(a)}</Td>
                  <Td className="text-right tabular-nums">{q2(per(a.furQty, a.unitsMat))}</Td>
                  <Td className="text-right tabular-nums">{q2(per(a.liningQty, a.unitsMat))}</Td>
                  <Td className="text-right tabular-nums">{avgCostCell(a)}</Td>
                  <Td className="text-right tabular-nums">{sumCostCell(a)}</Td>
                </Tr>
              ))}
              {groups.length > 0 && (
                <Tr className="bg-neutral-50 font-semibold">
                  <Td>Итого</Td>
                  <Td className="text-right tabular-nums">{total.orders}</Td>
                  <Td className="text-right tabular-nums">{formatQty(total.units)}</Td>
                  <Td className="text-right tabular-nums">100%</Td>
                  <Td className="text-right tabular-nums">{workCell(total)}</Td>
                  <Td className="text-right tabular-nums">{q2(per(total.furQty, total.unitsMat))}</Td>
                  <Td className="text-right tabular-nums">{q2(per(total.liningQty, total.unitsMat))}</Td>
                  <Td className="text-right tabular-nums">{avgCostCell(total)}</Td>
                  <Td className="text-right tabular-nums">{sumCostCell(total)}</Td>
                </Tr>
              )}
              {groups.length === 0 && (
                <Tr>
                  <Td colSpan={9} className="py-8 text-center text-neutral-400">
                    {year !== "all" ? `За ${year} год ТЗ по этим условиям нет` : "ТЗ по этим условиям нет"}
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        }
      >
        {groups.map((a) => (
          <RowCard
            key={a.label}
            title={a.label}
            fields={[
              { label: "ТЗ", value: a.orders },
              { label: "Единиц", value: `${formatQty(a.units)} (${total.units > 0 ? f1(a.units / total.units) : "—"})`, strong: true },
              { label: `Себестоимость за ед.${c4}`, value: avgCostCell(a) },
              { label: `Σ себестоимости${c4}`, value: sumCostCell(a) },
            ]}
            details={[
              { label: "Работа за ед.", value: workCell(a) },
              { label: "Мех, шк. за ед.", value: q2(per(a.furQty, a.unitsMat)) },
              { label: "Подкладка, м за ед.", value: q2(per(a.liningQty, a.unitsMat)) },
              { label: "ТЗ", value: orderList(a) },
            ]}
          />
        ))}
        {groups.length === 0 && <p className="py-8 text-center text-neutral-400">ТЗ по этим условиям нет</p>}
      </ResponsiveRows>

      {/* Матрицы */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          Матрицы
          <InfoHint label="О матрицах" wide>
            Тепловые таблицы по тем же ТЗ, что и таблица выше (с учётом фильтров): число единиц или Σ себестоимости на пересечении «категория × мех» и «категория × размер». Чем темнее ячейка, тем больше. Наведите на ячейку — число ТЗ.
          </InfoHint>
        </h2>
        <div className="flex gap-1 text-sm">
          <Link href={q({ mx: "units" })} className={f.mx === "units" ? "rounded-md bg-neutral-900 px-3 py-1 text-white" : "rounded-md px-3 py-1 hover:bg-neutral-100"}>
            Единицы
          </Link>
          <Link href={q({ mx: "cost" })} className={f.mx === "cost" ? "rounded-md bg-neutral-900 px-3 py-1 text-white" : "rounded-md px-3 py-1 hover:bg-neutral-100"}>
            Себестоимость{c4}
          </Link>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-400">Нет данных для матриц.</p>
      ) : (
        <>
          <div>
            <div className="mb-1 text-sm font-medium">Категория × мех</div>
            {heat(mxCat)}
          </div>
          <div>
            <div className="mb-1 text-sm font-medium">Категория × размер</div>
            {heat(mxSize)}
          </div>
        </>
      )}

      {/* Качество данных */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
        <h2 className="mb-2 text-base font-semibold">
          Качество данных
          <InfoHint label="О проверках">Проверки по всем ТЗ выбранного года (без фильтров таблицы). Данные не правятся — только показано, где неполно.</InfoHint>
        </h2>
        <ul className="flex flex-col gap-2">
          <li>
            Категория не определена: <b>{undefCat.length}</b> ТЗ
            {undefCat.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-neutral-600">Показать модели и ТЗ</summary>
                <div className="mt-1 flex flex-col gap-1 text-xs">
                  {Array.from(new Set(undefCat.map((r) => r.modelId))).map((id) => {
                    const rs = undefCat.filter((r) => r.modelId === id);
                    return (
                      <div key={id} className="flex flex-wrap gap-x-2">
                        <Link href={`/models/${id}`} className="font-medium underline underline-offset-2">
                          {rs[0].modelName}
                        </Link>
                        <span className="text-neutral-500">у модели не заполнена категория, по названию не определить · ТЗ:</span>
                        {linkList(rs)}
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </li>
          <li>
            ТЗ «сделано» без списаний материалов (состав не заполнен): <b>{noUsagesDone.length}</b>
            {noUsagesDone.length > 0 && <div className="mt-1 text-xs">{linkList(noUsagesDone)}</div>}
            {noUsagesWork.length > 0 && <div className="text-xs text-neutral-500">«В работе» без списаний: {noUsagesWork.length} (ожидаемо — материалы ещё не списаны)</div>}
          </li>
          <li>
            ТЗ «сделано» с себестоимостью 0: <b>{zeroCostDone.length}</b>
            {zeroCostDone.length > 0 && <div className="mt-1 text-xs">{linkList(zeroCostDone)}</div>}
            {zeroCostWork.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-neutral-600">«В работе» с себестоимостью 0: {zeroCostWork.length} (в средних не участвуют)</summary>
                <div className="mt-1 text-xs">{linkList(zeroCostWork)}</div>
              </details>
            )}
          </li>
          <li>
            ТЗ без цены работы: <b>{noWork.length}</b>
            {noWork.length > 0 && <div className="mt-1 text-xs">{linkList(noWork)}</div>}
          </li>
          <li>
            «Сделано», вид меха взят по названию (нет списаний): <b>{noFurUsage.length}</b>
            {noFurUsage.length > 0 && <div className="mt-1 text-xs">{linkList(noFurUsage)}</div>}
          </li>
          <li>
            ТЗ без партии: <b>{noBatch.length}</b>
            {noBatch.length > 0 && <div className="mt-1 text-xs">{linkList(noBatch)}</div>}
          </li>
          <li className="text-xs text-neutral-500">
            Как определена категория: {Object.values(SOURCE_LABEL).slice(0, 3).join("; ")}. У {all.filter((r) => r.categorySource === "description").length} ТЗ — по описанию материала в ТЗ.
          </li>
        </ul>
        <div className="mt-3 text-xs text-neutral-500">
          Цены и наценки — на вкладке{" "}
          <Link href="/analytics/pricing" className="underline underline-offset-2">
            «Цены»
          </Link>
          .
        </div>
      </section>
    </div>
  );
}
