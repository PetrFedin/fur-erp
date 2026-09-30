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
  const auction = (typeof sp.auction === "string" ? sp.auction : "").trim();
  const purchases = await prisma.purchase.findMany({
    where: {
      organizationId: session.user.organizationId,
      ...(auction ? { auctionSession: { contains: auction, mode: "insensitive" as const } } : {}),
    },
    include: {
      supplier: true,
      items: { include: { rawMaterial: true } },
      expenses: true,
      payments: true,
    },
    orderBy: { orderDate: "desc" },
  });

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
        <Link href="/purchases/new" className={buttonVariants()}>
          + Новая закупка
        </Link>
      </div>

      <form method="get" className="flex items-center gap-2">
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
        <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Найти
        </button>
        {auction && (
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
                {auction ? "По этому аукциону закупок нет" : "Закупок пока нет"}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
