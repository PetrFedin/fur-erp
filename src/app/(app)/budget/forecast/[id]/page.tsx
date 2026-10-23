import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireSession } from "@/lib/session";
import { loadRawForecast } from "@/lib/raw-forecast";
import { getForecast } from "@/lib/forecast-store";
import { ForecastView } from "../forecast-view";

export const metadata = { title: "Прогноз сырья" };
const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"];

export default async function RawForecastPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const doc = await getForecast(orgId, id);
  if (!doc) notFound();
  const f = await loadRawForecast(orgId);
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Бюджеты и прогнозы", href: "/budget" }, { label: doc.name }]} />
      <ForecastView id={doc.id} name={doc.name} season={doc.season} canEdit={EDIT_ROLES.includes(session.user.role)} initialEdits={doc.edits} initialOff={doc.off} lines={f.lines} stock={f.stock} asOf={f.asOf} />
    </div>
  );
}
