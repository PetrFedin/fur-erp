import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { escapeLike } from "@/lib/input";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatDate, formatQty, formatShare } from "@/lib/utils";
import { Dash } from "@/components/tree-table";
import { TotalLabel } from "@/components/total-label";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { SummaryTiles } from "../production/summary-tiles";
import type { Prisma } from "@prisma/client";
import { getYearFilter, yearRange } from "@/lib/year-filter";
import { YearNote, emptyForYear } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { FilterBar } from "@/components/filters/filter-bar";
import { dateRange, defineFilters, parseFilters, pick, yearOptionsFrom, yearRanges, type FilterOption } from "@/lib/filters";
import { compareEvents, fmtWall, shareOf, shipmentTotals } from "@/lib/shipment-calc";
import { nextShipmentName } from "@/lib/shipment-data";
import { readSort, sortRows, thSort } from "@/lib/table-sort";
import { CreateShipmentButton } from "./create-shipment";

export const metadata = { title: "Отгрузки" };

const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"];

const SHIPMENT_FILTERS = defineFilters({
  ...pick(["q", "supplier", "batch", "year", "from", "to", "model"], {
    q: { label: "Поиск" },
    supplier: { label: "Поставщик" },
    batch: { label: "Партия пошива" },
    model: { label: "Артикул" },
    from: { label: "Плановая дата с" },
    to: { label: "Плановая дата по" },
  }),
  stage: { kind: "multi", label: "Этап", maxLen: 200 },
});

export default async function ShipmentsPage({ searchParams }: PageProps<"/shipments">) {
  const session = await requireSession({ allowSupplier: true });
  const orgId = session.user.organizationId;
  const canEdit = EDIT_ROLES.includes(session.user.role);
  // Внешний поставщик видит только свои отгрузки.
  const isSupplier = session.user.role === "SUPPLIER";
  const shipScope = { organizationId: orgId, ...(isSupplier ? { supplierId: session.user.supplierId ?? "-" } : {}) };
  const sp = await searchParams;
  const f = parseFilters(SHIPMENT_FILTERS, sp);
  const year = await getYearFilter();
  const period = dateRange(f.from, f.to);
  const like = (v: string) => ({ contains: escapeLike(v), mode: "insensitive" as const });

  const where: Prisma.ShipmentWhereInput = {
    ...shipScope,
    AND: [
      // Общий год — по плановой дате отгрузки; «Год» и период панели сужают внутри него.
      ...(yearRange(year) ? [{ plannedDate: yearRange(year) }] : []),
      ...(f.year.length ? [{ OR: yearRanges(f.year).map((r) => ({ plannedDate: r })) }] : []),
      ...(period ? [{ plannedDate: period }] : []),
      ...(f.supplier.length ? [{ supplierId: { in: f.supplier } }] : []),
      ...(f.batch.length ? [{ batch: { number: { in: f.batch.map(Number) } } }] : []),
      ...(f.stage.length ? [{ events: { some: { title: { in: f.stage } } } }] : []),
      ...(f.model.length ? [{ lines: { some: { productionOrder: { productModelId: { in: f.model } } } } }] : []),
      ...(f.q
        ? [{
            OR: [
              { name: like(f.q) },
              ...(isSupplier ? [] : [{ notes: like(f.q) }]),
              { supplier: { name: like(f.q) } },
              { lines: { some: { OR: [
                { color: like(f.q) },
                { customArticle: like(f.q) },
                { productionOrder: { OR: [{ workOrderNumber: like(f.q) }, { number: like(f.q) }, { productModel: { name: like(f.q) } }] } },
              ] } } },
            ],
          }]
        : []),
    ],
  };

  const [shipments, allDates, suppliers, batches, titles, articleOpts] = await Promise.all([
    prisma.shipment.findMany({
      where,
      include: {
        supplier: { select: { name: true } },
        batch: { select: { number: true } },
        lines: { select: { id: true, quantity: true, acceptedQty: true, returnedQty: true, stage: true } },
        events: {
          select: {
            id: true, title: true, occurredAt: true, timeKnown: true, expected: true, createdAt: true, responsibleName: true,
            responsibleUser: { select: { name: true } },
          },
        },
      },
      orderBy: [{ plannedDate: "desc" }, { createdAt: "desc" }],
    }),
    prisma.shipment.findMany({ where: shipScope, select: { plannedDate: true } }),
    prisma.supplier.findMany({ where: { organizationId: orgId, isActive: true, ...(isSupplier ? { id: session.user.supplierId ?? "-" } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.productionBatch.findMany({ where: { organizationId: orgId, shipments: { some: isSupplier ? { supplierId: session.user.supplierId ?? "-" } : {} } }, select: { number: true, name: true }, orderBy: { number: "asc" } }),
    prisma.shipmentEvent.findMany({ where: { shipment: shipScope }, select: { title: true }, distinct: ["title"], orderBy: { title: "asc" } }),
    prisma.productModel.findMany({ where: { organizationId: orgId, productionOrders: { some: { shipmentLines: { some: { shipment: shipScope } } } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const rows0 = shipments.map((s) => {
    const t = shipmentTotals(s.lines.filter((l) => l.stage === "READY"));
    const all = s.lines.reduce((x, l) => x + l.quantity, 0);
    const done = s.events.filter((e) => !e.expected).sort(compareEvents);
    const last = done.length ? done[done.length - 1] : null;
    const next = s.events.filter((e) => e.expected).sort(compareEvents)[0] ?? null;
    return { s, t, all, last, next };
  });
  // Сортировка по клику на заголовок (?sort=…&dir=…); по умолчанию — по плановой дате (как в запросе).
  const sort = readSort(sp, ["name", "supplier", "batch", "date", "qty", "last", "events"]);
  const rows = sortRows(rows0, sort, {
    name: (r) => r.s.name ?? `Отгрузка на ${formatDate(r.s.plannedDate)}`,
    supplier: (r) => r.s.supplier?.name ?? null,
    batch: (r) => r.s.batch?.number ?? null,
    date: (r) => r.s.plannedDate,
    qty: (r) => r.t.inShipment,
    last: (r) => r.last?.occurredAt ?? null,
    events: (r) => r.s.events.length,
  });
  const th = (k: string) => thSort("/shipments", sp, k, sort);
  const sum = rows.reduce(
    (a, r) => ({ all: a.all + r.all, inS: a.inS + r.t.inShipment, acc: a.acc + r.t.accepted, ret: a.ret + r.t.returned, rem: a.rem + r.t.remaining }),
    { all: 0, inS: 0, acc: 0, ret: 0, rem: 0 },
  );
  const hasFilters = Boolean(f.year.length || f.q || f.from || f.to || f.model.length || f.supplier.length || f.batch.length || f.stage.length);
  const isEmpty = rows.length === 0 && !hasFilters && year === "all";

  const defaultName = canEdit ? await nextShipmentName(orgId) : "";
  const supplierOptions = suppliers.map((x) => ({ id: x.id, name: x.name }));
  const defaultSupplierId = suppliers.find((x) => x.name.toLowerCase().includes("веллмех"))?.id ?? "";
  const batchChoices = canEdit
    ? (await prisma.productionBatch.findMany({ where: { organizationId: orgId }, select: { id: true, number: true, name: true, year: true }, orderBy: { number: "desc" } })).map((b) => ({ id: b.id, label: `Партия ${b.number}${b.year ? ` · ${b.year}` : ""}${b.name ? ` · ${b.name}` : ""}` }))
    : [];

  const supplierFilter: FilterOption[] = suppliers.map((x) => ({ value: x.id, label: x.name }));
  const batchFilter: FilterOption[] = batches.map((b) => ({ value: String(b.number), label: `Партия ${b.number}${b.name && !isSupplier ? ` · ${b.name}` : ""}` }));
  const stageFilter: FilterOption[] = titles.map((t) => ({ value: t.title, label: t.title }));

  type Row = (typeof rows)[number];
  // Поставщику имена наших сотрудников не показываем.
  const respOf = (e: { responsibleName: string | null; responsibleUser: { name: string } | null } | null) => (isSupplier ? "" : e?.responsibleUser?.name ?? e?.responsibleName ?? "");
  const lastText = (r: Row) => (r.last ? [`${r.last.title} · ${fmtWall(r.last.occurredAt, r.last.timeKnown)}`, respOf(r.last)].filter(Boolean).join(" · ") : "");
  const share = (part: number, whole: number, what: string) => {
    const s = shareOf(part, whole);
    return s == null ? undefined : `${formatShare(s)} ${what}`.trim();
  };

  const createButton = canEdit ? (
    <CreateShipmentButton defaultName={defaultName} suppliers={supplierOptions} defaultSupplierId={defaultSupplierId} batches={batchChoices} />
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Отгрузки" }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">Отгрузки</h1>
          <YearNote year={year} />
          <InfoHint label="Об отгрузках" wide>
            <p>Отгрузка — карточка, в которой мы ведём путь партии изделий от поставщика до приёмки: примерка (позиции из ТЗ) и этапы по порядку, у каждого — дата, время и ответственный.</p>
            <p className="mt-1">Склад отгрузка не списывает. Год ({year === "all" ? "все годы" : year}): по плановой дате отгрузки.</p>
            <p className="mt-1">«Принято» и «Не принято» (возврат) вносятся по каждой строке: просмотр — в блоке «Примерка», приёмка в Коптево — в блоке «Приёмка в Коптево» внизу карточки, где она закрывается кнопкой «ЗАКРЫТЬ ПРИЁМКУ».</p>
          </InfoHint>
        </div>
        {createButton}
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-10 text-center text-sm text-neutral-500">
          <p>Отгрузок пока нет.</p>
          {createButton}
        </div>
      ) : (
        <>
          <div className="print:hidden">
            <FilterBar
              title="Фильтры отгрузок"
              oneRow
              hideChips
              controls={[
                { type: "text", name: "q", label: "Поиск", placeholder: "Название, № ТЗ, артикул, цвет" },
                { type: "multi", name: "supplier", label: "Поставщик", options: supplierFilter },
                { type: "multi", name: "batch", label: "Партия пошива", options: batchFilter },
                { type: "multi", name: "stage", label: "Этап", options: stageFilter, hint: "По названию этапа" },
                { type: "date", name: "from", label: "Плановая дата с" },
                { type: "date", name: "to", label: "Плановая дата по" },
                { type: "multi", name: "model", label: "Артикул", more: true, options: articleOpts.map((m) => ({ value: m.id, label: m.name })) },
                { type: "multi", name: "year", label: "Год отгрузки", more: true, options: yearOptionsFrom(allDates.map((d) => d.plannedDate)), hint: "По плановой дате; дополнительно к году в шапке" },
              ]}
            />
          </div>

          <SummaryTiles
            id="shipments"
            title="Отгрузки — итоги"
            tiles={[
              { key: "in", label: "К отгрузке, шт.", value: sum.inS ? formatQty(sum.inS) : <Dash />, caption: `${formatQty(rows.length)} ${plural(rows.length, "отгрузка", "отгрузки", "отгрузок")} · в отгрузках ${formatQty(sum.all)} шт.${hasFilters ? " · по фильтрам" : ""}` },
              { key: "acc", label: "Принято, шт.", value: sum.acc ? formatQty(sum.acc) : <Dash />, caption: share(sum.acc, sum.inS, "от «К отгрузке»"), hint: <p>Сумма колонки «Принято» в составе отгрузок.</p> },
              {
                key: "ret",
                label: "Не принято, шт.",
                value: sum.inS ? formatQty(sum.ret) : <Dash />,
                caption: sum.inS ? [share(sum.ret, sum.inS, ""), `ещё ждёт приёмки: ${formatQty(sum.rem)} шт.`].filter(Boolean).join(" · ") : undefined,
                hint: <p>Сумма колонки «Возврат» (возвращено поставщику / не принято). «Ещё ждёт приёмки» — в отгрузке минус принято и минус возврат по каждой строке.</p>,
              },
            ]}
          />

          <ResponsiveRows
            table={
              <Table stickyHeader className="min-w-[960px]">
                <Thead>
                  <Tr>
                    <Th {...th("name")}>Название</Th>
                    <Th {...th("supplier")}>Поставщик</Th>
                    <Th {...th("batch")}>Партия</Th>
                    <Th {...th("date")}>Плановая дата</Th>
                    <Th {...th("qty")} className="text-right" unit="шт.">К отгрузке · принято · не принято</Th>
                    <Th {...th("last")}>Последний этап</Th>
                    <Th {...th("events")} className="text-right">Этапов</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rows.map((r) => (
                    <Tr key={r.s.id}>
                      <Td>
                        <Link href={`/shipments/${r.s.id}`} className="font-medium hover:underline">
                          {r.s.name ?? `Отгрузка на ${formatDate(r.s.plannedDate)}`}
                        </Link>
                      </Td>
                      <Td>{r.s.supplier?.name ?? <Dash />}</Td>
                      <Td className="whitespace-nowrap">{r.s.batch ? `Партия ${r.s.batch.number}` : <Dash />}</Td>
                      <Td className="whitespace-nowrap">{formatDate(r.s.plannedDate)}</Td>
                      <Td className="whitespace-nowrap text-right tabular-nums">
                        {formatQty(r.t.inShipment)} · {formatQty(r.t.accepted)} · {formatQty(r.t.returned)}
                        {r.all !== r.t.inShipment && <span className="block text-[11px] font-normal text-neutral-500">в отгрузке всего {formatQty(r.all)}</span>}
                      </Td>
                      <Td>
                        {r.last ? (
                          <>
                            <div>{r.last.title}</div>
                            <div className="text-xs text-neutral-500">
                              {fmtWall(r.last.occurredAt, r.last.timeKnown)}
                              {respOf(r.last) ? ` · ${respOf(r.last)}` : ""}
                            </div>
                          </>
                        ) : (
                          <Dash />
                        )}
                        {r.next && <div className="text-xs text-neutral-400">далее: {r.next.title} · {fmtWall(r.next.occurredAt, r.next.timeKnown)}</div>}
                      </Td>
                      <Td className="text-right tabular-nums">{r.s.events.length || <Dash />}</Td>
                    </Tr>
                  ))}
                  {rows.length > 0 && (
                    <Tr className="row-total">
                      <Td colSpan={4}><TotalLabel unit="шт." /></Td>
                      <Td className="whitespace-nowrap text-right tabular-nums">{formatQty(sum.inS)} · {formatQty(sum.acc)} · {formatQty(sum.ret)}</Td>
                      <Td colSpan={2} />
                    </Tr>
                  )}
                  {rows.length === 0 && (
                    <Tr>
                      <Td colSpan={7} className="py-8 text-center text-neutral-500">
                        {hasFilters ? "Ничего не найдено" : emptyForYear(year, "отгрузок", "Отгрузок пока нет")}
                      </Td>
                    </Tr>
                  )}
                </Tbody>
              </Table>
            }
          >
            {rows.map((r) => (
              <RowCard
                key={r.s.id}
                title={r.s.name ?? `Отгрузка на ${formatDate(r.s.plannedDate)}`}
                href={`/shipments/${r.s.id}`}
                subtitle={[r.s.supplier?.name, r.s.batch ? `Партия ${r.s.batch.number}` : ""].filter(Boolean).join(" · ")}
                fields={[
                  { label: "Плановая дата", value: formatDate(r.s.plannedDate) },
                  { label: "Этапов", value: r.s.events.length || "—" },
                  { label: "К отгрузке, шт.", value: formatQty(r.t.inShipment), strong: true },
                  { label: "Принято / не принято", value: `${formatQty(r.t.accepted)} / ${formatQty(r.t.returned)}` },
                ]}
                details={[{ label: "Последний этап", value: lastText(r) }]}
              />
            ))}
            {rows.length === 0 && <p className="py-6 text-center text-sm text-neutral-500">{hasFilters ? "Ничего не найдено" : "Отгрузок пока нет"}</p>}
          </ResponsiveRows>
        </>
      )}
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
