/**
 * ТЗ поставщика (Веллмех) в его реальном формате «ПРИЛОЖЕНИЕ N к Договору подряда»: данные, значения по умолчанию,
 * итоги. Чистая логика без БД и server-only — работает и в форме (живые итоги), и в генераторе Word (tz-docx-vendor.ts).
 */
import { evalNum } from "@/lib/supplier-calc";

export type TzKind = "WORK" | "REPAIR";
export type TzItem = { name: string; color: string; model: string; material: string; size: string; lining: string; qty: string; pelts: string; work: string; price: string;
  /** Необязательно: «ИТОГО» по строке, как вписал Веллмех (иначе считается: количество × стоимость продукции; в ремонте — работа + материал). */
  total?: string };
export type TzMaterial = { name: string; lot: string; unit: string; qty: string; priceNet: string; vatPct: string;
  /** Необязательно: «Общая стоимость» вручную, как вписал Веллмех (иначе количество × цена × (1 + НДС)). */
  total?: string };
export type TzTerms = { payment: string; deadline: string; delivery: string; place: string; method: string; other: string };
export type TzPayload = {
  v: 1; kind: TzKind; number: string; date: string; city: string; contract: string; customer: string; batch: string;
  vatPct: string; items: TzItem[]; materials: TzMaterial[]; terms: TzTerms;
  /** В строке «Итого:» показывать сумму работ (по умолчанию да, как в большинстве образцов). */
  showWorkTotal?: boolean;
  signers: { customerPost: string; customerName: string; contractorPost: string; contractorName: string };
};

export const TZ_KIND_LABEL: Record<TzKind, string> = { WORK: "Пошив изделий", REPAIR: "Ремонт" };
export const DEFAULT_CONTRACT = "№ 1605 от 16 мая 2025 г.";

export function defaultTerms(kind: TzKind): TzTerms {
  return {
    payment: kind === "REPAIR" ? "аванс 100 % от стоимости работы" : "аванс 70 % от предварительного расчета, доплата по факту готовности продукции",
    deadline: "",
    delivery: "5 дней с момента подтверждения возможности приемки от Заказчика",
    place: "Коптево Приемный склад Оптика",
    method: kind === "REPAIR" ? "Самовывоз" : "(поставка/самовывоз) силами и за счет Подрядчика",
    other: "нет",
  };
}
export function emptyItem(): TzItem {
  return { name: "", color: "", model: "", material: "", size: "", lining: "", qty: "1", pelts: "", work: "", price: "" };
}
export function emptyMaterial(): TzMaterial {
  return { name: "", lot: "", unit: "Шт.", qty: "", priceNet: "", vatPct: "22" };
}
export function emptyTz(kind: TzKind, number: string, dateIso: string): TzPayload {
  return {
    v: 1, kind, number, date: dateIso, city: "г. Москва", contract: DEFAULT_CONTRACT, customer: "ООО «Меркури Мода»", batch: "", vatPct: "22",
    items: [emptyItem()], materials: [], terms: defaultTerms(kind),
    signers: { customerPost: "Генеральный директор ООО «Меркури Мода»", customerName: "Павлов А. М.", contractorPost: "Генеральный директор ООО «Веллмех »", contractorName: "Вельмакина И.Е." },
  };
}

const n0 = (s: string | undefined) => { const v = evalNum(s ?? ""); return Number.isFinite(v) ? v : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const has = (s: string | undefined) => (s ?? "").trim() !== "";

/** Строка заполнена? (значения по умолчанию «1», «Шт.», «22» и пустые поля не считаются) */
export const itemFilled = (i: TzItem) => Object.values(i).some((v) => typeof v === "string" && v.trim() !== "" && v !== "1");
export const materialFilled = (m: TzMaterial) => Object.values(m).some((v) => typeof v === "string" && v.trim() !== "" && v !== "Шт." && v !== "22");

/** ИТОГО по строке изделия: вписанное вручную, иначе количество × стоимость продукции (ремонт: работа + материал). */
export function itemTotal(i: TzItem, kind: TzKind): number {
  if (has(i.total)) return r2(n0(i.total));
  return r2(kind === "REPAIR" ? n0(i.work) + n0(i.price) : n0(i.qty) * n0(i.price));
}
/** Общая стоимость материала: вписанная вручную, иначе количество × цена × (1 + НДС). */
export function materialTotal(m: TzMaterial): number {
  if (has(m.total)) return r2(n0(m.total));
  return r2(n0(m.qty) * n0(m.priceNet) * (1 + n0(m.vatPct) / 100));
}

export function tzTotals(p: TzPayload) {
  const itemTotals = p.items.map((i) => itemTotal(i, p.kind));
  const qty = p.items.reduce((s, i) => s + n0(i.qty), 0);
  const repair = p.kind === "REPAIR";
  const work = r2(p.items.reduce((s, i) => s + (repair ? n0(i.work) : n0(i.qty) * n0(i.work)), 0));
  const price = repair ? r2(p.items.reduce((s, i) => s + n0(i.price), 0)) : 0;
  const total = r2(itemTotals.reduce((s, x) => s + x, 0));
  const matTotals = p.materials.map(materialTotal);
  const materials = r2(matTotals.reduce((s, x) => s + x, 0));
  const matQty = p.materials.reduce((s, m) => s + n0(m.qty), 0);
  const pelts = p.items.reduce((s, i) => s + n0(i.qty) * n0(i.pelts), 0);
  return { itemTotals, qty, work, price, total, matTotals, materials, matQty, pelts };
}

/** Число как в образцах Веллмеха: целое без копеек («9500»), иначе с запятой («98700,20»). */
export function plainNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ",");
}
/** Как в Word Веллмеха: всегда с копейками через запятую («233405,00»). */
export function kopNum(n: number): string {
  return n.toFixed(2).replace(".", ",");
}
/** Число, вписанное человеком, как есть; десятичная точка → запятая. */
export function typedNum(s: string): string {
  const t = s.trim();
  return /^\d+\.\d+$/.test(t) ? t.replace(".", ",") : t;
}
/** «620 606,97» — для таблицы материалов. */
export function spacedNum(n: number): string {
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ | /g, " ");
}
export function ruDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Проверка перед отправкой. */
export function tzProblems(p: TzPayload): string[] {
  const out: string[] = [];
  if (!p.number.trim()) out.push("Укажите номер ТЗ");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) out.push("Укажите дату");
  if (!p.terms.deadline) out.push("Укажите срок завершения работ");
  const items = p.items.filter(itemFilled);
  if (items.length === 0) out.push("Добавьте хотя бы одно изделие");
  items.forEach((i, k) => {
    if (!i.name.trim()) out.push(`Изделие ${k + 1}: нет наименования`);
    if (!(n0(i.qty) > 0)) out.push(`Изделие ${k + 1}: нет количества`);
    if (!(n0(i.price) > 0 || (p.kind === "REPAIR" && n0(i.work) > 0))) out.push(`Изделие ${k + 1}: нет стоимости продукции`);
  });
  return out;
}
