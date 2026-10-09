import { isServiceAuction, shortAuctionName } from "@/lib/auction-names";
import { WidgetRow } from "@/components/widget-row";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatDate, formatQty } from "@/lib/utils";
import { purchaseTotalInclVat, purchaseTotalExclVat, itemTotalInclVat, grossUp } from "@/lib/purchase-totals";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { Money } from "@/components/money";
import { docCounts } from "@/lib/doc-links";
import { VatLabel } from "@/components/vat-label";
import { FilterBar } from "@/components/filters/filter-bar";
import { activeCount, defineFilters, filterHref, parseFilters, pick, toWhere, dateRange } from "@/lib/filters";
import { furMaterialIdsByKind, getFilterOptions, purchaseIdsByAuction } from "@/lib/filter-options";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { loadAuctionSummaries, auctionName, PAY_EPS } from "@/lib/auction-payments";
import { escapeLike } from "@/lib/input";
import { getYearFilter } from "@/lib/year-filter";
import { purchaseYear } from "@/lib/year-scope";
import { YearNote, emptyForYear } from "@/components/year-note";
import { InfoHint } from "@/components/info-hint";
import { PurchasesTabs } from "@/components/raw-tabs";
import { loadPaymentsOverview } from "@/lib/payments-overview";
import { TILE_BOX, TileHead, TileValue, TileCaption } from "../dashboard/tile";
import { PurchasesTree, type TreeBatch, type TreeYear } from "./purchases-tree";

// Two states in the UI (existing ORDERED / IN_TRANSIT rows show as a draft).
function firstLine(v: string | null) {
  return (v ?? "").split(/\r?\n/)[0].trim();
}

export const metadata = { title: "Закупки" };

const PURCHASE_FILTERS = defineFilters({
  ...pick(["auction", "status", "supplier", "fur", "verified", "vat", "pyear", "q", "from", "to", "view"], {
    view: { allowed: ["tree", "list"] },
    status: { allowed: ["DRAFT", "RECEIVED", "CANCELLED"] },
    verified: { allowed: ["yes", "no"], label: "Подтверждение" },
    vat: { label: "НДС" },
  }),
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

export default async function PurchasesPage({ searchParams }: PageProps<"/purchases">) {
  const session = await requireSession();
  const sp = await searchParams;
  const year = await getYearFilter();
  const canCreate = ["OWNER", "ADMIN", "PURCHASER"].includes(session.user.role);
  const orgId = session.user.organizationId;
  const f = parseFilters(PURCHASE_FILTERS, sp);
  const PAGE = 50;
  // Вид: «По годам и партиям» (дерево, по умолчанию) или «Списком» (плоская таблица с постраничным «Показать ещё»).
  const tree = f.view !== "list";
  const limitRaw = Number(f.limit || PAGE);
  const limit = tree ? 2000 : Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), PAGE), 2000) : PAGE;
  const filtersOn = activeCount(PURCHASE_FILTERS, f) > 0;

  // Партия закупки: точное название (как в списке) либо — для старых ссылок — вхождение в название; none — «Без аукциона».
  const auctionIds = f.auction.length ? await purchaseIdsByAuction(orgId, f.auction) : null;
  // Вид меха: закупки с позицией, чей материал относится к выбранному виду.
  const furMaterialIds = f.fur.length ? await furMaterialIdsByKind(orgId, f.fur) : [];
  const vatKinds = new Set(f.vat.map((v) => (v === "mix" ? "mixed" : v)));
  const vatWhere = (k: string): Prisma.PurchaseWhereInput =>
    k === "mixed"
      ? { AND: [{ items: { some: { vatRate: 20 } } }, { items: { some: { vatRate: 22 } } }] }
      : { items: { some: { vatRate: Number(k) } }, NOT: { items: { some: { vatRate: { not: Number(k) } } } } };
  const where: Prisma.PurchaseWhereInput = {
    organizationId: orgId,
    AND: [
      // Общий год — по дате заказа закупки (дальше сужают «год закупки» и «с / по»).
      purchaseYear(year),
      ...toWhere<typeof f, Prisma.PurchaseWhereInput>(f, {
        // Two states in the UI: everything not received/cancelled is a draft.
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
  const purchases = await prisma.purchase.findMany({
    where,
    include: {
      supplier: true,
      items: { include: { rawMaterial: true } },
      expenses: { include: { category: true } },
      payments: true,
    },
    // Numbers are З-YYYY-NNNN (zero-padded), so a string sort is numeric.
    orderBy: { number: "desc" },
    take: limit + 1, // +1 — чтобы понять, есть ли ещё
  });
  const hasMore = purchases.length > limit;
  if (hasMore) purchases.length = limit;
  // Поставщик в списке — только если их несколько (иначе колонка повторяет одно и то же).
  const multiSupplier = new Set(purchases.map((p) => p.supplier.id)).size > 1;
  const moreHref = filterHref(PURCHASE_FILTERS, "/purchases", f, { limit: String(limit + PAGE) });

  // Оплаты по закупкам с аукционом ведутся по аукциону целиком — «оплачено» берём оттуда.
  const pageAuctionNames = [...new Set(purchases.map((p) => auctionName(p.auctionSession)).filter((n): n is string => !!n))];
  const auctionPays = new Map(
    (pageAuctionNames.length ? await loadAuctionSummaries(prisma, session.user.organizationId, pageAuctionNames) : []).map((a) => [a.name, a]),
  );


  const opts = await getFilterOptions(orgId, year, ["auction", "pyear", "supplier", "fur"]);

  // Итоги — по ВСЕМ закупкам выборки (а не только по показанным строкам): куплено, оплачено, остаток.
  const allPurchases = await prisma.purchase.findMany({ where, include: { items: true, expenses: true, payments: true } });
  const allAuctionNames = [...new Set(allPurchases.map((p) => auctionName(p.auctionSession)).filter((n): n is string => !!n))];
  const allAuctionPays = new Map((allAuctionNames.length ? await loadAuctionSummaries(prisma, session.user.organizationId, allAuctionNames) : []).map((a) => [a.name, a]));
  let bought = new Decimal(0), boughtExcl = new Decimal(0), paidAll = new Decimal(0);
  for (const p of allPurchases) {
    if (p.status === "CANCELLED") continue;
    const t = purchaseTotalInclVat(p);
    const ap = allAuctionPays.get(auctionName(p.auctionSession) ?? "");
    bought = bought.add(t);
    boughtExcl = boughtExcl.add(purchaseTotalExclVat(p));
    paidAll = paidAll.add(ap && ap.total.greaterThan(0) ? ap.paid.mul(t).div(ap.total) : p.payments.filter((x) => x.status === "COMPLETED").reduce((a, x) => a.add(x.amount), new Decimal(0)));
  }
  // Без фильтров к закупкам добавляются шкуры подрядчика (оплачены в составе пошива): тогда итог совпадает с Главной и «Оплатами».
  const hidesAll = !filtersOn ? new Decimal((await loadPaymentsOverview(orgId)).filter((r) => year === "all" || r.year === Number(year)).reduce((a, r) => a + r.hides, 0)) : new Decimal(0);
  const boughtTotal = bought.add(hidesAll);
  const paidTotal = paidAll.add(hidesAll);
  const restTotal = boughtTotal.sub(paidTotal);

  // Дерево «год → партия → закупка → позиции / расходы / оплаты»: те же суммы, что в списке.
  const treeYears: TreeYear[] = [];
  if (tree) {
    const byYear = new Map<number, Map<string, TreeBatch & { first: number }>>();
    for (const p of purchases) {
      const total = purchaseTotalInclVat(p);
      const own = p.payments.filter((x) => x.status === "COMPLETED");
      const ownSum = own.reduce((a, x) => a.add(x.amount), new Decimal(0));
      const cancelled = p.status === "CANCELLED";
      const an = auctionName(p.auctionSession);
      const ap = auctionPays.get(an ?? "");
      const paidShare = cancelled ? new Decimal(0) : ap && ap.total.greaterThan(0) ? ap.paid.mul(total).div(ap.total) : ownSum;
      const y = p.orderDate.getUTCFullYear();
      const bk = an ?? "none";
      const batches = byYear.get(y) ?? new Map();
      const b = batches.get(bk) ?? { key: bk, label: an ? shortAuctionName(firstLine(p.auctionSession)) : "Без аукциона", title: an ?? undefined, href: ap ? `/payments?auction=${encodeURIComponent(ap.name)}#auction-block` : undefined, purchases: [], first: p.orderDate.getTime() };
      b.first = Math.min(b.first, p.orderDate.getTime());
      b.purchases.push({
        id: p.id, number: p.number, date: formatDate(p.orderDate), supplier: p.supplier.name, invoice: p.invoiceNumber && !isServiceAuction(p.invoiceNumber) ? p.invoiceNumber : null,
        cancelled, received: p.status === "RECEIVED",
        total: total.toNumber(), paid: paidShare.toNumber(), rest: cancelled ? 0 : total.sub(paidShare).toNumber(),
        paidBatch: paidShare.sub(own.length > 0 ? ownSum : 0).toNumber(),
        items: p.items.map((i) => ({ id: i.id, lotId: i.lotId, label: i.rawMaterial.name, lot: i.lotNumber, qty: `${formatQty(i.quantity.toString())} ${i.rawMaterial.unit === "M" ? "м" : "шт."}`, sum: itemTotalInclVat(i, p.exchangeRate).toNumber() })),
        expenses: p.expenses.map((e) => ({ id: e.id, label: e.category.name + (e.description ? ` · ${e.description}` : ""), sum: grossUp(e.amount, e.vatRate).toNumber() })),
        pays: own.map((x) => ({ id: x.id, date: formatDate(x.paidAt), amount: x.amount.toNumber(), doc: x.docRef?.trim() || null })),
      });
      batches.set(bk, b);
      byYear.set(y, batches);
    }
    for (const [year, batches] of [...byYear].sort((a, b) => a[0] - b[0])) {
      const list = [...batches.values()].sort((a, b) => Number(a.key === "none") - Number(b.key === "none") || a.first - b.first || a.label.localeCompare(b.label, "ru", { numeric: true }));
      for (const b of list) b.purchases.sort((x, y2) => x.number.localeCompare(y2.number, "ru", { numeric: true }));
      treeYears.push({ year, batches: list.map(({ first: _f, ...rest }) => rest) });
    }
  }

  // Сумма аукциона одна на все его закупки: полностью — в первой строке аукциона, дальше короткая подпись.

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {/* Значок «i» и метка года — рядом с заголовком, а не внутри него: иначе название заголовка читается как «Закупки О странице…». */}
        <div className="flex flex-wrap items-center">
          <h1 className="text-xl font-semibold">Закупки</h1>
          <YearNote year={year} />
          <span className="ml-2 inline-flex">
          <InfoHint label="О странице «Закупки»" wide>
            <p>Список закупок сырья и подкладки: поставщик, партия закупки, счёт, сумма и оплата. Откройте закупку, чтобы увидеть позиции, расходы, расчёт цены и документы.</p>
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
        {/* Телефон: главное действие — первым и на всю ширину, второстепенные ниже в ряд. */}
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/payments" className={`${buttonVariants({ variant: "outline" })} max-md:flex-1`}>
            Оплаты
          </Link>
          {canCreate && (
            <>
              <Link href="/purchases/batch" className={`${buttonVariants({ variant: "outline" })} max-md:flex-1`}>
                Новая партия (мастер)
              </Link>
              <Link href="/purchases/new" className={`${buttonVariants()} max-md:order-first max-md:w-full`}>
                + Новая закупка
              </Link>
            </>
          )}
        </div>
      </div>

      <PurchasesTabs />

      <FilterBar
        title="Фильтры закупок"
        controls={[
          { type: "text", name: "q", label: "Поиск", aliases: ["dq"], placeholder: "№ закупки, счёт, поставщик, лот" },
          { type: "multi", name: "auction", label: "Партия закупки (аукцион)", aliases: ["auc"], options: opts.auction, noneLabel: "Без аукциона", allLabel: "Все партии" },
          { type: "multi", name: "status", label: "Статус", options: STATUS_OPTIONS, allLabel: "Все статусы" },
          { type: "multi", name: "supplier", label: "Поставщик", options: opts.supplier },
          { type: "multi", name: "fur", label: "Вид меха", aliases: ["kind"], options: opts.fur },
          { type: "multi", name: "verified", label: "Подтверждение", options: VERIFIED_OPTIONS, allLabel: "Любое" },
          { type: "multi", name: "vat", label: "НДС", aliases: ["nds"], options: VAT_OPTIONS, allLabel: "Любая ставка" },
          { type: "multi", name: "pyear", label: "Год закупки", aliases: ["py"], options: opts.pyear, hint: "Дополнительно к году в шапке: сужает выбор внутри него" },
          { type: "date", name: "from", label: "Дата с" },
          { type: "date", name: "to", label: "Дата по" },
        ]}
      />

      <WidgetRow id="purchases" title="Закупки — итоги">
      <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-3 print:grid-cols-3" data-testid="purchases-totals">
        <div className={TILE_BOX}>
          <TileHead><VatLabel base="Куплено" /></TileHead>
          <div className="absolute right-3 top-3">
            <InfoHint label="О «Куплено»" align="right">
              <p>Стоимость закупок выборки: позиции плюс расходы закупки. Без фильтров к ним добавлены шкуры подрядчика (оплачены в составе пошива) — тогда итог совпадает с «Общая стоимость» сырья на Главной и в Оплатах. Отменённые закупки не входят.</p>
            </InfoHint>
          </div>
          <TileValue><Money incl={boughtTotal} excl={boughtExcl.add(hidesAll)} /></TileValue>
          <TileCaption>{allPurchases.filter((p) => p.status !== "CANCELLED").length} закупок{hidesAll.greaterThan(0) ? ` · с шкурами подрядчика ${formatMoney(hidesAll.toFixed(2))}` : ""}</TileCaption>
        </div>
        <div className={TILE_BOX}>
          <TileHead>Оплачено</TileHead>
          <TileValue>{formatMoney(paidTotal.toFixed(2))}</TileValue>
          <TileCaption>{boughtTotal.greaterThan(0) ? `${paidTotal.div(boughtTotal).mul(100).toNumber().toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% от куплено · всегда с НДС` : "всегда с НДС"}</TileCaption>
        </div>
        <div className={TILE_BOX}>
          <TileHead>К оплате</TileHead>
          <TileValue className={restTotal.greaterThan(PAY_EPS) ? "text-amber-700" : ""}>{formatMoney(restTotal.toFixed(2))}</TileValue>
          <TileCaption>{boughtTotal.greaterThan(0) ? `${restTotal.div(boughtTotal).mul(100).toNumber().toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% от куплено · Куплено − Оплачено` : "Куплено − Оплачено"}</TileCaption>
        </div>
      </div>
      </WidgetRow>

      <div role="tablist" aria-label="Вид таблицы закупок" className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
        <span>Вид:</span>
        {([["tree", "По годам и партиям"], ["list", "Списком"]] as const).map(([id, label]) => (
          <Link key={id} role="tab" aria-selected={(tree ? "tree" : "list") === id} href={filterHref(PURCHASE_FILTERS, "/purchases", f, { view: id === "tree" ? "" : "list", limit: "" })}
            className={"rounded-lg border px-3 py-1.5 text-xs " + ((tree ? "tree" : "list") === id ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50")}>{label}</Link>
        ))}
      </div>

      {tree ? <PurchasesTree years={treeYears} hides={hidesAll.toNumber()} /> : (
      <ResponsiveRows
        table={
      <Table anchor="table:purchases" label="Таблица закупок" stickyHeader>
        <Thead>
          <Tr>
            <Th>№</Th>
            {multiSupplier && <Th>Поставщик</Th>}
            <Th>Партия закупки</Th>
            <Th>Счёт</Th>
            <Th>Дата</Th>
            <Th className="text-right">Сумма</Th>
            <Th className="text-right">
              Оплачено
              <InfoHint label="Как читать «Оплачено»" align="right">
                Оплаты ведутся по партии закупки (аукциону) целиком. У закупки в партии показана её доля: оплачено партии × (сумма закупки ÷ сумма партии). Нажмите — откроется оплата партии.
              </InfoHint>
            </Th>
            <Th className="text-right">Остаток</Th>
          </Tr>
        </Thead>
        <Tbody>
          {purchases.map((p) => {
            const total = purchaseTotalInclVat(p);
            const totalExclVat = purchaseTotalExclVat(p);
            const paid = p.payments.filter((pay) => pay.status === "COMPLETED").reduce((s, pay) => s.add(pay.amount), new Decimal(0));
            const cancelled = p.status === "CANCELLED";
            const ap = auctionPays.get(auctionName(p.auctionSession) ?? "");
            // Доля оплаты партии, приходящаяся на закупку; без партии — её собственные оплаты.
            const paidShare = cancelled ? new Decimal(0) : ap && ap.total.greaterThan(0) ? ap.paid.mul(total).div(ap.total) : paid;
            const rest = cancelled ? new Decimal(0) : total.sub(paidShare);
            return (
              <Tr key={p.id} className={cancelled ? "text-neutral-400" : ""}>
                <Td className="font-medium">
                  <Link href={`/purchases/${p.id}`} className="hover:underline">
                    {p.number}
                  </Link>
                  {cancelled && <span className="ml-2 text-xs font-normal">отменена</span>}
                </Td>
                {multiSupplier && <Td>{p.supplier.name}</Td>}
                <Td className="max-w-[220px] truncate text-neutral-500" title={p.auctionSession ?? undefined}>
                  {p.auctionSession ? shortAuctionName(firstLine(p.auctionSession)) : "—"}
                </Td>
                <Td className="text-neutral-500">{p.invoiceNumber && !isServiceAuction(p.invoiceNumber) ? p.invoiceNumber : "—"}</Td>
                <Td>{formatDate(p.orderDate)}</Td>
                <Td className="text-right tabular-nums">
                  <Money incl={total} excl={totalExclVat} />
                </Td>
                <Td className="whitespace-nowrap text-right tabular-nums">
                  {cancelled ? "—" : ap ? (
                    <Link href={`/payments?auction=${encodeURIComponent(ap.name)}#auction-block`} className="hover:underline" title={`Оплаты ведутся по партии закупки «${ap.name}» целиком`}>
                      {formatMoney(paidShare.toFixed(2))}
                    </Link>
                  ) : (
                    formatMoney(paidShare.toFixed(2))
                  )}
                </Td>
                <Td className={"whitespace-nowrap text-right tabular-nums " + (!cancelled && rest.greaterThan(PAY_EPS) ? "text-amber-700" : rest.lessThan(0) ? "text-emerald-700" : "")} title={rest.lessThan(-PAY_EPS) ? "Оплачено больше стоимости закупки (переплата)" : undefined}>
                  {cancelled || rest.abs().lessThanOrEqualTo(PAY_EPS) ? "—" : rest.lessThan(0) ? `+${formatMoney(rest.abs().toFixed(2))}` : formatMoney(rest.toFixed(2))}
                </Td>
              </Tr>
            );
          })}
          {purchases.length === 0 && (
            <Tr>
              <Td colSpan={multiSupplier ? 9 : 8} className="py-8 text-center text-neutral-600">
                {filtersOn ? "По этим фильтрам закупок нет" : emptyForYear(year, "закупок", "Закупок пока нет")}
                {filtersOn && (
                  <Link href="/purchases" className="ml-2 font-medium text-neutral-900 underline underline-offset-4">
                    Сбросить фильтры
                  </Link>
                )}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
        }
      >
        {purchases.map((p) => {
          const total = purchaseTotalInclVat(p);
          const totalExclVat = purchaseTotalExclVat(p);
          const paid = p.payments.filter((pay) => pay.status === "COMPLETED").reduce((s, pay) => s.add(pay.amount), new Decimal(0));
          const cancelled = p.status === "CANCELLED";
          const ap = auctionPays.get(auctionName(p.auctionSession) ?? "");
          const paidShare = cancelled ? new Decimal(0) : ap && ap.total.greaterThan(0) ? ap.paid.mul(total).div(ap.total) : paid;
          const rest = cancelled ? new Decimal(0) : total.sub(paidShare);
          return (
            <RowCard
              key={p.id}
              title={p.number}
              href={`/purchases/${p.id}`}
              subtitle={p.supplier.name}
              fields={[
                { label: <VatLabel base="Сумма" />, value: <Money incl={total} excl={totalExclVat} />, strong: true },
                { label: "Оплачено", value: cancelled ? "—" : formatMoney(paidShare.toFixed(2)) },
                { label: "Остаток", value: cancelled || rest.abs().lessThanOrEqualTo(PAY_EPS) ? "—" : formatMoney(rest.toFixed(2)) },
                { label: "Дата", value: formatDate(p.orderDate) },
              ]}
              details={[
                { label: "Партия закупки", value: p.auctionSession ? shortAuctionName(firstLine(p.auctionSession)) : null },
                { label: "Счёт", value: p.invoiceNumber && !isServiceAuction(p.invoiceNumber) ? p.invoiceNumber : null },
              ]}
            />
          );
        })}
        {purchases.length === 0 && (
          <p className="py-8 text-center text-neutral-600">
            {filtersOn ? "По этим фильтрам закупок нет" : emptyForYear(year, "закупок", "Закупок пока нет")}
            {filtersOn && (
              <Link href="/purchases" className="ml-2 inline-block py-2 font-medium text-neutral-900 underline underline-offset-4">
                Сбросить фильтры
              </Link>
            )}
          </p>
        )}
      </ResponsiveRows>
      )}
      {!tree && hasMore && (
        <div className="flex justify-center">
          <Link href={moreHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Показать ещё {PAGE}
          </Link>
        </div>
      )}
      <div className={"flex items-center gap-1 text-xs text-neutral-600" + (tree ? " hidden" : "")}>
        Показано закупок: {purchases.length}{hasMore ? " из " + allPurchases.length : ""}
      </div>
    </div>
  );
}
