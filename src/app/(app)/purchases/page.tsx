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
import { Money } from "@/components/money";
import { ResponsiveDetails } from "../production/filters-details";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { loadAuctionSummaries, auctionName, PAY_EPS } from "@/lib/auction-payments";
import { cleanSearch, parseDateInput, escapeLike } from "@/lib/input";

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

export default async function PurchasesPage({ searchParams }: PageProps<"/purchases">) {
  const session = await requireSession();
  const sp = await searchParams;
  const canCreate = ["OWNER", "ADMIN", "PURCHASER"].includes(session.user.role);
  const auction = cleanSearch(sp.auction);
  const q = cleanSearch(sp.q);
  const PAGE = 50;
  const limitRaw = Number(typeof sp.limit === "string" ? sp.limit : PAGE);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), PAGE), 2000) : PAGE;
  const statusParam = typeof sp.status === "string" ? sp.status : "";
  const status = ["DRAFT", "RECEIVED", "CANCELLED"].includes(statusParam) ? statusParam : "";
  const dateStr = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && parseDateInput(v) ? v : "");
  const from = dateStr(sp.from);
  const to = dateStr(sp.to);
  const purchases = await prisma.purchase.findMany({
    where: {
      organizationId: session.user.organizationId,
      // Two states in the UI: everything not received/cancelled is a draft.
      ...(status === "RECEIVED" ? { status: "RECEIVED" as const } : {}),
      ...(status === "CANCELLED" ? { status: "CANCELLED" as const } : {}),
      ...(status === "DRAFT" ? { status: { notIn: ["RECEIVED" as const, "CANCELLED" as const] } } : {}),
      ...(from || to
        ? { orderDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) } }
        : {}),
      ...(auction ? { auctionSession: { contains: escapeLike(auction), mode: "insensitive" as const } } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: escapeLike(q), mode: "insensitive" as const } },
              { invoiceNumber: { contains: escapeLike(q), mode: "insensitive" as const } },
              { supplier: { name: { contains: escapeLike(q), mode: "insensitive" as const } } },
              { items: { some: { lotNumber: { contains: escapeLike(q), mode: "insensitive" as const } } } },
            ],
          }
        : {}),
    },
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
  const moreParams = new URLSearchParams();
  if (q) moreParams.set("q", q);
  if (auction) moreParams.set("auction", auction);
  if (status) moreParams.set("status", status);
  if (from) moreParams.set("from", from);
  if (to) moreParams.set("to", to);
  moreParams.set("limit", String(limit + PAGE));

  // Оплаты по закупкам с аукционом ведутся по аукциону целиком — «оплачено» берём оттуда.
  const pageAuctionNames = [...new Set(purchases.map((p) => auctionName(p.auctionSession)).filter((n): n is string => !!n))];
  const auctionPays = new Map(
    (pageAuctionNames.length ? await loadAuctionSummaries(prisma, session.user.organizationId, pageAuctionNames) : []).map((a) => [a.name, a]),
  );

  const sessions = await prisma.purchase.findMany({
    where: { organizationId: session.user.organizationId, auctionSession: { not: null } },
    select: { auctionSession: true },
    distinct: ["auctionSession"],
    orderBy: { auctionSession: "asc" },
  });
  const auctionOptions = sessions.map((x) => firstLine(x.auctionSession)).filter((v, i, arr) => v && arr.indexOf(v) === i)
    .sort((x, y) => Number(isServiceAuction(x)) - Number(isServiceAuction(y)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Закупки</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/payments" className={buttonVariants({ variant: "outline" })}>
            Оплаты
          </Link>
          {canCreate && (
            <Link href="/purchases/new" className={buttonVariants()}>
              + Новая закупка
            </Link>
          )}
        </div>
      </div>

      <ResponsiveDetails summary={`Фильтры и поиск${q || auction || status || from || to ? " (применены)" : ""}`} forceOpen={Boolean(q || auction || status || from || to)}>
      <form method="get" className="flex flex-wrap items-center gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="№ закупки, счёт, поставщик, лот"
          aria-label="Поиск по закупкам"
          className="h-9 w-64 rounded-md border border-neutral-300 bg-white px-3 text-sm shadow-sm"
        />
        <input
          name="auction"
          defaultValue={auction}
          placeholder="Аукцион / сессия"
          list="auction-sessions"
          className="h-9 w-64 rounded-md border border-neutral-300 bg-white px-3 text-sm shadow-sm"
        />
        <datalist id="auction-sessions">
          {auctionOptions.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <select
          name="status"
          defaultValue={status}
          aria-label="Статус"
          className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm shadow-sm"
        >
          <option value="">Все статусы</option>
          <option value="DRAFT">Черновик</option>
          <option value="RECEIVED">Принято на склад</option>
          <option value="CANCELLED">Отменено</option>
        </select>
        <label className="flex items-center gap-1 text-sm text-neutral-500">
          с
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm shadow-sm"
          />
        </label>
        <label className="flex items-center gap-1 text-sm text-neutral-500">
          по
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm shadow-sm"
          />
        </label>
        <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Найти
        </button>
        {(q || auction || status || from || to) && (
          <Link href="/purchases" className="text-sm text-neutral-500 hover:underline">
            Сбросить
          </Link>
        )}
      </form>
      </ResponsiveDetails>

      <ResponsiveRows
        table={
      <Table>
        <Thead>
          <Tr>
            <Th>№</Th>
            <Th>Поставщик</Th>
            <Th>Аукцион / сессия</Th>
            <Th>Счёт</Th>
            <Th>Дата</Th>
            <Th>Статус</Th>
            <Th>Сумма</Th>
            <Th>Оплачено</Th>
          </Tr>
        </Thead>
        <Tbody>
          {purchases.map((p) => {
            const total = purchaseTotalInclVat(p);
            const totalExclVat = purchaseTotalExclVat(p);
            const paid = p.payments.filter((pay) => pay.status === "COMPLETED").reduce((s, pay) => s.add(pay.amount), new Decimal(0));
            const status = statusView(p.status);
            const ap = auctionPays.get(auctionName(p.auctionSession) ?? "");
            return (
              <Tr key={p.id}>
                <Td className="font-medium">
                  <Link href={`/purchases/${p.id}`} className="hover:underline">
                    {p.number}
                  </Link>
                </Td>
                <Td>{p.supplier.name}</Td>
                <Td className="max-w-[220px] truncate text-neutral-500" title={p.auctionSession ?? undefined}>
                  {p.auctionSession ? shortAuctionName(firstLine(p.auctionSession)) : "—"}
                </Td>
                <Td className="text-neutral-500">{p.invoiceNumber && !isServiceAuction(p.invoiceNumber) ? p.invoiceNumber : "—"}</Td>
                <Td>{formatDate(p.orderDate)}</Td>
                <Td>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </Td>
                <Td>
                  <Money incl={total} excl={totalExclVat} />
                </Td>
                <Td className="whitespace-nowrap">
                  {ap ? (
                    <Link
                      href={`/payments?auction=${encodeURIComponent(ap.name)}#auction-block`}
                      className={`hover:underline ${ap.remaining.greaterThan(PAY_EPS) ? "text-amber-600" : "text-emerald-600"}`}
                      title={`Оплаты ведутся по аукциону «${ap.name}» целиком`}
                    >
                      <span className="block text-xs font-normal text-neutral-400">по аукциону:</span>
                      оплачено {formatMoney(ap.paid.toString())} из {formatMoney(ap.total.toString())}
                    </Link>
                  ) : (
                    <span className={paid.lessThan(total) ? "text-amber-600" : "text-emerald-600"}>{formatMoney(paid.toString())}</span>
                  )}
                </Td>
              </Tr>
            );
          })}
          {purchases.length === 0 && (
            <Tr>
              <Td colSpan={8} className="py-8 text-center text-neutral-400">
                {q || auction || status || from || to ? "По этим фильтрам закупок нет" : "Закупок пока нет"}
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
          const paidView = ap ? (
            <Link
              href={`/payments?auction=${encodeURIComponent(ap.name)}#auction-block`}
              className={ap.remaining.greaterThan(PAY_EPS) ? "text-amber-600" : "text-emerald-600"}
            >
              {formatMoney(ap.paid.toString())} из {formatMoney(ap.total.toString())}
            </Link>
          ) : (
            <span className={paid.lessThan(total) ? "text-amber-600" : "text-emerald-600"}>{formatMoney(paid.toString())}</span>
          );
          return (
            <RowCard
              key={p.id}
              title={p.number}
              href={`/purchases/${p.id}`}
              subtitle={p.supplier.name}
              badge={<Badge variant={st.variant}>{st.label}</Badge>}
              fields={[
                { label: "Сумма", value: <Money incl={total} excl={totalExclVat} />, strong: true },
                { label: ap ? "По аукциону: оплачено" : "Оплачено", value: paidView },
                { label: "Дата", value: formatDate(p.orderDate) },
              ]}
              details={[
                { label: "Аукцион / сессия", value: p.auctionSession ? shortAuctionName(firstLine(p.auctionSession)) : null },
                { label: "Счёт", value: p.invoiceNumber && !isServiceAuction(p.invoiceNumber) ? p.invoiceNumber : null },
              ]}
            />
          );
        })}
        {purchases.length === 0 && (
          <p className="py-8 text-center text-neutral-400">
            {q || auction || status || from || to ? "По этим фильтрам закупок нет" : "Закупок пока нет"}
          </p>
        )}
      </ResponsiveRows>
      {hasMore && (
        <div className="flex justify-center">
          <Link href={`/purchases?${moreParams.toString()}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Показать ещё {PAGE}
          </Link>
        </div>
      )}
      <p className="text-xs text-neutral-400">Показано закупок: {purchases.length}{hasMore ? " (есть ещё)" : ""}</p>
    </div>
  );
}
