"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { InfoHint } from "@/components/info-hint";
import { patchProductionOrder, setOrderCategory, setOrderFurType, setOrderVat } from "../actions";
import { useConfirm } from "@/components/confirm-dialog";
import { CategoryCell, FurTypeCell, VatCell, type CategoryOpt } from "./param-combos";
import { AreaCell, ComboFrame, DraftInput, SelectCell, TextCell, type SelectOpt } from "./inline-cell";
import { DraftBar, useDraftEdit } from "./change-window";
import { useDirtyMark } from "./edit-guard";
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
 * итоги, «В выпуске», разделы ТЗ / Изделия / Партии / Главная.
 */
export function ParamsTable({ d, o }: { d: ParamsData; o: ParamsOptions }) {
  const ro = !d.canEdit;
  const save = (field: string) => (v: string) => patchProductionOrder(d.orderId, field, v);
  const completed = d.status === "COMPLETED";
  const { ask, node: confirmNode } = useConfirm();
  const [articleKey, setArticleKey] = useState(0);
  const vatEdit = useDraftEdit(d.orderId);
  const vatNow = d.vat.length === 0 ? "—" : d.vat.map((r) => `${r.rate}%`).join(" / ");
  return (
    <section aria-label="Параметры ТЗ" className="flex flex-col gap-2" id="params">
      <div className="flex items-center gap-2">
        <h2 className="block-title">Параметры ТЗ</h2>
        <InfoHint label="Как читать: Параметры ТЗ" wide>
          <p>Что заведено в ТЗ. Клик по значению — правка по месту: у нефинансовых полей Enter или уход курсора сохраняет, Esc отменяет; у финансовых — «Сохранить» / «Отменить». После сохранения пересчитываются итоги страницы, «В выпуске», разделы ТЗ, Изделия, Партии и Главная.</p>
          <p className="mt-1">Любое поле можно выбрать из списка или внести своё: артикул, категория и группа, вид меха, НДС. Категория принадлежит артикулу (меняется у всех его ТЗ), «Вид меха» по умолчанию определяется по списанным лотам. Финансовые поля (кол-во по плану и по факту, работа, НДС) сохраняются кнопкой «Сохранить» после окна «что изменится» (Enter в поле = Сохранить, Esc = отмена); остальные (даты, размер, подкладка, примечание…) сохраняются сразу, рядом появляется «✓ сохранено».</p>
          <p className="mt-1"><b>Партия</b> — поставка пошива: итоги партии, оплаты по партии, Главная; партия 6 — без 4%. Смена партии или заказчика пересчитывает долг по партиям и спрашивает подтверждение. <b>Работа, ₽ за шт.</b> × количество — входит в себестоимость и оплаты за работу (без НДС и 4%). <b>Кол-во по факту</b> — только у ТЗ с оприходованной продукцией: меняет себестоимость единицы и остаток готовой продукции. <b>Окончание</b> — от него зависит год ТЗ в сводках. Сумма НДС списаний — в плитке «НДС в списаниях».</p>
        </InfoHint>
      </div>
      <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-neutral-200 bg-white md:grid-cols-2 md:[&>*:nth-child(odd)]:border-r md:[&>*:nth-child(odd)]:border-neutral-100">
        <Row label="№ ТЗ">
          <TextCell value={d.workOrderNumber} onSave={save("workOrderNumber")} readOnly={ro} label="Номер ТЗ" placeholder={d.number} />
        </Row>
        <Row label="Дата ТЗ">
          <TextCell value={d.workOrderDate} type="date" onSave={save("workOrderDate")} readOnly={ro} label="Дата ТЗ" />
        </Row>
        <Row label="Партия" to={d.batchNumber != null ? `/production/batches/${d.batchNumber}` : undefined} toTitle="Партия пошива: состав и итоги">
          <SelectCell
            value={d.batchId}
            options={o.batches}
            onSave={save("batchId")}
            readOnly={ro}
            label="Партия"
            emptyLabel="Партия не указана"
            confirmChange={completed ? undefined : (next, prev) => {
              const name = (v: string) => o.batches.find((b) => b.value === v)?.label ?? "вне партий";
              return ask(`Сменить партию ТЗ ${d.workOrderNumber || d.number} с «${name(prev)}» на «${name(next)}»? Долг по партиям изменится: работа и оплаты ТЗ перейдут в итоги другой партии.`, { ok: "Сменить партию" });
            }}
          />
        </Row>
        <Row label="Заказчик" to={d.clientId ? `/clients/${d.clientId}` : undefined} toTitle="Карточка заказчика">
          <SelectCell
            value={d.clientId}
            options={o.clients}
            onSave={save("clientId")}
            readOnly={ro}
            label="Заказчик"
            emptyLabel="Собственное производство"
            confirmChange={completed ? undefined : (next, prev) => {
              const name = (v: string) => o.clients.find((c) => c.value === v)?.label ?? "Собственное производство";
              return ask(`Сменить заказчика ТЗ ${d.workOrderNumber || d.number} с «${name(prev)}» на «${name(next)}»? Долг по работе подрядчику и разнесение оплат изменятся.`, { ok: "Сменить заказчика" });
            }}
          />
        </Row>
        <Row label="Договор подряда">
          <TextCell value={d.contractNumber} onSave={save("contractNumber")} readOnly={ro} label="Договор" />
        </Row>
        {d.seasonCode ? (
          <Row label="Сезон">
            <span className="block px-1.5 py-0.5 text-sm">{d.seasonCode}</span>
          </Row>
        ) : null}

        <Row label="Артикул" to={`/articles?q=${encodeURIComponent(d.articleName)}`} toTitle="Артикул в разделе «Изделия»: цена, категория, все его ТЗ">
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
        <Row label="Категория · группа" to="/settings/categories" toTitle="Справочник категорий и групп">
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
        <Row label="Вид меха" to="/settings/furs" toTitle="Справочник видов меха">
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
        <Row label="Материал (из ТЗ)">
          <TextCell value={d.materialDescription} onSave={save("materialDescription")} readOnly={ro} label="Материал продукции" />
        </Row>
        <Row label="Цвет" to="/settings/colors" toTitle="Справочник цветов">
          {d.colorRows.length > 0 || ro ? (
            <span className="block px-1.5 py-0.5 text-sm">{d.colorText || <span className="text-neutral-300">—</span>}</span>
          ) : (
            <ComboFrame onSave={save("color")}>
              {(commit) => <ColorCell current={d.colorText} refId={d.colorRefId} refs={o.colors} canCreate={o.canAddColor} commit={commit} />}
            </ComboFrame>
          )}
        </Row>
        <Row label="Размер(ы)">
          <TextCell value={d.size} onSave={save("size")} readOnly={ro} label="Размер" />
        </Row>
        <Row label="Подкладка (из ТЗ)">
          <TextCell value={d.lining} onSave={save("lining")} readOnly={ro} label="Подкладка" />
        </Row>

        <Row label="Кол-во по плану, шт.">
          <DraftParam orderId={d.orderId} field="plannedQuantity" title="Изменить плановое количество" fieldLabel="Кол-во по плану, шт." value={d.plannedQuantity} step="1" min="1" readOnly={ro} />
        </Row>
        {completed ? <Row label="Кол-во по факту, шт.">
          {completed ? (
            <DraftParam orderId={d.orderId} field="producedQuantity" title="Изменить фактическое количество" fieldLabel="Кол-во по факту, шт." value={d.producedQuantity} step="1" min="0" readOnly={ro} />
          ) : null}
        </Row> : null}
        <Row label="Работа, ₽ за шт.">
          <DraftParam orderId={d.orderId} field="clientWorkPricePerUnit" title="Изменить цену работы" fieldLabel="Работа, ₽ за шт." value={d.clientWorkPricePerUnit} step="0.01" min="0" suffix="₽" readOnly={ro} />
        </Row>
        <Row label="НДС">
          {ro ? (
            <span className="block px-1.5 py-0.5 text-sm">{d.vat.length === 0 ? <span className="text-neutral-300">—</span> : d.vat.map((r) => `${r.rate}%`).join(" / ")}</span>
          ) : (
            <>
              <VatCell
                rates={d.vat.map((r) => r.rate)}
                lines={d.vat.reduce((n, r) => n + r.lines, 0)}
                onSave={(v) => setOrderVat(d.orderId, v)}
                confirmPick={(v) => vatEdit.run("Изменить НДС ТЗ", { kind: "vat", rate: v }, [{ label: "НДС списаний", before: vatNow, after: v.trim() === "" ? "как в лотах" : `${v.trim()}%` }], async () => undefined)}
              />
              {vatEdit.error ? <span className="block px-1.5 text-xs text-red-600">{vatEdit.error}</span> : null}
              {vatEdit.node}
            </>
          )}
        </Row>

        <Row label="Начало">
          <TextCell value={d.startDate} type="date" onSave={save("startDate")} readOnly={ro} label="Дата начала" />
        </Row>
        <Row label="Окончание">
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

/** Финансовое поле ТЗ с явным сохранением: правка копится («Не сохранено»), «Сохранить» (или Enter) → окно «что изменится» → запись. */
function DraftParam({ orderId, field, title, fieldLabel, value, step, min, suffix, readOnly }: {
  orderId: string; field: "plannedQuantity" | "producedQuantity" | "clientWorkPricePerUnit"; title: string; fieldLabel: string; value: string; step: string; min: string; suffix?: string; readOnly: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setDraft(value); }
  const ch = useDraftEdit(orderId);
  const norm = draft.trim().replace(",", ".");
  const dirty = norm !== value.trim();
  useDirtyMark(dirty);
  const cancel = () => { setDraft(value); ch.setError(null); };
  const save = async () => {
    if (!dirty || ch.busy) return;
    const show = (v: string) => (v === "" ? "—" : suffix ? `${v} ${suffix}` : v);
    await ch.run(title, { kind: "param", field, value: norm }, [{ label: fieldLabel, before: show(value), after: show(norm) }], () => patchProductionOrder(orderId, field, norm));
  };
  return (
    <span className="block">
      <DraftInput value={value} draft={draft} onChange={setDraft} onEnter={save} onEscape={cancel} step={step} min={min} align="right" label={fieldLabel} suffix={suffix} readOnly={readOnly} disabled={ch.busy} />
      <DraftBar dirty={dirty} busy={ch.busy} error={ch.error} onSave={save} onCancel={cancel} />
      {ch.node}
    </span>
  );
}
