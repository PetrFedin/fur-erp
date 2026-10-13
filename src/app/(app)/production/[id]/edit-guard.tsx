"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { useConfirm } from "@/components/confirm-dialog";

type Guard = () => Promise<boolean>;
const Ctx = createContext<Guard | null>(null);
const DirtyCtx = createContext<((id: string, dirty: boolean) => void) | null>(null);

/**
 * Любое ТЗ можно править в любом статусе. У ЗАВЕРШЁННОГО перед первой правкой на странице спрашиваем один раз:
 * правка пересчитает себестоимость и остатки. Ответ «Править» действует до перезагрузки страницы.
 */
export function EditGuard({ completed, children }: { completed: boolean; children: ReactNode }) {
  const { ask, node } = useConfirm();
  const okRef = useRef(false);
  const guard = useCallback<Guard>(async () => {
    if (!completed || okRef.current) return true;
    const ok = await ask("ТЗ завершено; правка пересчитает себестоимость и остатки. Продолжить?", { ok: "Править" });
    if (ok) okRef.current = true;
    return ok;
  }, [completed, ask]);
  // Несохранённые правки строк: пока они есть, уход со страницы (закрытие, обновление, внешняя ссылка) предупреждает.
  const dirty = useRef(new Set<string>());
  const mark = useCallback((id: string, d: boolean) => {
    if (d) dirty.current.add(id);
    else dirty.current.delete(id);
  }, []);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty.current.size === 0) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);
  return (
    <Ctx.Provider value={guard}>
      <DirtyCtx.Provider value={mark}>
        {children}
        {node}
      </DirtyCtx.Provider>
    </Ctx.Provider>
  );
}

/** Вне карточки ТЗ (или не у завершённого) защита пропускает сразу. */
export function useEditGuard(): Guard {
  return useContext(Ctx) ?? (async () => true);
}

/** Строка сообщает карточке, что в ней есть несохранённая правка (для предупреждения при уходе со страницы). */
export function useDirtyMark(dirty: boolean) {
  const id = useId();
  const mark = useContext(DirtyCtx);
  useEffect(() => {
    mark?.(id, dirty);
    return () => mark?.(id, false);
  }, [id, dirty, mark]);
}
