"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Tr, Td } from "@/components/ui/table";
import { formatQty } from "@/lib/utils";
import { Money } from "@/components/money";
import { useConfirm } from "@/components/confirm-dialog";
import { CostBreakdownToggle } from "../../lots/cost-breakdown-toggle";
import type { FormState } from "../actions";
import { DraftInput, SelectCell, TextCell } from "./inline-cell";
import { DraftBar, useDraftEdit } from "./change-window";
import { lotOptionLabel } from "./lot-label";
import { invalidateLotCatalog, peekLotCatalog, warmLotCatalog } from "./lot-catalog-client";
import { useDirtyMark } from "./edit-guard";

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
  /** Подпись текущего лота (остальные варианты подгружаются, когда список открывают). */
  lotLabel: string;
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
 * Строка списания в таблице «Расчёт и списание»: лот, количество и «4%» копятся в строке («Не сохранено»), кнопка «Сохранить» (или Enter в поле)
 * открывает окно «что изменится», запись — после «Сохранить» в окне; сумма пересчитывается сразу при вводе. Цена и НДС — свойства лота (закупки): ссылка ведёт в закупку.
 */
export function UsageRow({
  usage,
  orderId,
  lining,
  updateAction,
  vatAction,
  removeAction,
  readOnly = false,
}: {
  usage: UsageRowData;
  orderId: string;
  /** Подкладка (единица «м») или мех: из какой части каталога лотов предлагать замену. */
  lining: boolean;
  updateAction: (formData: FormData) => Promise<FormState>;
  vatAction: (formData: FormData) => Promise<FormState>;
  removeAction: () => Promise<void>;
  readOnly?: boolean;
}) {
  const [qty, setQty] = useState(usage.quantity);
  const [lotId, setLotId] = useState(usage.lotId);
  const [lotLabel, setLotLabel] = useState(usage.lotLabel);
  const [c4, setC4] = useState(usage.commission4);
  const sig = `${usage.quantity}|${usage.lotId}|${usage.commission4}`;
  const [seenSig, setSeenSig] = useState(sig);
  if (seenSig !== sig) {
    setSeenSig(sig);
    setQty(usage.quantity);
    setLotId(usage.lotId);
    setLotLabel(usage.lotLabel);
    setC4(usage.commission4);
  }
  const [busy, startBusy] = useTransition();
  const ch = useDraftEdit(orderId);
  const { ask, node } = useConfirm();
  const unit = UNIT_LABELS[usage.unit] ?? usage.unit;

  const qtyDirty = qty.trim().replace(",", ".") !== usage.quantity.trim();
  const dirty = qtyDirty || lotId !== usage.lotId || c4 !== usage.commission4;
  useDirtyMark(dirty);
  const cancel = () => { setQty(usage.quantity); setLotId(usage.lotId); setLotLabel(usage.lotLabel); setC4(usage.commission4); ch.setError(null); };
  const save = async () => {
    if (!dirty || ch.busy) return;
    const quantity = qty.trim().replace(",", ".");
    const fd = new FormData();
    fd.set("lotId", lotId);
    fd.set("quantity", quantity);
    fd.set("c4form", "1");
    if (c4) fd.set("commission4", "on");
    const fields: { label: string; before: string; after: string }[] = [];
    if (lotId !== usage.lotId) fields.push({ label: "Лот", before: usage.lotLabel, after: lotLabel });
    if (qtyDirty) fields.push({ label: "Количество", before: `${formatQty(usage.quantity)} ${unit}`, after: `${formatQty(quantity)} ${unit}` });
    if (c4 !== usage.commission4) fields.push({ label: "4%", before: usage.commission4 ? "начисляется" : "нет", after: c4 ? "начисляется" : "нет" });
    await ch.run(
      `Изменить списание: ${usage.rawMaterialName}`,
      { kind: "usage", usageId: usage.id, lotId, quantity, commission4: c4 },
      fields,
      async () => { const r = await updateAction(fd); invalidateLotCatalog(orderId); return r; },
    );
  };
  const qtyNum = Number(qty.replace(",", "."));
  const live = (unitPrice: string) => (qtyNum * Number(unitPrice)).toFixed(2);
  const liveOk = qtyDirty && qty.trim() !== "" && Number.isFinite(qtyNum);

  return (
    <Tr>
      <Td className="min-w-[13rem]">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <SelectCell
              value={lotId}
              label="Лот"
              readOnly={readOnly}
              options={[]}
              onSave={async () => undefined}
              onPick={(v) => {
                setLotId(v);
                const l = peekLotCatalog(orderId)?.find((x) => x.id === v);
                setLotLabel(v === usage.lotId ? usage.lotLabel : l ? lotOptionLabel(l) : lotLabel);
              }}
              lazy={{
                current: { value: lotId, label: lotLabel },
                get: () => peekLotCatalog(orderId)?.filter((l) => (l.unit === "M") === lining).map((l) => ({ value: l.id, label: lotOptionLabel(l) })) ?? null,
                warm: () => warmLotCatalog(orderId),
              }}
            />
          </div>
          <Link href={`/analytics/raw/lot/${usage.lotId}`} className="shrink-0 text-xs text-blue-700 hover:underline" title="Карточка лота: закупка, где ещё использован, остаток">
            лот
          </Link>
        </div>
      </Td>
      <Td className="max-w-[14rem] truncate text-neutral-700" title={usage.rawMaterialName}>{usage.rawMaterialName}</Td>
      <Td className="min-w-[7.5rem]">
        <DraftInput value={usage.quantity} draft={qty} onChange={setQty} onEnter={save} onEscape={cancel} step="0.001" min="0" align="right" label="Количество" suffix={unit} readOnly={readOnly} disabled={ch.busy} />
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
          checked={c4}
          disabled={readOnly || busy || ch.busy}
          className="h-4 w-4 max-md:h-5 max-md:w-5"
          aria-label="Начислять 4%"
          title="4% — наценка при купле-продаже меха и подкладки подрядчику (не комиссия Веллмеха): +4% к цене меха и подкладки в ТЗ; работа и расходы не облагаются"
          onChange={(e) => setC4(e.target.checked)}
        />
      </Td>
      <Td className="whitespace-nowrap text-right font-medium tabular-nums">
        {liveOk ? <Money incl={live(usage.unitIncl)} excl={live(usage.unitExcl)} /> : <Money incl={usage.totalCost} excl={usage.totalCostExclVat} />}
        {liveOk ? <span className="ml-1 text-xs font-normal text-neutral-400" title="Предварительно, до сохранения">~</span> : null}
        <DraftBar dirty={dirty} busy={ch.busy} error={ch.error} onSave={save} onCancel={cancel} />
        {ch.node}
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
