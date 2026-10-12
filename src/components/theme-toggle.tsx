"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { applyTheme, parseTheme, THEME_SWITCH_ENABLED, type UiTheme } from "@/lib/ui-theme";
import { cn } from "@/lib/utils";

const ITEMS: { id: UiTheme; label: string }[] = [
  { id: "customer", label: "Привычный стиль" },
  { id: "current", label: "Текущий стиль" },
];

/** Сегмент «Привычный стиль | Текущий стиль»: пишет cookie, сразу меняет data-theme на <html>. */
export function ThemeToggle({ initial, className }: { initial?: UiTheme; className?: string }) {
  const router = useRouter();
  // Начальное значение одинаково на сервере и в браузере (иначе «✓» и aria-pressed расходятся при гидратации); реальная тема подтягивается после монтирования.
  const [theme, setTheme] = useState<UiTheme>(initial ?? "customer");
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { if (!initial) setTheme(parseTheme(document.documentElement.dataset.theme)); }, [initial]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const pick = (t: UiTheme) => {
    if (t === theme) return;
    setTheme(t);
    applyTheme(t);
    router.refresh();
  };
  if (!THEME_SWITCH_ENABLED) return null;
  return (
    <div role="group" aria-label="Стиль оформления" className={cn("flex items-center rounded-md border border-neutral-300 bg-white p-0.5 text-xs", className)}>
      {ITEMS.map((i) => (
        <button key={i.id} type="button" aria-pressed={theme === i.id} onClick={() => pick(i.id)}
          className={cn("whitespace-nowrap rounded-sm px-2 py-1 font-medium transition-colors max-md:min-h-8", theme === i.id ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-neutral-900")}>
          {theme === i.id ? "✓ " : ""}{i.label}
        </button>
      ))}
    </div>
  );
}
