import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatQty, formatDate } from "@/lib/utils";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "info" | "warning" | "success" | "danger" }> = {
  PLANNED: { label: "Запланирован", variant: "default" },
  IN_PROGRESS: { label: "В работе", variant: "warning" },
  COMPLETED: { label: "Завершён", variant: "success" },
  CANCELLED: { label: "Отменён", variant: "danger" },
};

export default async function ProductionPage({ searchParams }: PageProps<"/production">) {
  const session = await requireSession();
  const sp = await searchParams;
  const modelId = typeof sp.model === "string" ? sp.model : "";

  const [orders, filterModel] = await Promise.all([
    prisma.productionOrder.findMany({
      where: { organizationId: session.user.organizationId, ...(modelId ? { productModelId: modelId } : {}) },
      include: { productModel: true },
      orderBy: { createdAt: "desc" },
    }),
    modelId
      ? prisma.productModel.findFirst({ where: { id: modelId, organizationId: session.user.organizationId } })
      : null,
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Производственные заказы
          {filterModel && (
            <span className="ml-2 text-base font-normal text-neutral-500">
              — {filterModel.name}{" "}
              <Link href="/production" className="text-sm text-neutral-400 hover:underline">
                (сбросить фильтр)
              </Link>
            </span>
          )}
        </h1>
        <Link href="/production/new" className={buttonVariants()}>
          + Новый заказ
        </Link>
      </div>

      <Table>
        <Thead>
          <Tr>
            <Th>№</Th>
            <Th>Модель</Th>
            <Th>План / Факт</Th>
            <Th>Статус</Th>
            <Th>Себестоимость</Th>
            <Th>Себест. за ед.</Th>
            <Th>Дата начала</Th>
          </Tr>
        </Thead>
        <Tbody>
          {orders.map((o) => {
            const status = STATUS_LABELS[o.status];
            return (
              <Tr key={o.id}>
                <Td className="font-medium">
                  <Link href={`/production/${o.id}`} className="hover:underline">
                    {o.number}
                  </Link>
                </Td>
                <Td>{o.productModel.name}</Td>
                <Td>
                  {formatQty(o.plannedQuantity.toString())} / {formatQty(o.producedQuantity.toString())}
                </Td>
                <Td>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </Td>
                <Td>{o.totalCost ? formatMoney(o.totalCost.toString()) : "—"}</Td>
                <Td>{o.unitCost ? formatMoney(o.unitCost.toString()) : "—"}</Td>
                <Td>{o.startDate ? formatDate(o.startDate) : "—"}</Td>
              </Tr>
            );
          })}
          {orders.length === 0 && (
            <Tr>
              <Td colSpan={7} className="py-8 text-center text-neutral-400">
                Производственных заказов пока нет
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
