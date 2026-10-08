import Link from "next/link";
import { escapeLike } from "@/lib/input";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import type { Prisma } from "@prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { ProductionTabs } from "@/components/production-tabs";
import { FittingThumbs } from "@/components/fitting-thumbs";
import { formatDate } from "@/lib/utils";
import { FITTING_STATUS, FITTING_STATUS_KEYS, orderLabel, truncate } from "@/lib/fittings";
import { FilterBar } from "@/components/filters/filter-bar";
import { dateRange, defineFilters, parseFilters, pick, yearOptionsFrom, yearRanges } from "@/lib/filters";
import { articleLabel } from "@/lib/article-label";

export const metadata = { title: "Примерки" };

const FITTING_FILTERS = defineFilters({
  ...pick(["q", "status", "model", "year", "from", "to"], {
    status: { allowed: FITTING_STATUS_KEYS as readonly string[], label: "Итог" },
    q: { label: "Поиск" },
    from: { label: "Дата примерки с" },
    to: { label: "Дата примерки по" },
  }),
});

export default async function FittingsPage({ searchParams }: PageProps<"/fittings">) {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const sp = await searchParams;
  const f = parseFilters(FITTING_FILTERS, sp);
  const q = f.q;
  const period = dateRange(f.from, f.to);
  const canEdit = ["OWNER", "ADMIN", "TECHNOLOGIST"].includes(session.user.role);

  const where: Prisma.FittingWhereInput = {
    organizationId: orgId,
    ...(f.status.length ? { status: { in: f.status as Array<keyof typeof FITTING_STATUS> } } : {}),
    ...(f.model.length ? { productionOrder: { productModelId: { in: f.model } } } : {}),
    AND: [
      ...(f.year.length ? [{ OR: yearRanges(f.year).map((r) => ({ fittingDate: r })) }] : []),
      ...(period ? [{ fittingDate: period }] : []),
    ],
    ...(q
      ? {
          OR: [
            { comment: { contains: escapeLike(q), mode: "insensitive" } },
            { productionOrder: { workOrderNumber: { contains: escapeLike(q), mode: "insensitive" } } },
            { productionOrder: { number: { contains: escapeLike(q), mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [fittings, models, allDates] = await Promise.all([
    prisma.fitting.findMany({
      where,
      include: {
        productionOrder: {
          select: {
            number: true,
            workOrderNumber: true,
            productModel: { select: { name: true, category: true, salesCode: true, salesName: true } },
            client: { select: { name: true } },
          },
        },
        photos: { select: { id: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ fittingDate: "desc" }, { createdAt: "desc" }],
      take: 500,
    }),
    prisma.productModel.findMany({
      where: { organizationId: orgId, productionOrders: { some: { fittings: { some: {} } } } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.fitting.findMany({ where: { organizationId: orgId }, select: { fittingDate: true } }),
  ]);

  const hasFilters = Boolean(f.status.length || f.model.length || f.year.length || f.from || f.to || q);
  const isEmpty = fittings.length === 0 && !hasFilters;

  return (
    <div className="flex flex-col gap-4">
      <ProductionTabs active="fittings" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Примерки</h1>
        {canEdit && !isEmpty && (
          <Link href="/fittings/new" className={buttonVariants()}>
            + Примерка
          </Link>
        )}
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-10 text-center text-sm text-neutral-500">
          <p>Примерок пока нет. Здесь записывают итог примерки изделия по ТЗ и прикладывают фото.</p>
          {canEdit && (
            <Link href="/fittings/new" className={buttonVariants()}>
              + Примерка
            </Link>
          )}
        </div>
      ) : (
        <>
      <FilterBar
        title="Фильтры примерок"
        controls={[
          { type: "text", name: "q", label: "Поиск", placeholder: "№ ТЗ или комментарий" },
          { type: "multi", name: "status", label: "Итог", options: FITTING_STATUS_KEYS.map((k) => ({ value: k, label: FITTING_STATUS[k].label })), allLabel: "Любой итог" },
          { type: "multi", name: "model", label: "Модель", options: models.map((m) => ({ value: m.id, label: m.name })), allLabel: "Все модели" },
          { type: "multi", name: "year", label: "Год примерки", options: yearOptionsFrom(allDates.map((d) => d.fittingDate)) },
          { type: "date", name: "from", label: "Дата с" },
          { type: "date", name: "to", label: "Дата по" },
        ]}
      />

      <Table stickyHeader className="min-w-[720px]">
        <Thead>
          <Tr>
            <Th>Дата</Th>
            <Th>ТЗ</Th>
            <Th>Заказчик</Th>
            <Th>Размер</Th>
            <Th>Итог</Th>
            <Th>Комментарий</Th>
            <Th>Фото</Th>
          </Tr>
        </Thead>
        <Tbody>
          {fittings.map((f) => {
            const st = FITTING_STATUS[f.status];
            const href = `/fittings/${f.id}`;
            const link = "block px-3 py-2";
            return (
              <Tr key={f.id} className="cursor-pointer">
                <Td className="p-0">
                  <Link href={href} className={`${link} whitespace-nowrap font-medium hover:underline`}>
                    {formatDate(f.fittingDate)}
                  </Link>
                </Td>
                <Td className="p-0">
                  <Link href={href} className={link}>
                    {orderLabel(f.productionOrder)}
                    <span className="block text-xs text-neutral-500">{articleLabel(f.productionOrder.productModel)}</span>
                  </Link>
                </Td>
                <Td className="p-0">
                  <Link href={href} className={link}>{f.productionOrder.client?.name ?? "—"}</Link>
                </Td>
                <Td className="p-0">
                  <Link href={href} className={link}>{f.size ?? "—"}</Link>
                </Td>
                <Td className="p-0">
                  <Link href={href} className={link}>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </Link>
                </Td>
                <Td className="p-0">
                  <Link href={href} className={`${link} max-w-xs`} title={f.comment ?? undefined}>
                    {truncate(f.comment, 100) || "—"}
                  </Link>
                </Td>
                <Td className="p-0">
                  <Link href={href} className={link}>
                    <FittingThumbs photoIds={f.photos.map((p) => p.id)} total={f.photos.length} />
                  </Link>
                </Td>
              </Tr>
            );
          })}
          {fittings.length === 0 && (
            <Tr>
              <Td colSpan={7} className="py-8 text-center text-neutral-500">
                {hasFilters ? "Ничего не найдено" : "Примерок пока нет"}
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
