"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateProducedQuantity, type FormState } from "../actions";

const initialState: FormState = {};

export function ProducedQuantityForm({ orderId, producedQuantity }: { orderId: string; producedQuantity: string }) {
  const bound = updateProducedQuantity.bind(null, orderId);
  const [state, formAction, pending] = useActionState(bound, initialState);

  return (
    <form action={formAction} className="flex items-end gap-2">
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Фактически произведено, шт.</label>
        <Input name="producedQuantity" type="number" step="0.001" min="0" defaultValue={producedQuantity} className="w-40" />
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Сохраняем..." : "Сохранить"}
      </Button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
