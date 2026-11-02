// План производства 2027 по месяцам: сколько изделий шьём, приход и расход сырья, остаток на складе (январь — ноябрь).
// Чистые функции (без базы и React) — один расчёт для отчёта «План производства 2027» и Excel «Сырьё и бюджет FW27» (лист 8).
//
// Правила (владелец 02.11.2026):
//  • сырьё из остатка 2026 — только своё годное каждого блока (одежда / аксессуары), как в расчёте закупки (fw26-supply);
//  • купленное идёт в работу не раньше чем через LEAD месяцев после прихода на склад (по умолчанию 2: приход, выделка, раскрой);
//  • одежда — по целевой загрузке мощности (50 % с января, июль ≈28 %, август–октябрь 80 %, ноябрь 100 %); если сырья нет — сколько позволяет остаток;
//  • аксессуары — ровно по месяцам; рысь — сентябрь–ноябрь;
//  • правка любого месяца (производство или приход) — следующие месяцы пропорционально подстраиваются, итог всегда = план (или 100 % закупки).
import { ttlOf, type PcsRow, type PcsBlock, type PcsParams } from "@/lib/budget-pcs";
import { minkShareOf, type SupplyFurRow } from "@/lib/fw27-supply";

export const PLAN_MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя"] as const;
export const NM = PLAN_MONTHS.length;
/** Месяцы прихода: ноябрь и декабрь 2026 + январь–ноябрь 2027 (индекс 0 = ноябрь 2026). */
export const INTAKE_MONTHS = ["Ноя 26", "Дек 26", ...PLAN_MONTHS] as const;
export const NI = INTAKE_MONTHS.length;
export const RAW_FURS = ["Соболь", "Норка", "Каракульча", "Лиса", "Рысь"] as const;
export const PLAN_FURS = ["Соболь", "Норка", "Норка+Соболь", "Каракульча", "Лиса", "Рысь"] as const;

/** Приход купленного на склад по месяцам (доли), как в 2025–2026 по датам прихода лотов: весенние аукционы — летом. Индексы — INTAKE_MONTHS. */
export const SUMMER_INTAKE: Record<string, Partial<Record<number, number>>> = {
  // соболь: РП/СП весна → июнь–июль, СП осень → сентябрь, СП декабрь → ноябрь
  Соболь: { 7: 0.40, 8: 0.40, 10: 0.17, 12: 0.03 },
  // норка: SAGA март → июль–август, AME май → сентябрь
  Норка: { 8: 0.45, 9: 0.50, 10: 0.05 },
  // каракульча: SAGA март/июнь → июль–август, прочее → октябрь
  Каракульча: { 8: 0.40, 9: 0.45, 11: 0.15 },
  // лиса: SAGA март → июль–август
  Лиса: { 8: 0.65, 9: 0.35 },
  // рысь: FH июнь → октябрь
  Рысь: { 11: 1.0 },
};
// Целевая загрузка одежды (владелец 02.11): с января 50 %, июль ≈28 % (отпуска), август–октябрь 80 %, к ноябрю 100 % — как аксессуары.
export const TARGET_LOAD_DEFAULT = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.28, 0.8, 0.8, 0.8, 1.0];
export const LEAD_DEFAULT = 2;
export const LYNX_FROM = 8; // сентябрь

/** Сохранённые правки плана (SystemState production-plan:fw27). */
export type PlanState = {
  lead?: number; capRtw?: number | null; capAcc?: number | null; targetLoad?: number[];
  /** Своя доля прихода по месяцам, % (пусто — авто): ключ — вид сырья, индекс — INTAKE_MONTHS. */
  intake?: Record<string, (number | null)[]>;
  /** Свои штуки по месяцам: ключ «мех|блок» (RTW/Acc), индекс — PLAN_MONTHS. */
  prod?: Record<string, (number | null)[]>;
  /** Не докупать зимой автоматически (приход только как задан). */
  noWinter?: boolean;
  updatedAt?: string; updatedBy?: string | null;
};

export type PlanRow = { key: string; fur: string; block: PcsBlock; pcs: number; per: Record<string, number> };

/** Строки плана: тип меха × блок, штуки и шкур на изделие по видам сырья (норка/соболь из «Норка+Соболь» — по доле норки строки). */
export function planRows(rows: PcsRow[], p: PcsParams, mix: { RTW: number; Acc: number }): PlanRow[] {
  const out: PlanRow[] = [];
  for (const fur of PLAN_FURS) for (const block of ["RTW", "Acc"] as PcsBlock[]) {
    const rs = rows.filter((r) => r.fur === fur && r.block === block && r.pcs > 0);
    const pcs = rs.reduce((a, r) => a + r.pcs, 0);
    if (!pcs) continue;
    const per: Record<string, number> = {};
    for (const r of rs) {
      const t = ttlOf(r) ?? 0;
      if (fur === "Норка+Соболь") { const s = minkShareOf(r, p, mix); per["Норка"] = (per["Норка"] ?? 0) + t * s; per["Соболь"] = (per["Соболь"] ?? 0) + t * (1 - s); }
      else per[fur] = (per[fur] ?? 0) + t;
    }
    for (const k of Object.keys(per)) per[k] /= pcs;
    out.push({ key: `${fur}|${block}`, fur, block, pcs, per });
  }
  return out;
}

/** Целые по весам, сумма = total (наибольшие остатки). */
export function spreadInt(total: number, w: number[]): number[] {
  const s = w.reduce((a, b) => a + b, 0);
  if (total <= 0 || s <= 0) return w.map(() => 0);
  const raw = w.map((x) => (total * x) / s), out = raw.map(Math.floor);
  const order = raw.map((x, i) => [x - out[i], i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < total - out.reduce((a, b) => a + b, 0); k++) out[order[k][1]]++;
  return out;
}

/**
 * Правка «следующие пропорционально»: base — авто-значения по месяцам, manual — свои (null — авто), total — итог.
 * Идём слева направо: свой месяц — как задан; авто-месяц получает остаток × (его вес ÷ сумма весов оставшихся месяцев); последний авто — весь остаток.
 * Месяцы до правки не меняются. Если последний месяц задан вручную, итог может не сойтись — это видно в «Сверке».
 */
export function followProportional(base: number[], manual: (number | null | undefined)[], total: number): number[] {
  const out: number[] = []; let done = 0;
  for (let m = 0; m < base.length; m++) {
    const mv = manual[m];
    if (mv != null && Number.isFinite(mv)) { out.push(mv); done += mv; continue; }
    const restW = base.slice(m).reduce((a, b) => a + b, 0), rem = Math.max(0, total - done);
    const isLastAuto = base.slice(m + 1).every((_, k) => manual[m + 1 + k] != null) ;
    const v = isLastAuto ? rem : restW > 0 ? (rem * base[m]) / restW : 0;
    out.push(v); done += v;
  }
  return out;
}
/** То же для штук: целые, сумма сохраняется (кумулятивное округление). */
export function followProportionalInt(base: number[], manual: (number | null | undefined)[], total: number): number[] {
  const f = followProportional(base, manual, total); const out: number[] = []; let cum = 0, prev = 0;
  for (let m = 0; m < f.length; m++) { if (manual[m] != null) { out.push(Math.round(f[m])); prev += Math.round(f[m]); cum += f[m]; continue; } cum += f[m]; const r = Math.round(cum); out.push(r - prev); prev = r; }
  return out;
}

export type PlanInput = {
  prows: PlanRow[];
  /** Годное из остатка 2026, которое использует блок (как в расчёте закупки): вид сырья → блок → шкур. */
  lpool: Record<string, Record<PcsBlock, number>>;
  /** Закупка 2027 по видам сырья, шк. (с запасом). */
  buy: Record<string, number>;
  state: PlanState;
};

export type PlanResult = {
  lead: number; capRtw: number; capAcc: number; targetLoad: number[]; targetRtw: number[];
  intakeBase: Record<string, number[]>; intake: Record<string, number[]>; winter: Record<string, { idx: number; share: number; qty: number }[]>;
  auto: Record<string, number[]>; prod: Record<string, number[]>;
  rtw: number[]; acc: number[]; rtwCum: number[];
  raw: Record<string, { start: number[]; inc: number[]; use: number[]; end: number[]; notReady: number[]; ok: boolean }>;
  shortTarget: Record<string, number[]>; shortPlan: Record<string, number[]>;
};

/** Помесячная раскладка при заданном приходе: сырьё блока из остатка, потом купленное (с месяца приход + lead). */
function schedule(inp: PlanInput, intake: Record<string, number[]>, lead: number, rtwTarget: (number | null)[]) {
  const { prows } = inp;
  const lp: Record<string, number> = {}; for (const f of RAW_FURS) for (const b of ["RTW", "Acc"] as PcsBlock[]) lp[`${f}|${b}`] = inp.lpool[f]?.[b] ?? 0;
  const bp: Record<string, number> = Object.fromEntries(RAW_FURS.map((f) => [f, 0]));
  const left = prows.map((r) => r.pcs), out = prows.map(() => Array(NM).fill(0) as number[]);
  const can = (i: number) => Object.entries(prows[i].per).every(([fu, p]) => (lp[`${fu}|${prows[i].block}`] ?? 0) + bp[fu] >= p - 1e-9);
  const take = (i: number) => { for (const [fu, p] of Object.entries(prows[i].per)) { const k = `${fu}|${prows[i].block}`; const a = Math.min(p, lp[k] ?? 0); lp[k] = (lp[k] ?? 0) - a; bp[fu] -= p - a; } left[i]--; };
  for (let m = 0; m < NM; m++) {
    for (const fu of RAW_FURS) for (let j = 0; j < NI; j++) { const usable = j - 2 + lead; if (usable === m || (m === 0 && usable < 0)) bp[fu] += (inp.buy[fu] ?? 0) * (intake[fu]?.[j] ?? 0); }
    for (const blk of ["RTW", "Acc"] as PcsBlock[]) {
      const idx = prows.map((r, i) => i).filter((i) => prows[i].block === blk && !(prows[i].fur === "Рысь" && m < LYNX_FROM));
      const remAll = prows.reduce((a, r, i) => a + (r.block === blk ? left[i] : 0), 0);
      const t = blk === "RTW" && rtwTarget[m] != null ? (rtwTarget[m] as number) : Math.ceil(remAll / (NM - m));
      const lim = new Map(idx.map((i) => [i, prows[i].fur === "Рысь" ? Math.ceil(left[i] / (NM - m)) : 1e9]));
      const got = new Map<number, number>();
      for (let q = 0; q < t; q++) {
        const cand = idx.filter((i) => left[i] > 0 && (got.get(i) ?? 0) < (lim.get(i) ?? 0) && can(i));
        if (!cand.length) break;
        const i = cand.reduce((a, b) => (left[b] / prows[b].pcs > left[a] / prows[a].pcs ? b : a));
        take(i); out[i][m]++; got.set(i, (got.get(i) ?? 0) + 1);
      }
    }
  }
  return { out, left };
}

/** Сырьё по месяцам (по меху целиком): остаток на начало, приход, расход, остаток на конец, ещё не готово к шитью (пришло меньше lead мес. назад). */
function rawTable(inp: PlanInput, prod: Record<string, number[]>, intake: Record<string, number[]>, lead: number): PlanResult["raw"] {
  const { prows } = inp;
  const raw: PlanResult["raw"] = {};
  for (const f of RAW_FURS) {
    const startAll = (inp.lpool[f]?.RTW ?? 0) + (inp.lpool[f]?.Acc ?? 0);
    const inc = Array.from({ length: NM }, (_, m) => (inp.buy[f] ?? 0) * (intake[f][m + 2] ?? 0));
    const pre = (inp.buy[f] ?? 0) * ((intake[f][0] ?? 0) + (intake[f][1] ?? 0)); // пришло в ноябре–декабре 2026
    const use = Array.from({ length: NM }, (_, m) => prows.reduce((s, r) => s + (prod[r.key]?.[m] ?? 0) * (r.per[f] ?? 0), 0));
    const start: number[] = [], end: number[] = [], notReady: number[] = [];
    let cur = startAll + pre;
    for (let m = 0; m < NM; m++) {
      start.push(cur); cur = cur + inc[m] - use[m]; end.push(cur);
      let nr = 0; for (let j = 0; j < NI; j++) { const arr = j - 2, usable = arr + lead; if (arr <= m && usable > m) nr += (inp.buy[f] ?? 0) * (intake[f][j] ?? 0); }
      notReady.push(nr);
    }
    raw[f] = { start, inc, use, end, notReady, ok: end.every((e, m) => e - notReady[m] >= -0.5) };
  }
  return raw;
}

/** Нехватка сырья нарастающим итогом, если шить одежду по targetRtw (аксессуары — как в plan). */
function shortage(inp: PlanInput, intake: Record<string, number[]>, lead: number, targetRtw: number[], accPlan: number[][]) {
  const { prows } = inp;
  const need: Record<string, number[]> = Object.fromEntries(RAW_FURS.map((f) => [f, Array(NM).fill(0)]));
  const rem = new Map(prows.map((r, i) => [i, r.block === "RTW" ? r.pcs : 0]));
  const nc: Record<string, number> = Object.fromEntries(RAW_FURS.map((f) => [f, 0]));
  const hc: Record<string, number> = Object.fromEntries(RAW_FURS.map((f) => [f, (inp.lpool[f]?.RTW ?? 0) + (inp.lpool[f]?.Acc ?? 0)]));
  for (let m = 0; m < NM; m++) {
    const pool = [...rem.keys()].filter((i) => (rem.get(i) ?? 0) > 0 && !(prows[i].fur === "Рысь" && m < LYNX_FROM));
    const tot = pool.reduce((a, i) => a + (rem.get(i) ?? 0), 0) || 1;
    const parts = spreadInt(Math.min(targetRtw[m], pool.reduce((a, i) => a + (rem.get(i) ?? 0), 0)), pool.map((i) => (rem.get(i) ?? 0) / tot));
    pool.forEach((i, k) => { rem.set(i, (rem.get(i) ?? 0) - parts[k]); for (const [fu, p] of Object.entries(prows[i].per)) nc[fu] += parts[k] * p; });
    for (const fu of RAW_FURS) {
      for (let j = 0; j < NI; j++) { const usable = j - 2 + lead; if (usable === m || (m === 0 && usable < 0)) hc[fu] += (inp.buy[fu] ?? 0) * (intake[fu]?.[j] ?? 0); }
      prows.forEach((r, i) => { if (r.block === "Acc") nc[fu] += accPlan[i][m] * (r.per[fu] ?? 0); });
      need[fu][m] = Math.max(0, nc[fu] - hc[fu]);
    }
  }
  return need;
}

export function buildPlan(inp: PlanInput): PlanResult {
  const { prows, state } = inp;
  const lead = Math.max(0, Math.min(6, Math.round(state.lead ?? LEAD_DEFAULT)));
  const targetLoad = Array.from({ length: NM }, (_, m) => state.targetLoad?.[m] ?? TARGET_LOAD_DEFAULT[m]);
  const rtwTotal = prows.filter((r) => r.block === "RTW").reduce((a, r) => a + r.pcs, 0);
  // Мощность по умолчанию — такая, чтобы при целевой загрузке ноябрь (остаток до плана) вышел ровно на свою загрузку (100 %).
  const fitCap = () => {
    let best = Math.ceil(rtwTotal / targetLoad.reduce((a, b) => a + b, 0)), gap = Infinity;
    for (let c = Math.max(1, best - 15); c <= best + 15; c++) {
      const nov = rtwTotal - targetLoad.slice(0, -1).reduce((a, x) => a + Math.round(c * x), 0), g = Math.abs(nov - c * targetLoad[NM - 1]);
      if (nov >= 0 && nov <= c && g < gap) { gap = g; best = c; }
    }
    return best;
  };
  const capRtw = state.capRtw && state.capRtw > 0 ? state.capRtw : fitCap();
  const targetRtw = targetLoad.map((x) => Math.round(capRtw * x)); targetRtw[NM - 1] = Math.max(0, rtwTotal - targetRtw.slice(0, -1).reduce((a, b) => a + b, 0));
  const runTarget: (number | null)[] = [...targetRtw.slice(0, -1), null];
  // Приход: лето (как в 2025–2026) + зимняя часть закупки, чтобы шить по целевой загрузке (если не отключено). Свои доли — «следующие пропорционально».
  const summer: Record<string, number[]> = Object.fromEntries(RAW_FURS.map((f) => [f, Array.from({ length: NI }, (_, j) => SUMMER_INTAKE[f]?.[j] ?? 0)]));
  const winter: PlanResult["winter"] = Object.fromEntries(RAW_FURS.map((f) => [f, []]));
  const hasManualIntake = (f: string) => (state.intake?.[f] ?? []).some((v) => v != null);
  let intakeBase = summer;
  if (!state.noWinter) {
    const add: Record<string, Record<number, number>> = Object.fromEntries(RAW_FURS.map((f) => [f, {}]));
    const mk = () => Object.fromEntries(RAW_FURS.map((f) => {
      const w = Object.values(add[f]).reduce((a, b) => a + b, 0);
      return [f, summer[f].map((v, j) => v * (1 - w) + (add[f][j] ?? 0))];
    })) as Record<string, number[]>;
    for (let it = 0; it < 12; it++) {
      const cur = mk();
      const sc = schedule(inp, cur, lead, runTarget);
      const acc = sc.out.map((row, i) => (prows[i].block === "Acc" ? row : row.map(() => 0)));
      const nd = shortage(inp, cur, lead, targetRtw, acc);
      // и фактическая нехватка: не уместилось в план (ушло в ноябрь) или годного к шитью меньше нуля
      const pr: Record<string, number[]> = {}; prows.forEach((r, i) => { const a = sc.out[i].slice(); a[NM - 1] += sc.left[i]; pr[r.key] = a; });
      const rt = rawTable(inp, pr, cur, lead);
      for (const f of RAW_FURS) rt[f].end.forEach((e, m) => { const gap = rt[f].notReady[m] - e; if (gap > nd[f][m]) nd[f][m] = gap; });
      let changed = false;
      for (const f of RAW_FURS) {
        if (hasManualIntake(f) || !(inp.buy[f] > 0)) continue;
        const first = nd[f].findIndex((v) => v >= 0.5);
        if (first < 0) continue;
        const j = Math.max(0, first - lead + 2); // пришло в месяце j (INTAKE_MONTHS) → в работу с месяца first
        add[f][j] = (add[f][j] ?? 0) + Math.ceil(Math.max(...nd[f]) * 1.15) / inp.buy[f];
        changed = true;
      }
      if (!changed) break;
    }
    intakeBase = mk();
    for (const f of RAW_FURS) for (const [j, sh] of Object.entries(add[f])) winter[f].push({ idx: Number(j), share: sh, qty: sh * (inp.buy[f] ?? 0) });
  }
  const intake: Record<string, number[]> = Object.fromEntries(RAW_FURS.map((f) => {
    const man = (state.intake?.[f] ?? []).map((v) => (v == null ? null : v / 100));
    return [f, followProportional(intakeBase[f], man, 1)];
  }));
  // Производство: авто-раскладка по фактическому приходу; свои штуки — «следующие пропорционально».
  const sched = schedule(inp, intake, lead, runTarget);
  const auto: Record<string, number[]> = {}, prod: Record<string, number[]> = {};
  prows.forEach((r, i) => {
    const a = sched.out[i].slice(); a[NM - 1] += sched.left[i]; // не уместилось — в ноябрь (будет видно по сырью)
    auto[r.key] = a;
    prod[r.key] = followProportionalInt(a, state.prod?.[r.key] ?? [], r.pcs);
  });
  const sumBy = (blk: PcsBlock) => Array.from({ length: NM }, (_, m) => prows.reduce((s, r) => s + (r.block === blk ? prod[r.key][m] : 0), 0));
  const rtw = sumBy("RTW"), acc = sumBy("Acc");
  const capAcc = state.capAcc && state.capAcc > 0 ? state.capAcc : Math.max(...acc);
  const rtwCum: number[] = []; rtw.reduce((a, v, m) => { rtwCum[m] = rtwTotal ? (a + v) / rtwTotal : 0; return a + v; }, 0);
  const raw = rawTable(inp, prod, intake, lead);
  const accPlan = prows.map((r) => (r.block === "Acc" ? prod[r.key] : Array(NM).fill(0)));
  const shortTarget = shortage(inp, intake, lead, targetRtw, accPlan);
  const shortPlan = shortage(inp, intake, lead, rtw, accPlan);
  return { lead, capRtw, capAcc, targetLoad, targetRtw, intakeBase, intake, winter, auto, prod, rtw, acc, rtwCum, raw, shortTarget, shortPlan };
}

/** Данные для плана из расчёта закупки: годное, которое использует каждый блок, и закупка по видам сырья. */
export function planInputFromSupply(rows: SupplyFurRow[]) {
  const lpool: Record<string, Record<PcsBlock, number>> = {}, buy: Record<string, number> = {};
  for (const r of rows) { lpool[r.label] = { RTW: r.by.RTW?.used ?? 0, Acc: r.by.Acc?.used ?? 0 }; buy[r.label] = r.buy; }
  return { lpool, buy };
}
