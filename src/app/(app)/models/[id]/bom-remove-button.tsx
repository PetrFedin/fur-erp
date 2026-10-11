"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { removeBomLine } from "../actions";

/** «Удалить» строку нормы расхода: подтверждение окном приложения, после записи страница пересчитывается. */
export function BomRemoveButton({ modelId, lineId, name }: { modelId: string; lineId: string; name: string }) {
  const { ask, node } = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={async () => {
          if (!(await ask(`Убрать «${name}» из нормы расхода? Уже созданные ТЗ не изменятся.`, { ok: "Убрать", danger: true }))) return;
          setError(null);
          start(async () => {
            try { await removeBomLine(modelId, lineId); } catch { setError("Не удалось убрать строку"); }
          });
        }}
      >
        {pending ? "Убираю…" : "Удалить"}
      </Button>
      {error ? <span role="alert" className="ml-2 text-xs text-red-600">{error}</span> : null}
      {node}
    </>
  );
}
