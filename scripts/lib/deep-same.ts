// Сравнение расчётов «витрина = живой расчёт» для тестов: Decimal и даты — строкой, ключи по алфавиту, числа с допуском 0,01.
/** Сравнение по значению: Decimal и даты — строкой, ключи объектов по алфавиту (jsonb в базе переставляет ключи). */
export const canon = (v: unknown): unknown => {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Map) return canon(Array.from(v.entries()));
  if (v && typeof v === "object" && typeof (v as { toFixed?: unknown }).toFixed === "function" && !Array.isArray(v)) return String(v);
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]));
  return v;
};
/** Первое различие (числа — с допуском 0,01: дроби на границе округления); null — равны. */
export const diff = (a: unknown, b: unknown, path = ""): string | null => {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 0.01 ? null : `${path}: ${a} ≠ ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) { if (a.length !== b.length) return `${path}: длина ${a.length} ≠ ${b.length}`; for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], `${path}[${i}]`); if (d) return d; } return null; }
  if (a && b && typeof a === "object" && typeof b === "object") { const ka = Object.keys(a), kb = Object.keys(b); if (ka.join() !== kb.join()) return `${path}: поля ${ka.join()} ≠ ${kb.join()}`; for (const k of ka) { const d = diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`); if (d) return d; } return null; }
  return a === b ? null : `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
};
export const same = (a: unknown, b: unknown) => diff(canon(a), canon(b));
