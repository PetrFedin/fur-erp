import { notFound } from "next/navigation";
import { ChatLink } from "@/components/chat-link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { TzStatusActions } from "../tz-status-actions";
import { requireInboxViewer, inboxScope, INBOX_STATUS_LABEL } from "@/lib/supplier-inbox";
import { INBOX_STATUS_HELP } from "@/lib/supplier-inbox-consts";
import { loadTzFormRefs } from "@/lib/supplier-tz-data";
import type { TzPayload } from "@/lib/tz-vendor";
import { TzForm } from "../tz-form";
import { tzPayInfo } from "@/lib/supplier-pay";
import { PayChip, PayLines } from "@/components/pay-status";

export const metadata = { title: "ТЗ" };

export default async function TzPage({ params }: PageProps<"/supplier/tz/[id]">) {
  const { id } = await params;
  const s = await requireInboxViewer();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) notFound();
  const row = await prisma.supplierInbox.findFirst({ where: { id, kind: "TZ", ...inboxScope(s) } });
  if (!row) notFound();
  // Оплата работы: для принятого ТЗ — разнесённые на него подтверждённые оплаты (без неразнесённых авансов и остатков заказчика).
  const orderIds = row.status === "ACCEPTED" && row.createdEntityType === "ProductionOrder" ? (row.createdEntityId ?? "").split(",").filter(Boolean) : [];
  const pay = orderIds.length ? await tzPayInfo(row.organizationId, row.supplierId, orderIds) : null;
  const readOnly = row.status !== "DRAFT" || s.user.role !== "SUPPLIER";
  const refs = readOnly ? { colors: [], models: [], lots: [], batches: [] } : await loadTzFormRefs(s.user.organizationId, s.user.supplierId ?? "-");
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "ТЗ", href: "/supplier/tz" }, { label: row.title }]} />
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">{row.title}</h1>
        <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs">{INBOX_STATUS_LABEL[row.status]}</span>
        <ChatLink type="SupplierInbox" id={row.id} role={s.user.role} />
      </div>
      <p className="text-sm text-neutral-600">{INBOX_STATUS_HELP[row.status]}</p>
      {pay && (
        <div className="flex flex-col gap-1 text-sm">
          <p className="flex flex-wrap items-center gap-2"><b>Оплата:</b> <PayChip info={pay} /></p>
          <PayLines info={pay} />
        </div>
      )}
      {s.user.role === "SUPPLIER" && <TzStatusActions id={row.id} status={row.status} />}
      <TzForm id={row.id} initial={row.payload as unknown as TzPayload} readOnly={readOnly} colors={refs.colors} models={refs.models} lots={refs.lots} batches={refs.batches} reviewNote={row.reviewNote} />
    </div>
  );
}
