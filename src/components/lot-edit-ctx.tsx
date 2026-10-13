"use client";

import { createContext } from "react";

export type LotEditHandler = { commit: () => Promise<boolean>; reset: () => void };

/**
 * Режим правки паспорта лота: числовые поля (цена, количество…) не сохраняются при уходе из поля, а ждут кнопки «Сохранить» паспорта,
 * которая по очереди открывает окно «что изменится». Вне паспорта (контекст пуст) поля работают как раньше.
 */
export type LotEditCtxValue = {
  /** Счётчик отмен: поля сбрасывают введённое при изменении. */
  epoch: number;
  report: (id: string, dirty: boolean, h: LotEditHandler) => void;
  unregister: (id: string) => void;
};

export const LotEditCtx = createContext<LotEditCtxValue | null>(null);
