"use client";

import { Button } from "@/components/ui/button";

export function RemovePaymentButton({
  action,
  summary,
}: {
  action: () => Promise<void>;
  /** e.g. "10 000,00 ₽ от 01.10.2026" — shown in the confirmation. */
  summary: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Удалить оплату ${summary}? Она исчезнет из расчётов по всем ТЗ, которые покрывает.`)) {
          e.preventDefault();
        }
      }}
    >
      <Button type="submit" variant="ghost" size="sm">
        Удалить
      </Button>
    </form>
  );
}
