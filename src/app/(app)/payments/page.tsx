import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatDate } from "@/lib/utils";
import { createAdvancePayment } from "./actions";
import { hasRole } from "@/lib/access";

const METHOD_LABELS: Record<string, string> = {
  CASH: "Наличные",
  BANK_TRANSFER: "Банк. перевод",
  CARD: "Карта",
  OTHER: "Другое",
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  ADVANCE: "Аванс",
  PARTIAL: "Доплата",
  FINAL: "Оплата",
};

export default async function PaymentsPage({
  searchParams,
}: PageProps<"/payments">) {
  const session = await requireSession();
  const sp = await searchParams;
  const canPay = hasRole(session.user.role, ["OWNER", "ADMIN", "PURCHASER", "ACCOUNTANT"]);
  const flashError = typeof sp.error === "string" ? sp.error.slice(0, 300) : "";
  const tab: "suppliers" | "clients" =
    sp.tab === "clients" ? "clients" : "suppliers";
  const [payments, suppliers, clientPayments] = await Promise.all([
    prisma.payment.findMany({
      where: { organizationId: session.user.organizationId },
      include: { supplier: true, purchase: true },
      orderBy: { paidAt: "desc" },
    }),
    prisma.supplier.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
      orderBy: { name: "asc" },
    }),
    tab === "clients"
      ? prisma.productionPayment.findMany({
          where: { organizationId: session.user.organizationId },
          include: {
            client: true,
            orders: { include: { productionOrder: true } },
          },
          orderBy: { paidAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Оплаты</h1>
      {flashError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{flashError}</p>
      )}

      <div className="flex gap-1 border-b border-neutral-200 pb-2">
        <Link
          href="/payments"
          className={
            "rounded-md px-3 py-1.5 text-sm " +
            (tab === "suppliers"
              ? "bg-neutral-900 text-white"
              : "text-neutral-700 hover:bg-neutral-100")
          }
        >
          Поставщикам
        </Link>
        <Link
          href="/payments?tab=clients"
          className={
            "rounded-md px-3 py-1.5 text-sm " +
            (tab === "clients"
              ? "bg-neutral-900 text-white"
              : "text-neutral-700 hover:bg-neutral-100")
          }
        >
          От заказчиков
        </Link>
      </div>

      {tab === "clients" ? (
        <>
        <p className="text-sm text-neutral-600">
          Ввести оплату — на карточке ТЗ: откройте нужное ТЗ в разделе{" "}
          <Link href="/production" className="underline hover:no-underline">
            ТЗ
          </Link>
          . Здесь оплаты заказчиков только собраны списком.
        </p>
        <Table>
          <Thead>
            <Tr>
              <Th>Дата</Th>
              <Th>Заказчик</Th>
              <Th>ТЗ</Th>
              <Th>Тип</Th>
              <Th>Сумма</Th>
              <Th></Th>
            </Tr>
          </Thead>
          <Tbody>
            {clientPayments.map((p) => (
              <Tr key={p.id}>
                <Td>{formatDate(p.paidAt)}</Td>
                <Td>{p.client?.name ?? "—"}</Td>
                <Td>
                  {p.orders.length === 0
                    ? "—"
                    : p.orders.map((o, i) => (
                        <span key={o.id}>
                          {i > 0 && ", "}
                          <Link
                            href={`/production/${o.productionOrderId}`}
                            className="hover:underline"
                          >
                            {o.productionOrder.number}
                          </Link>
                        </span>
                      ))}
                </Td>
                <Td>{PAYMENT_TYPE_LABELS[p.paymentType]}</Td>
                <Td>{formatMoney(p.amount.toString())}</Td>
                <Td>
                  {p.orders[0] ? (
                    <Link href={`/production/${p.orders[0].productionOrderId}`} className="text-sm hover:underline">
                      К ТЗ
                    </Link>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </Td>
              </Tr>
            ))}
            {clientPayments.length === 0 && (
              <Tr>
                <Td colSpan={6} className="py-8 text-center text-neutral-400">
                  Оплат от заказчиков пока нет
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
        </>
      ) : (
        <>
          {canPay && (
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Аванс / предоплата</CardTitle>
              <CardDescription>
                Аванс без привязки к закупке — гасит общий долг поставщика.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                action={createAdvancePayment}
                className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2 lg:grid-cols-4"
              >
                <div>
                  <Label htmlFor="supplierId">Поставщик</Label>
                  <Select
                    id="supplierId"
                    name="supplierId"
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Выберите
                    </option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="amount">Сумма, ₽</Label>
                  <Input
                    id="amount"
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="method">Способ</Label>
                  <Select
                    id="method"
                    name="method"
                    defaultValue="BANK_TRANSFER"
                  >
                    {Object.entries(METHOD_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="paidAt">Дата</Label>
                  <Input
                    id="paidAt"
                    name="paidAt"
                    type="date"
                    defaultValue={today}
                    required
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-4">
                  <Button type="submit">Добавить платёж</Button>
                </div>
              </form>
            </CardContent>
          </Card>
          )}

          <Table>
            <Thead>
              <Tr>
                <Th>Дата</Th>
                <Th>Поставщик</Th>
                <Th>Закупка</Th>
                <Th>Способ</Th>
                <Th>Сумма</Th>
              </Tr>
            </Thead>
            <Tbody>
              {payments.map((p) => (
                <Tr key={p.id}>
                  <Td>{formatDate(p.paidAt)}</Td>
                  <Td>{p.supplier.name}</Td>
                  <Td>
                    {p.purchase ? (
                      <Link
                        href={`/purchases/${p.purchase.id}`}
                        className="hover:underline"
                      >
                        {p.purchase.number}
                      </Link>
                    ) : (
                      <span className="text-neutral-400">Аванс</span>
                    )}
                  </Td>
                  <Td>{METHOD_LABELS[p.method]}</Td>
                  <Td>{formatMoney(p.amount.toString())}</Td>
                </Tr>
              ))}
              {payments.length === 0 && (
                <Tr>
                  <Td colSpan={5} className="py-8 text-center text-neutral-400">
                    Оплат пока нет
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </>
      )}
    </div>
  );
}
