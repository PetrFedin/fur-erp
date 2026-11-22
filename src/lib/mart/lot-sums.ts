import "server-only";
import type { PrismaClient } from "@prisma/client";

/**
 * Чтение сумм по лотам из витрины (DmLot): все четыре варианта показа лежат готовыми,
 * поэтому смена «С НДС / Без НДС» и «С 4 % / Без 4 %» — это выбор столбца, а не пересчёт.
 *  Куплено и остаток от 4 % не зависят; «Использовано» с 4 % = usedCost + usedExtra.
 */
export type LotSumMode = { vat: "incl" | "excl"; c4: "on" | "off" };
export type LotSumGroup = "kind" | "year" | "month" | "auction" | "material";
export type LotSumRow = { key: string; lots: number; recvQty: number; usedQty: number; remQty: number; recv: number; used: number; rem: number };

const COL: Record<LotSumGroup, string> = { kind: `d."unit"`, year: `d."purchaseYear"::text`, month: `d."purchaseMonth"`, auction: `coalesce(d."auction", '')`, material: `d."material"` };

export async function loadLotSums(db: Pick<PrismaClient, "$queryRawUnsafe">, orgId: string, group: LotSumGroup, mode: LotSumMode, opts: { unit?: "M" | "PCS"; year?: number } = {}): Promise<LotSumRow[]> {
  const excl = mode.vat === "excl";
  const recv = excl ? `d."totalCostExcl"` : `d."totalCost"`;
  const used = (excl ? `d."usedCostExcl"` : `d."usedCost"`) + (mode.c4 === "on" ? ` + ${excl ? `d."usedExtraExcl"` : `d."usedExtraIncl"`}` : "");
  const remPart = excl ? `d."qtyRemaining" * d."unitCostExcl"` : `d."qtyRemaining" * d."unitCost"`;
  const rows = await db.$queryRawUnsafe<{ key: string; lots: number; rq: string; uq: string; mq: string; r: string; u: string; m: string }[]>(
    `SELECT ${COL[group]} AS key, count(*)::int AS lots, sum(d."qtyReceived")::text rq, sum(d."qtyUsed")::text uq, sum(d."qtyRemaining")::text mq, sum(${recv})::text r, sum(${used})::text u, sum(${remPart})::text m
     FROM "DmLot" d WHERE d."organizationId" = $1 ${opts.unit ? `AND d."unit" = '${opts.unit === "M" ? "M" : "PCS"}'` : ""} ${opts.year ? `AND d."purchaseYear" = ${Math.trunc(opts.year)}` : ""}
     GROUP BY 1 ORDER BY 1`,
    orgId,
  );
  return rows.map((r) => ({ key: r.key, lots: r.lots, recvQty: Number(r.rq), usedQty: Number(r.uq), remQty: Number(r.mq), recv: Number(r.r), used: Number(r.u), rem: Number(r.m) }));
}
