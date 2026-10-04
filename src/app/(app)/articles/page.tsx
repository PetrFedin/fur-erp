import Link from "next/link";
import { cleanSearch, escapeLike } from "@/lib/input";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { Money } from "@/components/money";
import { VatLabel } from "@/components/vat-label";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix, sumUsagesWith4 } from "@/lib/commission4";
import { getYearFilter, yearRange } from "@/lib/year-filter";
import { orderYearWhere } from "@/lib/year-scope";
import { YearNote, emptyForYear } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { C4Hint, Mode4Badge } from "@/components/c4-note";
import { formatMoney } from "@/lib/utils";
import { compareModelNames, modelCodeVariants } from "@/lib/model-code";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { ArticlePriceForm } from "./price-form";
import { SHIPMENT_STATUS, summarizeLines } from "@/lib/shipments";
import { WriteOffForm } from "../finished-stock/write-off-form";

export const metadata = { title: "Изделия" };

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; empty?: string | string[] }> }) {
  const { q: rawQ, empty: rawEmpty } = await searchParams;
  const q = cleanSearch(rawQ);
  const showEmpty = cleanSearch(rawEmpty) === "1";
  const session = await requireSession();
  const c4Mode = await getCommission4Mode();
  const year = await getYearFilter();
  const c4 = c4Suffix(c4Mode);
  const canCreate = hasRole(session.user.role, ACCESS.models);
  const orgId = session.user.organizationId;
  const [stocks, shipments, warehouses] = await Promise.all([
    prisma.finishedGoodsStock.findMany({
      where: { organizationId: orgId },
      include: { warehouse: true },
    }),
    prisma.shipment.findMany({
      where: { organizationId: orgId, lines: { some: {} }, ...(yearRange(year) ? { plannedDate: yearRange(year) } : {}) },
      include: {
        lines: {
          orderBy: { id: "asc" },
          select: {
            size: true,
            quantity: true,
            productionOrder: { select: { productModelId: true, number: true, workOrderNumber: true } },
          },
        },
      },
      orderBy: { plannedDate: "desc" },
    }),
    prisma.warehouse.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } }),
  ]);
  const models = await prisma.productModel.findMany({
    where: {
      organizationId: orgId,
      ...(q ? { OR: modelCodeVariants(q).map((v) => ({ name: { contains: escapeLike(v), mode: "insensitive" as const } })) } : {}),
    },
    include: {
      _count: { select: { productionOrders: { where: orderYearWhere(year) } } },
      productionOrders: {
        // Общий год: себестоимость модели — по завершённым ТЗ выбранного года (дата ТЗ → конец → начало → год партии).
        where: { status: "COMPLETED", ...orderYearWhere(year) },
        select: {
          unitCost: true,
          producedQuantity: true,
          materialUsages: {
            select: {
              quantity: true,
              totalCost: true,
              commission4: true,
              lot: { select: { materialCostExclVat: true, expenseCostExclVat: true, unitCost: true, vatRate: true } },
            },
          },
          expenses: { select: { amount: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const rows0 = models.map((m) => {
    const totalProduced = m.productionOrders.reduce((s, o) => s.add(o.producedQuantity), new Decimal(0));
    const totalCost = m.productionOrders.reduce(
      (s, o) => s.add((o.unitCost ?? new Decimal(0)).mul(o.producedQuantity)),
      new Decimal(0)
    );
    // Excl-VAT counterpart of totalCost above, computed live from each
    // order's own materialUsages/expenses — same approach as
    // production/[id]'s estimatedUnitCostExclVat, since there is no stored
    // excl-VAT snapshot column for unitCost (see schema comment). Production
    // expenses carry no VAT at all, so they contribute the same amount to
    // both incl- and excl-VAT totals.
    // Режим «С 4%»: надбавка по сырью и подкладке каждого ТЗ (строки списаний с
    // commission4 = true); снимки unitCost хранятся «без 4%» и не меняются.
    let extra4Incl = new Decimal(0);
    let extra4Excl = new Decimal(0);
    const totalCostExclVat = m.productionOrders.reduce((s, o) => {
      const orderExpenseCost = o.expenses.reduce((es, e) => es.add(e.amount), new Decimal(0));
      const mats = sumUsagesWith4(o.materialUsages, c4Mode);
      extra4Incl = extra4Incl.add(mats.extraIncl);
      extra4Excl = extra4Excl.add(mats.extraExcl);
      return s.add(mats.excl.add(orderExpenseCost));
    }, new Decimal(0));
    // 4% «как будто включён» — для подсказки (не зависит от переключателя).
    const extraOn = m.productionOrders.reduce((s, o) => s.add(sumUsagesWith4(o.materialUsages, "on").extraIncl), new Decimal(0));
    const avgUnitCost = totalProduced.greaterThan(0) ? totalCost.add(extra4Incl).div(totalProduced).toDecimalPlaces(2) : null;
    const avgUnitCostExclVat = totalProduced.greaterThan(0) ? totalCostExclVat.div(totalProduced).toDecimalPlaces(2) : null;
    // Доля 4% в себестоимости модели: по ней пересчитывается себестоимость остатка на складе
    // (у остатка нет своей разбивки по ТЗ). Нет завершённых ТЗ — показываем «без 4%».
    const baseAvg = totalProduced.greaterThan(0) ? totalCost.div(totalProduced) : null;
    const c4Ratio = c4Mode === "on" && baseAvg && baseAvg.greaterThan(0) && avgUnitCost ? avgUnitCost.div(baseAvg) : null;
    const c4Missing = c4Mode === "on" && c4Ratio === null;
    const avgOn = baseAvg ? totalCost.add(extraOn).div(totalProduced).toDecimalPlaces(2) : null;
    const ratioOn = baseAvg && baseAvg.greaterThan(0) && avgOn ? avgOn.div(baseAvg) : null;
    const markup = m.sellingPrice && avgUnitCost && avgUnitCost.greaterThan(0) ? m.sellingPrice.div(avgUnitCost) : null;

    const modelStocks = stocks.filter((st) => st.productModelId === m.id);
    const stockQty = modelStocks.reduce((sum, st) => sum.add(st.quantity), new Decimal(0));
    // Себестоимость единицы — одно число (с одним округлением до копеек) и в таблице, и в раскрытии, и в стоимости остатка.
    const unitOf = (st: (typeof modelStocks)[number]) => avgUnitCost ?? st.avgUnitCost.mul(c4Ratio ?? 1).toDecimalPlaces(2);
    const stockValue = modelStocks.reduce((sum, st) => sum.add(st.quantity.mul(unitOf(st))), new Decimal(0));
    // Excl-VAT стоимость остатка: остаток × средневзвешенная себестоимость без НДС по
    // завершённым ТЗ модели (отдельного снимка нет). Нет данных — берём с НДС.
    // Для подсказки: стоимость остатка без 4% и с 4% (не зависит от переключателя); нет разбивки по ТЗ — 4% не посчитан.
    const stockBase = modelStocks.reduce((sum, st) => sum.add(st.quantity.mul(baseAvg ? baseAvg.toDecimalPlaces(2) : st.avgUnitCost)), new Decimal(0));
    const stockOn = modelStocks.reduce((sum, st) => sum.add(st.quantity.mul(avgOn ?? st.avgUnitCost.mul(ratioOn ?? 1).toDecimalPlaces(2))), new Decimal(0));
    const stockNoC4Data = stockQty.greaterThan(0) && ratioOn === null;
    const stockValueExclVat = avgUnitCostExclVat ? stockQty.mul(avgUnitCostExclVat) : stockValue;
    // Последние 10 отгрузок, где есть ТЗ этой модели (показываем только строки этой модели).
    const modelShipments = shipments
      .map((sh) => ({ sh, lines: sh.lines.filter((l) => l.productionOrder.productModelId === m.id) }))
      .filter((x) => x.lines.length > 0)
      .slice(0, 10);

    return {
      id: m.id,
      name: m.name,
      isActive: m.isActive,
      orderCount: m._count.productionOrders,
      modelStocks,
      stockQty,
      stockValue,
      stockValueExclVat,
      stockBase,
      stockOn,
      stockNoC4Data,
      baseAvg,
      avgOn,
      unitOf,
      modelShipments,
      totalProduced,
      avgUnitCost,
      avgUnitCostExclVat,
      c4Ratio,
      c4Missing,
      sellingPrice: m.sellingPrice,
      markup,
    };
  });

  // Строки с нулевым остатком готовой продукции скрыты по умолчанию (?empty=1 — показать).
  // При поиске по названию показываем всё найденное, чтобы нужную модель не пришлось искать по скрытым.
  // За выбранный год показываем модели, по которым в этом году были ТЗ (остаток на складе — текущий, без даты).
  const baseRows = year === "all" ? rows0.filter((r) => r.stockQty.greaterThan(0)) : rows0.filter((r) => r.orderCount > 0);
  const emptyCount = rows0.length - baseRows.length;
  const rows = (showEmpty || q ? rows0 : baseRows).sort((a, b) => {
    const wa = a.stockQty.greaterThan(0) || a.orderCount > 0 ? 0 : 1;
    const wb = b.stockQty.greaterThan(0) || b.orderCount > 0 ? 0 : 1;
    return wa - wb || compareModelNames(a.name, b.name);
  });
  const totalStockValue = rows.reduce((s, r) => s.add(r.stockValue), new Decimal(0));
  const totalStockValueExclVat = rows.reduce((s, r) => s.add(r.stockValueExclVat), new Decimal(0));
  const stockBaseTotal = rows.reduce((s, r) => s.add(r.stockBase), new Decimal(0));
  const stockOnTotal = rows.reduce((s, r) => s.add(r.stockOn), new Decimal(0));
  const noC4Models = rows.filter((r) => r.stockNoC4Data).map((r) => r.name);
  const writeOffModels = models.filter((m) => m.isActive).map((m) => ({ id: m.id, name: m.name }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">
          Изделия
          <YearNote year={year} />
          <InfoHint label="О странице «Изделия»" wide>
            <p>Модели, остаток готовой продукции на складах, средневзвешенная себестоимость единицы, розничная цена и наценка.</p>
            <p className="mt-1">
              <b>Год ({year === "all" ? "все годы" : year}):</b> себестоимость, число ТЗ и состав списка берутся по ТЗ выбранного года (дата ТЗ, иначе окончание или начало, иначе год партии). Остаток на складе — текущий, у него нет даты, поэтому от года не зависит. Отгрузки в раскрытии — по плановой/фактической дате.
            </p>
            <p className="mt-1">
              <b>Себестоимость единицы</b> = Σ(себестоимость ТЗ × выпуск) ÷ Σ выпуск по завершённым ТЗ модели — взвешено по количеству.
            </p>
            <p className="mt-1">
              <b>Наценка</b> = розничная цена ÷ средневзвешенная себестоимость единицы.
            </p>
            <p className="mt-1">«С 4%» добавляет 4% к сырью и подкладке каждого ТЗ (кроме ТЗ без 4%, например партия 6); работа не облагается.</p>
            {canCreate && <p className="mt-1">Розничную цену можно ввести прямо в таблице: Enter или переход в другое поле сохраняет её.</p>}
          </InfoHint>
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-neutral-500">
            <VatLabel base="Стоимость остатков (по себестоимости)" />
            <Mode4Badge mode={c4Mode} />:{" "}
            <span className="font-semibold text-neutral-900">
              <Money incl={totalStockValue} excl={totalStockValueExclVat} />
            </span>
            <C4Hint
              mode={c4Mode}
              base={stockBaseTotal.toFixed(2)}
              extra={stockOnTotal.sub(stockBaseTotal).toFixed(2)}
              total={totalStockValue.toFixed(2)}
              formula={
                <>
                  Остаток по себестоимости без 4%: {formatMoney(stockBaseTotal.toFixed(2))}; надбавка 4% на сырьё и подкладку: <b>{formatMoney(stockOnTotal.sub(stockBaseTotal).toFixed(2))}</b>
                  {c4Mode === "on" ? " — уже включена." : " — добавится в режиме «С 4%»."}
                </>
              }
              title="Стоимость остатков и 4%"
              align="right"
            >
              <p className="mt-1">
                Остаток каждой модели × средневзвешенная себестоимость единицы (по завершённым ТЗ выбранного года). С 4%: {formatMoney(stockOnTotal.toFixed(2))}.
              </p>
              {noC4Models.length > 0 && (
                <p className="mt-1 font-medium text-amber-700">
                  Нет данных для 4% (нет завершённых ТЗ с разбивкой по сырью): {noC4Models.join(", ")} — по ним показано без 4%.
                </p>
              )}
            </C4Hint>
          </span>
          <Link href="/analytics/products" className={buttonVariants({ variant: "outline" })} title="Что произведено, из чего складывается себестоимость, наценки и рекомендуемые цены">
            Аналитика изделий и цены
          </Link>
          {canCreate && (
            <Link href="/models/new" className={buttonVariants()}>
              + Новая модель
            </Link>
          )}
        </div>
      </div>

      <form method="get" className="flex items-center gap-2">
        <Input name="q" defaultValue={q} placeholder="Поиск по названию модели" className="h-9 w-72" />
        <Button type="submit" variant="outline" size="sm">
          Найти
        </Button>
        {showEmpty && <input type="hidden" name="empty" value="1" />}
        {q && (
          <Link href={showEmpty ? "/articles?empty=1" : "/articles"} className="text-sm text-neutral-500 hover:underline">
            Сбросить
          </Link>
        )}
      </form>

      {!q && emptyCount > 0 && (
        <p className="text-sm text-neutral-500">
          {showEmpty ? (
            <>
              Показаны и модели с нулевым остатком.{" "}
              <Link href="/articles" className="underline underline-offset-2 hover:text-neutral-800">
                Скрыть пустые ({emptyCount})
              </Link>
            </>
          ) : (
            <>
              Модели с нулевым остатком скрыты.{" "}
              <Link href="/articles?empty=1" className="underline underline-offset-2 hover:text-neutral-800">
                Показать пустые ({emptyCount})
              </Link>
            </>
          )}
        </p>
      )}

      <ResponsiveRows table={
      <Table>
        <Thead>
          <Tr>
            <Th>Модель</Th>
            <Th>Остаток готовой, шт.</Th>
            <Th>
              Ср. взвеш. себестоимость за ед.{c4}
              <InfoHint label="Как считается себестоимость единицы" wide>
                <p>Средневзвешенная себестоимость единицы по завершённым ТЗ модели: Σ(себестоимость ТЗ × выпуск) ÷ Σ выпуск — взвешено по количеству.</p>
                <p className="mt-1">В режиме «С 4%» надбавка 4% только на сырьё и подкладку; у ТЗ без 4% (партия 6 и др.) не добавляется.</p>
                <p className="mt-1">В раскрытии строки модели — пример: себестоимость без 4% и с 4% по этой модели.</p>
              </InfoHint>
            </Th>
            <Th>Розничная цена</Th>
            <Th>
              Наценка
              <InfoHint label="Как считается наценка">Наценка = розничная цена ÷ средневзвешенная (по количеству) себестоимость единицы по завершённым ТЗ. Пример: цена 10 000 ₽ при себестоимости 4 000 ₽ — ×2,50.</InfoHint>
            </Th>
            <Th>ТЗ</Th>
            <Th></Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((r) => (
            <Tr key={r.id} className={r.isActive ? "" : "opacity-60"}>
              <Td className="font-medium">
                <details>
                  <summary className="cursor-pointer hover:underline">{r.name}</summary>
                  <div className="mt-2 flex flex-col gap-2 text-xs font-normal text-neutral-600">
                    {r.modelStocks.length === 0 ? (
                      <div>Остаток на складе: 0</div>
                    ) : (
                      r.modelStocks.map((st) => (
                        <div key={st.id}>
                          {st.warehouse.name}: {formatQty(st.quantity.toString())} шт., себестоимость{" "}
                          <Money incl={r.unitOf(st)} excl={r.avgUnitCostExclVat ?? st.avgUnitCost} />, стоимость остатка{" "}
                          <Money
                            incl={st.quantity.mul(r.unitOf(st))}
                            excl={st.quantity.mul(r.avgUnitCostExclVat ?? st.avgUnitCost)}
                          />
                          {r.c4Missing && (
                            <span className="ml-1 text-neutral-400" title="Нет завершённых ТЗ с разбивкой по сырью — 4% не посчитан">
                              (без 4%)
                            </span>
                          )}
                        </div>
                      ))
                    )}
                    {r.baseAvg && r.avgOn && (
                      <div>
                        Себестоимость за ед.: без 4% {formatMoney(r.baseAvg.toFixed(2))}; 4% = {formatMoney(r.avgOn.sub(r.baseAvg).toFixed(2))} (сырьё и подкладка × 4%); с 4% {formatMoney(r.avgOn.toFixed(2))}.
                      </div>
                    )}
                    {c4Mode === "on" && r.c4Missing && <div className="text-amber-700">Нет данных: нет завершённых ТЗ с разбивкой по сырью — 4% не посчитан.</div>}
                    <div className="font-medium text-neutral-700">Отгрузки по модели</div>
                    {r.modelShipments.length === 0 ? (
                      <div>Отгрузок пока нет</div>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {r.modelShipments.map(({ sh, lines }) => (
                          <li key={sh.id}>
                            <Link href={`/shipments/${sh.id}`} className="hover:underline">
                              {sh.status === "SHIPPED" && sh.shippedDate
                                ? `отгружена ${formatDate(sh.shippedDate)}`
                                : `план ${formatDate(sh.plannedDate)}`}
                            </Link>{" "}
                            · {summarizeLines(lines).join("; ")} · {SHIPMENT_STATUS[sh.status].label}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </details>
              </Td>
              <Td>{formatQty(r.stockQty.toString())}</Td>
              <Td>
                {r.avgUnitCost ? (
                  <abbr title="ср. взвеш.: взвешено по количеству выпущенных изделий" className="cursor-help no-underline">
                    <Money incl={r.avgUnitCost} excl={r.avgUnitCostExclVat} />
                  </abbr>
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                <ArticlePriceForm modelId={r.id} sellingPrice={r.sellingPrice?.toString() ?? ""} canEdit={canCreate} />
              </Td>
              <Td className="font-medium">{r.markup ? `×${r.markup.toFixed(2)}` : "—"}</Td>
              <Td>
                {r.orderCount > 0 ? (
                  <Link href={`/production?model=${r.id}`} className="hover:underline" title="ТЗ этой модели">
                    {r.orderCount}
                  </Link>
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                <Link href={`/models/${r.id}`} className="whitespace-nowrap text-neutral-600 hover:underline">
                  Состав →
                </Link>
              </Td>
            </Tr>
          ))}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={7} className="py-8 text-center text-neutral-400">
                {q ? "Ничего не найдено" : year !== "all" ? emptyForYear(year, "ТЗ по моделям", "") : emptyCount > 0 ? "Нет моделей с ненулевым остатком" : "Моделей пока нет"}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
      }>
        {rows.map((r) => (
          <RowCard
            key={r.id}
            className={r.isActive ? "" : "opacity-60"}
            title={r.name}
            href={`/models/${r.id}`}
            fields={[
              { label: "Остаток, шт.", value: formatQty(r.stockQty.toString()), strong: true },
              { label: `Себестоимость за ед.${c4}`, value: r.avgUnitCost ? <Money incl={r.avgUnitCost} excl={r.avgUnitCostExclVat} /> : "—" },
              { label: "Наценка", value: r.markup ? `×${r.markup.toFixed(2)}` : "—" },
              {
                label: "ТЗ",
                value: r.orderCount > 0 ? <Link href={`/production?model=${r.id}`} className="underline">{r.orderCount}</Link> : "—",
              },
            ]}
            extra={
              <div>
                <div className="mb-1 text-xs text-neutral-500">Розничная цена</div>
                <ArticlePriceForm mobile modelId={r.id} sellingPrice={r.sellingPrice?.toString() ?? ""} canEdit={canCreate} />
              </div>
            }
            details={[
              {
                label: "Склады",
                value:
                  r.modelStocks.length === 0
                    ? "Остаток на складе: 0"
                    : r.modelStocks.map((st) => (
                        <div key={st.id}>
                          {st.warehouse.name}: {formatQty(st.quantity.toString())} шт.
                        </div>
                      )),
              },
              {
                label: "Отгрузки по модели",
                value:
                  r.modelShipments.length === 0
                    ? "Отгрузок пока нет"
                    : r.modelShipments.map(({ sh, lines }) => (
                        <div key={sh.id}>
                          <Link href={`/shipments/${sh.id}`} className="underline">
                            {sh.status === "SHIPPED" && sh.shippedDate ? `отгружена ${formatDate(sh.shippedDate)}` : `план ${formatDate(sh.plannedDate)}`}
                          </Link>{" "}
                          · {summarizeLines(lines).join("; ")} · {SHIPMENT_STATUS[sh.status].label}
                        </div>
                      )),
              },
            ]}
          />
        ))}
        {rows.length === 0 && (
          <p className="py-8 text-center text-neutral-400">
            {q ? "Ничего не найдено" : year !== "all" ? emptyForYear(year, "ТЗ по моделям", "") : emptyCount > 0 ? "Нет моделей с ненулевым остатком" : "Моделей пока нет"}
          </p>
        )}
      </ResponsiveRows>

      <details className="rounded-lg border border-neutral-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-medium">Списать готовую продукцию со склада</summary>
        <div className="mt-3">
          <WriteOffForm models={writeOffModels} warehouses={warehouses} />
        </div>
      </details>
    </div>
  );
}
