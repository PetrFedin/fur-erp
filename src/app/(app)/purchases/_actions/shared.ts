import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ACCESS } from "@/lib/access";
import { resolveColorInput } from "@/lib/colors";
import { Decimal } from "@prisma/client/runtime/library";
import { type ParsedRow } from "../parse-rows";
import { MAX_MONEY, zNum, parseDateInput } from "@/lib/input";
import { resolveAuction } from "@/lib/auction-ref";
import { replaceFirstLine } from "@/lib/auction-key";

export const dateField = (label = "Некорректная дата") =>
  z.string().refine((s) => parseDateInput(s) !== null, label);

export const currencyField = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Некорректная валюта").default("RUB");

export const vatField = zNum("Ставка НДС", { max: 100 });

export const AMOUNT_TOO_BIG = "Сумма слишком велика — проверьте количество и цену";

export const tooBig = (d: Decimal) => d.gte(MAX_MONEY);

export const EDIT_ROLES = ACCESS.purchases;

export const WAREHOUSE_ROLES = ["OWNER", "ADMIN", "PURCHASER", "WAREHOUSE"] as const;

export type OrderRef = { id: string; number: string; quantity: string };

export type Issue = { level: "error" | "warning"; text: string };

export type FormState = { error?: string; issues?: Issue[]; orders?: OrderRef[]; confirm?: string };

/**
 * Аукцион закупки из формы: выбор из справочника (`auctionId`) -> запись auctionId и кэш-текст auctionSession = короткое имя.
 * Без выбора, но с текстом (пачка/импорт/старая форма): сопоставление с справочником по имени или прежнему написанию;
 * не найден — текст сохраняется как есть, без привязки. `current` — прежний текст закупки (строки после первой сохраняются).
 */
export async function purchaseAuctionFromForm(orgId: string, formData: FormData, current?: string | null): Promise<{ error: string } | { auctionId: string | null | undefined; auctionSession: string | null | undefined }> {
  const id = ((formData.get("auctionId") as string | null) ?? "").trim();
  const text = ((formData.get("auctionSession") as string | null) ?? "").trim();
  const keepTail = (name: string) => (current && /\r?\n/.test(current) ? replaceFirstLine(current, name) : name);
  if (id) {
    const a = await prisma.auction.findFirst({ where: { id, organizationId: orgId }, select: { id: true, name: true } });
    if (!a) return { error: "Аукцион не найден в справочнике — обновите страницу" };
    return { auctionId: a.id, auctionSession: keepTail(a.name) };
  }
  // Правка закупки: текст не менялся и аукцион не выбирали (например, заглушка «Нет информации» с привязкой) — оставляем как есть.
  if (current !== undefined && text === (current ?? "").split(/\r?\n/)[0].trim()) return { auctionId: undefined, auctionSession: undefined };
  if (!text) return { auctionId: null, auctionSession: null };
  const a = await resolveAuction(text, orgId);
  if (a && !a.isService) return { auctionId: a.id, auctionSession: keepTail(a.name) };
  return { auctionId: null, auctionSession: text };
}

// Номера лотов, уже существующих на складе организации (для предупреждения о дублях).
export async function existingLotNumbers(orgId: string): Promise<string[]> {
  const lots = await prisma.rawMaterialLot.findMany({
    where: { organizationId: orgId, lotNumber: { not: null } },
    select: { lotNumber: true },
  });
  return lots.map((l) => l.lotNumber as string);
}

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// Writes already-validated pasted lines; unknown materials are created
// (same find-or-create behaviour as the historical-import scripts).
export async function insertPasteRows(tx: Tx, orgId: string, purchaseId: string, rows: ParsedRow[]) {
  // Цвет из вставки: сопоставляем со справочником по названию/синониму (латиница, регистр); нет соответствия — текст как есть.
  const colorByText = new Map<string, { color: string | null; colorRefId: string | null }>();
  for (const t of new Set(rows.map((r) => r.color).filter((c): c is string => !!c))) colorByText.set(t, await resolveColorInput(tx, orgId, { color: t }));
  const materials = await tx.rawMaterial.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
  const idByName = new Map(materials.map((m) => [m.name.trim().toLowerCase(), m.id]));
  for (const r of rows) {
    const key = r.materialName.toLowerCase();
    if (!idByName.has(key)) {
      const created = await tx.rawMaterial.create({
        data: { organizationId: orgId, name: r.materialName, unit: "PIECE" },
      });
      idByName.set(key, created.id);
    }
  }
  await tx.purchaseItem.createMany({
    data: rows.map((r) => ({
      purchaseId,
      rawMaterialId: idByName.get(r.materialName.toLowerCase())!,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      subtotal: new Decimal(r.quantity).mul(r.unitPrice),
      vatRate: r.vatRate,
      lotNumber: r.lotNumber,
      grade: r.grade,
      color: r.color ? colorByText.get(r.color)?.color ?? r.color : r.color,
      colorRefId: r.color ? colorByText.get(r.color)?.colorRefId ?? null : null,
    })),
  });
}

export async function getEditablePurchase(organizationId: string, purchaseId: string) {
  return prisma.purchase.findFirst({
    where: { id: purchaseId, organizationId, status: { notIn: ["RECEIVED", "CANCELLED"] } },
  });
}
