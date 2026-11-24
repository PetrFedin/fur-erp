import type { Prisma, ExpenseCategory } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { CreateDialog } from "@/components/create-dialog";
import { Money } from "@/components/money";
import { VatLabel } from "@/components/vat-label";
import { TotalLabel } from "@/components/total-label";
import { formatMoney } from "@/lib/utils";
import { expenseInclVat } from "@/lib/purchase-totals";
import { rowVersion, PURCHASE_EXPENSE_V } from "@/lib/concurrency";
import { removePurchaseExpense } from "../actions";
import { PurchaseExpenseForm } from "./expense-form";
import { ExpenseEditButton } from "./edit-buttons";
import { ConfirmSubmitButton } from "./documents-form";
import { PlanExpenses } from "./plan-expenses";
import type { PurchaseItemFull } from "./item-row-render";

type ExpenseFull = Prisma.PurchaseExpenseGetPayload<{ include: { category: true } }>;

/** Карточка «Расходы» закупки: список, итог, добавление, правка и удаление; ниже — расходы из расчётного листа лотов. */
export function PurchaseExpensesCard({ id, purchase, editable, expenseCategories, expensesTotalExclVat, expensesTotalInclVat }: {
  id: string;
  purchase: { expenses: ExpenseFull[]; items: PurchaseItemFull[] };
  editable: boolean;
  expenseCategories: ExpenseCategory[];
  expensesTotalExclVat: Decimal;
  expensesTotalInclVat: Decimal;
}) {
  const boundRemoveExpense = removePurchaseExpense.bind(null, id);
  const expenseEdit = (e: (typeof purchase.expenses)[number]) =>
    editable ? (
      <ExpenseEditButton
        purchaseId={id}
        expenseId={e.id}
        version={rowVersion(e, PURCHASE_EXPENSE_V)}
        categories={expenseCategories.map((c) => ({ id: c.id, name: c.name }))}
        defaults={{ categoryId: e.categoryId, amount: e.amount.toString(), vatRate: e.vatRate.toString(), description: e.description ?? "" }}
      />
    ) : null;
  return (
      <Card>
        <CardHeader>
          <CardTitle>Расходы</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {editable && (
            <div>
              <CreateDialog label="+ Расход" title="Новый расход по закупке" variant="outline">
                <PurchaseExpenseForm purchaseId={id} categories={expenseCategories} />
              </CreateDialog>
            </div>
          )}
          {purchase.expenses.length > 0 && (
            <ResponsiveRows
              table={
            <Table>
              <Thead>
                <Tr>
                  <Th>Статья</Th>
                  <Th>Описание</Th>
                  <Th>Без НДС, ₽</Th>
                  <Th>НДС</Th>
                  <Th>Сумма, ₽</Th>
                  {editable && <Th></Th>}
                </Tr>
              </Thead>
              <Tbody>
                {purchase.expenses.map((e) => (
                  <Tr key={e.id}>
                    <Td>{e.category.name}</Td>
                    <Td>{e.description ?? "–"}</Td>
                    <Td>{formatMoney(e.amount.toString())}</Td>
                    <Td>{e.vatRate.toString()} %</Td>
                    <Td>
                      <Money incl={expenseInclVat(e)} excl={e.amount} />
                    </Td>
                    {editable && (
                      <Td>
                        <div className="flex items-center gap-1">
                          {expenseEdit(e)}
                          <form
                            action={async () => {
                              "use server";
                              await boundRemoveExpense(e.id);
                            }}
                          >
                            <ConfirmSubmitButton message="Удалить расход закупки? Себестоимость закупки пересчитается." />
                          </form>
                        </div>
                      </Td>
                    )}
                  </Tr>
                ))}
                {purchase.expenses.length > 1 && (
                  <Tr className="row-total">
                    <Td colSpan={2}><TotalLabel unit="₽" /></Td>
                    <Td>{formatMoney(expensesTotalExclVat.toString())}</Td>
                    <Td />
                    <Td><Money incl={expensesTotalInclVat} excl={expensesTotalExclVat} /></Td>
                    {editable && <Td />}
                  </Tr>
                )}
              </Tbody>
            </Table>
              }
            >
              {purchase.expenses.map((e) => (
                <RowCard
                  key={e.id}
                  title={e.category.name}
                  subtitle={e.description}
                  fields={[
                    { label: "Сумма (без НДС)", value: formatMoney(e.amount.toString()) },
                    { label: "НДС", value: `${e.vatRate.toString()} %` },
                    { label: <VatLabel base="Сумма" />, value: <Money incl={expenseInclVat(e)} excl={e.amount} />, strong: true },
                  ]}
                  extra={
                    editable && (
                      <div className="flex items-center gap-2">
                        {expenseEdit(e)}
                        <form
                          action={async () => {
                            "use server";
                            await boundRemoveExpense(e.id);
                          }}
                        >
                          <ConfirmSubmitButton message="Удалить расход закупки? Себестоимость закупки пересчитается." variant="outline" className="max-md:h-10" />
                        </form>
                      </div>
                    )
                  }
                />
              ))}
            </ResponsiveRows>
          )}
          <PlanExpenses items={purchase.items} />
        </CardContent>
      </Card>
  );
}
