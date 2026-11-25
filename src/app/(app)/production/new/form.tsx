"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import type { CreateOrderState } from "../actions";
import { ColorSelect, type ColorSelectOption } from "@/components/color-select";
import { ArticleSelect } from "@/components/article-select";
import { InfoHint } from "@/components/info-hint";
import { createFurInline } from "@/app/(app)/settings/furs/actions";
import { useKeepingForm } from "@/lib/use-keeping-form";
import { parseLotLines } from "@/lib/lot-lines";
import { defaultCommission4, COMMISSION_RATE } from "@/lib/commission4-const";
import { draftTotals, vatByRate, type CalcLine } from "@/lib/tz-calc";
import { formatQty, formatMoney, formatDec1 } from "@/lib/utils";
import type { LotOpt } from "./lot-picker";
import { useConfirm } from "@/components/confirm-dialog";
import { useUnsavedGuard } from "@/lib/use-unsaved-guard";
import type { Carry, ExpLine, Extra, Line, ModelOption, Opt } from "./_form/types";
import { cardCls, num } from "./_form/types";
import { Field, Step } from "./_form/parts";
import { LotLineTable } from "./_form/line-table";
import { TotalsStep } from "./_form/totals-step";
import { BatchField } from "./_form/batch-field";
import { SubmitBar } from "./_form/submit-bar";

export type { LotOpt } from "./lot-picker";

const initialState: CreateOrderState = {};

let seq = 1;
const nextKey = () => seq++;

export function ProductionCreateForm(props: {
  /** Предзаполнение артикула: /production/new?article=… (кнопка «Создать ТЗ на этот артикул» в карточке). */
  initialArticleId?: string;
  /** Предзаполнение партии: /production/new?batch=<номер> (кнопка «Создать ТЗ в этой партии» на карточке партии). */
  initialBatchId?: string;
  action: (prev: CreateOrderState, formData: FormData) => Promise<CreateOrderState>;
  models: ModelOption[];
  warehouses: { id: string; name: string; isDefault: boolean }[];
  clients: Opt[];
  /** Подрядчики (поставщики с договором подряда): если один — подставляется сам. */
  contractors?: Opt[];
  lots: LotOpt[];
  lastContractByClient: Record<string, string>;
  colorOptions: ColorSelectOption[];
  canAddColor: boolean;
  canAddFur: boolean;
  batches: { id: string; number: number; label: string; /** Партия без ТЗ («пусто») — в выборе не показываем, пока не выбрана. */ empty?: boolean; /** № ТЗ, уже стоящих в партии. */ tz?: string[] }[];
  /** Следующий свободный № ТЗ (наибольший числовой + 1); пусто — предложить нечего. */
  nextTzNumber?: string;
  /** Сколько позиций уже заведено под каждым № ТЗ (ключ — номер в нижнем регистре): для предупреждения о дубле. */
  tzNumberCounts?: Record<string, number>;
  expenseCategories: Opt[];
  furs: string[];
}) {
  const [state, formAction, pending] = useActionState(props.action, initialState);
  const [resetKey, setResetKey] = useState(0);
  const [createdMsg, setCreatedMsg] = useState<{ id: string; label: string } | null>(null);
  const lastCreated = useRef<string | null>(null);
  const carryRef = useRef<Carry | null>(null);
  const [carry, setCarry] = useState<Carry | null>(null);
  useEffect(() => {
    const c = state.created;
    if (c && lastCreated.current !== c.id) {
      lastCreated.current = c.id;
      setCarry(carryRef.current);
      setCreatedMsg(c);
      setResetKey((k) => k + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [state.created]);
  return (
    <div className="flex flex-col gap-3">
      {createdMsg && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {createdMsg.label} сохранено.{" "}
          <Link href={`/production/${createdMsg.id}`} className="font-medium underline">Открыть карточку →</Link> Заказчик, договор, партия, даты, цвет и вид меха оставлены; артикул, количество и строки очищены — вносите следующую позицию.
        </p>
      )}
      <FormBody key={resetKey} {...props} state={state} formAction={formAction} pending={pending} carry={carry} carryRef={carryRef} />
    </div>
  );
}

function FormBody({
  initialArticleId, initialBatchId, models, warehouses, clients, contractors = [], lots, lastContractByClient, colorOptions, canAddColor, canAddFur, batches, nextTzNumber = "", tzNumberCounts = {}, expenseCategories, furs,
  state, formAction, pending, carry, carryRef,
}: Parameters<typeof ProductionCreateForm>[0] & { state: CreateOrderState; formAction: (fd: FormData) => void; pending: boolean; carry: Carry | null; carryRef: { current: Carry | null } }) {
  const { setForm: keepRef, onSubmit: keepSubmit } = useKeepingForm(formAction, state, pending);
  const today = new Date().toISOString().slice(0, 10);
  const defaultWarehouse = warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? "";

  const [modelId, setModelId] = useState(initialArticleId ?? "");
  // После «Сохранить и добавить ещё» (carry): № ТЗ остаётся тем же — это следующая позиция того же ТЗ.
  const [f, setF] = useState<Record<string, string>>(carry ? carry.f : { startDate: today, workOrderDate: today, rawWarehouseId: defaultWarehouse, workOrderNumber: nextTzNumber });
  const { ask, node: confirmNode } = useConfirm();
  const formEl = useRef<HTMLFormElement | null>(null);
  const confirmed = useRef(false);
  const [batchQuery, setBatchQuery] = useState("");
  const set = (k: string) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const [clientId, setClientId] = useState(carry?.clientId ?? "");
  const [contractorId, setContractorId] = useState(carry?.contractorId ?? (contractors.length === 1 ? contractors[0].id : ""));
  const [contract, setContract] = useState(carry?.contract ?? "");
  const [contractTouched, setContractTouched] = useState(carry?.contractTouched ?? false);
  const [batchSel, setBatchSel] = useState(() => {
    if (!carry) return initialBatchId ?? "";
    // Партия, созданная только что новым номером, уже есть в списке — берём её; иначе номер уйдёт снова и сервер найдёт её по номеру.
    if (carry.batchSel === "__new__") return batches.find((b) => b.number === Number(carry.batchNew))?.id ?? "__new__";
    return carry.batchSel;
  });
  const [batchNew, setBatchNew] = useState(carry?.batchNew ?? "");
  const [furSel, setFurSel] = useState(carry?.furSel ?? "");
  const [furNew, setFurNew] = useState(carry?.furNew ?? "");
  const [furList, setFurList] = useState(furs);
  const [furErr, setFurErr] = useState("");
  const [vatSel, setVatSel] = useState(carry?.vatSel ?? "");
  const [vatCustom, setVatCustom] = useState(carry?.vatCustom ?? "");
  const [fur, setFur] = useState<Line[]>([]);
  const [lining, setLining] = useState<Line[]>([]);
  const [exps, setExps] = useState<ExpLine[]>([]);
  const [extras, setExtras] = useState<Extra[]>([]);
  const multi = extras.length > 0;
  const [touched, setTouched] = useState(false);
  const guard = useUnsavedGuard(touched || multi || fur.length > 0 || lining.length > 0 || exps.length > 0);
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pasteErrs, setPasteErrs] = useState<string[]>([]);
  const [clientErrs, setClientErrs] = useState<string[]>([]);
  const errRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    carryRef.current = { f: { ...f, plannedQuantity: "" }, clientId, contractorId, contract, contractTouched, batchSel, batchNew, furSel, furNew, vatSel, vatCustom, colorRefId: f.colorRefId ?? "" };
  });

  const model = models.find((m) => m.id === modelId) ?? null;
  const lotById = useMemo(() => new Map(lots.map((l) => [l.id, l])), [lots]);
  const furLots = useMemo(() => lots.filter((l) => l.unit !== "M"), [lots]);
  const liningLots = useMemo(() => lots.filter((l) => l.unit === "M"), [lots]);
  const batchNumber = batchSel === "__new__" ? Number(batchNew) || null : batches.find((b) => b.id === batchSel)?.number ?? null;
  const c4Default = defaultCommission4(batchNumber);

  const taken = useMemo(() => {
    const t: Record<string, number> = {};
    for (const l of [...fur, ...lining]) {
      const q = num(l.qty);
      if (l.lotId && q > 0) t[l.lotId] = (t[l.lotId] ?? 0) + q;
    }
    return t;
  }, [fur, lining]);

  const vatOwn = vatSel === "other" ? (vatCustom.trim() === "" ? null : num(vatCustom)) : vatSel === "" ? null : Number(vatSel);
  // Своя ставка строки: общая «НДС» ТЗ, иначе ставка материала по умолчанию (если она отличается от лота); null — как в лоте.
  const ownVat = (lot: LotOpt): number | null => {
    const v = vatOwn != null && Number.isFinite(vatOwn) ? vatOwn : lot.materialVat;
    return v != null && v !== lot.vatRate ? v : null;
  };
  const toCalc = (ls: Line[]): CalcLine[] =>
    ls.flatMap((l) => {
      const lot = lotById.get(l.lotId);
      const q = num(l.qty);
      if (!lot || !(q > 0)) return [];
      const own = ownVat(lot);
      return [{ lot: { unitCost: lot.unitCost, unitCostExcl: lot.unitCostExcl, vatRate: lot.vatRate }, qty: q, commission4: l.c4, vatRate: own }];
    });
  const furCalc = toCalc(fur);
  const liningCalc = toCalc(lining);
  const qtyPlan = num(f.plannedQuantity ?? "");
  const workPrice = num(f.clientWorkPricePerUnit ?? "");
  const T = draftTotals({ fur: furCalc, lining: liningCalc, expenses: exps.map((e) => num(e.amount)), workPrice: Number.isFinite(workPrice) ? workPrice : 0, qty: Number.isFinite(qtyPlan) ? qtyPlan : 0 });
  const vatRows4 = vatByRate([...furCalc, ...liningCalc], true);

  const draft = JSON.stringify({
    fur: fur.filter((l) => l.lotId && num(l.qty) > 0).map((l) => ({ lotId: l.lotId, quantity: num(l.qty), commission4: l.c4 })),
    lining: lining.filter((l) => l.lotId && num(l.qty) > 0).map((l) => ({ lotId: l.lotId, quantity: num(l.qty), commission4: l.c4 })),
    expenses: exps.filter((e) => e.categoryId && num(e.amount) > 0).map((e) => ({ categoryId: e.categoryId, amount: num(e.amount), description: e.desc || undefined })),
    vatRate: vatSel === "" ? "" : vatSel === "other" ? vatCustom : vatSel,
    batchId: batchSel && batchSel !== "__new__" ? batchSel : undefined,
    batchNumber: batchSel === "__new__" ? batchNew : undefined,
    furType: furSel === "__new__" ? furNew : furSel,
  });

  function validate(): string[] {
    const e: string[] = [];
    if (!modelId) e.push("Артикул: выберите из списка или внесите новый (кнопка «+ Ввести новый артикул»)");
    if (!(qtyPlan > 0)) e.push("Количество изделий должно быть больше 0");
    if (f.clientWorkPricePerUnit && !(workPrice >= 0)) e.push("Работа ₽/ед.: введите число");
    if (batchSel === "__new__" && !/^\d{1,4}$/.test(batchNew.trim())) e.push("Номер новой партии — целое число от 1 до 9999");
    if (furSel === "__new__" && furNew.trim().length < 2) e.push("Вид меха: введите название или выберите из списка");
    if (vatSel === "other" && !(vatOwn != null && vatOwn >= 0 && vatOwn <= 100)) e.push("НДС: число от 0 до 100");
    const chk = (ls: Line[], name: string) =>
      ls.forEach((l, i) => {
        const empty = !l.lotId && l.qty.trim() === "";
        if (empty) return;
        if (!l.lotId) e.push(`${name}, строка ${i + 1}: выберите лот`);
        else if (!(num(l.qty) > 0)) e.push(`${name}, строка ${i + 1}: укажите количество больше 0`);
      });
    extras.forEach((x, i) => {
      if (!x.modelId) e.push(`Позиция ${i + 2}: выберите артикул`);
      if (!(num(x.qty) > 0)) e.push(`Позиция ${i + 2}: количество должно быть больше 0`);
      if (x.work.trim() !== "" && !(num(x.work) >= 0)) e.push(`Позиция ${i + 2}: работа ₽/шт. — число`);
    });
    chk(fur, "Мех");
    chk(lining, "Подкладка");
    for (const [id, q] of Object.entries(taken)) {
      const lot = lotById.get(id);
      if (lot && q > lot.remaining + 1e-9) e.push(`Лот ${lot.lotNumber ?? "без номера"} (${lot.material}): в ТЗ ${formatDec1(q)}, остаток ${formatDec1(lot.remaining)}`);
    }
    exps.forEach((x, i) => {
      if (!x.categoryId && x.amount.trim() === "") return;
      if (!x.categoryId) e.push(`Расходы, строка ${i + 1}: выберите статью`);
      else if (!(num(x.amount) > 0)) e.push(`Расходы, строка ${i + 1}: укажите сумму больше 0`);
    });
    return e;
  }

  const serverErrs = state.errors ?? (state.error ? [state.error] : []);
  const allErrs = clientErrs.length ? clientErrs : serverErrs;

  // Мягкие предупреждения: ничего не блокируют, но перед сохранением просят подтвердить.
  function softWarnings(): string[] {
    const w: string[] = [];
    const no = (f.workOrderNumber ?? "").trim();
    const dup = no ? tzNumberCounts[no.toLowerCase()] ?? 0 : 0;
    if (dup > 0 && !(carry && no === (carry.f.workOrderNumber ?? "").trim())) w.push(`№ ТЗ ${no} уже есть в базе (позиций: ${dup}). Позиции одного ТЗ допустимы — если это ещё одна позиция того же ТЗ, всё верно; иначе исправьте номер.`);
    if (!(workPrice > 0)) w.push("Цена работы не указана: сумму работы и оплату по ТЗ определить нельзя.");
    return w;
  }

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    const errs = validate();
    setClientErrs(errs);
    if (errs.length) {
      ev.preventDefault();
      setTimeout(() => errRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 30);
      return;
    }
    const warns = confirmed.current ? [] : softWarnings();
    if (warns.length) {
      ev.preventDefault();
      const submitter = (ev.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
      void ask(
        <div className="flex flex-col gap-2">
          <p className="font-medium">Проверьте перед сохранением</p>
          <ul className="list-disc pl-5 text-neutral-700">{warns.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>,
        { ok: "Всё равно сохранить", wide: true },
      ).then((ok) => {
        if (!ok) return;
        confirmed.current = true;
        formEl.current?.requestSubmit(submitter ?? undefined);
        confirmed.current = false;
      });
      return;
    }
    keepSubmit(ev);
  };

  const addLine = (kind: "fur" | "lining") => {
    const l: Line = { key: nextKey(), lotId: "", qty: "", c4: c4Default, c4Touched: false };
    (kind === "fur" ? setFur : setLining)((p) => [...p, l]);
  };
  const upd = (kind: "fur" | "lining", key: number, patch: Partial<Line>) =>
    (kind === "fur" ? setFur : setLining)((p) => p.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const del = (kind: "fur" | "lining", key: number) => (kind === "fur" ? setFur : setLining)((p) => p.filter((l) => l.key !== key));

  // Смена партии меняет «4% по умолчанию» (партия 6 — без 4%) у строк, где флаг не трогали вручную.
  const onBatch = (v: string, newNum?: string) => {
    const nb = v === "__new__" ? Number(newNum ?? batchNew) || null : batches.find((b) => b.id === v)?.number ?? null;
    const d = defaultCommission4(nb);
    const fix = (p: Line[]) => p.map((l) => (l.c4Touched ? l : { ...l, c4: d }));
    setFur(fix);
    setLining(fix);
  };

  function applyPaste() {
    const { lines, errors } = parseLotLines(paste);
    const errs = [...errors];
    const add: Line[] = [];
    const byNum = new Map<string, LotOpt[]>();
    for (const l of furLots) {
      if (!l.lotNumber) continue;
      const k = l.lotNumber.trim().toLowerCase();
      byNum.set(k, [...(byNum.get(k) ?? []), l]);
    }
    for (const ln of lines) {
      const c = byNum.get(ln.lotNumber.toLowerCase()) ?? [];
      if (c.length === 0) errs.push(`строка ${ln.line}: лот ${ln.lotNumber} не найден (или нет остатка)`);
      else if (c.length > 1) errs.push(`строка ${ln.line}: лот ${ln.lotNumber} неоднозначен (${c.length}): ${c.map((x) => `${x.material}${x.purchaseNumber ? `, закупка ${x.purchaseNumber}` : ""}`).join("; ")} — выберите вручную`);
      else add.push({ key: nextKey(), lotId: c[0].id, qty: String(ln.quantity), c4: c4Default, c4Touched: false });
    }
    setPasteErrs(errs);
    if (add.length) setFur((p) => [...p.filter((l) => l.lotId || l.qty), ...add]);
    if (errs.length === 0) { setPaste(""); setShowPaste(false); }
    else setPaste(lines.filter((ln) => !add.some((a) => lotById.get(a.lotId)?.lotNumber?.toLowerCase() === ln.lotNumber.toLowerCase())).map((ln) => `${ln.lotNumber}\t${ln.quantity}`).join("\n"));
  }

  const clientName = clients.find((c) => c.id === clientId)?.name;

  return (
    <form ref={(n) => { formEl.current = n; keepRef(n); }} onSubmit={onSubmit} onChange={() => setTouched(true)} className="flex flex-col gap-5 pb-4" noValidate>
      {guard}
      <input type="hidden" name="productModelId" value={modelId} />
      <input type="hidden" name="draft" value={draft} />
      <input type="hidden" name="extras" value={JSON.stringify(extras.map((x) => ({
        productModelId: x.modelId, plannedQuantity: num(x.qty), color: x.color || undefined, colorRefId: x.colorRefId || undefined, size: x.size || undefined,
        clientWorkPricePerUnit: x.work.trim() !== "" && Number.isFinite(num(x.work)) ? num(x.work) : undefined,
      })))} />
      {/* Склад в интерфейсе не указывается: подставляется склад по умолчанию (сервер при пустом значении берёт его сам). */}
      <input type="hidden" name="rawWarehouseId" value={f.rawWarehouseId ?? defaultWarehouse} />
      <input type="hidden" name="finishedWarehouseId" value={f.rawWarehouseId ?? defaultWarehouse} />

      <header className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-1 py-2 max-md:mx-0">
        <Link href="/production" className="rounded px-1.5 py-1 text-lg leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900" title="К списку ТЗ" aria-label="Назад к списку ТЗ">←</Link>
        <h1 className="text-xl font-semibold">Новое ТЗ</h1>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/production" className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">Отмена</Link>
        </div>
      </header>

      {allErrs.length > 0 && (
        <ul ref={errRef} role="alert" className="list-disc rounded-md bg-red-50 px-6 py-2 text-sm text-red-700">
          {allErrs.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}

      <Step n={1} title="Параметры" id="params" hint={<><p>Что заведено в ТЗ — те же поля, что на карточке. Артикул, цвет, вид меха, партия, заказчик выбираются из справочников или вносятся новые.</p><p className="mt-1">Количество → «Заведено в ТЗ» и «Изделия»; работа ₽/ед. × количество → себестоимость и оплаты за работу; партия → «Партии пошива»; артикул → категория, группа и цена продажи.</p></>}>
        <div className={`${cardCls} grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
          <Field label="Артикул *" className="sm:col-span-2" hint="Выберите артикул из справочника или «+ Ввести новый артикул» — он сразу сохранится в справочник артикулов.">
            <ArticleSelect name="articleText" onlyActive defaultValue={initialArticleId || undefined} onChange={(a) => setModelId(a?.id ?? "")} />
            {model ? (
              <p className="mt-1 text-xs text-neutral-500">
                {model.category ? `${model.category}${model.group && model.group !== "Без группы" ? ` · ${model.group}` : ""}` : "Категория не задана — укажите на карточке"}
                {model.retailPrice ? ` · цена продажи ${formatMoney(model.retailPrice)} — перейдёт в ТЗ` : " · цена продажи не задана"}
              </p>
            ) : (
              <p className="mt-1 text-xs text-neutral-600">Категория и группа — из артикула</p>
            )}
          </Field>
    <Field htmlFor="workOrderNumber" label="№ ТЗ" hint="Предложен следующий свободный номер (наибольший числовой + 1); можно изменить. Если номер уже есть, перед сохранением спросим: позиции одного ТЗ допустимы.">
            <Input id="workOrderNumber" name="workOrderNumber" placeholder="№ ТЗ" value={f.workOrderNumber ?? ""} onChange={set("workOrderNumber")} />
            {carry && f.workOrderNumber === carry.f.workOrderNumber && (f.workOrderNumber ?? "") !== "" ? (
              <p className="mt-1 text-xs text-neutral-500">следующая позиция ТЗ № {f.workOrderNumber}</p>
            ) : nextTzNumber && f.workOrderNumber === nextTzNumber ? <p className="mt-1 text-xs text-neutral-600">следующий свободный</p> : null}
          </Field>
          <Field htmlFor="workOrderDate" label="Дата ТЗ"><Input id="workOrderDate" name="workOrderDate" type="date" value={f.workOrderDate ?? ""} onChange={set("workOrderDate")} /></Field>

          <Field htmlFor="clientId" label="Заказчик" hint="Из справочника клиентов. «Собственное производство» — без заказчика." link={clientId ? <Link href="/clients" target="_blank" className="text-blue-700 hover:underline">→</Link> : null}>
            <Select
              id="clientId" name="clientId" value={clientId}
              onChange={(e) => { const id = e.target.value; setClientId(id); if (!contractTouched) setContract(lastContractByClient[id] ?? ""); }}
            >
              <option value="">Собственное производство</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field htmlFor="contractNumber" label="Договор подряда">
            <Input id="contractNumber" name="contractNumber" placeholder="№ 1605 от 16.05.2025" value={contract} onChange={(e) => { setContract(e.target.value); setContractTouched(true); }} />
          </Field>
          {contractors.length > 0 && (
            <Field htmlFor="contractorId" label="Подрядчик" hint="Кто шьёт по этому ТЗ. Ему идут оплаты за работу. Если подрядчик один, он подставляется сам.">
              <Select id="contractorId" name="contractorId" value={contractorId} onChange={(e) => setContractorId(e.target.value)}>
                <option value="">Не указан</option>
                {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          )}
          <BatchField batches={batches} batchSel={batchSel} setBatchSel={setBatchSel} batchNew={batchNew} setBatchNew={setBatchNew} batchQuery={batchQuery} setBatchQuery={setBatchQuery} onBatch={onBatch} />
          <Field label="Цвет" hint="Из справочника цветов или своё значение (синонимы привяжутся автоматически).">
            <ColorSelect refs={colorOptions} canCreate={canAddColor} placeholder="Коричневый" defaultValue={carry?.f.color ?? ""} defaultRefId={carry?.colorRefId || null} onChange={(t, r) => setF((p) => ({ ...p, color: t, colorRefId: r }))} />
          </Field>

          <Field htmlFor="size" label="Размеры"><Input id="size" name="size" placeholder="42, 44" value={f.size ?? ""} onChange={set("size")} /></Field>
          <Field htmlFor="plannedQuantity" label="Кол-во изделий, шт *" hint="Плановое количество. Уходит в «Заведено в ТЗ», «Изделия», себестоимость на 1 изделие и работу.">
            <Input id="plannedQuantity" name="plannedQuantity" type="number" step="1" min="1" inputMode="numeric" value={f.plannedQuantity ?? ""} onChange={set("plannedQuantity")} />
          </Field>
          <Field htmlFor="clientWorkPricePerUnit" label="Работа, ₽ за шт." hint="Цена работы подрядчика за единицу. Сумма = цена × количество — входит в себестоимость и оплаты за работу.">
            <Input id="clientWorkPricePerUnit" name="clientWorkPricePerUnit" type="number" step="0.01" min="0" inputMode="decimal" value={f.clientWorkPricePerUnit ?? ""} onChange={set("clientWorkPricePerUnit")} />
          </Field>
          <Field label="Вид меха" hint="По умолчанию вид определяется по списанным лотам. Можно выбрать из справочника видов меха или внести свой.">
            <Select value={furSel} aria-label="Вид меха" onChange={(e) => { setFurSel(e.target.value); setFurErr(""); }}>
              <option value="">По лотам (авто)</option>
              {furList.map((x) => <option key={x} value={x}>{x}</option>)}
              <option value="__new__">＋ Внести свой…</option>
            </Select>
            {furSel === "__new__" && (
              <span className="mt-1 flex gap-1">
                <Input placeholder="Например: Енот" aria-label="Новый вид меха" value={furNew} onChange={(e) => setFurNew(e.target.value)} />
                {canAddFur && (
                  <Button type="button" variant="outline" size="sm" onClick={async () => {
                    const r = await createFurInline(furNew);
                    if (!r.ok) { setFurErr(r.error); return; }
                    setFurList((p) => (p.includes(r.name) ? p : [...p, r.name]));
                    setFurSel(r.name); setFurNew("");
                  }}>В справочник</Button>
                )}
              </span>
            )}
            {furErr && <p className="mt-1 text-xs text-red-600">{furErr}</p>}
          </Field>
          <Field label="НДС в строках списания" hint="«Как в лотах» — у каждой строки ставка её лота (2026 — 22 %, 2025 — 20 %). Или одна ставка на все строки: сумма с НДС не меняется, меняется разбивка «без НДС / НДС».">
            <Select value={vatSel} aria-label="НДС" onChange={(e) => setVatSel(e.target.value)}>
              <option value="">Как в лотах (по умолчанию 22 %)</option>
              <option value="22">22 %</option>
              <option value="20">20 %</option>
              <option value="other">Своя ставка…</option>
            </Select>
            {vatSel === "other" && <Input className="mt-1" type="number" step="0.01" min="0" max="100" placeholder="напр. 10" aria-label="Своя ставка НДС" value={vatCustom} onChange={(e) => setVatCustom(e.target.value)} />}
          </Field>
        </div>

        <details className={cardCls}>
          <summary className="cursor-pointer text-sm font-medium text-neutral-700">Дополнительно: материал и подкладка из ТЗ, даты, заметки</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field htmlFor="materialDescription" label="Материал продукции (как в ТЗ)"><Input id="materialDescription" name="materialDescription" placeholder="Соболь выделанный тонированный" value={f.materialDescription ?? ""} onChange={set("materialDescription")} /></Field>
            <Field htmlFor="lining" label="Подкладка (описание из ТЗ)"><Input id="lining" name="lining" placeholder="100% Шёлк, № LC1635" value={f.lining ?? ""} onChange={set("lining")} /></Field>
            <Field htmlFor="startDate" label="Дата начала"><Input id="startDate" name="startDate" type="date" value={f.startDate ?? ""} onChange={set("startDate")} /></Field>
            <Field htmlFor="notes" label="Заметки" className="sm:col-span-2"><Textarea id="notes" name="notes" rows={2} value={f.notes ?? ""} onChange={set("notes")} /></Field>
          </div>
        </details>

        {extras.map((x, i) => (
          <div key={x.key} className={`${cardCls} grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
            <Field label={`Артикул * (позиция ${i + 2})`} className="sm:col-span-2">
              <ArticleSelect name={`articleText_x${x.key}`} onlyActive onChange={(a) => setExtras((p) => p.map((y) => (y.key === x.key ? { ...y, modelId: a?.id ?? "" } : y)))} />
            </Field>
            <Field label="Кол-во изделий, шт *"><Input type="number" step="1" min="1" inputMode="numeric" value={x.qty} onChange={(e) => setExtras((p) => p.map((y) => (y.key === x.key ? { ...y, qty: e.target.value } : y)))} /></Field>
            <Field label="Работа, ₽ за шт."><Input type="number" step="0.01" min="0" inputMode="decimal" value={x.work} onChange={(e) => setExtras((p) => p.map((y) => (y.key === x.key ? { ...y, work: e.target.value } : y)))} /></Field>
            <Field label="Цвет"><ColorSelect refs={colorOptions} canCreate={canAddColor} placeholder="Коричневый" defaultValue="" defaultRefId={null} onChange={(t, r) => setExtras((p) => p.map((y) => (y.key === x.key ? { ...y, color: t, colorRefId: r } : y)))} /></Field>
            <Field label="Размеры"><Input placeholder="42, 44" value={x.size} onChange={(e) => setExtras((p) => p.map((y) => (y.key === x.key ? { ...y, size: e.target.value } : y)))} /></Field>
            <div className="flex items-end"><Button type="button" variant="outline" size="sm" onClick={() => setExtras((p) => p.filter((y) => y.key !== x.key))}>Убрать позицию</Button></div>
          </div>
        ))}
        <div>
          <Button
            type="button" variant="outline" size="sm"
            disabled={fur.length > 0 || lining.length > 0 || exps.length > 0}
            title={fur.length > 0 || lining.length > 0 || exps.length > 0 ? "Сначала уберите строки расчёта: в ТЗ с несколькими артикулами списания вводятся на карточке каждой позиции" : undefined}
            onClick={() => { setExtras((p) => [...p, { key: nextKey(), modelId: "", qty: "", color: "", colorRefId: null, size: "", work: "" }]); setTouched(true); }}
          >
            + ещё артикул
          </Button>
          <span className="ml-2 text-xs text-neutral-500">Общие поля — на все позиции.</span>
        </div>
      </Step>

      {multi ? (
        <p className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-600">Списания меха, подкладки и расходы вводятся на карточке каждой позиции после создания.</p>
      ) : null}

      {!multi && <Step n={2} title="Расчёт" id="calc" hint={<><p>Лот → цена и НДС подтягиваются из закупки автоматически; сумма = количество × цена лота. Лоты списываются со склада при сохранении ТЗ (остаток лота уменьшится, в «Сырьё» вырастет использование).</p><p className="mt-1">«4 %» — надбавка посредника (Веллмех) к меху и подкладке: {COMMISSION_RATE * 100} % от цены без НДС. Работа и расходы не облагаются.</p></>}>
        <div className={`${cardCls} flex flex-col gap-3`}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">Мех <span className="font-normal text-neutral-500">· {formatDec1(T.fur.qty)} шт.</span></h3>
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowPaste((v) => !v)}>Вставить из Excel</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => addLine("fur")}>+ Лот меха</Button>
            </div>
          </div>
          {showPaste && (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2">
              <Textarea aria-label="Лоты из Excel" rows={5} className="font-mono" placeholder={"344\t12\n1330\t5,5"} value={paste} onChange={(e) => setPaste(e.target.value)} />
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" onClick={applyPaste} disabled={!paste.trim()}>Добавить строки</Button>
                <span className="text-xs text-neutral-500">По строке на лот: <b>лот</b> [Tab] <b>кол-во</b>. Найденные лоты попадут в таблицу, остальные останутся здесь с причиной.</span>
              </div>
              {pasteErrs.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-red-700">{pasteErrs.map((e, i) => <li key={i}>{e}</li>)}</ul>}
            </div>
          )}
          <LotLineTable kind="fur" ls={fur} pool={furLots} unitLabel="шт." lotById={lotById} taken={taken} ownVat={ownVat} upd={upd} del={del} />

          <div className="flex items-center gap-2 border-t border-neutral-100 pt-3">
            <h3 className="text-sm font-medium">Подкладка <span className="font-normal text-neutral-500">· {formatDec1(T.lining.qty)} м</span></h3>
            <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => addLine("lining")}>+ Лот подкладки</Button>
          </div>
          <LotLineTable kind="lining" ls={lining} pool={liningLots} unitLabel="м" lotById={lotById} taken={taken} ownVat={ownVat} upd={upd} del={del} />

          <div className="flex items-center gap-2 border-t border-neutral-100 pt-3">
            <h3 className="text-sm font-medium">Расходы</h3>
            <InfoHint label="Расходы">Статьи из справочника «Статьи расходов» (производство). Расход входит в себестоимость ТЗ без НДС и без 4 %.</InfoHint>
            <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => setExps((p) => [...p, { key: nextKey(), categoryId: "", amount: "", desc: "" }])}>+ Расход</Button>
          </div>
          {exps.length === 0 ? (
            <p className="text-sm text-neutral-500">Расходов нет.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {exps.map((x, i) => (
                <div key={x.key} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[14rem_1fr_9rem_2rem]">
                  <Select aria-label={`Статья расхода ${i + 1}`} value={x.categoryId} onChange={(e) => setExps((p) => p.map((y) => (y.key === x.key ? { ...y, categoryId: e.target.value } : y)))} className="h-8">
                    <option value="">Статья…</option>
                    {expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                  <Input aria-label={`Описание расхода ${i + 1}`} placeholder="Описание (необязательно)" value={x.desc} onChange={(e) => setExps((p) => p.map((y) => (y.key === x.key ? { ...y, desc: e.target.value } : y)))} className="h-8" />
                  <Input aria-label={`Сумма расхода ${i + 1}`} type="number" step="0.01" min="0" inputMode="decimal" placeholder="Сумма, ₽" value={x.amount} onChange={(e) => setExps((p) => p.map((y) => (y.key === x.key ? { ...y, amount: e.target.value } : y)))} className="h-8 text-right tabular-nums" />
                  <button type="button" onClick={() => setExps((p) => p.filter((y) => y.key !== x.key))} className="rounded px-1.5 py-0.5 text-neutral-600 hover:bg-neutral-100 hover:text-red-600" aria-label={`Убрать расход ${i + 1}`}>✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-neutral-100 pt-3 text-sm">
            <h3 className="font-medium">Работа</h3>
            <span className="text-neutral-500">
              {Number.isFinite(workPrice) && workPrice > 0 ? `${formatMoney(workPrice)}/шт.` : "— ₽/шт."} × {Number.isFinite(qtyPlan) && qtyPlan > 0 ? formatQty(qtyPlan) : "–"} шт. =
            </span>
            <b className="tabular-nums">{T.work > 0 ? formatMoney(T.work) : "–"}</b>
            <a href="#params" className="text-xs text-blue-700 hover:underline">изменить в параметрах</a>
          </div>
        </div>
      </Step>}

      {!multi && <TotalsStep T={T} vatRows4={vatRows4} clientName={clientName} />}

      <SubmitBar multi={multi} positions={extras.length + 1} T={T} pending={pending} />
      {confirmNode}
    </form>
  );
}
