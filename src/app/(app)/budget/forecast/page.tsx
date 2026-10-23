import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireSession } from "@/lib/session";
import { loadRawForecast } from "@/lib/raw-forecast";
import { ForecastView } from "./forecast-view";

export const metadata = { title: "Прогноз сырья на FW26" };

export default async function RawForecastPage() {
  const session = await requireSession();
  const f = await loadRawForecast(session.user.organizationId);
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Бюджеты и прогнозы", href: "/budget" }, { label: "Прогноз сырья на FW26" }]} />
      <ForecastView lines={f.lines} stock={f.stock} asOf={f.asOf} />
    </div>
  );
}
