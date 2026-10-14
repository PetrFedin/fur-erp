"use server";

import { prisma } from "@/lib/prisma";
import { requireSupplierSession } from "@/lib/supplier-inbox";
import type { CalcPayload } from "@/lib/supplier-calc";

/** «Мои форматы» Веллмеха: набор столбцов, формул и параметров. Видны только своему поставщику. */
export type TemplateRow = { id: string; name: string; description: string; payload: TemplatePayload; updatedAt: string };
export type TemplatePayload = Pick<CalcPayload, "customColumns" | "params" | "qtyColumn" | "priceColumn" | "unitCostColumn" | "checks">;
type R = { error?: string; ok?: boolean; id?: string };

/** Берём из расчёта только набор столбцов; значения строк и шапка в формат не попадают. */
function pick(json: string): TemplatePayload | string {
  if (json.length > 500_000) return "Слишком большой формат";
  try {
    const p = JSON.parse(json) as CalcPayload;
    if (!Array.isArray(p.customColumns) || p.customColumns.length === 0) return "В расчёте нет столбцов: добавьте хотя бы один столбец или выберите формат";
    if (p.customColumns.length > 80) return "Не больше 80 столбцов";
    return {
      customColumns: p.customColumns, params: p.params ?? [], qtyColumn: p.qtyColumn, priceColumn: p.priceColumn, unitCostColumn: p.unitCostColumn, checks: p.checks,
    };
  } catch {
    return "Некорректные данные формата";
  }
}
const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

export async function listTemplates(): Promise<TemplateRow[]> {
  const s = await requireSupplierSession();
  const rows = await prisma.supplierCalcTemplate.findMany({
    where: { organizationId: s.user.organizationId, supplierId: s.user.supplierId },
    orderBy: { updatedAt: "desc" }, take: 100,
  });
  return rows.map((r) => ({ id: r.id, name: r.name, description: r.description ?? "", payload: r.payload as unknown as TemplatePayload, updatedAt: r.updatedAt.toISOString() }));
}

/** Сохранить текущие столбцы как «мой формат». Если задан id — обновить свой формат. */
export async function saveTemplate(id: string | null, name: string, description: string, json: string): Promise<R> {
  const s = await requireSupplierSession();
  const nm = clean(name, 80);
  if (!nm) return { error: "Введите название формата" };
  const payload = pick(json);
  if (typeof payload === "string") return { error: payload };
  const scope = { organizationId: s.user.organizationId, supplierId: s.user.supplierId };
  if (id) {
    const r = await prisma.supplierCalcTemplate.updateMany({ where: { id, ...scope }, data: { name: nm, description: clean(description, 300) || null, payload: payload as object } });
    return r.count === 1 ? { ok: true, id } : { error: "Формат не найден" };
  }
  if ((await prisma.supplierCalcTemplate.count({ where: scope })) >= 100) return { error: "Не больше 100 своих форматов" };
  const row = await prisma.supplierCalcTemplate.create({ data: { ...scope, name: nm, description: clean(description, 300) || null, payload: payload as object, createdById: s.user.id }, select: { id: true } });
  return { ok: true, id: row.id };
}

export async function renameTemplate(id: string, name: string, description: string): Promise<R> {
  const s = await requireSupplierSession();
  const nm = clean(name, 80);
  if (!nm) return { error: "Введите название формата" };
  const r = await prisma.supplierCalcTemplate.updateMany({ where: { id, organizationId: s.user.organizationId, supplierId: s.user.supplierId }, data: { name: nm, description: clean(description, 300) || null } });
  return r.count === 1 ? { ok: true } : { error: "Формат не найден" };
}

export async function deleteTemplate(id: string): Promise<R> {
  const s = await requireSupplierSession();
  const r = await prisma.supplierCalcTemplate.deleteMany({ where: { id, organizationId: s.user.organizationId, supplierId: s.user.supplierId } });
  return r.count === 1 ? { ok: true } : { error: "Формат не найден" };
}
