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
import { ShipmentsFeed } from "./shipments-feed";
import { ShipmentsTabs } from "./tabs";
import { loadShipmentsFeed } from "@/lib/shipments-feed";

export const metadata = { title: "Отгрузки и календарь" };

const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"];

const SHIPMENT_FILTERS = defineFilters({
  ...pick(["q", "supplier", "batch", "year", "from", "to", "model"], {
    q: { label: "Поиск" },
    supplier: { label: "Подрядчик" },
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
    return s == null || part === 0 ? undefined : `${formatShare(s)} ${what}`.trim();
  };

  const createButton = canEdit ? (
    <CreateShipmentButton defaultName={defaultName} suppliers={supplierOptions} defaultSupplierId={defaultSupplierId} batches={batchChoices} />
  ) : null;

  const feed = isSupplier ? [] : await loadShipmentsFeed(orgId);

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Отгрузки и календарь" }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">Отгрузки и календарь</h1>
          <YearNote year={year} />
          <InfoHint label="Об отгрузках" wide>
            <p>Отгрузка — карточка, в которой мы ведём путь партии изделий от поставщика до приёмки: примерка (позиции из ТЗ) и этапы по порядку, у каждого — дата, время и ответственный.</p>
            <p className="mt-1">Склад отгрузка не списывает. Год ({year === "all" ? "все годы" : year}): по плановой дате отгрузки.</p>
            <p className="mt-1">«Принято» и «Не принято» (возврат) вносятся по каждой строке: просмотр — в блоке «Примерка», приёмка в Коптево — в блоке «Приёмка в Коптево» внизу карточки, где она закрывается кнопкой «ЗАКРЫТЬ ПРИЁМКУ».</p>
          </InfoHint>
        </div>
        {createButton}
      </div>

      <ShipmentsTabs active="feed" />
      {feed.length ? <ShipmentsFeed rows={feed} /> : null}

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
