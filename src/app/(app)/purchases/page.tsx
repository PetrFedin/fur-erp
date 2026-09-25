import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatDate } from "@/lib/utils";
import { purchaseTotalInclVat } from "@/lib/purchase-totals";
import { Decimal } from "@prisma/client/runtime/library";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "info" | "warning" | "success" | "danger" }> = {
  DRAFT: { label: "Черновик", variant: "default" },
  ORDERED: { label: "Заказано", variant: "info" },
  IN_TRANSIT: { label: "В пути", variant: "warning" },
  RECEIVED: { label: "Оприходовано", variant: "success" },
  CANCELLED: { label: "Отменено", variant: "danger" },
};

export default async function PurchasesPage() {
  const session = await requireSession();
  const purchases = await prisma.purchase.findMany({
    where: { organizationId: session.user.organizationId },
    include: { supplier: true, items: true, expenses: true, payments: true },
    orderBy: { orderDate: "desc" },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Закупки сырья</h1>
        <Link href="/purchases/new" className={buttonVariants()}>
          + Новая закупка
        </Link>
      </div>

      <Table>
        <Thead>
          <Tr>
            <Th>№</Th>
            <Th>Поставщик</Th>
            <Th>Дата</Th>
            <Th>Статус</Th>
            <Th>Сумма</Th>
            <Th>Оплачено</Th>
          </Tr>
        </Thead>
        <Tbody>
          {purchases.map((p) => {
            const total = purchaseTotalInclVat(p);
            const paid = p.payments.reduce((s, pay) => s.add(pay.amount), new Decimal(0));
            const status = STATUS_LABELS[p.status];
            return (
              <Tr key={p.id}>
                <Td className="font-medium">
                  <Link href={`/purchases/${p.id}`} className="hover:underline">
                    {p.number}
                  </Link>
                </Td>
                <Td>{p.supplier.name}</Td>
                <Td>{formatDate(p.orderDate)}</Td>
                <Td>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </Td>
                <Td>{formatMoney(total.toString())}</Td>
                <Td className={paid.lessThan(total) ? "text-amber-600" : "text-emerald-600"}>
                  {formatMoney(paid.toString())}
                </Td>
              </Tr>
            );
          })}
          {purchases.length === 0 && (
            <Tr>
              <Td colSpan={6} className="py-8 text-center text-neutral-400">
                Закупок пока нет
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
