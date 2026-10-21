"use client";

import { SEG_GROUP, segCls } from "@/components/segmented";

// Переключатель иерархии таблиц Главной: одни и те же две подписи везде («Продажи и остатки», «Объёмы по группам меха и категориям»,
// «Среднее на изделие»). Ставится справа в строке заголовка таблицы.
export type Hier = "fur" | "cls";
export const HIER_LABEL: Record<Hier, string> = { fur: "Тип меха → кат. 1 → кат. 2", cls: "Кат. 1 → кат. 2 → тип меха" };

export function HierSwitch({ value, onChange, className }: { value: Hier; onChange: (h: Hier) => void; className?: string }) {
  return (
    <div role="group" aria-label="Иерархия строк" className={SEG_GROUP + " print:hidden" + (className ? " " + className : "")}>
      {(["fur", "cls"] as const).map((h) => <button key={h} type="button" aria-pressed={value === h} onClick={() => onChange(h)} className={segCls(value === h, "sm")}>{HIER_LABEL[h]}</button>)}
    </div>
  );
}
