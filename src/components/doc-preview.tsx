"use client";

import { useEffect, useState } from "react";

/** PDF и картинки показываем во всплывающем окне; xlsx/docx просто скачиваются. */
export function isPreviewable(mime: string | null | undefined): boolean {
  return !!mime && (mime === "application/pdf" || mime.startsWith("image/"));
}

const btnPrimary =
  "inline-flex h-8 items-center rounded-md bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-700";
const btnGhost =
  "inline-flex h-8 items-center rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-700 hover:bg-neutral-50";

/**
 * Кнопки «Открыть» (предпросмотр PDF/картинки в окне; для xlsx/docx — скачивание) и «Скачать»
 * для файла, который отдаёт href (например /api/drive-docs/<id>).
 */
export function DocFileButtons({ href, mime, title }: { href: string; mime: string | null | undefined; title: string }) {
  const [open, setOpen] = useState(false);
  const preview = isPreviewable(mime);
  const sep = href.includes("?") ? "&" : "?";
  return (
    <>
      {preview ? (
        <button type="button" className={btnPrimary} onClick={() => setOpen(true)}>
          Открыть
        </button>
      ) : (
        <a className={btnPrimary} href={`${href}${sep}download=1`}>
          Открыть
        </a>
      )}
      <a className={btnGhost} href={`${href}${sep}download=1`} download>
        Скачать
      </a>
      {open && <PreviewModal href={href} mime={mime} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

function PreviewModal({ href, mime, title, onClose }: { href: string; mime: string | null | undefined; title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="flex w-full max-w-5xl flex-col overflow-hidden bg-white shadow-xl sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2">
          <div className="min-w-0 truncate text-sm font-medium">{title}</div>
          <div className="flex shrink-0 items-center gap-2">
            <a className={btnGhost} href={href} target="_blank" rel="noreferrer">
              В новой вкладке
            </a>
            <button type="button" className={btnGhost} onClick={onClose}>
              Закрыть
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-neutral-100">
          {mime === "application/pdf" ? (
            <iframe src={href} title={title} className="h-full w-full border-0" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={href} alt={title} className="mx-auto h-auto max-h-full max-w-full object-contain" />
          )}
        </div>
      </div>
    </div>
  );
}
