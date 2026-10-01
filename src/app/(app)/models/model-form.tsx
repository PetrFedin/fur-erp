"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import type { ModelFormState } from "./actions";
import type { ProductModel } from "@prisma/client";

const initialState: ModelFormState = {};

type SerializedModel = Omit<ProductModel, "sellingPrice"> & { sellingPrice: string | null };

export function ModelForm({
  action,
  model,
}: {
  action: (prev: ModelFormState, formData: FormData) => Promise<ModelFormState>;
  model?: SerializedModel;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="sm:col-span-2">
        <Label htmlFor="name">Название модели</Label>
        <Input id="name" name="name" required defaultValue={model?.name} placeholder="Шуба норковая «Милан»" />
      </div>
      <div>
        <Label htmlFor="sku">Артикул</Label>
        <Input id="sku" name="sku" defaultValue={model?.sku ?? ""} />
      </div>
      <div>
        <Label htmlFor="category">Категория</Label>
        <Input id="category" name="category" defaultValue={model?.category ?? ""} placeholder="Шубы" />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="description">Описание</Label>
        <Textarea id="description" name="description" rows={2} defaultValue={model?.description ?? ""} />
      </div>
      {state.error && (
        <p className="sm:col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <div className="sm:col-span-2 flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Сохраняем..." : "Сохранить"}
        </Button>
      </div>
    </form>
  );
}
