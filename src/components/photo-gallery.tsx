"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type GalleryPhoto = { id: string; variant: string };

const src = (modelId: string, id: string, thumb?: boolean) => `/api/article-photos/${modelId}/${id}${thumb ? "?size=thumb" : ""}`;

/**
 * Кнопка «Фото (N)» с миниатюрой: по клику поверх страницы открывается окно с большим фото.
 * Листание: ← / → и по краям, свайп, полоса миниатюр; закрытие: Esc, ×, клик вне фото. На телефоне — на весь экран.
 * Основа — нативный <dialog>.showModal(): фокус заперт внутри, фон неактивен, Esc из коробки.
 */
export function PhotoGalleryButton({ modelId, photos, title, compact }: { modelId: string; photos: GalleryPhoto[]; title: string; compact?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const n = photos.length;
  const go = useCallback((d: number) => setI((cur) => (cur + d + n) % n), [n]);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go]);

  // Подгружаем соседние фото, чтобы листание не мигало.
  useEffect(() => {
    if (!open || n < 2) return;
    for (const d of [1, -1]) { const img = new Image(); img.src = src(modelId, photos[(i + d + n) % n].id); }
  }, [open, i, n, modelId, photos]);

  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>("[data-active-thumb]")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [open, i]);

  if (n === 0) return null;
  const cur = photos[i];
  return (
    <>
      <button
        type="button"
        onClick={() => { setI(0); setOpen(true); }}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm hover:bg-neutral-50 sm:min-h-9"
        aria-haspopup="dialog"
        title={`Фото артикула ${title}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src(modelId, photos[0].id, true)} alt="" loading="lazy" className={(compact ? "size-8" : "size-10") + " rounded object-cover"} />
        <span>Фото <span className="tabular-nums text-neutral-500">({n})</span></span>
      </button>
      <dialog
        ref={ref}
        aria-label={`Фото артикула ${title}`}
        onClose={() => setOpen(false)}
        onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        className="m-auto h-dvh max-h-dvh w-screen max-w-none bg-neutral-950 p-0 text-white backdrop:bg-black/70 sm:h-[min(92dvh,900px)] sm:w-[min(96vw,1100px)] sm:rounded-2xl"
      >
        {open && (
          <div
            className="flex h-full flex-col"
            onTouchStart={(e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; }}
            onTouchEnd={(e) => {
              const s = touch.current; touch.current = null;
              if (!s) return;
              const t = e.changedTouches[0];
              const dx = t.clientX - s.x, dy = t.clientY - s.y;
              if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
            }}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-2">
              <p className="min-w-0 truncate text-sm" aria-live="polite">
                <span className="font-medium">{title}</span>
                {cur.variant ? <span className="text-neutral-300"> · {cur.variant}</span> : null}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-sm tabular-nums text-neutral-300">{i + 1} / {n}</span>
                <button type="button" autoFocus onClick={() => setOpen(false)} aria-label="Закрыть" className="inline-flex size-11 items-center justify-center rounded-full text-2xl hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">×</button>
              </div>
            </div>
            <div className="relative min-h-0 flex-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={cur.id} src={src(modelId, cur.id)} alt={`${title}${cur.variant ? ", " + cur.variant : ""}, фото ${i + 1} из ${n}`} className="absolute inset-0 size-full object-contain" />
              {n > 1 && (
                <>
                  <button type="button" onClick={() => go(-1)} aria-label="Предыдущее фото" className="absolute inset-y-0 left-0 flex w-14 items-center justify-center text-3xl text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">‹</button>
                  <button type="button" onClick={() => go(1)} aria-label="Следующее фото" className="absolute inset-y-0 right-0 flex w-14 items-center justify-center text-3xl text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">›</button>
                </>
              )}
            </div>
            {n > 1 && (
              <div className="flex shrink-0 flex-nowrap gap-2 overflow-x-auto px-4 py-3" role="tablist" data-keep-scroll aria-label="Все фото">
                {photos.map((p, k) => (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={k === i}
                    aria-label={`Фото ${k + 1}`}
                    data-active-thumb={k === i ? "" : undefined}
                    onClick={() => setI(k)}
                    className={"shrink-0 rounded-md border-2 " + (k === i ? "border-white" : "border-transparent opacity-60 hover:opacity-100")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src(modelId, p.id, true)} alt="" loading="lazy" className="h-14 w-11 rounded object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
