export const STATUS_LABELS = {
  PLANNED: "Запланировано",
  LAUNCHED: "Запуск",
  WITH_FURRIER: "В работе у скорняка",
  WITH_TAILOR: "В работе у портной",
  PRODUCED: "Сдано / произведено",
  CANCELLED: "Отменено",
} as const;

export type SupplyPlanStatusValue = keyof typeof STATUS_LABELS;

export const STATUS_BADGE_VARIANT: Record<SupplyPlanStatusValue, "default" | "info" | "warning" | "success" | "danger"> = {
  PLANNED: "default",
  LAUNCHED: "info",
  WITH_FURRIER: "warning",
  WITH_TAILOR: "warning",
  PRODUCED: "success",
  CANCELLED: "danger",
};
