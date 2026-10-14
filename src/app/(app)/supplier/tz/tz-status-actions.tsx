"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { copyTzAsDraft, reopenSentTz } from "./actions";

/** Кнопки правки на странице ТЗ: отправленное — вернуть в черновик; принятое/отклонённое — исправленная копия. */
export function TzStatusActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  if (status !== "SENT" && status !== "ACCEPTED" && status !== "REJECTED") return null;
  const sent = status === "SENT";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" disabled={pending} onClick={() => start(async () => {
        const r = sent ? await reopenSentTz(id) : await copyTzAsDraft(id);
        if (r.error) setErr(r.error);
        else if (sent) router.refresh();
        else router.push(`/supplier/tz/${r.id}`);
      })}>{sent ? "Вернуть в черновик и исправить" : "Исправить и отправить заново"}</Button>
      <span className="text-sm text-neutral-600">{sent ? "Пока мы не приняли ТЗ, его можно поправить; у нас будет видно, что оно изменено." : "Создаст новый черновик с теми же данными — исходное ТЗ останется."}</span>
      {err && <span className="text-sm text-red-700">{err}</span>}
    </div>
  );
}
