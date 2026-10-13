import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Сворачиваемый блок: в строке-заголовке — название и краткий итог, внутри — полное содержимое.
 * `problem` — итог подсвечен красным (есть что исправить) и, если не задано `autoOpen`, блок раскрыт сам.
 * `autoOpen={false}` — всегда свёрнут по умолчанию, даже при проблеме (карточки: развёрнуты только цифры, документы и прочее — по клику).
 */
export function CollapsibleBlock({
  title,
  summary,
  problem = false,
  autoOpen,
  id,
  children,
}: {
  title: string;
  summary: ReactNode;
  problem?: boolean;
  autoOpen?: boolean;
  id?: string;
  children: ReactNode;
}) {
  return (
    <details
      id={id}
      open={autoOpen ?? problem}
      data-collapsible-block
      className={cn("group rounded-lg border bg-white", problem ? "border-red-300" : "border-neutral-200")}
    >
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-neutral-500 transition-transform group-open:rotate-90">›</span>
        <span className="block-title">{title}</span>
        <span className={cn("text-xs", problem ? "font-medium text-red-700" : "text-neutral-600")}>{summary}</span>
      </summary>
      <div className="border-t border-neutral-100 p-2 sm:p-3">{children}</div>
    </details>
  );
}
