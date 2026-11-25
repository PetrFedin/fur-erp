// Показатели сезона по строкам отчёта (mOf из SeasonReport, вынесено без изменений; индексы продаж передаются параметрами).
import type { ReportSizeRow } from "@/lib/margin-tree";
import { MU_EUR_RATE } from "@/lib/mu-rate";
import { SEASONS, zero, type Agg, type LAgg, type M, type Season } from "./metrics";

export function seasonMetrics(rs: ReportSizeRow[], { ex, oldKey, lineIdx, keyW, crossIdx }: {
  ex: boolean;
  oldKey: (r: ReportSizeRow) => string;
  lineIdx: Map<string, LAgg>;
  keyW: Map<string, { n: number; d: Record<Season, number> }>;
  crossIdx: Map<string, Map<Season, Map<Season, Agg>>>;
}) {
  const out = Object.fromEntries(SEASONS.map((s) => [s, zero()])) as Record<Season, M>;
  const artSet = Object.fromEntries(SEASONS.map((x) => [x, new Set<string>()])) as Record<Season, Set<string>>;
  type OldAgg = { n: number; rubIn: number; rubEx: number; disc: number; g: number; sc: number };
  const oldBy = new Map<string, Record<Season, OldAgg>>();
  const cal = Object.fromEntries(SEASONS.map((x) => [x, { n: 0, rIn: 0, rEx: 0, d: 0, g: 0, c: 0 }])) as Record<Season, { n: number; rIn: number; rEx: number; d: number; g: number; c: number }>;
  const grp = new Map<string, { n: number; d: Record<Season, number>; rep: Record<Season, { deliv: number; ssn: number; all: number }> }>();
  for (const r of rs) {
    const k = oldKey(r);
    { const z = (): OldAgg => ({ n: 0, rubIn: 0, rubEx: 0, disc: 0, g: 0, sc: 0 }); const acc = oldBy.get(k) ?? oldBy.set(k, { "FW26/27": z(), SS26: z(), "FW25/26": z() }).get(k)!; for (const s of SEASONS) { const c = r.seas?.[s]; if (!c) continue; acc[s].n += Math.max(0, c.soldOld ?? 0); acc[s].rubIn += c.rubOld ?? 0; acc[s].rubEx += c.rubExOld ?? 0; acc[s].disc += c.discOld ?? 0; acc[s].g += ((c.rubOld ?? 0) + (c.discOld ?? 0)) / MU_EUR_RATE; acc[s].sc += c.scOld ?? 0; } }
    const g = grp.get(k) ?? grp.set(k, { n: 0, d: { "FW26/27": 0, SS26: 0, "FW25/26": 0 }, rep: Object.fromEntries(SEASONS.map((x) => [x, { deliv: 0, ssn: 0, all: 0 }])) as Record<Season, { deliv: number; ssn: number; all: number }> }).get(k)!;
    g.n++;
    for (const s of SEASONS) {
      const c = r.seas?.[s]; if (!c) continue;
      const m = out[s], closed = s !== "FW26/27";
      m.conf += closed ? c.conf ?? c.deliv ?? 0 : c.conf ?? 0;
      m.confEur += closed ? c.confEur ?? c.delivEur ?? 0 : c.confEur ?? 0;
      m.delivEur += c.delivEur ?? 0;
      if ((closed ? c.conf ?? c.deliv ?? 0 : c.conf ?? 0) > 0 || (c.deliv ?? 0) > 0 || (c.soldSsn ?? 0) > 0) artSet[s].add(r.acode);
      const n = c.soldSsn ?? 0, rIn = c.rubSsn ?? 0, rEx = c.rubExSsn ?? 0, dS = c.discSsn ?? 0;
      g.d[s] += Math.max(0, c.deliv ?? 0); g.rep[s].deliv += c.deliv ?? 0; g.rep[s].ssn += n; g.rep[s].all += n;
      // За сезон: товар сезона, проданный в его календаре (SSN отчёта) — выручка, скидка, себестоимость; он же первая часть «всего».
      m.ssnR += n; m.rubS += ex ? rEx : rIn; m.rubSIn += rIn; m.rubSEx += rEx; m.eurSIn += c.eurSsn ?? 0; m.eurSEx += c.eurExSsn ?? 0; m.discS += dS;
      m.allR += n; m.rubA += ex ? rEx : rIn; m.rubAIn += rIn; m.discA += dS;
      // Маркап продаж (правило владельца 09.11.2026): (выручка ₽ + скидка ₽) ÷ курс 110 ÷ SC EUR — полная розничная цена продажи с учётом скидки к себестоимости продаж в €.
      { const gE = ((c.rubSsn ?? 0) + (c.discSsn ?? 0)) / MU_EUR_RATE, scE = c.scSsn ?? 0; m.grossS += gE; m.costS += scE; m.grossA += gE; m.costA += scE; }
      // Олды: товар прошлых сезонов, проданный в календаре этого сезона (Old отчёта).
      const nO = Math.max(0, c.soldOld ?? 0), rInO = c.rubOld ?? 0;
      cal[s].n += nO; cal[s].rIn += rInO; cal[s].rEx += c.rubExOld ?? 0; cal[s].d += c.discOld ?? 0;
      cal[s].g += ((c.rubOld ?? 0) + (c.discOld ?? 0)) / MU_EUR_RATE; cal[s].c += c.scOld ?? 0;
    }
  }
  // Штуки (получено, продано за сезон, продано всего) — из файла поступлений и продаж, как в «Обзоре»; на уровне размера делим по поступлению строк отчёта. Нет артикула в файле — берём отчёт.
  for (const [k, g] of grp) {
    const L = lineIdx.get(k), W = keyW.get(k);
    for (const s of SEASONS) {
      // Получено — по отчёту (товар сезона за всё время: FW25 269 + SS26 64 + FW26 304); строки файла поступлений дают только даты и остаток по месяцам.
      void L; void W;
      out[s].deliv += g.rep[s].deliv; out[s].ssn += g.rep[s].ssn; out[s].all += g.rep[s].all;
    }
  }
  // Вторая часть «всего»: товар сезона, проданный позже как «не сезон». Штуки и деньги периода берём из отчёта (итог сходится с отчётом до рубля),
  // строки продаж только делят их по сезонам товара (по долям штук). Маркап считаем по строкам продаж.
  for (const [k, R] of oldBy) for (const per of SEASONS) {
    const need = R[per].n; if (need <= 0) continue;
    const O = crossIdx.get(k)?.get(per); if (!O) continue;
    const tot = [...O.values()].reduce((x, y) => x + y.pcs, 0); if (tot <= 0) continue;
    const f = tot <= need ? 1 : need / tot;
    for (const [g, a] of O) {
      const share = a.pcs / tot, o = out[g];
      o.allR += need * share;
      if (per === "SS26") o.lSS26 += need * share; else if (per === "FW26/27") o.lFW26 += need * share;
      o.rubL += (ex ? R[per].rubEx : R[per].rubIn) * share;
      o.rubLIn += R[per].rubIn * share; o.discL += R[per].disc * share; o.grossL += R[per].g * share; o.costL += R[per].sc * share;
      o.rubA += (ex ? R[per].rubEx : R[per].rubIn) * share; o.rubAIn += R[per].rubIn * share; o.discA += R[per].disc * share;
      o.grossA += a.grossC * f; o.costA += a.costS * f;
    }
  }
  // «За сезон» — товар сезона в его календаре (SSN отчёта); «Всего» — весь календарь сезона: SSN + олды (Old). Штуки и деньги — из отчёта, как у владельца:
  // FW25 94, SS26 13 + 41 = 54, FW26 60 + 51 = 111, вместе 259. Товар сезона, проданный за всё время (в свой сезон и позже), нужен для SO сейчас и остатка (allG).
  for (const s of SEASONS) {
    const o = out[s], c = cal[s];
    o.allG = o.allR; o.ssn = o.ssnR; o.rubG = o.rubS + o.rubL;
    o.all = o.ssnR + c.n; o.allR = o.all;
    o.rubA = o.rubS + (ex ? c.rEx : c.rIn); o.rubAIn = o.rubSIn + c.rIn; o.discA = o.discS + c.d;
    o.grossA = o.grossS + c.g; o.costA = o.costS + c.c;
  }
  for (const s of SEASONS) { out[s].arts = artSet[s].size; if (s !== "FW26/27") out[s].conf = out[s].deliv; out[s].stock = out[s].deliv - out[s].allG; }
  return out;
}
