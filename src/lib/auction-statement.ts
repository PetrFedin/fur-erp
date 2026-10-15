// «За что заплачено» — выдержка из расчёта аукциона: статьи по группам, суммы по лотам, итог.
// Статьи — столбцы листа расчёта, из которых складывается «Себестоимость за единицу» (по формуле этого столбца).
// Ничего не выдумываем: каждая цифра — ячейка листа × количество; букву столбца показываем как источник.
// Если статьи не покрывают итог целиком, остаток выводится отдельной строкой «Не разнесено по статьям», чтобы итог сходился.
import { classifyLabel, type GroupKey } from "@/lib/cost-breakdown-groups";
import type { CalcPayload, CalcTotals } from "@/lib/supplier-calc";

export const STATEMENT_GROUPS: { key: GroupKey; title: string }[] = [
  { key: "auction", title: "Молоток" },
  { key: "auctionFees", title: "Сборы аукциона" },
  { key: "vat", title: "НДС" },
  { key: "processing", title: "Выделка" },
  { key: "delivery", title: "Транспорт и таможня" },
  { key: "commission", title: "Комиссии" },
  { key: "other", title: "Прочее" },
];

export type StatementLine = {
  id: string; label: string; group: GroupKey; letter: string;
  /** ₽ на одну шкуру по строкам расчёта (индекс = строка таблицы) */
  perUnit: number[];
  /** ₽ по лотам (на всё количество) */
  perLot: number[];
  total: number;
  /** сумма в долларах, если столбец в $ */
  usd: number | null;
  manual: number;
  residual?: boolean;
};

export type StatementLot = { index: number; rowId: string; lot: string; fur: string; size: string; invoice: string; qty: number; unit: number; total: number };

export type Statement = {
  lines: StatementLine[];
  lots: StatementLot[];
  total: number;
  qty: number;
  sumLines: number;
  /** расхождение «итог расчёта − сумма статей» до добавления строки остатка */
  gap: number;
  detailed: boolean;
  usdTotal: number | null;
};

/** Убирает служебные хвосты «(в файле X)» из подписей столбцов. */
export const cleanTitle = (t: string) => t.replace(/\s*\((?:в файле|файл)[^)]*\)/gi, "").replace(/\s{2,}/g, " ").trim();

/** only — оставить только строки расчёта, подходящие под условие (например, лоты одного счёта). */
export function buildStatement(p: CalcPayload, t: CalcTotals, only?: (row: Record<string, string>, i: number) => boolean): Statement {
  const sh = t.sheet;
  const unitCol = sh.cols.find((c) => c.id === sh.unitCol);
  const idx = p.rows.map((_, i) => i).filter((i) => sh.used[i] && (!only || only(p.rows[i], i)));
  const rate = t.rate || 1;
  const lots: StatementLot[] = idx.map((i) => {
    const r = p.rows[i];
    return { index: i, rowId: r._id ?? String(i), lot: (r.lot ?? "").trim(), fur: (r.fur ?? "").trim(), size: (r.size ?? "").trim(), invoice: (r.invoice ?? "").trim(), qty: t.qtys[i] ?? 0, unit: t.calcs[i]?.unitRub ?? 0, total: t.calcs[i]?.totalRub ?? 0 };
  });
  const total = lots.reduce((a, l) => a + l.total, 0);
  const qty = lots.reduce((a, l) => a + l.qty, 0);
  const lines: StatementLine[] = [];
  if (unitCol?.formula) {
    const letters = new Set((unitCol.formula.match(/\b[A-Z]{1,2}\b/g) ?? []));
    for (const c of sh.cols) {
      if (!letters.has(c.letter) || c.id === unitCol.id) continue;
      const cells = sh.cells[c.id] ?? [];
      const usd = (c.unit ?? "").includes("$");
      const mult = usd ? rate : 1;
      const inSet = new Set(idx);
      const perUnit = p.rows.map((_, i) => (inSet.has(i) ? (cells[i]?.v ?? 0) * mult : 0));
      const perLot = perUnit.map((v, i) => v * (t.qtys[i] ?? 0));
      const title = cleanTitle(c.title);
      lines.push({
        id: c.id, label: title, group: classifyLabel(title), letter: c.letter, perUnit, perLot,
        total: perLot.reduce((a, b) => a + b, 0),
        usd: usd ? idx.reduce((a, i) => a + (cells[i]?.v ?? 0) * (t.qtys[i] ?? 0), 0) : null,
        manual: idx.filter((i) => cells[i]?.manual).length,
      });
    }
  }
  // Столбец в долларах один: его рублёвая часть = себестоимость строки минус остальные статьи (курс может быть своим у строки: правило столбца «курс»).
  const usdLines = lines.filter((l) => l.usd != null);
  if (usdLines.length === 1) {
    const u = usdLines[0];
    const others = lines.filter((l) => l !== u);
    const inSet = new Set(idx);
    u.perUnit = p.rows.map((_, i) => (inSet.has(i) ? (t.calcs[i]?.unitRub ?? 0) - others.reduce((a, l) => a + l.perUnit[i], 0) : 0));
    u.perLot = u.perUnit.map((v, i) => v * (t.qtys[i] ?? 0));
    u.total = u.perLot.reduce((a, b) => a + b, 0);
  }
  const sumLines = lines.reduce((a, l) => a + l.total, 0);
  const gap = total - sumLines;
  const detailed = lines.length > 0;
  if (detailed && Math.abs(gap) > 0.005) {
    const inSet = new Set(idx);
    const perLot = p.rows.map((_, i) => (inSet.has(i) ? (t.calcs[i]?.totalRub ?? 0) - lines.reduce((a, l) => a + l.perLot[i], 0) : 0));
    lines.push({ id: "_residual", label: "Не разнесено по статьям", group: "other", letter: "", perUnit: perLot.map((v, i) => ((t.qtys[i] ?? 0) > 0 ? v / t.qtys[i] : 0)), perLot, total: gap, usd: null, manual: 0, residual: true });
  }
  const usdLine = lines.find((l) => l.group === "auction" && l.usd != null);
  return { lines, lots, total, qty, sumLines, gap, detailed, usdTotal: usdLine?.usd ?? null };
}

export function groupLines(lines: StatementLine[]) {
  return STATEMENT_GROUPS.map((g) => ({ ...g, lines: lines.filter((l) => l.group === g.key) })).filter((g) => g.lines.length > 0);
}
