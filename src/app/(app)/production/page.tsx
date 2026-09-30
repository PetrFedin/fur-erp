import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { Input, Select } from "@/components/ui/input";
import { formatMoney, formatQty } from "@/lib/utils";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "info" | "warning" | "success" | "danger" }> = {
  PLANNED: { label: "Запланирован", variant: "default" },
  IN_PROGRESS: { label: "В работе", variant: "warning" },
  COMPLETED: { label: "Завершён", variant: "success" },
  CANCELLED: { label: "Отменён", variant: "danger" },
};

const STATUS_KEYS = Object.keys(STATUS_LABELS);

export default async function ProductionPage({ searchParams }: PageProps<"/production">) {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const modelId = str(sp.model);
  const q = str(sp.q);
  const status = STATUS_KEYS.includes(str(sp.status)) ? str(sp.status) : "";
  const clientId = str(sp.client);

  const where: Prisma.ProductionOrderWhereInput = {
    organizationId: orgId,
    ...(modelId ? { productModelId: modelId } : {}),
    ...(status ? { status: status as "PLANNED" } : {}),
    ...(clientId ? { clientId } : {}),
    ...(q
      ? {
          OR: [
            { workOrderNumber: { contains: q, mode: "insensitive" } },
            { number: { contains: q, mode: "insensitive" } },
            { productModel: { name: { contains: q, mode: "insensitive" } } },
            { client: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [orders, filterModel, clients] = await Promise.all([
    prisma.productionOrder.findMany({
      where,
      include: {
        productModel: { select: { name: true } },
        client: { select: { name: true } },
        materialUsages: { select: { totalCost: true } },
        expenses: { select: { amount: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    modelId ? prisma.productModel.findFirst({ where: { id: modelId, organizationId: orgId } }) : null,
    prisma.client.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const hasFilters = Boolean(q || status || clientId || modelId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Производственные заказы
          {filterModel && (
            <span className="ml-2 text-base font-normal text-neutral-500">— {filterModel.name}</span>
          )}
        </h1>
        <Link href="/production/new" className={buttonVariants()}>
          + Новое ТЗ
        </Link>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        {modelId && <input type="hidden" name="model" value={modelId} />}
        <Input name="q" defaultValue={q} placeholder="№ ТЗ, заказ, модель, заказчик" className="w-72" />
        <Select name="status" defaultValue={status} className="w-44">
          <option value="">Все статусы</option>
          {STATUS_KEYS.map((k) => (
            <option key={k} value={k}>
              {STATUS_LABELS[k].label}
            </option>
          ))}
        </Select>
        <Select name="client" defaultValue={clientId} className="w-56">
          <option value="">Все заказчики</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <button type="submit" className={buttonVariants({ variant: "outline" })}>
          Найти
        </button>
        {hasFilters && (
          <Link href="/production" className="text-sm text-neutral-500 hover:underline">
            Сбросить
          </Link>
        )}
      </form>

      <Table>
        <Thead>
          <Tr>
            <Th>№ ТЗ</Th>
            <Th>Заказ</Th>
            <Th>Модель</Th>
            <Th>Заказчик</Th>
            <Th>Кол-во</Th>
            <Th>Статус</Th>
            <Th>Итого себестоимость</Th>
            <Th>Наценка</Th>
          </Tr>
        </Thead>
        <Tbody>
          {orders.map((o) => {
            const st = STATUS_LABELS[o.status];
            const href = `/production/${o.id}`;
            // Same formulas as the order card: booked costs so far (or the
            // fixed snapshot), markup = retail price / unit cost.
            const projected = o.materialUsages
              .reduce((s, u) => s.add(u.totalCost), new Decimal(0))
              .add(o.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0)));
            const total = o.totalCost ?? projected;
            const qty = o.producedQuantity.greaterThan(0) ? o.producedQuantity : o.plannedQuantity;
            const unit = o.unitCost ?? (qty.isZero() ? new Decimal(0) : projected.div(qty));
            const markup = o.retailPrice && unit.greaterThan(0) ? o.retailPrice.div(unit) : null;
            const cell = "p-0";
            const link = "block px-3 py-2";
            return (
              <Tr key={o.id} className="cursor-pointer">
                <Td className={`${cell} font-medium`}>
                  <Link href={href} className={`${link} hover:underline`}>
                    {o.workOrderNumber ?? "—"}
                  </Link>
                </Td>
                <Td className={cell}>
                  <Link href={href} className={link}>{o.number}</Link>
                </Td>
                <Td className={cell}>
                  <Link href={href} className={link}>{o.productModel.name}</Link>
                </Td>
                <Td className={cell}>
                  <Link href={href} className={link}>{o.client?.name ?? "—"}</Link>
                </Td>
                <Td className={cell}>
                  <Link href={href} className={link}>
                    {formatQty(o.plannedQuantity.toString())} / {formatQty(o.producedQuantity.toString())}
                  </Link>
                </Td>
                <Td className={cell}>
                  <Link href={href} className={link}>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </Link>
                </Td>
                <Td className={cell}>
                  <Link href={href} className={link}>{total.isZero() ? "—" : formatMoney(total.toString())}</Link>
                </Td>
                <Td className={cell}>
                  <Link href={href} className={link}>{markup ? `×${markup.toFixed(2)}` : "—"}</Link>
                </Td>
              </Tr>
            );
          })}
          {orders.length === 0 && (
            <Tr>
              <Td colSpan={8} className="py-8 text-center text-neutral-400">
                {hasFilters ? "Ничего не найдено" : "Производственных заказов пока нет"}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
