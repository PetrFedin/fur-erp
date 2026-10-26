import "server-only";
import { loadRawForecast } from "@/lib/raw-forecast";
import { listForecasts } from "@/lib/forecast-store";
import { loadOrderRows } from "@/lib/analytics-orders";
import { loadBudgetStats } from "@/lib/budget-stats";
import { BUDGET_CAT_GROUPS } from "@/lib/budget-calc";

/** Сырьё по типам меха: сколько шкур на складе и сколько уйдёт на допроизводство заказанного (остаток заказа FW26 по прогнозу). Имена типов — как в Budget PCS. */
/** Доля норки в изделиях «Норка + Соболь» по фактическому расходу шкур в ТЗ: одежда и аксессуары отдельно (остальное — соболь). */
export type MixShare = { RTW: number; Acc: number };
export type RawBalance = { fur: string; stock: number; need: number }[];
const NAME: Record<string, string> = { "Свакара": "Каракульча" };
const num = (s: string | undefined, d: number | null) => { const v = parseFloat(String(s ?? "").replace(",", ".").replace(/\s/g, "")); return Number.isFinite(v) ? v : d; };

export async function loadRawBalance(orgId: string): Promise<{ rows: RawBalance; forecast: string | null; mix: MixShare; price: Record<string, number> }> {
  const [raw, docs, orders, stats] = await Promise.all([loadRawForecast(orgId), listForecasts(orgId), loadOrderRows(orgId, "all", "off"), loadBudgetStats(orgId)]);
  // Средневзвешенная цена шкуры по типу меха (₽ с НДС): Σ(шкуры × цена) ÷ Σ шкуры по ТЗ; сводные категории («Шубы») не берём — они дублируют входящие в них.
  const acc = new Map<string, [number, number]>();
  const groups = new Set(Object.keys(BUDGET_CAT_GROUPS));
  for (const st of stats) {
    if (st.len || st.modelId || groups.has(st.cat) || st.fur.includes(" + ") || !(st.hidePrice > 0)) continue;
    const f = NAME[st.fur] ?? st.fur, h = st.qty * st.hidesPer, a = acc.get(f) ?? [0, 0];
    a[0] += h * st.hidePrice; a[1] += h; acc.set(f, a);
  }
  const price: Record<string, number> = {};
  for (const [f, [sum, h]] of acc) if (h > 0) price[f] = sum / h;
  // Как реально делим мех в изделиях «Норка + Соболь»: шкуры норки и соболя по строкам ТЗ.
  const use = { RTW: [0, 0], Acc: [0, 0] };
  for (const o of orders) {
    if (o.fur !== "Норка + Соболь" || o.category === "Ремонт") continue;
    const b = o.categoryGroup === "Аксессуары" ? use.Acc : use.RTW;
    for (const l of o.lines) { if (l.isLining) continue; if (/SABLE|СОБОЛ/i.test(l.rawName)) b[1] += l.qty; else if (/MINK|НОРК/i.test(l.rawName)) b[0] += l.qty; }
  }
  const share = (b: number[]) => (b[0] + b[1] > 0 ? b[0] / (b[0] + b[1]) : 0.5);
  const doc = docs[0];
  const off = new Set(doc?.off ?? []);
  const need = new Map<string, number>();
  for (const l of raw.lines) {
    if (off.has(l.acode) || l.fur.includes(" + ")) continue;
    const hp = num(doc?.edits[l.acode]?.hp, l.hp);
    if (hp == null || !(hp > 0)) continue;
    const f = NAME[l.fur] ?? l.fur;
    need.set(f, (need.get(f) ?? 0) + l.left * hp);
  }
  const stock = new Map<string, number>();
  for (const s of raw.stock) { const f = NAME[s.fur] ?? s.fur; stock.set(f, (stock.get(f) ?? 0) + s.stock); }
  const furs = [...new Set([...stock.keys(), ...need.keys()])];
  return { rows: furs.map((fur) => ({ fur, stock: stock.get(fur) ?? 0, need: need.get(fur) ?? 0 })), forecast: doc?.name ?? null, mix: { RTW: share(use.RTW), Acc: share(use.Acc) }, price };
}
