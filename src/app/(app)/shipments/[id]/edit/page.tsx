import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ProductionTabs } from "@/components/production-tabs";
import { isoDay, type SizeRow } from "@/lib/shipments";
import { loadShipmentFormData } from "../../form-data";
import { updateShipment } from "../../actions";
import { ShipmentForm } from "../../shipment-form";

export const metadata = { title: "Изменить отгрузку" };

export default async function EditShipmentPage({ params }: PageProps<"/shipments/[id]/edit">) {
  const { id } = await params;
  const session = await requireRole("OWNER", "ADMIN", "TECHNOLOGIST");
  const orgId = session.user.organizationId;
  const s = await prisma.shipment.findFirst({
    where: { id, organizationId: orgId },
    include: { lines: { orderBy: { id: "asc" } } },
  });
  if (!s) notFound();
  if (s.status !== "PLANNED") redirect(`/shipments/${id}`);

  const { clients, orders } = await loadShipmentFormData(orgId, id, s.lines.map((l) => l.productionOrderId));
  const rows: Record<string, SizeRow[]> = {};
  for (const l of s.lines) (rows[l.productionOrderId] ??= []).push({ size: l.size ?? "", quantity: String(l.quantity) });

  return (
    <div className="flex flex-col gap-4">
      <ProductionTabs active="shipments" />
      <h1 className="text-xl font-semibold">Изменить отгрузку</h1>
      <ShipmentForm
        clients={clients}
        orders={orders}
        initial={{ plannedDate: isoDay(s.plannedDate), clientKey: s.clientId ?? "none", notes: s.notes ?? "", rows }}
        submit={updateShipment.bind(null, id)}
        submitLabel="Сохранить изменения"
        cancelHref={`/shipments/${id}`}
      />
    </div>
  );
}
