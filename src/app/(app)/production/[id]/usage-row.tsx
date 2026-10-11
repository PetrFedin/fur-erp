"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Tr, Td } from "@/components/ui/table";
import { formatQty } from "@/lib/utils";
import { Money } from "@/components/money";
import { useConfirm } from "@/components/confirm-dialog";
import { CostBreakdownToggle } from "../../lots/cost-breakdown-toggle";
import type { FormState } from "../actions";
import { SelectCell, TextCell } from "./inline-cell";
import { useEditGuard } from "./edit-guard";

// Варианты лотов для выпадающего списка правки должны включать и лоты с нулевым остатком: собственный лот списания
// часто выбран этим же списанием целиком. updateMaterialUsage сначала возвращает старое количество в лот, затем списывает новое.
export type EditableLotOption = {
  id: string;
  lotNumber: string | null;
  grade: string | null;
  color: string | null;
  rawMaterialId: string;
  rawMaterialName: string;
  unit: string;
  quantityRemaining: string;
  unitCost: string;
};

const UNIT_LABELS: Record<string, string> = { PIECE: "шт.", KG: "кг", M2: "м²", M: "м", SET: "компл." };

export type UsageRowData = {
  id: string;
  rawMaterialName: string;
  lotId: string;
  lotNumber: string | null;
  purchaseId: string | null;
  purchaseNumber: string | null;
  quantity: string;
  unit: string;
  /** Цена за единицу с НДС и 4% (по режиму) — для живого пересчёта суммы при вводе. */
  unitIncl: string;
  unitExcl: string;
  lotCostExclVat: string;
  lotVatRate: string;
  /** Эффективная ставка строки (своя, иначе лота). */
  vatRate: string;
  /** Ставка задана на строке (отличается от лота). */
  vatOwn: boolean;
  c4Mode: "off" | "on";
  commission4: boolean;
  totalCost: string;
  totalCostExclVat: string;
  costBreakdown: unknown;
  lotUnitCostExcl: string;
  lotUnitCostIncl: string;
};

/**
 * Строка списания в таблице «Расчёт и списание»: лот, количество и «4%» правятся по месту (Enter / уход фокуса),
 * сумма пересчитывается сразу при вводе и окончательно — после сохранения. Цена и НДС — свойства лота (закупки): ссылка ведёт в закупку.
 */
export function UsageRow({
  usage,
  lots,
  updateAction,
  vatAction,
  removeAction,
  readOnly = false,
}: {
  usage: UsageRowData;
  lots: EditableLotOption[];
  updateAction: (formData: FormData) => Promise<FormState>;
  vatAction: (formData: FormData) => Promise<FormState>;
  removeAction: () => Promise<void>;
  readOnly?: boolean;
}) {
  const [qty, setQty] = useState(usage.quantity);
  const [seenQty, setSeenQty] = useState(usage.quantity);
  if (seenQty !== usage.quantity) {
    setSeenQty(usage.quantity);
    setQty(usage.quantity);
  }
  const [busy, startBusy] = useTransition();
  const [c4Error, setC4Error] = useState<string | null>(null);
  const { ask, node } = useConfirm();
  const guard = useEditGuard();
  const unit = UNIT_LABELS[usage.unit] ?? usage.unit;

  const build = (patch: { lotId?: string; quantity?: string; commission4?: boolean }) => {
    const fd = new FormData();
    fd.set("lotId", patch.lotId ?? usage.lotId);
    fd.set("quantity", patch.quantity ?? usage.quantity);
    fd.set("c4form", "1");
    if (patch.commission4 ?? usage.commission4) fd.set("commission4", "on");
    return fd;
  };
  const dirty = qty.trim() !== usage.quantity.trim() && qty.trim() !== "" && Number.isFinite(Number(qty));
  const live = (unitPrice: string) => (Number(qty) * Number(unitPrice)).toFixed(2);

  return (
    <Tr>
      <Td className="min-w-[13rem]">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <SelectCell
              value={usage.lotId}
              label="Лот"
              readOnly={readOnly}
              options={lots.map((l) => ({
                value: l.id,
                label: `${l.lotNumber ?? "без номера"} · ${l.rawMaterialName}${[l.grade, l.color].filter(Boolean).length ? ` (${[l.grade, l.color].filter(Boolean).join(", ")})` : ""} · ост. ${formatQty(l.quantityRemaining)}`,
              }))}
              onSave={(v) => updateAction(build({ lotId: v }))}
            />
          </div>
          <Link href={`/analytics/raw/lot/${usage.lotId}`} className="shrink-0 text-xs text-blue-700 hover:underline" title="Карточка лота: закупка, где ещё использован, остаток">
            лот
          </Link>
        </div>
      </Td>
      <Td className="max-w-[14rem] truncate text-neutral-700" title={usage.rawMaterialName}>{usage.rawMaterialName}</Td>
      <Td className="min-w-[7.5rem]">
        <TextCell value={usage.quantity} type="number" step="0.001" min="0" align="right" label="Количество" suffix={unit} readOnly={readOnly} onDraft={setQty} onSave={(v) => updateAction(build({ quantity: v }))} />
      </Td>
      <Td className="whitespace-nowrap text-right tabular-nums">{Number(usage.lotCostExclVat) ? <Money incl={usage.lotCostExclVat} /> : <span className="text-neutral-300">—</span>}</Td>
      <Td className="min-w-[5.5rem]">
        <TextCell
          value={String(Number(usage.vatRate))}
          type="number"
          step="0.01"
          min="0"
          align="right"
          label={`НДС, %. В лоте ${Number(usage.lotVatRate)}%${usage.purchaseNumber ? ` (закупка ${usage.purchaseNumber})` : ""}. Пусто — как в лоте`}
          suffix="%"
          readOnly={readOnly}
          className={usage.vatOwn ? "font-semibold text-amber-700" : undefined}
          onSave={(v) => {
            const fd = new FormData();
            fd.set("vatRate", v);
            return vatAction(fd);
          }}
        />
        {usage.vatOwn ? <span className="block text-right text-[11px] text-amber-700" title={`В лоте ${Number(usage.lotVatRate)}%`}>изм. (лот {Number(usage.lotVatRate)}%)</span> : null}
      </Td>
      <Td className="text-center">
        <input
          type="checkbox"
          defaultChecked={usage.commission4}
          key={String(usage.commission4)}
          disabled={readOnly || busy}
          className="h-4 w-4 max-md:h-5 max-md:w-5"
          aria-label="Начислять 4%"
          title={c4Error ?? "4% — доп. комиссия посредника (Веллмех): +4% к цене меха и подкладки в ТЗ; работа и расходы не облагаются"}
          onChange={async (e) => {
            const box = e.target;
            const checked = box.checked;
            // Подтверждение у завершённого ТЗ — до transition.
            if (!(await guard())) {
              box.checked = !checked;
              return;
            }
            startBusy(async () => {
              const r = await updateAction(build({ commission4: checked }));
              setC4Error(r?.error ?? null);
            });
          }}
        />
        {c4Error ? <span className="block text-xs text-red-600">{c4Error}</span> : null}
      </Td>
      <Td className="whitespace-nowrap text-right font-medium tabular-nums">
        {dirty ? <Money incl={live(usage.unitIncl)} excl={live(usage.unitExcl)} /> : <Money incl={usage.totalCost} excl={usage.totalCostExclVat} />}
        {dirty ? <span className="ml-1 text-xs font-normal text-neutral-400" title="Предварительно, до сохранения">~</span> : null}
        {usage.c4Mode === "on" && !usage.commission4 && (
          <span className="ml-1 whitespace-nowrap text-xs font-normal text-neutral-500" title="4% к этому списанию не применяется">без 4%</span>
        )}
        {usage.costBreakdown != null && (
          <CostBreakdownToggle breakdown={usage.costBreakdown as never} unitCostExcl={usage.lotUnitCostExcl} unitCostIncl={usage.lotUnitCostIncl} />
        )}
      </Td>
      <Td className="w-8 text-center">
        {!readOnly && (
          <>
            <button
              type="button"
              disabled={busy}
              aria-label="Удалить списание"
              title="Удалить списание (лот получит количество обратно)"
              className="rounded px-1.5 py-0.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              onClick={async () => {
                if (!(await ask(`Удалить списание: ${usage.rawMaterialName}, лот ${usage.lotNumber ?? "без номера"}, ${formatQty(usage.quantity)} ${unit}?`, { ok: "Удалить", danger: true }))) return;
                startBusy(async () => {
                  await removeAction();
                });
              }}
            >
              ×
            </button>
            {node}
          </>
        )}
      </Td>
    </Tr>
  );
}
