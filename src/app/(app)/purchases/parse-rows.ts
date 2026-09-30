// Parser for rows pasted from Excel into a purchase ("Материал ⇥ Кол-во ⇥ Цена
// без НДС ⇥ НДС% ⇥ Лот ⇥ Сорт ⇥ Цвет"). Pure, no server imports: the same
// function drives the client-side preview ("Проверить") and the authoritative
// check inside the server action, so both always agree on what is an error.
//
// - separators: Tab, else ";", else two or more spaces (as before);
// - empty VAT% -> DEFAULT_PASTE_VAT_RATE;
// - numbers may contain spaces / non-breaking spaces and a decimal comma;
// - an unknown material is NOT an error (it has always been auto-created, the
//   historical-import behaviour) — it is reported as a warning up front.

export const DEFAULT_PASTE_VAT_RATE = 22;

export type ParsedRow = {
  lineNo: number; // 1-based line number in the pasted text
  materialName: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  lotNumber?: string;
  grade?: string;
  color?: string;
  isNewMaterial: boolean;
  errors: string[];
  warnings: string[];
};

export type ParseResult = {
  rows: ParsedRow[];
  headerSkipped: boolean;
  errorCount: number;
  warningCount: number;
};

function toNumber(s: string | undefined): number {
  if (s == null) return NaN;
  const cleaned = s
    .replace(/[\s  ]/g, "")
    .replace("₽", "")
    .replace("%", "")
    .replace(",", ".");
  if (cleaned === "") return NaN;
  return Number(cleaned);
}

function splitLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t");
  if (line.includes(";")) return line.split(";");
  return line.split(/ {2,}/);
}

export function parsePasteRows(raw: string, knownMaterialNames: Iterable<string>): ParseResult {
  const known = new Set<string>();
  for (const n of knownMaterialNames) known.add(n.trim().toLowerCase());

  const rows: ParsedRow[] = [];
  let headerSkipped = false;
  const seenNew = new Map<string, number>();

  raw.split(/\r?\n/).forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line) return;
    const lineNo = idx + 1;
    const cells = splitLine(line).map((c) => c.trim());
    const [materialName = "", quantityRaw, unitPriceRaw, vatRaw, lot, grade, color] = cells;

    // Header copied along with the data ("Материал  Кол-во  Цена ...").
    if (rows.length === 0 && !headerSkipped && /^материал/i.test(materialName) && Number.isNaN(toNumber(quantityRaw))) {
      headerSkipped = true;
      return;
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    if (cells.length < 3 && !quantityRaw) {
      errors.push("строка не разбита на столбцы — нужны Материал, Кол-во, Цена через Tab или «;»");
    } else {
      if (!materialName) errors.push("не указан материал");

      const quantity = toNumber(quantityRaw);
      if (!quantityRaw) errors.push("не указано количество");
      else if (!Number.isFinite(quantity)) errors.push(`количество «${quantityRaw}» — не число`);
      else if (quantity <= 0) errors.push("количество должно быть больше 0");

      const unitPrice = toNumber(unitPriceRaw);
      if (!unitPriceRaw) errors.push("не указана цена");
      else if (!Number.isFinite(unitPrice)) errors.push(`цена «${unitPriceRaw}» — не число`);
      else if (unitPrice < 0) errors.push("цена не может быть отрицательной");

      let vatRate = DEFAULT_PASTE_VAT_RATE;
      if (vatRaw) {
        vatRate = toNumber(vatRaw);
        if (!Number.isFinite(vatRate)) errors.push(`НДС «${vatRaw}» — не число`);
        else if (vatRate < 0 || vatRate > 100) errors.push("НДС% должен быть от 0 до 100");
      }

      const key = materialName.toLowerCase();
      const isNewMaterial = !!materialName && !known.has(key);
      if (isNewMaterial) {
        warnings.push(
          seenNew.has(key)
            ? `материал «${materialName}» не найден — будет создан новый (тот же, что в строке ${seenNew.get(key)})`
            : `материал «${materialName}» не найден — будет создан новый`
        );
        if (!seenNew.has(key)) seenNew.set(key, lineNo);
      }

      rows.push({
        lineNo,
        materialName,
        quantity,
        unitPrice,
        vatRate,
        lotNumber: lot || undefined,
        grade: grade || undefined,
        color: color || undefined,
        isNewMaterial,
        errors,
        warnings,
      });
      return;
    }

    rows.push({
      lineNo,
      materialName,
      quantity: NaN,
      unitPrice: NaN,
      vatRate: DEFAULT_PASTE_VAT_RATE,
      isNewMaterial: false,
      errors,
      warnings,
    });
  });

  return {
    rows,
    headerSkipped,
    errorCount: rows.reduce((s, r) => s + r.errors.length, 0),
    warningCount: rows.reduce((s, r) => s + r.warnings.length, 0),
  };
}

/** One human-readable line per problem: "строка 5: …". */
export function issueLines(result: ParseResult): { level: "error" | "warning"; text: string }[] {
  const out: { level: "error" | "warning"; text: string }[] = [];
  for (const r of result.rows) {
    for (const e of r.errors) out.push({ level: "error", text: `строка ${r.lineNo}: ${e}` });
    for (const w of r.warnings) out.push({ level: "warning", text: `строка ${r.lineNo}: ${w}` });
  }
  return out;
}
