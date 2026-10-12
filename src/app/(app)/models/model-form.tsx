"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import type { ModelFormState } from "./actions";
import type { ProductModel } from "@prisma/client";
import { useKeepingForm } from "@/lib/use-keeping-form";
import { CategorySelect, type CategorySelectOption } from "@/components/category-select";

const initialState: ModelFormState = {};

type SerializedModel = Omit<ProductModel, "sellingPrice"> & { sellingPrice: string | null };

export function ModelForm({
  action,
  model,
  version,
  categories = [],
  canCreateCategory = false,
}: {
  /** Версия записи на момент открытия формы (защита от тихой перезаписи чужой правки). */
  version?: string;
  action: (prev: ModelFormState, formData: FormData) => Promise<ModelFormState>;
  model?: SerializedModel;
  /** Категории справочника (выбор вместо свободного текста). */
  categories?: CategorySelectOption[];
  canCreateCategory?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const { setForm: keepRef, onSubmit: keepSubmit } = useKeepingForm(formAction, state, pending);

  return (
    <form ref={keepRef} onSubmit={keepSubmit} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {version && <input type="hidden" name="_v" value={version} />}
      <div className="col-span-full">
        <Label htmlFor="name">Название модели</Label>
        <Input className="ui-field rounded-lg" id="name" name="name" required defaultValue={model?.name} placeholder="Шуба норковая «Милан»" />
      </div>
      <div>
        <Label htmlFor="sku">Артикул</Label>
        <Input className="ui-field rounded-lg" id="sku" name="sku" defaultValue={model?.sku ?? ""} />
      </div>
      <div>
        <Label htmlFor="category">Категория</Label>
        <CategorySelect id="category" refs={categories} defaultValue={model?.category ?? ""} defaultRefId={model?.categoryRefId ?? null} canCreate={canCreateCategory} placeholder="Пальто" />
      </div>
      <div className="col-span-full">
        <Label htmlFor="description">Описание</Label>
        <Textarea className="ui-field rounded-lg" id="description" name="description" rows={2} defaultValue={model?.description ?? ""} />
      </div>
      {state.error && (
        <p className="col-span-full rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <div className="col-span-full flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Сохраняем..." : "Сохранить"}
        </Button>
      </div>
    </form>
  );
}
