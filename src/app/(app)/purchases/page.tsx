import { isServiceAuction, shortAuctionName } from "@/lib/auction-names";
import { WidgetRow } from "@/components/widget-row";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatMoney, formatPercent, formatQty } from "@/lib/utils";
import { purchaseTotalInclVat, purchaseTotalExclVat, itemTotalInclVat, grossUp } from "@/lib/purchase-totals";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { Money } from "@/components/money";
import { VatLabel } from "@/components/vat-label";
import { FilterBar } from "@/components/filters/filter-bar";
import { activeCount, defineFilters, filterHref, parseFilters, pick, stateParam, toWhere, dateRange } from "@/lib/filters";
import { furMaterialIdsByKind, getFilterOptions, purchaseIdsByAuction } from "@/lib/filter-options";
import { loadAuctionSummaries, auctionName, PAY_EPS } from "@/lib/auction-payments";
import { escapeLike } from "@/lib/input";
import { getYearFilter } from "@/lib/year-filter";
import { purchaseYear } from "@/lib/year-scope";
import { YearNote, emptyForYear } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { PurchasesTabs } from "@/components/raw-tabs";
import { loadPaymentsOverview } from "@/lib/payments-overview";
import { loadFurLots } from "@/lib/fur-table-server";
import { getFurIndex } from "@/lib/fur-ref-server";
import { NOT_SET, emptyFilters, filterLots, type FurLot } from "@/lib/fur-table";
import { TILE_BOX, TileHead, TileValue, TileCaption } from "../dashboard/tile";
import { PurchasesList, PurchasesTree, type ExtraRow } from "./purchases-tree";
import { aggregate, type PurchaseStatus, type TreeBatch, type TreePurchase, type TreeYear } from "./purchases-agg";

function firstLine(v: string | null) {
  return (v ?? "").split(/\r?\n/)[0].trim();
}

export const metadata = { title: "Закупки" };

const PURCHASE_FILTERS = defineFilters({
  ...pick(["auction", "status", "supplier", "fur", "color", "size", "attr", "rest", "usage", "pay", "verified", "vat", "pyear", "q", "from", "to", "view", "sort", "dir"], {
    view: { allowed: ["tree", "list"] },
    status: { allowed: ["DRAFT", "RECEIVED", "CANCELLED"], label: "Статус закупки" },
    verified: { allowed: ["yes", "no"], label: "Подтверждение" },
    vat: { label: "НДС" },
    sort: { allowed: ["number", "year", "batch", "supplier", "date", "status", "lots", "fur", "lining", "total", "paid", "rest", "used", "rem"] },
  }),
});
const PURCHASE_FILTERS_ALL = defineFilters({
  ...PURCHASE_FILTERS.defs,
  sec: stateParam("Раздел", { allowed: ["fur", "lining"] }),
});
const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Черновик" },
  { value: "RECEIVED", label: "Принято на склад" },
  { value: "CANCELLED", label: "Отменено" },
];
const VERIFIED_OPTIONS = [
  { value: "yes", label: "Подтверждено" },
  { value: "no", label: "Ждёт проверки" },
];
const VAT_OPTIONS = [
  { value: "20", label: "Только 20%" },
  { value: "22", label: "Только 22%" },
  { value: "mixed", label: "Смешанные (20% и 22%)" },
];
const REST_OPTIONS = [
  { value: "with", label: "Есть остаток" },
  { value: "zero", label: "Остатка нет (исчерпан)" },
];
const USAGE_OPTIONS = [
  { value: "used", label: "Использована в ТЗ" },
  { value: "unused", label: "Не использована" },
];
const PAY_OPTIONS = [
  { value: "paid", label: "Оплачена" },
  { value: "partial", label: "Оплачена частично" },
  { value: "unpaid", label: "Не оплачена" },
];

const num = (d: Decimal) => d.toNumber();

export default async function PurchasesPage({ searchParams }: PageProps<"/purchases">) {
  const session = await requireSession();
  const sp = await searchParams;
  const year = await getYearFilter();
  const canCreate = ["OWNER", "ADMIN", "PURCHASER"].includes(session.user.role);
  const orgId = session.user.organizationId;
  const f = parseFilters(PURCHASE_FILTERS_ALL, sp);
  const PAGE = 50;
  // Вид: «По годам и партиям» (дерево, по умолчанию) или «Списком» (плоская таблица с сортировкой и «Показать ещё»).
  const tree = f.view !== "list";
  const limitRaw = Number(f.limit || PAGE);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), PAGE), 2000) : PAGE;
  const filtersOn = activeCount(PURCHASE_FILTERS_ALL, f) > 0;

  const auctionIds = f.auction.length ? await purchaseIdsByAuction(orgId, f.auction) : null;
  const furMaterialIds = f.fur.length ? await furMaterialIdsByKind(orgId, f.fur) : [];
  const vatKinds = new Set(f.vat.map((v) => (v === "mix" ? "mixed" : v)));
  const vatWhere = (k: string): Prisma.PurchaseWhereInput =>
    k === "mixed"
      ? { AND: [{ items: { some: { vatRate: 20 } } }, { items: { some: { vatRate: 22 } } }] }
      : { items: { some: { vatRate: Number(k) } }, NOT: { items: { some: { vatRate: { not: Number(k) } } } } };
  const where: Prisma.PurchaseWhereInput = {
    organizationId: orgId,
    AND: [
      purchaseYear(year),
      ...toWhere<typeof f, Prisma.PurchaseWhereInput>(f, {
        status: (v) => ({
          OR: v.map((x) =>
            x === "RECEIVED" ? { status: "RECEIVED" as const } : x === "CANCELLED" ? { status: "CANCELLED" as const } : { status: { notIn: ["RECEIVED" as const, "CANCELLED" as const] } },
          ),
        }),
        supplier: (v) => ({ supplierId: { in: v } }),
        auction: () => ({ id: { in: auctionIds ?? [] } }),
        fur: () => ({ items: { some: { rawMaterialId: { in: furMaterialIds.length ? furMaterialIds : ["__none"] } } } }),
        verified: (v) => (v.includes("yes") && v.includes("no") ? undefined : v.includes("yes") ? { verifiedAt: { not: null } } : v.includes("no") ? { verifiedAt: null } : undefined),
        vat: () => ({ OR: [...vatKinds].filter((k) => ["20", "22", "mixed"].includes(k)).map(vatWhere) }),
        pyear: (v) => ({ OR: v.map((y) => ({ orderDate: { gte: new Date(Date.UTC(Number(y), 0, 1)), lt: new Date(Date.UTC(Number(y) + 1, 0, 1)) } })) }),
        from: () => ({ orderDate: dateRange(f.from, f.to) }),
        to: () => (f.from ? undefined : { orderDate: dateRange(f.from, f.to) }),
        q: (q) => ({
          OR: [
            { number: { contains: escapeLike(q), mode: "insensitive" as const } },
            { invoiceNumber: { contains: escapeLike(q), mode: "insensitive" as const } },
            { supplier: { name: { contains: escapeLike(q), mode: "insensitive" as const } } },
            { items: { some: { lotNumber: { contains: escapeLike(q), mode: "insensitive" as const } } } },
          ],
        }),
      }),
    ],
  };
  const furIdx = await getFurIndex(orgId);
  const [found, furLots, liningLots, opts, sizeRows] = await Promise.all([
    prisma.purchase.findMany({
      where,
      include: { supplier: true, items: { include: { rawMaterial: true } }, expenses: { include: { category: true } }, payments: true },
      orderBy: { number: "desc" },
    }),
    loadFurLots(prisma, orgId, { kind: "fur", year: "all", furIdx }),
    loadFurLots(prisma, orgId, { kind: "lining", year: "all", furIdx }),
    getFilterOptions(orgId, year, ["auction", "pyear", "supplier", "fur", "color", "attr"]),
    prisma.rawMaterialLot.findMany({ where: { organizationId: orgId, sizeGrade: { not: null } }, select: { sizeGrade: true } }),
  ]);
  const lotsOf = new Map<string, FurLot[]>();
  const lotById = new Map<string, FurLot>();
  for (const l of [...furLots, ...liningLots]) {
    lotById.set(l.id, l);
    if (l.purchaseId) lotsOf.set(l.purchaseId, [...(lotsOf.get(l.purchaseId) ?? []), l]);
  }
  const sizeOptions = [...new Set(sizeRows.flatMap((r) => (r.sizeGrade ?? "").split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)))]
    .sort((a, b) => a.localeCompare(b, "ru", { numeric: true }))
    .map((v) => ({ value: v, label: v }));

  // Оплаты по закупкам с аукционом ведутся по аукциону целиком — «оплачено» берём оттуда.
  const auctionNames = [...new Set(found.map((p) => auctionName(p.auctionSession)).filter((n): n is string => !!n))];
  const auctionPays = new Map((auctionNames.length ? await loadAuctionSummaries(prisma, orgId, auctionNames) : []).map((a) => [a.name, a]));

  // Строки закупок: один расчёт для дерева, списка и плиток (одинаковые итоги).
  const all: TreePurchase[] = found.map((p) => {
    const total = purchaseTotalInclVat(p);
    const own = p.payments.filter((x) => x.status === "COMPLETED");
    const ownSum = own.reduce((a, x) => a.add(x.amount), new Decimal(0));
    const cancelled = p.status === "CANCELLED";
    const an = auctionName(p.auctionSession);
    const ap = auctionPays.get(an ?? "");
    const paidShare = cancelled ? new Decimal(0) : ap && ap.total.greaterThan(0) ? ap.paid.mul(total).div(ap.total) : ownSum;
    const ls = lotsOf.get(p.id) ?? [];
    const status: PurchaseStatus = cancelled ? "CANCELLED" : p.status === "RECEIVED" ? "RECEIVED" : "DRAFT";
    const items = p.items.map((i) => {
      const lot = i.lotId ? lotById.get(i.lotId) : undefined;
      const q = num(i.quantity);
      const sum = num(itemTotalInclVat(i, p.exchangeRate));
      const unit = i.rawMaterial.unit === "M" ? ("м" as const) : ("шт." as const);
      return {
        id: i.id, lotId: i.lotId, material: i.rawMaterial.name, unit, qty: q, lot: i.lotNumber,
        color: lot && lot.color !== NOT_SET ? lot.color : null, size: lot && lot.size !== NOT_SET ? lot.size : null, grade: lot?.grade || null,
        sum, priceRub: q > 0 ? sum / q : null, priceUsd: lot?.usdPrice ?? null,
        recv: lot ? lot.recv : null, used: lot?.used ?? 0, rem: lot?.rem ?? 0,
        usages: (lot?.usages ?? []).map((u) => ({ orderId: u.orderId, number: u.number, qty: u.qty, sum: u.incl })),
      };
    });
    const unitIsM = (i: (typeof items)[number]) => i.unit === "м";
    return {
      id: p.id, number: p.number, date: formatDate(p.orderDate), year: p.orderDate.getUTCFullYear(),
      batchKey: an ?? "none", batchLabel: an ? shortAuctionName(firstLine(p.auctionSession)) : "Без аукциона", auction: an,
      supplier: p.supplier.name, invoice: p.invoiceNumber && !isServiceAuction(p.invoiceNumber) ? p.invoiceNumber : null, status,
      total: num(total), totalExcl: num(purchaseTotalExclVat(p)), paid: num(paidShare), rest: cancelled ? 0 : num(total.sub(paidShare)),
      paidBatch: num(paidShare.sub(own.length > 0 ? ownSum : 0)),
      lots: p.items.length, fur: items.filter((i) => !unitIsM(i)).reduce((a, i) => a + i.qty, 0), lining: items.filter(unitIsM).reduce((a, i) => a + i.qty, 0),
      usedValue: ls.reduce((a, l) => a + l.usedIncl, 0), recvValue: ls.reduce((a, l) => a + l.recvIncl, 0), hasLots: ls.length > 0,
      remFur: ls.filter((l) => l.kind === "fur").reduce((a, l) => a + l.rem, 0), remLining: ls.filter((l) => l.kind === "lining").reduce((a, l) => a + l.rem, 0),
      items,
      expenses: p.expenses.map((e) => ({ id: e.id, label: e.category.name + (e.description ? ` · ${e.description}` : ""), sum: num(grossUp(e.amount, e.vatRate)) })),
      pays: own.map((x) => ({ id: x.id, date: formatDate(x.paidAt), amount: num(x.amount), doc: x.docRef?.trim() || null })),
    };
  });

  // Фильтры по лотам и оплате — в памяти: закупка подходит, если ЕЁ лот подходит под все выбранные признаки лота (цвет, размер, признак меха, остаток, использование).
  const lotFilter = { ...emptyFilters(), color: f.color, size: f.size, attr: f.attr, rest: f.rest, usage: f.usage };
  const lotFilterOn = f.color.length + f.size.length + f.attr.length + f.rest.length + f.usage.length > 0;
  const payOf = (p: TreePurchase): "paid" | "partial" | "unpaid" => (p.rest <= 0.005 ? "paid" : p.paid <= 0.005 ? "unpaid" : "partial");
  const rows = all.filter((p) => {
    if (lotFilterOn && filterLots(lotsOf.get(p.id) ?? [], lotFilter).length === 0) return false;
    if (f.pay.length && (p.status === "CANCELLED" || !f.pay.includes(payOf(p)))) return false;
    return true;
  });

  // Итоги — по ВСЕМ закупкам выборки (не только по показанным строкам).
  const tot = aggregate(rows);
  const live = rows.filter((p) => p.status !== "CANCELLED");
  // Без фильтров к закупкам добавляются шкуры подрядчика (оплачены в составе пошива): тогда итог совпадает с Главной и «Оплатами».
  const hidesAll = !filtersOn ? new Decimal((await loadPaymentsOverview(orgId)).filter((r) => year === "all" || r.year === Number(year)).reduce((a, r) => a + r.hides, 0)) : new Decimal(0);
  const hides = hidesAll.toNumber();

  // Часть закупки по виду (мех / подкладка): кол-во и позиции вида; сумма, оплата и долг — по доле стоимости позиций вида (расходы — пропорционально).
  // Закупка со смешанным составом попадает в обе секции своей частью; Σ секций = итог.
  const partOf = (p: TreePurchase, kind: "fur" | "lining"): TreePurchase | null => {
    const its = p.items.filter((i) => (i.unit === "м") === (kind === "lining"));
    if (its.length === 0) return null;
    const allSum = p.items.reduce((a, i) => a + i.sum, 0);
    const sh = allSum > 0 ? its.reduce((a, i) => a + i.sum, 0) / allSum : its.length / p.items.length;
    const ls = (lotsOf.get(p.id) ?? []).filter((l) => l.kind === kind);
    return {
      ...p, items: its, lots: its.length, fur: kind === "fur" ? p.fur : 0, lining: kind === "lining" ? p.lining : 0,
      total: p.total * sh, totalExcl: p.totalExcl * sh, paid: p.paid * sh, rest: p.rest * sh, paidBatch: p.paidBatch * sh,
      usedValue: ls.reduce((a, l) => a + l.usedIncl, 0), recvValue: ls.reduce((a, l) => a + l.recvIncl, 0), hasLots: ls.length > 0,
      remFur: kind === "fur" ? ls.reduce((a, l) => a + l.rem, 0) : 0, remLining: kind === "lining" ? ls.reduce((a, l) => a + l.rem, 0) : 0,
    };
  };
  // Округление: у лота цена за единицу хранится округлённой, поэтому Σ лотов (так считает Главная) чуть отличается от Σ закупок по документам.
  // Без фильтров показываем разницу отдельной строкой — тогда «Всего» совпадает с Главной до рубля.
  const roundOf = (kind: "fur" | "lining") => {
    if (filtersOn) return 0;
    const lotsSum = (kind === "fur" ? furLots : liningLots).filter((l) => l.purchaseId && all.some((p) => p.id === l.purchaseId && p.status !== "CANCELLED")).reduce((a, l) => a + l.recvIncl, 0);
    const docs = all.filter((p) => p.status === "RECEIVED").reduce((a, p) => a + (partOf(p, kind)?.total ?? 0), 0);
    const d = lotsSum - docs;
    return Math.abs(d) < 0.005 ? 0 : d;
  };
  const roundFur = roundOf("fur"), roundLin = roundOf("lining");
  const hidesRow: ExtraRow[] = hides > 0.5 ? [{
    key: "hides", label: "Шкуры подрядчика", sub: "оплачены в составе счетов за пошив", href: "/lots/contractor-hides", sum: hides, paid: hides,
    note: <>Шкуры подрядчика (партии 7 и 8): оплачены в составе счетов за пошив, закупки на них нет, в ТЗ не списаны. Есть на Главной в «Сырьё — мех» (использовано). Страница ↗ — детализация.</>,
  }] : [];
  const roundRow = (key: string, v: number): ExtraRow[] => (v !== 0 ? [{
    key, label: "Округление", sum: v, paid: 0,
    note: "Лоты хранят цену за единицу округлённой, поэтому сумма лотов (так считает Главная) отличается от суммы закупок по документам на копейки. Строка закрывает разницу: «Всего» = Главная.",
  }] : []);
  const furExtras = [...hidesRow, ...roundRow("round-fur", roundFur)];
  const liningExtras = roundRow("round-lin", roundLin);
  const boughtTotal = tot.total + hides + roundFur + roundLin;
  const boughtExcl = tot.totalExcl + hides + roundFur + roundLin;
  const paidTotal = tot.paid + hides;
  const restRaw = tot.rest;
  const restTotal = Math.abs(restRaw) <= 0.5 ? 0 : restRaw;

  // Дерево «год → партия → закупка → позиции / расходы / оплаты».
  const treeYears: TreeYear[] = [];
  if (tree) {
    const byYear = new Map<number, Map<string, TreeBatch & { first: string }>>();
    for (const p of rows) {
      const batches = byYear.get(p.year) ?? new Map();
      const ap = auctionPays.get(p.auction ?? "");
      const b = batches.get(p.batchKey) ?? {
        key: p.batchKey, label: p.batchLabel, title: p.auction ?? undefined,
        href: ap ? `/payments?auction=${encodeURIComponent(ap.name)}#auction-block` : undefined,
        docsHref: p.auction ? `/documents?auction=${encodeURIComponent(p.auction)}` : undefined,
        purchases: [], first: "",
      };
      b.purchases.push(p);
      batches.set(p.batchKey, b);
      byYear.set(p.year, batches);
    }
    for (const [y, batches] of [...byYear].sort((a, b) => a[0] - b[0])) {
      const list = [...batches.values()];
      for (const b of list) b.purchases.sort((x, z) => x.number.localeCompare(z.number, "ru", { numeric: true }));
      list.sort((a, b) => Number(a.key === "none") - Number(b.key === "none") || a.purchases[0].number.localeCompare(b.purchases[0].number, "ru", { numeric: true }));
      treeYears.push({ year: y, batches: list.map(({ first: _f, ...rest }) => rest) });
    }
  }

  // «Списком»: сортировка по клику на заголовок (параметры sort / dir), по умолчанию — № закупки по убыванию.
  const sortKey = f.sort || "number";
  const sortDir: "asc" | "desc" = f.dir === "asc" ? "asc" : f.dir === "desc" ? "desc" : sortKey === "number" ? "desc" : "asc";
  const usedPct = (p: TreePurchase) => (p.hasLots && p.recvValue > 0.5 ? p.usedValue / p.recvValue : -1);
  const SORT: Record<string, (p: TreePurchase) => number | string> = {
    number: (p) => p.number, year: (p) => p.year, batch: (p) => p.batchLabel, supplier: (p) => p.supplier, date: (p) => p.date.split(".").reverse().join(""), status: (p) => p.status,
    lots: (p) => p.lots, fur: (p) => p.fur, lining: (p) => p.lining, total: (p) => p.total, paid: (p) => p.paid, rest: (p) => p.rest, used: usedPct, rem: (p) => p.remFur + p.remLining,
  };
  const collator = new Intl.Collator("ru", { numeric: true });
  const sorted = [...rows].sort((a, b) => {
    const x = (SORT[sortKey] ?? SORT.number)(a), y = (SORT[sortKey] ?? SORT.number)(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
    return (sortDir === "asc" ? c : -c) || collator.compare(b.number, a.number);
  });
  const listRows = sorted.slice(0, limit);
  const hasMore = sorted.length > limit;
  const secOf = (kind: "fur" | "lining") => sorted.map((p) => partOf(p, kind)).filter((p): p is TreePurchase => p != null);
  const sections = ([["fur", "Мех — закупки", "шт."], ["lining", "Подкладка — закупки", "м"]] as const).filter(([k]) => !f.sec || f.sec === k).map(([k, title, unit]) => ({ k, title, unit, all: secOf(k) }));
  const sortHrefs = Object.fromEntries(
    Object.keys(SORT).map((k) => [k, filterHref(PURCHASE_FILTERS_ALL, "/purchases", f, { sort: k, dir: sortKey === k && sortDir === (k === "number" ? "desc" : "asc") ? (k === "number" ? "asc" : "desc") : k === "number" ? "desc" : "asc", limit: "" })]),
  );
  const moreHref = filterHref(PURCHASE_FILTERS_ALL, "/purchases", f, { limit: String(limit + PAGE) });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center">
          <h1 className="text-xl font-semibold">Закупки</h1>
          <YearNote year={year} />
          <span className="ml-2 inline-flex">
          <InfoHint label="О странице «Закупки»" wide>
            <p>Закупки сырья и подкладки: поставщик, партия закупки, счёт, сумма и оплата, использование лотов в ТЗ. Откройте закупку, чтобы увидеть позиции, расходы, расчёт цены и документы.</p>
            <p className="mt-1">
              Год ({year === "all" ? "все годы" : year}): по дате заказа закупки. Поля «с / по» сужают выбор внутри года.
            </p>
            <p className="mt-1">
              Оплаты закупок внутри одной партии закупки ведутся по партии целиком — «оплачено из» показывает сумму всего аукциона. «Принято на склад» — по закупке уже созданы лоты сырья.
            </p>
            <p className="mt-1">4% к закупкам, оплатам и долгу поставщику не применяется — это наценка на сырьё и подкладку в ТЗ.</p>
          </InfoHint>
          </span>
        </div>
      </div>

      <PurchasesTabs />

      <div className="print:hidden">
        <FilterBar
          title="Фильтры закупок"
          oneRow
          hideChips
          controls={[
            { type: "multi", name: "pyear", label: "Год закупки", aliases: ["py"], options: opts.pyear, allLabel: "Все годы", hint: "Дополнительно к году в шапке: сужает выбор внутри него" },
            { type: "multi", name: "auction", label: "Партия закупки (аукцион)", aliases: ["auc"], options: opts.auction, noneLabel: "Без аукциона", allLabel: "Все партии" },
            { type: "multi", name: "supplier", label: "Поставщик", options: opts.supplier, allLabel: "Все поставщики" },
            { type: "multi", name: "fur", label: "Вид меха", aliases: ["kind"], options: opts.fur, allLabel: "Все виды" },
            { type: "multi", name: "color", label: "Цвет", options: opts.color, allLabel: "Все цвета", hint: "Закупка подходит, если у неё есть лот этого цвета" },
            { type: "multi", name: "size", label: "Размер", options: sizeOptions, noneLabel: "Размер не указан", allLabel: "Все размеры", hint: "Закупка подходит, если у неё есть лот этого размера" },
            { type: "text", name: "q", label: "Поиск", aliases: ["dq"], placeholder: "№ закупки, счёт, поставщик, лот" },
            { type: "multi", name: "status", label: "Статус закупки", options: STATUS_OPTIONS, allLabel: "Все статусы", more: true },
            { type: "multi", name: "pay", label: "Оплата", options: PAY_OPTIONS, allLabel: "Любая", more: true, hint: "Оплата закупки с учётом доли оплат её партии" },
            { type: "multi", name: "usage", label: "Использование", options: USAGE_OPTIONS, allLabel: "Любое", more: true, hint: "Закупка подходит, если есть лот, использованный (не использованный) в ТЗ" },
            { type: "multi", name: "rest", label: "Остаток", options: REST_OPTIONS, allLabel: "Любой", more: true, hint: "Закупка подходит, если есть лот с остатком (или исчерпанный)" },
            { type: "multi", name: "attr", label: "Признак меха", options: opts.attr, noneLabel: "Без признака", allLabel: "Все признаки", more: true },
            { type: "multi", name: "verified", label: "Подтверждение", options: VERIFIED_OPTIONS, allLabel: "Любое", more: true },
            { type: "multi", name: "vat", label: "НДС", aliases: ["nds"], options: VAT_OPTIONS, allLabel: "Любая ставка", more: true },
            { type: "date", name: "from", label: "Дата с", more: true },
            { type: "date", name: "to", label: "Дата по", more: true },
          ]}
          resetExtra={["sort", "dir"]}
        />
      </div>

      <WidgetRow id="purchases" title="Закупки — итоги" headerEnd={<Link href="/payments" className="text-xs text-blue-700 hover:underline print:hidden">→ Оплаты</Link>}>
        <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-[repeat(6,minmax(0,1fr))_10rem]" data-testid="purchases-totals">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:col-span-6 xl:grid-cols-6 print:grid-cols-6">
            <div className={TILE_BOX}>
              <TileHead>Закупок</TileHead>
              <TileValue compact>{tot.purchases}</TileValue>
              <TileCaption>{tot.draft > 0 ? `из них черновиков: ${tot.draft}` : "все приняты на склад"}</TileCaption>
            </div>
            <div className={TILE_BOX}>
              <TileHead>Лотов</TileHead>
              <TileValue compact>{tot.lots}</TileValue>
              <TileCaption>позиций закупок</TileCaption>
            </div>
            <div className={TILE_BOX}>
              <TileHead>Шкур, шт.</TileHead>
              <TileValue compact>{formatQty(tot.fur)}</TileValue>
              <TileCaption>{tot.lining > 0 ? `подкладка: ${formatQty(tot.lining)} м` : "подкладки нет"}</TileCaption>
            </div>
            <div className={TILE_BOX}>
              <TileHead><VatLabel base="Куплено" /></TileHead>
              <div className="absolute right-3 top-3">
                <InfoHint label="О «Куплено»" align="right">
                  <p>Стоимость закупок выборки: позиции плюс расходы закупки. Без фильтров к ним добавлены шкуры подрядчика (оплачены в составе пошива) — тогда итог совпадает с «Общая стоимость» сырья на Главной и в Оплатах. Отменённые закупки не входят.</p>
                </InfoHint>
              </div>
              <TileValue compact><Money incl={boughtTotal.toFixed(2)} excl={boughtExcl.toFixed(2)} /></TileValue>
              <TileCaption>{hides > 0.5 ? `с шкурами подрядчика ${formatMoney(hides.toFixed(2))}` : "позиции + расходы"}</TileCaption>
            </div>
            <div className={TILE_BOX}>
              <TileHead>Оплачено</TileHead>
              <TileValue compact>{formatMoney(paidTotal.toFixed(2))}</TileValue>
              <TileCaption>{boughtTotal > 0 ? `${formatPercent((paidTotal / boughtTotal) * 100)} от куплено · с НДС` : "всегда с НДС"}</TileCaption>
            </div>
            <div className={TILE_BOX}>
              <TileHead>К оплате</TileHead>
              <TileValue compact className={restTotal > PAY_EPS.toNumber() ? "text-amber-700" : ""}>{formatMoney(restTotal.toFixed(2))}</TileValue>
              <TileCaption>{boughtTotal > 0 ? `${formatPercent((restTotal / boughtTotal) * 100)} от куплено · Куплено − Оплачено` : "Куплено − Оплачено"}</TileCaption>
            </div>
          </div>
          {/* Колонка действий справа. */}
          <div className="flex flex-row flex-wrap items-stretch gap-2 print:hidden xl:flex-col xl:flex-nowrap" aria-label="Действия">
            {canCreate ? <Link href="/purchases/new" className={`${buttonVariants()} flex-1 justify-center xl:flex-none`}>+ Новая закупка</Link> : null}
            {canCreate ? <Link href="/purchases/batch" className={`${buttonVariants({ variant: "outline" })} flex-1 justify-center xl:flex-none`}>Новая партия (мастер)</Link> : null}
            <Link href="/payments" className={`${buttonVariants({ variant: "outline" })} flex-1 justify-center xl:flex-none`}>Оплаты</Link>
            <Link href="/analytics/raw" className={`${buttonVariants({ variant: "outline" })} flex-1 justify-center xl:flex-none`}>Аналитика сырья</Link>
          </div>
        </div>
      </WidgetRow>

      <div role="tablist" aria-label="Вид таблицы закупок" className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
        <span>Вид:</span>
        {([["tree", "По годам и партиям"], ["list", "Списком"]] as const).map(([id, label]) => (
          <Link key={id} role="tab" aria-selected={(tree ? "tree" : "list") === id} href={filterHref(PURCHASE_FILTERS_ALL, "/purchases", f, { view: id === "tree" ? "" : "list", limit: "" })}
            className={"rounded-lg border px-3 py-1.5 text-xs " + ((tree ? "tree" : "list") === id ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50")}>{label}</Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 bg-white py-8 text-center text-neutral-600">
          {filtersOn ? "По этим фильтрам закупок нет" : emptyForYear(year, "закупок", "Закупок пока нет")}
          {filtersOn && (
            <Link href="/purchases" className="ml-2 font-medium text-neutral-900 underline underline-offset-4">
              Сбросить фильтры
            </Link>
          )}
        </p>
      ) : tree ? (
        <PurchasesTree years={treeYears} extras={[...furExtras, ...liningExtras]} />
      ) : (
        <>
          <div role="tablist" aria-label="Раздел списка" className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
            <span>Показать:</span>
            {([["", "Мех и подкладка"], ["fur", "Мех"], ["lining", "Подкладка"]] as const).map(([v, label]) => (
              <Link key={v} role="tab" aria-selected={(f.sec || "") === v} href={filterHref(PURCHASE_FILTERS_ALL, "/purchases", f, { sec: v, limit: "" })}
                className={"rounded-lg border px-3 py-1.5 text-xs " + ((f.sec || "") === v ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50")}>{label}</Link>
            ))}
            <InfoHint label="Как разделены мех и подкладка" wide>
              <p>Закупки меха (шкуры, шт.) и подкладки (метры) — отдельные таблицы со своими единицами, итогом и сортировкой; фильтры общие. Закупка из меха и подкладки попадает в обе таблицы своей частью: кол-во и позиции вида, сумма, оплата и долг — по доле стоимости позиций вида. Σ таблиц = общий итог.</p>
            </InfoHint>
          </div>
          {sections.map((sec) => {
            const rowsSec = sec.all.slice(0, limit);
            const a = aggregate(sec.all);
            const ex = sec.k === "fur" ? furExtras : liningExtras;
            const exSum = ex.reduce((x, e) => x + e.sum, 0);
            const q = sec.k === "fur" ? a.fur : a.lining;
            return (
              <div key={sec.k} className="space-y-3">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid={`tiles-${sec.k}`}>
                  <div className={TILE_BOX}><TileHead>Закупок</TileHead><TileValue compact>{a.purchases}</TileValue><TileCaption>{sec.k === "fur" ? "с мехом" : "с подкладкой"}</TileCaption></div>
                  <div className={TILE_BOX}><TileHead>{sec.k === "fur" ? "Шкур, шт." : "Подкладка, м"}</TileHead><TileValue compact>{formatQty(q)}</TileValue><TileCaption>{a.lots} позиций</TileCaption></div>
                  <div className={TILE_BOX}><TileHead>Сумма, ₽</TileHead><TileValue compact>{formatMoney((a.total + exSum).toFixed(2))}</TileValue><TileCaption>{ex.length ? "с шкурами подрядчика и округлением" : "с НДС"}</TileCaption></div>
                  <div className={TILE_BOX}><TileHead>Долг, ₽</TileHead><TileValue compact className={a.rest > 0.5 ? "text-amber-700" : ""}>{formatMoney(a.rest.toFixed(2))}</TileValue><TileCaption>Сумма − оплачено</TileCaption></div>
                </div>
                <PurchasesList
                  id={`pur-list-${sec.k}`}
                  title={sec.title}
                  unitLabel={sec.unit}
                  rows={rowsSec}
                  allRows={sec.all}
                  extras={ex}
                  sort={{ key: sortKey, dir: sortDir }}
                  sortHrefs={sortHrefs}
                  footer={sec.all.length > limit ? <Link href={moreHref} className={buttonVariants({ variant: "outline", size: "sm" })}>Показать ещё {PAGE}</Link> : null}
                />
              </div>
            );
          })}
        </>
      )}
      <span className="hidden">{live.length}</span>
    </div>
  );
}
