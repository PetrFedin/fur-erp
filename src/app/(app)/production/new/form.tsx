"use client";

import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import type { CreateOrderState } from "../actions";
import { ColorSelect, type ColorSelectOption } from "@/components/color-select";
import { ArticleSelect } from "@/components/article-select";
import { InfoHint } from "@/components/info-hint";
import { MoneyClient } from "@/components/money-client";
import { createFurInline } from "@/app/(app)/settings/furs/actions";
import { useKeepingForm } from "@/lib/use-keeping-form";
import { parseLotLines } from "@/lib/lot-lines";
import { defaultCommission4, COMMISSION_RATE } from "@/lib/commission4-const";
import { draftTotals, lineCalc, vatByRate, type CalcLine } from "@/lib/tz-calc";
import { formatQty, formatMoney } from "@/lib/utils";
import { LotPicker, type LotOpt } from "./lot-picker";

export type { LotOpt } from "./lot-picker";

const initialState: CreateOrderState = {};

type ModelOption = { id: string; name: string; retailPrice: string | null; category: string | null; group: string | null };
type Opt = { id: string; name: string };
type Line = { key: number; lotId: string; qty: string; c4: boolean; c4Touched: boolean };
type ExpLine = { key: number; categoryId: string; amount: string; desc: string };

const num = (s: string) => {
  const n = Number(String(s).replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
let seq = 1;
const nextKey = () => seq++;

/** Сумма с НДС / без НДС через общий переключатель «С НДС / Без НДС» шапки. */
function M({ incl, excl }: { incl: number; excl: number }) {
  return <MoneyClient incl={String(Math.round(incl * 100) / 100)} excl={String(Math.round(excl * 100) / 100)} />;
}

function Step({ n, title, hint, children, id }: { n: number; title: string; hint?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-xs font-medium text-white">{n}</span>
        <h2 className="text-base font-semibold">{title}</h2>
        {hint ? <InfoHint label={title} wide>{hint}</InfoHint> : null}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children, className, hint, link, htmlFor }: { label: string; children: ReactNode; className?: string; hint?: ReactNode; link?: ReactNode; htmlFor?: string }) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-center gap-1 text-xs text-neutral-500">
        <Label htmlFor={htmlFor} className="mb-0 text-xs text-neutral-500">{label}</Label>
        {hint ? <InfoHint label={label}>{hint}</InfoHint> : null}
        {link}
      </div>
      {children}
    </div>
  );
}

const cardCls = "rounded-lg border border-neutral-200 bg-white p-3";
const th = "px-2 py-1.5 text-left text-xs font-medium text-neutral-500";

export function ProductionCreateForm(props: {
  action: (prev: CreateOrderState, formData: FormData) => Promise<CreateOrderState>;
  models: ModelOption[];
  warehouses: { id: string; name: string; isDefault: boolean }[];
  clients: Opt[];
  lots: LotOpt[];
  lastContractByClient: Record<string, string>;
  colorOptions: ColorSelectOption[];
  canAddColor: boolean;
  canAddFur: boolean;
  batches: { id: string; number: number; label: string }[];
  expenseCategories: Opt[];
  furs: string[];
}) {
  const [state, formAction, pending] = useActionState(props.action, initialState);
  const [resetKey, setResetKey] = useState(0);
  const [createdMsg, setCreatedMsg] = useState<{ id: string; label: string } | null>(null);
  const lastCreated = useRef<string | null>(null);
  useEffect(() => {
    const c = state.created;
    if (c && lastCreated.current !== c.id) {
      lastCreated.current = c.id;
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
          <Link href={`/production/${createdMsg.id}`} className="font-medium underline">Открыть карточку →</Link> Форма очищена — вносите следующее.
        </p>
      )}
      <FormBody key={resetKey} {...props} state={state} formAction={formAction} pending={pending} />
    </div>
  );
}

function FormBody({
  models, warehouses, clients, lots, lastContractByClient, colorOptions, canAddColor, canAddFur, batches, expenseCategories, furs,
  state, formAction, pending,
}: Parameters<typeof ProductionCreateForm>[0] & { state: CreateOrderState; formAction: (fd: FormData) => void; pending: boolean }) {
  const { setForm: keepRef, onSubmit: keepSubmit } = useKeepingForm(formAction, state, pending);
  const today = new Date().toISOString().slice(0, 10);
  const defaultWarehouse = warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? "";

  const [modelId, setModelId] = useState("");
  const [f, setF] = useState<Record<string, string>>({ startDate: today, workOrderDate: today, rawWarehouseId: defaultWarehouse });
  const set = (k: string) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const [clientId, setClientId] = useState("");
  const [contract, setContract] = useState("");
  const [contractTouched, setContractTouched] = useState(false);
  const [batchSel, setBatchSel] = useState("");
  const [batchNew, setBatchNew] = useState("");
  const [furSel, setFurSel] = useState("");
  const [furNew, setFurNew] = useState("");
  const [furList, setFurList] = useState(furs);
  const [furErr, setFurErr] = useState("");
  const [vatSel, setVatSel] = useState("");
  const [vatCustom, setVatCustom] = useState("");
  const [fur, setFur] = useState<Line[]>([]);
  const [lining, setLining] = useState<Line[]>([]);
  const [exps, setExps] = useState<ExpLine[]>([]);
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [pasteErrs, setPasteErrs] = useState<string[]>([]);
  const [clientErrs, setClientErrs] = useState<string[]>([]);
  const errRef = useRef<HTMLUListElement>(null);

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
  const toCalc = (ls: Line[]): CalcLine[] =>
    ls.flatMap((l) => {
      const lot = lotById.get(l.lotId);
      const q = num(l.qty);
      if (!lot || !(q > 0)) return [];
      return [{ lot: { unitCost: lot.unitCost, unitCostExcl: lot.unitCostExcl, vatRate: lot.vatRate }, qty: q, commission4: l.c4, vatRate: vatOwn != null && Number.isFinite(vatOwn) && vatOwn !== lot.vatRate ? vatOwn : null }];
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
    chk(fur, "Мех");
    chk(lining, "Подкладка");
    for (const [id, q] of Object.entries(taken)) {
      const lot = lotById.get(id);
      if (lot && q > lot.remaining + 1e-9) e.push(`Лот ${lot.lotNumber ?? "без номера"} (${lot.material}): в ТЗ ${formatQty(q)}, остаток ${formatQty(lot.remaining)}`);
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

  const lineTable = (kind: "fur" | "lining", ls: Line[], pool: LotOpt[], unitLabel: string) => (
    <div className="table-scroll overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-neutral-200">
            <th className={th}>Лот</th>
            <th className={`${th} text-right`}>Остаток</th>
            <th className={`${th} text-right`}>Цена за {unitLabel}</th>
            <th className={`${th} text-right`}>НДС</th>
            <th className={`${th} w-28 text-right`}>Кол-во, {unitLabel}</th>
            <th className={`${th} text-center`}>4%</th>
            <th className={`${th} text-right`}>Сумма</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {ls.map((l, i) => {
            const lot = lotById.get(l.lotId);
            const q = num(l.qty);
            const own = lot && vatOwn != null && Number.isFinite(vatOwn) && vatOwn !== lot.vatRate ? vatOwn : null;
            const c = lot && q > 0 ? lineCalc({ lot: { unitCost: lot.unitCost, unitCostExcl: lot.unitCostExcl, vatRate: lot.vatRate }, qty: q, commission4: l.c4, vatRate: own }) : null;
            const over = lot && (taken[lot.id] ?? 0) > lot.remaining + 1e-9;
            return (
              <tr key={l.key} className="border-b border-neutral-100 align-top">
                <td className="min-w-[16rem] px-2 py-1.5">
                  <LotPicker lots={pool} value={l.lotId} onChange={(id) => upd(kind, l.key, { lotId: id })} taken={taken} ariaLabel={`Лот, строка ${i + 1}`} />
                  {lot && (
                    <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-neutral-500">
                      <Link href={`/analytics/raw/lot/${lot.id}`} target="_blank" className="text-blue-700 hover:underline" title="Карточка лота: закупка, где ещё использован, остаток">лот →</Link>
                      {lot.purchaseId && <Link href={`/purchases/${lot.purchaseId}`} target="_blank" className="text-blue-700 hover:underline" title="Закупка, из которой пришёл лот">закупка {lot.purchaseNumber} →</Link>}
                      {lot.auction && <span>{lot.auction}</span>}
                    </span>
                  )}
                </td>
                <td className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${over ? "text-red-600" : "text-neutral-600"}`}>{lot ? formatQty(lot.remaining) : "—"}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                  {lot ? <><M incl={lot.unitCost} excl={lot.unitCostExcl} /><span className="block text-[11px] text-neutral-400">из лота</span></> : "—"}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-neutral-600">
                  {lot ? <>{own ?? lot.vatRate}%{own != null && <span className="block text-[11px] text-amber-700">в лоте {lot.vatRate}%</span>}</> : "—"}
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    aria-label={`Количество, строка ${i + 1}`}
                    type="number" step="0.001" min="0" inputMode="decimal"
                    value={l.qty}
                    onChange={(e) => upd(kind, l.key, { qty: e.target.value })}
                    className={`h-8 text-right tabular-nums ${over ? "border-red-500 bg-red-50" : ""}`}
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox" checked={l.c4} aria-label={`Начислять 4%, строка ${i + 1}`}
                    onChange={(e) => upd(kind, l.key, { c4: e.target.checked, c4Touched: true })}
                    className="h-4 w-4"
                  />
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                  {c ? (
                    <>
                      <span className="font-medium"><M incl={c.incl4} excl={c.excl4} /></span>
                      {l.c4 && <span className="block text-[11px] text-neutral-400">без 4%: <M incl={c.baseIncl} excl={c.baseExcl} /></span>}
                    </>
                  ) : "—"}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button type="button" onClick={() => del(kind, l.key)} className="rounded px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-red-600" aria-label={`Убрать строку ${i + 1}`} title="Убрать строку">✕</button>
                </td>
              </tr>
            );
          })}
          {ls.length === 0 && (
            <tr><td colSpan={8} className="px-2 py-3 text-center text-neutral-500">{kind === "fur" ? "Мех не добавлен — «+ Лот меха» или вставьте из Excel" : "Подкладка не добавлена (можно добавить позже на карточке)"}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const clientName = clients.find((c) => c.id === clientId)?.name;

  return (
    <form ref={keepRef} onSubmit={onSubmit} className="flex flex-col gap-5 pb-4" noValidate>
      <input type="hidden" name="productModelId" value={modelId} />
      <input type="hidden" name="draft" value={draft} />
      <input type="hidden" name="finishedWarehouseId" value={f.rawWarehouseId ?? defaultWarehouse} />

      <header className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-1 py-2">
        <Link href="/production" className="rounded px-1.5 py-1 text-lg leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900" title="К списку ТЗ" aria-label="Назад к списку ТЗ">←</Link>
        <h1 className="text-xl font-semibold">Новое ТЗ</h1>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/production" className="rounded-md px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">Отмена</Link>
          <Button type="submit" name="intent" value="open" size="sm" disabled={pending}>{pending ? "Сохраняем…" : "Сохранить ТЗ"}</Button>
        </div>
      </header>

      {allErrs.length > 0 && (
        <ul ref={errRef} role="alert" className="list-disc rounded-md bg-red-50 px-6 py-2 text-sm text-red-700">
          {allErrs.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}

      <Step n={1} title="Параметры" id="params" hint={<><p>Что заведено в ТЗ — те же поля, что на карточке. Артикул, цвет, вид меха, партия, заказчик выбираются из справочников или вносятся новые.</p><p className="mt-1">Количество → «Произведено» и «Изделия»; работа ₽/ед. × количество → себестоимость и оплаты заказчика; партия → «Партии пошива»; артикул → категория, группа и цена продажи.</p></>}>
        <div className={`${cardCls} grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
          <Field label="Артикул *" className="sm:col-span-2" hint="Выберите артикул из справочника или «+ Ввести новый артикул» — он сразу сохранится в справочник артикулов.">
            <ArticleSelect name="articleText" onlyActive onChange={(a) => setModelId(a?.id ?? "")} />
            {model ? (
              <p className="mt-1 text-xs text-neutral-500">
                {model.category ? `${model.category}${model.group && model.group !== "Без группы" ? ` · ${model.group}` : ""}` : "Категория не задана — укажите на карточке"}
                {model.retailPrice ? ` · цена продажи ${formatMoney(model.retailPrice)} — перейдёт в ТЗ` : " · цена продажи не задана"}
              </p>
            ) : (
              <p className="mt-1 text-xs text-neutral-400">Категория и группа подтянутся из артикула</p>
            )}
          </Field>
          <Field htmlFor="workOrderNumber" label="№ ТЗ"><Input id="workOrderNumber" name="workOrderNumber" placeholder="141" value={f.workOrderNumber ?? ""} onChange={set("workOrderNumber")} /></Field>
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
          <Field label="Партия пошива" hint="Партия поставки. Партия 6 — без надбавки 4%. Можно выбрать из списка или завести новую по номеру.">
            <Select value={batchSel} onChange={(e) => { setBatchSel(e.target.value); onBatch(e.target.value); }} aria-label="Партия пошива">
              <option value="">Партия не указана</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              <option value="__new__">＋ Новая партия…</option>
            </Select>
            {batchSel === "__new__" && (
              <Input className="mt-1" inputMode="numeric" placeholder="Номер новой партии" aria-label="Номер новой партии" value={batchNew} onChange={(e) => { setBatchNew(e.target.value); onBatch("__new__", e.target.value); }} />
            )}
          </Field>
          <Field label="Цвет" hint="Из справочника цветов или своё значение (синонимы привяжутся автоматически).">
            <ColorSelect refs={colorOptions} canCreate={canAddColor} placeholder="Коричневый" onChange={(t) => setF((p) => ({ ...p, color: t }))} />
          </Field>

          <Field htmlFor="size" label="Размеры"><Input id="size" name="size" placeholder="42, 44" value={f.size ?? ""} onChange={set("size")} /></Field>
          <Field htmlFor="plannedQuantity" label="Кол-во изделий, шт *" hint="Плановое количество. Уходит в «Произведено», «Изделия», себестоимость на 1 изделие и работу.">
            <Input id="plannedQuantity" name="plannedQuantity" type="number" step="1" min="1" inputMode="numeric" value={f.plannedQuantity ?? ""} onChange={set("plannedQuantity")} />
          </Field>
          <Field htmlFor="clientWorkPricePerUnit" label="Работа, ₽ за шт." hint="Цена работы заказчику за единицу. Сумма = цена × количество — входит в себестоимость и оплаты заказчика.">
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
          <Field label="НДС в строках списания" hint="«Как в лотах» — у каждой строки ставка её лота (2026 — 22%, 2025 — 20%). Или одна ставка на все строки: сумма с НДС не меняется, меняется разбивка «без НДС / НДС».">
            <Select value={vatSel} aria-label="НДС" onChange={(e) => setVatSel(e.target.value)}>
              <option value="">Как в лотах (по умолчанию 22%)</option>
              <option value="22">22%</option>
              <option value="20">20%</option>
              <option value="other">Своя ставка…</option>
            </Select>
            {vatSel === "other" && <Input className="mt-1" type="number" step="0.01" min="0" max="100" placeholder="напр. 10" aria-label="Своя ставка НДС" value={vatCustom} onChange={(e) => setVatCustom(e.target.value)} />}
          </Field>
        </div>

        <details className={cardCls}>
          <summary className="cursor-pointer text-sm font-medium text-neutral-700">Дополнительно: материал и подкладка из ТЗ, даты, склад, заметки</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field htmlFor="materialDescription" label="Материал продукции (как в ТЗ)"><Input id="materialDescription" name="materialDescription" placeholder="Соболь выделанный тонированный" value={f.materialDescription ?? ""} onChange={set("materialDescription")} /></Field>
            <Field htmlFor="lining" label="Подкладка (описание из ТЗ)"><Input id="lining" name="lining" placeholder="100% Шёлк, № LC1635" value={f.lining ?? ""} onChange={set("lining")} /></Field>
            <Field htmlFor="rawWarehouseId" label="Склад сырья (списание)">
              <Select id="rawWarehouseId" name="rawWarehouseId" value={f.rawWarehouseId ?? defaultWarehouse} onChange={set("rawWarehouseId")}>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
            <Field htmlFor="startDate" label="Дата начала"><Input id="startDate" name="startDate" type="date" value={f.startDate ?? ""} onChange={set("startDate")} /></Field>
            <Field htmlFor="notes" label="Заметки" className="sm:col-span-2"><Textarea id="notes" name="notes" rows={2} value={f.notes ?? ""} onChange={set("notes")} /></Field>
          </div>
        </details>
      </Step>

      <Step n={2} title="Расчёт" id="calc" hint={<><p>Лот → цена и НДС подтягиваются из закупки автоматически; сумма = количество × цена лота. Лоты списываются со склада при сохранении ТЗ (остаток лота уменьшится, в «Сырьё» вырастет использование).</p><p className="mt-1">«4%» — надбавка посредника (Веллмех) к меху и подкладке: {COMMISSION_RATE * 100}% от цены без НДС. Работа и расходы не облагаются.</p></>}>
        <div className={`${cardCls} flex flex-col gap-3`}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">Мех <span className="font-normal text-neutral-500">· {formatQty(T.fur.qty)} шт.</span></h3>
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
          {lineTable("fur", fur, furLots, "шт.")}

          <div className="flex items-center gap-2 border-t border-neutral-100 pt-3">
            <h3 className="text-sm font-medium">Подкладка <span className="font-normal text-neutral-500">· {formatQty(T.lining.qty)} м</span></h3>
            <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => addLine("lining")}>+ Лот подкладки</Button>
          </div>
          {lineTable("lining", lining, liningLots, "м")}

          <div className="flex items-center gap-2 border-t border-neutral-100 pt-3">
            <h3 className="text-sm font-medium">Расходы</h3>
            <InfoHint label="Расходы">Статьи из справочника «Статьи расходов» (производство). Расход входит в себестоимость ТЗ без НДС и без 4%.</InfoHint>
            <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => setExps((p) => [...p, { key: nextKey(), categoryId: "", amount: "", desc: "" }])}>+ Расход</Button>
          </div>
          {exps.length === 0 ? (
            <p className="text-sm text-neutral-500">Расходов нет — фурнитура, оплата труда и прочее можно добавить сейчас или позже на карточке.</p>
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
                  <button type="button" onClick={() => setExps((p) => p.filter((y) => y.key !== x.key))} className="rounded px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-red-600" aria-label={`Убрать расход ${i + 1}`}>✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-neutral-100 pt-3 text-sm">
            <h3 className="font-medium">Работа</h3>
            <span className="text-neutral-500">
              {Number.isFinite(workPrice) && workPrice > 0 ? formatMoney(workPrice) : "—"} ₽/шт. × {Number.isFinite(qtyPlan) && qtyPlan > 0 ? formatQty(qtyPlan) : "—"} шт. =
            </span>
            <b className="tabular-nums">{T.work > 0 ? formatMoney(T.work) : "—"}</b>
            <a href="#params" className="text-xs text-blue-700 hover:underline">изменить в параметрах</a>
          </div>
        </div>
      </Step>

      <Step n={3} title="Итоги" hint={<><p>Пересчитывается на лету, до сохранения; формулы те же, что в карточке ТЗ: мех + подкладка (с 4% или без) + расходы + работа. «С 4%» — основная цифра, под ней «без 4%». Показ «С НДС / Без НДС» — общий переключатель шапки.</p><p className="mt-1">Средневзвешенная цена — сумма по лотам ÷ количество; расход на 1 изделие — количество шкур (метров) ÷ количество изделий.</p></>}>
        <div className={`${cardCls} grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6`}>
          {[
            ["Мех", T.fur.incl4, T.fur.excl4, T.fur.baseIncl, T.fur.baseExcl],
            ["Подкладка", T.lining.incl4, T.lining.excl4, T.lining.baseIncl, T.lining.baseExcl],
          ].map(([label, i4, e4, i0, e0]) => (
            <div key={label as string}>
              <div className="text-xs text-neutral-500">{label as string} · с 4%</div>
              <div className="font-medium tabular-nums">{(i4 as number) > 0 ? <M incl={i4 as number} excl={e4 as number} /> : "—"}</div>
              {(i0 as number) > 0 && <div className="text-[11px] text-neutral-400">без 4%: <M incl={i0 as number} excl={e0 as number} /></div>}
            </div>
          ))}
          <div>
            <div className="text-xs text-neutral-500">Расходы</div>
            <div className="font-medium tabular-nums">{T.expenses > 0 ? formatMoney(T.expenses) : "—"}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Работа</div>
            <div className="font-medium tabular-nums">{T.work > 0 ? formatMoney(T.work) : "—"}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Себестоимость ТЗ · с 4%</div>
            <div className="text-base font-semibold tabular-nums">{T.grandIncl4 > 0 ? <M incl={T.grandIncl4} excl={T.grandExcl4} /> : "—"}</div>
            {T.grandIncl0 > 0 && <div className="text-[11px] text-neutral-400">без 4%: <M incl={T.grandIncl0} excl={T.grandExcl0} /></div>}
          </div>
          <div>
            <div className="text-xs text-neutral-500">На 1 изделие · с 4%</div>
            <div className="font-medium tabular-nums">{T.perUnitIncl4 != null && T.grandIncl4 > 0 ? <M incl={T.perUnitIncl4} excl={T.perUnitExcl4 ?? 0} /> : "—"}</div>
            {T.perUnitIncl0 != null && T.grandIncl0 > 0 && <div className="text-[11px] text-neutral-400">без 4%: <M incl={T.perUnitIncl0} excl={T.perUnitExcl0 ?? 0} /></div>}
          </div>
          <div>
            <div className="text-xs text-neutral-500">4% добавляют</div>
            <div className="font-medium tabular-nums">{T.extra4 > 0.005 ? formatMoney(T.extra4) : "—"}</div>
          </div>
          <div className="col-span-2 sm:col-span-3 lg:col-span-3">
            <div className="text-xs text-neutral-500">НДС в списаниях (с 4%)</div>
            <div className="tabular-nums">
              {vatRows4.length === 0 ? "—" : vatRows4.map((r) => (
                <span key={r.rate} className="mr-3 inline-block">НДС {r.rate}%: <b className="font-medium">{formatMoney(Math.round(r.vat))}</b> <span className="text-[11px] text-neutral-400">из {formatMoney(Math.round(r.incl))}</span></span>
              ))}
            </div>
          </div>
          <div className="col-span-2 sm:col-span-3 lg:col-span-3">
            <div className="text-xs text-neutral-500">Средневзвешенное · расход на 1 изделие</div>
            <div className="text-[13px] tabular-nums">
              <div>Мех: {T.furAvgPrice ? <><b className="font-medium">{formatMoney(Math.round(T.furAvgPrice.incl4))}</b>/шкуру <span className="text-[11px] text-neutral-400">(без 4%: {formatMoney(Math.round(T.furAvgPrice.incl0))})</span></> : "—"}{T.furPerItem != null ? <> · {formatQty(Math.round(T.furPerItem * 100) / 100)} шк./изд.</> : ""}</div>
              {T.liningAvgPrice && (
                <div>Подкладка: <b className="font-medium">{formatMoney(Math.round(T.liningAvgPrice.incl4))}</b>/м <span className="text-[11px] text-neutral-400">(без 4%: {formatMoney(Math.round(T.liningAvgPrice.incl0))})</span>{T.liningPerItem != null ? <> · {formatQty(Math.round(T.liningPerItem * 100) / 100)} м/изд.</> : ""}</div>
              )}
            </div>
          </div>
        </div>
        {clientName && <p className="text-xs text-neutral-500">Заказчик: {clientName}. Оплаты заказчика разносятся на ТЗ в «Оплаты → Заказчики».</p>}
      </Step>

      <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center gap-2 border-t border-neutral-200 bg-white px-1 py-2">
        <div className="min-w-0 text-sm">
          <span className="text-neutral-500">Себестоимость: </span>
          <b className="tabular-nums">{T.grandIncl4 > 0 ? <M incl={T.grandIncl4} excl={T.grandExcl4} /> : "—"}</b>
          {T.perUnitIncl4 != null && T.grandIncl4 > 0 && <span className="text-neutral-500"> · на 1 изд. <span className="tabular-nums"><M incl={T.perUnitIncl4} excl={T.perUnitExcl4 ?? 0} /></span></span>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="submit" name="intent" value="again" variant="outline" size="sm" disabled={pending}>Сохранить и добавить ещё</Button>
          <Button type="submit" name="intent" value="open" disabled={pending}>{pending ? "Сохраняем…" : "Сохранить ТЗ"}</Button>
        </div>
      </div>
    </form>
  );
}
