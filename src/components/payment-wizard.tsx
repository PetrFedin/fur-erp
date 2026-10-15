"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { useConfirm } from "@/components/confirm-dialog";
import { PaymentForm, type PaymentPreset } from "@/components/payment-form";
import { PAY_KINDS, PRESET_PERCENTS, DOC_ROLES, canConfirm, guessDocRole, type DocRole, type PayKind } from "@/lib/payment-form-core";
import { splitByWeights } from "@/lib/payment-alloc-core";
import { centsOf, refHit, remainingOf, rubOf, suggestSupplierAlloc, suggestWorkAlloc } from "@/lib/payment-wizard-core";
import { checkWizardDuplicate, getWizardData, saveWizardPayment, type WizardData, type WizardResult } from "@/app/(app)/payments/wizard-actions";

const money = (c: number) => (c / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
/** Подпись остатка цели в списке: остаток / оплачено / переплата (минус не показываем). */
const remLabel = (c: number) => (c >= 100 ? `остаток ${money(c)}` : c <= -100 ? `переплата ${money(-c)}` : "оплачено");
const rub = (n: number | null) => (n == null ? "—" : n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const STEPS = ["Оплата", "Разнесение", "Что изменится"];
const KINDS = PAY_KINDS.filter((k) => !k.supplierOnly && k.v !== "PERCENT");
type Line = { key: string; amount: string; why: string };

/** Цели разнесения, которые зафиксировала карточка: аукцион, закупка (внутри аукциона — его аукцион), партия, ТЗ. */
function presetKeysOf(d: WizardData, preset?: PaymentPreset): string[] {
  if (!preset) return [];
  if (preset.side === "work") {
    if (preset.batchId) return d.workTargets.filter((t) => t.batchId === preset.batchId).map((t) => t.id);
    return (preset.orderIds ?? []).filter((id) => d.workTargets.some((t) => t.id === id));
  }
  if (preset.auction) return d.supTargets.some((t) => t.key === `a:${preset.auction}`) ? [`a:${preset.auction}`] : [];
  if (preset.purchaseId) {
    const t = d.supTargets.find((x) => x.purchaseIds?.includes(preset.purchaseId!));
    return t ? [t.key] : [];
  }
  return [];
}

/**
 * Мастер «Внести оплату и разнести»: 1) оплата, 2) разнесение по закупкам / аукционам / ТЗ с остатком «не разнесено»,
 * 3) что изменится и запись одной транзакцией. Предложения — по правилам lib/payment-wizard-core (основание → самые старые → пропорционально работе).
 * ЕДИНАЯ точка входа для оплат: общая кнопка «+ Внести оплату», карточки закупки / аукциона / партии / ТЗ (preset фиксирует цель).
 * Обязательны № счёта и № п/п; файл (платёжка, счёт) — по желанию.
 */
export function PaymentWizard({ onDone, defaultSide, preset }: { onDone?: () => void; defaultSide?: "supplier" | "work"; preset?: PaymentPreset }) {
  const [data, setData] = useState<WizardData | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [quick, setQuick] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [side, setSide] = useState<"supplier" | "work">("supplier");
  const [supplierId, setSupplierId] = useState("");
  const [clientId, setClientId] = useState("");
  const [kind, setKind] = useState<PayKind>("INVOICE");
  const [paidAt, setPaidAt] = useState(today());
  const [amount, setAmount] = useState("");
  const [ppNo, setPpNo] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileRole, setFileRole] = useState<DocRole>("PAYMENT_PROOF");
  const [batchPick, setBatchPick] = useState("");
  const [basis, setBasis] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [markConfirmed, setMarkConfirmed] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<WizardResult | null>(null);
  const [pending, start] = useTransition();
  const { ask, node } = useConfirm();

  useEffect(() => {
    getWizardData().then((d) => {
      if ("error" in d) return setLoadErr(d.error);
      setData(d);
      if ((!d.canSupplier && d.canWork) || (defaultSide === "work" && d.canWork)) setSide("work");
      if (d.suppliers.length === 1) setSupplierId(d.suppliers[0].id);
      if (preset?.kind && PAY_KINDS.some((k) => k.v === preset.kind && !k.supplierOnly && k.v !== "PERCENT")) setKind(preset.kind);
      const pk = presetKeysOf(d, preset);
      if (pk.length > 0) {
        if (preset?.side === "work") {
          setSide("work");
          const t = d.workTargets.find((x) => x.id === pk[0]);
          if (t?.clientId) setClientId(t.clientId);
        } else {
          setSide("supplier");
          const t = d.supTargets.find((x) => x.key === pk[0]);
          const sid = preset?.supplierId && t?.supplierIds.includes(preset.supplierId) ? preset.supplierId : t?.supplierIds[0];
          if (sid) setSupplierId(sid);
          // С карточки закупки сразу предлагаем остаток к оплате (его можно изменить или выбрать 30% / 50% / 70%).
          if (preset?.purchaseId && t) { const rc = Math.max(0, remainingOf(t)); if (rc >= 100) setAmount(rubOf(rc)); }
        }
      } else if (preset?.side === "work" && preset.clientId && d.canWork && d.clients.some((x) => x.id === preset.clientId)) {
        setSide("work");
        setClientId(preset.clientId);
      } else if (preset?.supplierId && d.suppliers.some((x) => x.id === preset.supplierId)) {
        setSide("supplier");
        setSupplierId(preset.supplierId);
      }
    }).catch(() => setLoadErr("Не удалось загрузить данные: нет связи с сервером"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSide]);
  // Цель, зафиксированная карточкой (закупка, аукцион, партия, ТЗ): список целей разнесения, поля «кому» не показываем.
  const presetKeys = useMemo(() => (data ? presetKeysOf(data, preset) : []), [data, preset]);
  const locked = presetKeys.length > 0;

  const amountC = centsOf(amount);
  const [dupNote, setDupNote] = useState("");
  const counterpartyId = side === "supplier" ? supplierId : clientId;
  // Мягкая подсветка дубля: та же дата + сумма + контрагент уже есть в базе (ничего не блокирует).
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      if (!paidAt || !Number.isFinite(amountC) || amountC < 1) return setDupNote("");
      checkWizardDuplicate({ side, counterpartyId, paidAt, amount }).then((r) => { if (alive) setDupNote(r.dup ?? ""); }).catch(() => { if (alive) setDupNote(""); });
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [side, counterpartyId, paidAt, amount, amountC]);
  const futureDate = !!paidAt && paidAt > today();
  const targets = useMemo(() => {
    if (!data) return [];
    if (side === "supplier") return data.supTargets.filter((t) => !supplierId || t.supplierIds.includes(supplierId));
    return data.workTargets.filter((t) => !clientId || t.clientId === clientId);
  }, [data, side, supplierId, clientId]);
  const labelOfKey = (k: string) => data?.supTargets.find((t) => t.key === k)?.label ?? data?.workTargets.find((t) => t.id === k)?.label ?? k;
  const presetBase = presetKeys.reduce((a, k) => { const t = data?.supTargets.find((x) => x.key === k); const w = data?.workTargets.find((x) => x.id === k); return a + (t ? t.totalCents : w ? w.workCents : 0); }, 0);
  const presetRest = presetKeys.reduce((a, k) => { const t = data?.supTargets.find((x) => x.key === k); const w = data?.workTargets.find((x) => x.id === k); return a + Math.max(0, t ? remainingOf(t) : w ? w.workCents - w.paidCents : 0); }, 0);
  const labelOf = (key: string) => targets.find((t) => ("key" in t ? t.key : t.id) === key)?.label ?? key;
  const remOf = (key: string): number => {
    const t = targets.find((x) => ("key" in x ? x.key : x.id) === key);
    if (!t) return 0;
    return "key" in t ? remainingOf(t) : t.workCents - t.paidCents;
  };
  // Номер счёта подсказывает цель только если такой счёт уже известен какой-то закупке (иначе новый счёт увёл бы всё в «аванс»).
  const invBasis = invoiceNo.trim() ? `${side === "work" ? "документ" : "счёт"} № ${invoiceNo.trim()}` : "";
  const invKnown = side === "supplier" && !!invBasis && (targets as WizardData["supTargets"]).some((t) => refHit(t.refs, invBasis));
  const allocBasis = [invKnown ? invBasis : "", basis].filter(Boolean).join(", ");
  const sumC = lines.reduce((s, l) => s + (Number.isFinite(centsOf(l.amount)) ? centsOf(l.amount) : 0), 0);
  const restC = Number.isFinite(amountC) ? amountC - sumC : 0;

  function autoAlloc() {
    if (!Number.isFinite(amountC) || amountC < 1) return;
    if (locked && side === "supplier") {
      const t = data!.supTargets.find((x) => x.key === presetKeys[0])!;
      const room = remainingOf(t);
      const c = room >= 100 ? Math.min(amountC, room) : amountC;
      setLines([{ key: t.key, amount: rubOf(c), why: "цель выбрана в карточке" }]);
      setHint(amountC - c >= 100 ? `Сумма больше остатка цели на ${money(amountC - c)}: разница останется авансом без привязки.` : "");
      return;
    }
    if (locked && side === "work") {
      const ts = data!.workTargets.filter((x) => presetKeys.includes(x.id));
      const split = splitByWeights(amountC, ts.map((t) => ({ id: t.id, weight: t.workCents, cap: Math.max(0, t.workCents - t.paidCents) })));
      setHint("");
      if (split.size === 0 && ts.length === 1) return setLines([{ key: ts[0].id, amount: rubOf(amountC), why: "цель выбрана в карточке" }]);
      setLines(ts.filter((t) => (split.get(t.id) ?? 0) > 0).map((t) => ({ key: t.id, amount: rubOf(split.get(t.id)!), why: ts.length > 1 ? "цель из карточки: пропорционально работе" : "цель выбрана в карточке" })));
      return;
    }
    if (side === "supplier") {
      const r = suggestSupplierAlloc(amountC, targets as WizardData["supTargets"], allocBasis);
      setLines(r.parts.map((p) => ({ key: p.key, amount: rubOf(p.cents), why: p.why })));
      setHint(r.hint ?? "");
    } else {
      setHint("");
      const r = suggestWorkAlloc(amountC, targets as WizardData["workTargets"], basis);
      setLines(r.parts.map((p) => ({ key: p.id, amount: rubOf(p.cents), why: p.why })));
    }
  }
  // Аванс на партию целиком: те же правила, что для «партия N» в основании (пропорционально работе ТЗ, не больше остатка каждого).
  const batchOptions = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of targets as WizardData["workTargets"]) if (side === "work" && t.batch != null) m.set(t.batch, (m.get(t.batch) ?? 0) + 1);
    return [...m].sort((a, b) => a[0] - b[0]);
  }, [targets, side]);
  function allocToBatch() {
    const n = Number(batchPick);
    if (!Number.isFinite(amountC) || amountC < 1 || !Number.isFinite(n) || !batchPick) return;
    const r = suggestWorkAlloc(amountC, (targets as WizardData["workTargets"]).filter((t) => t.batch === n), `партия ${n}`);
    setLines(r.parts.map((p) => ({ key: p.id, amount: rubOf(p.cents), why: "партия целиком: пропорционально работе" })));
    setHint(r.restCents >= 100 ? `По партии ${n} остатка работы меньше суммы оплаты: ${money(r.restCents)} останется неразнесённым авансом.` : r.parts.length === 0 ? `В партии ${n} нет ТЗ с остатком работы — вся сумма останется неразнесённым авансом.` : "");
  }
  const patchLine = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  const step1Problems: string[] = [];
  if (!Number.isFinite(amountC) || amountC < 1) step1Problems.push("Укажите сумму оплаты больше нуля");
  if (!paidAt) step1Problems.push("Укажите дату оплаты");
  if (side === "supplier" && !supplierId) step1Problems.push("Выберите поставщика");
  if (side === "work" && !clientId) step1Problems.push("Выберите заказчика");
  if (side === "supplier" && !invoiceNo.trim()) step1Problems.push("Укажите номер счёта");
  if (!ppNo.trim()) step1Problems.push("Укажите № п/п");
  if (kind === "OTHER" && note.trim().length < 3) step1Problems.push("Для вида «Другое» напишите пометку");
  if (markConfirmed && !canConfirm({ hasProofFile: false, ppNo, paidAt, amount: amountC / 100 })) step1Problems.push("«Подтверждено» — только с № п/п");

  const step2Problems: string[] = [];
  if (lines.some((l) => !(centsOf(l.amount) >= 1))) step2Problems.push("У каждой строки сумма должна быть больше нуля");
  if (new Set(lines.map((l) => l.key)).size !== lines.length || lines.some((l) => !l.key)) step2Problems.push("Выберите цель в каждой строке, без повторов");
  if (restC < 0) step2Problems.push(`Разнесено больше суммы оплаты на ${money(-restC)}`);

  function go(n: 2 | 3) {
    setError("");
    if (n === 2) {
      if (step1Problems.length) return setError(step1Problems[0]);
      if (lines.length === 0 && kind !== "ADVANCE") autoAlloc();
      return setStep(2);
    }
    if (step2Problems.length) return setError(step2Problems[0]);
    setStep(3);
  }

  function buildForm(confirmOverpay: boolean): FormData {
    const fd = new FormData();
    fd.set("payload", JSON.stringify({ side, kind, paidAt, amount, ppNo, invoiceNo, basis, note, method, supplierId, clientId, markConfirmed, confirmOverpay, parts: lines.map((l) => ({ key: l.key, amount: l.amount })) }));
    if (file) {
      fd.set("file", file);
      fd.set("fileRole", fileRole);
    }
    return fd;
  }
  function save(confirmOverpay = false) {
    setError("");
    start(async () => {
      try {
        const r = await saveWizardPayment(buildForm(confirmOverpay));
        if (r.confirm) {
          if (await ask(r.confirm, { ok: "Записать" })) save(true);
          return;
        }
        if (r.error) return setError(r.error);
        setResult(r);
        setStep(4);
      } catch {
        setError("Нет ответа от сервера. Оплата могла записаться: проверьте список оплат перед повторной отправкой.");
      }
    });
  }

  if (quick) {
    return (
      <div className="flex flex-col gap-3">
        <button type="button" className="w-fit text-sm text-neutral-600 underline" onClick={() => setQuick(false)}>← Вернуться в мастер</button>
        <PaymentForm requireYear onDone={onDone} preset={{ side: "supplier", kind: "REFUND", supplierId: supplierId || undefined }} />
      </div>
    );
  }
  if (loadErr) return <p className="text-sm text-red-700">{loadErr}</p>;
  if (!data) return <p className="text-sm text-neutral-500">Загружаем закупки и ТЗ…</p>;

  const targetOptions = (current: string) => targets.filter((t) => {
    const k = "key" in t ? t.key : t.id;
    return k === current || !lines.some((l) => l.key === k);
  });

  return (
    <div className="flex flex-col gap-3" data-payment-wizard>
      {node}
      <ol className="flex flex-wrap gap-1 text-xs" aria-label="Шаги мастера">
        {STEPS.map((s, i) => (
          <li key={s} className={"rounded-full border px-3 py-1 " + (i + 1 === step ? "border-neutral-900 bg-neutral-900 text-white" : i + 1 < step || step === 4 ? "border-green-300 bg-green-50 text-green-900" : "border-neutral-200 text-neutral-500")}>{i + 1}. {s}</li>
        ))}
        {side === "supplier" && <li className="ml-auto"><button type="button" className="text-neutral-500 underline" onClick={() => setQuick(true)} disabled={step === 4} title="Возврат или зачёт уменьшают оплаченное — вносятся отдельной записью с минусом">Возврат / зачёт</button></li>}
      </ol>

      {step === 1 && (
        <div className="flex flex-col gap-3">
          {locked && <p className="rounded-md bg-[var(--ui-soft)] px-3 py-2 text-sm" data-wizard-locked>Оплата по: <b>{presetKeys.map(labelOfKey).join(", ")}</b></p>}
          {!locked && <div className="flex flex-wrap gap-3 text-sm">
            {data.canSupplier && <label className="flex items-center gap-1.5"><input type="radio" checked={side === "supplier"} onChange={() => { setSide("supplier"); setLines([]); }} /> Поставщику</label>}
            {data.canWork && <label className="flex items-center gap-1.5"><input type="radio" checked={side === "work"} onChange={() => { setSide("work"); setLines([]); }} /> За производство / от заказчика (по ТЗ)</label>}
          </div>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!locked && side === "supplier" && data.suppliers.length > 1 && (
              <div><Label htmlFor="pw-sup">Поставщик</Label><Select id="pw-sup" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setLines([]); }}><option value="">Выберите…</option>{data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
            )}
            {!locked && side === "work" && (
              <div><Label htmlFor="pw-cl">Заказчик</Label><Select id="pw-cl" value={clientId} onChange={(e) => { setClientId(e.target.value); setLines([]); }}><option value="">Выберите…</option>{data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
            )}
            <div><Label htmlFor="pw-kind">Вид оплаты</Label><Select id="pw-kind" value={kind} onChange={(e) => setKind(e.target.value as PayKind)}>{KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}</Select></div>
            <div><Label htmlFor="pw-date">Дата оплаты</Label><Input id="pw-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></div>
            <div><Label htmlFor="pw-amount">Сумма, ₽</Label><Input id="pw-amount" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setLines([]); }} placeholder="например, 1 500 000,00" /></div>
            <div><Label htmlFor="pw-inv">{side === "work" ? "№ документа (по желанию)" : "№ счёта (обязательно)"}</Label><Input id="pw-inv" value={invoiceNo} onChange={(e) => { setInvoiceNo(e.target.value); setLines([]); }} placeholder={side === "work" ? "счёт, акт или письмо" : "например, 2004"} required={side !== "work"} /></div>
            <div><Label htmlFor="pw-pp">№ п/п (обязательно; дата — выше)</Label><Input id="pw-pp" value={ppNo} onChange={(e) => setPpNo(e.target.value)} placeholder="например, 43831" required /></div>
            <div><Label htmlFor="pw-method">Способ</Label><Select id="pw-method" value={method} onChange={(e) => setMethod(e.target.value)}><option value="BANK_TRANSFER">Банк. перевод</option><option value="CASH">Наличные</option><option value="CARD">Карта</option><option value="OTHER">Другое</option></Select></div>
            <div className="sm:col-span-2"><Label htmlFor="pw-file">Файл (по желанию): платёжка или счёт</Label>
              <div className="flex flex-wrap items-center gap-2">
                <input ref={fileInputRef} id="pw-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.xls,.xlsx,.doc,.docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f) setFileRole(guessDocRole(f.name)); }} />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>{file ? "Заменить файл" : "Выбрать файл"}</Button>
                <span className="max-w-64 truncate text-xs text-neutral-500">{file ? file.name : "файл не выбран"}</span>
                {file && <Select className="h-8 w-48 text-xs" value={fileRole} onChange={(e) => setFileRole(e.target.value as DocRole)} aria-label="Тип файла">{DOC_ROLES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}</Select>}
              </div>
            </div>
            <div className="sm:col-span-2"><Label htmlFor="pw-basis">Основание (по нему система предложит разнесение)</Label><Input id="pw-basis" value={basis} onChange={(e) => { setBasis(e.target.value); setLines([]); }} placeholder={side === "supplier" ? "например: счёт 2004, спецификация 13, СП 09.26" : "например: ТЗ 88, ТЗ 91"} /></div>
            {(kind === "OTHER" || note) && <div className="sm:col-span-2"><Label htmlFor="pw-note">Пометка</Label><Input id="pw-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>}
          </div>
          {locked && (
            <div className="flex flex-wrap gap-2" aria-label="Быстрая сумма">
              {PRESET_PERCENTS.map((pc) => <Button key={pc} type="button" size="sm" variant="outline" onClick={() => { setAmount(rubOf(Math.round((presetBase * pc) / 100))); setLines([]); }}>{pc}% · {money(Math.round((presetBase * pc) / 100))}</Button>)}
              <Button type="button" size="sm" variant="outline" disabled={presetRest <= 0} onClick={() => { setAmount(rubOf(presetRest)); setLines([]); }}>Остаток · {money(presetRest)}</Button>
            </div>
          )}
          {futureDate && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" role="note" data-wizard-future>Дата в будущем — оплата ещё не произведена? Плановую оплату внести можно, при записи спросим ещё раз.</p>}
          {dupNote && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" role="note" data-wizard-dup>{dupNote}</p>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={markConfirmed} onChange={(e) => setMarkConfirmed(e.target.checked)} /> Отметить оплату подтверждённой (нужен № п/п)</label>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" className="btn-accent" variant="outline" onClick={autoAlloc}>Разнести автоматически</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => { setLines([]); setHint(""); }}>Оставить авансом</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, { key: "", amount: restC > 0 ? rubOf(restC) : "", why: "добавлено вручную" }])} disabled={targets.length === 0}>+ Строка</Button>
          </div>
          {side === "work" && !locked && batchOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" data-wizard-batch>
              <Select className="h-8 w-56 text-xs" value={batchPick} onChange={(e) => setBatchPick(e.target.value)} aria-label="Партия"><option value="">Партия целиком…</option>{batchOptions.map(([n, c]) => <option key={n} value={n}>Партия {n} · ТЗ: {c}</option>)}</Select>
              <Button type="button" size="sm" variant="outline" disabled={!batchPick} onClick={allocToBatch} title="Делит сумму между ТЗ партии пропорционально работе, не больше остатка работы каждого ТЗ">Разнести на партию</Button>
            </div>
          )}
          {hint && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" role="note" data-wizard-hint>{hint}</p>}
          {targets.length === 0 && <p className="text-sm text-amber-800">{side === "supplier" ? "У этого поставщика нет закупок для разнесения — оплата будет внесена авансом." : "У этого заказчика нет ТЗ для разнесения — оплата будет внесена как неразнесённый аванс."}</p>}
          {lines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-neutral-500"><tr><th className="py-1">{side === "supplier" ? "Закупка / аукцион" : "ТЗ"}</th><th className="text-right">Остаток до</th><th className="w-40 text-right">Сумма, ₽</th><th className="pl-2">Почему</th><th /></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-t border-neutral-100 align-top">
                      <td className="py-1 pr-2"><Select className="h-8 text-xs" value={l.key} onChange={(e) => patchLine(i, { key: e.target.value, why: "выбрано вручную" })} aria-label="Цель разнесения"><option value="">Выберите…</option>{targetOptions(l.key).map((t) => { const k = "key" in t ? t.key : t.id; return <option key={k} value={k}>{t.label} · {remLabel("key" in t ? remainingOf(t) : t.workCents - t.paidCents)}</option>; })}</Select></td>
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{l.key ? money(remOf(l.key)) : "—"}</td>
                      <td className="py-1"><Input className="h-8 text-right text-xs" inputMode="decimal" value={l.amount} onChange={(e) => patchLine(i, { amount: e.target.value, why: "изменено вручную" })} aria-label="Сумма" /></td>
                      <td className="py-1 pl-2 text-xs text-neutral-500">{l.why}</td>
                      <td className="py-1 text-right"><button type="button" className="text-xs text-neutral-500 underline" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>убрать</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {lines.filter((l) => l.key && centsOf(l.amount) - remOf(l.key) >= 100).map((l) => (
            <p key={l.key} className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert" data-wizard-overpay>Сумма больше остатка: {labelOf(l.key)} — остаток {money(Math.max(remOf(l.key), 0))}, разнесено {money(centsOf(l.amount))} (переплата {money(centsOf(l.amount) - Math.max(remOf(l.key), 0))}). Записать можно, при записи спросим ещё раз.</p>
          ))}
          <div className={"rounded-md px-3 py-2 text-sm " + (restC < 0 ? "bg-red-50 text-red-800" : restC > 0 ? "bg-amber-50 text-amber-900" : "bg-green-50 text-green-900")} role="status" data-rest>
            Сумма оплаты {money(amountC)}; разнесено {money(sumC)}; <b>{restC < 0 ? `перебор ${money(-restC)}` : restC > 0 ? `не разнесено ${money(restC)}${side === "supplier" ? " — останется авансом без привязки" : " — останется неразнесённым авансом заказчика"}` : "всё разнесено"}</b>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3" data-wizard-summary>
          <p className="text-sm font-semibold">{side === "supplier" ? "Поставщику" : "По работе"}: {money(amountC)} от {paidAt.split("-").reverse().join(".")}{ppNo ? `, п/п № ${ppNo}` : ""}</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-500"><tr><th className="py-1">{side === "supplier" ? "Закупка / аукцион" : "ТЗ"}</th><th className="text-right">{side === "supplier" ? "Остаток к оплате" : "Остаток работы"}: было</th><th className="text-right">станет</th></tr></thead>
            <tbody>
              {lines.map((l) => { const before = remOf(l.key); const c = centsOf(l.amount); return (<tr key={l.key} className="border-t border-neutral-100"><td className="py-1">{labelOf(l.key)} <span className="text-xs text-neutral-500">(−{money(c)})</span></td><td className="text-right tabular-nums">{money(before)}</td><td className={"text-right tabular-nums " + (before - c < 0 ? "text-amber-800" : "")}>{money(before - c)}{before - c < 0 ? " (переплата)" : ""}</td></tr>); })}
              {restC > 0 && <tr className="border-t border-neutral-100"><td className="py-1">{side === "supplier" ? "Аванс без привязки" : "Не разнесено (аванс заказчика)"}</td><td className="text-right">—</td><td className="text-right tabular-nums text-amber-800">{money(restC)}</td></tr>}
            </tbody>
          </table>
          {side === "supplier" ? (
            <div className="rounded-md bg-[var(--ui-soft)] px-3 py-2 text-sm">Долг поставщику (Главная, «Оплачено» / «К оплате»): {rub(data.debtNow)} → <b>{rub(data.debtNow == null ? null : Math.round((data.debtNow - amountC / 100) * 100) / 100)}</b>. «Оплачено» вырастет на {money(amountC)}, «К оплате» уменьшится на ту же сумму, включая аванс без привязки.</div>
          ) : (
            <div className="rounded-md bg-[var(--ui-soft)] px-3 py-2 text-sm">Долг заказчика уменьшится на {money(amountC)}: на ТЗ разнесено {money(sumC)}{restC > 0 ? `, ещё ${money(restC)} учитывается отдельной строкой «неразнесённые авансы»` : ""}. В Контроле неразнесённое остаётся в списке авансов до разнесения.</div>
          )}
          <p className="text-xs text-neutral-500">Подтверждение связанных закупок / ТЗ сбрасывается — проверьте их в «Подтвердить». Счёт № {invoiceNo}{file ? `; файл: ${file.name}` : "; файла нет — его можно приложить позже"}.</p>
        </div>
      )}

      {step === 4 && result?.summary && (
        <div className="flex flex-col gap-2" data-wizard-result>
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">Оплата записана{result.paymentIds && result.paymentIds.length > 1 ? ` (записей: ${result.paymentIds.length})` : ""}.</p>
          <ul className="list-disc pl-5 text-sm">{result.summary.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          {result.summary.debtBefore != null && <p className="text-sm">Долг поставщику: {rub(result.summary.debtBefore)} → <b>{rub(result.summary.debtAfter)}</b></p>}
          <div className="flex gap-2"><Button type="button" onClick={() => { if (onDone) onDone(); else window.location.reload(); }}>Готово</Button></div>
        </div>
      )}

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
      {step < 4 && (
        <div className="flex flex-wrap gap-2">
          {step > 1 && <Button type="button" variant="outline" disabled={pending} onClick={() => setStep((step - 1) as 1 | 2)}>← Назад</Button>}
          {step === 1 && <Button type="button" onClick={() => go(2)} disabled={step1Problems.length > 0}>Далее: разнесение →</Button>}
          {step === 2 && <Button type="button" onClick={() => go(3)} disabled={step2Problems.length > 0}>Далее: что изменится →</Button>}
          {step === 3 && <Button type="button" onClick={() => save()} disabled={pending}>{pending ? "Записываем…" : "Записать оплату"}</Button>}
          {onDone && <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>Отмена</Button>}
          {step === 1 && step1Problems.length > 0 && <span className="self-center text-xs text-neutral-500">{step1Problems[0]}</span>}
        </div>
      )}
    </div>
  );
}

/** Кнопка «+ Внести оплату»: открывает мастер в окне. */
export function PaymentWizardButton({ label = "+ Внести оплату", defaultSide, preset, variant, size }: { label?: string; defaultSide?: "supplier" | "work"; preset?: PaymentPreset; variant?: "outline" | "default"; size?: "sm" | "default" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
  }, [open]);
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)} className="max-md:h-10">{label}</Button>
      {open && (
        <dialog ref={ref} aria-labelledby="pw-dlg-title" onClose={() => setOpen(false)} className="m-auto w-[calc(100vw-2rem)] max-w-3xl rounded-xl border border-neutral-200 bg-white p-0 text-left shadow-xl backdrop:bg-black/40">
          <div className="max-h-[88vh] overflow-y-auto p-4">
            <div className="mb-3 flex items-start justify-between gap-3 border-b border-neutral-200 pb-3">
              <h2 id="pw-dlg-title" className="block-title">Внести оплату и разнести</h2>
              <button type="button" onClick={() => ref.current?.close()} aria-label="Закрыть окно" className="btn-accent rounded-lg border border-neutral-300 px-2.5 py-1 text-sm">✕</button>
            </div>
            <PaymentWizard defaultSide={defaultSide} preset={preset} onDone={() => { ref.current?.close(); window.location.reload(); }} />
          </div>
        </dialog>
      )}
    </>
  );
}
