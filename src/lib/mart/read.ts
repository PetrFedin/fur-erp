import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Слой чтения единой витрины данных для экранов.
 * Правило перевода: экран читает витрину только если она СВЕЖАЯ относительно своих источников; иначе экран остаётся на старом расчёте
 * (и запускается пересборка в фоне). Так число никогда не станет «старее», чем было до перевода.
 * Что уже переведено и что нет — docs/data-mart/MIGRATION-STATUS.md.
 */

export type ReportSeasonTotalMart = { label: string; conf: number; deliv: number; clothes: { conf: number; deliv: number }; acc: { conf: number; deliv: number } };

/**
 * Свежа ли витрина для данных, собираемых из отчёта «заказ и продажи», прайса и файла прихода/продаж:
 * она построена позже последнего изменения этих источников (версии отчёта и прайса, журналы загрузок, строки прихода/продаж).
 */
export type MartState = "fresh" | "stale" | "absent";

/** «absent» — витрины нет (например, демо-стенд: там таблицы очищены) — экран остаётся на старом расчёте и ничего не пересобирает. */
export async function martFreshForReport(orgId: string): Promise<MartState> {
  const [built] = await prisma.$queryRaw<{ built: Date | null }[]>`SELECT max("builtAt") AS built FROM "DmSku" WHERE "organizationId" = ${orgId}`;
  if (!built?.built) return "absent";
  const [st] = await prisma.$queryRaw<{ last: Date | null }[]>`SELECT max("updatedAt") AS last FROM "SystemState" WHERE "organizationId" = ${orgId} AND ("key" LIKE 'sales-report-sizes:%' OR "key" LIKE 'retail-prices:%' OR "key" LIKE 'import-journal:%')`;
  if (st?.last && st.last > built.built) return "stale";
  const [rc] = await prisma.$queryRaw<{ n: bigint; last: Date | null }[]>`SELECT count(*) AS n, max("createdAt") AS last FROM "SalesReceiptLine" WHERE "organizationId" = ${orgId} AND "modelCode" IS NOT NULL`;
  if (rc?.last && rc.last > built.built) return "stale";
  const [ld] = await prisma.$queryRaw<{ rows: number | null }[]>`SELECT "rows" FROM "DmLoad" WHERE "organizationId" = ${orgId} AND "source" = 'receipt-lines' ORDER BY "loadedAt" DESC LIMIT 1`;
  if (ld?.rows == null || Number(rc?.n ?? 0) !== Number(ld.rows)) return "stale";
  return "fresh";
}

const LABEL: Record<string, string> = { "FW25/26": "FW 25/26", SS26: "SS 2026", "FW26/27": "FW 26/27" };

/** Итоги сезонов отчёта (заказано и поступило: всего, одежда, аксессуары) из витрины; null — витрины нет. Совпадает с прежним расчётом из отчёта. */
export async function martSeasonTotals(orgId: string): Promise<ReportSeasonTotalMart[] | null> {
  const rows = await prisma.$queryRaw<{ season: string; cls: string; conf: string; deliv: string }[]>`
    SELECT s."season" AS season, k."cls" AS cls, sum(s."conf")::text AS conf, sum(s."deliv")::text AS deliv
    FROM "DmSkuSeason" s JOIN "DmSku" k ON k."id" = s."skuId"
    WHERE k."organizationId" = ${orgId} GROUP BY s."season", k."cls"`;
  if (!rows.length) return null;
  return (["FW25/26", "SS26", "FW26/27"] as const).map((s) => {
    const t: ReportSeasonTotalMart = { label: LABEL[s], conf: 0, deliv: 0, clothes: { conf: 0, deliv: 0 }, acc: { conf: 0, deliv: 0 } };
    for (const r of rows) {
      if (r.season !== s) continue;
      const conf = Number(r.conf), deliv = Number(r.deliv);
      t.conf += conf; t.deliv += deliv;
      const g = r.cls === "acc" ? t.acc : t.clothes; g.conf += conf; g.deliv += deliv;
    }
    return t;
  }).filter((t) => t.conf || t.deliv);
}
