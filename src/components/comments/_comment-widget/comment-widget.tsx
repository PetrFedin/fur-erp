"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { CommentDto, PageCounts } from "@/lib/comments-service";
import { CommentCard } from "../comment-card";
import { collectAnchors, flashElement, innermost, type AnchorInfo } from "../anchors";
import { type Mode } from "./shared";
import { NewForm } from "./new-form";

type CountsResp = { ready: boolean; record: { type: string; key: string; label: string } | null } & Partial<PageCounts>;

type Scope = { kind: "page" } | { kind: "anchor"; id: string; label: string } | { kind: "entity" };

type Badge = { id: string; label: string; open: number; total: number; x: number; y: number };

/**
 * Плавающая кнопка «Комментарий» на всех страницах раздела: панель (вся страница / запись / блок / выделенный текст),
 * метки-счётчики на блоках с комментариями, подсветка места по ссылке «Открыть место».
 * Ввод не теряется: панель при закрытии (Esc) остаётся в памяти, а черновик лежит в localStorage.
 */
export function CommentWidget() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const pageUrl = pathname + (search ? `?${search}` : "");

  const [open, setOpen] = useState(false);
  // Телефон/планшет: кнопка уезжает вниз при прокрутке вниз и возвращается при прокрутке вверх, чтобы не закрывать контент.
  const [tuck, setTuck] = useState(false);
  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    let last = main.scrollTop;
    const onScroll = () => {
      const t = main.scrollTop;
      if (Math.abs(t - last) < 8) return;
      setTuck(t > last && t > 80);
      last = t;
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, []);
  const [everOpened, setEverOpened] = useState(false);
  const [tab, setTab] = useState<"new" | "here">("new");
  const [mode, setMode] = useState<Mode>("page");
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const [quote, setQuote] = useState("");
  const [picking, setPicking] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; w: number; h: number; label: string } | null>(null);
  const [countsState, setCountsState] = useState<{ path: string; data: CountsResp } | null>(null);
  const [thread, setThread] = useState<CommentDto[] | null>(null);
  const [scope, setScope] = useState<Scope>({ kind: "page" });
  const [selBtn, setSelBtn] = useState<{ x: number; y: number; text: string; anchor: { id: string; label: string } | null } | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [portalReady, setPortalReady] = useState(false);

  // При переходе на другую страницу привязка к блоку и цитата сбрасываются (адаптация состояния прямо при рендере).
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setMode("page");
    setPicked(null);
    setQuote("");
    setScope({ kind: "page" });
    setThread(null);
    setSelBtn(null);
    setPicking(false);
  }

  const counts = countsState?.path === pathname ? countsState.data : null;
  const registry = useRef<Map<string, AnchorInfo>>(new Map());
  const countsRef = useRef<CountsResp | null>(null);
  useEffect(() => {
    countsRef.current = counts;
  }, [counts]);

  useEffect(() => {
    const t = setTimeout(() => setPortalReady(true), 0);
    return () => clearTimeout(t);
  }, []);

  // ───── счётчики страницы (один лёгкий запрос на страницу; сервер кэширует 15 с) ─────
  const loadCounts = useCallback(async () => {
    try {
      const res = await fetch(`/api/comments?mode=counts&path=${encodeURIComponent(pathname)}`, { credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as CountsResp;
      setCountsState({ path: pathname, data });
    } catch {
      /* сеть недоступна — метки просто не покажем */
    }
  }, [pathname]);
  useEffect(() => {
    let dead = false;
    const t = setTimeout(() => {
      if (!dead) void loadCounts();
    }, 200);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [loadCounts]);

  const loadThread = useCallback(
    async (sc: Scope) => {
      try {
        const q = sc.kind === "anchor" ? `&anchor=${encodeURIComponent(sc.id)}` : sc.kind === "entity" ? "&scope=entity" : "";
        const res = await fetch(`/api/comments?mode=thread&path=${encodeURIComponent(pageUrl)}${q}`, { credentials: "same-origin" });
        if (!res.ok) return;
        const d = (await res.json()) as { items?: CommentDto[] };
        setThread(d.items ?? []);
      } catch {
        setThread([]);
      }
    },
    [pageUrl],
  );

  // ───── метки-счётчики на блоках ─────
  const measure = useCallback(() => {
    const c = countsRef.current;
    const main = document.querySelector("main");
    if (!c?.blocks || !main) {
      setBadges((b) => (b.length ? [] : b));
      return;
    }
    const mr = main.getBoundingClientRect();
    const next: Badge[] = [];
    for (const [id, n] of Object.entries(c.blocks)) {
      const a = registry.current.get(id);
      if (!a || !a.el.isConnected) continue;
      const r = a.el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < mr.top + 12 || r.top > mr.bottom - 12) continue;
      next.push({ id, label: a.label, open: n.open, total: n.total, x: Math.round(Math.min(r.right, mr.right - 4)), y: Math.round(Math.max(r.top, mr.top + 2)) });
    }
    setBadges((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, []);

  useEffect(() => {
    let raf = 0;
    let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    const rebuild = () => {
      registry.current = collectAnchors();
      schedule();
    };
    const first = setTimeout(rebuild, 500);
    const main = document.querySelector("main");
    const mo = new MutationObserver(() => {
      if (rebuildTimer) clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(rebuild, 400);
    });
    if (main) mo.observe(main, { childList: true, subtree: true });
    main?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      clearTimeout(first);
      if (rebuildTimer) clearTimeout(rebuildTimer);
      cancelAnimationFrame(raf);
      mo.disconnect();
      main?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [measure, counts, pathname]);

  // ───── «Открыть место»: #cm=<блок>.<id> → прокрутка и подсветка ─────
  const flashAnchor = useCallback((anchor: string) => {
    let tries = 0;
    const go = () => {
      registry.current = collectAnchors();
      const hit = registry.current.get(anchor);
      if (hit) flashElement(hit.el);
      else if (++tries < 8) setTimeout(go, 400);
    };
    go();
  }, []);
  useEffect(() => {
    const m = /^#cm=([^.]*)/.exec(window.location.hash);
    if (!m) return;
    const anchor = decodeURIComponent(m[1]);
    const t = setTimeout(() => {
      if (anchor !== "page") flashAnchor(anchor);
      try {
        window.history.replaceState(window.history.state, "", pathname + (search ? `?${search}` : ""));
      } catch {
        /* адрес оставляем как есть */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [pathname, search, flashAnchor]);

  // События от других частей интерфейса: «Комментировать запись» и «Открыть место» на этой же странице.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ mode?: Mode }>).detail;
      setMode(d?.mode ?? "page");
      setTab("new");
      setEverOpened(true);
      setOpen(true);
    };
    const onFlash = (e: Event) => {
      const a = (e as CustomEvent<{ anchor?: string }>).detail?.anchor;
      if (a) flashAnchor(a);
    };
    window.addEventListener("fur-comment-open", onOpen);
    window.addEventListener("fur-comment-flash", onFlash);
    return () => {
      window.removeEventListener("fur-comment-open", onOpen);
      window.removeEventListener("fur-comment-flash", onFlash);
    };
  }, [flashAnchor]);

  // ───── Esc закрывает панель / отменяет выбор блока ─────
  useEffect(() => {
    if (!open && !picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (picking) {
        setPicking(false);
        setHover(null);
        setOpen(true);
      } else setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, picking]);

  // ───── режим «Указать блок на странице» ─────
  useEffect(() => {
    if (!picking) return;
    registry.current = collectAnchors();
    const find = (t: EventTarget | null) => (t instanceof Node ? innermost(registry.current, t) : null);
    const inUi = (t: EventTarget | null) => t instanceof Element && !!t.closest("[data-comment-ui]");
    const onMove = (e: MouseEvent) => {
      if (inUi(e.target)) return setHover(null);
      const a = find(e.target);
      if (!a) return setHover(null);
      const r = a.el.getBoundingClientRect();
      setHover({ x: r.left, y: r.top, w: r.width, h: r.height, label: a.label });
    };
    const onClick = (e: MouseEvent) => {
      if (inUi(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const a = find(e.target);
      if (!a) return;
      setPicked({ id: a.id, label: a.label });
      setMode("block");
      setPicking(false);
      setHover(null);
      setTab("new");
      setOpen(true);
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    const prev = document.body.style.cursor;
    document.body.style.cursor = "crosshair";
    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.body.style.cursor = prev;
    };
  }, [picking]);

  // ───── «Комментировать выделенное» ─────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      const s = window.getSelection();
      const text = s?.toString().replace(/\s+/g, " ").trim() ?? "";
      if (!s || s.rangeCount === 0 || text.length < 2 || text.length > 600) return setSelBtn(null);
      const range = s.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const el = node instanceof Element ? node : node.parentElement;
      if (!el || !el.closest("main") || el.closest("[data-comment-ui]") || el.closest("input, textarea, [contenteditable=true]")) return setSelBtn(null);
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return setSelBtn(null);
      registry.current = registry.current.size ? registry.current : collectAnchors();
      const a = innermost(registry.current, node);
      setSelBtn({ x: Math.min(Math.max(8, r.left), window.innerWidth - 220), y: Math.min(r.bottom + 6, window.innerHeight - 48), text: text.slice(0, 500), anchor: a ? { id: a.id, label: a.label } : null });
    };
    const later = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, 180);
    };
    document.addEventListener("selectionchange", later);
    document.addEventListener("mouseup", later);
    document.addEventListener("touchend", later);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("selectionchange", later);
      document.removeEventListener("mouseup", later);
      document.removeEventListener("touchend", later);
    };
  }, []);

  const openPanel = (m?: Mode) => {
    if (m) setMode(m);
    setTab("new");
    setEverOpened(true);
    setOpen(true);
  };
  const showHere = (sc: Scope) => {
    setScope(sc);
    setThread(null);
    setTab("here");
    setEverOpened(true);
    setOpen(true);
    void loadThread(sc);
  };
  const afterSaved = () => {
    void loadCounts();
    setScope({ kind: "page" });
    setThread(null);
    setTab("here");
    void loadThread({ kind: "page" });
  };

  const openCount = counts?.page?.open ?? 0;
  const entity = counts?.record ?? null;
  const pageTitleNow = typeof document !== "undefined" ? document.title.replace(/\s*[|·—-]\s*(МехУчёт|fur-erp).*$/i, "") : "";

  const ui = (
    <div data-comment-ui>
      {/* Метки-счётчики на блоках */}
      {badges.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => showHere({ kind: "anchor", id: b.id, label: b.label })}
          title={`Комментарии к блоку «${b.label}»: открытых ${b.open}, всего ${b.total}`}
          style={{ left: b.x, top: b.y, transform: "translate(-100%, 0)" }}
          className={cn(
            "fixed z-30 -ml-1 mt-1 inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-semibold shadow-sm",
            b.open > 0 ? "border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100" : "border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-50",
          )}
        >
          <MessageSquare aria-hidden className="h-3.5 w-3.5" />
          <span className="tabular-nums">{b.open > 0 ? b.open : b.total}</span>
        </button>
      ))}

      {/* Подсветка при выборе блока */}
      {picking && (
        <>
          <div className="fixed inset-x-0 top-2 z-[70] flex justify-center px-3">
            <div className="flex max-w-full items-center gap-3 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg">
              <span>Наведите на блок и нажмите на него{hover ? `: «${hover.label}»` : ""}</span>
              <button
                type="button"
                onClick={() => {
                  setPicking(false);
                  setHover(null);
                  setOpen(true);
                }}
                className="rounded-full border border-white/40 px-2 py-0.5 text-xs hover:bg-white/10"
              >
                Отмена (Esc)
              </button>
            </div>
          </div>
          {hover && <div aria-hidden className="pointer-events-none fixed z-[65] rounded-md border-2 border-blue-500 bg-blue-500/10" style={{ left: hover.x, top: hover.y, width: hover.w, height: hover.h }} />}
        </>
      )}

      {/* Кнопка «Комментировать выделенное» */}
      {selBtn && !picking && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setQuote(selBtn.text);
            setPicked(selBtn.anchor);
            setMode("selection");
            setSelBtn(null);
            openPanel("selection");
          }}
          style={{ left: selBtn.x, top: selBtn.y }}
          className="fixed z-[60] rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-neutral-700"
        >
          <MessageSquare aria-hidden className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />Комментировать выделенное
        </button>
      )}

      {/* Плавающая кнопка */}
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-expanded={open}
        title="Оставить комментарий: замечание, ошибка, идея или вопрос к этой странице, записи или блоку"
        className={cn("fixed bottom-3 right-3 z-40 inline-flex h-11 items-center gap-1.5 rounded-full border border-neutral-300 bg-white/95 px-3.5 text-sm font-medium text-neutral-800 shadow-md backdrop-blur transition-transform hover:bg-white max-lg:w-11 max-lg:justify-center max-lg:px-0", tuck && !open && "max-lg:translate-y-20")}
      >
        <MessageSquare aria-hidden className="h-[18px] w-[18px]" />
        <span className="max-lg:sr-only">Комментарий</span>
        {openCount > 0 && <span className="rounded-full bg-blue-600 px-1.5 text-xs font-semibold tabular-nums text-white max-lg:absolute max-lg:-right-1 max-lg:-top-1">{openCount}</span>}
      </button>

      {/* Панель */}
      {everOpened && (
        <div
          role="dialog"
          aria-label="Комментарий"
          hidden={!open || picking}
          className="fixed bottom-16 right-3 z-50 flex max-h-[80vh] w-[26rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-2xl max-sm:inset-x-3 max-sm:w-auto max-sm:max-w-none"
        >
          <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2">
            <div className="flex gap-1 text-sm">
              <button type="button" onClick={() => setTab("new")} className={cn("rounded-md px-2.5 py-1", tab === "new" ? "bg-neutral-900 text-white" : "hover:bg-neutral-100")}>
                Новый
              </button>
              <button
                type="button"
                onClick={() => showHere(scope)}
                className={cn("rounded-md px-2.5 py-1", tab === "here" ? "bg-neutral-900 text-white" : "hover:bg-neutral-100")}
              >
                Здесь{counts?.page?.total ? ` (${counts.page.total})` : ""}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/history/comments" className="text-xs text-blue-700 hover:underline">
                Все комментарии
              </Link>
              <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть (Esc)" title="Закрыть (Esc) — введённый текст сохранится" className="rounded-md px-2 py-1 text-neutral-500 hover:bg-neutral-100">
                ✕
              </button>
            </div>
          </div>

          <div className="overflow-y-auto p-3">
            <NewForm
              hidden={tab !== "new"}
              open={open}
              mode={mode}
              setMode={setMode}
              picked={picked}
              quote={quote}
              entity={entity}
              pageUrl={pageUrl}
              pathname={pathname}
              search={search}
              pageTitle={pageTitleNow}
              onPick={() => {
                setPicking(true);
                setOpen(false);
              }}
              onSaved={afterSaved}
            />
            {tab === "here" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <button type="button" onClick={() => showHere({ kind: "page" })} className={cn("rounded-full border px-2.5 py-1", scope.kind === "page" ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300")}>
                    Вся страница
                  </button>
                  {entity && (
                    <button type="button" onClick={() => showHere({ kind: "entity" })} className={cn("rounded-full border px-2.5 py-1", scope.kind === "entity" ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300")}>
                      {entity.label}
                    </button>
                  )}
                  {scope.kind === "anchor" && <span className="rounded-full border border-neutral-900 bg-neutral-900 px-2.5 py-1 text-white">Блок: {scope.label}</span>}
                </div>
                {thread === null && <p className="text-sm text-neutral-500">Загружаю…</p>}
                {thread?.length === 0 && <p className="text-sm text-neutral-500">Комментариев здесь пока нет.</p>}
                {thread?.map((c) => (
                  <CommentCard
                    key={c.id}
                    c={c}
                    compact
                    onChanged={() => {
                      void loadCounts();
                      void loadThread(scope);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return portalReady ? createPortal(ui, document.body) : null;
}
