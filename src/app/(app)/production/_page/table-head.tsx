import { InfoHint } from "@/components/info-hint";
import type { thSort } from "@/lib/table-sort";
import { Thead, Tr, Th } from "@/components/ui/table";
import { VatLabel } from "@/components/vat-label";
import { GH, BLH } from "./config";

/** Шапка таблицы ТЗ: надзаголовки блоков и колонки с сортировкой по клику. */
export function ProductionTableHead({ tth, c4 }: { tth: (k: string) => ReturnType<typeof thSort>; c4: string }) {
  return (
    <Thead>
      <Tr>
        <Th colSpan={5} aria-hidden />
        <Th colSpan={2} className={GH + BLH}>Производство</Th>
        <Th colSpan={3} className={GH + BLH}>Сырьё</Th>
        <Th colSpan={3} className={GH + BLH}>Итого</Th>
      </Tr>
      <Tr>
        <Th {...tth("batch")}>Партия</Th>
        <Th {...tth("tz")}>ТЗ</Th>
        <Th>Поставлен</Th>
        <Th {...tth("fur")}>Мех</Th>
        <Th {...tth("article")}>Артикул</Th>
        <Th {...tth("units")} className={"text-right" + BLH} unit="шт.">Изделий</Th>
        <Th {...tth("hides")} className="text-right" unit="шт.">Шкур</Th>
        <Th {...tth("furSum")} className={"text-right" + BLH} unit="₽"><VatLabel base="Мех" /></Th>
        <Th {...tth("liningQty")} className="text-right" unit="м">Подкладка</Th>
        <Th {...tth("liningSum")} className="text-right" unit="₽"><VatLabel base="Подкладка" /></Th>
        <Th {...tth("work")} className={"text-right" + BLH} unit="₽">Работа</Th>
        <Th {...tth("full")} className="text-right" unit="₽" after={<InfoHint label="Из чего складывается себестоимость">Мех + подкладка + надбавка 4 % (если включена) + работа + расходы ТЗ (фурнитура, прочие расходы). Расходов отдельной колонки нет, поэтому сумма колонок слева может быть меньше итога.</InfoHint>}>
          <VatLabel base={`Себестоимость с работой${c4}`} />
        </Th>
        <Th>НДС</Th>
      </Tr>
    </Thead>
  );
}
