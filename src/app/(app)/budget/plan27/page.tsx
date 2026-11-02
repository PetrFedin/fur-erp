import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireSession } from "@/lib/session";
import { loadPlanData } from "@/lib/fw27-plan-data";
import { PlanView } from "./plan-view";

export const metadata = { title: "План производства 2027" };
const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"];

export default async function Plan27Page() {
  const session = await requireSession();
  const d = await loadPlanData(session.user.organizationId);
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Бюджеты и прогнозы", href: "/budget" }, { label: "План производства 2027" }]} />
      <PlanView data={d} canEdit={EDIT_ROLES.includes(session.user.role)} />
    </div>
  );
}
