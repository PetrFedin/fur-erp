"use client";

/**
 * Показ сумм всегда «С НДС»: переключателя «Без НДС» нет, остаётся включённая метка в шапке.
 */
export function VatToggle() {
  return (
    <div
      title="Все суммы показаны с НДС."
      className="flex items-center rounded-md border border-neutral-300 bg-white p-0.5 text-xs">
      <span className="rounded-sm bg-neutral-900 px-2 py-1 font-medium text-white max-md:min-h-8" aria-pressed="true">С НДС</span>
    </div>
  );
}
