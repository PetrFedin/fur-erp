"use client";

import { useRef, type ReactNode } from "react";
import { InfoHint } from "@/components/info-hint";
import { formatMoney } from "@/lib/utils";
import { patchProductionOrder } from "../actions";
import { AreaCell, ComboFrame, SelectCell, TextCell, type SelectOpt } from "./inline-cell";
import { ArticleSelect } from "@/components/article-select";
import { ColorSelect, type ColorSelectOption } from "@/components/color-select";

export type VatRow = { rate: number; lines: number; incl: string; excl: string };

export type ParamsData = {
  orderId: string;
  canEdit: boolean;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  /** По ТЗ уже есть списания или выпуск — модель менять нельзя. */
  modelLocked: boolean;
  number: string;
  workOrderNumber: string;
  workOrderDate: string;
  contractNumber: string;
  startDate: string;
  endDate: string;
  seasonCode: string | null;
  batchId: string;
  clientId: string;
  productModelId: string;
  category: string;
  group: string;
  furType: string;
  materialDescription: string;
  lining: string;
  colorRefId: string;
  /** Цвет текстом, если его нет в справочнике (или составной цвет). */
  colorText: string;
  size: string;
  plannedQuantity: string;
  producedQuantity: string;
  clientWorkPricePerUnit: string;
  workSum: string | null;
  rawWarehouseId: string;
  finishedWarehouseId: string;
  notes: string;
  vat: VatRow[];
  /** Сумма НДС внутри цен списанных лотов (как плитка «НДС в списаниях»). */
  vatAmount: string;
  /** Составной цвет: цвет · кол-во · размеры. */
  colorRows: { name: string; quantity: string; sizes: string }[];
};

export type ParamsOptions = {
  models: SelectOpt[];
  clients: SelectOpt[];
  batches: SelectOpt[];
  warehouses: SelectOpt[];
  colors: ColorSelectOption[];
  canAddColor: boolean;
};

function Row({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={"flex min-w-0 items-start border-b border-neutral-100 " + (wide ? "md:col-span-2" : "")}>
      <div className="flex w-36 shrink-0 items-center gap-1 self-stretch bg-neutral-50/70 px-2 py-1.5 text-xs text-neutral-500 sm:w-44">
        <span>{label}</span>
        {hint ? <InfoHint label={label}>{hint}</InfoHint> : null}
      </div>
      <div className="min-w-0 flex-1 px-1 py-1">{children}</div>
    </div>
  );
}

const STATUS_RU: Record<string, string> = { PLANNED: "Запланирован", IN_PROGRESS: "В работе", COMPLETED: "Завершён", CANCELLED: "Отменён" };

/**
 * «Параметры ТЗ»: поле → значение, всё правится по месту (Enter или уход фокуса сохраняет).
 * Сохранение идёт через те же проверки, что у формы «Изменить»; после правки страница пересчитывается:
 * итоги, «Произведено», разделы ТЗ / Изделия / Партии / Главная.
 */
export function ParamsTable({ d, o }: { d: ParamsData; o: ParamsOptions }) {
  const ro = !d.canEdit;
  const save = (field: string) => (v: string) => patchProductionOrder(d.orderId, field, v);
  const completed = d.status === "COMPLETED";
  return (
    <section aria-label="Параметры ТЗ" className="flex flex-col gap-2" id="params">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Параметры ТЗ</h2>
        <InfoHint label="Как читать: Параметры ТЗ" wide>
          <p>Что заведено в ТЗ. Клик по значению — правка по месту: Enter или уход курсора сохраняет, Esc отменяет. После сохранения пересчитываются итоги страницы, «Произведено», разделы ТЗ, Изделия, Партии и Главная.</p>
          <p className="mt-1">Серые поля считаются сами: категория и группа — из артикула (в карточке изделия, там же розничная цена), вид меха — из списанных лотов. Сохранение автоматическое: рядом с полем появляется «✓ сохранено».</p>
        </InfoHint>
      </div>
      <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-neutral-200 bg-white md:grid-cols-2 md:[&>*:nth-child(odd)]:border-r md:[&>*:nth-child(odd)]:border-neutral-100">
        <Row label="№ ТЗ" hint={<>Внутренний номер заказа в системе: {d.number}.</>}>
          <TextCell value={d.workOrderNumber} onSave={save("workOrderNumber")} readOnly={ro} label="Номер ТЗ" placeholder={d.number} />
        </Row>
        <Row label="Дата ТЗ">
          <TextCell value={d.workOrderDate} type="date" onSave={save("workOrderDate")} readOnly={ro} label="Дата ТЗ" />
        </Row>
        <Row label="Партия" hint="Партия пошива (поставка). Смена партии сбрасывает подтверждение старой партии.">
          <SelectCell value={d.batchId} options={o.batches} onSave={save("batchId")} readOnly={ro} label="Партия" emptyLabel="Партия не указана" />
        </Row>
        <Row label="Заказчик">
          <SelectCell value={d.clientId} options={o.clients} onSave={save("clientId")} readOnly={ro} label="Заказчик" emptyLabel="Собственное производство" />
        </Row>
        <Row label="Договор подряда" hint="№ и дата договора подряда.">
          <TextCell value={d.contractNumber} onSave={save("contractNumber")} readOnly={ro} label="Договор" />
        </Row>
        <Row label="Статус">
          <span className="block px-1.5 py-0.5 text-sm">{STATUS_RU[d.status]}{d.seasonCode ? <span className="text-neutral-500"> · сезон {d.seasonCode}</span> : null}</span>
        </Row>

        <Row label="Артикул" hint={d.modelLocked ? "По ТЗ уже списано сырьё или зафиксирован выпуск — артикул изменить нельзя, заведите новое ТЗ." : "Выберите из справочника или «Ввести новый артикул» — он сохранится в справочник. Смена артикула меняет категорию и группу."}>
          {ro || d.modelLocked ? (
            <span className="block px-1.5 py-0.5 text-sm">{o.models.find((m) => m.value === d.productModelId)?.label}</span>
          ) : (
            <ComboFrame onSave={save("productModelId")}>
              {(commit) => <ArticleSelect name="productModelId" defaultValue={d.productModelId} onChange={(a) => { if (a && a.id !== d.productModelId) commit(a.id); }} />}
            </ComboFrame>
          )}
        </Row>
        <Row label="Категория · группа" hint="Берутся из карточки артикула.">
          <span className="block px-1.5 py-0.5 text-sm text-neutral-600">{d.category}{d.group && d.group !== "Без группы" ? ` · ${d.group}` : ""}</span>
        </Row>
        <Row label="Вид меха" hint="Определяется по списанным лотам; если списаний нет — не определён.">
          <span className="block px-1.5 py-0.5 text-sm text-neutral-600">{d.furType || <span className="text-neutral-300">—</span>}</span>
        </Row>
        <Row label="Материал (из ТЗ)" hint="Описание материала так, как оно записано в ТЗ.">
          <TextCell value={d.materialDescription} onSave={save("materialDescription")} readOnly={ro} label="Материал продукции" />
        </Row>
        <Row label="Цвет" hint={d.colorRows.length > 0 ? "Составной цвет: правится кнопкой «Изменить цвета» в меню «⋯» шапки." : "Выберите из справочника или введите своё — новый цвет можно добавить в справочник."}>
          {d.colorRows.length > 0 || ro ? (
            <span className="block px-1.5 py-0.5 text-sm">{d.colorText || <span className="text-neutral-300">—</span>}</span>
          ) : (
            <ComboFrame onSave={save("color")}>
              {(commit) => <ColorCell current={d.colorText} refId={d.colorRefId} refs={o.colors} canCreate={o.canAddColor} commit={commit} />}
            </ComboFrame>
          )}
        </Row>
        <Row label="Размер(ы)" hint="Как записано в ТЗ, например «42, 44, 46» или «6 6 7».">
          <TextCell value={d.size} onSave={save("size")} readOnly={ro} label="Размер" />
        </Row>
        <Row label="Подкладка (из ТЗ)">
          <TextCell value={d.lining} onSave={save("lining")} readOnly={ro} label="Подкладка" />
        </Row>

        <Row label="Кол-во по плану, шт." hint="Плановое количество. Не может быть меньше уже произведённого.">
          <TextCell value={d.plannedQuantity} type="number" step="1" min="1" align="right" onSave={save("plannedQuantity")} readOnly={ro} label="Плановое количество" />
        </Row>
        <Row label="Кол-во по факту, шт." hint="Фактический выпуск — у завершённого ТЗ. Меняет себестоимость единицы и остаток готовой продукции на складе.">
          {completed ? (
            <TextCell value={d.producedQuantity} type="number" step="1" min="0" align="right" onSave={save("producedQuantity")} readOnly={ro} label="Фактически произведено" />
          ) : (
            <span className="block px-1.5 py-0.5 text-sm text-neutral-400">появится при завершении</span>
          )}
        </Row>
        <Row label="Работа, ₽ за шт." hint="Цена работы для заказчика за единицу. Сумма работы = цена × количество считается сама — в блоке «Расчёт».">
          <TextCell value={d.clientWorkPricePerUnit} type="number" step="0.01" min="0" align="right" onSave={save("clientWorkPricePerUnit")} readOnly={ro} label="Стоимость работ за ед." suffix="₽" />
        </Row>
        <Row
          label="НДС"
          hint={
            <>
              <p>Ставка НДС — у лота (закупки 2025 г. — 20%, 2026 г. и далее — 22%). Суммы считаются построчно по каждому списанию.</p>
              <p className="mt-1">Менять ставку можно только в закупке, из которой пришёл лот (ссылка «закупка» в таблице «Расчёт и списание»): она общая для всех ТЗ, которые лот списывают. Показ «С НДС / Без НДС» — переключатель в шапке.</p>
            </>
          }
        >
          <span className="block px-1.5 py-0.5 text-sm">
            {d.vat.length === 0 ? <span className="text-neutral-300">—</span> : d.vat.map((r) => `${r.rate}%`).join(" / ")}
            {d.vat.length > 0 ? <span className="text-neutral-500"> · {d.vat.reduce((s, r) => s + r.lines, 0)} спис.</span> : null}
          </span>
        </Row>
        <Row label="НДС в списаниях, ₽" hint="Сумма НДС внутри цен списанных лотов (без надбавки 4%). Входит в суммы «С НДС», не входит в «Без НДС». Совпадает с плиткой «НДС в списаниях».">
          <span className="block px-1.5 py-0.5 text-right text-sm tabular-nums text-neutral-600">
            {Number(d.vatAmount) < 0.5 ? <span className="text-neutral-300">—</span> : formatMoney(Math.round(Number(d.vatAmount)))}
          </span>
        </Row>

        <Row label="Начало">
          <TextCell value={d.startDate} type="date" onSave={save("startDate")} readOnly={ro} label="Дата начала" />
        </Row>
        <Row label="Окончание" hint="Проставляется при завершении ТЗ.">
          <span className="block px-1.5 py-0.5 text-sm text-neutral-600">{d.endDate || <span className="text-neutral-300">—</span>}</span>
        </Row>
        <Row label="Склад сырья" hint="Откуда списывается сырьё.">
          <SelectCell value={d.rawWarehouseId} options={o.warehouses} onSave={save("rawWarehouseId")} readOnly={ro} label="Склад сырья" />
        </Row>
        <Row label="Склад готовой продукции" hint="Куда принимаются готовые изделия при завершении.">
          <SelectCell value={d.finishedWarehouseId} options={o.warehouses} onSave={save("finishedWarehouseId")} readOnly={ro} label="Склад готовой продукции" />
        </Row>
        <Row label="Примечание" wide>
          <AreaCell value={d.notes} onSave={save("notes")} readOnly={ro} label="Примечание" />
        </Row>
      </div>
      {d.colorRows.length > 0 ? (
        <div className="table-scroll scroll-hint overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-xs text-neutral-500">
                <th className="px-2 py-1.5 text-left font-medium">Цвет (позиция ТЗ)</th>
                <th className="px-2 py-1.5 text-right font-medium">Кол-во, шт.</th>
                <th className="px-2 py-1.5 text-left font-medium">Размеры</th>
              </tr>
            </thead>
            <tbody>
              {d.colorRows.map((c, i) => (
                <tr key={i} className="border-b border-neutral-100">
                  <td className="px-2 py-1.5">{c.name}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{c.quantity || <span className="text-neutral-300">—</span>}</td>
                  <td className="px-2 py-1.5">{c.sizes || <span className="text-neutral-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/** Цвет: выбор из справочника сохраняется сразу, свободный ввод — при уходе фокуса (не на каждую букву). */
function ColorCell({ current, refId, refs, canCreate, commit }: { current: string; refId: string; refs: ColorSelectOption[]; canCreate: boolean; commit: (v: string) => void }) {
  const latest = useRef(current);
  return (
    <span
      className="block"
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        if (latest.current.trim() !== current.trim()) commit(latest.current);
      }}
    >
      <ColorSelect
        refs={refs}
        canCreate={canCreate}
        defaultValue={current}
        defaultRefId={refId || null}
        onChange={(text, id) => {
          latest.current = text;
          if (id && text.trim() !== current.trim()) commit(text);
        }}
      />
    </span>
  );
}
