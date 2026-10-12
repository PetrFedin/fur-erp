import { itemsSuffix, tzCountText } from "@/lib/tz-key";
import Link from "next/link";
import { WidgetRow } from "@/components/widget-row";
import { requireSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix } from "@/lib/commission4";
import { buttonVariants } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Money } from "@/components/money";
import { InfoHint } from "@/components/info-hint";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue } from "@/app/(app)/dashboard/tile";
import { YearNote } from "@/components/year-note";
import { Mode4Badge } from "@/components/c4-note";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { formatMoney, formatQty } from "@/lib/utils";
import { loadOrderRows, type OrderRow } from "@/lib/analytics-orders";
import {
  GROUPS,
  GROUP_KEYS,
  STATUS_LABEL,
  applyFilters,
  applyStatus,
  buildGroups,
  buildMatrix,
  orderLabel,
  parseProductFilters,
  productParams,
  type GroupKey,
  type GroupNode,
  type Matrix,
  type ProductFilters,
} from "@/lib/analytics-products";
import { filterOptions } from "@/lib/analytics-filters";
import { COLUMNS, computeMetrics, derived, parseCols, parseSort, type ColKey } from "@/lib/analytics-metrics";
import { SIZE_CM, SIZE_SET, SOURCE_LABEL, UNDEFINED_CATEGORY } from "@/lib/product-category";
import { auctionLabeler } from "@/lib/filter-options";
import { AnalyticsFilterBar } from "../_shared/analytics-filter-bar";
import { MetricCell, MobileSort, SortTh, ViewBar, colLabel, pct0, q2, sortHref } from "../_shared/metric-ui";
import { TotalLabel } from "@/components/total-label";

export const metadata = { title: "Что произведено" };

const FILTER_KEY: Partial<Record<GroupKey, "cat" | "fur" | "size" | "batch" | "color">> = { category: "cat", fur: "fur", size: "size", batch: "batch", color: "color" };

export default async function ProductsAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const year = await getYearFilter();
  const c4Mode = await getCommission4Mode();
  const c4 = c4Suffix(c4Mode);
  const f = parseProductFilters(await searchParams);
  const cols = parseCols(f.cols, f.all);
  const sortState = parseSort(f.sort, f.dir);

  const all = await loadOrderRows(session.user.organizationId, year, c4Mode);
  const rows = applyFilters(all, f);
  const { nodes, total } = buildGroups(rows, f.g, f.g2, sortState.sort, sortState.dir);
  const aucOf = await auctionLabeler(session.user.organizationId);
  const opts = filterOptions(all);

  // Сводка по статусам — по всем ТЗ года, без фильтров таблицы.
  const sumFor = (rs: OrderRow[]) => {
    const m = computeMetrics(rs);
    return { m, d: derived(m), batches: new Set(rs.filter((r) => r.batchNumber != null).map((r) => r.batchNumber)).size };
  };
  const sDone = sumFor(applyStatus(all, "done"));
  const sWork = sumFor(applyStatus(all, "work"));
  const sAll = sumFor(all);
  // «Произведено» как на Главной: все ТЗ без отменённых (loadOrderRows их уже исключает) и без ремонта.
  const ownRows = all.filter((r) => r.category !== "Ремонт");
  const sOwn = sumFor(ownRows);
  const sOwnDone = sumFor(applyStatus(ownRows, "done"));
  const sOwnWork = sumFor(applyStatus(ownRows, "work"));
  const repairUnits = sAll.m.units - sOwn.m.units;

  // Качество данных — по всем ТЗ года.
  const undefCat = all.filter((r) => r.category === UNDEFINED_CATEGORY);
  const noUsagesDone = all.filter((r) => r.group === "done" && r.usageCount === 0);
  const noUsagesWork = all.filter((r) => r.group === "work" && r.usageCount === 0);
  const noWork = all.filter((r) => !(r.work > 0));
  const zeroCostDone = all.filter((r) => r.group === "done" && !(r.costIncl > 0));
  const zeroCostWork = all.filter((r) => r.group === "work" && !(r.costIncl > 0));
  const noFurUsage = all.filter((r) => r.group === "done" && !r.furFromUsage);
  const noBatch = all.filter((r) => r.batchNumber == null);
  const partHammer = all.filter((r) => r.furQty > 0 && r.hammerSkins < r.furQty - 1e-9);

  const href = (over: Partial<ProductFilters> = {}) => {
    const s = productParams(f, over).toString();
    return `/analytics/products${s ? `?${s}` : ""}`;
  };
  const exportQs = productParams(f).toString();
  const sortOver = (o: { sort: string; dir: string }) => href({ sort: o.sort, dir: o.dir });
  const thHref = (key: string) => sortHref(sortOver, key, sortState);

  const example = nodes.find((g) => g.m.unitsCosted > 0 && g.m.orders > 1) ?? nodes.find((g) => g.m.unitsCosted > 0);
  const exCost = example ? derived(example.m).costPerUnit : null;

  // Параметры, которые форма выбора колонок должна сохранить.
  const pickerHidden = Array.from(productParams(f, { cols: [], all: false }).entries()) as [string, string][];
  const toggleAll = href(f.cols.length > 0 || !f.all ? { cols: [], all: !f.all || f.cols.length > 0 } : { cols: [], all: false });

  const orderList = (rs: OrderRow[]) => (
    <div className="mt-2 flex flex-col gap-1 text-xs font-normal text-neutral-600">
      {[...rs]
        .sort((x, y) => x.number.localeCompare(y.number, "ru", { numeric: true }))
        .map((r) => (
          <div key={r.id} className="flex flex-wrap gap-x-2">
            <Link href={`/production/${r.id}`} className="font-medium text-neutral-800 underline underline-offset-2">
              ТЗ {orderLabel(r)}
            </Link>
            <span title={r.modelHint}>{r.modelLabel}</span>
            <span>разм. {r.sizeRaw || "—"}</span>
            <span>{formatQty(r.qty)} ед.</span>
            <span>{r.group === "done" ? "сделано" : "в работе"}</span>
            <span>{r.costIncl > 0 ? <Money incl={r.costIncl / Math.max(r.qty, 1)} excl={r.costExcl / Math.max(r.qty, 1)} /> : "себестоимость 0"} за ед.</span>
            {r.work > 0 && <span>работа {formatMoney((r.work / Math.max(r.qty, 1)).toFixed(2))}</span>}
            {r.furQty > 0 && <span>шкур {formatQty(r.furQty)}</span>}
            {r.hammerSkins > 0 && <span>молоток <Money incl={r.hammerIncl / r.hammerSkins} excl={r.hammerExcl / r.hammerSkins} /></span>}
          </div>
        ))}
    </div>
  );

  const filterLink = (n: GroupNode, g: GroupKey) => {
    const k = FILTER_KEY[g];
    if (!k) return null;
    const val = g === "batch" ? n.label.replace(/\D/g, "") : n.label;
    if (!val) return null;
    // Группы «Набор размеров», «Размер в см» и составной цвет — не одно значение фильтра: ссылки «только эти» у них нет.
    if ((g === "size" && (val === SIZE_SET || val === SIZE_CM)) || (g === "color" && val.includes(";"))) return null;
    return (
      <Link href={href({ [k]: [val] } as Partial<ProductFilters>)} className="ml-2 text-xs font-normal text-neutral-500 underline underline-offset-2">
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
                    {v > 0 ? f.mx === "cost" ? <Money incl={x.costIncl} excl={x.costExcl} /> : formatQty(x.units) : <span className="text-neutral-300">·</span>}
                  </Td>
                );
              })}
              <Td className="whitespace-nowrap text-right font-semibold tabular-nums">
                {f.mx === "cost" ? <Money incl={m.rowTotals.get(r)!.costIncl} excl={m.rowTotals.get(r)!.costExcl} /> : formatQty(m.rowTotals.get(r)!.units)}
              </Td>
            </Tr>
          ))}
          <Tr className="row-total">
            <Td className="sticky left-0"><TotalLabel unit={f.mx === "cost" ? "₽" : "шт."} /></Td>
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

  // Строка таблицы: уровень 0 — группа (при двух уровнях — подитог), уровень 1 — вложенная группа.
  const tableRow = (n: GroupNode, level: 0 | 1, g: GroupKey) => (
    <Tr key={n.key} className={level === 0 && f.g2 ? "bg-neutral-50/80 font-medium" : ""}>
      <Td className={level === 1 ? "pl-8 font-normal" : "font-medium"}>
        <details>
          <summary className="cursor-pointer hover:underline">
            {level === 1 && <span className="mr-1 text-neutral-500">↳</span>}
            {g === "model" && n.rows[0] ? <span title={n.rows[0].modelHint}>{n.rows[0].modelLabel}</span> : n.label}
            {g === "category" && n.label === UNDEFINED_CATEGORY && <span className="ml-1 text-xs font-normal text-amber-700">(модели без названия категории — список ниже)</span>}
          </summary>
          {orderList(n.rows)}
          {level === 0 && filterLink(n, g)}
        </details>
      </Td>
      {cols.map((c) => (
        <Td key={c} className="text-right tabular-nums">
          <MetricCell col={c} m={n.m} total={total} />
        </Td>
      ))}
    </Tr>
  );

  // Поля карточки на телефоне: первые 4 выбранные колонки (кроме «ТЗ» и «Доли»), остальные — в «Подробнее».
  const cardCols = cols.filter((c) => c !== "orders" && c !== "share");
  const card = (n: GroupNode, level: 0 | 1, g: GroupKey) => (
    <RowCard
      key={n.key}
      className={level === 1 ? "ml-4" : ""}
      title={n.label}
      subtitle={level === 1 ? `в «${n.key.split("\u0000")[0]}»` : undefined}
      fields={cardCols.slice(0, 4).map((c) => ({ label: colLabel(c, c4), value: <MetricCell col={c} m={n.m} total={total} />, strong: c === "units" }))}
      details={[
        { label: "ТЗ", value: n.m.orders },
        { label: "Доля", value: <MetricCell col="share" m={n.m} total={total} /> },
        ...cardCols.slice(4).map((c) => ({ label: colLabel(c, c4), value: <MetricCell col={c} m={n.m} total={total} /> })),
        { label: "Список ТЗ", value: orderList(n.rows) },
      ]}
      extra={level === 0 ? filterLink(n, g) : undefined}
    />
  );

  const mobileSortItems = [
    { key: "label", label: GROUPS[f.g], href: thHref("label") },
    ...cols.map((c) => ({ key: c, label: colLabel(c, c4), href: thHref(c) })),
  ];

  const presetFurCat = f.g === "fur" && f.g2 === "category";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Что произведено</h1><YearNote year={year} />
          <Mode4Badge mode={c4Mode} />
          <InfoHint label="О странице" wide>
            <p>Какие ТЗ сделаны и во что они обошлись: по категориям, видам меха, размерам, моделям (артикулам), партиям, годам, цветам и по каждому ТЗ. Одна строка источника = одно ТЗ (отменённые не считаются).</p>
            <p className="mt-1">
              <b>Себестоимость</b> = сырьё + подкладка (по лотам) + расходы ТЗ; в режиме «С 4%» к сырью и подкладке добавляется 4% (работа не облагается). Это та же себестоимость, что на страницах «Партии» и «Изделия». <b>Работа</b> (цена работы по ТЗ × количество) в неё не входит; <b>полная себестоимость</b> = себестоимость + работа.
            </p>
            <p className="mt-1">
              <b>Среднее — только средневзвешенное</b> (Σ сумм ÷ Σ весов): стоимость шкуры и молоток — вес в шкурах; шкуры, подкладка, работа и себестоимость на единицу — вес в единицах изделия. Знаменатель каждой колонки — только ТЗ, где данные есть; это написано в подсказке у заголовка колонки.
            </p>
            <p className="mt-1">
              <b>Молоток</b> — цена шкуры на аукционе до сборов и выделки; берётся из расчёта лота, где он записан. У лотов без молотка стоит «нет данных»: они не входят в среднее, а доля шкур с данными показана в ячейке.
            </p>
            {example && exCost && (
              <p className="mt-1">
                Пример — «{example.label}»: Σ себестоимости {formatMoney(example.m.costIncl.toFixed(2))} ÷ {formatQty(example.m.unitsCosted)} ед. = {formatMoney(exCost.incl.toFixed(2))} за единицу (с НДС{c4 ? `, ${c4.trim().replace(/[()]/g, "")}` : ""}).
              </p>
            )}
            <p className="mt-1">
              <b>Порядок и колонки.</b> Клик по заголовку колонки — сортировка (ещё клик — в обратную сторону), порядок попадает в адрес страницы. «Показать все параметры» и «Выбрать колонки» меняют набор колонок; выбор тоже в адресе. Группировка «Мех → категория» показывает подитоги по меху и категории внутри.
            </p>
            <p className="mt-1">
              <b>Категория</b> определена по названию (текст «категория» у модели, затем описание материала в ТЗ) правилом из файла <code>src/lib/product-category.ts</code>; не определилась — строка «{UNDEFINED_CATEGORY}». <b>Вид меха</b> — по сырью, списанному в ТЗ (несколько видов — «A + B»). <b>Цвет</b> — по справочнику цветов.
            </p>
            <p className="mt-1">Фурнитура в учёте не списывается (в ТЗ только мех и подкладка). «Набор размеров» — ТЗ сразу на несколько размеров: сколько единиц какого размера, в ТЗ не записано.</p>
          </InfoHint></div>
        <div className="flex flex-wrap gap-2">
          <a href={`/analytics/products/export?${exportQs}&part=groups`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            CSV: таблица
          </a>
          <a href={`/analytics/products/export?${exportQs}&part=orders`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            CSV: список ТЗ
          </a>
        </div>
      </div>

      {/* Сводка по статусам ТЗ: плитки в формате Главной */}
      <WidgetRow id="products" title="Аналитика изделий — итоги">
      <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="relative">
          <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
            <TileHead>Произведено</TileHead>
            <TileValue>{formatQty(sOwn.m.units)} шт.</TileValue>
            <TileCaption>{tzCountText(sOwn.m.orders, sOwn.m.items)} · {sAll.batches} {sAll.batches === 1 ? "партия" : "партий"} пошива{repairUnits > 0 ? ` · ремонт ${formatQty(repairUnits)} шт. отдельно` : ""}</TileCaption>
            <TileList items={[
              { k: "Сделано", v: `${formatQty(sOwnDone.m.units)} шт.`, share: sOwn.m.units ? sOwnDone.m.units / sOwn.m.units : null },
              { k: "В работе", v: `${formatQty(sOwnWork.m.units)} шт.`, share: sOwn.m.units ? sOwnWork.m.units / sOwn.m.units : null },
            ]} />
          </div>
          <div className="absolute right-3 top-3">
            <InfoHint label="Что такое «произведено»" wide align="right">
              <p><b>Произведено</b> — все ТЗ без отменённых и без ремонта: завершённые и в работе (как на Главной за {year === "all" ? "все годы" : `${year} год`}). Строки «Сделано» и «В работе» (в работе и запланированные) — разбивка по статусу ТЗ. Остальные плитки (шкуры, работа, себестоимость, молоток) считаются по всем ТЗ года, включая ремонт, как «Себестоимость» на Главной.</p>
            </InfoHint>
          </div>
        </div>
        <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
          <TileHead>Шкур</TileHead>
          <TileValue>{formatQty(sAll.m.skins)}</TileValue>
          <TileCaption>списано в ТЗ</TileCaption>
          <TileList items={[
            { k: "Сделано", v: formatQty(sDone.m.skins) },
            { k: "В работе", v: formatQty(sWork.m.skins) },
          ]} />
        </div>
        <div className="relative">
          <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
            <TileHead>Работа</TileHead>
            <TileValue>{formatMoney(sAll.m.work.toFixed(2))}</TileValue>
            <TileCaption>цена работы по ТЗ × количество</TileCaption>
            <TileList items={[
              { k: "Сделано", v: formatMoney(sDone.m.work.toFixed(2)), share: sAll.m.work ? sDone.m.work / sAll.m.work : null },
              { k: "В работе", v: formatMoney(sWork.m.work.toFixed(2)), share: sAll.m.work ? sWork.m.work / sAll.m.work : null },
            ]} />
          </div>
          <div className="absolute right-3 top-3">
            <InfoHint label="Что такое работа" align="right">Цена работы по ТЗ × количество (как в «Партиях» и на Главной). В себестоимость на этой странице не входит.</InfoHint>
          </div>
        </div>
        <div className="relative">
          <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
            <TileHead>Себестоимость{c4}</TileHead>
            <TileValue><Money incl={sAll.m.costIncl} excl={sAll.m.costExcl} /></TileValue>
            <TileCaption>сырьё + подкладка + расходы ТЗ{c4Mode === "on" ? " + 4%" : ""}, без работы</TileCaption>
            <TileList items={[
              { k: "Сделано", v: <Money incl={sDone.m.costIncl} excl={sDone.m.costExcl} /> },
              { k: "В работе", v: <Money incl={sWork.m.costIncl} excl={sWork.m.costExcl} /> },
            ]} />
          </div>
          <div className="absolute right-3 top-3">
            <InfoHint label="Что в сумме" wide align="right">
              Сумма по ТЗ, у которых себестоимость известна (больше 0): сырьё и подкладка + расходы ТЗ{c4Mode === "on" ? " + 4%" : ""}. У ТЗ «в работе» часто ещё нет списаний — они в сумму не попадают (см. «Качество данных»). Работа в эту плитку не входит — она отдельной плиткой рядом (на Главной «Себестоимость» считается вместе с работой).
            </InfoHint>
          </div>
        </div>
        <div className="relative">
          <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
            <TileHead>Молоток, ср. за шкуру</TileHead>
            <TileValue>{sAll.d.hammerPerSkin ? <Money incl={sAll.d.hammerPerSkin.incl} excl={sAll.d.hammerPerSkin.excl} /> : <span className="text-neutral-500">нет данных</span>}</TileValue>
            <TileCaption>{sAll.d.hammerPerSkin ? `по шкурам с данными: ${pct0(sAll.d.hammerSkinShare ?? 0)}` : "у лотов нет молотка"}</TileCaption>
            <TileList items={[
              { k: "Сделано", v: sDone.d.hammerPerSkin ? <Money incl={sDone.d.hammerPerSkin.incl} excl={sDone.d.hammerPerSkin.excl} /> : "—" },
              { k: "В работе", v: sWork.d.hammerPerSkin ? <Money incl={sWork.d.hammerPerSkin.incl} excl={sWork.d.hammerPerSkin.excl} /> : "—" },
            ]} />
          </div>
          <div className="absolute right-3 top-3">
            <InfoHint label="Молоток в сводке" wide align="right">Средневзвешенно по шкурам с данными (Σ молотка ÷ Σ шкур). Остальные лоты в среднее не входят: доля шкур с данными — под цифрой.</InfoHint>
          </div>
        </div>
      </div>
      </WidgetRow>

      {/* Фильтры: группировка и статус — параметры вида (применяются сразу, фильтрами не считаются) */}
      <AnalyticsFilterBar
        opts={opts}
        aucOf={aucOf}
        lead={[
          { type: "multi", name: "g", label: "Группировать по", single: true, state: true, allLabel: GROUPS.category, options: GROUP_KEYS.filter((k) => k !== "category").map((k) => ({ value: k, label: GROUPS[k] })) },
          { type: "multi", name: "g2", label: "Внутри", single: true, state: true, allLabel: "Без второго уровня", options: GROUP_KEYS.filter((k) => k !== f.g).map((k) => ({ value: k, label: GROUPS[k] })) },
          { type: "multi", name: "st", label: "ТЗ", single: true, state: true, allLabel: STATUS_LABEL.done, options: (["work", "all"] as const).map((k) => ({ value: k, label: STATUS_LABEL[k] })) },
        ]}
      />

      {/* Вид таблицы */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-neutral-500">
          Группировка: <b className="text-neutral-800">{GROUPS[f.g]}{f.g2 ? ` → ${GROUPS[f.g2]}` : ""}</b> · {STATUS_LABEL[f.st]} · ТЗ: {total.orders}{itemsSuffix(total.orders, total.items)} · единиц: {formatQty(total.units)}
          {total.units === 0 && <span className="ml-2 text-neutral-500">нет данных за выбранный год и фильтры</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={presetFurCat ? href({ g: "category", g2: "" }) : href({ g: "fur", g2: "category" })}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50 max-md:min-h-9 max-md:inline-flex max-md:items-center"
          >
            {presetFurCat ? "Убрать «Мех → категория»" : "Мех → категория"}
          </Link>
          <ViewBar all={f.all} picked={f.cols.length > 0} cols={cols} toggleAllHref={toggleAll} action="/analytics/products" hidden={pickerHidden} />
          <MobileSort items={mobileSortItems} cur={sortState} />
        </div>
      </div>

      <ResponsiveRows
        table={
          <Table>
            <Thead>
              <Tr>
                <SortTh left label={GROUPS[f.g]} href={thHref("label")} active={sortState.sort === "label"} dir={sortState.dir} />
                {cols.map((c) => (
                  <SortTh key={c} label={colLabel(c, c4)} hint={COLUMNS[c].hint} href={thHref(c)} active={sortState.sort === c} dir={sortState.dir} />
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {nodes.map((n) => (
                <FragmentRows key={n.key}>
                  {tableRow(n, 0, f.g)}
                  {n.children.map((c) => tableRow(c, 1, f.g2 as GroupKey))}
                </FragmentRows>
              ))}
              {nodes.length > 0 && (
                <Tr className="row-total">
                  <Td><TotalLabel /></Td>
                  {cols.map((c) => (
                    <Td key={c} className="text-right tabular-nums">
                      {c === "share" ? "100,0%" : <MetricCell col={c} m={total} total={total} />}
                    </Td>
                  ))}
                </Tr>
              )}
              {nodes.length === 0 && (
                <Tr>
                  <Td colSpan={cols.length + 1} className="py-8 text-center text-neutral-500">
                    {year !== "all" ? `За ${year} год ТЗ по этим условиям нет` : "ТЗ по этим условиям нет"}
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        }
      >
        {nodes.flatMap((n) => [card(n, 0, f.g), ...n.children.map((c) => card(c, 1, f.g2 as GroupKey))])}
        {nodes.length > 0 && (
          <RowCard
            title="Всего, ₽"
            fields={cardCols.slice(0, 4).map((c) => ({ label: colLabel(c, c4), value: <MetricCell col={c} m={total} total={total} />, strong: c === "units" }))}
            details={cardCols.slice(4).map((c) => ({ label: colLabel(c, c4), value: <MetricCell col={c} m={total} total={total} /> }))}
            className="bg-neutral-50"
          />
        )}
        {nodes.length === 0 && <p className="py-8 text-center text-neutral-500">ТЗ по этим условиям нет</p>}
      </ResponsiveRows>

      {/* Матрицы */}
      <details className="rounded-lg border border-neutral-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-medium text-neutral-700">Матрицы «категория × мех» и «категория × размер»</summary>
      <div className="mt-3 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          Матрицы
          <InfoHint label="О матрицах" wide>
            Тепловые таблицы по тем же ТЗ, что и таблица выше (с учётом фильтров): число единиц или Σ себестоимости на пересечении «категория × мех» и «категория × размер». Чем темнее ячейка, тем больше. Наведите на ячейку — число ТЗ.
          </InfoHint>
        </h2>
        <div className="flex gap-1 text-sm">
          <Link href={href({ mx: "units" })} className={f.mx === "units" ? "rounded-md bg-neutral-900 px-3 py-1 text-white" : "rounded-md px-3 py-1 hover:bg-neutral-100"}>
            Единицы
          </Link>
          <Link href={href({ mx: "cost" })} className={f.mx === "cost" ? "rounded-md bg-neutral-900 px-3 py-1 text-white" : "rounded-md px-3 py-1 hover:bg-neutral-100"}>
            Себестоимость{c4}
          </Link>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">Нет данных для матриц.</p>
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
      </div>
      </details>

      {/* Качество данных */}
      <details className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
        <summary className="cursor-pointer text-base font-semibold">
          Качество данных
        </summary>
        <p className="mt-2 text-xs text-neutral-500">Проверки по всем ТЗ выбранного года (без фильтров таблицы). Данные не правятся — только показано, где неполно.</p>
        <ul className="flex flex-col mt-2 gap-2">
          <li>
            Молоток записан у <b>{sAll.m.lotsHammer}</b> из <b>{sAll.m.lots}</b> лотов меха, использованных в ТЗ ({sAll.d.hammerSkinShare != null ? pct0(sAll.d.hammerSkinShare) : "—"} шкур). ТЗ, где молоток известен не для всех шкур: <b>{partHammer.length}</b>
            {partHammer.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-neutral-600">Показать ТЗ (в среднее молотка идут только шкуры с данными)</summary>
                <div className="mt-1 text-xs">{linkList(partHammer)}</div>
              </details>
            )}
          </li>
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
                          {rs[0].modelLabel}
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
            Как определена категория: {Object.values(SOURCE_LABEL).slice(0, 3).join("; ")}. У {all.filter((r) => r.categorySource === "description").length} ТЗ — по описанию материала в ТЗ. Подкладка на единицу: {q2(sAll.d.liningPerUnit)} м (по ТЗ с подкладкой).
          </li>
        </ul>
        <div className="mt-3 text-xs text-neutral-500">
          Цены, наценки и карточки артикулов — на вкладке{" "}
          <Link href="/analytics/pricing" className="underline underline-offset-2">
            «Цены»
          </Link>
          .
        </div>
      </details>
    </div>
  );
}

/** Несколько строк таблицы под одним ключом (без лишней обёртки в разметке). */
function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
