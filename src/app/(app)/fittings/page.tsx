import Link from "next/link";
import { cleanSearch, escapeLike } from "@/lib/input";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import type { Prisma } from "@prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { ProductionTabs } from "@/components/production-tabs";
import { FittingThumbs } from "@/components/fitting-thumbs";
import { formatDate } from "@/lib/utils";
import { FITTING_STATUS, FITTING_STATUS_KEYS, isFittingStatus, orderLabel, truncate } from "@/lib/fittings";

export const metadata = { title: "Примерки" };

export default async function FittingsPage({ searchParams }: PageProps<"/fittings">) {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const sp = await searchParams;
  const str = (v: unknown) => cleanSearch(v);
  const status = isFittingStatus(str(sp.status)) ? (str(sp.status) as keyof typeof FITTING_STATUS) : "";
  const modelId = str(sp.model);
  const q = str(sp.q);
  const canEdit = ["OWNER", "ADMIN", "TECHNOLOGIST"].includes(session.user.role);

  const where: Prisma.FittingWhereInput = {
    organizationId: orgId,
    ...(status ? { status } : {}),
    ...(modelId ? { productionOrder: { productModelId: modelId } } : {}),
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

  const [fittings, models] = await Promise.all([
    prisma.fitting.findMany({
      where,
      include: {
        productionOrder: {
          select: {
            number: true,
            workOrderNumber: true,
            productModel: { select: { name: true } },
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
  ]);

  const hasFilters = Boolean(status || modelId || q);

  return (
    <div className="flex flex-col gap-4">
      <ProductionTabs active="fittings" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Примерки</h1>
        {canEdit && (
          <Link href="/fittings/new" className={buttonVariants()}>
            + Примерка
          </Link>
        )}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <Input name="q" defaultValue={q} placeholder="№ ТЗ или комментарий" className="w-full sm:w-64" />
        <Select name="status" defaultValue={status} className="w-full sm:w-56" aria-label="Итог">
          <option value="">Любой итог</option>
          {FITTING_STATUS_KEYS.map((k) => (
            <option key={k} value={k}>
              {FITTING_STATUS[k].label}
            </option>
          ))}
        </Select>
        <Select name="model" defaultValue={modelId} className="w-full sm:w-56" aria-label="Модель">
          <option value="">Все модели</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <button type="submit" className={buttonVariants({ variant: "outline" })}>
          Найти
        </button>
        {hasFilters && (
          <Link href="/fittings" className="text-sm text-neutral-500 hover:underline">
            Сбросить
          </Link>
        )}
      </form>

      <Table className="min-w-[720px]">
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
                    <span className="block text-xs text-neutral-500">{f.productionOrder.productModel.name}</span>
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
              <Td colSpan={7} className="py-8 text-center text-neutral-400">
                {hasFilters ? "Ничего не найдено" : "Примерок пока нет"}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
