import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createCategory } from "./actions";

export function CategoryQuickAdd() {
  return (
    <form action={createCategory} className="flex items-end gap-2">
      <div className="flex-1">
        <label htmlFor="categoryName" className="mb-1 block text-xs text-neutral-500">
          Добавить категорию сырья (например «Норка», «Лиса», «Кролик»)
        </label>
        <Input id="categoryName" name="categoryName" placeholder="Название категории" />
      </div>
      <Button type="submit" variant="outline" size="sm">
        Добавить
      </Button>
    </form>
  );
}
