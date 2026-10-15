import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireInboxViewer } from "@/lib/supplier-inbox";
import { loadTzFormRefs } from "@/lib/supplier-tz-data";
import { emptyTz } from "@/lib/tz-vendor";
import { prisma } from "@/lib/prisma";
import { TzForm } from "../tz-form";

export const metadata = { title: "Новое ТЗ" };

export default async function NewTzPage() {
  const s = await requireInboxViewer();
  if (s.user.role !== "SUPPLIER") redirect("/supplier/tz");
  const refs = await loadTzFormRefs(s.user.organizationId, s.user.supplierId ?? "-");
  const today = new Date().toISOString().slice(0, 10);
  const initial = emptyTz("WORK", refs.nextNumber, today);
  // Другой подрядчик (не Веллмех): договор подряда и подписант подставляются из его данных, а не из значений Веллмеха по умолчанию.
  if (s.user.supplierId) {
    const [sup, wc] = await Promise.all([
      prisma.supplier.findFirst({ where: { id: s.user.supplierId, organizationId: s.user.organizationId }, select: { name: true } }),
      prisma.supplierContract.findFirst({ where: { organizationId: s.user.organizationId, supplierId: s.user.supplierId, kind: "WORK", isActive: true }, orderBy: { date: "desc" }, select: { number: true, date: true } }),
    ]);
    if (wc && wc.number !== "1605") {
      const d = wc.date;
      initial.contract = `№ ${wc.number}${d ? ` от ${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}` : ""}`;
    }
    if (sup && !/в[еэ]лл?м[еэ][хк]/i.test(sup.name)) initial.signers = { ...initial.signers, contractorPost: `Генеральный директор ${sup.name}`, contractorName: "" };
  }
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "ТЗ", href: "/supplier/tz" }, { label: "Новое ТЗ" }]} />
      <h1 className="text-xl font-semibold">Новое ТЗ</h1>
      <TzForm id={null} initial={initial} readOnly={false} colors={refs.colors} models={refs.models} lots={refs.lots} batches={refs.batches} />
    </div>
  );
}
