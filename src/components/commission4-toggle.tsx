"use client";

import { cn } from "@/lib/utils";
import { SEG_GROUP, segCls } from "@/components/segmented";
import { useCommission4Display } from "@/lib/commission4-display";

const HINT =
  "4 % — наценка подрядчику на мех и подкладку в ТЗ. Не комиссия Веллмеха (его 4,5 % за закупку сырья — отдельно). Работа, расходы и фурнитура не облагаются; закупки, оплаты и долги не меняются.";

/** Переключатель «Без 4% | С 4%» в шапке, рядом с «С НДС / Без НДС». По умолчанию включено «С 4%». */
export function Commission4Toggle() {
  return <Commission4ToggleLegacy />;
}

function Commission4ToggleLegacy() {
  const { mode, setMode, pending } = useCommission4Display();
  const btn = (m: "off" | "on", text: string) => (
    <button
      type="button"
      onClick={() => mode !== m && setMode(m)}
      aria-pressed={mode === m}
      className={segCls(mode === m, "sm")}
    >
      {text}
    </button>
  );
  return (
    <div
      title={HINT}
      className={cn(SEG_GROUP, pending && "opacity-70")}
    >
      {btn("off", "Без 4 %")}
      {btn("on", "С 4 %")}
    </div>
  );
}
