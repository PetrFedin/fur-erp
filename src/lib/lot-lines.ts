// Parser for lot lines pasted from Excel ("лот <Tab> кол-во" per line).
// Shared by ТЗ creation and the bulk write-off on the ТЗ card so both accept
// the same separators: Tab, ';', two-or-more spaces or a single space.
export type LotLine = { line: number; lotNumber: string; quantity: number };

// Returns every problem, line by line — never just the first few — so the
// user can fix the whole paste in one pass.
export function parseLotLines(raw: string): { lines: LotLine[]; errors: string[] } {
  const lines: LotLine[] = [];
  const errors: string[] = [];
  raw.split(/\r?\n/).forEach((text, i) => {
    const t = text.trim();
    if (!t) return;
    const n = i + 1;
    const cells = t.split(/[\t;]+|\s+/).map((c) => c.trim()).filter(Boolean);
    if (cells.length !== 2) {
      errors.push(`строка ${n}: ожидается «лот количество», получено «${t}»`);
      return;
    }
    const quantity = Number(cells[1].replace(",", "."));
    if (!Number.isFinite(quantity)) {
      errors.push(`строка ${n}: не число «${cells[1]}»`);
      return;
    }
    if (quantity <= 0) {
      errors.push(`строка ${n}: количество должно быть больше 0`);
      return;
    }
    lines.push({ line: n, lotNumber: cells[0], quantity });
  });
  return { lines, errors };
}
