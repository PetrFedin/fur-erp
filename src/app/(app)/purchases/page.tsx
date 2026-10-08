import { isServiceAuction, shortAuctionName } from "@/lib/auction-names";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatDate } from "@/lib/utils";
import { purchaseTotalInclVat, purchaseTotalExclVat } from "@/lib/purchase-totals";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { Money } from "@/components/money";
import { DocBadge } from "@/components/doc-viewer";
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

// Two states in the UI (existing ORDERED / IN_TRANSIT rows show as a draft).
function firstLine(v: string | null) {
  return (v ?? "").split(/\r?\n/)[0].trim();
}

function statusView(status: string): { label: string; variant: "default" | "success" | "danger" } {
  if (status === "RECEIVED") return { label: "Принято на склад", variant: "success" };
  if (status === "CANCELLED") return { label: "Отменено", variant: "danger" };
  return { label: "Черновик", variant: "default" };
}

export const metadata = { title: "Закупки" };

const PURCHASE_FILTERS = defineFilters({
  ...pick(["auction", "status", "supplier", "fur", "verified", "vat", "pyear", "q", "from", "to"], {
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
  const limitRaw = Number(f.limit || PAGE);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), PAGE), 2000) : PAGE;
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
      expenses: true,
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

  const docCnt = await docCounts(session.user.organizationId, "purchase", purchases.map((p) => p.id));

  const opts = await getFilterOptions(orgId, year, ["auction", "pyear", "supplier", "fur"]);

  const live = purchases.filter((p) => p.status !== "CANCELLED");
  const sumIncl = live.reduce((s, p) => s.add(purchaseTotalInclVat(p)), new Decimal(0));
  const sumExcl = live.reduce((s, p) => s.add(purchaseTotalExclVat(p)), new Decimal(0));

  // Сумма аукциона одна на все его закупки: полностью — в первой строке аукциона, дальше короткая подпись.
  const shownTable = new Set<string>();
  const shownCards = new Set<string>();

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
            <Th>Статус</Th>
            <Th className="text-right">Сумма</Th>
            <Th className="text-right">
              Оплачено
              <InfoHint label="Как читать «Оплачено»" align="right">
                Если закупка входит в партию (аукцион), оплата ведётся по партии целиком: «из» — сумма всей партии, у остальных закупок этой партии — «↑ по партии». Нажмите — откроется оплата партии.
              </InfoHint>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {purchases.map((p) => {
            const total = purchaseTotalInclVat(p);
            const totalExclVat = purchaseTotalExclVat(p);
            const paid = p.payments.filter((pay) => pay.status === "COMPLETED").reduce((s, pay) => s.add(pay.amount), new Decimal(0));
            const status = statusView(p.status);
            const ap = auctionPays.get(auctionName(p.auctionSession) ?? "");
            const repeat = ap ? shownTable.has(ap.name) : false;
            if (ap) shownTable.add(ap.name);
            return (
              <Tr key={p.id}>
                <Td className="font-medium">
                  <Link href={`/purchases/${p.id}`} className="hover:underline">
                    {p.number}
                  </Link>{" "}
                  <DocBadge entity="purchase" id={p.id} count={docCnt.get(p.id)?.total ?? 0} title={`Закупка ${p.number}`} />
                </Td>
                {multiSupplier && <Td>{p.supplier.name}</Td>}
                <Td className="max-w-[220px] truncate text-neutral-500" title={p.auctionSession ?? undefined}>
                  {p.auctionSession ? shortAuctionName(firstLine(p.auctionSession)) : "—"}
                </Td>
                <Td className="text-neutral-500">{p.invoiceNumber && !isServiceAuction(p.invoiceNumber) ? p.invoiceNumber : "—"}</Td>
                <Td>{formatDate(p.orderDate)}</Td>
                <Td>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </Td>
                <Td className="text-right tabular-nums">
                  <Money incl={total} excl={totalExclVat} />
                </Td>
                <Td className="whitespace-nowrap text-right tabular-nums">
                  {ap ? (
                    <Link
                      href={`/payments?auction=${encodeURIComponent(ap.name)}#auction-block`}
                      className={`hover:underline ${ap.remaining.greaterThan(PAY_EPS) ? "text-amber-700" : "text-emerald-700"}`}
                      title={`Оплаты ведутся по партии закупки «${ap.name}» целиком`}
                    >
                      {repeat ? (
                        <span className="text-xs font-normal">↑ по партии</span>
                      ) : (
                        <>
                          <span className="block">{formatMoney(ap.paid.toString())}</span>
                          <span className="block text-xs font-normal text-neutral-600">из{formatMoney(ap.total.toString())}</span>
                        </>
                      )}
                    </Link>
                  ) : (
                    <span className={paid.lessThan(total) ? "text-amber-700" : "text-emerald-700"}>{formatMoney(paid.toString())}</span>
                  )}
                </Td>
              </Tr>
            );
          })}
          {purchases.length === 0 && (
            <Tr>
              <Td colSpan={multiSupplier ? 8 : 7} className="py-8 text-center text-neutral-600">
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
          const st = statusView(p.status);
          const ap = auctionPays.get(auctionName(p.auctionSession) ?? "");
          const repeat = ap ? shownCards.has(ap.name) : false;
          if (ap) shownCards.add(ap.name);
          const paidView = ap ? (
            <Link
              href={`/payments?auction=${encodeURIComponent(ap.name)}#auction-block`}
              className={`inline-block max-md:py-2 ${ap.remaining.greaterThan(PAY_EPS) ? "text-amber-700" : "text-emerald-700"}`}
            >
              {repeat ? "↑ по партии" : `${formatMoney(ap.paid.toString())} из ${formatMoney(ap.total.toString())}`}
            </Link>
          ) : (
            <span className={paid.lessThan(total) ? "text-amber-700" : "text-emerald-700"}>{formatMoney(paid.toString())}</span>
          );
          return (
            <RowCard
              key={p.id}
              title={p.number}
              href={`/purchases/${p.id}`}
              subtitle={p.supplier.name}
              badge={<Badge variant={st.variant}>{st.label}</Badge>}
              fields={[
                { label: <VatLabel base="Сумма" />, value: <Money incl={total} excl={totalExclVat} />, strong: true },
                { label: ap ? "По партии: оплачено" : "Оплачено", value: paidView },
                { label: "Дата", value: formatDate(p.orderDate) },
                { label: "Документы", value: <DocBadge entity="purchase" id={p.id} count={docCnt.get(p.id)?.total ?? 0} title={`Закупка ${p.number}`} /> },
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
      {hasMore && (
        <div className="flex justify-center">
          <Link href={moreHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Показать ещё {PAGE}
          </Link>
        </div>
      )}
      <div className="flex items-center gap-1 text-xs text-neutral-600">
        Показано закупок: {purchases.length}{hasMore ? " (есть ещё)" : ""}
        {purchases.length > 0 && (
          <>
            <span aria-hidden>·</span>
            <VatLabel base="сумма без отменённых" />:{" "}
            <b className="text-neutral-700">
              <Money incl={sumIncl} excl={sumExcl} />
            </b>
            <InfoHint label="Как считается сумма">
              Сумма всех показанных закупок, кроме отменённых (с НДС; переключатель НДС показывает без НДС): позиции × курс + расходы закупки. Считается только по показанным строкам{hasMore ? " — нажмите «Показать ещё», чтобы добавить остальные" : ""}.
            </InfoHint>
          </>
        )}
      </div>
    </div>
  );
}
