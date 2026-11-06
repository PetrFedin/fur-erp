"use client";

import type { ComponentProps } from "react";
import { useVatDisplay } from "@/lib/vat-display";
import { SeasonReport } from "../sales/season-report";

/** Каталог читает режим НДС шапки (cookie vatDisplay) и меняет его своими кнопками «С НДС / Без НДС» — режим один на весь сайт. */
export function CatalogClient(props: Omit<ComponentProps<typeof SeasonReport>, "ex" | "catalog" | "onVat">) {
  const v = useVatDisplay();
  return <SeasonReport {...props} catalog ex={v.mode === "excl"} onVat={(ex) => v.setMode(ex ? "excl" : "incl")} />;
}
