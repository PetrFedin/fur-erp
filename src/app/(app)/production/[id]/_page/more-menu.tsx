import Link from "next/link";
import { CompleteOrderForm, CancelOrderButton } from "../order-actions";
import { OrderColorsEditButton } from "../edit-buttons";

type MenuProps = {
  id: string;
  tzSearch: string;
  payLink: string;
  open: boolean;
  canEdit: boolean;
  hasClient: boolean;
  batchNumber: number | null;
  tzLabel: string;
  hasUsages: boolean;
  plannedQuantity: string;
  costs: { material: string; extra4: string; expenses: string; workPerUnit: string };
  cancelBlockedReason: string | undefined;
  colorOptions: { id: string; name: string }[];
  colors: { colorRefId: string; quantity: number | null; sizes: string | null }[];
};

/** Меню «⋯» в шапке ТЗ: документы, оплаты, история, Word, завершение и отмена ТЗ, цвета. */
export function OrderMoreMenu({ id, tzSearch, payLink, open, canEdit, hasClient, batchNumber, tzLabel, hasUsages, plannedQuantity, costs, cancelBlockedReason, colorOptions, colors }: MenuProps) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50 max-md:inline-flex max-md:min-h-11 max-md:min-w-11 max-md:items-center max-md:justify-center" title="Ещё: документы, оплаты, история, Word, цвета, отмена ТЗ" aria-label="Ещё: документы, оплаты, история, Word, цвета, отмена ТЗ">⋯</summary>
      <div className="absolute right-0 z-10 mt-1 flex w-56 flex-col gap-2 rounded-md border border-neutral-200 bg-white p-2 shadow">
        <a href="#drive" className="rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50" title="Перейти к блоку «Документы-основания» внизу этой страницы">Документы-основания ↓</a>
        <Link href={`/documents?q=${tzSearch}`} className="rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50" title="Документы ТЗ: приложение, акты, счета — в разделе «Документы»">Документы</Link>
        {hasClient && <Link href={payLink} className="rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50" title={batchNumber != null ? `Оплаты за работу по партии ${batchNumber}` : "Оплаты за работу, разнесение по ТЗ"}>Оплаты за работу</Link>}
        <Link href={`/verify?tab=orders&q=${tzSearch}`} className="rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50" title="Подтверждение ТЗ в разделе «Контроль → Подтвердить»">Подтверждение</Link>
        <Link href={`/history?model=ProductionOrder&q=${tzSearch}`} className="rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50" title="История изменений и комментарии — в разделе «Контроль»">История</Link>
        <a href={`/api/production/${id}/docx`} className="rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50" title="Печатная форма ТЗ, собранная системой из данных ТЗ (не присланный Word)">
          Печатная форма .docx
        </a>
        {open && canEdit && (
          <div className="border-t border-neutral-100 pt-2">
            <CompleteOrderForm
              orderId={id}
              tzLabel={tzLabel}
              hasUsages={hasUsages}
              plannedQuantity={plannedQuantity}
              costs={costs}
            />
          </div>
        )}
        {open && canEdit && (
          <div className="border-t border-neutral-100 pt-2">
            <CancelOrderButton orderId={id} blockedReason={cancelBlockedReason} />
          </div>
        )}
        {canEdit && (
          <OrderColorsEditButton
            key={colors.map((c) => `${c.colorRefId}:${c.quantity ?? ""}:${c.sizes ?? ""}`).join("|")}
            orderId={id}
            colors={colorOptions.map((c) => ({ id: c.id, name: c.name }))}
            rows={colors.map((c) => ({ colorRefId: c.colorRefId, quantity: c.quantity != null ? String(c.quantity) : "", sizes: c.sizes ?? "" }))}
          />
        )}
      </div>
    </details>
  );
}
