import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { ProductionTabs } from "@/components/production-tabs";
import { formatDate, formatQty } from "@/lib/utils";
import { SHIPMENT_STATUS, orderLabel, isoDay, todayIso } from "@/lib/shipments";
import { PlannedActions, ShippedEdit } from "./shipment-actions";

export const metadata = { title: "Отгрузка" };
const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"];

export default async function ShipmentPage({ params }: PageProps<"/shipments/[id]">) {
  const { id } = await params;
  const session = await requireSession();
  const s = await prisma.shipment.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      client: { select: { name: true } },
      lines: {
        orderBy: { id: "asc" },
        include: { productionOrder: { select: { id: true, number: true, workOrderNumber: true, productModel: { select: { name: true } } } } },
      },
    },
  });
  if (!s) notFound();
  const canEdit = EDIT_ROLES.includes(session.user.role);
  const st = SHIPMENT_STATUS[s.status];
  const today = todayIso();
  const overdue = s.status === "PLANNED" && isoDay(s.plannedDate) < today;
  const total = s.lines.reduce((a, l) => a + l.quantity, 0);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <ProductionTabs active="shipments" />
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/shipments" className="text-sm text-neutral-500 hover:underline">
          ← Отгрузки
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Отгрузка на {formatDate(s.plannedDate)}</h1>
        <Badge variant={st.variant}>{st.label}</Badge>
        {overdue && <Badge variant="danger">просрочена</Badge>}
      </div>

      <dl className="grid grid-cols-[7rem_1fr] sm:grid-cols-[10rem_1fr] gap-y-1 text-sm">
        <dt className="text-neutral-500">Заказчик</dt>
        <dd>{s.client?.name ?? "—"}</dd>
        <dt className="text-neutral-500">Плановая дата</dt>
        <dd>{formatDate(s.plannedDate)}</dd>
        <dt className="text-neutral-500">Фактическая дата</dt>
        <dd>{s.shippedDate ? formatDate(s.shippedDate) : "—"}</dd>
        <dt className="text-neutral-500">Заметка</dt>
        <dd className="whitespace-pre-wrap">{s.notes ?? "—"}</dd>
      </dl>

      <Table>
        <Thead>
          <Tr>
            <Th>ТЗ</Th>
            <Th>Модель</Th>
            <Th>Размер</Th>
            <Th>Кол-во, шт.</Th>
          </Tr>
        </Thead>
        <Tbody>
          {s.lines.map((l) => (
            <Tr key={l.id}>
              <Td>
                <Link href={`/production/${l.productionOrder.id}`} className="font-medium hover:underline">
                  {orderLabel(l.productionOrder)}
                </Link>
              </Td>
              <Td>{l.productionOrder.productModel.name}</Td>
              <Td>{l.size ?? "—"}</Td>
              <Td>{formatQty(l.quantity)}</Td>
            </Tr>
          ))}
          <Tr>
            <Td colSpan={3} className="text-right text-neutral-500">
              Итого
            </Td>
            <Td className="font-semibold">{formatQty(total)}</Td>
          </Tr>
        </Tbody>
      </Table>

      {canEdit && s.status === "PLANNED" && <PlannedActions id={s.id} today={today} />}
      {canEdit && s.status === "SHIPPED" && (
        <ShippedEdit id={s.id} shippedDate={s.shippedDate ? isoDay(s.shippedDate) : today} notes={s.notes ?? ""} />
      )}
      <p className="text-xs text-neutral-500">
        Отгрузка — журнал планирования и факта: она ничего не списывает и не меняет остатки и себестоимость.
      </p>
    </div>
  );
}
