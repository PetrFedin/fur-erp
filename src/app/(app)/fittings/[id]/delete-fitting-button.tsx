"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";

export function DeleteFittingButton({ action, photoCount }: { action: () => Promise<void>; photoCount: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        const msg =
          photoCount > 0
            ? `Удалить примерку целиком вместе с фото (${photoCount})? Файлы будут удалены без возможности восстановления.`
            : "Удалить примерку?";
        if (confirm(msg)) startTransition(() => action());
      }}
    >
      Удалить примерку
    </Button>
  );
}
