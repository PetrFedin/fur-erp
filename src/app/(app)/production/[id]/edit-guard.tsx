"use client";

import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";
import { useConfirm } from "@/components/confirm-dialog";

type Guard = () => Promise<boolean>;
const Ctx = createContext<Guard | null>(null);

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
  return (
    <Ctx.Provider value={guard}>
      {children}
      {node}
    </Ctx.Provider>
  );
}

/** Вне карточки ТЗ (или не у завершённого) защита пропускает сразу. */
export function useEditGuard(): Guard {
  return useContext(Ctx) ?? (async () => true);
}
