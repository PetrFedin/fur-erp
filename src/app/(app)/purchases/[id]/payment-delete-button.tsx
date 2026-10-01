"use client";

import { Button } from "@/components/ui/button";

/** Кнопка «Удалить» оплаты закупки: спрашивает подтверждение, потом вызывает server action. */
export function PaymentDeleteButton({ action, amountLabel }: { action: () => Promise<void>; amountLabel: string }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Удалить оплату ${amountLabel}? Это изменит «Оплачено» и остаток закупки; прикреплённые к оплате документы Google Drive тоже будут удалены (сами файлы на Диске останутся).`)) e.preventDefault();
      }}
    >
      <Button type="submit" variant="outline" size="sm" className="max-md:h-10">
        Удалить
      </Button>
    </form>
  );
}
