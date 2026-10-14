/** Сопоставление списка со скана «Количество изделий с подкладом на 06.10.2026» со строками отгрузки (чистая логика, без базы). */

export type ScanRow = { no: string; model: string; name: string; size: string | null; qty: number; colorWords: string[] };

const r = (no: number, model: string, name: string, size: string | null, qty = 1, colorWords: string[] = []): ScanRow => ({ no: String(no), model, name, size, qty, colorWords });

/** 26 строк, 30 изделий (скан списка, согласовано к отгрузке на примерке 05.10). */
export const SCAN: ScanRow[] = [
  r(279, "MCF01", "манжеты из частей соболя", null, 5),
  r(285, "MMF01", "муфта соболь тёмный", null, 1, ["тёмный"]),
  r(179, "M001E", "полупальто из лисы арктик марбл фрост", "38"),
  r(264, "M002", "пальто соболь торторо", "48", 1, ["торторо"]),
  r(225, "M009", "полупальто норка браун", "44", 1, ["браун"]),
  r(258, "M018", "жакет из свакары фондю", "42", 1, ["фондю"]),
  r(259, "M018", "жакет из свакары фондю", "44"),
  r(260, "M018", "жакет из свакары фондю", "44"),
  r(261, "M018", "жакет из свакары фондю", "46"),
  r(262, "M018", "жакет из свакары фондю", "46"),
  r(263, "M018", "жакет из свакары фондю", "48"),
  r(183, "M023", "куртка 2-х сторонняя из соболя торторо + ткань верха нейлон", "42", 1, ["торторо"]),
  r(154, "M026", "пальто норка белая + шарф", "46", 1, ["белая"]),
  r(177, "M026", "пальто норка белая + шарф", "44"),
  r(200, "M026", "пальто норка белая + шарф", "48"),
  r(203, "M026", "пальто норка белая + шарф", "42"),
  r(246, "M028", "куртка соболь тёмный", "48", 1, ["тёмный"]),
  r(253, "M038", "полупальто норка чёрная стрижка + соболь", "42", 1, ["чёрная"]),
  r(282, "M044", "жилет норка браун тонированная", "48", 1, ["браун"]),
  r(265, "M045", "жилет норка бордо", "44", 1, ["бордо"]),
  r(266, "M045", "жилет норка бордо", "44", 1, ["бордо"]),
  r(267, "M045", "жилет норка бордо", "46", 1, ["бордо"]),
  r(268, "M045", "жилет норка бордо", "46", 1, ["бордо"]),
  r(271, "M045", "жилет норка бордо", "42", 1, ["бордо"]),
  r(280, "M055", "куртка женская норка махагон", "48", 1, ["махагон"]),
  r(281, "M055", "куртка женская норка махагон", "46"),
];

const LAT: Record<string, string> = { М: "M", Н: "H", Е: "E", С: "C", К: "K", А: "A", О: "O", Т: "T", Р: "P", В: "B", Х: "X" };
/** Модель для сравнения: верхний регистр, без пробелов и дефисов, кириллица → латиница (М023 = M023, MCF-01 = MCF01). */
export const normModel = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[\s\-_]/g, "").replace(/[А-Я]/g, (c) => LAT[c] ?? c);
const normSize = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/** Однозначные соответствия слова цвета и цвета ТЗ; остальные слова (браун, торторо, махагон…) со цветом ТЗ не сверяются. */
const HARD: Record<string, RegExp> = { "белая": /^бел/i, "бордо": /^бордов/i };

export type LineLike = { id: string; model: string[]; size: string | null; color: string | null; quantity: number };

export type Pair = { scan: ScanRow; lineId: string | null; reason: string | null; colorNote: string };
export type GroupPlan = { lineId: string; scans: ScanRow[] };
export type MatchResult = { pairs: Pair[]; groups: GroupPlan[]; touchedLineIds: Set<string> };

function colorState(scan: ScanRow, line: LineLike): { ok: boolean; note: string } {
  const hard = scan.colorWords.filter((w) => HARD[w]);
  for (const w of hard) if (!HARD[w].test(line.color ?? "")) return { ok: false, note: `в списке «${w}», в ТЗ «${line.color ?? "—"}»` };
  if (hard.length) return { ok: true, note: "цвет совпал" };
  return { ok: true, note: scan.colorWords.length ? `цвет «${scan.colorWords.join(" ")}» с ТЗ «${line.color ?? "—"}» не сверялся` : "" };
}

export function matchScan(scan: readonly ScanRow[], lines: readonly LineLike[]): MatchResult {
  const pairs: Pair[] = [];
  const groups: GroupPlan[] = [];
  const touched = new Set<string>();
  const keyOf = (s: ScanRow) => `${normModel(s.model)}|${normSize(s.size)}`;
  const byKey = new Map<string, ScanRow[]>();
  for (const s of scan) byKey.set(keyOf(s), [...(byKey.get(keyOf(s)) ?? []), s]);
  for (const rows of byKey.values()) {
    const first = rows[0];
    const model = normModel(first.model);
    const sameModel = lines.filter((l) => l.model.some((m) => normModel(m) === model));
    // у изделий без размера в списке («NS» и т. п. в отгрузке) — любая строка модели; иначе размер должен совпасть
    const cands = sameModel.filter((l) => (first.size == null ? true : normSize(l.size) === normSize(first.size)));
    const fail = (reason: string) => { for (const s of rows) pairs.push({ scan: s, lineId: null, reason, colorNote: "" }); };
    if (cands.length === 0) { fail(sameModel.length ? `у модели ${first.model} в отгрузке нет размера ${first.size ?? "—"}` : `модели ${first.model} нет в отгрузке`); continue; }
    // цвет: отсекаем строки с явным несовпадением
    const okLines = cands.filter((l) => rows.every((s) => colorState(s, l).ok));
    if (okLines.length === 0) { fail(`цвет не совпал: ${colorState(rows[0], cands[0]).note}`); continue; }
    if (okLines.length > 1) { fail(`неоднозначно: ${okLines.length} строк отгрузки подходят по модели и размеру`); for (const l of okLines) touched.add(l.id); continue; }
    const line = okLines[0];
    touched.add(line.id);
    const sum = rows.reduce((t, s) => t + s.qty, 0);
    if (sum !== line.quantity) { fail(`количество не совпало: в списке ${sum} шт., в строке отгрузки ${line.quantity} шт.`); continue; }
    groups.push({ lineId: line.id, scans: rows });
    for (const s of rows) pairs.push({ scan: s, lineId: line.id, reason: null, colorNote: colorState(s, line).note });
  }
  // порядок вывода — как в списке
  pairs.sort((a, b) => scan.indexOf(a.scan) - scan.indexOf(b.scan));
  return { pairs, groups, touchedLineIds: touched };
}
