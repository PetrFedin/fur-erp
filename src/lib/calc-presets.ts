/**
 * Форматы расчёта аукциона как данные: набор столбцов (буквы, названия, единицы, формулы), параметры шапки с подсказками.
 * Источник — реальные файлы Веллмеха и письма (calc-presets.json). Выбор формата подставляет столбцы в «свою таблицу»
 * (CalcPayload format SHEET), дальше всё правится: можно менять формулы, добавлять столбцы, сохранять как «мой формат».
 * Чистая логика без БД — работает и в браузере, и на сервере, и в scripts/test-calc-presets.ts.
 */
import raw from "./calc-presets.json";
import { renameColumnRefs } from "@/lib/calc-formula";
import { calcAll, colLetterOf, emptyPayload, newId, paramKey, syncLetters, type CalcPayload, type CustomCol } from "@/lib/supplier-calc";

export type PresetCol = { key: string; title: string; unit: string; kind: "input" | "formula"; formula: string; note: string };
export type PresetParam = { name: string; label: string; hint: string; default: string };
export type PresetCheck = { row: number; rowInputs: Record<string, number>; paramOverrides: Record<string, number>; expected: Record<string, number> };
export type CalcPreset = {
  id: string; title: string; auctionHouses: string[]; params: PresetParam[]; columns: PresetCol[];
  roles: { qty: string | null; price: string | null; unit: string | null; rate: string | null };
  totalsRule: string; exampleFile: string; check: PresetCheck[];
};

export const PRESETS = raw as unknown as CalcPreset[];
export const getPreset = (id: string) => PRESETS.find((p) => p.id === id) ?? null;
/** Сколько встроенных столбцов (мех, описание, лот) идёт перед столбцами формата в свободной таблице. */
const LEAD = 3;
const colId = (key: string) => `k_${key}`;
/** Название столбца с буквой из файла поставщика, если в нашей таблице буква другая: «Себестоимость (в файле S)». */
const fileTitle = (c: PresetCol, idx: number) => (/^[A-Za-z]$/.test(c.key) && c.key.toUpperCase() !== colLetterOf(idx) ? `${c.title} (в файле ${c.key.toUpperCase()})` : c.title);

/** Формат → готовые столбцы, параметры и выбор столбцов (количество, цена, себестоимость) для свободной таблицы. */
export function presetFill(pr: CalcPreset): Pick<CalcPayload, "customColumns" | "params" | "qtyColumn" | "priceColumn" | "unitCostColumn" | "formatId" | "formatName"> {
  const map: Record<string, string> = {};
  pr.columns.forEach((c, i) => { map[c.key.toUpperCase()] = colLetterOf(LEAD + i); });
  const customColumns: CustomCol[] = pr.columns.map((c, i) => ({
    id: colId(c.key), letter: colLetterOf(LEAD + i), title: fileTitle(c, LEAD + i), unit: c.unit,
    kind: c.kind === "input" ? "input" : "formula",
    formula: c.kind === "formula" ? renameColumnRefs(c.formula, map) : "",
  }));
  const idOf = (k: string | null) => (k ? colId(k) : undefined);
  return {
    customColumns,
    params: pr.params.map((q) => ({ name: q.name, value: q.default, label: q.label, hint: q.hint })),
    qtyColumn: idOf(pr.roles.qty), priceColumn: idOf(pr.roles.price), unitCostColumn: idOf(pr.roles.unit),
    formatId: pr.id, formatName: pr.title,
  };
}

/** Новый расчёт из формата: свободная таблица со столбцами формата, одна пустая строка. */
export function payloadFromPreset(pr: CalcPreset, base?: CalcPayload): CalcPayload {
  const b = base ?? emptyPayload("SHEET");
  const rows = b.format === "SHEET" ? b.rows : [{ fur: "", size: "", lot: "", _id: newId() }];
  return syncLetters({ ...b, format: "SHEET", rows, overrides: {}, checks: undefined, ...presetFill(pr) });
}

/** Подпись для списка: название и аукционные дома. */
export const presetLabel = (p: CalcPreset) => `${p.title}${p.auctionHouses.length ? ` — ${p.auctionHouses.join(", ")}` : ""}`;

/** Проверка формата на его контрольных строках: пересчёт движком даёт ожидаемые значения (допуск — полкопейки). */
export function checkPreset(pr: CalcPreset): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  if (pr.check.length === 0) return { ok: true, lines: ["нет контрольных строк"] };
  for (const ch of pr.check) {
    const p = payloadFromPreset(pr);
    p.params = (p.params ?? []).map((q) => (q.name in ch.paramOverrides ? { ...q, value: String(ch.paramOverrides[q.name]) } : q));
    const row: Record<string, string> = { _id: newId(), fur: "", size: "", lot: String(ch.row) };
    for (const [k, v] of Object.entries(ch.rowInputs)) {
      if (pr.columns.some((c) => c.key === k)) row[colId(k)] = String(v);
      else row["@" + paramKey(k)] = String(v); // значение параметра для этой строки
    }
    p.rows = [row];
    const sh = calcAll(p).sheet;
    for (const [k, want] of Object.entries(ch.expected)) {
      const cell = sh.cells[colId(k)]?.[0];
      const got = cell?.v;
      const pass = got != null && Math.abs(got - want) <= 0.005;
      if (!pass) ok = false;
      lines.push(`${pass ? "OK  " : "FAIL"} ${pr.id} строка ${ch.row} ${k}: ${got == null ? `нет значения (${cell?.err ?? "?"})` : got.toFixed(4)} (ожидалось ${want})`);
    }
  }
  return { ok, lines };
}
