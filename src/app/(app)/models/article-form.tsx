"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useUnsavedGuard } from "@/lib/use-unsaved-guard";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { InfoHint } from "@/components/info-hint";
import { CategorySelect, type CategorySelectOption } from "@/components/category-select";
import { useKeepingForm } from "@/lib/use-keeping-form";
import { CATEGORY_GROUPS, NO_GROUP } from "@/lib/category-groups";
import { LENGTH_VALUES } from "@/lib/length-class";
import type { ArticleSaveState } from "./actions";

export type ArticleInitial = {
  name: string;
  sku: string;
  lengthClass: string;
  salesCode: string;
  salesName: string;
  aliases: string;
  category: string;
  categoryRefId: string | null;
  sellingPrice: string;
  description: string;
  isActive: boolean;
};

const EMPTY: ArticleInitial = { name: "", sku: "", lengthClass: "", salesCode: "", salesName: "", aliases: "", category: "", categoryRefId: null, sellingPrice: "", description: "", isActive: true };
const initialState: ArticleSaveState = {};
const cardCls = "rounded-lg border border-neutral-200 bg-white p-3";

function Field({ label, children, className, hint, link, htmlFor, error }: { label: string; children: ReactNode; className?: string; hint?: ReactNode; link?: ReactNode; htmlFor?: string; error?: string }) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-center gap-1 text-xs text-neutral-500">
        <Label htmlFor={htmlFor} className="mb-0 text-xs text-neutral-500">{label}</Label>
        {hint ? <InfoHint label={label}>{hint}</InfoHint> : null}
        {link}
      </div>
      {children}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-xs font-medium text-white">{n}</span>
        <h2 className="block-title">{title}</h2>
        {hint ? <InfoHint label={title} wide>{hint}</InfoHint> : null}
      </div>
      {children}
    </section>
  );
}

const priceOk = (raw: string) => {
  const t = raw.replace(/[\s  ]/g, "").replace(",", ".");
  if (t === "") return true;
  if (!/^\d+(\.\d+)?$/.test(t)) return false;
  return Number(t) > 0;
};

/**
 * Форма артикула: и «+ Новый артикул» (одна страница, блоки, проверка до отправки), и правка по месту на карточке.
 * Категория и группа — два уровня справочника: категорию выбирают из справочника или вносят свою, группа берётся из категории
 * (у новой категории группу выбирают здесь). Явное сохранение + «Сохранено» рядом с кнопкой; в режиме «новый» есть «Сохранить и добавить ещё».
 */
export function ArticleForm({
  mode,
  action,
  initial = EMPTY,
  categories,
  canCreateCategory,
  canEdit = true,
  noPrice = false,
  embedded = false,
  onSaved,
  onCancel,
  extraActions,
}: {
  /** Встроена в строку справочника: без заголовка и «Сохранить и добавить ещё». */
  embedded?: boolean;
  /** Вызывается после успешного сохранения правки. */
  onSaved?: () => void;
  /** Показывает кнопку «Закрыть» (справочник артикулов). */
  onCancel?: () => void;
  /** Доп. кнопки рядом с «Сохранить» (например, «Удалить»). */
  extraActions?: ReactNode;
  mode: "new" | "edit";
  action: (prev: ArticleSaveState, formData: FormData) => Promise<ArticleSaveState>;
  initial?: ArticleInitial;
  categories: CategorySelectOption[];
  canCreateCategory: boolean;
  canEdit?: boolean;
  /** Кабинет поставщика: без цены, шаг «Цена» убран, ссылки на карточку и ТЗ не показываются. */
  noPrice?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [resetKey, setResetKey] = useState(0);
  const [createdMsg, setCreatedMsg] = useState<{ id: string; name: string } | null>(null);
  const lastCreated = useRef<number | null>(null);
  useEffect(() => {
    const c = state.created;
    if (c && lastCreated.current !== c.at) {
      lastCreated.current = c.at;
      setCreatedMsg({ id: c.id, name: c.name });
      setResetKey((k) => k + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [state.created]);
  return (
    <div className="flex flex-col gap-3">
      {createdMsg && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Артикул {createdMsg.name} сохранён.{" "}
          {noPrice ? <Link href="/articles" className="font-medium underline">К списку изделий →</Link> : (
            <>
              <Link href={`/models/${createdMsg.id}`} className="font-medium underline">Открыть карточку →</Link>{" "}
              <Link href={`/production/new?article=${createdMsg.id}`} className="font-medium underline">Создать ТЗ →</Link>
            </>
          )}{" "}Форма очищена — вносите следующий.
        </p>
      )}
      <Body key={resetKey} embedded={embedded} onSaved={onSaved} onCancel={onCancel} extraActions={extraActions} mode={mode} initial={initial} categories={categories} canCreateCategory={canCreateCategory} canEdit={canEdit} noPrice={noPrice} state={state} formAction={formAction} pending={pending} />
    </div>
  );
}

function Body({
  mode, initial, categories, canCreateCategory, canEdit, noPrice, state, formAction, pending, embedded, onSaved, onCancel, extraActions,
}: {
  embedded: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
  extraActions?: ReactNode;
  mode: "new" | "edit";
  initial: ArticleInitial;
  categories: CategorySelectOption[];
  canCreateCategory: boolean;
  canEdit: boolean;
  noPrice: boolean;
  state: ArticleSaveState;
  formAction: (fd: FormData) => void;
  pending: boolean;
}) {
  const { setForm: keepRef, onSubmit: keepSubmit } = useKeepingForm(formAction, state, pending);
  const [f, setF] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [catText, setCatText] = useState(initial.category);
  const [catRef, setCatRef] = useState(initial.categoryRefId ?? "");
  const [groupSel, setGroupSel] = useState("");
  const [clientErrs, setClientErrs] = useState<string[]>([]);
  const [shownAt, setShownAt] = useState<number | null>(null);
  const guard = useUnsavedGuard(dirty && !pending);
  const errRef = useRef<HTMLUListElement>(null);
  const set = (k: keyof ArticleInitial) => (e: { target: { value: string } }) => {
    setF((p) => ({ ...p, [k]: e.target.value }));
    setDirty(true);
  };

  // «Сохранено» держим, пока форму не изменили снова.
  const savedAt = state.saved?.at ?? null;
  if (savedAt && savedAt !== shownAt) {
    setShownAt(savedAt);
    setDirty(false);
  }
  useEffect(() => {
    if (savedAt) onSaved?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAt]);
  const justSaved = mode === "edit" && savedAt != null && savedAt === shownAt && !dirty && !pending;

  const refGroup = categories.find((c) => c.id === catRef)?.group ?? null;
  const groupValue = refGroup ?? groupSel;
  const catKnown = !!catRef;
  const serverErrs = state.error ? [state.error] : [];
  const allErrs = clientErrs.length ? clientErrs : serverErrs;
  const fe = state.fields ?? {};

  function validate(): string[] {
    const e: string[] = [];
    if (f.name.trim().length < 2) e.push("Код артикула: не короче 2 символов (например, M012)");
    if (!noPrice && !priceOk(f.sellingPrice)) e.push("Цена продажи: число больше 0 или оставьте пустой");
    return e;
  }
  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    const errs = validate();
    setClientErrs(errs);
    if (errs.length) {
      ev.preventDefault();
      setTimeout(() => errRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 30);
      return;
    }
    keepSubmit(ev);
  };

  const status = (
    <span role="status" className={`text-xs ${justSaved ? "text-emerald-700" : dirty ? "text-amber-700" : "text-neutral-500"}`}>
      {pending ? "Сохраняем…" : justSaved ? "✓ Сохранено" : mode === "edit" && dirty ? "Есть несохранённые изменения" : ""}
    </span>
  );

  return (
    <form ref={keepRef} onSubmit={onSubmit} onChange={() => setDirty(true)} className="flex flex-col gap-5 pb-4" noValidate>
      {guard}
      <input type="hidden" name="isActive" value={f.isActive ? "1" : "0"} />
      <input type="hidden" name="group" value={groupValue} />

      {mode === "new" && !embedded && (
        <header className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-1 py-2">
          <Link href="/articles" className="rounded px-1.5 py-1 text-lg leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900" title="К списку изделий" aria-label="Назад к списку изделий">←</Link>
          <h1 className="text-xl font-semibold">Новый артикул</h1>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/articles" className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">Отмена</Link>
            <Button type="submit" name="intent" value="open" size="sm" disabled={pending}>{pending ? "Сохраняем…" : "Сохранить артикул"}</Button>
          </div>
        </header>
      )}

      {allErrs.length > 0 && (
        <ul ref={errRef} role="alert" className="list-disc rounded-md bg-red-50 px-6 py-2 text-sm text-red-700">
          {allErrs.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}

      <Step n={1} title="Артикул" hint={<><p>Код — наш артикул (как в ТЗ и документах). Код и название в системе продаж и другие написания нужны, чтобы артикул находился по любому из них — в ТЗ, плане, закупках и отчётах.</p><p className="mt-1">Каждое написание принадлежит только одному артикулу: если оно уже записано у другого, форма покажет у какого.</p></>}>
        <div className={`${cardCls} grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
          <Field htmlFor="name" label="Код артикула *" error={fe.name} hint="Наш код: M012, МН-02… Латиница и кириллица в похожих буквах считаются одним написанием.">
            <Input className="ui-field rounded-lg" id="name" name="name" value={f.name} onChange={set("name")} placeholder="M012" disabled={!canEdit} aria-invalid={fe.name ? true : undefined} />
          </Field>
          <Field htmlFor="sku" label="SKU" hint="Наш внутренний SKU, если он отличается от кода артикула. Уникален в пределах организации.">
            <Input className="ui-field rounded-lg" id="sku" name="sku" value={f.sku} onChange={set("sku")} disabled={!canEdit} />
          </Field>
          <Field htmlFor="salesCode" label="Код в продажах" hint="Код этого же изделия в системе продаж. Уходит в сверку продаж и поиск артикула.">
            <Input className="ui-field rounded-lg" id="salesCode" name="salesCode" value={f.salesCode} onChange={set("salesCode")} disabled={!canEdit} />
          </Field>
          <Field htmlFor="salesName" label="Название в продажах" className="sm:col-span-2">
            <Input className="ui-field rounded-lg" id="salesName" name="salesName" value={f.salesName} onChange={set("salesName")} placeholder="Шуба норковая «Милан»" disabled={!canEdit} />
          </Field>
          <Field htmlFor="aliases" label="Другие написания (синонимы)" className="sm:col-span-2 lg:col-span-4" hint="Через запятую или с новой строки. По ним артикул находится в поиске и подбирается при импорте.">
            <Input className="ui-field rounded-lg" id="aliases" name="aliases" value={f.aliases} onChange={set("aliases")} placeholder="М012, M-012" disabled={!canEdit} />
          </Field>
        </div>
      </Step>

      <Step n={2} title="Категория и группа" hint={<><p>Два уровня справочника: группа («Одежда», «Аксессуары») → категория («Пальто», «Шапка»). Выберите категорию из справочника или внесите свою — группа подтянется из категории.</p><p className="mt-1">Куда уходит: группировки и фильтры «Изделий», аналитики, Главной и «ТЗ».</p></>}>
        <div className={`${cardCls} grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
          <Field
            label="Категория"
            className="sm:col-span-1 lg:col-span-2"
            link={<Link href="/settings/categories" target="_blank" className="text-blue-700 hover:underline" title="Справочник категорий и групп">→</Link>}
            hint="Выберите из справочника или введите новую (если есть право — кнопка «Добавить в справочник» заведёт её сразу). Не из справочника — сохранится текстом и попадёт в «Не сопоставлено»."
          >
            <CategorySelect
              id="category"
              refs={categories}
              defaultValue={initial.category}
              defaultRefId={initial.categoryRefId}
              canCreate={canCreateCategory && canEdit}
              placeholder="Пальто"
              onChange={(t, r) => { setCatText(t); setCatRef(r); setDirty(true); }}
            />
          </Field>
          <Field label="Группа" hint={refGroup ? "Группа берётся из категории; менять её — в справочнике категорий." : catKnown ? "У категории группа ещё не задана — выберите: она запишется в категорию." : "Для новой категории выберите группу."}>
            <Select className="ui-field rounded-lg"
              aria-label="Группа"
              value={groupValue}
              disabled={!canEdit || !!refGroup || (!canCreateCategory && catKnown)}
              onChange={(e) => { setGroupSel(e.target.value); setDirty(true); }}
            >
              <option value="">{NO_GROUP}</option>
              {CATEGORY_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
            {catText.trim() && !catKnown && !canCreateCategory ? <p className="mt-1 text-xs text-neutral-500">Категория сохранится текстом; группу задаст технолог в справочнике.</p> : null}
          </Field>
        </div>
      </Step>

      <Step n={3} title={noPrice ? "Длина и описание" : "Цена и описание"} hint={noPrice ? undefined : <><p>Розничная цена — с НДС. Меняется сразу и у ТЗ в плане и в работе; у завершённых ТЗ не меняется. Уходит в наценку «Изделий», «Ценообразования» и Главной.</p><p className="mt-1">Вид меха, цвет и НДС в строках списания задаются в ТЗ — артикул показывает их по своим ТЗ.</p></>}>
        <div className={`${cardCls} grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
          {!noPrice && (
            <Field htmlFor="sellingPrice" label="Розничная цена, ₽ (с НДС)" error={fe.sellingPrice}>
              <Input className="ui-field rounded-lg" id="sellingPrice" name="sellingPrice" inputMode="decimal" value={f.sellingPrice} onChange={set("sellingPrice")} placeholder="не задана" disabled={!canEdit} aria-invalid={fe.sellingPrice ? true : undefined} />
            </Field>
          )}
          <Field htmlFor="lengthClass" label="Длина" hint="Short / Regular / Long по системе продаж; у аксессуаров длины нет.">
            <Select className="ui-field rounded-lg" id="lengthClass" name="lengthClass" value={f.lengthClass} onChange={set("lengthClass")} disabled={!canEdit}>
              <option value="">— без длины —</option>
              {LENGTH_VALUES.map((x) => <option key={x} value={x}>{x}</option>)}
            </Select>
          </Field>
          {mode === "edit" && (
            <Field label="Активный" hint="Неактивный артикул скрыт в выборе при создании ТЗ и плана, но остаётся в отчётах. Так «удаляют» артикул, у которого уже есть ТЗ.">
              <label className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={f.isActive} disabled={!canEdit} onChange={(e) => { setF((p) => ({ ...p, isActive: e.target.checked })); setDirty(true); }} />
                Активный артикул
              </label>
            </Field>
          )}
          <Field htmlFor="description" label="Описание" className="sm:col-span-2 lg:col-span-4">
            <Textarea className="ui-field rounded-lg" id="description" name="description" rows={2} value={f.description} onChange={set("description")} disabled={!canEdit} />
          </Field>
        </div>
      </Step>

      {canEdit && (
        <div className={mode === "new" && !embedded ? "sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center gap-2 border-t border-neutral-200 bg-white px-1 py-2" : "flex flex-wrap items-center gap-2"}>
          {status}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {extraActions}
            {onCancel && <Button type="button" variant="outline" size="sm" onClick={onCancel}>Закрыть</Button>}
            {mode === "new" && !embedded && <Button type="submit" name="intent" value="again" variant="outline" size="sm" disabled={pending}>Сохранить и добавить ещё</Button>}
            <Button type="submit" name="intent" value="open" disabled={pending}>{pending ? "Сохраняем…" : mode === "new" ? "Сохранить артикул" : "Сохранить артикул"}</Button>
          </div>
        </div>
      )}
    </form>
  );
}
