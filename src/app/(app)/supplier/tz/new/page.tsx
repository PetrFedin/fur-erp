import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireInboxViewer } from "@/lib/supplier-inbox";
import { loadTzFormRefs } from "@/lib/supplier-tz-data";
import { emptyTz } from "@/lib/tz-vendor";
import { TzForm } from "../tz-form";

export const metadata = { title: "Новое ТЗ" };

export default async function NewTzPage() {
  const s = await requireInboxViewer();
  if (s.user.role !== "SUPPLIER") redirect("/supplier/tz");
  const refs = await loadTzFormRefs(s.user.organizationId);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "ТЗ", href: "/supplier/tz" }, { label: "Новое ТЗ" }]} />
      <h1 className="text-xl font-semibold">Новое ТЗ</h1>
      <TzForm id={null} initial={emptyTz("WORK", refs.nextNumber, today)} readOnly={false} colors={refs.colors} models={refs.models} lots={refs.lots} />
    </div>
  );
}
