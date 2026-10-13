/**
 * Копеечное округление между «Куплено» (Главная: сумма лотов, цена за единицу хранится округлённой) и «Оплачено + К оплате» (по документам закупок).
 * Только отображение: плитки «Общая стоимость» показывают эту разницу отдельной строкой «Округление», чтобы итог совпал с «Куплено» до рубля.
 * Больше 5 ₽ — это уже не округление (фильтры выборки, неполученный мех): тогда 0.
 */
type Side = { incl: { recvValue: number } };
export function rawRounding(
  d: { raw: { fur: Side; lining: Side }; paidByItem: { fur: number; lining: number }; left: { fur: number; lining: number } },
  kinds: { fur?: boolean; lining?: boolean } = { fur: true, lining: true },
): number {
  const part = (recv: number, paid: number, left: number) => {
    const diff = recv - (paid + left);
    return Math.abs(diff) < 0.005 || Math.abs(diff) > 5 ? 0 : diff;
  };
  return (kinds.fur ? part(d.raw.fur.incl.recvValue, d.paidByItem.fur, d.left.fur) : 0) + (kinds.lining ? part(d.raw.lining.incl.recvValue, d.paidByItem.lining, d.left.lining) : 0);
}
