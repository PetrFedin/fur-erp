import { getFreshSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ACCESS, hasRole } from "@/lib/access";
import { PAYMENT_KINDS, buildPaymentInvoiceXlsx, type InvoiceInput, type PaymentKind } from "@/lib/vendor-invoice";
import { requisitesByInn } from "@/lib/vendor-requisites";
import { detectDocument, writeDocumentFiles } from "@/lib/purchase-files";
import { removeStoredFiles } from "@/lib/fitting-files";

export const dynamic = "force-dynamic";

/** Счёт на оплату Веллмеха (Excel) по данным формы. Ничего не пишет в базу; реквизиты — только известного поставщика. */
export async function POST(req: Request, ctx: RouteContext<"/api/supplier/auction-calcs/[id]/invoice">) {
  const session = await getFreshSession({ allowSupplier: true });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const role = session.user.role;
  if (role !== "SUPPLIER" && !hasRole(role, ACCESS.inbox)) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  try {
    const b = (await req.json()) as Partial<InvoiceInput> & { vat?: string; attach?: boolean };
    if (!b.kind || !PAYMENT_KINDS.includes(b.kind as PaymentKind) || !(Number(b.amount) > 0) || !String(b.number ?? "").trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date ?? ""))) return new Response("Bad request", { status: 400 });
    let supplierId = role === "SUPPLIER" ? session.user.supplierId ?? null : null;
    if (id !== "new") {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response("Not found", { status: 404 });
      const row = await prisma.supplierInbox.findFirst({ where: { id, kind: "AUCTION_CALC", organizationId: session.user.organizationId, ...(role === "SUPPLIER" ? { supplierId: session.user.supplierId ?? "-" } : {}) }, select: { supplierId: true } });
      if (!row) return new Response("Not found", { status: 404 });
      supplierId = row.supplierId;
    }
    const sup = supplierId ? await prisma.supplier.findFirst({ where: { id: supplierId, organizationId: session.user.organizationId }, select: { inn: true } }) : null;
    const reqs = requisitesByInn(sup?.inn);
    if (!reqs) return new Response("Реквизиты этого поставщика не заведены", { status: 422 });
    const vatPct = Number(String(b.vat ?? "22").replace(",", ".")) || 22;
    const inp: InvoiceInput = {
      kind: b.kind as PaymentKind, number: String(b.number).trim().slice(0, 30), date: String(b.date), specNumber: String(b.specNumber ?? "").slice(0, 20), specDate: String(b.specDate ?? ""),
      description: String(b.description ?? "").slice(0, 500), amount: Number(b.amount), vatPct, dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(b.dueDate ?? "")) ? String(b.dueDate) : "",
    };
    const buf = await buildPaymentInvoiceXlsx(inp, reqs);
    const name = `Счет на оплату № ${inp.number} от ${inp.date.split("-").reverse().join(".")}.xlsx`;
    let attached = false;
    // «Приложить к расчёту»: счёт сохраняется вложением черновика (тип «Счёт Веллмеха на аванс») и уйдёт к нам вместе с расчётом; повторная сборка заменяет прежний файл
    if (b.attach && id !== "new" && role === "SUPPLIER") {
      const row = await prisma.supplierInbox.findFirst({ where: { id, kind: "AUCTION_CALC", status: "DRAFT", organizationId: session.user.organizationId, supplierId: session.user.supplierId ?? "-" }, select: { id: true, files: { select: { id: true, originalName: true, kind: true, storagePath: true } } } });
      const kind = detectDocument(buf.subarray(0, 16), name, buf);
      if (row && kind) {
        const old = row.files.filter((f) => f.kind === "PAYMENT_INVOICE" && f.originalName === name);
        const [st] = await writeDocumentFiles(session.user.organizationId, `supplier-inbox/${id}`, [{ buf, kind, originalName: name }]);
        await prisma.supplierInboxFile.create({ data: { inboxId: id, storagePath: st.storagePath, originalName: st.originalName, mimeType: st.mimeType, sizeBytes: st.sizeBytes, kind: "PAYMENT_INVOICE" } });
        if (old.length) { await prisma.supplierInboxFile.deleteMany({ where: { id: { in: old.map((o) => o.id) } } }); await removeStoredFiles(old.map((o) => o.storagePath)); }
        attached = true;
      }
    }
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="invoice.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "private, no-store", ...(attached ? { "X-Attached": "1" } : {}) },
    });
  } catch {
    return new Response("Bad request", { status: 400 });
  }
}
