/** Иконки действий (карандаш, корзина, свернуть, гвоздик): вместо подписей «Изменить», «Удалить», «Свернуть», «Закрепить»; название — в подсказке (title) и aria-label кнопки. */
const base = { "aria-hidden": true, viewBox: "0 0 16 16", className: "h-3.5 w-3.5", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Единый вид кнопки-иконки (как «Свернуть»/«Закрепить»): квадрат 28 px, значок 14 px. */
export const ICON_BTN = "inline-flex h-7 w-7 min-h-0 shrink-0 items-center justify-center gap-0 rounded-md border border-neutral-200 bg-white p-0 text-neutral-600 transition hover:bg-neutral-50 btn-accent";
export const ICON_BTN_DANGER = ICON_BTN + " text-red-600 hover:border-red-300 hover:bg-red-50";

export function IconPencil({ className }: { className?: string }) {
  return <svg {...base} className={className ?? base.className}><path d="M2.5 13.5l.6-3L10.6 3a1.4 1.4 0 0 1 2 0l.4.4a1.4 1.4 0 0 1 0 2l-7.5 7.5-3 .6zM9.5 4.2l2.3 2.3" /></svg>;
}
export function IconTrash({ className }: { className?: string }) {
  return <svg {...base} className={className ?? base.className}><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.6 9h6.8L12 4M6.6 6.5v4M9.4 6.5v4" /></svg>;
}
export function IconChevronUp({ className }: { className?: string }) {
  return <svg {...base} className={className ?? base.className} strokeWidth={1.6}><path d="M3.5 10 8 5.5 12.5 10" /></svg>;
}
export function IconPin({ className }: { className?: string }) {
  return <svg aria-hidden viewBox="0 0 16 16" className={className ?? "h-3.5 w-3.5"} fill="currentColor"><path d="M9.8 1.2 14.8 6.2l-1.1.4-1.6 1.6.5 3.1-1 1-2.9-2.9-3.7 3.7-.7-.7 3.7-3.7L3.1 5.8l1-1 3.1.5 1.6-1.6z" /></svg>;
}
