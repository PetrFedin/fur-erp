"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type GalleryPhoto = { id: string; variant: string; color?: string; itemId?: string };
/** Цветовая группа (вариант) с готовой подписью; порядок = порядок вкладок, «Цвет не определён» — последней. */
export type GalleryGroup = { key: string; label: string };
/** Страница магазина для фото (по itemId): ссылка и PLU. Передаётся только сотрудникам заказчика — подрядчик ссылок и PLU не получает. */
export type GalleryShop = { url: string; plu: string | null };
/** Результат server action удаления: error — текст ошибки, left — сколько фото осталось. */
export type DeleteResult = { error?: string; left?: number };

const src = (modelId: string, id: string, thumb?: boolean) => `/api/article-photos/${modelId}/${id}${thumb ? "?size=thumb" : ""}`;

/**
 * Кнопка «Фото (N)» с миниатюрой: по клику поверх страницы открывается окно с большим фото.
 * Листание: ← / → и по краям, свайп, полоса миниатюр; закрытие: Esc, ×, клик вне фото. На телефоне — на весь экран.
 * Основа — нативный <dialog>.showModal(): фокус заперт внутри, фон неактивен, Esc из коробки.
 */
export function PhotoGalleryButton({ modelId, photos: allPhotos, title, compact, onDelete, onDeleteAll, groups: groupsProp, shops, thumbOnly }: {
  /** Только миниатюра 44×44 (для узкой колонки таблицы): клик открывает окно с большим фото. */
  thumbOnly?: boolean;
  modelId: string; photos: GalleryPhoto[]; title: string; compact?: boolean;
  groups?: GalleryGroup[]; shops?: Record<string, GalleryShop>;
  /** Только для сотрудников заказчика с правом править артикул (подрядчику не передаются — кнопок удаления нет). */
  onDelete?: (modelId: string, photoId: string) => Promise<DeleteResult>;
  onDeleteAll?: (modelId: string) => Promise<DeleteResult>;
}) {
  const [gone, setGone] = useState<string[]>([]);
  const alive = allPhotos.filter((p) => !gone.includes(p.id));
  const keys = [...new Set(alive.map((p) => p.variant))];
  const groups = (groupsProp ?? keys.map((k) => ({ key: k, label: k || "Фото" }))).filter((g) => keys.includes(g.key));
  const ordered = groups.flatMap((g) => alive.filter((p) => p.variant === g.key));
  const [gk, setGk] = useState<string | null>(null);
  const activeKey = groups.some((g) => g.key === gk) ? gk : (groups[0]?.key ?? "");
  const photos = ordered.filter((p) => p.variant === activeKey);
  const total = ordered.length;
  const [mode, setMode] = useState<null | "menu" | "one" | "all">(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const n = photos.length;
  const go = useCallback((d: number) => setI((cur) => (cur + d + n) % n), [n]);
  const canDelete = Boolean(onDelete && onDeleteAll);

  async function confirmDelete() {
    if (busy || !onDelete || !onDeleteAll) return;
    setBusy(true); setErr("");
    try {
      if (mode === "all") {
        const r = await onDeleteAll(modelId);
        if (r.error) { setErr(r.error); return; }
        setGone(allPhotos.map((p) => p.id)); setMode(null); setOpen(false);
      } else {
        const id = photos[i]?.id;
        if (!id) return;
        const r = await onDelete(modelId, id);
        if (r.error) { setErr(r.error); return; }
        setGone((g) => [...g, id]);
        setMode(null);
        if (total <= 1) setOpen(false);
        else setI((cur) => (n <= 1 ? 0 : Math.min(cur, n - 2))); // после удаления окно листает дальше: на следующее фото (или на последнее); опустела группа — на первую из оставшихся
      }
    } catch {
      setErr("Не удалось удалить фото. Проверьте соединение и повторите.");
    } finally {
      setBusy(false);
    }
  }

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

  if (total === 0) return null;
  const cur = photos[Math.min(i, n - 1)];
  // Страница магазина: по коду страницы фото, а для вручную внесённой ссылки (без кода) — по цвету-варианту текущего фото.
  const shop = shops ? ((cur.itemId ? shops[cur.itemId.toUpperCase()] : undefined) ?? shops["v:" + cur.variant]) : undefined;
  const group = groups.find((g) => g.key === activeKey);
  return (
    <>
      <button
        type="button"
        onClick={() => { setI(0); setGk(null); setOpen(true); }}
        className={thumbOnly ? "inline-flex size-11 items-center justify-center overflow-hidden rounded border border-neutral-300 bg-white p-0 hover:bg-neutral-50" : "inline-flex min-h-11 items-center gap-2 rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm hover:bg-neutral-50 sm:min-h-9"}
        aria-haspopup="dialog"
        aria-label={`Фото артикула ${title}${thumbOnly ? ` (${total})` : ""}`}
        title={`Фото артикула ${title}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src(modelId, ordered[0].id, true)} alt="" loading="lazy" className={thumbOnly ? "size-11 object-cover" : (compact ? "size-8" : "size-10") + " rounded object-cover"} />
        {thumbOnly ? null : <span>Фото <span className="tabular-nums text-neutral-500">({total})</span></span>}
      </button>
      <dialog
        ref={ref}
        aria-label={`Фото артикула ${title}`}
        onClose={() => { setOpen(false); setMode(null); setErr(""); }}
        onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        className="m-auto h-dvh max-h-dvh w-screen max-w-none bg-neutral-950 p-0 text-white backdrop:bg-black/70 sm:h-[min(92dvh,900px)] sm:w-[min(96vw,1100px)] sm:rounded-2xl"
      >
        {open && (
          <div
            className="relative flex h-full flex-col"
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
                <span className="font-medium">Артикул {title}</span>
                {shop?.plu ? <span className="text-neutral-200"> · PLU {shop.plu}</span> : null}
                {group && (group.label !== "Фото" || cur.variant) ? <span className="text-neutral-300"> · {group.label}{cur.variant && cur.variant !== group.label ? ` (${cur.variant})` : ""}</span> : null}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-sm tabular-nums text-neutral-300">{i + 1} / {n}</span>
                {canDelete && (
                  <button type="button" onClick={() => { setErr(""); setMode(mode ? null : "menu"); }} aria-label="Удалить фото" aria-expanded={mode !== null} title="Удалить фото" className="inline-flex size-11 items-center justify-center rounded-full hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
                    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
                  </button>
                )}
                <button type="button" autoFocus onClick={() => setOpen(false)} aria-label="Закрыть" className="inline-flex size-11 items-center justify-center rounded-full text-2xl hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">×</button>
              </div>
            </div>
            {(shop || groups.length > 1) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-2">
                {groups.length > 1 && (
                  <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto" role="tablist" aria-label="Цвета" data-keep-scroll>
                    {groups.map((g) => (
                      <button
                        key={g.key}
                        type="button"
                        role="tab"
                        aria-selected={g.key === activeKey}
                        onClick={() => { setGk(g.key); setI(0); }}
                        className={"min-h-11 shrink-0 rounded-full border px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-white " + (g.key === activeKey ? "border-white bg-white text-neutral-900" : "border-white/30 text-white/90 hover:bg-white/10")}
                      >
                        {g.label} <span className="tabular-nums opacity-70">· {ordered.filter((p) => p.variant === g.key).length}</span>
                      </button>
                    ))}
                  </div>
                )}
                {shop && (
                  <a href={shop.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-white/40 px-4 text-sm font-medium hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
                    Товар в магазине <span aria-hidden="true">↗</span>
                  </a>
                )}
              </div>
            )}
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
            {canDelete && mode && (
              <div role="alertdialog" aria-label="Удаление фото" className="absolute inset-x-0 bottom-0 z-10 border-t border-white/20 bg-white p-4 text-neutral-900 sm:inset-x-auto sm:right-4 sm:bottom-auto sm:top-16 sm:w-80 sm:rounded-xl sm:border sm:shadow-xl">
                {mode === "menu" ? (
                  <div className="flex flex-col gap-2">
                    <button type="button" onClick={() => setMode("one")} className="min-h-11 rounded-lg px-3 text-left text-sm font-medium hover:bg-neutral-100">Удалить это фото</button>
                    {total > 1 && <button type="button" onClick={() => setMode("all")} className="min-h-11 rounded-lg px-3 text-left text-sm font-medium hover:bg-neutral-100">Удалить все фото артикула ({total})</button>}
                    <button type="button" onClick={() => setMode(null)} className="min-h-11 rounded-lg px-3 text-left text-sm text-neutral-600 hover:bg-neutral-100">Отмена</button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm font-medium">{mode === "all" ? `Удалить все фото артикула ${title} (${total})?` : "Удалить это фото?"}</p>
                    <p className="text-xs text-neutral-600">{mode === "all" ? "Файлы будут стёрты, вернуть их нельзя." : "Файл будет стёрт, вернуть его нельзя."} Запись попадёт в журнал изменений.</p>
                    {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} onClick={confirmDelete} autoFocus className="min-h-11 flex-1 rounded-lg bg-red-700 px-4 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60">{busy ? "Удаляю…" : "Удалить"}</button>
                      <button type="button" disabled={busy} onClick={() => { setMode(null); setErr(""); }} className="min-h-11 flex-1 rounded-lg border border-neutral-300 px-4 text-sm hover:bg-neutral-50">Отмена</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
