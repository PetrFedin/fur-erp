"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useKeepingForm } from "@/lib/use-keeping-form";

/**
 * Окно создания записи поверх страницы: кнопка → модальный <dialog> с формой.
 * Форма внутри (children) берёт close/inDialog через useCreateDialog() и useCreateForm().
 * `defaultOpen` — окно открыто сразу (адрес вида /список?new=1); при закрытии параметр new убирается из адреса.
 */
type Ctx = { close: () => void };
const DialogCtx = createContext<Ctx | null>(null);
export const useCreateDialog = () => useContext(DialogCtx);

export function CreateDialog({
  label,
  title,
  children,
  hint,
  wide,
  defaultOpen,
  variant = "default",
  size,
}: {
  label: string;
  title: string;
  children: ReactNode;
  hint?: ReactNode;
  wide?: boolean;
  defaultOpen?: boolean;
  variant?: "default" | "outline" | "ghost";
  size?: "sm";
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        <Body title={title} hint={hint} wide={wide} onClose={() => {
          setOpen(false);
          try {
            const u = new URL(window.location.href);
            if (u.searchParams.has("new")) {
              u.searchParams.delete("new");
              u.searchParams.delete("unit");
              window.history.replaceState(null, "", u.pathname + u.search + u.hash);
            }
          } catch {
            /* адрес не критичен */
          }
        }}>
          {children}
        </Body>
      )}
    </>
  );
}

function Body({ title, hint, wide, children, onClose }: { title: string; hint?: ReactNode; wide?: boolean; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={`m-auto w-[calc(100vw-2rem)] ${wide ? "max-w-3xl" : "max-w-2xl"} rounded-xl border border-neutral-200 bg-white p-0 text-left shadow-xl backdrop:bg-black/40`}
    >
      <div className="max-h-[88vh] overflow-y-auto">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
          {hint && <div className="mt-1 text-xs text-neutral-500">{hint}</div>}
        </div>
        <div className="px-4 py-3">
          <DialogCtx.Provider value={{ close: () => ref.current?.close() }}>{children}</DialogCtx.Provider>
        </div>
      </div>
    </dialog>
  );
}

type FormState = { error?: string; ok?: boolean };

/**
 * Состояние формы создания: ошибка не стирает введённое; «Сохранить» закрывает окно,
 * «Сохранить и добавить ещё» (кнопка name="_more") оставляет его и очищает форму (или только поля `clearNames`).
 */
export function useCreateForm(
  action: (prev: FormState, fd: FormData) => Promise<FormState>,
  initial: FormState,
  clearNames?: string[],
) {
  const dlg = useCreateDialog();
  const [state, formAction, pending] = useActionState(action, initial);
  const keep = useKeepingForm(formAction, state, pending);
  const more = useRef(false);
  const node = useRef<HTMLFormElement | null>(null);
  const [saved, setSaved] = useState(0);

  useEffect(() => {
    if (!state.ok) return;
    if (more.current) {
      const f = node.current;
      if (f) {
        if (clearNames) {
          for (const n of clearNames) {
            const el = f.elements.namedItem(n);
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.value = "";
          }
        } else f.reset();
      }
      setSaved((n) => n + 1);
    } else dlg?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return {
    state,
    pending,
    saved,
    dlg,
    setForm: (el: HTMLFormElement | null) => {
      node.current = el;
      keep.setForm(el);
    },
    onSubmit: (e: FormEvent<HTMLFormElement>) => {
      const s = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
      more.current = s?.name === "_more";
      keep.onSubmit(e);
    },
  };
}

/** Нижняя строка формы в окне: «Отмена», «Сохранить и добавить ещё» (если withMore), «Сохранить». */
export function DialogButtons({
  pending,
  withMore,
  saveLabel = "Сохранить",
  saved,
  onCancel,
}: {
  pending: boolean;
  withMore?: boolean;
  saveLabel?: string;
  saved?: number;
  onCancel?: () => void;
}) {
  return (
    <div className="col-span-full flex flex-wrap items-center justify-end gap-2">
      {saved ? <span className="mr-auto text-xs text-emerald-700">Добавлено: {saved}</span> : null}
      {/* В DOM «Сохранить» раньше «Сохранить и добавить ещё»: Enter в поле отправляет обычное сохранение; порядок на экране задаёт order. */}
      {onCancel && (
        <Button type="button" variant="ghost" className="order-1" onClick={onCancel} disabled={pending}>
          Отмена
        </Button>
      )}
      <Button type="submit" className="order-3" disabled={pending}>
        {pending ? "Сохраняем…" : saveLabel}
      </Button>
      {withMore && (
        <Button type="submit" name="_more" value="1" variant="outline" className="order-2" disabled={pending}>
          Сохранить и добавить ещё
        </Button>
      )}
    </div>
  );
}
