// Список действий производственного календаря. Легко расширять: добавьте строку в CALENDAR_ACTIONS.
// В базе хранится сама подпись действия (CalendarEvent.action — обычная строка), поэтому можно
// и вписать любое своё действие: оно получит нейтральный цвет «Другое».

export type ActionDef = { label: string; chip: string; dot: string };

export const CALENDAR_ACTIONS: readonly ActionDef[] = [
  { label: "Раскрой", chip: "bg-sky-100 text-sky-800 border-sky-200", dot: "bg-sky-500" },
  { label: "Пошив", chip: "bg-violet-100 text-violet-800 border-violet-200", dot: "bg-violet-500" },
  { label: "Примерка", chip: "bg-pink-100 text-pink-800 border-pink-200", dot: "bg-pink-500" },
  { label: "Сдача скорняку", chip: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-500" },
  { label: "Сдача портным", chip: "bg-orange-100 text-orange-800 border-orange-200", dot: "bg-orange-500" },
  { label: "Готово / приёмка", chip: "bg-emerald-100 text-emerald-800 border-emerald-200", dot: "bg-emerald-500" },
  { label: "Отгрузка", chip: "bg-indigo-100 text-indigo-800 border-indigo-200", dot: "bg-indigo-500" },
  { label: "Закупка сырья", chip: "bg-teal-100 text-teal-800 border-teal-200", dot: "bg-teal-500" },
  { label: "Другое", chip: "bg-neutral-100 text-neutral-700 border-neutral-200", dot: "bg-neutral-400" },
];

export const OTHER_ACTION = "Другое";
const FALLBACK = CALENDAR_ACTIONS[CALENDAR_ACTIONS.length - 1];

export function actionDef(label: string | null | undefined): ActionDef {
  const t = (label ?? "").trim().toLowerCase();
  return CALENDAR_ACTIONS.find((a) => a.label.toLowerCase() === t) ?? FALLBACK;
}

/** Стили слоя «факты из ТЗ/отгрузок/примерок» (read-only). */
export const LAYER_STYLES = {
  supply: { label: "План поставок", chip: "bg-white text-neutral-700 border-dashed border-neutral-400", dot: "bg-neutral-400" },
  shipment: { label: "Отгрузка (план)", chip: "bg-white text-indigo-700 border-dashed border-indigo-300", dot: "bg-indigo-300" },
  fitting: { label: "Примерка", chip: "bg-white text-pink-700 border-dashed border-pink-300", dot: "bg-pink-300" },
  raw: { label: "Сырьё Веллмеха", chip: "bg-white text-teal-800 border-dashed border-teal-300", dot: "bg-teal-400" },
  order: { label: "Окончание ТЗ", chip: "bg-white text-emerald-700 border-dashed border-emerald-300", dot: "bg-emerald-300" },
} as const;
export type LayerKind = keyof typeof LAYER_STYLES;

/** Стадии изделий (по ТЗ) для режимов «По месяцам» и «Стадии»; цвета едины во всех режимах календаря. */
export const STAGE_ORDER = ["plan", "raw", "work", "ready", "shipped", "repair"] as const;
export type Stage = (typeof STAGE_ORDER)[number];
export const STAGE_STYLES: Record<Stage, { label: string; short: string; hint: string; chip: string; dot: string; text: string }> = {
  plan: { label: "План", short: "план", hint: "ТЗ запланировано, сырьё в ТЗ ещё не списано", chip: "bg-slate-100 text-slate-700 border-slate-300", dot: "bg-slate-400", text: "text-slate-600" },
  raw: { label: "Сырьё", short: "сырьё", hint: "ТЗ запланировано, мех уже закуплен и списан в ТЗ", chip: "bg-teal-100 text-teal-800 border-teal-200", dot: "bg-teal-500", text: "text-teal-700" },
  work: { label: "В работе", short: "в работе", hint: "ТЗ в работе: раскрой / пошив", chip: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-500", text: "text-amber-700" },
  ready: { label: "Готово", short: "готово", hint: "ТЗ завершено, изделия на складе (ещё не отгружены)", chip: "bg-emerald-100 text-emerald-800 border-emerald-200", dot: "bg-emerald-500", text: "text-emerald-700" },
  shipped: { label: "Отгружено", short: "отгружено", hint: "Отгружено по проведённым отгрузкам", chip: "bg-indigo-100 text-indigo-800 border-indigo-200", dot: "bg-indigo-500", text: "text-indigo-700" },
  repair: { label: "Ремонт", short: "ремонт", hint: "Ремонт — считается отдельно и в «В выпуске» не входит", chip: "bg-rose-100 text-rose-800 border-rose-200", dot: "bg-rose-500", text: "text-rose-700" },
};
