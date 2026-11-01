import "server-only";
import { prisma } from "@/lib/prisma";
import { hidesToGo, loadRawForecast } from "@/lib/raw-forecast";
import { listForecasts } from "@/lib/forecast-store";
import { loadOrderRows } from "@/lib/analytics-orders";
import { loadFurLots } from "@/lib/fur-table-server";

/** Сырьё по типам меха: сколько шкур на складе и сколько уйдёт на допроизводство заказанного (остаток заказа FW26 по прогнозу). Имена типов — как в Budget PCS. */
/** Доля норки в изделиях «Норка + Соболь» по фактическому расходу шкур в ТЗ: одежда и аксессуары отдельно (остальное — соболь). */
export type MixShare = { RTW: number; Acc: number };
export type RawBalance = { fur: string; stock: number; need: number }[];
const NAME: Record<string, string> = { "Свакара": "Каракульча" };
const num = (s: string | undefined, d: number | null) => { const v = parseFloat(String(s ?? "").replace(",", ".").replace(/\s/g, "")); return Number.isFinite(v) ? v : d; };

export async function loadRawBalance(orgId: string): Promise<{ rows: RawBalance; forecast: string | null; mix: MixShare; price: Record<string, number> }> {
  const [raw, docs, orders, lots] = await Promise.all([loadRawForecast(orgId), listForecasts(orgId), loadOrderRows(orgId, "all", "off"), loadFurLots(prisma, orgId, { kind: "fur", year: "all" })]);
  // Средневзвешенная цена шкуры по типу меха (₽ с НДС, без роста): Σ ₽ списанных в ТЗ шкур ÷ Σ шкур — по лотам («потрачено»), как в Excel (лист 8 = лист 1).
  // Нет списаний (рысь) — средняя цена закупки по лотам. Цены бюджета FW27 не берём: в них уже заложен рост (+10 %), иначе рост считался бы дважды.
  const acc = new Map<string, [number, number, number, number]>();
  for (const l of lots) {
    if (l.purchaseStatus === "CANCELLED") continue;
    const f = NAME[l.item] ?? l.item, a = acc.get(f) ?? [0, 0, 0, 0];
    // Закупка-черновик (рысь FH: заказано, не получено) — только для средней цены закупки, списаний по ней нет.
    if (l.purchaseStatus !== "DRAFT") { a[0] += l.usedIncl; a[1] += l.used; }
    a[2] += l.recvIncl; a[3] += l.recv; acc.set(f, a);
  }
  const price: Record<string, number> = {};
  for (const [f, [usedRub, used, recvRub, recv]] of acc) { if (used > 0) price[f] = usedRub / used; else if (recv > 0) price[f] = recvRub / recv; }
  // Меха без лотов на складе (рысь: только «Заказано, не получено» на Главной) — средняя цена заказанного, как на листе лотов Excel.
  const { loadDashboard } = await import("@/lib/dashboard-data");
  const { parseDashFilters } = await import("@/lib/dashboard-calc");
  for (const s of (await loadDashboard(orgId, "all", parseDashFilters({}), "off")).syntheticLots) {
    const f = NAME[s.item] ?? s.item;
    if (price[f] || s.id.startsWith("hides:") || !(s.recv > 0)) continue;
    const a = acc.get(`synth:${f}`) ?? [0, 0, 0, 0]; a[2] += s.recvIncl; a[3] += s.recv; acc.set(`synth:${f}`, a);
  }
  for (const [k, a] of acc) if (k.startsWith("synth:") && a[3] > 0) price[k.slice(6)] = a[2] / a[3];
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
    if (off.has(l.acode)) continue;
    const hp = num(doc?.edits[l.acode]?.hp, l.hp);
    if (hp == null || !(hp > 0)) continue;
    if (l.fur.includes(" + ")) {
      // Смесь «Норка + Соболь»: потребность делим на норку и соболя по реальной пропорции ТЗ (одежда и аксессуары отдельно) — как в таблице бюджета.
      const mink = share(l.cls === "acc" ? use.Acc : use.RTW), total = hidesToGo(l, hp);
      need.set("Норка", (need.get("Норка") ?? 0) + total * mink);
      need.set("Соболь", (need.get("Соболь") ?? 0) + total * (1 - mink));
      continue;
    }
    const f = NAME[l.fur] ?? l.fur;
    need.set(f, (need.get(f) ?? 0) + hidesToGo(l, hp));
  }
  const stock = new Map<string, number>();
  for (const s of raw.stock) { const f = NAME[s.fur] ?? s.fur; stock.set(f, (stock.get(f) ?? 0) + s.stock); }
  const furs = [...new Set([...stock.keys(), ...need.keys()])];
  return { rows: furs.map((fur) => ({ fur, stock: stock.get(fur) ?? 0, need: need.get(fur) ?? 0 })), forecast: doc?.name ?? null, mix: { RTW: share(use.RTW), Acc: share(use.Acc) }, price };
}
