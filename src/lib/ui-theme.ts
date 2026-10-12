// Тема оформления: «Привычный стиль» (палитра и шрифт, знакомые заказчику) или «Текущий стиль» (как было).
// Выбор лежит в cookie uiTheme; корневой layout читает его на сервере и ставит data-theme на <html>, поэтому страница не мигает.
// Тема целиком в src/app/theme-customer.css: переопределяет токены Tailwind внутри html[data-theme="customer"], разметку не меняет.
export type UiTheme = "customer" | "current";
export const THEME_COOKIE = "uiTheme";
export const DEFAULT_THEME: UiTheme = "customer";
// «Текущий стиль» скрыт: переключателя нет, всегда «Привычный стиль» (cookie uiTheme игнорируется). Чтобы вернуть выбор, восстановите проверку cookie здесь и показ ThemeToggle.
export const THEME_SWITCH_ENABLED = false;
export const parseTheme = (v: string | undefined | null): UiTheme => (THEME_SWITCH_ENABLED && (v === "current" || v === "customer") ? v : DEFAULT_THEME);

/** Только в браузере: запоминает выбор и сразу применяет тему к <html>. */
export function applyTheme(t: UiTheme) {
  document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.setAttribute("data-theme", t);
}
