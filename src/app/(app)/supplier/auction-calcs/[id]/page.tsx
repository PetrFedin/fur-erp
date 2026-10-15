import { notFound } from "next/navigation";
import { ChatLink } from "@/components/chat-link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { ReopenButton } from "../../reopen-button";
import { requireInboxViewer, inboxScope, INBOX_STATUS_LABEL } from "@/lib/supplier-inbox";
import { STAGE_LABEL, ensureRowIds, type CalcPayload } from "@/lib/supplier-calc";
import { CompareBlock } from "../compare-block";
import { FinalButton } from "../final-button";
import { calcYearOptions } from "@/lib/supplier-calc-years";
import { CalcForm } from "../calc-form";

export const metadata = { title: "Расчёт аукциона" };

export default async function CalcPage({ params }: PageProps<"/supplier/auction-calcs/[id]">) {
  const { id } = await params;
  const s = await requireInboxViewer();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) notFound();
  const row = await prisma.supplierInbox.findFirst({
    where: { id, kind: "AUCTION_CALC", ...inboxScope(s) },
    include: { files: { orderBy: { createdAt: "asc" }, select: { id: true, originalName: true, kind: true, sizeBytes: true } } },
  });
  if (!row) notFound();
  const payload = ensureRowIds(row.payload as unknown as CalcPayload);
  const years = await calcYearOptions(s);
  const readOnly = row.status !== "DRAFT" || s.user.role !== "SUPPLIER";
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Расчёты аукционов", href: "/supplier/auction-calcs" }, { label: row.title }]} />
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">{row.title}</h1>
        <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs">{INBOX_STATUS_LABEL[row.status]}</span>
        <ChatLink type="SupplierInbox" id={row.id} role={s.user.role} />
        {payload.stage && <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-800">{STAGE_LABEL[payload.stage]}</span>}
      </div>
      {row.status === "REJECTED" && s.user.role === "SUPPLIER" && <ReopenButton id={row.id} />}
      {payload.stage === "PRELIM" && s.user.role === "SUPPLIER" && <FinalButton id={row.id} />}
      <CompareBlock s={s} payload={payload} />
      <CalcForm id={row.id} initial={payload} readOnly={readOnly} files={row.files} reviewNote={row.reviewNote} years={years} />
    </div>
  );
}
