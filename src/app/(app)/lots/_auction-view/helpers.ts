import { Decimal } from "@prisma/client/runtime/library";
import { formatRate } from "@/lib/utils";

export const UNIT_LABELS: Record<string, string> = { PIECE: "шт.", KG: "кг", M2: "м²", M: "м", SET: "компл." };

export type AuctionSummary = {
  name: string;
  count: number;
  received: number;
  draft: number;
  cancelled: number;
  lastDate: number;
  /** Источник закупки: настоящий аукцион или поставщик (тот же признак, что у лотов на Главной). */
  src: "auction" | "supplier";
};

export function auctionStatusText(a: Pick<AuctionSummary, "count" | "received" | "draft" | "cancelled">): string {
  const parts: string[] = [];
  if (a.received && !a.draft && !a.cancelled) parts.push("принято");
  else if (a.draft && !a.received && !a.cancelled) parts.push("черновики");
  else {
    if (a.received) parts.push(`принято ${a.received}`);
    if (a.draft) parts.push(`черновиков ${a.draft}`);
    if (a.cancelled) parts.push(`отменено ${a.cancelled}`);
  }
  return parts.join(", ");
}

export function pluralPurchases(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} закупка`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} закупки`;
  return `${n} закупок`;
}

type Plan = { unitCostInclVat: Decimal; materialExclVat: Decimal; expenseExclVat: Decimal; costBreakdown: unknown };

export function parsePlan(raw: unknown): Plan | null {
  const c = raw as Record<string, unknown> | null | undefined;
  if (!c || typeof c !== "object") return null;
  try {
    if (c.unitCostInclVat == null || c.materialExclVat == null || c.expenseExclVat == null) return null;
    return {
      unitCostInclVat: new Decimal(String(c.unitCostInclVat)),
      materialExclVat: new Decimal(String(c.materialExclVat)),
      expenseExclVat: new Decimal(String(c.expenseExclVat)),
      costBreakdown: c.costBreakdown,
    };
  } catch {
    return null;
  }
}

export const grossUp = (base: Decimal, vat: Decimal) => base.add(base.mul(vat).div(100));

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
}

/** Версия файла для ссылки (сброс кэша при замене) — по имени файла на диске, а не по дате документа. */
export const docVersion = (storagePath: string) => encodeURIComponent(storagePath.split(/[\\/]/).pop() ?? "");

export const rateText = (r: Decimal) => formatRate(Number(r.toString()));
