import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatDate } from "@/lib/utils";
import { createAdvancePayment } from "./actions";

const METHOD_LABELS: Record<string, string> = {
  CASH: "Наличные",
  BANK_TRANSFER: "Банк. перевод",
  CARD: "Карта",
  OTHER: "Другое",
};

export default async function PaymentsPage() {
  const session = await requireSession();
  const [payments, suppliers] = await Promise.all([
    prisma.payment.findMany({
      where: { organizationId: session.user.organizationId },
      include: { supplier: true, purchase: true },
      orderBy: { paidAt: "desc" },
    }),
    prisma.supplier.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Оплаты поставщикам</h1>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Аванс / предоплата</CardTitle>
          <CardDescription>
            Платёж без привязки к конкретной закупке — например, аванс. Привязать к закупке
            можно из карточки закупки.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createAdvancePayment} className="grid grid-cols-4 items-end gap-2">
            <div>
              <Label htmlFor="supplierId">Поставщик</Label>
              <Select id="supplierId" name="supplierId" required defaultValue="">
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
              <Input id="amount" name="amount" type="number" step="0.01" min="0" required />
            </div>
            <div>
              <Label htmlFor="method">Способ</Label>
              <Select id="method" name="method" defaultValue="BANK_TRANSFER">
                {Object.entries(METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="paidAt">Дата</Label>
              <Input id="paidAt" name="paidAt" type="date" defaultValue={today} required />
            </div>
            <div className="col-span-4">
              <Button type="submit">Добавить платёж</Button>
            </div>
          </form>
        </CardContent>
      </Card>

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
                  <Link href={`/purchases/${p.purchase.id}`} className="hover:underline">
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
    </div>
  );
}
