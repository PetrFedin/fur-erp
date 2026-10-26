import "server-only";
import { prisma } from "@/lib/prisma";

export type AsOfPart = { loaded: string; last: string | null; source: string };
export type DataAsOf = { sales: AsOfPart | null; receipts: AsOfPart | null };

/** Источник и дата загрузки из метки импорта: «datamart-sales:2026-10-26», «sales-import:2026-10-19». */
const SOURCE = (tag: string) => (tag.startsWith("datamart") ? "витрина datamart" : "файл «поступления и продажи»");

/** На какую дату данные продаж и поступлений: дата загрузки (из метки импорта) и дата последней строки. Нет таблицы или строк — null. */
export async function loadDataAsOf(orgId: string): Promise<DataAsOf> {
  try {
    const part = async (kind: "SALE" | "RECEIPT"): Promise<AsOfPart | null> => {
      const [tags, last] = await Promise.all([
        prisma.salesReceiptLine.groupBy({ by: ["importTag"], where: { organizationId: orgId, kind } }),
        prisma.salesReceiptLine.aggregate({ where: { organizationId: orgId, kind }, _max: { date: true } }),
      ]);
      if (!tags.length) return null;
      const tag = tags.map((t) => t.importTag).sort().pop()!;
      return { loaded: tag.split(":")[1] ?? "", last: last._max.date ? last._max.date.toISOString().slice(0, 10) : null, source: SOURCE(tag) };
    };
    const [sales, receipts] = await Promise.all([part("SALE"), part("RECEIPT")]);
    return { sales, receipts };
  } catch {
    return { sales: null, receipts: null };
  }
}
