// Оставшиеся изделия FW26 (заказано − поступило) по ТЗ: какие шкуры на них идут и сколько ещё возьмём со склада.
// Правило владельца (02.11.2026, вечер): если по изделию есть ТЗ со списанием — расход ровно как в ТЗ (фактически списанные шкуры, по меху),
// со склада второй раз не берём; ТЗ без списания и изделия без ТЗ — по норме (штук × шкур на изделие), их и возьмём со склада.
// Одна функция для приложения (raw-balance → Budget PCS, «План 2027») и Excel (export-raw-budget-data → листы 3–4).
import type { OrderRow } from "@/lib/analytics-orders";

export type RemLine = { acode: string; fur: string; cls: string; cat2: string; hp: number | null; produced?: number; inWork?: number; notStarted?: number; left: number; source?: string; sourceNote?: string };
export type RemRow = {
  acode: string; model: string; fur: string; cls: string; cat2: string;
  tz: string; status: string; color: string; size: string; batch: string;
  qty: number; hp: number | null;
  /** Шкуры по мехам, уже списанные по ТЗ на эту часть (точный расход). Пусто — списаний нет. */
  actual: Record<string, number>;
  /** По норме (штук × шкур на изделие) — для частей без списания. */
  norm: number;
  hpSource: string;
};

const CYR: Record<string, string> = { А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y" };
const code = (c: string) => c.split(/[ /+]/)[0].replace(/[-\s]/g, "").toUpperCase().replace(/[АВЕКМНОРСТХУ]/g, (ch) => CYR[ch] ?? ch);
const FUR_OF_RAW: [RegExp, string][] = [[/SABLE|СОБОЛ/i, "Соболь"], [/MINK|НОРК/i, "Норка"], [/LYNX|РЫС/i, "Рысь"], [/FOX|ЛИС/i, "Лиса"], [/KARAKUL|SWAKARA|КАРАКУЛ|СВАКАР/i, "Свакара"]];
const furOfRaw = (s: string) => FUR_OF_RAW.find(([re]) => re.test(s))?.[1] ?? null;
const tzNum = (r: Pick<OrderRow, "workOrderNumber" | "number">) => parseFloat((r.workOrderNumber ?? "").replace(/[^\d.]/g, "")) || 0;

/**
 * Раскладка оставшихся изделий по ТЗ модели: «ТЗ завершено, не получено» → завершённые ТЗ, «в работе» → ТЗ в работе/запланированные
 * (полученное считаем пришедшим из более ранних ТЗ, поэтому остаток кладём на ТЗ с большим номером), без ТЗ — «ТЗ ещё нет».
 */
export function remainingByTz(lines: RemLine[], orderRows: OrderRow[], label: (r: OrderRow) => string): RemRow[] {
  const out: RemRow[] = [];
  const own = orderRows.filter((r) => r.category !== "Ремонт");
  for (const l of lines) {
    const model = l.acode.split("/")[0];
    const rs = own.filter((r) => code(r.modelName) === code(model)).sort((a, b) => tzNum(b) - tzNum(a) || b.number.localeCompare(a.number));
    const hpSource = (l.source ?? "") + (l.sourceNote ? ` · ${l.sourceNote}` : "");
    const base = { acode: l.acode, model, fur: l.fur, cls: l.cls, cat2: l.cat2, hp: l.hp, hpSource };
    const take = (group: "done" | "work", need: number, kind: string) => {
      for (const r of rs.filter((x) => x.group === group)) {
        if (need <= 1e-9) break;
        const q = Math.min(need, r.qty); need -= q;
        const k = r.qty > 0 ? q / r.qty : 0;
        const actual: Record<string, number> = {};
        for (const ln of r.lines ?? []) { if (ln.isLining) continue; const f = furOfRaw(ln.rawName) ?? r.fur; actual[f] = (actual[f] ?? 0) + ln.qty * k; }
        out.push({ ...base, tz: label(r), status: kind, color: r.color, size: r.size || "—", batch: r.batchText ?? "Без партии", qty: q, actual, norm: (l.hp ?? 0) * q });
      }
      if (need > 1e-6) out.push({ ...base, tz: "ТЗ не найдено", status: kind, color: "—", size: "—", batch: "—", qty: need, actual: {}, norm: (l.hp ?? 0) * need });
    };
    take("done", l.produced ?? 0, "ТЗ завершено, не получено");
    take("work", l.inWork ?? 0, "ТЗ в работе / запланировано");
    const ns = l.notStarted ?? (l.produced == null && l.inWork == null ? l.left : 0);
    if (ns > 1e-9) out.push({ ...base, tz: "ТЗ ещё нет", status: "ТЗ ещё нет", color: "—", size: "—", batch: "—", qty: ns, actual: {}, norm: (l.hp ?? 0) * ns });
  }
  return out;
}

/** Сумма списанных шкур строки (все меха). */
export const actualTotal = (r: Pick<RemRow, "actual">) => Object.values(r.actual).reduce((a, b) => a + b, 0);
