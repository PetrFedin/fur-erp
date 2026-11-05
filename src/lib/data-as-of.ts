import "server-only";
import { prisma } from "@/lib/prisma";
import { loadReportSizesState } from "@/lib/import-keys";
import { memoRequest, jsonKey } from "@/lib/req-memo";

export type AsOfPart = { loaded: string; last: string | null; source: string };
export type DataAsOf = { sales: AsOfPart | null; receipts: AsOfPart | null; report: string | null };

/** Источник и дата загрузки из метки импорта: «datamart-sales:2026-10-26», «sales-import:2026-10-19». */
const SOURCE = (tag: string) => (tag.startsWith("datamart") ? "витрина datamart" : "файл «поступления и продажи»");

/** На какую дату данные: дата отчёта «заказ и продажи» (report), даты загрузки и последних строк продаж и поступлений. Нет таблицы или строк — null. */
async function loadDataAsOfImpl(orgId: string): Promise<DataAsOf> {
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
    // Дата отчёта «заказ и продажи» (версия по указателю sales-report-sizes:current) — она же дата прайса: грузятся одним файлом.
    const st = await loadReportSizesState(orgId);
    const report = st ? ((st.value as { asOf?: unknown }).asOf ?? st.key.split(":")[1]) as string : null;
    return { sales, receipts, report };
  } catch {
    return { sales: null, receipts: null, report: null };
  }
}

/** Кэш: в запросе и между запросами на демо-стенде (см. req-memo.ts); результат общий, менять на месте нельзя. */
export const loadDataAsOf = memoRequest("data-as-of", loadDataAsOfImpl, (orgId) => orgId, { shared: true });
