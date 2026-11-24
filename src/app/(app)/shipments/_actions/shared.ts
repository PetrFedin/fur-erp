import "server-only";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { isDateInRange } from "@/lib/shipments";

// Так же, как в разделе ТЗ: отгрузки ведут те, кто ведёт ТЗ.
export const EDIT_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;

export type Sess = Awaited<ReturnType<typeof requireRole>>;

export const isSupplier = (s: Sess) => s.user.role === "SUPPLIER";

/** Отгрузки, доступные пользователю: у поставщика — только его (supplierId), у остальных — вся организация. */
export const shipmentScope = (s: Sess) => ({ organizationId: s.user.organizationId, ...(isSupplier(s) ? { supplierId: s.user.supplierId ?? "-" } : {}) });

export type EditResult = { error?: string; ok?: boolean };

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

export const dateOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime()) && isDateInRange(s);

/** Ответственный вписывается текстом; если совпал с именем пользователя приложения (без учёта регистра) — связываем с ним. */
export async function resolveResponsible(orgId: string, name: string): Promise<{ responsibleUserId: string | null; responsibleName: string | null }> {
  const n = name.trim().slice(0, 120);
  if (!n) return { responsibleUserId: null, responsibleName: null };
  const u = await prisma.user.findFirst({ where: { organizationId: orgId, name: { equals: n, mode: "insensitive" } }, select: { id: true } });
  return { responsibleUserId: u?.id ?? null, responsibleName: n };
}

export async function ownShipment(session: Sess, id: string) {
  return prisma.shipment.findFirst({ where: { id, ...shipmentScope(session) }, select: { id: true } });
}
