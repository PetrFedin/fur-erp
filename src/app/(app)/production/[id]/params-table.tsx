"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { InfoHint } from "@/components/info-hint";
import { formatMoney } from "@/lib/utils";
import { patchProductionOrder, setOrderCategory, setOrderFurType, setOrderVat } from "../actions";
import { useConfirm } from "@/components/confirm-dialog";
import { CategoryCell, FurTypeCell, VatCell, type CategoryOpt } from "./param-combos";
import { AreaCell, ComboFrame, SelectCell, TextCell, type SelectOpt } from "./inline-cell";
import { ArticleSelect } from "@/components/article-select";
import { ColorSelect, type ColorSelectOption } from "@/components/color-select";

export type VatRow = { rate: number; lines: number; incl: string; excl: string };

export type ParamsData = {
  orderId: string;
  canEdit: boolean;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  /** По ТЗ уже есть списания или выпуск — смена артикула требует подтверждения (списания и себестоимость остаются). */
  modelLocked: boolean;
  number: string;
  workOrderNumber: string;
  workOrderDate: string;
  contractNumber: string;
  startDate: string;
  endDate: string;
  /** Дата окончания в формате ГГГГ-ММ-ДД для правки. */
  endDateIso: string;
  seasonCode: string | null;
  batchId: string;
  batchNumber: number | null;
  articleName: string;
  clientId: string;
  productModelId: string;
  category: string;
  /** Ссылка категории артикула на справочник ("" — категория текстом / не задана). */
  categoryRefId: string;
  group: string;
  /** Сколько ТЗ у этого артикула (для подтверждения смены категории). */
  articleTzCount: number;
  /** Вид меха, который виден во всех разделах (ручной, иначе по списаниям). */
  furType: string;
  /** Ручной вид меха ТЗ ("" — определяется по списаниям). */
  furTypeOverride: string;
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
  categories: CategoryOpt[];
  furs: string[];
  canAddCategory: boolean;
  canAddFur: boolean;
};

function Row({ label, hint, children, wide, to, toTitle }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean; to?: string; toTitle?: string }) {
  return (
    <div className={"flex min-w-0 items-start border-b border-neutral-100 " + (wide ? "md:col-span-2" : "")}>
      <div className="flex w-36 shrink-0 items-center gap-1 self-stretch bg-neutral-50/70 px-2 py-1.5 text-xs text-neutral-500 sm:w-44">
        <span>{label}</span>
        {hint ? <InfoHint label={label}>{hint}</InfoHint> : null}
        {to ? <Link href={to} className="text-blue-700 hover:underline" title={toTitle ?? "Открыть источник"} aria-label={`${label}: открыть источник`}>→</Link> : null}
      </div>
      <div className="min-w-0 flex-1 px-1 py-1">{children}</div>
    </div>
  );
}


/**
 * «Параметры ТЗ»: поле → значение, всё правится по месту (Enter или уход фокуса сохраняет).
 * Сохранение идёт через те же проверки, что у формы «Изменить»; после правки страница пересчитывается:
 * итоги, «Произведено», разделы ТЗ / Изделия / Партии / Главная.
 */
export function ParamsTable({ d, o }: { d: ParamsData; o: ParamsOptions }) {
  const ro = !d.canEdit;
  const save = (field: string) => (v: string) => patchProductionOrder(d.orderId, field, v);
  const completed = d.status === "COMPLETED";
  const { ask, node: confirmNode } = useConfirm();
  const [articleKey, setArticleKey] = useState(0);
  return (
    <section aria-label="Параметры ТЗ" className="flex flex-col gap-2" id="params">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Параметры ТЗ</h2>
        <InfoHint label="Как читать: Параметры ТЗ" wide>
          <p>Что заведено в ТЗ. Клик по значению — правка по месту: Enter или уход курсора сохраняет, Esc отменяет. После сохранения пересчитываются итоги страницы, «Произведено», разделы ТЗ, Изделия, Партии и Главная.</p>
          <p className="mt-1">Любое поле можно выбрать из списка или внести своё: артикул, категория и группа, вид меха, НДС. Категория принадлежит артикулу (меняется у всех его ТЗ), «Вид меха» по умолчанию определяется по списанным лотам. Сохранение автоматическое: рядом с полем появляется «✓ сохранено».</p>
        </InfoHint>
      </div>
      <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-neutral-200 bg-white md:grid-cols-2 md:[&>*:nth-child(odd)]:border-r md:[&>*:nth-child(odd)]:border-neutral-100">
        <Row label="№ ТЗ" hint={<>Внутренний номер заказа в системе: {d.number}.</>}>
          <TextCell value={d.workOrderNumber} onSave={save("workOrderNumber")} readOnly={ro} label="Номер ТЗ" placeholder={d.number} />
        </Row>
        <Row label="Дата ТЗ">
          <TextCell value={d.workOrderDate} type="date" onSave={save("workOrderDate")} readOnly={ro} label="Дата ТЗ" />
        </Row>
        <Row label="Партия" to={d.batchNumber != null ? `/production/batches/${d.batchNumber}` : undefined} toTitle="Партия пошива: состав и итоги" hint="Партия пошива (поставка): справочник «Партии пошива». Куда уходит: итоги партии, оплаты по партии, Главная, Календарь. Партия 6 — без надбавки 4%. Смена партии сбрасывает подтверждение старой партии.">
          <SelectCell value={d.batchId} options={o.batches} onSave={save("batchId")} readOnly={ro} label="Партия" emptyLabel="Партия не указана" />
        </Row>
        <Row label="Заказчик" to={d.clientId ? `/clients/${d.clientId}` : undefined} toTitle="Карточка заказчика">
          <SelectCell value={d.clientId} options={o.clients} onSave={save("clientId")} readOnly={ro} label="Заказчик" emptyLabel="Собственное производство" />
        </Row>
        <Row label="Договор подряда" hint="№ и дата договора подряда.">
          <TextCell value={d.contractNumber} onSave={save("contractNumber")} readOnly={ro} label="Договор" />
        </Row>
        {d.seasonCode ? (
          <Row label="Сезон">
            <span className="block px-1.5 py-0.5 text-sm">{d.seasonCode}</span>
          </Row>
        ) : null}

        <Row label="Артикул" to={`/articles?q=${encodeURIComponent(d.articleName)}`} toTitle="Артикул в разделе «Изделия»: цена, категория, все его ТЗ" hint="Выберите из справочника или «Ввести новый артикул» — он сохранится в справочник. Смена артикула меняет категорию и группу (они берутся у артикула). Если по ТЗ уже есть списания или выпуск, они и себестоимость остаются — меняется только артикул ТЗ.">
          {ro ? (
            <span className="block px-1.5 py-0.5 text-sm">{o.models.find((m) => m.value === d.productModelId)?.label}</span>
          ) : (
            <ComboFrame onSave={save("productModelId")}>
              {(commit) => (
                <ArticleSelect
                  key={articleKey}
                  name="productModelId"
                  defaultValue={d.productModelId}
                  onChange={async (a) => {
                    if (!a || a.id === d.productModelId) return;
                    if (d.modelLocked && !(await ask("Списания и себестоимость остаются, изменится только артикул ТЗ. Сменить артикул?", { ok: "Сменить артикул" }))) {
                      setArticleKey((k) => k + 1);
                      return;
                    }
                    commit(a.id);
                  }}
                />
              )}
            </ComboFrame>
          )}
        </Row>
        <Row label="Категория · группа" to="/settings/categories" toTitle="Справочник категорий и групп" hint="Выберите группу (Одежда / Аксессуары), затем категорию из справочника или «Внести новую». Категория принадлежит артикулу: смена затрагивает все ТЗ этого артикула (спросим подтверждение).">
          {ro ? (
            <span className="block px-1.5 py-0.5 text-sm text-neutral-600">{d.category}{d.group && d.group !== "Без группы" ? ` · ${d.group}` : ""}</span>
          ) : (
            <CategoryCell
              categoryRefId={d.categoryRefId}
              categoryText={d.category}
              group={d.group === "Без группы" ? "" : d.group}
              categories={o.categories}
              tzCount={d.articleTzCount}
              canCreate={o.canAddCategory}
              onSave={(id) => setOrderCategory(d.orderId, id)}
            />
          )}
        </Row>
        <Row label="Вид меха" to="/settings/furs" toTitle="Справочник видов меха" hint="Выберите вид из справочника меха или «Внести свой». «По списаниям» — вид определяется по списанным лотам (как раньше). Ручной вид показывается во всех разделах: Главная, ТЗ, Изделия, Календарь; фильтры по лотам и таблица «Мех / Подкладка» считаются по сырью лотов и ручной вид не учитывают.">
          {ro ? (
            <span className="block px-1.5 py-0.5 text-sm">{d.furType || <span className="text-neutral-300">—</span>}</span>
          ) : (
            <FurTypeCell
              value={d.furTypeOverride}
              furs={o.furs}
              autoLabel={d.furTypeOverride ? "По списаниям (авто)" : `По списаниям${d.furType ? ` · ${d.furType}` : " · не определён"}`}
              canCreate={o.canAddFur}
              onSave={(v) => setOrderFurType(d.orderId, v)}
            />
          )}
        </Row>
        <Row label="Материал (из ТЗ)" hint="Описание материала так, как оно записано в ТЗ.">
          <TextCell value={d.materialDescription} onSave={save("materialDescription")} readOnly={ro} label="Материал продукции" />
        </Row>
        <Row label="Цвет" to="/settings/colors" toTitle="Справочник цветов" hint={d.colorRows.length > 0 ? "Составной цвет: правится кнопкой «Изменить цвета» в меню «⋯» шапки." : "Выберите из справочника или введите своё — новый цвет можно добавить в справочник."}>
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

        <Row label="Кол-во по плану, шт." hint={<><p>Плановое количество. Не может быть меньше уже произведённого.</p><p className="mt-1"><b>Куда уходит:</b> «Произведено» и «Изделия» (у завершённого — по факту), себестоимость на 1 изделие, сумма работы и оплаты заказчика, план/факт в партии и календаре.</p></>}>
          <TextCell value={d.plannedQuantity} type="number" step="1" min="1" align="right" onSave={save("plannedQuantity")} readOnly={ro} label="Плановое количество" />
        </Row>
        <Row label="Кол-во по факту, шт." hint="Фактический выпуск — у завершённого ТЗ. Меняет себестоимость единицы и остаток готовой продукции на складе.">
          {completed ? (
            <TextCell value={d.producedQuantity} type="number" step="1" min="0" align="right" onSave={save("producedQuantity")} readOnly={ro} label="Фактически произведено" />
          ) : (
            <span className="block px-1.5 py-0.5 text-sm text-neutral-400">появится при завершении</span>
          )}
        </Row>
        <Row label="Работа, ₽ за шт." hint={<><p>Цена работы для заказчика за единицу. Сумма работы = цена × количество считается сама — в блоке «Расчёт».</p><p className="mt-1"><b>Куда уходит:</b> входит в себестоимость ТЗ (без НДС и без 4%), в «Оплаты → Заказчики» (сколько заказчик должен за работу) и в Главную.</p></>}>
          <TextCell value={d.clientWorkPricePerUnit} type="number" step="0.01" min="0" align="right" onSave={save("clientWorkPricePerUnit")} readOnly={ro} label="Стоимость работ за ед." suffix="₽" />
        </Row>
        <Row
          label="НДС"
          hint={
            <>
              <p>Ставка НДС всех строк списания этого ТЗ: 22 (по умолчанию для закупок 2026 г.), 20 (2025 г.) или своя. «Как в лотах» — у каждой строки ставка её лота. Отдельную строку можно поправить в таблице «Расчёт».</p>
              <p className="mt-1">Сумма с НДС (цена лота) не меняется — пересчитывается разбивка «без НДС / НДС». Работа заказчику считается без НДС (в учёте ставка у работы не ведётся). Показ «С НДС / Без НДС» — переключатель в шапке.</p>
            </>
          }
        >
          {ro ? (
            <span className="block px-1.5 py-0.5 text-sm">{d.vat.length === 0 ? <span className="text-neutral-300">—</span> : d.vat.map((r) => `${r.rate}%`).join(" / ")}</span>
          ) : (
            <VatCell rates={d.vat.map((r) => r.rate)} lines={d.vat.reduce((n, r) => n + r.lines, 0)} onSave={(v) => setOrderVat(d.orderId, v)} />
          )}
        </Row>
        <Row label="НДС в списаниях, ₽" hint="Сумма НДС внутри цен списанных лотов (без надбавки 4%). Входит в суммы «С НДС», не входит в «Без НДС». Совпадает с плиткой «НДС в списаниях».">
          <span className="block px-1.5 py-0.5 text-right text-sm tabular-nums text-neutral-600">
            {Number(d.vatAmount) < 0.5 ? <span className="text-neutral-300">—</span> : formatMoney(Math.round(Number(d.vatAmount)))}
          </span>
        </Row>

        <Row label="Начало">
          <TextCell value={d.startDate} type="date" onSave={save("startDate")} readOnly={ro} label="Дата начала" />
        </Row>
        <Row label="Окончание" hint="Проставляется при завершении ТЗ; при необходимости правится вручную (от даты окончания зависит год ТЗ в сводках).">
          <TextCell value={d.endDateIso} type="date" onSave={save("endDate")} readOnly={ro} label="Дата окончания" />
        </Row>
        <Row label="Примечание" wide>
          <AreaCell value={d.notes} onSave={save("notes")} readOnly={ro} label="Примечание" />
        </Row>
      </div>
      {confirmNode}
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
