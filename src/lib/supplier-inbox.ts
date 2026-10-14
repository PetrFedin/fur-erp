import "server-only";
import { requireRole } from "@/lib/session";

export type SupplierSess = Awaited<ReturnType<typeof requireRole>>;

/** Только поставщик с привязкой к своему поставщику; иначе — отказ (периметр «по умолчанию закрыто»). */
export async function requireSupplierSession() {
  const s = await requireRole("SUPPLIER");
  if (!s.user.supplierId) throw new Error("Кабинет не привязан к поставщику");
  return s as SupplierSess & { user: { supplierId: string } };
}

/** Чьи входящие видны: поставщик — только свои (supplierId), владелец/админ — все организации (предпросмотр). */
export const inboxScope = (s: SupplierSess) => ({
  organizationId: s.user.organizationId,
  ...(s.user.role === "SUPPLIER" ? { supplierId: s.user.supplierId ?? "-" } : {}),
});

export { INBOX_FILE_KINDS, INBOX_STATUS_LABEL } from "@/lib/supplier-inbox-consts";

/** Страницы /supplier/**: поставщик — свои; владелец и админ — просмотр всех; остальные уходят на главную. */
export async function requireInboxViewer() {
  const { requireSession } = await import("@/lib/session");
  const { redirect } = await import("next/navigation");
  const s = await requireSession({ allowSupplier: true });
  if (s.user.role !== "SUPPLIER" && s.user.role !== "OWNER" && s.user.role !== "ADMIN") redirect("/dashboard");
  return s;
}
