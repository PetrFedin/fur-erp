"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { fromLabel, safeFrom } from "@/lib/back-from";

/** «‹ Назад к: …» — только если пришли по ссылке с безопасным ?from=. */
export function BackLink() {
  const from = safeFrom(useSearchParams().get("from"));
  if (!from) return null;
  return (
    <p className="mb-2 text-xs print:hidden">
      <Link href={from} data-touch-ok className="text-blue-700 hover:underline" title={`Вернуться: ${from}`}>
        ‹ Назад к: {fromLabel(from)}
      </Link>
    </p>
  );
}
