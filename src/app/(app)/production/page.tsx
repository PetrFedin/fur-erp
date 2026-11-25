import { readSort, sortRows, thSort } from "@/lib/table-sort";
import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { redirect } from "next/navigation";
import { escapeLike } from "@/lib/input";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { orderKey, tzCountText, positionsWord } from "@/lib/tz-key";
import { orderLabel } from "@/lib/order-label";
import { loadTzPositions } from "@/lib/order-label-db";
import { Table, Tbody, Tr, Td } from "@/components/ui/table";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { ProductionTabs } from "@/components/production-tabs";
import { Money } from "@/components/money";
import { VatLabel } from "@/components/vat-label";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix, sumUsagesWith4, base4AndExtra } from "@/lib/commission4";
import { canEditProduction } from "@/lib/production-access";
import { activeCount, dateRange, filterHref, parseFilters, splitNone, toWhere } from "@/lib/filters";
import { parseOrderSizes } from "@/lib/order-sizes";
import { loadOrderAttrOptions, orderColorNames } from "@/lib/order-filter-options";
import { orderUnits } from "@/lib/production-totals";
import { allocateHides, hidesApply, hidesByPayYear } from "@/lib/contractor-hides";
import { loadPaymentsOverview } from "@/lib/payments-overview";
import { furMaterialIdsByKind, getFilterOptions, purchaseIdsByAuction } from "@/lib/filter-options";
import { OrdersTree } from "@/components/orders-tree";
import { ProdTiles } from "@/components/prod-tiles";
import { loadOrdersDrill } from "@/lib/orders-drill";
import { slimForTiles, showTotals } from "@/lib/orders-sum";
import { modelCodeVariants } from "@/lib/model-code";
import { ResponsiveRows } from "@/components/responsive-rows";
import { getYearFilter } from "@/lib/year-filter";
import { orderDateOf, orderYearWhere } from "@/lib/year-scope";
import { YearNote, emptyForYear } from "@/components/year-note";
import { C4Hint, Mode4Badge } from "@/components/c4-note";
import { loadOrderIndicators } from "@/lib/production-doc-checklist";
import { articleLabel } from "@/lib/article-label";
import { searchArticles } from "@/lib/article-ref";
import { furKindsOfOrder, withOrderFurOptions } from "@/lib/order-fur";
import { loadOrderRows } from "@/lib/analytics-orders";
import { HIDDEN_MODULES } from "@/lib/hidden-modules";
import { lengthWhere } from "@/lib/length-class";
import { PROD_FILTERS, ORDER_LIST_INCLUDE } from "./_page/config";
import { makeStatOf, type Deliv } from "./_page/stat";
import { makeRowRenderers } from "./_page/rows";
import { ProductionTableHead } from "./_page/table-head";
import { ProductionFilters } from "./_page/filters-block";

export const metadata = { title: "Производство" };

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
        contractor: (v) => {
          const none = v.includes("none");
          const ids = v.filter((x) => x !== "none");
          return { OR: [...(ids.length ? [{ contractorId: { in: ids } }] : []), ...(none ? [{ contractorId: null }] : [])] };
        },
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
      include: ORDER_LIST_INCLUDE,
      orderBy: { createdAt: "desc" },
    }),
    f.model.length === 1 ? prisma.productModel.findFirst({ where: { id: f.model[0], organizationId: orgId } }) : null,
  ]);

  const canEdit = canEditProduction(session.user.role);
  const attr = await loadOrderAttrOptions(orgId);
  const colorSel = splitNone(f.color);
  const sizeSel = splitNone(f.size);
  const optsBase = await getFilterOptions(orgId, year, ["season", "batch", "model", "category", "auction", "fur", "attr", "client", "contractor"]);
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
  // «Поставлен»: ТЗ завершено, либо по документам изделия уже у нас (выпуск по документам или принятая отгрузка) — иначе ожидается.
  const acceptedQty = new Map<string, number>();
  for (const x of await prisma.shipmentLine.groupBy({ by: ["productionOrderId"], where: { productionOrderId: { in: rawOrders.map((o) => o.id) }, shipment: { status: "ACCEPTED" } }, _sum: { quantity: true } })) {
    if (x.productionOrderId) acceptedQty.set(x.productionOrderId, x._sum.quantity ?? 0);
  }
  const delivOf = (o: (typeof rawOrders)[number]): Deliv => {
    if (o.status === "COMPLETED") return "on";
    const planned = Number(o.plannedQuantity), got = Math.max(Number(o.producedQuantity), acceptedQty.get(o.id) ?? 0);
    return got <= 0 ? "off" : got >= planned ? "on" : "partial";
  };
  const delivNote = (o: (typeof rawOrders)[number]) => (o.status !== "COMPLETED" && delivOf(o) !== "off" ? "По документам изделия уже у нас (принятая отгрузка или выпуск по документам); статус ТЗ в системе ещё «в работе»" : undefined);
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
  // Подрядчик в строке ТЗ — когда в списке их больше одного.
  const showContractor = new Set(orders.map((o) => o.contractor?.name ?? "")).size > 1;

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
  const hidesShares = hidesApply({ auction: f.auction ?? [], fur: f.fur ?? [], color: f.color ?? [], attr: f.attr ?? [], vat: [] })
    ? allocateHides(live.map(({ o }) => ({ id: o.id, number: o.number, batch: o.batch?.number == null ? "none" : String(o.batch.number), qty: orderUnits(o) })), hidesByPayYear(await loadPaymentsOverview(orgId)), "all")
    : [];
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
  // Итог «Всего» под списком — те же числа, что в плитке «Полная себестоимость» (showTotals).
  const totals = { incl: showTotals(drill, "incl"), excl: showTotals(drill, "excl") };
  // Колонки списка: те же функции, что у карточки (sumUsagesWith4); «без 4%» — мелко под цифрой, если надбавка есть.
  const statOf = makeStatOf(c4Mode);
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

  const { renderPos, renderGroup } = makeRowRenderers({ c4, c4Mode, canEdit, showClient, showContractor, tzPos, furOf, cards, fullOf, statOf, labelOf, matchOf, delivOf, delivNote });
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Производство" }]} />
      <ProductionTabs active="orders" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center">
          <h1 className="text-xl font-semibold">Производство</h1>
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

      <ProductionFilters f={f} opts={opts} attr={attr} />

      {filtersOn && (
        <p className="text-sm text-neutral-600">Найдено: {tzGroups.length} ТЗ · {priced.length} {positionsWord(priced.length)}</p>
      )}

      <ProdTiles orders={grouped ? drill : slimForTiles(drill)} c4={c4Mode} treeId="orders-tree" id="orders" title="Итоги" headerEnd={<Link href="/production/batches" className="text-xs text-blue-700 hover:underline print:hidden">→ Партии пошива</Link>} />

      {grouped ? (
        <OrdersTree
          orders={drill}
          c4={c4Mode}
          title="ТЗ по партиям пошива"
          hint={<p><b>Партия пошива → ТЗ → состав.</b> Те же ТЗ и суммы, что в плитках выше. На Главной считается только полученное по приходу, поэтому там суммы меньше. Другие разрезы — вкладки справа.</p>}
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
          <ProductionTableHead tth={tth} c4={c4} />
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
          <span>{totals.incl.total === 0 ? "–" : <Money incl={totals.incl.total} excl={totals.excl.total} />}</span>
          <C4Hint
            mode={c4Mode}
            base={sumMatLines ? sumBase.toFixed(2) : null}
            extra={sumMatLines ? sumExtra.toFixed(2) : null}
            excluded={sumExcluded.toFixed(2)}
            total={sumIncl.toFixed(2)}
            title="Всего, ₽ по списку"
            align="right"
          >
            <p className="mt-1">Сумма по всем ТЗ списка, кроме отменённых: сырьё и подкладка (с 4%) + расходы + работа + шкуры подрядчика, с НДС; то же число, что в плитке «Полная себестоимость» и на Главной. Без работы она называется «Себестоимость сырья» (таблица партий, «Аналитика → Изделия»).</p>
          </C4Hint>
        </div>
      )}
      </>
      )}
    </div>
  );
}
