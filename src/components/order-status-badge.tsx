import type { ProductionOrderStatus } from "@prisma/client";

/** Статусы ТЗ (ProductionOrder.status) для бейджа и фильтра: «Запланировано», «В работе», «Завершено», «Отменено». */
export const ORDER_STATUS_TEXT: Record<ProductionOrderStatus, string> = {
  PLANNED: "Запланировано",
  IN_PROGRESS: "В работе",
  COMPLETED: "Завершено",
  CANCELLED: "Отменено",
};

export const ORDER_STATUS_OPTIONS = (Object.keys(ORDER_STATUS_TEXT) as ProductionOrderStatus[]).map((value) => ({ value, label: ORDER_STATUS_TEXT[value] }));

const TONE: Record<ProductionOrderStatus, string> = {
  PLANNED: "border-neutral-300 bg-neutral-50 text-neutral-700",
  IN_PROGRESS: "border-amber-300 bg-amber-50 text-amber-800",
  COMPLETED: "border-emerald-300 bg-emerald-50 text-emerald-800",
  CANCELLED: "border-neutral-200 text-neutral-500 line-through",
};

/** Бейдж статуса ТЗ в формате остальных бейджей (как «НДС: 22%»). */
export function OrderStatusBadge({ status, className = "" }: { status: ProductionOrderStatus; className?: string }) {
  return <span className={`inline-block whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[11px] font-medium ${TONE[status]} ${className}`}>{ORDER_STATUS_TEXT[status]}</span>;
}
