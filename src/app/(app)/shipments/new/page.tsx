import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireRole } from "@/lib/session";
import { ProductionTabs } from "@/components/production-tabs";
import { suggestSizeRows, todayIso } from "@/lib/shipments";
import { loadShipmentFormData } from "../form-data";
import { createShipment } from "../actions";
import { ShipmentForm } from "../shipment-form";

export const metadata = { title: "Новая отгрузка" };

export default async function NewShipmentPage({ searchParams }: PageProps<"/shipments/new">) {
  const session = await requireRole("OWNER", "ADMIN", "TECHNOLOGIST");
  const orgId = session.user.organizationId;
  const sp = await searchParams;
  const orderParam = typeof sp.order === "string" ? sp.order : "";

  const { clients, orders } = await loadShipmentFormData(orgId, undefined, orderParam ? [orderParam] : []);
  // ?order=<id ТЗ> — предвыбрать заказчика и это ТЗ.
  const pre = orderParam ? orders.find((o) => o.id === orderParam) : undefined;
  const initial = {
    plannedDate: todayIso(),
    clientKey: pre?.clientKey ?? "",
    notes: "",
    rows: pre
      ? { [pre.id]: suggestSizeRows(pre.sizeText, Math.max(0, pre.plannedQty - pre.shippedElsewhere) || pre.plannedQty) }
      : {},
  };

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "ТЗ", href: "/production" }, { label: "Отгрузки", href: "/shipments" }, { label: "Новая отгрузка" }]} />
      <ProductionTabs active="shipments" />
      <h1 className="text-xl font-semibold">Новая отгрузка</h1>
      <ShipmentForm
        clients={clients}
        orders={orders}
        initial={initial}
        submit={createShipment}
        submitLabel="Сохранить отгрузку"
        cancelHref="/shipments"
      />
    </div>
  );
}
