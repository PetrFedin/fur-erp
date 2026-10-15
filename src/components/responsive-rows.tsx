import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// На ≥ md показываем обычную таблицу (table), на < md — список карточек (children).
// Оба варианта рендерятся на сервере, переключает их только CSS: состояния нет.
export function ResponsiveRows({ table, children, className }: { table: ReactNode; children: ReactNode; className?: string }) {
  return (
    <>
      <div className="hidden md:block">{table}</div>
      <div className={cn("flex flex-col gap-2 md:hidden", className)}>{children}</div>
    </>
  );
}

export type RowField = { label: ReactNode; key?: string; value: ReactNode; strong?: boolean };

// Карточка строки: заголовок (со ссылкой), бейдж, 2–4 ключевых поля «подпись: значение»,
// остальное — в раскрывающемся «Подробнее».
export function RowCard({
  title,
  href,
  subtitle,
  badge,
  fields,
  details,
  extra,
  className,
}: {
  title: ReactNode;
  href?: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  fields: RowField[];
  details?: RowField[];
  extra?: ReactNode;
  className?: string;
}) {
  const shownDetails = (details ?? []).filter((d) => d.value !== null && d.value !== undefined && d.value !== "");
  return (
    <div className={cn("rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-sm", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="break-words font-medium">
            {href ? (
              <Link href={href} className="inline-block py-1.5 hover:underline">
                {title}
              </Link>
            ) : (
              title
            )}
          </div>
          {subtitle && <div className="mt-0.5 break-words text-xs text-neutral-500">{subtitle}</div>}
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>
      {fields.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {fields.map((f, i) => (
            <div key={f.key ?? i} className="min-w-0">
              <dt className="text-xs text-neutral-500">{f.label}</dt>
              <dd className={cn("break-words tabular-nums", f.strong && "font-semibold")}>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {extra && <div className="mt-2">{extra}</div>}
      {shownDetails.length > 0 && (
        <details className="mt-2 border-t border-neutral-100 pt-2">
          <summary className="cursor-pointer select-none py-2 text-xs text-neutral-500 max-md:py-3.5">Подробнее</summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {shownDetails.map((f, i) => (
              <div key={f.key ?? i} className="min-w-0">
                <dt className="text-xs text-neutral-500">{f.label}</dt>
                <dd className="break-words tabular-nums">{f.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}
