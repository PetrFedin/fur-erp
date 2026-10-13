"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { useConfirm } from "@/components/confirm-dialog";
import { PaymentForm } from "@/components/payment-form";
import { DOC_ROLES, PAY_KINDS, guessDocRole, canConfirm, type DocRole, type PayKind } from "@/lib/payment-form-core";
import { centsOf, remainingOf, rubOf, suggestSupplierAlloc, suggestWorkAlloc } from "@/lib/payment-wizard-core";
import { getWizardData, saveWizardPayment, type WizardData, type WizardResult } from "@/app/(app)/payments/wizard-actions";

const money = (c: number) => (c / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
const rub = (n: number | null) => (n == null ? "—" : n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const STEPS = ["Оплата", "Разнесение", "Что изменится"];
const KINDS = PAY_KINDS.filter((k) => !k.supplierOnly && k.v !== "PERCENT");
type Line = { key: string; amount: string; why: string };
type Pick = { file: File; role: DocRole };

/**
 * Мастер «Внести оплату и разнести»: 1) оплата, 2) разнесение по закупкам / аукционам / ТЗ с остатком «не разнесено»,
 * 3) что изменится и запись одной транзакцией. Предложения — по правилам lib/payment-wizard-core (основание → самые старые → пропорционально работе).
 */
export function PaymentWizard({ onDone }: { onDone?: () => void }) {
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
  const [basis, setBasis] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [files, setFiles] = useState<Pick[]>([]);
  const [markConfirmed, setMarkConfirmed] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<WizardResult | null>(null);
  const [pending, start] = useTransition();
  const { ask, node } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getWizardData().then((d) => {
      if ("error" in d) return setLoadErr(d.error);
      setData(d);
      if (!d.canSupplier && d.canWork) setSide("work");
      if (d.suppliers.length === 1) setSupplierId(d.suppliers[0].id);
    }).catch(() => setLoadErr("Не удалось загрузить данные: нет связи с сервером"));
  }, []);

  const amountC = centsOf(amount);
  const targets = useMemo(() => {
    if (!data) return [];
    if (side === "supplier") return data.supTargets.filter((t) => !supplierId || t.supplierIds.includes(supplierId));
    return data.workTargets.filter((t) => !clientId || t.clientId === clientId);
  }, [data, side, supplierId, clientId]);
  const labelOf = (key: string) => targets.find((t) => ("key" in t ? t.key : t.id) === key)?.label ?? key;
  const remOf = (key: string): number => {
    const t = targets.find((x) => ("key" in x ? x.key : x.id) === key);
    if (!t) return 0;
    return "key" in t ? remainingOf(t) : t.workCents - t.paidCents;
  };
  const sumC = lines.reduce((s, l) => s + (Number.isFinite(centsOf(l.amount)) ? centsOf(l.amount) : 0), 0);
  const restC = Number.isFinite(amountC) ? amountC - sumC : 0;

  function autoAlloc() {
    if (!Number.isFinite(amountC) || amountC < 1) return;
    if (side === "supplier") {
      const r = suggestSupplierAlloc(amountC, targets as WizardData["supTargets"], basis);
      setLines(r.parts.map((p) => ({ key: p.key, amount: rubOf(p.cents), why: p.why })));
    } else {
      const r = suggestWorkAlloc(amountC, targets as WizardData["workTargets"], basis);
      setLines(r.parts.map((p) => ({ key: p.id, amount: rubOf(p.cents), why: p.why })));
    }
  }
  const patchLine = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  const step1Problems: string[] = [];
  if (!Number.isFinite(amountC) || amountC < 1) step1Problems.push("Укажите сумму оплаты больше нуля");
  if (!paidAt) step1Problems.push("Укажите дату оплаты");
  if (side === "supplier" && !supplierId) step1Problems.push("Выберите поставщика");
  if (side === "work" && !clientId) step1Problems.push("Выберите заказчика");
  if (kind === "OTHER" && note.trim().length < 3) step1Problems.push("Для вида «Другое» напишите пометку");
  if (markConfirmed && !canConfirm({ hasProofFile: files.some((f) => f.role === "PAYMENT_PROOF"), ppNo, paidAt, amount: amountC / 100 })) step1Problems.push("«Подтверждено» — только с № п/п или платёжкой");

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
    fd.set("payload", JSON.stringify({ side, kind, paidAt, amount, ppNo, basis, note, method, supplierId, clientId, markConfirmed, confirmOverpay, parts: lines.map((l) => ({ key: l.key, amount: l.amount })) }));
    for (const f of files) { fd.append("files", f.file); fd.append("fileRoles", f.role); }
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
        <PaymentForm requireYear onDone={onDone} />
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
        <li className="ml-auto"><button type="button" className="text-neutral-500 underline" onClick={() => setQuick(true)} disabled={step === 4}>Быстрый ввод (прежняя форма)</button></li>
      </ol>

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3 text-sm">
            {data.canSupplier && <label className="flex items-center gap-1.5"><input type="radio" checked={side === "supplier"} onChange={() => { setSide("supplier"); setLines([]); }} /> Поставщику</label>}
            {data.canWork && <label className="flex items-center gap-1.5"><input type="radio" checked={side === "work"} onChange={() => { setSide("work"); setLines([]); }} /> За производство / от заказчика (по ТЗ)</label>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {side === "supplier" && data.suppliers.length > 1 && (
              <div><Label htmlFor="pw-sup">Поставщик</Label><Select id="pw-sup" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setLines([]); }}><option value="">Выберите…</option>{data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
            )}
            {side === "work" && (
              <div><Label htmlFor="pw-cl">Заказчик</Label><Select id="pw-cl" value={clientId} onChange={(e) => { setClientId(e.target.value); setLines([]); }}><option value="">Выберите…</option>{data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
            )}
            <div><Label htmlFor="pw-kind">Вид оплаты</Label><Select id="pw-kind" value={kind} onChange={(e) => setKind(e.target.value as PayKind)}>{KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}</Select></div>
            <div><Label htmlFor="pw-date">Дата оплаты</Label><Input id="pw-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></div>
            <div><Label htmlFor="pw-amount">Сумма, ₽</Label><Input id="pw-amount" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setLines([]); }} placeholder="например, 1 500 000,00" /></div>
            <div><Label htmlFor="pw-pp">№ п/п (дата — выше)</Label><Input id="pw-pp" value={ppNo} onChange={(e) => setPpNo(e.target.value)} placeholder="например, 43831" /></div>
            <div><Label htmlFor="pw-method">Способ</Label><Select id="pw-method" value={method} onChange={(e) => setMethod(e.target.value)}><option value="BANK_TRANSFER">Банк. перевод</option><option value="CASH">Наличные</option><option value="CARD">Карта</option><option value="OTHER">Другое</option></Select></div>
            <div className="sm:col-span-2"><Label htmlFor="pw-basis">Основание (по нему система предложит разнесение)</Label><Input id="pw-basis" value={basis} onChange={(e) => { setBasis(e.target.value); setLines([]); }} placeholder={side === "supplier" ? "например: счёт 2004, спецификация 13, СП 09.26" : "например: ТЗ 88, ТЗ 91"} /></div>
            {(kind === "OTHER" || note) && <div className="sm:col-span-2"><Label htmlFor="pw-note">Пометка</Label><Input id="pw-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>}
          </div>
          <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input ref={fileRef} type="file" multiple accept=".pdf,.xlsx,.docx,.jpg,.jpeg,.png" className="hidden" onChange={(e) => { const add = [...(e.target.files ?? [])].map((file) => ({ file, role: guessDocRole(file.name) })); setFiles((f) => [...f, ...add].slice(0, 10)); e.target.value = ""; }} />
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>Приложить документ (платёжка, счёт…)</Button>
              <span className="text-xs text-neutral-500">необязательно; до 10 файлов</span>
            </div>
            {files.map((f, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="max-w-[16rem] break-words">{f.file.name}</span>
                <Select className="h-8 w-48 text-xs" value={f.role} onChange={(e) => setFiles((fs) => fs.map((x, j) => (j === i ? { ...x, role: e.target.value as DocRole } : x)))} aria-label="Тип документа">{DOC_ROLES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}</Select>
                <button type="button" className="text-neutral-500 underline" onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}>убрать</button>
              </div>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={markConfirmed} onChange={(e) => setMarkConfirmed(e.target.checked)} /> Отметить оплату подтверждённой (нужен № п/п или платёжка)</label>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" className="btn-accent" variant="outline" onClick={autoAlloc}>Разнести автоматически</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setLines([])}>Оставить авансом</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, { key: "", amount: restC > 0 ? rubOf(restC) : "", why: "добавлено вручную" }])} disabled={targets.length === 0}>+ Строка</Button>
          </div>
          {targets.length === 0 && <p className="text-sm text-amber-800">{side === "supplier" ? "У этого поставщика нет закупок для разнесения — оплата будет внесена авансом." : "У этого заказчика нет ТЗ для разнесения — оплата будет внесена как неразнесённый аванс."}</p>}
          {lines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-neutral-500"><tr><th className="py-1">{side === "supplier" ? "Закупка / аукцион" : "ТЗ"}</th><th className="text-right">Остаток до</th><th className="w-40 text-right">Сумма, ₽</th><th className="pl-2">Почему</th><th /></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-t border-neutral-100 align-top">
                      <td className="py-1 pr-2"><Select className="h-8 text-xs" value={l.key} onChange={(e) => patchLine(i, { key: e.target.value, why: "выбрано вручную" })} aria-label="Цель разнесения"><option value="">Выберите…</option>{targetOptions(l.key).map((t) => { const k = "key" in t ? t.key : t.id; return <option key={k} value={k}>{t.label} · остаток {money("key" in t ? remainingOf(t) : t.workCents - t.paidCents)}</option>; })}</Select></td>
                      <td className="py-1 text-right tabular-nums">{l.key ? money(remOf(l.key)) : "—"}</td>
                      <td className="py-1"><Input className="h-8 text-right text-xs" inputMode="decimal" value={l.amount} onChange={(e) => patchLine(i, { amount: e.target.value, why: "изменено вручную" })} aria-label="Сумма" /></td>
                      <td className="py-1 pl-2 text-xs text-neutral-500">{l.why}</td>
                      <td className="py-1 text-right"><button type="button" className="text-xs text-neutral-500 underline" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>убрать</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
          <p className="text-xs text-neutral-500">Подтверждение связанных закупок / ТЗ сбрасывается — проверьте их в «Подтвердить». {files.length ? `Документов приложено: ${files.length}.` : "Документ не приложен: оплата будет ждать платёжки или № п/п."}</p>
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
export function PaymentWizardButton({ label = "+ Внести оплату" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
  }, [open]);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} className="max-md:h-10">{label}</Button>
      {open && (
        <dialog ref={ref} aria-labelledby="pw-dlg-title" onClose={() => setOpen(false)} className="m-auto w-[calc(100vw-2rem)] max-w-3xl rounded-xl border border-neutral-200 bg-white p-0 text-left shadow-xl backdrop:bg-black/40">
          <div className="max-h-[88vh] overflow-y-auto p-4">
            <div className="mb-3 flex items-start justify-between gap-3 border-b border-neutral-200 pb-3">
              <h2 id="pw-dlg-title" className="text-base font-semibold">Внести оплату и разнести</h2>
              <button type="button" onClick={() => ref.current?.close()} aria-label="Закрыть окно" className="btn-accent rounded-lg border border-neutral-300 px-2.5 py-1 text-sm">✕</button>
            </div>
            <PaymentWizard onDone={() => { ref.current?.close(); window.location.reload(); }} />
          </div>
        </dialog>
      )}
    </>
  );
}
