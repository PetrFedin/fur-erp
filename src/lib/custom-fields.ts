// «Свои столбцы» таблицы лотов: общие типы и проверка значений (работает и на сервере, и в браузере).
import { MAX_MONEY, parseNumber } from "@/lib/input";

export type CustomFieldType = "TEXT" | "NUMBER" | "BOOLEAN";
export type ExtraValue = string | number | boolean;
export type CustomFieldDef = { id: string; name: string; type: CustomFieldType; position: number };

export const CUSTOM_FIELD_ENTITY = "PURCHASE_ITEM";
export const MAX_CUSTOM_FIELDS = 20;
export const FIELD_NAME_MAX = 40;
export const TEXT_VALUE_MAX = 200;

export const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT: "Текст",
  NUMBER: "Число",
  BOOLEAN: "Да / нет",
};

export function isFieldType(v: unknown): v is CustomFieldType {
  return v === "TEXT" || v === "NUMBER" || v === "BOOLEAN";
}

/** Название столбца: 1–40 символов без управляющих. */
export function validateFieldName(raw: unknown): { name: string } | { error: string } {
  const name = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  if (!name) return { error: "Введите название столбца" };
  if (name.length > FIELD_NAME_MAX) return { error: `Название не длиннее ${FIELD_NAME_MAX} символов` };
  return { name };
}

/** Значение ячейки из JSON PurchaseItem.extra -> безопасный объект. */
export function readExtra(extra: unknown): Record<string, ExtraValue> {
  const out: Record<string, ExtraValue> = {};
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return out;
  for (const [k, v] of Object.entries(extra as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) out[k] = v;
  }
  return out;
}

/**
 * Разбор введённого значения по типу. Пустой ввод -> value: null (значение очищается).
 * Число: запятая допустима, пробелы убираются (src/lib/input.ts).
 */
export function parseCustomValue(
  type: CustomFieldType,
  raw: unknown,
  label: string,
): { value: ExtraValue | null } | { error: string } {
  if (type === "BOOLEAN") {
    if (raw === "" || raw == null) return { value: null };
    if (raw === true || raw === "true" || raw === "yes") return { value: true };
    if (raw === false || raw === "false" || raw === "no") return { value: false };
    return { error: `${label}: допустимо «Да» или «Нет»` };
  }
  if (type === "NUMBER") {
    if (raw !== null && raw !== undefined && typeof raw !== "string" && typeof raw !== "number")
      return { error: `${label}: укажите число` };
    if (raw == null || (typeof raw === "string" && raw.trim() === "")) return { value: null };
    const r = parseNumber(raw, label, { min: -MAX_MONEY, max: MAX_MONEY });
    if ("error" in r) return { error: r.error };
    // Десятичное округление через строку (v*1e6 на значениях ~1e12 теряет точность); «-0» -> 0.
    const v = Number(r.value.toFixed(6));
    if (!Number.isFinite(v) || Math.abs(v) >= 1e12) return { error: `${label}: слишком большое значение` };
    return { value: v === 0 ? 0 : v };
  }
  if (raw !== null && raw !== undefined && typeof raw !== "string") return { error: `${label}: ожидается текст` };
  const t = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  if (!t) return { value: null };
  if (t.length > TEXT_VALUE_MAX) return { error: `${label}: не длиннее ${TEXT_VALUE_MAX} символов` };
  return { value: t };
}

const numFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 });

const avgFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });
/** Среднее значение числового столбца: не больше 3 знаков после запятой. */
export function formatAvg(v: number): string {
  return avgFmt.format(v === 0 ? 0 : v);
}

/** Показ значения ячейки; пусто -> пустая строка. */
export function formatExtra(type: CustomFieldType, v: ExtraValue | undefined): string {
  if (v === undefined || v === null || v === "") return "";
  if (type === "BOOLEAN") return v === true ? "Да" : v === false ? "Нет" : "";
  if (type === "NUMBER") return typeof v === "number" ? numFmt.format(v) : "";
  return String(v);
}
