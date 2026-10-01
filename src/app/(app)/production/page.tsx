import Link from "next/link";
import { cleanSearch } from "@/lib/input";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Decimal } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";
import { Input, Select } from "@/components/ui/input";
import { ProductionTabs } from "@/components/production-tabs";
import { formatQty } from "@/lib/utils";
import { Money } from "@/components/money";
import { VatLabel } from "@/components/vat-label";
import { materialCostExclVat } from "@/lib/purchase-totals";
import { canEditProduction } from "@/lib/production-access";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "info" | "warning" | "success" | "danger" }> = {
  PLANNED: { label: "Запланирован", variant: "default" },
  IN_PROGRESS: { label: "В работе", variant: "warning" },
  COMPLETED: { label: "Завершён", variant: "success" },
  CANCELLED: { label: "Отменён", variant: "danger" },
};

const STATUS_KEYS = Object.keys(STATUS_LABELS);

export const metadata = { title: "ТЗ" };

export default async function ProductionPage({ searchParams }: PageProps<"/production">) {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const sp = await searchParams;
  const str = (v: unknown) => cleanSearch(v);
  const modelId = str(sp.model);
  const q = str(sp.q);
  const status = STATUS_KEYS.includes(str(sp.status)) ? str(sp.status) : "";
  const clientId = str(sp.client);
  const SORTS: Record<string, string> = {
    "": "Сначала новые",
    num_desc: "№ ТЗ: по убыванию",
    num_asc: "№ ТЗ: по возрастанию",
  };
  const sort = str(sp.sort) in SORTS ? str(sp.sort) : "";

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

  const [rawOrders, filterModel, clients] = await Promise.all([
    prisma.productionOrder.findMany({
      where,
      include: {
        productModel: { select: { name: true } },
        client: { select: { name: true } },
        materialUsages: {
          select: {
            totalCost: true,
            quantity: true,
            lot: { select: { materialCostExclVat: true, expenseCostExclVat: true } },
          },
        },
        expenses: { select: { amount: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    modelId ? prisma.productModel.findFirst({ where: { id: modelId, organizationId: orgId } }) : null,
    prisma.client.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const canEdit = canEditProduction(session.user.role);
  const hasFilters = Boolean(q || status || clientId || modelId);

  // What matched the search text, so a result like "141" -> ТЗ №132 (order
  // П-2026-0141) says why it is there. Exact № ТЗ / order number come first.
  const ql = q.toLowerCase();
  const matchOf = (o: (typeof rawOrders)[number]) => {
    if (!ql) return null;
    const wo = (o.workOrderNumber ?? "").toLowerCase();
    const no = o.number.toLowerCase();
    if (wo === ql) return { rank: 0, label: null };
    if (no === ql) return { rank: 1, label: "совпал № заказа" };
    if (wo.includes(ql)) return { rank: 2, label: "совпал № ТЗ" };
    if (no.includes(ql)) return { rank: 3, label: "совпал № заказа" };
    if (o.productModel.name.toLowerCase().includes(ql)) return { rank: 4, label: "совпала модель" };
    return { rank: 5, label: "совпал заказчик" };
  };
  const woNum = (o: (typeof rawOrders)[number]) => {
    const n = parseInt(o.workOrderNumber ?? "", 10);
    return Number.isNaN(n) ? null : n;
  };
  const orders = [...rawOrders];
  if (sort) {
    const dir = sort === "num_asc" ? 1 : -1;
    // ТЗ without a numeric number go last in either direction.
    orders.sort((a, b) => {
      const x = woNum(a);
      const y = woNum(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * dir;
    });
  }
  if (q) {
    const idx = new Map(orders.map((o, i) => [o.id, i]));
    orders.sort((a, b) => (matchOf(a)!.rank - matchOf(b)!.rank) || idx.get(a.id)! - idx.get(b.id)!);
  }

  let sumIncl = new Decimal(0);
  let sumExcl = new Decimal(0);

  return (
    <div className="flex flex-col gap-4">
      <ProductionTabs active="orders" />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          ТЗ
          {filterModel && (
            <span className="ml-2 text-base font-normal text-neutral-500">— {filterModel.name}</span>
          )}
        </h1>
        {canEdit && (
          <Link href="/production/new" className={buttonVariants()}>
            + Новое ТЗ
          </Link>
        )}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        {modelId && <input type="hidden" name="model" value={modelId} />}
        <Input name="q" defaultValue={q} placeholder="№ ТЗ, модель, заказчик" className="w-72" />
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
        <Select name="sort" defaultValue={sort} className="w-48" aria-label="Сортировка">
          {Object.entries(SORTS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
        <button type="submit" className={buttonVariants({ variant: "outline" })}>
          Найти
        </button>
        {(hasFilters || sort) && (
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
            <Th>
              <VatLabel base="Итого себестоимость" />
            </Th>
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
            // Excl-VAT counterpart, same lines (expenses carry no VAT in this schema).
            const projectedExcl = materialCostExclVat(o.materialUsages).add(
              o.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0))
            );
            const totalExcl = projectedExcl;
            if (o.status !== "CANCELLED") {
              sumIncl = sumIncl.add(total);
              sumExcl = sumExcl.add(totalExcl);
            }
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
                    {matchOf(o)?.label && (
                      <span className="ml-2 text-xs font-normal text-neutral-500">({matchOf(o)!.label})</span>
                    )}
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
                  <Link href={href} className={link}>
                    {total.isZero() ? "—" : <Money incl={total} excl={totalExcl} />}
                  </Link>
                </Td>
                <Td className={cell}>
                  <Link
                    href={href}
                    className={link}
                    title={
                      markup
                        ? undefined
                        : !o.retailPrice
                          ? "Розничная цена не задана на карточке ТЗ"
                          : "Нет себестоимости — списаний ещё нет"
                    }
                  >
                    {markup ? `×${markup.toFixed(2)}` : "—"}
                  </Link>
                </Td>
              </Tr>
            );
          })}
          {orders.length > 0 && (
            <Tr className="bg-neutral-50 font-semibold">
              <Td colSpan={6} className="text-right">
                <VatLabel base="Итого себестоимость по списку" />
              </Td>
              <Td>{sumIncl.isZero() ? "—" : <Money incl={sumIncl} excl={sumExcl} />}</Td>
              <Td></Td>
            </Tr>
          )}
          {orders.length === 0 && (
            <Tr>
              <Td colSpan={8} className="py-8 text-center text-neutral-400">
                {hasFilters ? "Ничего не найдено" : "ТЗ пока нет"}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
      <p className="text-xs text-neutral-500">
        Наценка = розничная цена / себестоимость единицы. «—» — розничная цена не задана на карточке ТЗ или ещё нет
        списаний (себестоимости).
      </p>
    </div>
  );
}
