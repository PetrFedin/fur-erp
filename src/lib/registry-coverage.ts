import data from "@/data/registry-coverage.json";

/**
 * «Покрытие реестром»: результат сверки единого реестра (xlsx) с базой.
 * Данные лежат в src/data/registry-coverage.json и обновляются скриптом
 * `npx tsx scripts/build-registry-coverage.ts` (из docs-inventory/coverage-matrix.json); база тут не читается.
 */

export type RegEntry = { found: boolean; sheet: string; rows: string; note: string; tz?: string };
export type RegStat = { key: string; label: string; what: string; have: string; percent: number };
export type RegistryOnlyItem = {
  kind: "purchase" | "purchaseDifference" | string;
  title: string;
  qty: number | null;
  amount: number | null;
  sheet: string;
  rows: string;
  note: string;
};
export type RegistryCoverageData = {
  checkedAt: string;
  registryDate: string;
  coverage: RegStat[];
  backCoverage: RegStat[];
  purchases: Record<string, RegEntry>;
  batches: Record<string, RegEntry>;
  workOrders: Record<string, RegEntry>;
  registryOnly: RegistryOnlyItem[];
};

export const registryCoverage = data as RegistryCoverageData;

/** Команда обновления данных сверки (как показать в подсказке на странице). */
export const REGISTRY_UPDATE_CMD = "npx tsx scripts/build-registry-coverage.ts";

/**
 * found   — есть в реестре (лист и строки);
 * partial — партия: ТЗ найдены в реестре не все;
 * missing — нет в реестре (красное);
 * later   — нет в реестре, но запись позже даты реестра / последнего ТЗ реестра (серое);
 * untracked — в реестре не ведётся (подкладка и т. п., по note; серое);
 * none    — для этого раздела сверки нет.
 */
export type RegState = "found" | "partial" | "missing" | "later" | "untracked" | "none";
export type RegCell = { state: RegState; text: string; title: string };

export const REG_NONE: RegCell = { state: "none", text: "–", title: "" };

const maxFoundTz = Math.max(
  0,
  ...Object.values(registryCoverage.workOrders)
    .filter((v) => v.found)
    .map((v) => parseInt(v.tz ?? "", 10))
    .filter(Number.isFinite)
);

const where = (e: RegEntry) => {
  const rows = e.rows ? (e.rows.includes(",") || e.rows.includes("–") ? `, строки ${e.rows}` : `, строка ${e.rows}`) : "";
  return `лист «${e.sheet}»${rows}`;
};

type Kind = "purchases" | "tz" | "batches";

/** date — дата записи (закупка: дата заказа; ТЗ: дата ТЗ), если известна. */
export function registryCell(kind: Kind, key: string, date?: Date | null): RegCell {
  const e = (kind === "purchases" ? registryCoverage.purchases : kind === "tz" ? registryCoverage.workOrders : registryCoverage.batches)[key];
  if (!e) return REG_NONE;
  const regDate = new Date(registryCoverage.registryDate);
  if (e.found) {
    if (kind === "batches" && e.note) {
      const m = /(\d+) из (\d+)/.exec(e.note);
      if (m && m[1] !== m[2]) return { state: "partial", text: `${e.note}`, title: `${where(e)}. ${e.note}` };
    }
    const tail = e.note && kind === "tz" ? ` (${e.note})` : "";
    return {
      state: "found",
      text: kind === "batches" ? `${e.note || where(e)}` : kind === "tz" && e.tz ? `ТЗ ${e.tz}: ${where(e)}` : where(e),
      title: `Найдено в реестре: ${where(e)}${tail}`,
    };
  }
  if (kind === "batches") {
    return { state: "later", text: "нет в реестре (поздняя партия)", title: `${e.note}. ТЗ партии новее реестра от ${registryCoverage.registryDate}` };
  }
  if (e.note) return { state: "untracked", text: "в реестре не ведётся", title: e.note };
  const num = parseInt(e.tz ?? "", 10);
  if (kind === "tz" && Number.isFinite(num) && num > maxFoundTz)
    return { state: "later", text: "нет в реестре (позже реестра)", title: `ТЗ позже последнего ТЗ реестра (${maxFoundTz}); реестр от ${registryCoverage.registryDate}` };
  if (kind === "purchases" && date && date > regDate)
    return { state: "later", text: "нет в реестре (позже реестра)", title: `Дата закупки позже реестра от ${registryCoverage.registryDate}` };
  return { state: "missing", text: "нет в реестре", title: "Записи нет в едином реестре — сверьте с владельцем" };
}

/** Текст для CSV. */
export const registryCsv = (c: RegCell) => (c.state === "none" ? "" : c.state === "found" || c.state === "partial" ? `есть: ${c.text}` : c.text);
