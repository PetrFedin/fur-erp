import { seasonOfDate } from "@/lib/sales-receipts-core";
import { leafKeyOf } from "@/lib/fw26-plan";

/**
 * Сезон товара у продаж строится в приложении «по очереди партий» (assignSeasons), а розничный отчёт («заказ и продажи») относит продажи
 * к товару сезона сам (SSN — свой сезон, Old — прошлые). По отчёту: FW25 — 94, SS26 — 13 + 41 олдов, FW26 — 60 + 51 (всего 259);
 * по очереди партий получалось 94 / 12 / 55. Отчёт — источник истины (решение владельца 06.11.2026), поэтому после очереди партий
 * продажи, которые отчёт считает товаром сезона, переводим в этот сезон: по артикулу+цвету и календарному сезону берём из «олдов»
 * недостающие штуки (последние по дате не трогаем раньше первых — идём по возрастанию даты); строку при необходимости делим пропорционально.
 */
const TO_REPORT: Record<string, string> = { "FW 25/26": "FW25/26", "SS 2026": "SS26", "FW 26/27": "FW26/27" };
const TO_SALES: Record<string, string> = { "FW25/26": "FW 25/26", SS26: "SS 2026", "FW26/27": "FW 26/27" };
const MONEY = ["retailRub", "retailRubExVat", "discountRub", "discountRubExVat", "retailEur", "retailEurExVat", "discountEur", "discountEurExVat"] as const;

type L = { id?: string; kind: string; iso: string; season: string; article: string; colorId: string | null; pcs: number } & Record<(typeof MONEY)[number], number>;
type R = { acode: string; color: string; seas?: Record<string, { soldSsn?: number; rubSsn?: number }> };

export function reconcileSeasonsWithReport<T extends L>(lines: T[], sizes: R[]): T[] {
  if (!sizes.length) return lines;
  // По отчёту: ключ артикул+цвет → сезон → штуки «своего» товара, проданные в календаре этого сезона.
  const own = new Map<string, Record<string, number>>();
  const ownRub = new Map<string, Record<string, number>>();
  for (const r of sizes) {
    const k = leafKeyOf(r.acode, r.color);
    const a = own.get(k) ?? {}; own.set(k, a);
    const b = ownRub.get(k) ?? {}; ownRub.set(k, b);
    for (const [s, c] of Object.entries(r.seas ?? {})) { a[s] = (a[s] ?? 0) + Math.max(0, c?.soldSsn ?? 0); b[s] = (b[s] ?? 0) + (c?.rubSsn ?? 0); }
  }
  const byKey = new Map<string, T[]>();
  lines.forEach((l) => { if (l.kind !== "SALE" || !(l.pcs > 0)) return; const k = leafKeyOf(l.article, l.colorId); (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(l); });
  const replace = new Map<T, T[]>();
  for (const [k, ls] of byKey) {
    const rep = own.get(k); if (!rep) continue;
    for (const [period, want] of Object.entries(rep)) {
      const label = TO_SALES[period];
      const cal = ls.filter((l) => TO_REPORT[seasonOfDate(l.iso)] === period);
      const have = cal.reduce((a, l) => a + (replace.get(l) ?? [l]).filter((x) => x.season === label).reduce((t, x) => t + x.pcs, 0), 0);
      let need = Math.round((want - have) * 1000) / 1000;
      if (need <= 0.0005) continue;
      // Какие именно продажи считать товаром сезона: при равных штуках берём ту подборку, чья розница ближе всего к деньгам отчёта (SSN), иначе — самые ранние.
      const byDate = [...cal].sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
      const target = ownRub.get(k)?.[period];
      const singles = byDate.filter((l) => l.pcs === 1 && !replace.has(l) && l.season !== label);
      const take = Math.round(need);
      let order = byDate;
      if (target !== undefined && have < 0.0005 && Math.abs(need - take) < 0.0005 && take > 0 && singles.length === byDate.length && singles.length > take && singles.length <= 14) {
        let best: number[] | null = null, bestDiff = Infinity;
        const pick = (from: number, chosen: number[]) => {
          if (chosen.length === take) { const diff = Math.abs(chosen.reduce((t, i) => t + singles[i].retailRub, 0) - target); if (diff < bestDiff - 0.5) { bestDiff = diff; best = [...chosen]; } return; }
          for (let i = from; i < singles.length; i++) { chosen.push(i); pick(i + 1, chosen); chosen.pop(); }
        };
        pick(0, []);
        if (best) { const set = new Set<number>(best); order = [...singles.filter((_, i) => set.has(i)), ...singles.filter((_, i) => !set.has(i))]; }
      }
      for (const l of order) {
        if (need <= 0.0005) break;
        const parts = replace.get(l) ?? [l];
        const next: T[] = [];
        for (const p of parts) {
          if (need <= 0.0005 || p.season === label) { next.push(p); continue; }
          const t = Math.min(need, p.pcs);
          if (t >= p.pcs - 1e-9) { next.push({ ...p, season: label }); }
          else {
            const f = t / p.pcs, moved = { ...p, id: p.id ? `${p.id}~r` : p.id, pcs: t, season: label } as T, rest = { ...p, pcs: p.pcs - t } as T;
            for (const m of MONEY) { moved[m] = (p[m] * f) as T[typeof m]; rest[m] = (p[m] * (1 - f)) as T[typeof m]; }
            next.push(moved, rest);
          }
          need -= t;
        }
        replace.set(l, next);
      }
    }
  }
  if (!replace.size) return lines;
  return lines.flatMap((l) => replace.get(l) ?? [l]);
}
