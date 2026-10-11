"use client";

import { useState, type ReactNode } from "react";
import { useEditGuard } from "./edit-guard";

type Kind = "fur" | "lining" | "expense" | "bulk" | "bom";

/** Одна кнопка «+ Добавить» с выбором: Мех / Подкладка / Расходы (и списание списком, по составу модели). Форма выбранного типа раскрывается под кнопкой. */
export function AddMenu({ fur, lining, expense, bulk, bom }: { fur: ReactNode; lining: ReactNode; expense: ReactNode; bulk: ReactNode; bom?: ReactNode }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [menu, setMenu] = useState(false);
  const guard = useEditGuard();
  const items: { k: Kind; label: string }[] = [
    { k: "fur", label: "Мех (лот)" },
    { k: "lining", label: "Подкладка" },
    { k: "expense", label: "Расходы" },
    { k: "bulk", label: "Мех списком" },
    ...(bom ? [{ k: "bom" as Kind, label: "По составу модели" }] : []),
  ];
  const body = kind === "fur" ? fur : kind === "lining" ? lining : kind === "expense" ? expense : kind === "bulk" ? bulk : kind === "bom" ? bom : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex justify-end">
        <button type="button" aria-expanded={menu} onClick={() => setMenu((v) => !v)} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50">
          + Добавить
        </button>
        {menu ? (
          <div className="absolute right-0 top-full z-10 mt-1 flex w-52 flex-col rounded-md border border-neutral-200 bg-white p-1 shadow">
            {items.map((i) => (
              <button key={i.k} type="button" className="rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-50" onClick={async () => { setMenu(false); if (await guard()) setKind(i.k); }}>
                {i.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {body ? (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-3">
          <div className="mb-2 flex items-center justify-between text-sm font-medium">
            <span>{items.find((i) => i.k === kind)?.label}</span>
            <button type="button" className="text-xs font-normal text-neutral-500 hover:text-neutral-900" onClick={() => setKind(null)}>Закрыть</button>
          </div>
          {body}
        </div>
      ) : null}
    </div>
  );
}
