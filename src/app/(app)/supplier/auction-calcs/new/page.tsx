import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireInboxViewer } from "@/lib/supplier-inbox";
import { emptyPayload } from "@/lib/supplier-calc";
import { CalcForm } from "../calc-form";

export const metadata = { title: "Новый расчёт аукциона" };

export default async function NewCalcPage() {
  const s = await requireInboxViewer();
  if (s.user.role !== "SUPPLIER") redirect("/supplier/auction-calcs");
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Расчёты аукционов", href: "/supplier/auction-calcs" }, { label: "Новый расчёт" }]} />
      <h1 className="text-xl font-semibold">Новый расчёт аукциона</h1>
      <CalcForm id={null} initial={emptyPayload("SP_RP")} readOnly={false} files={[]} />
    </div>
  );
}
