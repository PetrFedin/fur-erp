import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireSession } from "@/lib/session";
import { getPcs } from "@/lib/budget-pcs-store";
import { loadRawBalance } from "@/lib/raw-balance";
import { loadBudgetAvg, withBudgetAvg } from "@/lib/budget-pcs-avg";
import { PcsView } from "../pcs-view";

export const metadata = { title: "Budget PCS" };
const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"];

export default async function PcsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const doc = await getPcs(session.user.organizationId, id);
  if (!doc) notFound();
  const budget = await loadBudgetAvg(session.user.organizationId);
  const raw = await loadRawBalance(session.user.organizationId);
  const rawDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(new Date());
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Бюджеты и прогнозы", href: "/budget" }, { label: doc.name }]} />
      <PcsView id={doc.id} name={doc.name} season={doc.season} supplier={doc.supplier} asOf={doc.asOf} rows={withBudgetAvg(doc.rows, budget)} params={doc.params ?? null} raw={raw.rows} rawForecast={raw.forecast} rawDate={rawDate} canEdit={EDIT_ROLES.includes(session.user.role)} />
    </div>
  );
}
