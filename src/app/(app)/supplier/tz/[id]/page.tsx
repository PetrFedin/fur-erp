import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { requireInboxViewer, inboxScope, INBOX_STATUS_LABEL } from "@/lib/supplier-inbox";
import { loadTzFormRefs } from "@/lib/supplier-tz-data";
import type { TzPayload } from "@/lib/tz-vendor";
import { TzForm } from "../tz-form";

export const metadata = { title: "ТЗ" };

export default async function TzPage({ params }: PageProps<"/supplier/tz/[id]">) {
  const { id } = await params;
  const s = await requireInboxViewer();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) notFound();
  const row = await prisma.supplierInbox.findFirst({ where: { id, kind: "TZ", ...inboxScope(s) } });
  if (!row) notFound();
  const readOnly = row.status !== "DRAFT" || s.user.role !== "SUPPLIER";
  const refs = readOnly ? { colors: [], models: [], lots: [] } : await loadTzFormRefs(s.user.organizationId);
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "ТЗ", href: "/supplier/tz" }, { label: row.title }]} />
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">{row.title}</h1>
        <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs">{INBOX_STATUS_LABEL[row.status]}</span>
      </div>
      <TzForm id={row.id} initial={row.payload as unknown as TzPayload} readOnly={readOnly} colors={refs.colors} models={refs.models} lots={refs.lots} reviewNote={row.reviewNote} />
    </div>
  );
}
