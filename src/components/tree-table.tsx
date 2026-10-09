// Общие классы таблиц с раскрытием вглубь стрелкой › — как «Динамика по годам» и «Динамика по сырью» на Главной.
// 1-й уровень text-sm, вложенные text-xs серым; если раскрыт следующий уровень, строка становится чёрной (text-neutral-900).
export const TH = "whitespace-nowrap px-1.5 py-1.5 text-right text-xs font-medium text-neutral-500";
export const TD = "whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums";
export const TH_LEFT = "px-2 py-1.5 text-left text-xs font-medium text-neutral-500";
/** Узкая колонка со стрелкой раскрытия: у всех строк на одной вертикали. */
export const ARROW_TD = "w-6 py-1.5 pl-2 pr-0 text-left align-middle";
export const ARROW_TH = "w-6 px-0";
export const SCROLL_BOX = "table-scroll scroll-hint overflow-x-auto rounded-lg border border-neutral-200 bg-white";

/** Классы строки по уровню вложенности: 0 — год/итог (text-sm), 1 — text-[13px], 2 и глубже — text-xs серым. */
export function rowTone(level: 0 | 1 | 2 | 3, open = false): string {
  const base = ["", "bg-neutral-50/70 text-[13px]", "bg-neutral-50/70 text-xs", "bg-neutral-50/70 text-xs"][level];
  const colour = open ? "text-neutral-900" : level === 0 ? "" : level === 1 ? "text-neutral-700" : level === 2 ? "text-neutral-600" : "text-neutral-500";
  return `border-b border-neutral-100 ${base} ${colour}`.replace(/\s+/g, " ").trim();
}

export function Chevron({ open }: { open: boolean }) {
  return <span aria-hidden className={"inline-block w-4 text-neutral-500 transition-transform " + (open ? "rotate-90" : "")}>›</span>;
}

/** Отступ подписи по уровню. */
export const INDENT = ["pl-2", "pl-5", "pl-9", "pl-12"] as const;

/** «—» вместо нуля и пустоты. */
export function Dash() {
  return <span className="text-neutral-300">—</span>;
}
