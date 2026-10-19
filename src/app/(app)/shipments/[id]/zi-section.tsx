import type { ZiSupply } from "@/lib/shipment-zi";

/** Поставки ЦУМ (накладные ЗИ) — свёрнутый список под итоговой таблицей «Приёмка». */
export function ZiSupplies({ supplies, unmatched }: { supplies: ZiSupply[]; unmatched: number }) {
  return (
    <details className="rounded-lg border border-neutral-200 bg-white p-3" data-zi>
      <summary className="cursor-pointer text-sm font-semibold text-neutral-900 max-md:min-h-11">Накладные ЦУМ (ЗИ) по поставкам</summary>
      <div className="mt-2 flex flex-col gap-2">
        <ul className="flex flex-col gap-1 text-xs text-neutral-600">
          {supplies.map((s) => (
            <li key={s.code}><span className="font-medium text-neutral-800">Поставка {s.code}</span> · ЗИ {s.ziNumbers.join(", ")} · файл от {s.savedOn.split("-").reverse().join(".")}</li>
          ))}
        </ul>
        {unmatched > 0 && <p className="text-xs text-amber-800">В накладных есть {unmatched} шт., которых нет в составе отгрузки (артикул/размер не совпали) — проверьте состав.</p>}
      </div>
    </details>
  );
}
