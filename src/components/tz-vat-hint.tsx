"use client";

import { TotalLabel } from "@/components/total-label";

export type TzVatHintRow = { rate: string; lines: number; incl: string; excl: string; vat: string };

/**
 * Тело подсказки «Ставки НДС в списаниях ТЗ». Клиентский компонент: пояснительный текст и разметка таблицы живут в сборке браузера один раз,
 * а в страницу уходят только цифры строк (иначе одна и та же таблица с текстом повторялась бы в данных страницы для каждой строки ТЗ).
 */
export function TzVatHintBody({ rows, total }: { rows: TzVatHintRow[]; total: Omit<TzVatHintRow, "rate"> | null }) {
  return (
    <>
      <b>Ставки НДС в списаниях этого ТЗ</b>
      <p className="mt-1">
        Ставка НДС — у лота: закупки 2025 г. — 20%, 2026 г. и далее — 22% (по УПД). В одном ТЗ могут быть лоты разных закупок и лет, поэтому и ставки разные.
      </p>
      <table className="mt-1 w-full text-xs">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="pr-2 font-normal">Ставка</th>
            <th className="pr-2 font-normal">Строк</th>
            <th className="pr-2 text-right font-normal">С НДС</th>
            <th className="pr-2 text-right font-normal">Без НДС</th>
            <th className="text-right font-normal">НДС</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rate}>
              <td className="pr-2">{r.rate}%</td>
              <td className="pr-2">{r.lines}</td>
              <td className="pr-2 text-right">{r.incl}</td>
              <td className="pr-2 text-right">{r.excl}</td>
              <td className="text-right">{r.vat}</td>
            </tr>
          ))}
          {total && (
            <tr className="row-total">
              <td className="pr-2"><TotalLabel /></td>
              <td className="pr-2">{total.lines}</td>
              <td className="pr-2 text-right">{total.incl}</td>
              <td className="pr-2 text-right">{total.excl}</td>
              <td className="text-right">{total.vat}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="mt-1">
        Σ с НДС = Σ (количество × цена лота с его ставкой), Σ без НДС = Σ (количество × цена лота без НДС): каждая строка по ставке своего лота, а не итог × одна ставка. Сырьё и подкладка (расходы и работа в таблице не участвуют).
      </p>
    </>
  );
}
