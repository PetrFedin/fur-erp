"use client";

import type { ReactNode } from "react";

/** Кнопка отправки формы с подтверждением («Удалить позицию?»). */
export function ConfirmButton({ children, message, className }: { children: ReactNode; message: string; className?: string }) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
