"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { revalidateAll } from "@/lib/revalidate-all";
import { parseZi, ziKey, matchZi } from "@/lib/shipment-zi";
import { allocFromZi, parseAlloc, validateAlloc, ziBySite, type AllocInput, type AllocState, type LineCtx } from "@/lib/shipment-alloc";

// Раскладка по площадкам ЦУМ — только наша сторона. Подрядчик сюда не допускается.
const ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;
type Res = { error?: string; ok?: boolean };
const LABEL = "Изменена раскладка приёмки по площадкам";
const ID = /^[A-Za-z0-9_-]{1,64}$/;

async function ctxOf(shipmentId: string) {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  if (!ID.test(shipmentId)) return { error: "Отгрузка не найдена" } as const;
  const lines = await prisma.shipmentLine.findMany({
    where: { shipmentId, shipment: { organizationId: orgId } },
    select: { id: true, size: true, color: true, quantity: true, acceptedQty: true, customArticle: true, productionOrder: { select: { productModel: { select: { salesCode: true, name: true } } } } },
  });
  if (!lines.length) return { error: "Отгрузка не найдена" } as const;
  const ctx: Record<string, LineCtx> = {};
  for (const l of lines) ctx[l.id] = { quantity: l.quantity, accepted: l.acceptedQty, label: `${l.productionOrder?.productModel.salesCode ?? l.customArticle ?? "–"} · ${l.color ?? "–"} · р. ${l.size ?? "–"}` };
  return { session, orgId, lines, ctx } as const;
}

type Sess = { user: { id: string; name?: string | null; role: string } };

async function write(orgId: string, shipmentId: string, session: Sess, next: AllocState | null): Promise<Res> {
  const key = ziKey(shipmentId);
  const done = await prisma.$transaction(async (tx) => {
    const row = await tx.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key } } });
    const zi = row ? parseZi(row.value) : null;
    if (!row || !zi) return false;
    const before = parseAlloc(zi.alloc);
    const value = { ...zi, alloc: next ?? undefined };
    await tx.systemState.update({ where: { id: row.id }, data: { value: JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue } });
    await tx.auditLog.create({
      data: { organizationId: orgId, actorId: session.user.id, actorName: session.user.name ?? null, actorRole: session.user.role, source: "ui", model: "ShipmentAllocation", recordId: shipmentId, action: "update", label: LABEL, changes: JSON.parse(JSON.stringify({ before, after: next })) as Prisma.InputJsonValue },
    });
    return true;
  });
  if (!done) return { error: "Накладные ЗИ по этой отгрузке не внесены" };
  revalidateAll(orgId);
  return { ok: true };
}

/** Сохранить всю матрицу «позиции × площадки» одной кнопкой. */
export async function saveAlloc(shipmentId: string, input: AllocInput): Promise<Res> {
  const c = await ctxOf(shipmentId);
  if ("error" in c) return { error: c.error };
  const v = validateAlloc(input ?? {}, c.ctx, c.session.user.name ?? c.session.user.id, new Date().toISOString());
  if ("error" in v) return { error: v.error };
  return write(c.orgId, shipmentId, c.session, v.state);
}

/** «Как в накладных»: матрица из импортированных накладных ЗИ (прежние правки заменяются). */
export async function fillAllocFromZi(shipmentId: string): Promise<Res> {
  const c = await ctxOf(shipmentId);
  if ("error" in c) return { error: c.error };
  const row = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: c.orgId, key: ziKey(shipmentId) } }, select: { value: true } });
  const zi = row ? parseZi(row.value) : null;
  if (!zi) return { error: "Накладные ЗИ по этой отгрузке не внесены" };
  const m = matchZi(zi.lines, c.lines.map((l) => ({ id: l.id, code: l.productionOrder?.productModel.salesCode ?? l.customArticle ?? "", size: l.size, color: l.color, quantity: l.quantity })));
  const perLine: Parameters<typeof allocFromZi>[0] = {};
  for (const l of c.lines) perLine[l.id] = { sites: ziBySite(m.byLine.get(l.id)?.items ?? []), accepted: l.acceptedQty, label: c.ctx[l.id].label };
  const order = [...new Set(zi.lines.map((z) => z.boutique))];
  const f = allocFromZi(perLine, order, c.session.user.name ?? c.session.user.id, new Date().toISOString());
  if ("error" in f) return { error: f.error };
  return write(c.orgId, shipmentId, c.session, f.state);
}

/** «Очистить»: убрать всю раскладку. */
export async function clearAlloc(shipmentId: string): Promise<Res> {
  const c = await ctxOf(shipmentId);
  if ("error" in c) return { error: c.error };
  return write(c.orgId, shipmentId, c.session, null);
}
