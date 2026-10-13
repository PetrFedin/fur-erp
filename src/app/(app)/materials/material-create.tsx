import type { RawMaterialCategory } from "@prisma/client";
import { MaterialForm } from "./material-form";
import { CategoryQuickAdd } from "./category-quick-add";
import { createMaterial } from "./actions";

/** Содержимое окна «Новый материал»: форма и быстрое добавление категории. */
export function MaterialCreate({ categories, defaultUnit }: { categories: RawMaterialCategory[]; defaultUnit?: string }) {
  return (
    <div className="flex flex-col gap-4">
      <MaterialForm action={createMaterial} categories={categories} defaultUnit={defaultUnit} />
      <details className="rounded-md border border-neutral-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Добавить категорию</summary>
        <div className="border-t border-neutral-100 p-3">
          <CategoryQuickAdd />
        </div>
      </details>
    </div>
  );
}
