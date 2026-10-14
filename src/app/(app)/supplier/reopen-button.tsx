"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { reopenRejected } from "./reopen-action";

export function ReopenButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          const r = await reopenRejected(id);
          if (r.error) setErr(r.error);
          else router.refresh();
        })}
      >
        Исправить и отправить заново
      </Button>
      <span className="text-sm text-neutral-600">Вернёт в черновик с теми же данными — исправьте и отправьте снова.</span>
      {err && <span className="text-sm text-red-700">{err}</span>}
    </div>
  );
}
