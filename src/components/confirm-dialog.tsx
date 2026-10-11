"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Ask = { text: string; ok: string; danger: boolean; resolve: (v: boolean) => void };

/**
 * Подтверждение действия окном приложения (вместо window.confirm, который в ряде браузеров и панелей отклоняется).
 * const { ask, node } = useConfirm(); ... if (!(await ask("Удалить?", { ok: "Удалить", danger: true }))) return; ... {node}
 */
export function useConfirm(): { ask: (text: string, opts?: { ok?: string; danger?: boolean }) => Promise<boolean>; node: ReactNode } {
  const [state, setState] = useState<Ask | null>(null);
  const ask = useCallback(
    (text: string, opts?: { ok?: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) => setState({ text, ok: opts?.ok ?? "Подтвердить", danger: opts?.danger ?? false, resolve })),
    [],
  );
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return { ask, node: state ? <ConfirmBox state={state} onClose={close} /> : null };
}

function ConfirmBox({ state, onClose }: { state: Ask; onClose: (v: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label="Подтверждение"
      onCancel={(e) => {
        e.preventDefault();
        onClose(false);
      }}
      className="m-auto w-[calc(100vw-2rem)] max-w-sm rounded-xl border border-neutral-200 bg-white p-4 text-left text-sm shadow-xl backdrop:bg-black/40"
    >
      <p className="mb-3">{state.text}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onClose(false)}>Отмена</Button>
        <Button type="button" size="sm" className={state.danger ? "bg-red-600 text-white hover:bg-red-700" : undefined} onClick={() => onClose(true)}>{state.ok}</Button>
      </div>
    </dialog>
  );
}
