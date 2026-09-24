import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";
import { Decimal } from "@prisma/client/runtime/library";
import { PurchaseItemForm } from "./item-form";
import { PurchaseExpenseForm } from "./expense-form";
import { PurchasePaymentForm } from "./payment-form";
import { PurchaseActions } from "./purchase-actions";
import { removePurchaseItem, removePurchaseExpense } from "../actions";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "info" | "warning" | "success" | "danger" }> = {
  DRAFT: { label: "Черновик", variant: "default" },
  ORDERED: { label: "Заказано", variant: "info" },
  IN_TRANSIT: { label: "В пути", variant: "warning" },
  RECEIVED: { label: "Оприходовано", variant: "success" },
  CANCELLED: { label: "Отменено", variant: "danger" },
};

const UNIT_LABELS: Record<string, string> = {
  PIECE: "шт.",
  KG: "кг",
  M2: "м²",
  M: "м",
  SET: "компл.",
};

export default async function PurchaseDetailPage({ params }: PageProps<"/purchases/[id]">) {
  const { id } = await params;
  const session = await requireSession();

  const purchase = await prisma.purchase.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      supplier: true,
      warehouse: true,
      items: { include: { rawMaterial: true }, orderBy: { id: "asc" } },
      expenses: { include: { category: true }, orderBy: { date: "asc" } },
      payments: { orderBy: { paidAt: "asc" } },
    },
  });
  if (!purchase) notFound();

  const editable = purchase.status !== "RECEIVED" && purchase.status !== "CANCELLED";

  const [materials, expenseCategories] = editable
    ? await Promise.all([
        prisma.rawMaterial.findMany({
          where: { organizationId: session.user.organizationId, isActive: true },
          select: { id: true, name: true, unit: true },
          orderBy: { name: "asc" },
        }),
        prisma.expenseCategory.findMany({
          where: { organizationId: session.user.organizationId, kind: "PURCHASE", isActive: true },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], []];

  const itemsTotal = purchase.items.reduce((s, i) => s.add(i.subtotal), new Decimal(0));
  const expensesTotal = purchase.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const grandTotal = itemsTotal.add(expensesTotal);
  const paidTotal = purchase.payments.reduce((s, p) => s.add(p.amount), new Decimal(0));
  const balanceDue = grandTotal.sub(paidTotal);
  const status = STATUS_LABELS[purchase.status];

  const boundRemoveItem = removePurchaseItem.bind(null, id);
  const boundRemoveExpense = removePurchaseExpense.bind(null, id);

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Закупка {purchase.number}</h1>
          <p className="text-sm text-neutral-500">
            {purchase.supplier.name} · склад «{purchase.warehouse.name}» · {formatDate(purchase.orderDate)}
          </p>
          <div className="mt-2">
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
        </div>
        <PurchaseActions purchaseId={id} status={purchase.status} />
      </div>

      <div className="grid grid-cols-4 gap-3">
        <SummaryCard label="Сырьё" value={formatMoney(itemsTotal.toString())} />
        <SummaryCard label="Доп. расходы" value={formatMoney(expensesTotal.toString())} />
        <SummaryCard label="Итого" value={formatMoney(grandTotal.toString())} emphasis />
        <SummaryCard
          label="Остаток к оплате"
          value={formatMoney(balanceDue.toString())}
          warn={balanceDue.greaterThan(0)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Позиции сырья</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {editable && <PurchaseItemForm purchaseId={id} materials={materials} />}
          <Table>
            <Thead>
              <Tr>
                <Th>Сырьё</Th>
                <Th>Сорт/цвет</Th>
                <Th>Кол-во</Th>
                <Th>Цена</Th>
                <Th>Сумма</Th>
                {editable && <Th></Th>}
              </Tr>
            </Thead>
            <Tbody>
              {purchase.items.map((item) => (
                <Tr key={item.id}>
                  <Td>{item.rawMaterial.name}</Td>
                  <Td>{[item.grade, item.color].filter(Boolean).join(" / ") || "—"}</Td>
                  <Td>
                    {formatQty(item.quantity.toString())} {UNIT_LABELS[item.rawMaterial.unit]}
                  </Td>
                  <Td>{formatMoney(item.unitPrice.toString())}</Td>
                  <Td>{formatMoney(item.subtotal.toString())}</Td>
                  {editable && (
                    <Td>
                      <form
                        action={async () => {
                          "use server";
                          await boundRemoveItem(item.id);
                        }}
                      >
                        <Button type="submit" variant="ghost" size="sm">
                          Удалить
                        </Button>
                      </form>
                    </Td>
                  )}
                </Tr>
              ))}
              {purchase.items.length === 0 && (
                <Tr>
                  <Td colSpan={6} className="py-6 text-center text-neutral-400">
                    Позиций пока нет
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Дополнительные расходы по закупке</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {editable && <PurchaseExpenseForm purchaseId={id} categories={expenseCategories} />}
          <Table>
            <Thead>
              <Tr>
                <Th>Статья</Th>
                <Th>Описание</Th>
                <Th>Сумма</Th>
                {editable && <Th></Th>}
              </Tr>
            </Thead>
            <Tbody>
              {purchase.expenses.map((e) => (
                <Tr key={e.id}>
                  <Td>{e.category.name}</Td>
                  <Td>{e.description ?? "—"}</Td>
                  <Td>{formatMoney(e.amount.toString())}</Td>
                  {editable && (
                    <Td>
                      <form
                        action={async () => {
                          "use server";
                          await boundRemoveExpense(e.id);
                        }}
                      >
                        <Button type="submit" variant="ghost" size="sm">
                          Удалить
                        </Button>
                      </form>
                    </Td>
                  )}
                </Tr>
              ))}
              {purchase.expenses.length === 0 && (
                <Tr>
                  <Td colSpan={4} className="py-6 text-center text-neutral-400">
                    Доп. расходов нет
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
          <p className="text-xs text-neutral-400">
            При оприходовании расходы распределяются на позиции сырья пропорционально их сумме —
            себестоимость на складе учитывает доставку, растаможку и прочие затраты.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Оплаты поставщику</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <PurchasePaymentForm purchaseId={id} />
          <Table>
            <Thead>
              <Tr>
                <Th>Дата</Th>
                <Th>Способ</Th>
                <Th>Сумма</Th>
                <Th>Заметка</Th>
              </Tr>
            </Thead>
            <Tbody>
              {purchase.payments.map((p) => (
                <Tr key={p.id}>
                  <Td>{formatDate(p.paidAt)}</Td>
                  <Td>{p.method}</Td>
                  <Td>{formatMoney(p.amount.toString())}</Td>
                  <Td>{p.notes ?? "—"}</Td>
                </Tr>
              ))}
              {purchase.payments.length === 0 && (
                <Tr>
                  <Td colSpan={4} className="py-6 text-center text-neutral-400">
                    Оплат пока нет
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  emphasis,
  warn,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold ${warn ? "text-amber-600" : emphasis ? "text-neutral-900" : "text-neutral-700"}`}
      >
        {value}
      </div>
    </div>
  );
}
