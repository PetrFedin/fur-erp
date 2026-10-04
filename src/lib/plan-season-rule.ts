// Правило присвоения сезона ТЗ по дате: ТЗ без сезона, чья дата попадает в диапазон сезона → этот сезон.
// Это только ПРЕДЛОЖЕНИЕ: страница показывает предпросмотр, применяется после подтверждения.
// Дата ТЗ — та же, что в общем фильтре года: workOrderDate → endDate → startDate (дату партии не берём: она неточная).

export type SeasonRange = { id: string; code: string; startDate: Date | null; endDate: Date | null };
export type RuleOrder = { id: string; seasonId: string | null; workOrderDate: Date | null; endDate: Date | null; startDate: Date | null };

export type RuleVerdict =
  | { orderId: string; kind: "match"; seasonId: string; date: Date }
  | { orderId: string; kind: "nodate" }
  | { orderId: string; kind: "none"; date: Date }
  | { orderId: string; kind: "multi"; date: Date; seasonIds: string[] };

const day = (d: Date) => d.toISOString().slice(0, 10);

export function suggestSeasons(orders: RuleOrder[], seasons: SeasonRange[]): RuleVerdict[] {
  const ranged = seasons.filter((s) => s.startDate && s.endDate);
  const out: RuleVerdict[] = [];
  for (const o of orders) {
    if (o.seasonId) continue;
    const date = o.workOrderDate ?? o.endDate ?? o.startDate;
    if (!date) {
      out.push({ orderId: o.id, kind: "nodate" });
      continue;
    }
    const hit = ranged.filter((s) => day(date) >= day(s.startDate!) && day(date) <= day(s.endDate!));
    if (hit.length === 1) out.push({ orderId: o.id, kind: "match", seasonId: hit[0].id, date });
    else if (hit.length === 0) out.push({ orderId: o.id, kind: "none", date });
    else out.push({ orderId: o.id, kind: "multi", date, seasonIds: hit.map((s) => s.id) });
  }
  return out;
}

/** Подсказки названий сезонов по документам (docs-inventory): ничего не создаётся само, только предлагается. */
export const SEASON_HINTS: ReadonlyArray<{ code: string; source: string }> = [
  { code: "FW26/27", source: "закупка СП 09-26 (документы Drive)" },
  { code: "FW25/26", source: "встречается в сводках по документам Drive (СП 12…)" },
];
