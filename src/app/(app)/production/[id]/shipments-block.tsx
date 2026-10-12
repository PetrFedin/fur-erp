import Link from "next/link";
import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatQty } from "@/lib/utils";

/** Компактный блок «Отгрузки» на карточке ТЗ: журнал плана и факта, ничего не списывает. */
export async function ShipmentsBlock({
  orderId,
  organizationId,
  plannedQuantity,
}: {
  orderId: string;
  organizationId: string;
  plannedQuantity: string;
}) {
  const [session, order] = await Promise.all([
    getFreshSession(),
    prisma.productionOrder.findFirst({ where: { id: orderId, organizationId }, select: { status: true } }),
  ]);
  const canAdd = ["OWNER", "ADMIN", "TECHNOLOGIST"].includes(session?.user?.role ?? "") && order?.status !== "CANCELLED";
  const shipments = await prisma.shipment.findMany({
    where: { organizationId, lines: { some: { productionOrderId: orderId } } },
    include: { lines: { where: { productionOrderId: orderId }, orderBy: { id: "asc" } } },
    orderBy: { plannedDate: "desc" },
  });
  const sum = (s: (typeof shipments)[number]) => s.lines.reduce((a, l) => a + l.quantity, 0);
  const shippedQty = shipments.filter((s) => s.status === "SHIPPED").reduce((a, s) => a + sum(s), 0);
  const plannedQty = shipments.filter((s) => s.status === "PLANNED").reduce((a, s) => a + sum(s), 0);

  if (shipments.length === 0) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-neutral-500">
        Отгрузок пока нет
        {canAdd && (
          <>
            {" · "}
            <Link href={`/shipments/new?order=${orderId}`} className="inline-block text-neutral-700 underline underline-offset-2 hover:text-neutral-900 max-md:py-2">
              + Отгрузка
            </Link>
          </>
        )}
      </p>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Отгрузки</CardTitle>
        {canAdd && (
          <Link href={`/shipments/new?order=${orderId}`} className={buttonVariants({ size: "sm" })}>
            + Отгрузка
          </Link>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p className="text-neutral-600">
          Отгружено <span className="font-medium text-neutral-900">{formatQty(shippedQty)}</span> из{" "}
          <span className="font-medium text-neutral-900">{formatQty(plannedQuantity)}</span> шт.
          {plannedQty > 0 && <> · запланировано ещё {formatQty(plannedQty)} шт.</>}
        </p>
        {(
          <ul className="flex flex-col gap-1">
            {shipments.map((s) => {
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/shipments/${s.id}`} className="font-medium hover:underline">
                    {formatDate(s.status === "SHIPPED" && s.shippedDate ? s.shippedDate : s.plannedDate)}
                  </Link>
                  <span>{s.lines.map((l) => `${l.size ?? "—"}×${l.quantity}`).join(", ")}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
