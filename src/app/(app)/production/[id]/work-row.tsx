"use client";

import { useState } from "react";
import { Tr, Td } from "@/components/ui/table";
import { Money } from "@/components/money";
import { formatQty } from "@/lib/utils";
import { patchProductionOrder } from "../actions";
import { TextCell } from "./inline-cell";

/**
 * Строка «Работа заказчику» таблицы «Расчёт и списание»: цена за штуку правится по месту, сумма = цена × количество пересчитывается сразу.
 * Работа входит в себестоимость ТЗ, но не облагается НДС и 4%.
 */
export function WorkRow({
  orderId,
  price,
  qty,
  qtyLabel,
  sum,
  readOnly,
}: {
  orderId: string;
  price: string;
  qty: string;
  qtyLabel: string;
  sum: string | null;
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState(price);
  const [seen, setSeen] = useState(price);
  if (seen !== price) {
    setSeen(price);
    setDraft(price);
  }
  const changed = draft.trim() !== price.trim() && draft.trim() !== "" && Number.isFinite(Number(draft));
  const live = changed ? (Number(draft) * Number(qty)).toFixed(2) : sum;
  return (
    <Tr>
      <Td className="font-medium">Работа заказчику</Td>
      <Td className="text-xs text-neutral-500">цена за шт. × количество ({qtyLabel})</Td>
      <Td className="text-right tabular-nums">{Number(qty) ? formatQty(qty) : <span className="text-neutral-300">—</span>} <span className="text-xs text-neutral-500">шт.</span></Td>
      <Td className="min-w-[8.5rem]">
        <TextCell value={price} type="number" step="0.01" min="0" align="right" label="Стоимость работ за шт." suffix="₽" readOnly={readOnly} onDraft={setDraft} onSave={(v) => patchProductionOrder(orderId, "clientWorkPricePerUnit", v)} />
      </Td>
      <Td colSpan={2} className="text-xs text-neutral-400">без НДС и без 4%</Td>
      <Td className="whitespace-nowrap text-right font-medium tabular-nums">
        {live != null ? <Money incl={live} excl={live} /> : <span className="text-neutral-300">—</span>}
        {changed ? <span className="ml-1 text-xs font-normal text-neutral-400" title="Предварительно, до сохранения">~</span> : null}
      </Td>
      <Td />
    </Tr>
  );
}
