// Расчёт «с 4%»: надбавка 4% к цене сырья ТЗ. Чистые функции без обращения к БД.
//
// Цена в учёте — с НДС. Надбавка считается от цены БЕЗ НДС, затем НДС
// начисляется обратно: price4 = incl / (1 + vat) × 1.04 × (1 + vat).
// При постоянной ставке НДС это то же самое, что incl × 1.04, но формула
// явная — важно, если ставка у строки отличается.
//
// К каким строкам списания применяется 4% — флаг ProductionMaterialUsage.commission4
// (по умолчанию true: сырьё и подкладка; не применяется к лоскуту ТЗ 75, фондю,
// бобру 97/104, партии 6).

export const COMMISSION_RATE = 0.04;

/** Ставка НДС в долях: 20 → 0.2; 0.2 → 0.2 (значения > 1 считаются процентами). */
export function vatFraction(vatRate: number): number {
  if (!Number.isFinite(vatRate) || vatRate < 0) return 0;
  return vatRate > 1 ? vatRate / 100 : vatRate;
}

/** Цена с НДС → цена с надбавкой 4% (тоже с НДС). */
export function price4(inclVat: number, vatRate: number): number {
  if (!Number.isFinite(inclVat)) return 0;
  const v = vatFraction(vatRate);
  return (inclVat / (1 + v)) * (1 + COMMISSION_RATE) * (1 + v);
}

/** Сколько добавляет надбавка 4% к цене с НДС. */
export function commission4Amount(inclVat: number, vatRate: number): number {
  return price4(inclVat, vatRate) - inclVat;
}

/** Стоимость строки списания: с надбавкой 4%, если она применяется к этой строке. */
export function lineCostWith4(inclVat: number, vatRate: number, commission4Applies: boolean): number {
  return commission4Applies ? price4(inclVat, vatRate) : inclVat;
}
