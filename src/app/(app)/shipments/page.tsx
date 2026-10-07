import Link from "next/link";
import { escapeLike } from "@/lib/input";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { ProductionTabs } from "@/components/production-tabs";
import { formatDate, formatQty } from "@/lib/utils";
import { SHIPMENT_STATUS, summarizeLines, isoDay, todayIso } from "@/lib/shipments";
import type { Prisma } from "@prisma/client";
import { getYearFilter, yearRange } from "@/lib/year-filter";
import { YearNote, emptyForYear } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { FilterBar } from "@/components/filters/filter-bar";
import { dateRange, defineFilters, parseFilters, pick, yearOptionsFrom, yearRanges } from "@/lib/filters";

export const metadata = { title: "Отгрузки" };

const SHIPMENT_FILTERS = defineFilters({
  ...pick(["q", "status", "year", "from", "to"], {
    status: { allowed: Object.keys(SHIPMENT_STATUS) },
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
    ...(f.status.length ? { status: { in: f.status as Array<"PLANNED"> } } : {}),
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

  const [shipments, upcoming, allDates] = await Promise.all([
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
  const hasFilters = Boolean(f.status.length || f.year.length || f.q || f.from || f.to);
  const isEmpty = rows.length === 0 && !hasFilters && year === "all";

  return (
    <div className="flex flex-col gap-4">
      <ProductionTabs active="shipments" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">
          Отгрузки
          <YearNote year={year} />
          <InfoHint label="Об отгрузках" wide>
            <p>Отгрузка — план и факт отправки готовых изделий заказчику; склад она не списывает.</p>
            <p className="mt-1">Год ({year === "all" ? "все годы" : year}): по плановой дате отгрузки. Блок «На ближайшие 7 дней» от года не зависит.</p>
            <p className="mt-1">Стоимости здесь нет — переключатель «С 4%» на эту страницу не влияет.</p>
          </InfoHint>
        </h1>
        {canEdit && !isEmpty && (
          <Link href="/shipments/new" className={buttonVariants({ size: "lg" })}>
            + Новая отгрузка
          </Link>
        )}
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-10 text-center text-sm text-neutral-500">
          <p>Отгрузок пока нет.</p>
          {canEdit && (
            <Link href="/shipments/new" className={buttonVariants()}>
              + Новая отгрузка
            </Link>
          )}
        </div>
      ) : (
        <>
      <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm">
        На ближайшие 7 дней:{" "}
        <span className="font-semibold">
          {upcoming.length} {plural(upcoming.length, "отгрузка", "отгрузки", "отгрузок")}, {formatQty(upcomingQty)} шт.
        </span>
      </div>

      <FilterBar
        title="Фильтры отгрузок"
        controls={[
          { type: "text", name: "q", label: "Поиск", placeholder: "№ ТЗ, заказчик, заметка" },
          { type: "multi", name: "status", label: "Статус", options: Object.entries(SHIPMENT_STATUS).map(([k, v]) => ({ value: k, label: v.label })), allLabel: "Все статусы" },
          { type: "multi", name: "year", label: "Год отгрузки", options: yearOptionsFrom(allDates.map((d) => d.plannedDate)), hint: "По плановой дате; дополнительно к году в шапке" },
          { type: "date", name: "from", label: "Плановая дата с" },
          { type: "date", name: "to", label: "Плановая дата по" },
        ]}
      />

      <Table className="min-w-[720px]">
        <Thead>
          <Tr>
            <Th>Плановая дата</Th>
            <Th>Заказчик</Th>
            <Th>ТЗ и что отгружается</Th>
            <Th>Кол-во, шт.</Th>
            <Th>Статус</Th>
            <Th>Фактическая дата</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((s) => {
            const st = SHIPMENT_STATUS[s.status];
            const overdue = s.status === "PLANNED" && isoDay(s.plannedDate) < today;
            const qty = s.lines.reduce((a, l) => a + l.quantity, 0);
            return (
              <Tr key={s.id}>
                <Td className="whitespace-nowrap">
                  <Link href={`/shipments/${s.id}`} className="font-medium hover:underline">
                    {formatDate(s.plannedDate)}
                  </Link>
                  {overdue && <Badge variant="danger" className="ml-2">просрочена</Badge>}
                </Td>
                <Td>{s.client?.name ?? "—"}</Td>
                <Td>
                  {summarizeLines(s.lines).map((t) => (
                    <div key={t}>{t}</div>
                  ))}
                </Td>
                <Td className="font-medium">{formatQty(qty)}</Td>
                <Td>
                  <Badge variant={st.variant}>{st.label}</Badge>
                </Td>
                <Td className="whitespace-nowrap">{s.shippedDate ? formatDate(s.shippedDate) : "—"}</Td>
              </Tr>
            );
          })}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={6} className="py-8 text-center text-neutral-400">
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
