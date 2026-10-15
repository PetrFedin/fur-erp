// Источник закупки меха и подписи кнопок «Вся закупка / На аукционах / У поставщика». Без "use client": нужны и серверным страницам, и клиентским блокам.
export type FurSrc = "all" | "auction" | "supplier";
export const FUR_SRC_KEYS: FurSrc[] = ["all", "auction", "supplier"];
export const FUR_SRC_LABEL: Record<FurSrc, string> = { all: "Вся закупка", auction: "На аукционах", supplier: "У поставщика" };
