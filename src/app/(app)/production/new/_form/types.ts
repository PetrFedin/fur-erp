export type ModelOption = { id: string; name: string; retailPrice: string | null; category: string | null; group: string | null };
export type Opt = { id: string; name: string };
export type Line = { key: number; lotId: string; qty: string; c4: boolean; c4Touched: boolean };
export type Extra = { key: number; modelId: string; qty: string; color: string; colorRefId: string | null; size: string; work: string };
export type ExpLine = { key: number; categoryId: string; amount: string; desc: string };
/** Что остаётся в форме после «Сохранить и добавить ещё»: заказчик, договор, партия, даты, цвет, вид меха и т.п. (артикул, количество и строки очищаются). */
export type Carry = {
  f: Record<string, string>; clientId: string; contractorId?: string; contract: string; contractTouched: boolean;
  batchSel: string; batchNew: string; furSel: string; furNew: string; vatSel: string; vatCustom: string; colorRefId: string;
};

export const num = (s: string) => {
  const n = Number(String(s).replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

export const cardCls = "rounded-lg border border-neutral-200 bg-white p-3";
export const th = "px-2 py-1.5 text-left text-xs font-medium text-neutral-500";
