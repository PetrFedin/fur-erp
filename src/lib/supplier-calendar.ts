// Календарь Веллмеха по артикулу: единый справочник этапов. Запись — CalendarEvent с supplierId; action хранит подпись этапа,
// чтобы наш общий календарь и его фильтр по действию работали без изменений.
export type SupStage = { key: string; label: string; chip: string; dot: string };

export const SUP_STAGES: readonly SupStage[] = [
  { key: "launch", label: "Запуск", chip: "bg-slate-100 text-slate-700 border-slate-300", dot: "bg-slate-400" },
  { key: "furrier", label: "У скорняка", chip: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-500" },
  { key: "tailor", label: "У портного", chip: "bg-orange-100 text-orange-800 border-orange-200", dot: "bg-orange-500" },
  { key: "ready", label: "Готово / сдано", chip: "bg-emerald-100 text-emerald-800 border-emerald-200", dot: "bg-emerald-500" },
  { key: "shipped", label: "Отгружено", chip: "bg-indigo-100 text-indigo-800 border-indigo-200", dot: "bg-indigo-500" },
  { key: "accepted", label: "Принято в Коптево", chip: "bg-teal-100 text-teal-800 border-teal-200", dot: "bg-teal-500" },
];

const FALLBACK = SUP_STAGES[0];
export const supStage = (key: string | null | undefined): SupStage => SUP_STAGES.find((s) => s.key === key) ?? FALLBACK;
export const isSupStage = (key: unknown): key is string => SUP_STAGES.some((s) => s.key === key);
/** Следующий этап или null, если запись уже на последнем. */
export function nextSupStage(key: string | null | undefined): SupStage | null {
  const i = SUP_STAGES.findIndex((s) => s.key === key);
  return i >= 0 && i < SUP_STAGES.length - 1 ? SUP_STAGES[i + 1] : null;
}
/** Этап считается завершающим (запись «выполнена» в нашем календаре). */
export const isFinalSupStage = (key: string | null | undefined) => key === SUP_STAGES[SUP_STAGES.length - 1].key;

export const SUPPLIER_LABEL = "Веллмех";

/** Строка записи, как её видит страница поставщика (без чего-либо ценового). */
export type SupEntry = {
  id: string;
  articleCode: string;
  articleName: string;
  color: string;
  size: string;
  quantity: number;
  status: string;
  planDate: string;
  factDate: string;
  notes: string;
  docNote: string;
};
