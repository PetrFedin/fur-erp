import { readSort, sortRows, thSort } from "@/lib/table-sort";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CATEGORY_GROUPS, NO_GROUP_ARTICLES_LABEL } from "@/lib/category-groups";
import Link from "next/link";
import { redirect } from "next/navigation";
import { escapeLike } from "@/lib/input";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { orderKey, articlesWord, tzCountText, positionsWord } from "@/lib/tz-key";
import { orderLabel, orderHint, posText } from "@/lib/order-label";
import { loadTzPositions } from "@/lib/order-label-db";
import { TzGroupRows } from "./tz-group-rows";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { ProductionTabs } from "@/components/production-tabs";
import { Money } from "@/components/money";
import { VatLabel } from "@/components/vat-label";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix, sumUsagesWith4, base4AndExtra } from "@/lib/commission4";
import { canEditProduction } from "@/lib/production-access";
import { FilterBar } from "@/components/filters/filter-bar";
import { activeCount, dateRange, defineFilters, filterHref, parseFilters, pick, splitNone, toWhere } from "@/lib/filters";
import { ORDER_COLORS_INCLUDE } from "@/lib/order-colors";
import { parseOrderSizes } from "@/lib/order-sizes";
import { NO_COLOR_LABEL, NO_SIZE_LABEL, loadOrderAttrOptions, orderColorNames } from "@/lib/order-filter-options";
import { orderUnits } from "@/lib/production-totals";
import { allocateHides, hidesApply, hidesByPayYear } from "@/lib/contractor-hides";
import { loadPaymentsOverview } from "@/lib/payments-overview";
import { formatMoney, formatQty } from "@/lib/utils";
import { batchLabel } from "@/lib/batch-label";
import { furMaterialIdsByKind, getFilterOptions, purchaseIdsByAuction } from "@/lib/filter-options";
import { OrdersTree } from "@/components/orders-tree";
import { ProdTiles } from "@/components/prod-tiles";
import { loadOrdersDrill } from "@/lib/orders-drill";
import { slimForTiles } from "@/lib/orders-sum";
import { modelCodeVariants } from "@/lib/model-code";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { getYearFilter } from "@/lib/year-filter";
import { orderDateOf, orderYearWhere } from "@/lib/year-scope";
import { YearNote, emptyForYear } from "@/components/year-note";
import { C4Hint, Mode4Badge } from "@/components/c4-note";
import { loadOrderIndicators } from "@/lib/production-doc-checklist";
import { ArticleName } from "@/components/article-name";
import { articleLabel } from "@/lib/article-label";
import { searchArticles } from "@/lib/article-ref";
import { TzVatBadge } from "@/components/tz-vat-badge";
import { vatBreakdown } from "@/lib/tz-vat";
import { furKindsOfOrder, withOrderFurOptions } from "@/lib/order-fur";
import { loadOrderRows } from "@/lib/analytics-orders";
import { HIDDEN_MODULES } from "@/lib/hidden-modules";
import { ORDER_STATUS_OPTIONS } from "@/components/order-status-badge";
import { LENGTH_OPTIONS, lengthWhere } from "@/lib/length-class";

const SORTS: Record<string, string> = {
  num_desc: "№ ТЗ: по убыванию",
  num_asc: "№ ТЗ: по возрастанию",
};
const DOCS_OPTIONS = [
  { value: "docs", label: "Только без документов" },
  { value: "pay", label: "Только без оплаты" },
];
const VERIFIED_OPTIONS = [
  { value: "yes", label: "Подтверждено" },
  { value: "no", label: "Не подтверждено" },
];
const PROD_FILTERS = defineFilters({
  ...pick(["q", "season", "status", "batch", "model", "len", "category", "catgroup", "auction", "fur", "color", "attr", "size", "docs", "verified", "from", "to", "sort", "view", "client"], {
    status: { allowed: ORDER_STATUS_OPTIONS.map((o) => o.value), label: "Статус" },
    size: { label: "Размер изделия" },
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

// Надзаголовки блоков колонок и тонкая вертикальная линия слева у первой колонки блока.
const GH = "border-b border-neutral-200 px-3 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500";
const BLH = " border-l border-neutral-200";

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
  if (f.view === "batches") redirect("/production/batches");
  const grouped = false;
  const filtersOn = activeCount(PROD_FILTERS, f) > 0;
  // Сколько строк рисуем (итог внизу считается по всем ТЗ списка): в dev-режиме и на телефоне 180+ строк — это секунды.
  const PAGE_SIZE = 50;
  const limitRaw = /^\d{1,5}$/.test(f.limit) ? parseInt(f.limit, 10) : PAGE_SIZE;
  const limit = Math.min(Math.max(limitRaw, PAGE_SIZE), 100000);

  // Фильтры по сырью: партия закупки (аукцион) и вид меха — через лоты в списаниях ТЗ.
  // Вид меха без партии закупки отбирает ТЗ по виду меха ТЗ (order-fur.ts, тот же, что в Изделиях и Календаре): так находится и «Бобр»
  // (сырьё подрядчика, лотов нет). Вместе с партией закупки вид меха остаётся отбором по лотам списаний.
  const orderFurRows = await loadOrderRows(orgId, "all", c4Mode);
  let lotOrderIds: string[] | null = null;
  if (f.fur.length && !f.auction.length) {
    lotOrderIds = orderFurRows.filter((o) => furKindsOfOrder(o.fur).some((k) => f.fur.includes(k))).map((o) => o.id);
  } else if (f.auction.length || f.fur.length) {
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

  // Поиск по артикулу — по любому написанию из справочника (наш код, код в продажах, другие написания, название).
  const qArticleIds = f.q ? (await searchArticles(f.q, orgId, 50)).map((h) => h.article.id) : [];
  // Поиск по лоту и закупке: ТЗ, в которые списан лот с таким номером или лот закупки с таким номером / номером счёта (один запрос).
  const lotHits = new Map<string, string>();
  if (f.q) {
    const lk = { contains: escapeLike(f.q), mode: "insensitive" as const };
    const hits = await prisma.productionMaterialUsage.findMany({
      where: { productionOrder: { organizationId: orgId }, lot: { OR: [{ lotNumber: lk }, { purchase: { OR: [{ number: lk }, { invoiceNumber: lk }] } }] } },
      select: { productionOrderId: true, lot: { select: { lotNumber: true, purchase: { select: { number: true, invoiceNumber: true } } } } },
      take: 2000,
    });
    const ql0 = f.q.toLowerCase();
    for (const h of hits) {
      if (lotHits.has(h.productionOrderId)) continue;
      const ln = h.lot.lotNumber ?? "";
      lotHits.set(h.productionOrderId, ln.toLowerCase().includes(ql0) ? `совпал лот ${ln}` : `совпала закупка ${h.lot.purchase?.number ?? h.lot.purchase?.invoiceNumber ?? ""}`.trim());
    }
  }
  const where: Prisma.ProductionOrderWhereInput = {
    organizationId: orgId,
    AND: [
      // Общий год: дата ТЗ → конец/начало → год партии (см. lib/year-scope.ts).
      orderYearWhere(year),
      ...toWhere<typeof f, Prisma.ProductionOrderWhereInput>(f, {
        model: (v) => ({ productModelId: { in: v } }),
        len: (v) => ({ productModel: lengthWhere(v) ?? {} }),
        // Признак меха: назван в самом ТЗ или есть у лота, списанного в ТЗ; «none» — ни там, ни там признаков нет.
        attr: (v) => {
          const { none, rest } = splitNone(v);
          const byName = { in: rest };
          return {
            OR: [
              ...(rest.length ? [{ attrs: { some: { attr: { name: byName } } } }, { materialUsages: { some: { lot: { attrs: { some: { attr: { name: byName } } } } } } }] : []),
              ...(none ? [{ AND: [{ attrs: { none: {} } }, { materialUsages: { none: { lot: { attrs: { some: {} } } } } }] }] : []),
            ],
          };
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
        catgroup: (v) => {
          const { none, rest } = splitNone(v);
          return { OR: [...(rest.length ? [{ productModel: { categoryRef: { group: { in: rest } } } }] : []), ...(none ? [{ productModel: { OR: [{ categoryRefId: null }, { categoryRef: { group: null } }] } }] : [])] };
        },
        auction: () => ({ id: { in: lotOrderIds ?? [] } }),
        fur: () => ({ id: { in: lotOrderIds ?? [] } }),
        client: (v) => ({ clientId: { in: v } }),
        status: (v) => ({ status: { in: v as ("PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED")[] } }),
        verified: (v) => (v.includes("yes") && v.includes("no") ? undefined : v.includes("yes") ? { verifiedAt: { not: null } } : v.includes("no") ? { verifiedAt: null } : undefined),
        q: (text) => ({
          OR: [
            { workOrderNumber: { contains: escapeLike(text), mode: "insensitive" } },
            { number: { contains: escapeLike(text), mode: "insensitive" } },
            ...modelCodeVariants(text).map((v) => ({ productModel: { name: { contains: escapeLike(v), mode: "insensitive" as const } } })),
            ...(qArticleIds.length ? [{ productModelId: { in: qArticleIds } }] : []),
            { client: { name: { contains: escapeLike(text), mode: "insensitive" } } },
            ...(lotHits.size ? [{ id: { in: Array.from(lotHits.keys()) } }] : []),
          ],
        }),
      }),
    ],
  };
  const period = dateRange(f.from, f.to);

  const [rawOrders, filterModel] = await Promise.all([
    prisma.productionOrder.findMany({
      where,
      include: {
        productModel: { select: { id: true, name: true, category: true, salesCode: true, salesName: true } },
        season: { select: { code: true } },
        client: { select: { name: true } },
        batch: { select: { number: true, year: true } },
        ...ORDER_COLORS_INCLUDE,
        materialUsages: {
          select: {
            totalCost: true,
            quantity: true,
            commission4: true,
            vatRate: true,
            lot: { select: { materialCostExclVat: true, expenseCostExclVat: true, unitCost: true, vatRate: true } },
            rawMaterial: { select: { unit: true } },
          },
        },
        expenses: { select: { amount: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    f.model.length === 1 ? prisma.productModel.findFirst({ where: { id: f.model[0], organizationId: orgId } }) : null,
  ]);

  const canEdit = canEditProduction(session.user.role);
  const attr = await loadOrderAttrOptions(orgId);
  const colorSel = splitNone(f.color);
  const sizeSel = splitNone(f.size);
  const optsBase = await getFilterOptions(orgId, year, ["season", "batch", "model", "category", "auction", "fur", "attr", "client"]);
  const opts = { ...optsBase, fur: withOrderFurOptions(optsBase.fur, orderFurRows) };
  const hasFilters = filtersOn;

  // What matched the search text, so a result like "141" -> ТЗ №132 (order
  // П-2026-0141) says why it is there. Exact № ТЗ / order number come first.
  const ql = q.toLowerCase();
  const matchOf = (o: (typeof rawOrders)[number]) => {
    if (!ql) return null;
    const wo = (o.workOrderNumber ?? "").toLowerCase();
    const no = o.number.toLowerCase();
    if (wo === ql) return { rank: 0, label: null };
    if (wo.includes(ql)) return { rank: 1, label: "совпал № ТЗ" };
    if (no === ql) return { rank: 2, label: "совпал № заказа" };
    if (no.includes(ql)) return { rank: 3, label: "совпал № заказа" };
    if (qArticleIds.includes(o.productModel.id) || modelCodeVariants(q).some((v) => o.productModel.name.toLowerCase().includes(v.toLowerCase()))) return { rank: 4, label: "совпала модель" };
    if (lotHits.has(o.id)) return { rank: 5, label: lotHits.get(o.id)! };
    return { rank: 6, label: "совпал заказчик" };
  };
  const woNum = (o: (typeof rawOrders)[number]) => {
    const n = parseInt(o.workOrderNumber ?? "", 10);
    return Number.isNaN(n) ? null : n;
  };
  const tzPos = await loadTzPositions(orgId, rawOrders);
  const labelOf = (o: (typeof rawOrders)[number]) => orderLabel({ workOrderNumber: o.workOrderNumber, number: o.number, ...tzPos.get(o.id) });
  const indicators = await loadOrderIndicators(prisma, orgId, { c4Mode, canUpload: false, canMark: false });
  const orders = rawOrders.filter((o) => {
    // Цвет: подходит ЛЮБОЙ из цветов ТЗ (составной ТЗ — под каждый свой цвет); «без цвета» — цвет в документах не указан.
    if (f.color.length) {
      const names = orderColorNames(o);
      if (!(names.length === 0 ? colorSel.none : names.some((n) => colorSel.rest.includes(n)))) return false;
    }
    // Размер: размеры из текста ТЗ (parseOrderSizes); ТЗ с несколькими размерами попадает под каждый.
    if (f.size.length) {
      const ss = parseOrderSizes(o.size);
      if (!(ss.length === 0 ? sizeSel.none : ss.some((x) => sizeSel.rest.includes(x)))) return false;
    }
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
  // Работа (цена работы × выпуск/план) и шкуры подрядчика по списку — чтобы итог сходился с «Себестоимостью» на Главной и в «Изделиях».
  const live = priced.filter((x) => x.o.status !== "CANCELLED");
  const workSum = live.reduce((a, { o }) => a + (o.clientWorkPricePerUnit ? o.clientWorkPricePerUnit.toNumber() * orderUnits(o) : 0), 0);
  const hidesShares = hidesApply({ auction: f.auction ?? [], fur: f.fur ?? [], color: f.color ?? [], attr: f.attr ?? [], vat: [] })
    ? allocateHides(live.map(({ o }) => ({ id: o.id, number: o.number, batch: o.batch?.number == null ? "none" : String(o.batch.number), qty: orderUnits(o) })), hidesByPayYear(await loadPaymentsOverview(orgId)), "all")
    : [];
  const hidesSum = hidesShares.reduce((a, x) => a + x.incl, 0);
  const hidesSumExcl = hidesShares.reduce((a, x) => a + x.excl, 0);
  const hidesOf = new Map(hidesShares.map((h) => [h.id, h]));
  // Итоговая себестоимость ТЗ — как в «Изделиях» и на Главной: сырьё, подкладка, 4%, расходы + работа + шкуры подрядчика.
  const fullOf = (o: (typeof live)[number]["o"], total: Decimal, totalExcl: Decimal) => {
    const w = new Decimal(o.clientWorkPricePerUnit ? o.clientWorkPricePerUnit.toNumber() * orderUnits(o) : 0);
    const h = hidesOf.get(o.id);
    return { incl: total.add(w).add(h?.incl ?? 0), excl: totalExcl.add(w).add(h?.excl ?? 0) };
  };
  // Плитки и дерево — из тех же ТЗ, что окно «Стоимость производства» на Главной, но только из списка страницы (фильтры применены).
  const drill = await loadOrdersDrill(orgId, year, c4Mode, { ids: new Set(orders.map((o) => o.id)), hides: hidesApply({ auction: f.auction ?? [], fur: f.fur ?? [], color: f.color ?? [], attr: f.attr ?? [], vat: [] }) });
  // Вид меха ТЗ — как в карточке и на Главной (ручной вид или по лотам).
  const furOf = new Map(drill.map((d) => [d.id, d.fur]));
  // Колонки списка: те же функции, что у карточки (sumUsagesWith4); «без 4%» — мелко под цифрой, если надбавка есть.
  const statOf = (o: (typeof orders)[number], full: { incl: Decimal; excl: Decimal }) => {
    const furU = o.materialUsages.filter((u) => u.rawMaterial.unit !== "M");
    const linU = o.materialUsages.filter((u) => u.rawMaterial.unit === "M");
    const fur = sumUsagesWith4(furU, c4Mode);
    const lining = sumUsagesWith4(linU, c4Mode);
    const diffOf = (a: { incl: Decimal; excl: Decimal }, b: { incl: Decimal; excl: Decimal }) => (a.incl.sub(b.incl).abs().lt(0.5) ? null : b);
    const furNoC4 = c4Mode === "on" ? diffOf(fur, sumUsagesWith4(furU, "off")) : null;
    const liningNoC4 = c4Mode === "on" ? diffOf(lining, sumUsagesWith4(linU, "off")) : null;
    const extra = fur.extraIncl.add(lining.extraIncl);
    const extraE = fur.extraExcl.add(lining.extraExcl);
    const noC4 = c4Mode === "on" && extra.gt(0.5) ? { incl: full.incl.sub(extra), excl: full.excl.sub(extraE) } : null;
    return {
      units: orderUnits(o),
      hides: furU.reduce((a, u) => a + u.quantity.toNumber(), 0),
      liningQty: linU.reduce((a, u) => a + u.quantity.toNumber(), 0),
      fur, lining, furNoC4, liningNoC4, noC4,
      work: o.clientWorkPricePerUnit ? o.clientWorkPricePerUnit.toNumber() * orderUnits(o) : 0,
    };
  };
  // Список по ТЗ: записи с одним номером ТЗ из документа (несколько артикулов) — одна строка-ТЗ с раскрытием на позиции.
  type P = (typeof priced)[number];
  const groupMap = new Map<string, P[]>();
  for (const x of priced) {
    const k = orderKey(x.o);
    const g = groupMap.get(k);
    if (g) g.push(x); else groupMap.set(k, [x]);
  }
  const tzGroups = Array.from(groupMap.values());
  for (const g of tzGroups) if (g.length > 1) g.sort((a, b) => a.o.number.localeCompare(b.o.number, "ru", { numeric: true }));
  // Сортировка по клику на заголовок (?tsort=…&tdir=…): строки-ТЗ целиком, как в списке; до обрезки по лимиту «показать ещё».
  const tSort = readSort(sp, ["batch", "tz", "articles", "fur", "article", "units", "hides", "furSum", "liningQty", "liningSum", "work", "full"], null, "t");
  const gStat = (g: P[]) => g.map((x) => ({ x, st: statOf(x.o, fullOf(x.o, x.total, x.totalExcl)), full: fullOf(x.o, x.total, x.totalExcl) }));
  const sumG = (g: P[], pick: (r: ReturnType<typeof gStat>[number]) => number) => gStat(g).reduce((a, r) => a + pick(r), 0);
  const sortedGroups = sortRows(tzGroups, tSort, {
    batch: (g) => g[0].o.batch?.number ?? null,
    tz: (g) => labelOf(g[0].o),
    articles: (g) => g.length,
    fur: (g) => furOf.get(g[0].o.id) || null,
    article: (g) => articleLabel(g[0].o.productModel),
    units: (g) => sumG(g, (r) => r.st.units),
    hides: (g) => sumG(g, (r) => r.st.hides),
    furSum: (g) => sumG(g, (r) => r.st.fur.incl.toNumber()),
    liningQty: (g) => sumG(g, (r) => r.st.liningQty),
    liningSum: (g) => sumG(g, (r) => r.st.lining.incl.toNumber()),
    work: (g) => sumG(g, (r) => r.st.work),
    full: (g) => sumG(g, (r) => r.full.incl.toNumber()),
  });
  const tth = (k: string) => thSort("/production", sp, k, tSort, "t");
  const shownGroups = sortedGroups.slice(0, limit);
  const hiddenCount = tzGroups.length - shownGroups.length;

  const renderPos = ({ o, total, totalExcl }: P, child: boolean) => {
            const href = `/production/${o.id}`;
            const vatB = vatBreakdown(o.materialUsages, c4Mode);
            const full = fullOf(o, total, totalExcl);
            const st = statOf(o, full);
            const fur = furOf.get(o.id) || "—";
            const card = (
              <RowCard
                key={o.id}
                title={`${labelOf(o)}${matchOf(o)?.label ? ` (${matchOf(o)!.label})` : ""}`}
                href={href}
                subtitle={`${articleLabel(o.productModel)}${fur !== "—" ? ` · ${fur}` : ""}`}
                fields={[
                  {
                    label: <VatLabel base={`Себестоимость с работой${c4}`} />,
                    value: full.incl.isZero() ? "—" : <><Money incl={full.incl} excl={full.excl} />{st.noC4 ? <span className="block whitespace-nowrap text-[11px] font-normal text-neutral-400">без 4%: <Money incl={st.noC4.incl} excl={st.noC4.excl} /></span> : null}</>,
                    strong: true,
                  },
                  { label: "Изделий", value: st.units > 0 ? `${formatQty(st.units)} шт.` : "—" },
                ]}
                details={[
                  { label: "Артикулов", value: "1" },
                  { label: "Шкур", value: st.hides > 0 ? formatQty(st.hides) : undefined },
                  { label: <VatLabel base="Мех" />, value: st.fur.incl.isZero() ? undefined : <Money incl={st.fur.incl} excl={st.fur.excl} /> },
                  { label: "Подкладка, м", value: st.liningQty > 0 ? formatQty(st.liningQty) : undefined },
                  { label: <VatLabel base="Подкладка" />, value: st.lining.incl.isZero() ? undefined : <Money incl={st.lining.incl} excl={st.lining.excl} /> },
                  { label: "Работа", value: st.work > 0 ? formatMoney(Math.round(st.work)) : undefined },
                  { label: "Партия пошива", value: o.batch ? batchLabel(o.batch.number, o.batch.year, [o]) : "без партии" },
                  { label: "Цвет", value: orderColorNames(o).join("; ") || undefined },
                  { label: "Заказчик", value: o.client?.name },
                  { label: "Ставка НДС", value: <TzVatBadge b={vatB} /> },
                  { label: "Word ТЗ", value: <a href={`/api/production/${o.id}/word`} className="inline-flex min-h-11 items-center text-blue-700 hover:underline">Открыть Word</a> },
                ]}
              />
            );
            const cell = "p-0";
            const link = "block px-3 py-2";
            const num = `${cell} text-right tabular-nums`;
            const dash = <span className="text-neutral-300">—</span>;
            const sub = (n: { incl: Decimal; excl: Decimal } | null) =>
              n ? <span className="block whitespace-nowrap text-[11px] font-normal text-neutral-400">без 4%: <Money incl={n.incl} excl={n.excl} /></span> : null;
            const tr = (
              <Tr key={o.id} className={child ? "cursor-pointer bg-neutral-50/70" : "cursor-pointer"}>
                <Td className={`${cell} font-medium`}>
                  {o.batch ? (
                    <Link href={`/production/batches/${o.batch.number}`} className={`${link} whitespace-nowrap hover:underline`} title={`Партия пошива ${o.batch.number}${o.batch.year ? `, ${o.batch.year}` : ""}`}>{o.batch.number}</Link>
                  ) : (
                    <Link href={`${href}#card-batch`} className={link} title="Партия не указана — откройте ТЗ и выберите или введите партию">
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-300">—</span>
                    </Link>
                  )}
                </Td>
                <Td className={`${cell} font-medium`}>
                  <Link href={href} className={`${link} whitespace-nowrap hover:underline`}>
                    {child ? <span className="pl-4 text-xs font-normal text-neutral-600" title={orderHint(o)}>{[posText(tzPos.get(o.id)?.posIndex, tzPos.get(o.id)?.posCount), articleLabel(o.productModel)].filter(Boolean).join(" · ")}</span> : <span title={orderHint(o)}>{labelOf(o)}</span>}
                    {matchOf(o)?.label && <span className="ml-2 text-xs font-normal text-neutral-500">({matchOf(o)!.label})</span>}
                  </Link>
                  <a href={`/api/production/${o.id}/word`} className="block px-3 pb-2 text-xs font-normal text-blue-700 hover:underline" title="Финальный Word этого ТЗ">Word</a>
                </Td>
                <Td className={num}><Link href={href} className={link}>1</Link></Td>
                <Td className={`${cell} text-neutral-700`}><Link href={href} className={`${link} whitespace-nowrap`}>{fur}</Link></Td>
                <Td className={cell}>
                  <div className={`${link} max-w-[16rem]`}>
                    <Link href={`/models/${o.productModel.id}`} className="hover:underline" title="Открыть артикул"><ArticleName model={o.productModel} compact /></Link>
                    <Link href={href} className="block truncate text-xs text-neutral-500 hover:underline">{[o.productModel.category?.trim(), orderColorNames(o).join("; "), showClient ? o.client?.name : ""].filter(Boolean).join(" · ")}</Link>
                  </div>
                </Td>
                <Td className={`${num} border-l border-neutral-200`}><Link href={href} className={link}>{st.units > 0 ? formatQty(st.units) : dash}</Link></Td>
                <Td className={num}><Link href={href} className={link}>{st.hides > 0 ? formatQty(st.hides) : dash}</Link></Td>
                <Td className={`${num} border-l border-neutral-200`}><Link href={href} className={link}>{st.fur.incl.isZero() ? dash : <Money incl={st.fur.incl} excl={st.fur.excl} />}{sub(st.furNoC4)}</Link></Td>
                <Td className={num}><Link href={href} className={link}>{st.liningQty > 0 ? formatQty(st.liningQty) : dash}</Link></Td>
                <Td className={num}><Link href={href} className={link}>{st.lining.incl.isZero() ? dash : <Money incl={st.lining.incl} excl={st.lining.excl} />}{sub(st.liningNoC4)}</Link></Td>
                <Td className={`${num} border-l border-neutral-200`}><Link href={href} className={link}>{st.work > 0 ? formatMoney(Math.round(st.work)) : dash}</Link></Td>
                <Td className={`${num} font-medium`}>
                  <Link href={href} className={link}>
                    {full.incl.isZero() ? dash : <Money incl={full.incl} excl={full.excl} />}
                    {sub(st.noC4)}
                  </Link>
                </Td>
                <Td className={cell}><Link href={href} className={`${link} whitespace-nowrap`}><TzVatBadge b={vatB} compact hint={false} /></Link></Td>
              </Tr>
            );
    return { card, tr };
  };

  // Строка-ТЗ с несколькими артикулами: суммы по позициям (каждая позиция — отдельная запись, итоги не двоятся).
  const renderGroup = (g: P[]) => {
    const rows = g.map((x) => {
      const full = fullOf(x.o, x.total, x.totalExcl);
      return { x, full, st: statOf(x.o, full) };
    });
    const zero = () => ({ incl: new Decimal(0), excl: new Decimal(0) });
    const add = (a: { incl: Decimal; excl: Decimal }, b: { incl: Decimal; excl: Decimal }) => ({ incl: a.incl.add(b.incl), excl: a.excl.add(b.excl) });
    const tot = rows.reduce((a, r) => ({
      units: a.units + r.st.units, hides: a.hides + r.st.hides, liningQty: a.liningQty + r.st.liningQty, work: a.work + r.st.work,
      fur: add(a.fur, r.st.fur), lining: add(a.lining, r.st.lining), full: add(a.full, r.full),
    }), { units: 0, hides: 0, liningQty: 0, work: 0, fur: zero(), lining: zero(), full: zero() });
    const first = g[0].o;
    const tzNo = orderLabel({ workOrderNumber: first.workOrderNumber, number: first.number });
    const batches = Array.from(new Set(g.map((x) => x.o.batch?.number ?? null)));
    const furs = Array.from(new Set(g.flatMap((x) => (furOf.get(x.o.id) || "—").split(" + "))));
    const models = Array.from(new Set(g.map((x) => articleLabel(x.o.productModel))));
    const count = `${g.length} ${articlesWord(g.length)}`;
    const cell = "p-0";
    const link = "block px-3 py-2";
    const num = `${cell} text-right tabular-nums`;
    const dash = <span className="text-neutral-300">—</span>;
    const firstHref = `/production/${first.id}`;
    const children = rows.map((r) => renderPos(r.x, true).tr);
    const match = g.map((x) => matchOf(x.o)?.label).find(Boolean);
    cards.push(
      <RowCard
        key={`tz-${orderKey(first)}`}
        title={`${tzNo} · ${count}`}
        subtitle={`${models.slice(0, 4).join(", ")}${models.length > 4 ? "…" : ""}${furs[0] !== "—" ? ` · ${furs.join(" + ")}` : ""}${match ? ` (${match})` : ""}`}
        badge={<span className="text-xs text-neutral-500">один ТЗ</span>}
        fields={[
          { label: <VatLabel base={`Себестоимость с работой${c4}`} />, value: tot.full.incl.isZero() ? "—" : <Money incl={tot.full.incl} excl={tot.full.excl} />, strong: true },
          { label: "Изделий", value: tot.units > 0 ? `${formatQty(tot.units)} шт.` : "—" },
        ]}
        details={[
          { label: "Партия пошива", value: batches.length === 1 && first.batch ? batchLabel(first.batch.number, first.batch.year, [first]) : batches.length > 1 ? "несколько" : "без партии" },
          { label: "Работа", value: tot.work > 0 ? formatMoney(Math.round(tot.work)) : undefined },
          ...rows.map((r) => ({
            key: r.x.o.id,
            label: <Link href={`/production/${r.x.o.id}`} className="text-blue-700 hover:underline">{articleLabel(r.x.o.productModel)}</Link>,
            value: `${r.st.units > 0 ? `${formatQty(r.st.units)} шт.` : "—"} · ${labelOf(r.x.o)}`,
          })),
        ]}
      />,
    );
    return (
      <TzGroupRows
        key={`tz-${orderKey(first)}`}
        count={count}
        n={g.length}
        href={firstHref}
        before={
          <Td className={`${cell} font-medium`}>
            {batches.length === 1 && first.batch ? (
              <Link href={`/production/batches/${first.batch.number}`} className={`${link} whitespace-nowrap hover:underline`} title={`Партия пошива ${first.batch.number}${first.batch.year ? `, ${first.batch.year}` : ""}`}>{first.batch.number}</Link>
            ) : batches.length > 1 ? <span className={`${link} text-xs text-neutral-500`}>несколько</span> : (
              <Link href={`${firstHref}#card-batch`} className={link}><span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-300">—</span></Link>
            )}
          </Td>
        }
        label={<>{tzNo}{match ? <span className="ml-2 text-xs font-normal text-neutral-500">({match})</span> : null}</>}
        after={
          <>
            <Td className={`${cell} text-neutral-700`}><span className={`${link} whitespace-nowrap`}>{furs.join(" + ")}</span></Td>
            <Td className={cell}><span className={`${link} max-w-[16rem] truncate text-xs text-neutral-600`}>{models.join(", ")}</span></Td>
            <Td className={`${num} border-l border-neutral-200`}><span className={link}>{tot.units > 0 ? formatQty(tot.units) : dash}</span></Td>
            <Td className={num}><span className={link}>{tot.hides > 0 ? formatQty(tot.hides) : dash}</span></Td>
            <Td className={`${num} border-l border-neutral-200`}><span className={link}>{tot.fur.incl.isZero() ? dash : <Money incl={tot.fur.incl} excl={tot.fur.excl} />}</span></Td>
            <Td className={num}><span className={link}>{tot.liningQty > 0 ? formatQty(tot.liningQty) : dash}</span></Td>
            <Td className={num}><span className={link}>{tot.lining.incl.isZero() ? dash : <Money incl={tot.lining.incl} excl={tot.lining.excl} />}</span></Td>
            <Td className={`${num} border-l border-neutral-200`}><span className={link}>{tot.work > 0 ? formatMoney(Math.round(tot.work)) : dash}</span></Td>
            <Td className={`${num} font-medium`}><span className={link}>{tot.full.incl.isZero() ? dash : <Money incl={tot.full.incl} excl={tot.full.excl} />}</span></Td>
            <Td className={cell}><span className={link} /></Td>
          </>
        }
      >
        {children}
      </TzGroupRows>
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "ТЗ" }]} />
      <ProductionTabs active="orders" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center">
          <h1 className="text-xl font-semibold">ТЗ</h1>
          {filterModel && (
            <span className="ml-2 text-base font-normal text-neutral-600">— {filterModel.name}</span>
          )}
          <YearNote year={year} />
        </div>
        {/* Телефон: главное действие — первым и на всю ширину. */}
        <div className="flex flex-wrap items-center gap-2 max-md:w-full">
          {canEdit && !HIDDEN_MODULES.seasons && <Link href="/plan/seasons" className={`${buttonVariants({ variant: "outline" })} btn-accent max-md:flex-1`}>Сезоны ТЗ</Link>}
          {canEdit && <Link href="/production/import" className={`${buttonVariants({ variant: "outline" })} btn-accent max-md:flex-1`}>Загрузить ТЗ</Link>}
          {canEdit && (
            <Link href="/production/new" className={`${buttonVariants()} btn-accent max-md:order-first max-md:w-full`}>
              + Новое ТЗ
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Вид списка">
        <span className="text-neutral-500">Вид:</span>
        <div className="inline-flex overflow-hidden rounded-lg border border-neutral-300">
          {(
            [
              [false, "Списком"],
              [true, "По партиям пошива"],
            ] as const
          ).map(([g, text]) => {
            // Вид переключается без потери фильтров.
            const href = g ? "/production/batches" : filterHref(PROD_FILTERS, "/production", f, { view: "" });
            return (
              <Link
                key={text}
                href={href}
                aria-current={grouped === g ? "page" : undefined}
                className={
                  "px-3 py-1.5 max-md:inline-flex max-md:min-h-9 max-md:items-center " +
                  (grouped === g ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-100")
                }
              >
                {text}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="print:hidden">
      <FilterBar
        title="Фильтры производства"
        oneRow
        hideChips
        controls={[
          { type: "text", name: "q", label: "№ ТЗ / поиск", placeholder: "№ ТЗ, артикул, заказчик" },
          { type: "multi", name: "season", label: "Сезон", options: opts.season, noneLabel: "Без сезона", more: true },
          { type: "multi", name: "batch", label: "Партия пошива", options: opts.batch, noneLabel: "Без партии", allLabel: "Все партии" },
          { type: "multi", name: "model", label: "Артикул", options: opts.model },
          { type: "multi", name: "len", label: "Длина", more: true, options: LENGTH_OPTIONS, allLabel: "Любая" },
          { type: "multi", name: "catgroup", label: "Группа категорий", options: CATEGORY_GROUPS.map((g) => ({ value: g, label: g })), noneLabel: NO_GROUP_ARTICLES_LABEL, allLabel: "Все группы", more: true },
          { type: "multi", name: "category", label: "Категория", aliases: ["cat"], options: opts.category, noneLabel: "Без категории" },
          { type: "multi", name: "auction", label: "Аукцион / закупка", aliases: ["auc"], options: opts.auction, hint: "ТЗ, в которых списан мех этой партии закупки (аукциона)", more: true },
          { type: "multi", name: "fur", label: "Вид меха", aliases: ["kind"], options: opts.fur },
          ...(opts.attr.length > 0 ? [{ type: "multi" as const, name: "attr", label: "Признак меха", options: opts.attr, noneLabel: "Без признака", allLabel: "Все признаки", more: true, hint: "Признаки ТЗ и лотов, списанных в ТЗ: седина, дикий / клеточный, тонированный…" }] : []),
          { type: "multi", name: "color", label: "Цвет изделия", more: true, options: attr.color, noneLabel: attr.noColor > 0 ? NO_COLOR_LABEL : undefined, hint: "Все цвета ТЗ: составное ТЗ попадает под каждый свой цвет" },
          ...(attr.size.length > 1 ? [{ type: "multi" as const, name: "size", label: "Размер изделия", more: true, options: attr.size, noneLabel: attr.noSize > 0 ? NO_SIZE_LABEL : undefined, hint: "Размеры из ТЗ: ТЗ с несколькими размерами попадает под каждый" }] : []),
          { type: "multi", name: "client", label: "Заказчик", options: opts.client, more: true },
          { type: "multi", name: "docs", label: "Документы и оплата", aliases: ["need"], options: DOCS_OPTIONS, allLabel: "Все", more: true },
          { type: "multi", name: "verified", label: "Проверка", options: VERIFIED_OPTIONS, allLabel: "Любая", more: true },
          { type: "date", name: "from", label: "Дата ТЗ с", more: true },
          { type: "date", name: "to", label: "Дата ТЗ по", more: true },
          { type: "multi", name: "sort", label: "Сортировка", single: true, options: Object.entries(SORTS).map(([value, label]) => ({ value, label })), allLabel: "Сначала новые", more: true },
        ]}
      />
      </div>

      {filtersOn && (
        <p className="text-sm text-neutral-600">Найдено: {tzGroups.length} ТЗ · {priced.length} {positionsWord(priced.length)}</p>
      )}

      <ProdTiles orders={grouped ? drill : slimForTiles(drill)} c4={c4Mode} treeId="orders-tree" id="orders" title="ТЗ — итоги" headerEnd={<Link href="/production/batches" className="text-xs text-blue-700 hover:underline print:hidden">→ Партии пошива</Link>} />

      {grouped ? (
        <OrdersTree
          orders={drill}
          c4={c4Mode}
          title="ТЗ по партиям пошива"
          hint={<p><b>Партия пошива → ТЗ → состав.</b> Те же ТЗ и суммы, что в плитках выше и в блоке «Производство» на Главной. Другие разрезы — вкладки справа.</p>}
          modes={[
            { id: "batch", label: "Партии", dims: ["batch", "order"] },
            { id: "year", label: "Годы → партии", dims: ["year", "batch", "order"] },
            { id: "article", label: "Артикулы", dims: ["article", "order"] },
            { id: "cat", label: "Категории", dims: ["category", "article", "order"] },
          ]}
          empty={hasFilters ? "Ничего не найдено" : emptyForYear(year, "партий с ТЗ", "Партий с ТЗ пока нет.")}
        />
      ) : (
      <>
      <ResponsiveRows table={
      <Table anchor="table:production" label="Таблица ТЗ" stickyHeader className="min-w-[1040px]">
        <Thead>
          <Tr>
            <Th colSpan={5} aria-hidden />
            <Th colSpan={2} className={GH + BLH}>Производство</Th>
            <Th colSpan={3} className={GH + BLH}>Сырьё</Th>
            <Th colSpan={3} className={GH + BLH}>Итого</Th>
          </Tr>
          <Tr>
            <Th {...tth("batch")}>Партия</Th>
            <Th {...tth("tz")}>ТЗ</Th>
            <Th {...tth("articles")} className="text-right">Артикулов</Th>
            <Th {...tth("fur")}>Мех</Th>
            <Th {...tth("article")}>Артикул</Th>
            <Th {...tth("units")} className={"text-right" + BLH} unit="шт.">Изделий</Th>
            <Th {...tth("hides")} className="text-right" unit="шт.">Шкур</Th>
            <Th {...tth("furSum")} className={"text-right" + BLH} unit="₽"><VatLabel base="Мех" /></Th>
            <Th {...tth("liningQty")} className="text-right" unit="м">Подкладка</Th>
            <Th {...tth("liningSum")} className="text-right" unit="₽"><VatLabel base="Подкладка" /></Th>
            <Th {...tth("work")} className={"text-right" + BLH} unit="₽">Работа</Th>
            <Th {...tth("full")} className="text-right" unit="₽">
              <VatLabel base={`Себестоимость с работой${c4}`} />
            </Th>
            <Th>НДС</Th>
          </Tr>
        </Thead>
        <Tbody>
          {shownGroups.map((g) => {
            if (g.length === 1) { const r = renderPos(g[0], false); cards.push(r.card); return r.tr; }
            return renderGroup(g);
          })}
          {orders.length === 0 && (
            <Tr>
              <Td colSpan={13} className="py-8 text-center text-neutral-500">
                {hasFilters ? "Ничего не найдено" : emptyForYear(year, "ТЗ", "ТЗ пока нет")}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
      }>
        {cards}
        {orders.length === 0 && <p className="py-8 text-center text-neutral-500">{hasFilters ? "Ничего не найдено" : emptyForYear(year, "ТЗ", "ТЗ пока нет")}</p>}
      </ResponsiveRows>
      {hiddenCount > 0 && (
        <p className="flex flex-wrap items-center justify-center gap-3 text-sm text-neutral-500">
          <span>
            Показано {shownGroups.length} из {tzGroups.length} ТЗ
          </span>
          {([PAGE_SIZE, null] as const).map((step) => (
            <Link
              key={step ?? "all"}
              href={filterHref(PROD_FILTERS, "/production", f, { limit: String(step ? Math.min(limit + step, tzGroups.length) : tzGroups.length) })}
              className="text-blue-600 hover:underline max-md:inline-flex max-md:min-h-8 max-md:items-center"
            >
              {step ? `Показать ещё ${Math.min(step, hiddenCount)}` : "Показать все"}
            </Link>
          ))}
        </p>
      )}
      {orders.length > 0 && (
        <div className="row-total flex flex-wrap items-baseline justify-end gap-2 px-3 py-2 text-sm">
          <span className="mr-auto text-xs text-neutral-500">{tzCountText(tzGroups.length, priced.length)}</span>
          <VatLabel base="Всего, ₽ по списку" />
          <Mode4Badge mode={c4Mode} />
          <span>{sumIncl.isZero() ? "—" : <Money incl={sumIncl.add(workSum).add(hidesSum)} excl={sumExcl.add(workSum).add(hidesSumExcl)} />}</span>
          <C4Hint
            mode={c4Mode}
            base={sumMatLines ? sumBase.toFixed(2) : null}
            extra={sumMatLines ? sumExtra.toFixed(2) : null}
            excluded={sumExcluded.toFixed(2)}
            total={sumIncl.toFixed(2)}
            title="Всего, ₽ по списку"
            align="right"
          >
            <p className="mt-1">
              Сумма по всем ТЗ списка, кроме отменённых: сырьё и подкладка (списания, с 4%) + расходы + работа + шкуры подрядчика. Это «Полная себестоимость (с работой)» — сходится с одноимённой плиткой на Главной и итогом в «Изделиях». В таблице партий и в «Аналитика → Изделия» показана «Себестоимость сырья» — без работы. Год: {year === "all" ? "все годы" : `${year} (по дате ТЗ)`}.
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
