// Сезон ТЗ для переключателя «Сезон» на Главной (Производство). У ТЗ в базе своего сезона нет, поэтому ТЗ относится к сезонам так же,
// как в Excel «Производство и приход»: по приходу модели в магазин (приход по дате: SS — февраль–июль, FW — август–январь). Если приход
// модели шёл в нескольких сезонах, ТЗ делится между ними пропорционально приходу (доли в сумме 1). Нет прихода модели — сезон по дате ТЗ
// (окончание → заказ-наряд → начало), нет и даты — по году ТЗ (2025 → FW 25/26). Чистые функции, без базы.
import { modelCodeOfArticle, normCode, seasonOfDate } from "@/lib/sales-receipts-core";

export type SeasonShares = Record<string, number>;

/** Приход по модели и сезону (штуки нетто, только сезоны с положительным приходом → доли, сумма 1). */
export function modelSeasonShares(receipts: { article: string; iso: string; pcs: number; kind?: string }[]): Map<string, SeasonShares> {
  const raw = new Map<string, Record<string, number>>();
  for (const r of receipts) {
    if (r.kind !== undefined && r.kind !== "RECEIPT") continue;
    const code = modelCodeOfArticle(r.article);
    if (!code) continue;
    const s = seasonOfDate(r.iso), cur = raw.get(code) ?? {};
    cur[s] = (cur[s] ?? 0) + r.pcs;
    raw.set(code, cur);
  }
  const out = new Map<string, SeasonShares>();
  for (const [code, by] of raw) {
    const pos = Object.entries(by).filter(([, v]) => v > 0);
    const t = pos.reduce((a, [, v]) => a + v, 0);
    if (t > 0) out.set(code, Object.fromEntries(pos.map(([k, v]) => [k, v / t])));
  }
  return out;
}

/** Доли сезонов для ТЗ: model — код модели (артикул ТЗ), date — ISO даты ТЗ (может не быть), year — год ТЗ. */
export function orderSeasonShares(o: { model: string; date: string | null; year: number | null }, byModel: Map<string, SeasonShares>): SeasonShares {
  const m = byModel.get(normCode(o.model));
  if (m) return m;
  if (o.date) return { [seasonOfDate(o.date)]: 1 };
  return { [o.year != null && o.year >= 2026 ? "SS 2026" : "FW 25/26"]: 1 };
}
