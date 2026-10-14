"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useKeepingForm } from "@/lib/use-keeping-form";
import { useConfirm } from "@/components/confirm-dialog";
import { IconPencil } from "@/components/icons";

/**
 * Единый паттерн правки записи: кнопка «Изменить» → форма в модальном окне → «Сохранить» / «Отмена».
 *  • введённое не пропадает при ошибке сервера (useKeepingForm);
 *  • версия записи `_v` уходит скрытым полем: если запись успели изменить, сервер вернёт понятную ошибку (src/lib/concurrency.ts);
 *  • сервер может вернуть { confirm } (например, переплата) — спросим и отправим повторно с confirmOverpay=1;
 *  • после успеха окно закрывается, страница обновляется самим server action (revalidatePath).
 * Поля формы — children (обычные input/select с name).
 */
export type EditResult = { error?: string; ok?: boolean; confirm?: string } | void | undefined;

type Props = {
  title: string;
  action: (formData: FormData) => Promise<EditResult>;
  children: ReactNode;
  /** Подпись кнопки-открывашки. */
  label?: string;
  /** Внешний вид кнопки-открывашки. */
  variant?: "ghost" | "outline" | "default";
  /** Версия записи на момент отрисовки страницы. */
  version?: string;
  /** Пояснение под заголовком (что произойдёт при сохранении, что заблокировано). */
  hint?: ReactNode;
  saveLabel?: string;
  className?: string;
  /** Вызывается после успешного сохранения (например, перейти по новому адресу). */
  onSaved?: () => void;
  /** Ширина окна. */
  wide?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** Управляемый режим: окном управляет вызывающий (кнопки-открывашки нет), например «Отметить выполненным» → сразу правка. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function EditDialog(props: Props) {
  const [open, setOpen] = useState(false);
  if (props.open !== undefined) {
    return props.open ? <EditDialogBody {...props} onClose={() => props.onOpenChange?.(false)} /> : null;
  }
  const { label = "Изменить", variant = "ghost", className, disabled, disabledReason } = props;
  const isEdit = /^(Изменить|Править|Редактировать)$/.test(label);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size="sm"
        className={className ?? "max-md:h-10"}
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? disabledReason : isEdit ? label : undefined}
        aria-label={isEdit ? label : undefined}
      >
        {isEdit ? <IconPencil /> : label}
      </Button>
      {open && <EditDialogBody {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

type State = { error?: string; ok?: boolean };

function EditDialogBody({ title, action, children, version, hint, saveLabel = "Сохранить", onSaved, wide, onClose }: Props & { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(async (_prev: State, fd: FormData): Promise<State> => {
    try {
      let res = (await action(fd)) ?? {};
      if (res.confirm) {
        if (!window.confirm(res.confirm)) return {};
        fd.set("confirmOverpay", "1");
        res = (await action(fd)) ?? {};
      }
      if (res.error) return { error: res.error };
      return { ok: true };
    } catch {
      return { error: "Не удалось сохранить: сервер отклонил запрос или пропала связь. Введённое сохранено — попробуйте ещё раз." };
    }
  }, {});
  const { setForm: keepRef, onSubmit: keepSubmit } = useKeepingForm(formAction, state, pending);
  const [dirty, setDirty] = useState(false);
  const { ask, node: confirmNode } = useConfirm();
  /** Закрыть окно; если поля изменены и не сохранены — сначала спросить. */
  const tryClose = async () => {
    if (pending) return;
    if (dirty && !(await ask("Закрыть без сохранения? Внесённые изменения пропадут.", { ok: "Закрыть", danger: true }))) return;
    ref.current?.close();
  };

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => {
    if (state.ok) {
      onSaved?.();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        // Esc: закрываем сами (с вопросом, если есть несохранённое)
        e.preventDefault();
        void tryClose();
      }}
      onClick={(e) => {
        // клик по затемнению вне окна
        if (e.target === ref.current) void tryClose();
      }}
      className={`m-auto w-[calc(100vw-2rem)] ${wide ? "max-w-2xl" : "max-w-lg"} rounded-xl border border-neutral-200 bg-white p-0 text-left shadow-xl backdrop:bg-black/40`}
    >
      <form ref={keepRef} onSubmit={keepSubmit} onChange={() => setDirty(true)} className="flex max-h-[85vh] flex-col">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
          {hint && <div className="mt-1 text-xs text-neutral-500">{hint}</div>}
        </div>
        <div className="grid grid-cols-1 gap-3 overflow-y-auto px-4 py-3 sm:grid-cols-2">
          {version && <input type="hidden" name="_v" value={version} />}
          {children}
        </div>
        {state.error && (
          <p role="alert" className="mx-4 mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-neutral-200 px-4 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => void tryClose()} disabled={pending}>
            Отмена
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Сохраняем…" : saveLabel}
          </Button>
        </div>
      </form>
      {confirmNode}
    </dialog>
  );
}

/** Подпись + поле на всю ширину или в одну колонку. */
export function Field({ label, children, wide, hint }: { label: string; children: ReactNode; wide?: boolean; hint?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-neutral-500 ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      {children}
      {hint && <span className="text-[11px] text-neutral-500">{hint}</span>}
    </label>
  );
}
