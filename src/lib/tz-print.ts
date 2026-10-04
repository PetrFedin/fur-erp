import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/prisma";
import { formatDate, formatMoney, formatQty } from "@/lib/utils";
import { lineWith4, usageInput, type Commission4Mode } from "@/lib/commission4";
import type { VatMode } from "@/lib/vat-mode";
import { vatBreakdown } from "@/lib/tz-vat";

// Данные печатной формы ТЗ («ПРИЛОЖЕНИЕ № N к Договору подряда …»).
// Один загрузчик на HTML-страницу печати и на .docx — числа не расходятся.
// Источник — только БД; чего нет в БД, то пустая строка / «—».

const UNIT_LABELS: Record<string, string> = { PIECE: "шт.", KG: "кг", M2: "м²", M: "м", SET: "компл." };

/** Реквизиты договора по умолчанию (по ТЗ владельца), если в самом ТЗ договор не указан. */
export const DEFAULT_CONTRACT = "№ 1605 от 16.05.2025";

export const rub = (v: Decimal.Value) => formatMoney(new Decimal(v).toFixed(2));

export type TzLine = {
  lot: string;
  material: string;
  qty: string;
  unitPrice: string;
  sum: string;
};

export type TzDoc = {
  id: string;
  /** «ПРИЛОЖЕНИЕ № 160» */
  title: string;
  contract: string;
  customer: string;
  orderNumber: string;
  batch: string;
  date: string;
  model: string;
  color: string;
  size: string;
  qty: string;
  workPerUnit: string;
  workSum: string;
  material: string;
  liningText: string;
  hasLining: boolean;
  c4Applied: boolean;
  vatMode: VatMode;
  /** Ставки НДС лотов в списаниях: «НДС по ставке лотов: 20% — …, 22% — …» (пусто, если списаний нет). */
  vatRatesNote: string;
  fur: TzLine[];
  lining: TzLine[];
  expenses: { name: string; description: string; sum: string }[];
  totals: { fur: string; lining: string; expenses: string; work: string; total: string };
  /** Числовые итоги (для проверки/сверки). */
  raw: { fur: string; lining: string; expenses: string; work: string; total: string };
  fileName: string;
};

function contractText(raw: string | null | undefined): string {
  let c = (raw ?? "").replace(/^\s*договор(\s+подряда)?\s*/i, "").replace(/\s*г\.?\s*$/i, "").trim();
  if (!c) c = DEFAULT_CONTRACT;
  if (!/^№/.test(c)) c = `№ ${c}`;
  return `Договору подряда ${c}`;
}

/** «6 6 6 7 7» -> «6×3, 7×2» (как на карточке ТЗ); нестандартную запись не трогаем. */
function collapseSizes(raw: string): string {
  const tokens = raw.split(/[\s,;]+/).filter(Boolean);
  if (tokens.length < 2 || !tokens.every((t) => /^[\dA-Za-zА-Яа-я.\-/]{1,8}$/.test(t))) return raw;
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  if (counts.size === tokens.length) return raw;
  return Array.from(counts, ([t, n]) => (n > 1 ? `${t}×${n}` : t)).join(", ");
}

export async function loadTzDoc(
  id: string,
  organizationId: string,
  c4Mode: Commission4Mode,
  vatMode: VatMode,
): Promise<TzDoc | null> {
  const order = await prisma.productionOrder.findFirst({
    where: { id, organizationId },
    include: {
      productModel: { select: { name: true } },
      client: { select: { name: true } },
      batch: { select: { number: true } },
      materialUsages: { include: { rawMaterial: true, lot: true }, orderBy: { date: "asc" } },
      expenses: { include: { category: true }, orderBy: { date: "asc" } },
    },
  });
  if (!order) return null;

  const c4Applied = c4Mode === "on" && order.materialUsages.some((u) => u.commission4);
  const pick = (l: { incl: Decimal; excl: Decimal }) => (vatMode === "excl" ? l.excl : l.incl);

  let furSum = new Decimal(0);
  let liningSum = new Decimal(0);
  const toLine = (u: (typeof order.materialUsages)[number]): { line: TzLine; sum: Decimal } => {
    const amount = pick(lineWith4(usageInput(u), c4Mode));
    const q = new Decimal(u.quantity);
    const unit = UNIT_LABELS[u.rawMaterial.unit] ?? "";
    return {
      sum: amount,
      line: {
        lot: u.lot.lotNumber?.trim() || "—",
        material: u.rawMaterial.name,
        qty: `${formatQty(q.toString())} ${unit}`.trim(),
        unitPrice: q.isZero() ? "—" : rub(amount.div(q)),
        sum: rub(amount),
      },
    };
  };
  const fur: TzLine[] = [];
  const lining: TzLine[] = [];
  for (const u of order.materialUsages) {
    const r = toLine(u);
    if (u.rawMaterial.unit === "M") {
      lining.push(r.line);
      liningSum = liningSum.add(r.sum);
    } else {
      fur.push(r.line);
      furSum = furSum.add(r.sum);
    }
  }

  const expenseSum = order.expenses.reduce((s, e) => s.add(e.amount), new Decimal(0));
  const qty = order.producedQuantity.greaterThan(0) ? order.producedQuantity : order.plannedQuantity;
  const workPerUnit = order.clientWorkPricePerUnit;
  const work = workPerUnit ? workPerUnit.mul(qty) : new Decimal(0);
  const total = furSum.add(liningSum).add(expenseSum).add(work);

  const vb = vatBreakdown(order.materialUsages, c4Mode);
  const vatRatesNote =
    vb.rows.length === 0
      ? ""
      : `НДС по ставке лота: ${vb.rows.map((r) => `${r.rate}% — ${rub(vatMode === "excl" ? r.excl : r.incl)}`).join(", ")}${vb.kind === "mixed" ? " (смешанные ставки)" : ""}.`;

  const num = order.workOrderNumber?.trim() || order.number;
  const liningText = (order.lining ?? "").trim();
  return {
    id: order.id,
    title: `ПРИЛОЖЕНИЕ № ${num}`,
    contract: contractText(order.contractNumber),
    customer: order.client?.name?.trim() || "",
    orderNumber: order.number,
    batch: order.batch ? String(order.batch.number) : "",
    date: order.workOrderDate ? formatDate(order.workOrderDate) : "",
    model: order.productModel.name,
    color: (order.color ?? "").trim(),
    size: collapseSizes((order.size ?? "").trim()),
    qty: formatQty(qty.toString()),
    workPerUnit: workPerUnit ? rub(workPerUnit) : "—",
    workSum: workPerUnit ? rub(work) : "—",
    material: (order.materialDescription ?? "").trim(),
    liningText,
    hasLining: lining.length > 0 || liningText !== "",
    c4Applied,
    vatMode,
    vatRatesNote,
    fur,
    lining,
    expenses: order.expenses.map((e) => ({
      name: e.category.name,
      description: (e.description ?? "").trim(),
      sum: rub(e.amount),
    })),
    totals: {
      fur: rub(furSum),
      lining: rub(liningSum),
      expenses: rub(expenseSum),
      work: workPerUnit ? rub(work) : "—",
      total: rub(total),
    },
    raw: {
      fur: furSum.toFixed(2),
      lining: liningSum.toFixed(2),
      expenses: expenseSum.toFixed(2),
      work: work.toFixed(2),
      total: total.toFixed(2),
    },
    fileName: `Приложение ${num}${c4Applied ? " (с 4%)" : ""}`,
  };
}
