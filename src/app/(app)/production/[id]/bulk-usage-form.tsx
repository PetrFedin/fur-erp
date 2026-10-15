"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { addMaterialUsagesBulk, type BulkUsageState } from "../actions";
import { useKeepingForm } from "@/lib/use-keeping-form";

const initialState: BulkUsageState = {};

export function BulkUsageForm({ orderId, defaultCommission4 = true }: { orderId: string; defaultCommission4?: boolean }) {
  const [open, setOpen] = useState(false);
  // Controlled: React 19 resets uncontrolled fields after a server action,
  // which would wipe the paste when an error comes back.
  const [text, setText] = useState("");
  const bound = addMaterialUsagesBulk.bind(null, orderId);
  const [state, formAction, pending] = useActionState(async (prev: BulkUsageState, fd: FormData) => {
    const result = await bound(prev, fd);
    if (result.created !== undefined) setText("");
    return result;
  }, initialState);
  const { setForm: keepRef, onSubmit: keepSubmit } = useKeepingForm(formAction, state, pending);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-left text-xs text-neutral-500 hover:underline max-md:min-h-8">
        Списать сразу несколько лотов из таблицы →
      </button>
    );
  }

  return (
    <div className="rounded-md border border-dashed border-neutral-300 p-3">
      <p className="mb-2 text-xs text-neutral-500">
        Строки «Лот [Tab] Количество», по одной на лот (разделитель — Tab, «;» или пробел). Одна неверная строка — не
        спишется ничего.
      </p>
      <form ref={keepRef} onSubmit={keepSubmit} className="flex flex-col gap-2">
        <Textarea
          name="rows"
          rows={5}
          placeholder={"15874\t21\n15893\t10\n..."}
          className="font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
<label className="flex items-center gap-2 text-xs text-neutral-600 max-md:min-h-8 max-md:py-1" title="4% — наценка подрядчику на мех и подкладку в ТЗ. Не комиссия Веллмеха (его 4,5% за закупку сырья — отдельно). Работа, расходы и фурнитура не облагаются">
        <input type="hidden" name="c4form" value="1" />
        <input type="checkbox" name="commission4" defaultChecked={defaultCommission4} className="h-4 w-4 max-md:h-5 max-md:w-5" />
        Начислять 4%
      </label>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? "Списываем..." : "Списать все строки"}
          </Button>
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-neutral-500 hover:underline">
            Скрыть
          </button>
          {state.created !== undefined && (
            <span className="text-xs text-emerald-700">Списано позиций: {state.created}</span>
          )}
        </div>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.errors && state.errors.length > 0 && (
          <ul className="list-disc rounded-md bg-red-50 px-6 py-2 text-sm text-red-700">
            {state.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </form>
    </div>
  );
}
