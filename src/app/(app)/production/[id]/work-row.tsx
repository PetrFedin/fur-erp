"use client";

import { useState } from "react";
import { Tr, Td } from "@/components/ui/table";
import { Money } from "@/components/money";
import { formatQty } from "@/lib/utils";
import { patchProductionOrder } from "../actions";
import { DraftInput } from "./inline-cell";
import { DraftBar, useDraftEdit } from "./change-window";
import { useDirtyMark } from "./edit-guard";
import { formatMoney } from "@/lib/utils";

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
  const ch = useDraftEdit(orderId);
  const norm = draft.trim().replace(",", ".");
  const dirty = norm !== price.trim();
  useDirtyMark(dirty);
  const cancel = () => { setDraft(price); ch.setError(null); };
  const save = async () => {
    if (!dirty || ch.busy) return;
    await ch.run(
      "Изменить цену работы",
      { kind: "param", field: "clientWorkPricePerUnit", value: norm },
      [{ label: "Работа, ₽ за шт.", before: price ? formatMoney(price) : "—", after: norm ? formatMoney(norm) : "—" }, { label: `Сумма работы (${qtyLabel} × цена)`, before: sum ? formatMoney(sum) : "—", after: norm && Number.isFinite(Number(norm)) ? formatMoney((Number(norm) * Number(qty)).toFixed(2)) : "—" }],
      () => patchProductionOrder(orderId, "clientWorkPricePerUnit", norm),
    );
  };
  const changed = dirty && norm !== "" && Number.isFinite(Number(norm));
  const live = changed ? (Number(norm) * Number(qty)).toFixed(2) : sum;
  return (
    <Tr>
      <Td className="font-medium">Работа заказчику</Td>
      <Td className="text-xs text-neutral-500">цена за шт. × количество ({qtyLabel})</Td>
      <Td className="text-right tabular-nums">{Number(qty) ? formatQty(qty) : <span className="text-neutral-300">—</span>} <span className="text-xs text-neutral-500">шт.</span></Td>
      <Td className="min-w-[8.5rem]">
        <DraftInput value={price} draft={draft} onChange={setDraft} onEnter={save} onEscape={cancel} step="0.01" min="0" align="right" label="Стоимость работ за шт." suffix="₽" readOnly={readOnly} disabled={ch.busy} />
      </Td>
      <Td colSpan={2} className="text-xs text-neutral-400">без НДС и без 4%</Td>
      <Td className="whitespace-nowrap text-right font-medium tabular-nums">
        {live != null ? <Money incl={live} excl={live} /> : <span className="text-neutral-300">—</span>}
        {changed ? <span className="ml-1 text-xs font-normal text-neutral-400" title="Предварительно, до сохранения">~</span> : null}
        <DraftBar dirty={dirty} busy={ch.busy} error={ch.error} onSave={save} onCancel={cancel} />
        {ch.node}
      </Td>
      <Td />
    </Tr>
  );
}
