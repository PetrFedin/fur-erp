"use client";

import Link from "next/link";

/** Панель над листом: скрывается при печати (.no-print). */
export function PrintToolbar({
  backHref,
  docxHref,
  switches,
}: {
  backHref: string;
  docxHref?: string;
  switches?: { label: string; href: string; active: boolean }[];
}) {
  return (
    <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2 text-sm">
      <Link href={backHref} className="text-neutral-600 hover:underline">
        ← Назад
      </Link>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {switches?.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className={
              "rounded border px-2 py-1 " +
              (s.active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700 hover:bg-neutral-50")
            }
          >
            {s.label}
          </Link>
        ))}
        {docxHref && (
          <a href={docxHref} className="rounded border border-neutral-300 px-3 py-1 text-neutral-700 hover:bg-neutral-50">
            Скачать .docx
          </a>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded bg-neutral-900 px-3 py-1 text-white hover:bg-neutral-700"
        >
          Печать / PDF
        </button>
      </div>
    </div>
  );
}
