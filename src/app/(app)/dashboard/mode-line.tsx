"use client";

import { useVatDisplay } from "@/lib/vat-display";

/** Что именно показано в блоке: «Показано: все годы · с НДС · с 4% · фильтры: …». Цифры берут режимы шапки; где режим цифру не меняет — так и написано. */
export type ModeInfo = {
  year: string;
  /** Текст активных фильтров («мех ×1, НДС ×1») либо null, если фильтров нет. */
  filters: string | null;
};

export function ModeLine({ info, c4, vat = "switch", filters = "apply", className = "" }: {
  info: ModeInfo;
  /** "on" | "off" — режим 4% меняет цифры блока; "na" — не меняет. */
  c4: "on" | "off" | "na";
  /** "switch" — следует за «С НДС / Без НДС»; "incl" — всегда с НДС. */
  vat?: "switch" | "incl";
  /** "apply" — фильтры сужают блок; "ignore" — не зависит от фильтров. */
  filters?: "apply" | "ignore";
  className?: string;
}) {
  const { mode } = useVatDisplay();
  const parts: React.ReactNode[] = [info.year];
  parts.push(vat === "incl" ? "всегда с НДС" : mode === "incl" ? "с НДС" : "без НДС");
  parts.push(c4 === "na" ? "4% не влияет" : c4 === "on" ? "с 4%" : "без 4%");
  if (filters === "ignore") parts.push("не зависит от фильтров Сводки");
  else if (info.filters) parts.push(<b key="f" className="font-medium text-amber-700">фильтры: {info.filters}</b>);
  return (
    <span className={"text-xs text-neutral-500 " + className} data-testid="mode-line">
      Показано: {parts.map((p, i) => <span key={i}>{i > 0 ? " · " : ""}{p}</span>)}
    </span>
  );
}

/** Компактная заметка с «≠» / «=» под блоком. */
export function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
  return (
    <p className={"rounded-md border px-3 py-1.5 text-[11px] leading-4 " + (tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-neutral-200 bg-neutral-50 text-neutral-600")}>{children}</p>
  );
}
