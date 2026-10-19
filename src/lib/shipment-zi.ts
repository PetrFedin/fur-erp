// Приёмка ЦУМ по накладным ЗИ. Хранится без миграции: SystemState, ключ «shipment-zi:<id отгрузки>».
// Накладные ЗИ приходят файлами по поставкам (21М, 22М, 23М): строка = одно изделие, бутик, размер, цвет, сумма.
// Здесь только чистые функции (без БД): разбор ключа артикула, сопоставление со строками отгрузки, итоги.
// Цены и бутики видит только наша сторона; подрядчику отдаётся «принято / не принято» без сумм и розницы.

export const ZI_KEY_PREFIX = "shipment-zi:";
export const ziKey = (shipmentId: string) => `${ZI_KEY_PREFIX}${shipmentId}`;

export type ZiLine = {
  /** Поставка ЦУМ: «21М», «22М», «23М». */
  supply: string;
  /** Бутик: Третьяковская, Барвиха, Кутузовская, Славянка, ДЛТ, ЦУМ. */
  boutique: string;
  /** Артикул производителя из накладной («M026/MINK WHITE», «MH-06 MINK IRIS»). */
  article: string;
  size: string;
  colorRu: string;
  /** Сумма по строке без НДС и НДС, ₽ (только наша сторона). */
  sum: number;
  vat: number;
  /** Откуда строка: лист и номер строки в файле поставки (сводный лист файла хранится под служебным именем). */
  sheet?: string;
  row?: number;
};
export type ZiSupply = {
  code: string;
  ziNumbers: string[];
  /** Дата сохранения файла накладных (ISO, только дата). */
  savedOn: string;
};
/** Исходный файл накладных, прикреплённый к этапу (DriveDocument.id). */
export type ZiFile = { supply: string; fileName: string; docId: string };
export type ZiData = { version: 1; sourceNote: string; supplies: ZiSupply[]; lines: ZiLine[]; files?: ZiFile[];
  /** Раскладка принятого по площадкам, правки пользователей: id строки отгрузки → LineAlloc (см. shipment-alloc.ts). Только наша сторона. */
  alloc?: Record<string, unknown> };

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, "");

/** «M026/MINK WHITE» → «M026»; «MH-06 MINK IRIS» → «MH-06»; кириллица в коде приводится к латинице. */
export function articleCode(article: string): string {
  const m = article.trim().match(/^[A-Za-zА-Яа-я0-9-]+/);
  const raw = (m ? m[0] : article).toUpperCase();
  const map: Record<string, string> = { А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X" };
  return raw.replace(/[А-Я]/g, (c) => map[c] ?? c);
}

export type PlanLine = { id: string; code: string; size: string | null; color: string | null; quantity: number };

/** Сколько штук по каждой строке отгрузки нашлось в накладных; остальное — в «нет в накладной». Жадно, по запасу количества строки. */
export function matchZi(zi: readonly ZiLine[], plan: readonly PlanLine[]): { byLine: Map<string, { qty: number; supplies: string[]; boutiques: string[]; sum: number; vat: number; items: ZiLine[] }>; unmatched: ZiLine[] } {
  const left = new Map(plan.map((p) => [p.id, p.quantity]));
  const byLine = new Map<string, { qty: number; supplies: string[]; boutiques: string[]; sum: number; vat: number; items: ZiLine[] }>();
  const unmatched: ZiLine[] = [];
  for (const z of zi) {
    const code = articleCode(z.article);
    const same = plan.filter((p) => articleCode(p.code) === code && norm(p.size ?? "") === norm(z.size));
    const exact = same.filter((p) => norm(p.color ?? "") === norm(z.colorRu));
    // несколько строк одного артикула и размера различаем по цвету; если цвет не совпал — берём единственную строку
    const pool = exact.length ? exact : same.length === 1 ? same : [];
    const target = pool.find((p) => (left.get(p.id) ?? 0) > 0);
    if (!target) { unmatched.push(z); continue; }
    left.set(target.id, (left.get(target.id) ?? 0) - 1);
    const cur = byLine.get(target.id) ?? { qty: 0, supplies: [], boutiques: [], sum: 0, vat: 0, items: [] };
    cur.items.push(z);
    cur.qty += 1; cur.sum += z.sum; cur.vat += z.vat;
    if (!cur.supplies.includes(z.supply)) cur.supplies.push(z.supply);
    if (!cur.boutiques.includes(z.boutique)) cur.boutiques.push(z.boutique);
    byLine.set(target.id, cur);
  }
  return { byLine, unmatched };
}

export type ZiStatus = "accepted" | "partial" | "rejected";
export const ziStatus = (quantity: number, inZi: number): ZiStatus => (inZi >= quantity ? "accepted" : inZi > 0 ? "partial" : "rejected");
export const ZI_STATUS_LABEL: Record<ZiStatus, string> = { accepted: "принято", partial: "принято частично", rejected: "не принято" };

/** Разбор значения из SystemState; всё лишнее отбрасывается (значение может быть из старой версии). */
export function parseZi(v: unknown): ZiData | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<ZiData>;
  if (o.version !== 1 || !Array.isArray(o.lines) || !Array.isArray(o.supplies)) return null;
  return { version: 1, sourceNote: String(o.sourceNote ?? ""), supplies: o.supplies, lines: o.lines, files: Array.isArray(o.files) ? o.files : [], alloc: o.alloc && typeof o.alloc === "object" ? o.alloc : {} };
}

/** Роли, которым доступны исходные файлы накладных ЦУМ и цены (подрядчику — нет). */
export const ZI_SOURCE_NOTE = "zi-source";
export const ZI_STAFF_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST"];

/** Для подрядчика: без сумм, НДС, бутиков и расхождений по ценам. */
export function ziForSupplier(d: ZiData): ZiData {
  return { ...d, lines: d.lines.map((l) => ({ ...l, boutique: "", sum: 0, vat: 0, sheet: undefined, row: undefined })), files: [], alloc: undefined };
}

/** Как называть лист файла на экране: сводный лист показываем так, листы бутиков — по названию. */
export const sheetLabel = (sheet: string | undefined | null): string => (!sheet || sheet.trim().toLowerCase() === "mvst" ? "сводный лист" : sheet);
