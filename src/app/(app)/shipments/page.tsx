import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { escapeLike } from "@/lib/input";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { ProductionTabs } from "@/components/production-tabs";
import { formatDate, formatQty } from "@/lib/utils";
import { Dash } from "@/components/tree-table";
import { TotalLabel } from "@/components/total-label";
import { SummaryTiles } from "../production/summary-tiles";
import { summarizeLines, isoDay, todayIso } from "@/lib/shipments";
import type { Prisma } from "@prisma/client";
import { getYearFilter, yearRange } from "@/lib/year-filter";
import { YearNote, emptyForYear } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { FilterBar } from "@/components/filters/filter-bar";
import { dateRange, defineFilters, parseFilters, pick, yearOptionsFrom, yearRanges } from "@/lib/filters";
import { LENGTH_OPTIONS, lengthWhere } from "@/lib/length-class";

export const metadata = { title: "Отгрузки" };

const SHIPMENT_FILTERS = defineFilters({
  ...pick(["q", "year", "from", "to", "model", "len"], {
    model: { label: "Артикул" },
    from: { label: "Плановая дата с" },
    to: { label: "Плановая дата по" },
    q: { label: "Поиск" },
  }),
});

export default async function ShipmentsPage({ searchParams }: PageProps<"/shipments">) {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const canEdit = ["OWNER", "ADMIN", "TECHNOLOGIST"].includes(session.user.role);
  const sp = await searchParams;
  const f = parseFilters(SHIPMENT_FILTERS, sp);
  const year = await getYearFilter();
  const period = dateRange(f.from, f.to);

  const where: Prisma.ShipmentWhereInput = {
    organizationId: orgId,
    AND: [
      // Общий год — по плановой дате отгрузки; «Год» и период панели сужают внутри него.
      ...(yearRange(year) ? [{ plannedDate: yearRange(year) }] : []),
      ...(f.year.length ? [{ OR: yearRanges(f.year).map((r) => ({ plannedDate: r })) }] : []),
      ...(period ? [{ plannedDate: period }] : []),
      ...(f.q
        ? [{ OR: [
            { notes: { contains: escapeLike(f.q), mode: "insensitive" as const } },
            { client: { name: { contains: escapeLike(f.q), mode: "insensitive" as const } } },
            { lines: { some: { productionOrder: { OR: [{ workOrderNumber: { contains: escapeLike(f.q), mode: "insensitive" as const } }, { number: { contains: escapeLike(f.q), mode: "insensitive" as const } }] } } } },
          ] }]
        : []),
    ],
    ...(f.model.length ? { lines: { some: { productionOrder: { productModelId: { in: f.model } } } } } : {}),
    ...(f.len.length ? { lines: { some: { productionOrder: { productModel: lengthWhere(f.len) ?? {} } } } } : {}),
  };
  const include = {
    client: { select: { name: true } },
    lines: {
      select: { size: true, quantity: true, productionOrder: { select: { workOrderNumber: true, number: true } } },
      orderBy: { id: "asc" as const },
    },
  };

  const today = todayIso();
  const weekEnd = new Date(today);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  const weekEndIso = isoDay(weekEnd);

  const [shipments, upcoming, allDates, articleOpts] = await Promise.all([
    prisma.shipment.findMany({ where, include }),
    prisma.shipment.findMany({
      where: {
        organizationId: orgId,
        status: "PLANNED",
        plannedDate: { gte: new Date(today), lte: new Date(weekEndIso) },
      },
      select: { lines: { select: { quantity: true } } },
    }),
    prisma.shipment.findMany({ where: { organizationId: orgId }, select: { plannedDate: true } }),
    prisma.productModel.findMany({ where: { organizationId: orgId, productionOrders: { some: { shipmentLines: { some: {} } } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const upcomingQty = upcoming.reduce((s, sh) => s + sh.lines.reduce((a, l) => a + l.quantity, 0), 0);

  // Ближайшие плановые сверху: сначала запланированные по возрастанию даты,
  // затем отгруженные и отменённые — свежие сверху.
  const rank = (s: string) => (s === "PLANNED" ? 0 : 1);
  const rows = [...shipments].sort((a, b) => {
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
    const d = a.plannedDate.getTime() - b.plannedDate.getTime();
    return rank(a.status) === 0 ? d : -d;
  });
  const qtyOf = (sh: (typeof rows)[number]) => sh.lines.reduce((a, l) => a + l.quantity, 0);
  const planned = rows.filter((r) => r.status === "PLANNED");
  const shipped = rows.filter((r) => r.status === "SHIPPED");
  const plannedQty = planned.reduce((a, r) => a + qtyOf(r), 0);
  const shippedQty = shipped.reduce((a, r) => a + qtyOf(r), 0);
  const plannedCount = planned.length;
  const shippedCount = shipped.length;
  const overdueCount = planned.filter((r) => isoDay(r.plannedDate) < today).length;
  const totalQty = rows.reduce((a, r) => a + qtyOf(r), 0);
  const hasFilters = Boolean(f.year.length || f.q || f.from || f.to || f.model.length || f.len.length);
  const isEmpty = rows.length === 0 && !hasFilters && year === "all";

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "ТЗ", href: "/production" }, { label: "Отгрузки" }]} />
      <ProductionTabs active="shipments" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Отгрузки</h1><YearNote year={year} />
          <InfoHint label="Об отгрузках" wide>
            <p>Отгрузка — план и факт отправки готовых изделий заказчику; склад она не списывает.</p>
            <p className="mt-1">Год ({year === "all" ? "все годы" : year}): по плановой дате отгрузки. Блок «На ближайшие 7 дней» от года не зависит.</p>
            <p className="mt-1">Стоимости здесь нет — переключатель «С 4%» на эту страницу не влияет.</p>
          </InfoHint></div>
        {canEdit && !isEmpty && (
          <Link href="/shipments/new" className={`${buttonVariants()} btn-accent`}>
            + Новая отгрузка
          </Link>
        )}
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-10 text-center text-sm text-neutral-500">
          <p>Отгрузок пока нет.</p>
          {canEdit && (
            <Link href="/shipments/new" className={`${buttonVariants()} btn-accent`}>
              + Новая отгрузка
            </Link>
          )}
        </div>
      ) : (
        <>
      <div className="print:hidden">
        <FilterBar
          title="Фильтры отгрузок"
          oneRow
          hideChips
          controls={[
            { type: "text", name: "q", label: "Поиск", placeholder: "№ ТЗ, заказчик, заметка" },
            { type: "multi", name: "model", label: "Артикул", options: articleOpts.map((m) => ({ value: m.id, label: m.name })) },
            { type: "multi", name: "len", label: "Длина", options: LENGTH_OPTIONS, allLabel: "Любая" },
            { type: "multi", name: "year", label: "Год отгрузки", options: yearOptionsFrom(allDates.map((d) => d.plannedDate)), hint: "По плановой дате; дополнительно к году в шапке" },
            { type: "date", name: "from", label: "Плановая дата с" },
            { type: "date", name: "to", label: "Плановая дата по" },
          ]}
        />
      </div>

      <SummaryTiles
        id="shipments"
        title="Отгрузки — итоги"
        linkHref="/production"
        linkLabel="→ ТЗ"
        tiles={[
          { key: "all", label: "Отгрузок", value: rows.length ? formatQty(rows.length) : <Dash />, caption: hasFilters ? "по выбранным фильтрам" : "за выбранный год" },
          { key: "planned", label: "Запланировано, шт.", value: plannedQty ? formatQty(plannedQty) : <Dash />, caption: plannedCount ? `${plannedCount} ${plural(plannedCount, "отгрузка", "отгрузки", "отгрузок")}` : undefined },
          { key: "shipped", label: "Отгружено, шт.", value: shippedQty ? formatQty(shippedQty) : <Dash />, caption: shippedCount ? `${shippedCount} ${plural(shippedCount, "отгрузка", "отгрузки", "отгрузок")}` : undefined },
          { key: "overdue", label: "Просрочено", value: overdueCount ? formatQty(overdueCount) : <Dash />, caption: overdueCount ? "плановая дата прошла" : undefined, tone: overdueCount ? "text-red-700" : undefined },
          { key: "week", label: "На ближайшие 7 дней", value: upcoming.length ? formatQty(upcoming.length) : <Dash />, caption: upcoming.length ? `${formatQty(upcomingQty)} шт.` : undefined, hint: <p>Запланированные отгрузки на ближайшие 7 дней; от года и фильтров не зависит.</p> },
        ]}
      />

      <Table stickyHeader className="min-w-[720px]">
        <Thead>
          <Tr>
            <Th>Плановая дата</Th>
            <Th>Заказчик</Th>
            <Th>ТЗ и что отгружается</Th>
            <Th className="text-right" unit="шт.">Кол-во</Th>
            <Th>Фактическая дата</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((s) => {
            const qty = s.lines.reduce((a, l) => a + l.quantity, 0);
            return (
              <Tr key={s.id}>
                <Td className="whitespace-nowrap">
                  <Link href={`/shipments/${s.id}`} className="font-medium hover:underline">
                    {formatDate(s.plannedDate)}
                  </Link>
                </Td>
                <Td>{s.client?.name ?? "—"}</Td>
                <Td>
                  {summarizeLines(s.lines).map((t) => (
                    <div key={t}>{t}</div>
                  ))}
                </Td>
                <Td className="text-right font-medium tabular-nums">{qty ? formatQty(qty) : <Dash />}</Td>
                <Td className="whitespace-nowrap">{s.shippedDate ? formatDate(s.shippedDate) : "—"}</Td>
              </Tr>
            );
          })}
          {rows.length > 0 && (
            <Tr className="row-total">
              <Td colSpan={3}><TotalLabel unit="шт." /></Td>
              <Td className="text-right tabular-nums">{formatQty(totalQty)}</Td>
              <Td />
            </Tr>
          )}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={5} className="py-8 text-center text-neutral-500">
                {hasFilters ? "Ничего не найдено" : emptyForYear(year, "отгрузок", "Отгрузок пока нет")}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
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
