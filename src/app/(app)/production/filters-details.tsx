"use client";

import { useEffect, useRef } from "react";

/** <details>, свёрнутый на мобильном (< 640 px) и раскрытый от sm и выше. */
export function ResponsiveDetails({
  summary,
  children,
  forceOpen = false,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  /** Раскрыт и на мобильном (например, когда фильтры уже применены). */
  forceOpen?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (window.matchMedia("(min-width: 640px)").matches && ref.current) ref.current.open = true;
  }, []);
  return (
    <details ref={ref} open={forceOpen} className="group">
      <summary className="cursor-pointer list-none rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 sm:hidden">
        {summary}
      </summary>
      <div className="mt-2 sm:mt-0">{children}</div>
    </details>
  );
}
