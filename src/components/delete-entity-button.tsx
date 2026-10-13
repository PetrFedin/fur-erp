"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";

/**
 * Единая кнопка «Удалить» записи: подтверждение окном приложения, действие на сервере, понятная ошибка.
 * Если удалять нельзя (на запись есть ссылки) — передайте `blockedReason`: кнопка неактивна, причина в подсказке и под кнопкой.
 * `redirectTo` — куда перейти после удаления (карточка исчезла); без него страница просто обновится.
 */
export function DeleteEntityButton({
  label = "Удалить",
  confirmText,
  action,
  blockedReason,
  redirectTo,
  variant = "outline",
  className,
  showReason = true,
}: {
  label?: string;
  confirmText: string;
  action: () => Promise<{ error?: string } | void>;
  blockedReason?: string | null;
  redirectTo?: string;
  variant?: "outline" | "destructive" | "ghost";
  className?: string;
  showReason?: boolean;
}) {
  const router = useRouter();
  const { ask, node } = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={variant}
        size="sm"
        className={className}
        disabled={pending || !!blockedReason}
        title={blockedReason ?? undefined}
        onClick={async () => {
          setError(null);
          if (!(await ask(confirmText, { ok: label, danger: true }))) return;
          start(async () => {
            const r = await action();
            if (r && r.error) {
              setError(r.error);
              return;
            }
            if (redirectTo) router.replace(redirectTo);
            else router.refresh();
          });
        }}
      >
        {pending ? "Удаляем…" : label}
      </Button>
      {blockedReason && showReason && <span className="max-w-xs text-xs text-neutral-500">{blockedReason}</span>}
      {error && <span role="alert" className="max-w-xs text-xs text-red-600">{error}</span>}
      {node}
    </span>
  );
}
