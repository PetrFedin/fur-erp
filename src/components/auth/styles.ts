import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Стили служебных страниц (вход, регистрация, ошибки). Обычный модуль, без "use client":
// его можно импортировать и в серверные страницы (not-found), и в клиентские.

/** Один заметный фокус: тёмное кольцо с отступом (≥3:1 на белом). */
export const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2";

/** Поле формы: 44px высотой, 16px текстом (без увеличения на iPhone), рамка и плейсхолдер ≥4.5:1. */
export const FIELD = `h-11 border-neutral-500 text-base shadow-none placeholder:text-neutral-500 ${FOCUS}`;

/** Ссылка под карточкой: тихая, но с целью нажатия 44px. */
export const FOOTER_LINK = `inline-flex min-h-11 items-center rounded-md px-1 font-medium text-neutral-900 underline underline-offset-4 hover:text-neutral-700 ${FOCUS}`;

/** Кнопка или ссылка-кнопка действия на служебной странице: 44px, крупный текст, общий фокус. */
export function actionClass(variant: "default" | "outline" = "default") {
  return cn(buttonVariants({ variant }), "h-11 px-5 text-base", FOCUS);
}
