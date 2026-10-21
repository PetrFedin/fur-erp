import { InfoHint } from "@/components/info-hint";

/**
 * Единая подпись итоговой строки: «Всего, <единица>» (₽, шт., м, ₽/шт., ₽/м).
 * note — мелкое уточнение («с ремонтом», «без ремонта»); avg — итог является СРЕДНЕВЗВЕШЕННЫМ значением: рядом значок «i» с пояснением.
 * Саму строку оформляет класс .row-total (globals.css): <tr className="row-total">.
 */
export function TotalLabel({ unit = "₽", note, avg = false, extra }: { unit?: string; note?: string; avg?: boolean; extra?: string }) {
  return (
    <>
      <span className="whitespace-nowrap">Всего,&nbsp;{unit}</span>
      {note ? <span className="block text-[11px] font-normal leading-4 opacity-80">{note}</span> : null}
      {extra ? <span className="ml-1.5 text-[11px] font-normal opacity-80">{extra}</span> : null}
      {avg ? <InfoHint label="Что значит «Всего» для средней цены"><p>Средневзвешенное значение: сумма ÷ количество по всем лотам/ТЗ.</p></InfoHint> : null}
    </>
  );
}
