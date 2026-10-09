"use client";

import { Button } from "@/components/ui/button";

/** Кнопка отправки формы с подтверждением. */
export function ConfirmSubmitButton({
  message,
  label = "Удалить",
  variant = "ghost",
  className,
}: {
  message: string;
  label?: string;
  variant?: "ghost" | "outline" | "destructive";
  className?: string;
}) {
  return (
    <Button
      type="submit"
      variant={variant}
      size="sm"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {label}
    </Button>
  );
}
