"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateProducedQuantity, type FormState } from "../actions";
import { useKeepingForm } from "@/lib/use-keeping-form";

const initialState: FormState = {};

export function ProducedQuantityForm({ orderId, producedQuantity }: { orderId: string; producedQuantity: string }) {
  const bound = updateProducedQuantity.bind(null, orderId);
  const [state, formAction, pending] = useActionState(bound, initialState);
  const { setForm: keepRef, onSubmit: keepSubmit } = useKeepingForm(formAction, state, pending);

  return (
    <form ref={keepRef} onSubmit={keepSubmit} className="flex flex-wrap items-center gap-2">
      <label className="text-sm text-neutral-600" htmlFor="producedQuantity">
        Фактически произведено, шт.
      </label>
      <Input
        id="producedQuantity"
        name="producedQuantity"
        type="number"
        step="0.001"
        min="0"
        defaultValue={producedQuantity}
        className="w-24"
      />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Сохраняем..." : "Сохранить"}
      </Button>
      {state.error && <span className="text-sm text-red-600">{state.error}</span>}
    </form>
  );
}
