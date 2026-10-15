// Чистая часть признака «Платёжный документ: есть / нет» (без базы — проверяется в скриптах).
const norm = (s: string) => s.toLowerCase().replace(/[\s№#]/g, "").replace(/^0+(?=\d)/, "");

export type PayRow = { purchaseId: string | null; invoiceNo: string | null; hasDoc: boolean };

/** Счёт → есть ли хоть одна его оплата с загруженным документом. Возвращает только булевы значения. */
export function paymentDocFlags(purchases: { id: string; invoice: string; number: string }[], pays: PayRow[]): Map<string, boolean> {
  const withDoc = pays.filter((x) => x.hasDoc);
  const byPurchase = new Set(withDoc.map((x) => x.purchaseId).filter((v): v is string => Boolean(v)));
  const byNumber = new Set(withDoc.map((x) => (x.invoiceNo ? norm(x.invoiceNo) : "")).filter(Boolean));
  const out = new Map<string, boolean>();
  for (const p of purchases) {
    const num = p.invoice ? norm(p.invoice) : "";
    out.set(p.id, byPurchase.has(p.id) || (num !== "" && byNumber.has(num)));
  }
  return out;
}
