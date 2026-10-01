"use client";

import { useState, type ReactNode } from "react";

/**
 * <details>, чьё содержимое попадает в DOM только после первого раскрытия.
 * Нужен для длинных списков (лоты по материалам): иначе на телефоне страница
 * получается в сотни тысяч пикселей высотой. Открытое по умолчанию рисуется сразу.
 */
export function LazyDetails({
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [shown, setShown] = useState(defaultOpen);
  return (
    <details className={className} open={defaultOpen || undefined} onToggle={(e) => e.currentTarget.open && setShown(true)}>
      {summary}
      {shown ? children : null}
    </details>
  );
}
