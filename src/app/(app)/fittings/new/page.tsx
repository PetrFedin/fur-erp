import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ProductionTabs } from "@/components/production-tabs";
import { orderLabel, localTodayIso } from "@/lib/fittings";
import { formatDate } from "@/lib/utils";
import { NewFittingForm } from "./new-fitting-form";
import { articleLabel } from "@/lib/article-label";

export const metadata = { title: "Новая примерка" };

export default async function NewFittingPage({ searchParams }: PageProps<"/fittings/new">) {
  const session = await requireRole("OWNER", "ADMIN", "TECHNOLOGIST");
  const sp = await searchParams;
  const orderParam = typeof sp.order === "string" ? sp.order : "";

  const orders = await prisma.productionOrder.findMany({
    where: { organizationId: session.user.organizationId },
    select: { id: true, number: true, workOrderNumber: true, size: true, createdAt: true, client: { select: { name: true } }, productModel: { select: { name: true, category: true, salesCode: true, salesName: true } } },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const options = orders.map((o) => ({
    id: o.id,
    label: `${orderLabel(o)} · ${articleLabel(o.productModel)} · ${o.number} от ${formatDate(o.createdAt)}${o.client ? ` · ${o.client.name}` : ""}`,
    sizes: (o.size ?? "").split(/[,;/]+/).map((s) => s.trim()).filter(Boolean),
  }));

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "ТЗ", href: "/production" }, { label: "Примерки", href: "/fittings" }, { label: "Новая примерка" }]} />
      <ProductionTabs active="fittings" />
      <h1 className="text-xl font-semibold">Новая примерка</h1>
      <NewFittingForm orders={options} initialOrderId={orderParam} today={localTodayIso()} />
    </div>
  );
}
