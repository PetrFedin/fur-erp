"use client";

import { InfoHint } from "@/components/info-hint";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { makeFinalCalc } from "./actions";

export function FinalButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      <Button type="button" variant="outline" disabled={pending} onClick={() => start(async () => {
        const r = await makeFinalCalc(id);
        if (r.error) setErr(r.error); else router.push(`/supplier/auction-calcs/${r.id}`);
      })}>Сделать окончательный расчёт</Button>
      <InfoHint label="Что произойдёт">Создаст копию для ввода окончательных цифр; предварительный останется как был.</InfoHint>
      {err && <span className="text-sm text-red-600">{err}</span>}
    </div>
  );
}
