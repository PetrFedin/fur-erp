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
import { cleanSearch, parseDateInput } from "@/lib/input";

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
      ...(auction ? { auctionSession: { contains: auction, mode: "insensitive" as const } } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" as const } },
              { invoiceNumber: { contains: q, mode: "insensitive" as const } },
              { supplier: { name: { contains: q, mode: "insensitive" as const } } },
              { items: { some: { lotNumber: { contains: q, mode: "insensitive" as const } } } },
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

  const sessions = await prisma.purchase.findMany({
    where: { organizationId: session.user.organizationId, auctionSession: { not: null } },
    select: { auctionSession: true },
    distinct: ["auctionSession"],
    orderBy: { auctionSession: "asc" },
  });
  const auctionOptions = sessions.map((x) => firstLine(x.auctionSession)).filter((v, i, arr) => v && arr.indexOf(v) === i);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Закупки</h1>
        {canCreate && (
          <Link href="/purchases/new" className={buttonVariants()}>
            + Новая закупка
          </Link>
        )}
      </div>

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
            const paid = p.payments.reduce((s, pay) => s.add(pay.amount), new Decimal(0));
            const status = statusView(p.status);
            return (
              <Tr key={p.id}>
                <Td className="font-medium">
                  <Link href={`/purchases/${p.id}`} className="hover:underline">
                    {p.number}
                  </Link>
                </Td>
                <Td>{p.supplier.name}</Td>
                <Td className="max-w-[220px] truncate text-neutral-500" title={p.auctionSession ?? undefined}>
                  {p.auctionSession ? firstLine(p.auctionSession) : "—"}
                </Td>
                <Td className="text-neutral-500">{p.invoiceNumber ?? "—"}</Td>
                <Td>{formatDate(p.orderDate)}</Td>
                <Td>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </Td>
                <Td>
                  <Money incl={total} excl={totalExclVat} />
                </Td>
                <Td className={paid.lessThan(total) ? "text-amber-600" : "text-emerald-600"}>
                  {formatMoney(paid.toString())}
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
