import Link from "next/link";
import { escapeLike } from "@/lib/input";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { ProductionTabs } from "@/components/production-tabs";
import { formatQty } from "@/lib/utils";
import { Money } from "@/components/money";
import { VatLabel } from "@/components/vat-label";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix, sumUsagesWith4, base4AndExtra } from "@/lib/commission4";
import { canEditProduction } from "@/lib/production-access";
import { FilterBar } from "@/components/filters/filter-bar";
import { activeCount, dateRange, defineFilters, filterHref, parseFilters, pick, splitNone, toWhere } from "@/lib/filters";
import { furMaterialIdsByKind, getFilterOptions, purchaseIdsByAuction } from "@/lib/filter-options";
import { GroupedByBatch } from "./grouped-view";
import { modelCodeVariants } from "@/lib/model-code";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { batchOrderInclude } from "@/lib/batch-stats";
import { getYearFilter } from "@/lib/year-filter";
import { orderDateOf, orderYearWhere } from "@/lib/year-scope";
import { YearNote, emptyForYear } from "@/components/year-note";
import { C4Hint, Mode4Badge } from "@/components/c4-note";
import { loadOrderIndicators } from "@/lib/production-doc-checklist";
import { DocsPayBadge } from "@/components/docs-pay-badge";
import { VerifyPill } from "@/components/verify-control";
import { loadVerifyFlags } from "@/lib/verification";
import { TzVatBadge } from "@/components/tz-vat-badge";
import { matchesVatFilter, vatBreakdown } from "@/lib/tz-vat";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "info" | "warning" | "success" | "danger" }> = {
  PLANNED: { label: "Запланирован", variant: "default" },
  IN_PROGRESS: { label: "В работе", variant: "warning" },
  COMPLETED: { label: "Завершён", variant: "success" },
  CANCELLED: { label: "Отменён", variant: "danger" },
};

const STATUS_KEYS = Object.keys(STATUS_LABELS);

const SORTS: Record<string, string> = {
  num_desc: "№ ТЗ: по убыванию",
  num_asc: "№ ТЗ: по возрастанию",
};
const DOCS_OPTIONS = [
  { value: "docs", label: "Только без документов" },
  { value: "pay", label: "Только без оплаты" },
];
const VAT_OPTIONS = [
  { value: "20", label: "Только 20%" },
  { value: "22", label: "Только 22%" },
  { value: "mixed", label: "Смешанные (20% и 22%)" },
];
const VERIFIED_OPTIONS = [
  { value: "yes", label: "Подтверждено" },
  { value: "no", label: "Ждёт проверки" },
];
const PROD_FILTERS = defineFilters({
  ...pick(["q", "status", "client", "season", "batch", "model", "category", "auction", "fur", "color", "docs", "vat", "verified", "from", "to", "sort", "view"], {
    status: { allowed: STATUS_KEYS },
    batch: { pattern: /^(\d{1,6}|none)$/ },
    docs: { allowed: ["docs", "pay"] },
    verified: { allowed: ["yes", "no"], label: "Проверка" },
    color: { label: "Цвет изделия" },
    from: { label: "Дата ТЗ с" },
    to: { label: "Дата ТЗ по" },
    sort: { allowed: Object.keys(SORTS) },
  }),
});
export const metadata = { title: "ТЗ" };

export default async function ProductionPage({ searchParams }: PageProps<"/production">) {
  const session = await requireSession();
  const c4Mode = await getCommission4Mode();
  const year = await getYearFilter();
  let c4 = c4Suffix(c4Mode);
  const orgId = session.user.organizationId;
  const sp = await searchParams;
  const f = parseFilters(PROD_FILTERS, sp);
  const q = f.q;
  const sort = f.sort;
  const grouped = f.view === "batches";
  const filtersOn = activeCount(PROD_FILTERS, f) > 0;
  // Фильтр «Ставка НДС» по лотам в списаниях ТЗ: 20 / 22 / смешанные.
  const vatKinds = f.vat.map((v) => (v === "mix" ? "mixed" : v));
  // Сколько строк рисуем (итог внизу считается по всем ТЗ списка): в dev-режиме и на телефоне 180+ строк — это секунды.
  const PAGE_SIZE = 50;
  const limitRaw = /^\d{1,5}$/.test(f.limit) ? parseInt(f.limit, 10) : PAGE_SIZE;
  const limit = Math.min(Math.max(limitRaw, PAGE_SIZE), 100000);

  // Фильтры по сырью: партия закупки (аукцион) и вид меха — через лоты в списаниях ТЗ.
  let lotOrderIds: string[] | null = null;
  if (f.auction.length || f.fur.length) {
    const [purchaseIds, materialIds] = await Promise.all([
      f.auction.length ? purchaseIdsByAuction(orgId, f.auction) : Promise.resolve(null),
      f.fur.length ? furMaterialIdsByKind(orgId, f.fur) : Promise.resolve(null),
    ]);
    const usages = await prisma.productionMaterialUsage.findMany({
      where: {
        productionOrder: { organizationId: orgId },
        lot: {
          ...(purchaseIds ? { purchaseId: { in: purchaseIds.length ? purchaseIds : ["__none"] } } : {}),
          ...(materialIds ? { rawMaterialId: { in: materialIds.length ? materialIds : ["__none"] } } : {}),
        },
      },
      select: { productionOrderId: true },
      distinct: ["productionOrderId"],
    });
    lotOrderIds = usages.map((u) => u.productionOrderId);
  }

  const where: Prisma.ProductionOrderWhereInput = {
    organizationId: orgId,
    AND: [
      // Общий год: дата ТЗ → конец/начало → год партии (см. lib/year-scope.ts).
      orderYearWhere(year),
      ...toWhere<typeof f, Prisma.ProductionOrderWhereInput>(f, {
        model: (v) => ({ productModelId: { in: v } }),
        status: (v) => ({ status: { in: v as Array<"PLANNED"> } }),
        client: (v) => {
          const { none, rest } = splitNone(v);
          return { OR: [...(rest.length ? [{ clientId: { in: rest } }] : []), ...(none ? [{ clientId: null }] : [])] };
        },
        season: (v) => {
          const { none, rest } = splitNone(v);
          return { OR: [...(rest.length ? [{ season: { code: { in: rest } } }, { seasonId: { in: rest } }] : []), ...(none ? [{ seasonId: null }] : [])] };
        },
        batch: (v) => {
          const { none, rest } = splitNone(v);
          const nums = rest.map(Number).filter((n) => Number.isInteger(n) && n > 0);
          return { OR: [...(nums.length ? [{ batch: { number: { in: nums } } }] : []), ...(none ? [{ batchId: null }] : [])] };
        },
        category: (v) => {
          const { none, rest } = splitNone(v);
          return { OR: [...(rest.length ? [{ productModel: { category: { in: rest } } }] : []), ...(none ? [{ productModel: { category: null } }] : [])] };
        },
        color: (v) => {
          const { none, rest } = splitNone(v);
          return {
            OR: [
              ...(rest.length ? [{ colorRef: { name: { in: rest } } }, { colorRefId: null, color: { in: rest } }] : []),
              ...(none ? [{ colorRefId: null, color: null }] : []),
            ],
          };
        },
        auction: () => ({ id: { in: lotOrderIds ?? [] } }),
        fur: () => ({ id: { in: lotOrderIds ?? [] } }),
        verified: (v) => (v.includes("yes") && v.includes("no") ? undefined : v.includes("yes") ? { verifiedAt: { not: null } } : v.includes("no") ? { verifiedAt: null } : undefined),
        q: (text) => ({
          OR: [
            { workOrderNumber: { contains: escapeLike(text), mode: "insensitive" } },
            { number: { contains: escapeLike(text), mode: "insensitive" } },
            ...modelCodeVariants(text).map((v) => ({ productModel: { name: { contains: escapeLike(v), mode: "insensitive" as const } } })),
            { client: { name: { contains: escapeLike(text), mode: "insensitive" } } },
          ],
        }),
      }),
    ],
  };
  const period = dateRange(f.from, f.to);

  const [rawOrders, filterModel, , batchList, groupedOrders] = await Promise.all([
    prisma.productionOrder.findMany({
      where,
      include: {
        productModel: { select: { name: true } },
        season: { select: { code: true } },
        client: { select: { name: true } },
        materialUsages: {
          select: {
            totalCost: true,
            quantity: true,
            commission4: true,
            lot: { select: { materialCostExclVat: true, expenseCostExclVat: true, unitCost: true, vatRate: true } },
          },
        },
        expenses: { select: { amount: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    f.model.length === 1 ? prisma.productModel.findFirst({ where: { id: f.model[0], organizationId: orgId } }) : null,
    Promise.resolve(null),
    prisma.productionBatch.findMany({
      where: { organizationId: orgId },
      select: { id: true, number: true, name: true, year: true },
      orderBy: { number: "asc" },
    }),
    grouped
      ? prisma.productionOrder.findMany({ where, include: batchOrderInclude, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
  ]);

  const canEdit = canEditProduction(session.user.role);
  const opts = await getFilterOptions(orgId, year, ["client", "season", "batch", "model", "category", "auction", "fur", "color"]);
  const hasFilters = filtersOn;

  // What matched the search text, so a result like "141" -> ТЗ №132 (order
  // П-2026-0141) says why it is there. Exact № ТЗ / order number come first.
  const ql = q.toLowerCase();
  const matchOf = (o: (typeof rawOrders)[number]) => {
    if (!ql) return null;
    const wo = (o.workOrderNumber ?? "").toLowerCase();
    const no = o.number.toLowerCase();
    if (wo === ql) return { rank: 0, label: null };
    if (no === ql) return { rank: 1, label: "совпал № заказа" };
    if (wo.includes(ql)) return { rank: 2, label: "совпал № ТЗ" };
    if (no.includes(ql)) return { rank: 3, label: "совпал № заказа" };
    if (modelCodeVariants(q).some((v) => o.productModel.name.toLowerCase().includes(v.toLowerCase()))) return { rank: 4, label: "совпала модель" };
    return { rank: 5, label: "совпал заказчик" };
  };
  const woNum = (o: (typeof rawOrders)[number]) => {
    const n = parseInt(o.workOrderNumber ?? "", 10);
    return Number.isNaN(n) ? null : n;
  };
  const indicators = await loadOrderIndicators(prisma, orgId, { c4Mode, canUpload: false, canMark: false });
  const vflags = await loadVerifyFlags(prisma, orgId);
  const orders = rawOrders.filter((o) => {
    if (vatKinds.length && !vatKinds.some((k) => matchesVatFilter(vatBreakdown(o.materialUsages, c4Mode).kind, k))) return false;
    if (period) {
      const d = orderDateOf(o);
      if (!d || (period.gte && d < period.gte) || (period.lte && d > period.lte)) return false;
    }
    if (f.docs.length === 0) return true;
    const ind = indicators.get(o.id);
    if (!ind) return false;
    const noDocs = ind.missing.length > 0 || ind.noDocs;
    const noPay = ind.pay.state === "UNPAID" || ind.pay.state === "PARTIAL";
    return (f.docs.includes("docs") && noDocs) || (f.docs.includes("pay") && noPay);
  });
  // 4% не применено ни к одному списанию в списке — подпись «(с 4%)» не ставим.
  if (!orders.some((o) => o.materialUsages.some((u) => u.commission4))) c4 = "";
  if (sort) {
    const dir = sort === "num_asc" ? 1 : -1;
    // ТЗ without a numeric number go last in either direction.
    orders.sort((a, b) => {
      const x = woNum(a);
      const y = woNum(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * dir;
    });
  }
  if (q) {
    const idx = new Map(orders.map((o, i) => [o.id, i]));
    orders.sort((a, b) => (matchOf(a)!.rank - matchOf(b)!.rank) || idx.get(a.id)! - idx.get(b.id)!);
  }

  // Колонку заказчика показываем только если в списке больше одного заказчика.
  const showClient = new Set(orders.map((o) => o.client?.name ?? "")).size > 1;

  let sumIncl = new Decimal(0);
  let sumExcl = new Decimal(0);
  let sumBase = new Decimal(0); // сырьё + подкладка без 4% (с НДС) по действующим ТЗ
  let sumExtra = new Decimal(0);
  let sumExcluded = new Decimal(0); // надбавка 4% по ним (в режиме «С 4%» — уже в итоге)
  let sumMatLines = 0;
  const cards: React.ReactNode[] = [];
  // Те же формулы, что в карточке ТЗ: проведённые затраты на сегодня (или зафиксированный снимок).
  // Режим «С 4%»: надбавка только к сырью/подкладке (строки списаний),
  // расходы без 4%; снимок totalCost хранится «без 4%», надбавка добавляется сверху.
  const priced = orders.map((o) => {
    const mats = sumUsagesWith4(o.materialUsages, c4Mode);
    const expSum = o.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
    const projected = mats.incl.add(expSum);
    const total = o.totalCost ? o.totalCost.add(mats.extraIncl) : projected;
    // Excl-VAT counterpart, same lines (expenses carry no VAT in this schema).
    const totalExcl = mats.excl.add(expSum);
    return { o, total, totalExcl };
  });
  for (const { o, total, totalExcl } of priced) {
    if (o.status === "CANCELLED") continue;
    sumIncl = sumIncl.add(total);
    sumExcl = sumExcl.add(totalExcl);
    const c = base4AndExtra(o.materialUsages);
    sumBase = sumBase.add(c.base);
    sumExtra = sumExtra.add(c.extra);
    sumExcluded = sumExcluded.add(c.excluded);
    sumMatLines += o.materialUsages.length;
  }
  const shown = priced.slice(0, limit);
  const hiddenCount = priced.length - shown.length;

  return (
    <div className="flex flex-col gap-4">
      <ProductionTabs active="orders" />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          ТЗ
          {filterModel && (
            <span className="ml-2 text-base font-normal text-neutral-500">— {filterModel.name}</span>
          )}
          <YearNote year={year} />
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && <Link href="/plan/seasons" className={buttonVariants({ variant: "outline" })}>Сезоны ТЗ</Link>}
          {canEdit && (
            <Link href="/production/new" className={buttonVariants()}>
              + Новое ТЗ
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Вид списка">
        <span className="text-xs text-neutral-500">Вид:</span>
        {(
          [
            [false, "Списком"],
            [true, "По партиям"],
          ] as const
        ).map(([g, text]) => {
          // Вид переключается без потери фильтров.
          const href = filterHref(PROD_FILTERS, "/production", f, { view: g ? "batches" : "" });
          return (
            <Link
              key={text}
              href={href}
              aria-current={grouped === g ? "page" : undefined}
              className={
                "rounded-md border px-3 py-1 max-md:inline-flex max-md:min-h-8 max-md:items-center " +
                (grouped === g ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700 hover:bg-neutral-100")
              }
            >
              {text}
            </Link>
          );
        })}
      </div>

      <FilterBar
        title="Фильтры производства"
        controls={[
          { type: "text", name: "q", label: "Поиск", placeholder: "№ ТЗ, модель, заказчик" },
          { type: "multi", name: "status", label: "Статус", options: STATUS_KEYS.map((k) => ({ value: k, label: STATUS_LABELS[k].label })), allLabel: "Все статусы" },
          { type: "multi", name: "client", label: "Заказчик", options: opts.client, noneLabel: "Без заказчика" },
          { type: "multi", name: "season", label: "Сезон", options: opts.season, noneLabel: "Без сезона" },
          { type: "multi", name: "batch", label: "Партия производства", options: opts.batch, noneLabel: "Без партии", allLabel: "Все партии" },
          { type: "multi", name: "model", label: "Модель", options: opts.model },
          { type: "multi", name: "category", label: "Категория", aliases: ["cat"], options: opts.category, noneLabel: "Без категории" },
          { type: "multi", name: "auction", label: "Партия закупки", aliases: ["auc"], options: opts.auction, hint: "ТЗ, в которых списан мех этой партии закупки (аукциона)" },
          { type: "multi", name: "fur", label: "Вид меха", aliases: ["kind"], options: opts.fur },
          { type: "multi", name: "color", label: "Цвет изделия", options: opts.color, noneLabel: "Без цвета" },
          { type: "multi", name: "docs", label: "Документы и оплата", aliases: ["need"], options: DOCS_OPTIONS, allLabel: "Все" },
          { type: "multi", name: "vat", label: "НДС", aliases: ["nds"], options: VAT_OPTIONS, allLabel: "Любая ставка" },
          { type: "multi", name: "verified", label: "Проверка", options: VERIFIED_OPTIONS, allLabel: "Любая" },
          { type: "date", name: "from", label: "Дата ТЗ с" },
          { type: "date", name: "to", label: "Дата ТЗ по" },
          { type: "multi", name: "sort", label: "Сортировка", single: true, options: Object.entries(SORTS).map(([value, label]) => ({ value, label })), allLabel: "Сначала новые" },
        ]}
      />

      {grouped ? (
        <GroupedByBatch orders={groupedOrders.filter((o) => orders.some((x) => x.id === o.id))} batches={batchList} c4Mode={c4Mode} filtered={hasFilters} year={year} indicators={indicators} verified={vflags.orderById} />
      ) : (
      <>
      <ResponsiveRows table={
      <Table>
        <Thead>
          <Tr>
            <Th>№ ТЗ</Th>
            <Th>Модель</Th>
            {showClient && <Th className="hidden lg:table-cell">Заказчик</Th>}
            <Th className="hidden sm:table-cell" title="Запланировано / сделано, шт.">
              План / факт, шт.
            </Th>
            <Th>Статус</Th>
            <Th className="hidden lg:table-cell" title="Какие документы не хватает и оплачена ли работа заказчиком">Документы и оплата</Th>
            <Th className="hidden lg:table-cell" title="Подтверждено ли ТЗ (дата, приложение, количество, работа, материалы) или ждёт ручной проверки">Проверка</Th>
            <Th className="hidden md:table-cell" title="Ставки НДС лотов в списаниях ТЗ">НДС</Th>
            <Th>
              <VatLabel base={`Итого себестоимость${c4}`} />
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {shown.map(({ o, total, totalExcl }) => {
            const st = STATUS_LABELS[o.status];
            const href = `/production/${o.id}`;
            const ind = indicators.get(o.id);
            const vatB = vatBreakdown(o.materialUsages, c4Mode);
            cards.push(
              <RowCard
                key={o.id}
                title={`ТЗ ${o.workOrderNumber ?? "—"}${matchOf(o)?.label ? ` (${matchOf(o)!.label})` : ""}`}
                href={href}
                subtitle={o.productModel.name}
                badge={<Badge variant={st.variant}>{st.label}</Badge>}
                fields={[
                  { label: "План / факт, шт.", value: `${formatQty(o.plannedQuantity.toString())} / ${formatQty(o.producedQuantity.toString())}` },
                  {
                    label: <VatLabel base={`Себестоимость${c4}`} />,
                    value: total.isZero() ? "—" : <Money incl={total} excl={totalExcl} />,
                    strong: true,
                  },
                ]}
                details={[
                  { label: "Сезон", value: o.season?.code },
                  { label: "Заказчик", value: o.client?.name },
                  { label: "Ставка НДС", value: <TzVatBadge b={vatB} /> },
                  { label: "Документы и оплата", value: ind ? <DocsPayBadge tone={ind.tone} missing={ind.missing.length} noDocs={ind.noDocs} payText={ind.payText} proofMissing={ind.proofMissing} /> : null },
                  { label: "Проверка", value: <VerifyPill flag={vflags.orderById.get(o.id)} tab="orders" /> },
                ]}
              />,
            );
            const cell = "p-0";
            const link = "block px-3 py-2";
            return (
              <Tr key={o.id} className="cursor-pointer">
                <Td className={`${cell} font-medium`}>
                  <Link href={href} className={`${link} hover:underline`}>
                    {o.workOrderNumber ?? "—"}
                    {matchOf(o)?.label && (
                      <span className="ml-2 text-xs font-normal text-neutral-500">({matchOf(o)!.label})</span>
                    )}
                  </Link>
                </Td>
                <Td className={cell}>
                  <Link href={href} className={link}>
                    {o.productModel.name}
                    {o.season && <span className="ml-2 text-xs text-neutral-500">{o.season.code}</span>}
                    {showClient && o.client && <span className="block text-xs text-neutral-500 lg:hidden">{o.client.name}</span>}
                  </Link>
                </Td>
                {showClient && (
                  <Td className={`${cell} hidden lg:table-cell`}>
                    <Link href={href} className={link}>{o.client?.name ?? "—"}</Link>
                  </Td>
                )}
                <Td className={`${cell} hidden sm:table-cell`}>
                  <Link href={href} className={link}>
                    {formatQty(o.plannedQuantity.toString())} / {formatQty(o.producedQuantity.toString())}
                  </Link>
                </Td>
                <Td className={cell}>
                  <Link href={href} className={link}>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </Link>
                </Td>
                <Td className={`${cell} hidden lg:table-cell`}>
                  <Link href={`${href}#docpay`} className={link}>
                    {ind ? <DocsPayBadge tone={ind.tone} missing={ind.missing.length} noDocs={ind.noDocs} payText={ind.payText} proofMissing={ind.proofMissing} /> : "—"}
                  </Link>
                </Td>
                <Td className="hidden whitespace-nowrap px-3 py-2 lg:table-cell">
                  <VerifyPill flag={vflags.orderById.get(o.id)} tab="orders" />
                </Td>
                <Td className="hidden whitespace-nowrap px-3 py-2 md:table-cell">
                  <TzVatBadge b={vatB} />
                </Td>
                <Td className={cell}>
                  <Link href={href} className={link}>
                    {total.isZero() ? "—" : <Money incl={total} excl={totalExcl} />}
                  </Link>
                </Td>
              </Tr>
            );
          })}
          {orders.length === 0 && (
            <Tr>
              <Td colSpan={9} className="py-8 text-center text-neutral-400">
                {hasFilters ? "Ничего не найдено" : emptyForYear(year, "ТЗ", "ТЗ пока нет")}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
      }>
        {cards}
        {orders.length === 0 && <p className="py-8 text-center text-neutral-400">{hasFilters ? "Ничего не найдено" : emptyForYear(year, "ТЗ", "ТЗ пока нет")}</p>}
      </ResponsiveRows>
      {hiddenCount > 0 && (
        <p className="flex flex-wrap items-center justify-center gap-3 text-sm text-neutral-500">
          <span>
            Показано {shown.length} из {priced.length} ТЗ
          </span>
          {([PAGE_SIZE, null] as const).map((step) => (
            <Link
              key={step ?? "all"}
              href={filterHref(PROD_FILTERS, "/production", f, { limit: String(step ? Math.min(limit + step, priced.length) : priced.length) })}
              className="text-blue-600 hover:underline max-md:inline-flex max-md:min-h-8 max-md:items-center"
            >
              {step ? `Показать ещё ${Math.min(step, hiddenCount)}` : "Показать все"}
            </Link>
          ))}
        </p>
      )}
      {orders.length > 0 && (
        <div className="flex flex-wrap items-baseline justify-end gap-2 text-sm font-semibold">
          <VatLabel base="Итого себестоимость по списку" />
          <Mode4Badge mode={c4Mode} />
          <span>{sumIncl.isZero() ? "—" : <Money incl={sumIncl} excl={sumExcl} />}</span>
          <C4Hint
            mode={c4Mode}
            base={sumMatLines ? sumBase.toFixed(2) : null}
            extra={sumMatLines ? sumExtra.toFixed(2) : null}
            excluded={sumExcluded.toFixed(2)}
            total={sumIncl.toFixed(2)}
            title="Итого по списку"
            align="right"
          >
            <p className="mt-1">
              Сумма себестоимости всех ТЗ списка, кроме отменённых: сырьё и подкладка (списания) + расходы. Год: {year === "all" ? "все годы" : `${year} (по дате ТЗ)`}.
            </p>
            <p className="mt-1">Цифры с НДС; переключатель «Без НДС» показывает ту же сумму без НДС.</p>
          </C4Hint>
        </div>
      )}
      </>
      )}
    </div>
  );
}
