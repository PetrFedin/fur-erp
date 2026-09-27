import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatCurrency, formatQty, formatDate } from "@/lib/utils";
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
    include: {
      supplier: true,
      items: { include: { rawMaterial: true } },
      expenses: true,
      payments: true,
    },
    orderBy: { orderDate: "desc" },
  });

  const liningRows = purchases.flatMap((p) =>
    p.items
      .filter((i) => i.rawMaterial.unit === "M")
      .map((i) => ({
        purchaseId: p.id,
        purchaseNumber: p.number,
        date: p.orderDate,
        material: i.rawMaterial.name,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        currency: p.currency,
        vatRate: i.vatRate,
        subtotalRub: i.subtotal.mul(p.exchangeRate),
      }))
  );
  const liningTotalRub = liningRows.reduce((s, r) => s.add(r.subtotalRub), new Decimal(0));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Закупки сырья</h1>
        <Link href="/purchases/new" className={buttonVariants()}>
          + Новая закупка
        </Link>
      </div>

      {liningRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Закупка подкладки</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-neutral-500">
              Позиции подкладочной ткани из всех закупок ниже (мех этой же закупки — в общей
              таблице). Остаток по каждой ткани — на странице{" "}
              <Link href="/lots" className="underline">
                «Остатки и архив сырья»
              </Link>
              .
            </p>
            <Table>
              <Thead>
                <Tr>
                  <Th>Ткань</Th>
                  <Th>Закупка</Th>
                  <Th>Дата</Th>
                  <Th>Кол-во</Th>
                  <Th>Цена за ед. (без НДС)</Th>
                  <Th>НДС</Th>
                  <Th>Сумма, ₽</Th>
                </Tr>
              </Thead>
              <Tbody>
                {liningRows.map((r, i) => (
                  <Tr key={i}>
                    <Td>{r.material}</Td>
                    <Td>
                      <Link href={`/purchases/${r.purchaseId}`} className="hover:underline">
                        {r.purchaseNumber}
                      </Link>
                    </Td>
                    <Td className="text-neutral-500">{formatDate(r.date)}</Td>
                    <Td>{formatQty(r.quantity.toString())} м</Td>
                    <Td>{formatCurrency(r.unitPrice.toString(), r.currency)}</Td>
                    <Td>{r.vatRate.toString()}%</Td>
                    <Td>{formatMoney(r.subtotalRub.toString())}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
            <p className="mt-2 text-right text-sm text-neutral-500">
              Итого закуплено подкладки: {formatMoney(liningTotalRub.toString())}
            </p>
          </CardContent>
        </Card>
      )}

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
                <Td className="max-w-[220px] truncate text-neutral-500" title={p.auctionSession ?? undefined}>
                  {p.auctionSession ?? "—"}
                </Td>
                <Td className="text-neutral-500">{p.invoiceNumber ?? "—"}</Td>
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
              <Td colSpan={8} className="py-8 text-center text-neutral-400">
                Закупок пока нет
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
