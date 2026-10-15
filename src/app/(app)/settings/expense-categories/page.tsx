import { Breadcrumbs } from "@/components/breadcrumbs";
import { InfoHint } from "@/components/info-hint";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { createExpenseCategory, toggleExpenseCategoryActive, updateExpenseCategory, deleteExpenseCategory } from "./actions";
import { DeleteEntityButton } from "@/components/delete-entity-button";

const KIND_LABELS: Record<string, string> = {
  PURCHASE: "Закупка",
  PRODUCTION: "Производство",
  GENERAL: "Общая",
};

export const metadata = { title: "Статьи расходов" };

export default async function ExpenseCategoriesPage({ searchParams }: PageProps<"/settings/expense-categories">) {
  const session = await requireSession();
  const sp = await searchParams;
  const flashError = typeof sp.error === "string" ? sp.error.slice(0, 300) : "";
  const categories = await prisma.expenseCategory.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    include: { _count: { select: { purchaseExpenses: true, productionExpenses: true } } },
  });

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Статьи расходов" }]} />
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Статьи расходов</h1><InfoHint label="О статьях расходов">Категории дополнительных расходов: тип «Закупка» — расходы к закупке, «Производство» — к ТЗ, «Общая» — прочие. Название и тип можно править в таблице; отключённая статья остаётся в старых записях, но не предлагается в новых.</InfoHint></div>
      {flashError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{flashError}</p>
      )}

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Добавить статью</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createExpenseCategory} className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="name">Название</Label>
              <Input id="name" name="name" required placeholder="Например, «Доставка»" />
            </div>
            <div>
              <Label htmlFor="kind">Тип</Label>
              <Select id="kind" name="kind" defaultValue="PURCHASE">
                <option value="PURCHASE">Закупка</option>
                <option value="PRODUCTION">Производство</option>
                <option value="GENERAL">Общая</option>
              </Select>
            </div>
            <Button type="submit">Добавить</Button>
          </form>
        </CardContent>
      </Card>

      <Table>
        <Thead>
          <Tr>
            <Th>Название и тип</Th>
            <Th>Статус</Th>
            <Th></Th>
          </Tr>
        </Thead>
        <Tbody>
          {categories.map((c) => (
            <Tr key={c.id}>
              <Td>
                <form action={updateExpenseCategory} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={c.id} />
                  <Input name="name" required defaultValue={c.name} aria-label="Название статьи" className="min-w-48 flex-1" />
                  <Select name="kind" defaultValue={c.kind} aria-label="Тип статьи" className="w-auto">
                    <option value="PURCHASE">{KIND_LABELS.PURCHASE}</option>
                    <option value="PRODUCTION">{KIND_LABELS.PRODUCTION}</option>
                    <option value="GENERAL">{KIND_LABELS.GENERAL}</option>
                  </Select>
                  <Button type="submit" variant="ghost" size="sm">Сохранить</Button>
                </form>
              </Td>
              <Td>
                <Badge variant={c.isActive ? "info" : "default"}>{c.isActive ? "Действует" : "Отключена"}</Badge>
              </Td>
              <Td>
                <form
                  action={async () => {
                    "use server";
                    await toggleExpenseCategoryActive(c.id);
                  }}
                >
                  <Button type="submit" variant="ghost" size="sm">
                    {c.isActive ? "Деактивировать" : "Активировать"}
                  </Button>
                </form>
                <DeleteEntityButton
                  variant="ghost"
                  confirmText={`Удалить статью «${c.name}»? Это нельзя отменить.`}
                  blockedReason={c._count.purchaseExpenses + c._count.productionExpenses > 0 ? `Используется в расходах (${c._count.purchaseExpenses + c._count.productionExpenses}) — деактивируйте` : null}
                  showReason={false}
                  action={deleteExpenseCategory.bind(null, c.id)}
                />
              </Td>
            </Tr>
          ))}
          {categories.length === 0 && (
            <Tr>
              <Td colSpan={4} className="py-8 text-center text-neutral-500">
                Статей расходов пока нет
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
