import Link from "next/link";
import { notFound } from "next/navigation";
import { cleanSearch, escapeLike } from "@/lib/input";
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
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix, sumUsagesWith4 } from "@/lib/commission4";
import { canEditProduction } from "@/lib/production-access";
import { ResponsiveDetails } from "./filters-details";
import { GroupedByBatch } from "./grouped-view";
import { modelCodeVariants } from "@/lib/model-code";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { batchOrderInclude } from "@/lib/batch-stats";

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
  const c4Mode = await getCommission4Mode();
  let c4 = c4Suffix(c4Mode);
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
  // ?batch= — только целое число 1…999999 («1e3», «3abc», «0» — 404, а не молчаливое «всё»/другая партия).
  const batchParam = str(sp.batch);
  if (batchParam && (!/^\d{1,6}$/.test(batchParam) || parseInt(batchParam, 10) < 1)) notFound();
  const batchNum = batchParam ? parseInt(batchParam, 10) : null;
  const grouped = str(sp.view) === "batches";

  const where: Prisma.ProductionOrderWhereInput = {
    organizationId: orgId,
    ...(modelId ? { productModelId: modelId } : {}),
    ...(status ? { status: status as "PLANNED" } : {}),
    ...(clientId ? { clientId } : {}),
    ...(batchNum ? { batch: { number: batchNum } } : {}),
    ...(q
      ? {
          OR: [
            { workOrderNumber: { contains: escapeLike(q), mode: "insensitive" } },
            { number: { contains: escapeLike(q), mode: "insensitive" } },
            ...modelCodeVariants(q).map((v) => ({ productModel: { name: { contains: escapeLike(v), mode: "insensitive" as const } } })),
            { client: { name: { contains: escapeLike(q), mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [rawOrders, filterModel, clients, batchList, groupedOrders] = await Promise.all([
    prisma.productionOrder.findMany({
      where,
      include: {
        productModel: { select: { name: true } },
        client: { select: { name: true } },
        materialUsages: {
          select: {
            totalCost: true,
            quantity: true,
            commission4: true,
            lot: { select: { materialCostExclVat: true, expenseCostExclVat: true, unitCost: true, vatRate: true } },
          },
        },
        expenses: { select: { amount: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    modelId ? prisma.productModel.findFirst({ where: { id: modelId, organizationId: orgId } }) : null,
    prisma.client.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.productionBatch.findMany({
      where: { organizationId: orgId },
      select: { id: true, number: true, name: true, year: true },
      orderBy: { number: "asc" },
    }),
    grouped
      ? prisma.productionOrder.findMany({ where, include: batchOrderInclude, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
  ]);

  const canEdit = canEditProduction(session.user.role);
  const hasFilters = Boolean(q || status || clientId || modelId || batchNum);

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
    if (modelCodeVariants(q).some((v) => o.productModel.name.toLowerCase().includes(v.toLowerCase()))) return { rank: 4, label: "совпала модель" };
    return { rank: 5, label: "совпал заказчик" };
  };
  const woNum = (o: (typeof rawOrders)[number]) => {
    const n = parseInt(o.workOrderNumber ?? "", 10);
    return Number.isNaN(n) ? null : n;
  };
  const orders = [...rawOrders];
  // 4% не применено ни к одному списанию в списке — подпись «(с 4%)» не ставим.
  if (!orders.some((o) => o.materialUsages.some((u) => u.commission4))) c4 = "";
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

  // Колонку заказчика показываем только если в списке больше одного заказчика.
  const showClient = new Set(orders.map((o) => o.client?.name ?? "")).size > 1;

  let sumIncl = new Decimal(0);
  let sumExcl = new Decimal(0);
  const cards: React.ReactNode[] = [];

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

      <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Вид списка">
        <span className="text-xs text-neutral-500">Вид:</span>
        {(
          [
            [false, "Списком"],
            [true, "По партиям"],
          ] as const
        ).map(([g, text]) => {
          const qs = new URLSearchParams();
          if (g) qs.set("view", "batches");
          if (batchNum) qs.set("batch", String(batchNum));
          return (
            <Link
              key={text}
              href={`/production${qs.size ? `?${qs}` : ""}`}
              aria-current={grouped === g ? "page" : undefined}
              className={
                "rounded-md border px-3 py-1 max-md:inline-flex max-md:min-h-8 max-md:items-center " +
                (grouped === g ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700 hover:bg-neutral-100")
              }
            >
              {text}
            </Link>
          );
        })}
      </div>

      <ResponsiveDetails summary={`Фильтры и поиск${hasFilters || sort ? " (применены)" : ""}`} forceOpen={hasFilters || Boolean(sort)}>
      <form method="get" className="flex flex-wrap items-end gap-2">
        {modelId && <input type="hidden" name="model" value={modelId} />}
        {grouped && <input type="hidden" name="view" value="batches" />}
        <Input name="q" defaultValue={q} placeholder="№ ТЗ, модель, заказчик" className="w-full sm:w-72" />
        <Select name="status" defaultValue={status} className="w-full sm:w-44">
          <option value="">Все статусы</option>
          {STATUS_KEYS.map((k) => (
            <option key={k} value={k}>
              {STATUS_LABELS[k].label}
            </option>
          ))}
        </Select>
        <Select name="client" defaultValue={clientId} className="w-full sm:w-56">
          <option value="">Все заказчики</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {batchList.length > 0 && (
          <Select name="batch" defaultValue={batchNum ? String(batchNum) : ""} className="w-full sm:w-44" aria-label="Партия">
            <option value="">Все партии</option>
            {batchList.map((b) => (
              <option key={b.id} value={b.number}>
                Партия {b.number}
                {b.year ? ` (${b.year})` : ""}
              </option>
            ))}
          </Select>
        )}
        <Select name="sort" defaultValue={sort} className="w-full sm:w-48" aria-label="Сортировка">
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
          <Link href={grouped ? "/production?view=batches" : "/production"} className="text-sm text-neutral-500 hover:underline">
            Сбросить
          </Link>
        )}
      </form>
      </ResponsiveDetails>

      {grouped ? (
        <GroupedByBatch orders={groupedOrders} batches={batchList} c4Mode={c4Mode} filtered={hasFilters} />
      ) : (
      <>
      <ResponsiveRows table={
      <Table>
        <Thead>
          <Tr>
            <Th>№ ТЗ</Th>
            <Th>Модель</Th>
            {showClient && <Th className="hidden lg:table-cell">Заказчик</Th>}
            <Th className="hidden sm:table-cell" title="Запланировано / сделано, шт.">
              План / факт, шт.
            </Th>
            <Th>Статус</Th>
            <Th>
              <VatLabel base={`Итого себестоимость${c4}`} />
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {orders.map((o) => {
            const st = STATUS_LABELS[o.status];
            const href = `/production/${o.id}`;
            // Same formulas as the order card: booked costs so far (or the
            // fixed snapshot).
            // Режим «С 4%»: надбавка только к сырью/подкладке (строки списаний),
            // расходы без 4%; снимок totalCost хранится «без 4%», надбавка добавляется сверху.
            const mats = sumUsagesWith4(o.materialUsages, c4Mode);
            const expSum = o.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
            const projected = mats.incl.add(expSum);
            const total = o.totalCost ? o.totalCost.add(mats.extraIncl) : projected;
            // Excl-VAT counterpart, same lines (expenses carry no VAT in this schema).
            const projectedExcl = mats.excl.add(expSum);
            const totalExcl = projectedExcl;
            if (o.status !== "CANCELLED") {
              sumIncl = sumIncl.add(total);
              sumExcl = sumExcl.add(totalExcl);
            }
            cards.push(
              <RowCard
                key={o.id}
                title={`ТЗ ${o.workOrderNumber ?? "—"}${matchOf(o)?.label ? ` (${matchOf(o)!.label})` : ""}`}
                href={href}
                subtitle={o.productModel.name}
                badge={<Badge variant={st.variant}>{st.label}</Badge>}
                fields={[
                  { label: "План / факт, шт.", value: `${formatQty(o.plannedQuantity.toString())} / ${formatQty(o.producedQuantity.toString())}` },
                  {
                    label: <VatLabel base={`Себестоимость${c4}`} />,
                    value: total.isZero() ? "—" : <Money incl={total} excl={totalExcl} />,
                    strong: true,
                  },
                ]}
                details={[{ label: "Заказчик", value: o.client?.name }]}
              />,
            );
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
                  <Link href={href} className={link}>
                    {o.productModel.name}
                    {showClient && o.client && <span className="block text-xs text-neutral-500 lg:hidden">{o.client.name}</span>}
                  </Link>
                </Td>
                {showClient && (
                  <Td className={`${cell} hidden lg:table-cell`}>
                    <Link href={href} className={link}>{o.client?.name ?? "—"}</Link>
                  </Td>
                )}
                <Td className={`${cell} hidden sm:table-cell`}>
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
              </Tr>
            );
          })}
          {orders.length === 0 && (
            <Tr>
              <Td colSpan={6} className="py-8 text-center text-neutral-400">
                {hasFilters ? "Ничего не найдено" : "ТЗ пока нет"}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
      }>
        {cards}
        {orders.length === 0 && <p className="py-8 text-center text-neutral-400">{hasFilters ? "Ничего не найдено" : "ТЗ пока нет"}</p>}
      </ResponsiveRows>
      {orders.length > 0 && (
        <p className="flex flex-wrap items-baseline justify-end gap-2 text-sm font-semibold">
          <VatLabel base={`Итого себестоимость по списку${c4}`} />
          <span>{sumIncl.isZero() ? "—" : <Money incl={sumIncl} excl={sumExcl} />}</span>
        </p>
      )}
      </>
      )}
    </div>
  );
}
