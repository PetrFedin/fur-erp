import { notFound } from "next/navigation";
import { ChatLink } from "@/components/chat-link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { ReopenButton } from "../../reopen-button";
import { requireRawViewer, inboxScope, INBOX_STATUS_LABEL } from "@/lib/supplier-inbox";
import { INBOX_STATUS_HELP, shortInboxTitle } from "@/lib/supplier-inbox-consts";
import { STAGE_LABEL, ensureRowIds, type CalcPayload } from "@/lib/supplier-calc";
import { CompareBlock } from "../compare-block";
import { FinalButton } from "../final-button";
import { calcYearOptions } from "@/lib/supplier-calc-years";
import { CalcForm } from "../calc-form";
import { loadSupplierPayData, groupPayInfo } from "@/lib/supplier-pay";
import { PayChip, PayLines } from "@/components/pay-status";

export const metadata = { title: "Расчёт аукциона" };

export default async function CalcPage({ params }: PageProps<"/supplier/auction-calcs/[id]">) {
  const { id } = await params;
  const s = await requireRawViewer();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) notFound();
  const row = await prisma.supplierInbox.findFirst({
    where: { id, kind: "AUCTION_CALC", ...inboxScope(s) },
    include: { files: { orderBy: { createdAt: "asc" }, select: { id: true, originalName: true, kind: true, sizeBytes: true } } },
  });
  if (!row) notFound();
  const payload = ensureRowIds(row.payload as unknown as CalcPayload);
  const years = await calcYearOptions(s);
  // Оплата: для принятого расчёта — по созданным из него закупкам; только проведённые оплаты этого подрядчика.
  const purchaseIds = row.status === "ACCEPTED" && row.createdEntityType === "Purchase" ? (row.createdEntityId ?? "").split(",").filter(Boolean) : [];
  const pay = purchaseIds.length ? groupPayInfo(await loadSupplierPayData(row.organizationId, row.supplierId), purchaseIds) : null;
  const full = row.title;
  const shortTitle = shortInboxTitle(full);
  const readOnly = row.status !== "DRAFT" || s.user.role !== "SUPPLIER";
  const lockReason = row.status !== "DRAFT"
    ? `Расчёт ${row.status === "SENT" ? "отправлен и на проверке" : row.status === "ACCEPTED" ? "принят" : "возвращён"}: править нельзя${row.status === "REJECTED" ? ' — верните в черновик кнопкой выше' : ""}.`
    : s.user.role !== "SUPPLIER" ? "Вы смотрите расчёт поставщика: править его может только поставщик." : null;
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Расчёты аукционов", href: "/supplier/auction-calcs" }, { label: shortTitle }]} />
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold" title={full}>{shortTitle}</h1>
        <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs">{INBOX_STATUS_LABEL[row.status]}</span>
        <ChatLink type="SupplierInbox" id={row.id} role={s.user.role} />
        {payload.stage && <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-800">{STAGE_LABEL[payload.stage]}</span>}
      </div>
      <p className="text-sm text-neutral-600" data-testid="status-help">{INBOX_STATUS_HELP[row.status]}{row.sentAt && row.status !== "DRAFT" ? ` Отправлено ${row.sentAt.toLocaleDateString("ru-RU")}.` : ""}</p>
      {pay && (
        <div className="flex flex-col gap-1 text-sm">
          <p className="flex flex-wrap items-center gap-2"><b>Оплата:</b> <PayChip info={pay} /></p>
          <PayLines info={pay} />
        </div>
      )}
      {row.status === "REJECTED" && s.user.role === "SUPPLIER" && <ReopenButton id={row.id} />}
      {payload.stage === "PRELIM" && s.user.role === "SUPPLIER" && <FinalButton id={row.id} />}
      <CompareBlock s={s} payload={payload} />
      <CalcForm id={row.id} initial={payload} readOnly={readOnly} files={row.files} reviewNote={row.reviewNote} years={years} lockReason={lockReason} />
    </div>
  );
}
