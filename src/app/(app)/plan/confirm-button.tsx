"use client";

import type { ReactNode } from "react";

/** Кнопка отправки формы с подтверждением («Удалить позицию?»). */
export function ConfirmButton({ children, message, className, title }: { children: ReactNode; message: string; className?: string; title?: string }) {
  return (
    <button
      type="submit"
      className={className}
      title={title}
      aria-label={title}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
