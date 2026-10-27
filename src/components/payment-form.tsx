"use client";

import { batchNameText } from "@/lib/batch-name";
import { InfoHint } from "@/components/info-hint";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PaymentWizardButton } from "@/components/payment-wizard";
import { availableYears } from "@/lib/year-list";
import { Input, Select } from "@/components/ui/input";
import { PAY_KINDS, PRESET_PERCENTS, canConfirm, percentAmount, type DocRole, type PayKind } from "@/lib/payment-form-core";
import { getPaymentTargets, quotePaymentTarget, savePayment, type Quote, type Recalc, type Spec, type TargetList } from "@/app/(app)/payments/pay-actions";
import { formatMoney } from "@/lib/utils";

const money = (n: number | null | undefined) => (n == null ? "–" : formatMoney(n));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const num = (s: string) => {
  const t = s.replace(/[\s ]/g, "").replace(",", ".");
  return t !== "" && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
};
const lab = "mb-1 block text-xs text-neutral-500";

export type PaymentPreset = Partial<Pick<Spec, "side" | "auction" | "purchaseId" | "supplierId" | "batchId" | "orderIds">> & { kind?: PayKind; /** Заказчик (карточка заказчика): мастер подставит его в «За работу». */ clientId?: string };

/**
 * ЕДИНАЯ форма оплаты: шаг 1 «Что оплачиваем» → 2 «Вид, сумма, дата, основание» → 3 «Проверить и сохранить» → экран «Что пересчиталось».
 * preset фиксирует цель (карточка закупки, панель «Документы и оплата», карточка ТЗ) — тогда шаг 1 только показывает сумму/оплачено/остаток.
 */
export function PaymentForm({ preset, onDone, requireYear }: { preset?: PaymentPreset; onDone?: () => void; /** Обязательный выбор года, к которому относится оплата (общая кнопка «Внести оплату»). */ requireYear?: boolean }) {
  const [targets, setTargets] = useState<TargetList | null>(null);
  const [side, setSide] = useState<"supplier" | "work">(preset?.side ?? "supplier");
  const [auction, setAuction] = useState(preset?.auction ?? "");
  const [purchaseId, setPurchaseId] = useState(preset?.purchaseId ?? "");
  const [supplierIdState, setSupplierId] = useState(preset?.supplierId ?? "");
  // Поставщик один (Веллмех): поле не показываем, подставляем единственного.
  const soleSupplier = targets?.suppliers.length === 1 ? targets.suppliers[0].id : "";
  const supplierId = supplierIdState || soleSupplier;
  const [targetMode, setTargetMode] = useState<"auction" | "purchase" | "advance">(preset?.purchaseId ? "purchase" : preset?.auction ? "auction" : "auction");
  const [workMode, setWorkMode] = useState<"batch" | "orders">(preset?.orderIds?.length ? "orders" : "batch");
  const [batchId, setBatchId] = useState(preset?.batchId ?? "");
  const [orderIds, setOrderIds] = useState<string[]>(preset?.orderIds ?? []);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  // Подтверждение переплаты / даты в будущем — диалогом приложения (не window.confirm).
  const [askConfirm, setAskConfirm] = useState("");

  const [kind, setKind] = useState<PayKind>(preset?.kind ?? "INVOICE");
  const [mode, setMode] = useState<"amount" | "percent" | "rest">("amount");
  const [amount, setAmount] = useState("");
  const [percent, setPercent] = useState("");
  const [paidAt, setPaidAt] = useState(today());
  const [ppNo, setPpNo] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [note, setNote] = useState("");
  const [customKind, setCustomKind] = useState("");
  const [payYear, setPayYear] = useState("");
  const [allocateLater, setAllocateLater] = useState(false);
  const [files] = useState<{ file: File; role: DocRole }[]>([]);
  const [markConfirmed, setMarkConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [recalc, setRecalc] = useState<Recalc | null>(null);
  const [pending, start] = useTransition();
  const sending = useRef(false);
  const locked = !!(preset?.auction || preset?.purchaseId || preset?.batchId || preset?.orderIds?.length);

  useEffect(() => {
    getPaymentTargets().then(setTargets).catch(() => setError("Не удалось загрузить справочники"));
  }, []);

  // Аукцион можно выбрать из справочника или вписать своё название: вписанное, которого нет в справочнике, записывается как аванс
  // без привязки с пометкой «Аукцион (вписан вручную): …» — разнести его потом можно в разделе «Оплаты».
  const auctionKnown = !!targets?.auctions.some((a) => a.name === auction.trim());
  const customAuction = side === "supplier" && targetMode === "auction" && auction.trim() !== "" && !auctionKnown && !!targets;
  const spec: Spec =
    side === "supplier"
      ? { side, auction: targetMode === "auction" && auctionKnown ? auction.trim() : undefined, purchaseId: targetMode === "purchase" ? purchaseId || undefined : preset?.purchaseId, supplierId: supplierId || undefined }
      : { side, batchId: workMode === "batch" ? batchId || undefined : undefined, orderIds: workMode === "orders" ? orderIds : [] };
  const hasTarget = side === "supplier" ? !!(spec.auction || spec.purchaseId || ((targetMode === "advance" || customAuction) && supplierId)) : !!(spec.batchId || spec.orderIds?.length);
  const specKey = JSON.stringify(spec);

  useEffect(() => {
    if (!hasTarget || (side === "supplier" && (targetMode === "advance" || customAuction))) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuote(null);
      return;
    }
    let off = false;
    quotePaymentTarget(spec).then((q) => !off && setQuote(q)).catch(() => !off && setQuote({ error: "Не удалось получить сумму" }));
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, hasTarget]);

  useEffect(() => {
    // Платёж по аукциону вне справочника — только аванс (раньше это выставлял выбор поставщика).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (customAuction && soleSupplier) setKind("ADVANCE");
  }, [customAuction, soleSupplier]);

  const base = quote?.total ?? 0;
  const rest = Math.max(0, quote?.remaining ?? 0);
  const amountNum = mode === "rest" ? rest : mode === "percent" ? percentAmount(base, num(percent)) : num(amount);
  const afterRemaining = quote?.remaining != null && Number.isFinite(amountNum) ? quote.remaining - (kind === "REFUND" ? -Math.abs(amountNum) : amountNum) : null;
  const hasProofFile = files.some((f) => f.role === "PAYMENT_PROOF");
  const confirmOk = canConfirm({ hasProofFile, ppNo, paidAt, amount: amountNum });
  const noTargetAdvance = side === "supplier" && (targetMode === "advance" || customAuction);
  const fullNote = [customAuction ? `Аукцион (вписан вручную): ${auction.trim()}` : "", customKind.trim() ? `Тип: ${customKind.trim()}` : "", note.trim()].filter(Boolean).join(". ");
  const kinds = PAY_KINDS.filter((k) => !(side === "work" && k.supplierOnly) && !(noTargetAdvance && k.v !== "ADVANCE"));

  function next(to: 2 | 3) {
    setError("");
    if (to === 2 && requireYear && !payYear) return setError("Выберите год, к которому относится оплата");
    if (to === 2 && !hasTarget) return setError("Выберите, что оплачиваем");
    if (to === 3) {
      if (!paidAt || Number.isNaN(Date.parse(paidAt))) return setError("Укажите дату оплаты");
      if (requireYear && paidAt.slice(0, 4) !== payYear) return setError(`Дата оплаты должна быть в ${payYear} году — измените дату или год`);
      if (mode === "amount" && !(Math.abs(amountNum) > 0)) return setError("Укажите сумму или нажмите 30 % / 50 % / 70 % / остаток");
      if (mode === "amount" && kind !== "REFUND" && amountNum < 0.01) return setError("Сумма должна быть больше нуля");
      if ((kind === "OTHER" || kind === "REFUND") && fullNote.length < 3) return setError("Для «Другое» и «Возврат / зачёт» напишите пометку");
    }
    setStep(to);
  }

  function save(confirmed = false) {
    if (sending.current) return; // защита от двойной отправки
    sending.current = true;
    setError("");
    const fd = new FormData();
    fd.set("side", side);
    if (spec.auction) fd.set("auction", spec.auction);
    if (spec.purchaseId) fd.set("purchaseId", spec.purchaseId);
    if (spec.supplierId) fd.set("supplierId", spec.supplierId);
    if (spec.batchId) fd.set("batchId", spec.batchId);
    for (const id of spec.orderIds ?? []) fd.append("orderIds", id);
    fd.set("kind", kind);
    fd.set("mode", mode);
    fd.set("amount", amount);
    fd.set("percent", percent);
    fd.set("paidAt", paidAt);
    fd.set("ppNo", ppNo);
    fd.set("method", method);
    fd.set("note", fullNote);
    if (allocateLater) fd.set("allocateLater", "1");
    if (markConfirmed && confirmOk) fd.set("markConfirmed", "1"); // убрали платёжку после галочки — не отправляем «подтверждено»
    if (confirmed) fd.set("confirmOverpay", "1");
    for (const f of files) {
      fd.append("files", f.file);
      fd.append("fileRoles", f.role);
    }
    start(async () => {
      try {
        const r = await savePayment(fd);
        if (r.confirm) {
          sending.current = false;
          // sending уже сброшен выше: иначе повторный вызов save(true) упирался в защиту от двойной отправки и «ОК» ничего не делал
          setAskConfirm(r.confirm);
          return;
        }
        if (r.error) {
          setError(r.error);
          return;
        }
        setRecalc(r.recalc ?? null);
        setStep(4);
      } catch {
        setError("Не удалось сохранить: сервер отклонил запрос (возможно, файл слишком большой) или пропала связь. Проверьте список оплат — возможно, платёж уже записан.");
      } finally {
        sending.current = false;
      }
    });
  }

  const stepNames = ["Что оплачиваем", "Вид и сумма", "Сохранить"];
  const tgt = targets;
  return (
    <div className="flex flex-col gap-4" data-payment-form>
      {step < 4 && (
        <ol className="flex flex-wrap gap-2 text-xs" aria-label="Шаги оплаты">
          {stepNames.map((s, i) => (
            <li key={s} className={`rounded-full border px-3 py-1 ${step === i + 1 ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-600"}`}>
              {i + 1}. {s}
            </li>
          ))}
        </ol>
      )}

      {step === 1 && (
        <section className="flex flex-col gap-3">
          {requireYear && (
            <div>
              <label htmlFor="pf-year" className={lab}>Год, к которому относится оплата (обязательно)</label>
              <Select
                id="pf-year"
                value={payYear}
                onChange={(e) => {
                  const y = e.target.value;
                  setPayYear(y);
                  if (y && paidAt.slice(0, 4) !== y) setPaidAt(`${y}-01-01`);
                }}
              >
                <option value="">— выберите год —</option>
                {availableYears().map((y) => <option key={y} value={y}>{y}</option>)}
              </Select>
            </div>
          )}
          {!locked && (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Кому платим">
              {tgt?.canSupplier !== false && (
                <button type="button" role="radio" aria-checked={side === "supplier"} onClick={() => { setSide("supplier"); setQuote(null); }} className={`rounded-md border px-3 py-2 text-sm ${side === "supplier" ? "border-neutral-900 bg-neutral-900 font-medium text-white" : "border-neutral-300"}`}>
                  За сырьё (аукцион / закупка)
                </button>
              )}
              {tgt?.canWork !== false && (
                <button type="button" role="radio" aria-checked={side === "work"} onClick={() => { setSide("work"); setQuote(null); if (kind === "REFUND") setKind("INVOICE"); }} className={`rounded-md border px-3 py-2 text-sm ${side === "work" ? "border-neutral-900 bg-neutral-900 font-medium text-white" : "border-neutral-300"}`}>
                  По работе (партия / ТЗ)
                </button>
              )}
            </div>
          )}
          {side === "supplier" && !locked && (
            <>
              <div className="flex flex-wrap gap-3 text-sm">
                {(["auction", "purchase", "advance"] as const).map((m) => (
                  <label key={m} className="flex items-center gap-1">
                    <input type="radio" name="pf-target" checked={targetMode === m} onChange={() => { setTargetMode(m); if (m === "advance" && kind !== "ADVANCE") setKind("ADVANCE"); }} />
                    {m === "auction" ? "Аукцион из справочника" : m === "purchase" ? "Закупка без аукциона" : "Аванс без привязки"}
                  </label>
                ))}
              </div>
              {targetMode === "auction" && (
                <div className="flex flex-col gap-2">
                  <div>
                    <label htmlFor="pf-auction" className={lab}>Аукцион — выберите из списка или впишите своё название</label>
                    <Input id="pf-auction" list="pf-auction-list" value={auction} onChange={(e) => setAuction(e.target.value)} autoComplete="off" placeholder="напр. СП 09.26" />
                    <datalist id="pf-auction-list">
                      {tgt?.auctions.map((a) => (
                        <option key={a.name} value={a.name}>остаток {money(a.remaining)}</option>
                      ))}
                    </datalist>
                  </div>
                  {customAuction && (
                    <div>
                      <label htmlFor="pf-supplier-c" className={lab}>Такого аукциона нет в справочнике — платёж запишется авансом без привязки.{soleSupplier ? "" : " Поставщик"}</label>
                      {!soleSupplier && <Select id="pf-supplier-c" value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setKind("ADVANCE"); }}>
                        <option value="">— выберите —</option>
                        {tgt?.suppliers.map((x) => (
                          <option key={x.id} value={x.id}>{x.name}</option>
                        ))}
                      </Select>}
                    </div>
                  )}
                </div>
              )}
              {targetMode === "purchase" && (
                <div>
                  <label htmlFor="pf-purchase" className={lab}>Закупка</label>
                  <Select id="pf-purchase" value={purchaseId} onChange={(e) => setPurchaseId(e.target.value)}>
                    <option value="">— выберите —</option>
                    {tgt?.purchases.map((p) => (
                      <option key={p.id} value={p.id}>{p.label} · остаток {money(p.remaining)}</option>
                    ))}
                  </Select>
                </div>
              )}
              {targetMode === "advance" && (
                <div hidden={!!soleSupplier}>
                  <label htmlFor="pf-supplier" className={lab}>Поставщик</label>
                  <Select id="pf-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    <option value="">— выберите —</option>
                    {tgt?.suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                  
                </div>
              )}
            </>
          )}
          {side === "work" && !locked && (
            <>
              <div className="flex gap-3 text-sm">
                <label className="flex items-center gap-1"><input type="radio" name="pf-wm" checked={workMode === "batch"} onChange={() => setWorkMode("batch")} /> Партия целиком</label>
                <label className="flex items-center gap-1"><input type="radio" name="pf-wm" checked={workMode === "orders"} onChange={() => setWorkMode("orders")} /> Одно или несколько ТЗ</label>
              </div>
              {workMode === "batch" ? (
                <div>
                  <label htmlFor="pf-batch" className={lab}>Партия</label>
                  <Select id="pf-batch" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                    <option value="">— выберите —</option>
                    {tgt?.batches.map((b) => (
                      <option key={b.id} value={b.id}>Партия {b.number}{batchNameText(b.name) ? ` · ${batchNameText(b.name)}` : ""} · ТЗ: {b.orders}</option>
                    ))}
                  </Select>
                </div>
              ) : (
                <div>
                  <label htmlFor="pf-orders" className={lab}>ТЗ (можно несколько: Ctrl / ⌘ или тап)</label>
                  <select id="pf-orders" multiple size={7} value={orderIds} onChange={(e) => setOrderIds(Array.from(e.target.selectedOptions).map((o) => o.value))} className="ui-field w-full rounded-lg border border-neutral-300 bg-white p-1 text-xs">
                    {tgt?.orders.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}{o.batch ? ` · партия ${o.batch}` : ""}{o.client ? ` · ${o.client}` : ""}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
          {quote && (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm" data-testid="pf-quote">
              {quote.error ? (
                <p className="text-red-700">{quote.error}</p>
              ) : (
                <>
                  <p className="font-medium">{quote.label}</p>
                  <p>{side === "work" ? "Работа" : "Сумма"}: <b>{money(quote.total)}</b> · оплачено: <b>{money(quote.paid)}</b> · остаток: <b>{money(quote.remaining)}</b></p>
                  {quote.noPrice && <p className="text-xs text-amber-700">Цена работы не задана — внести можно только аванс.</p>}
                </>
              )}
            </div>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-3">
          {quote && !quote.error && quote.total != null && <p className="text-xs text-neutral-600">{quote.label}: сумма {money(quote.total)}, оплачено {money(quote.paid)}, остаток {money(quote.remaining)}</p>}
          <fieldset className="flex flex-wrap gap-2">
            <legend className={lab}>Тип оплаты</legend>
            {kinds.map((k) => (
              <button key={k.v} type="button" role="radio" aria-checked={kind === k.v} title={k.hint} onClick={() => { setKind(k.v); setCustomKind(""); if (k.v === "PERCENT" && mode === "amount") { setMode("percent"); setPercent("30"); } }} className={`rounded-md border px-3 py-2 text-sm ${kind === k.v ? "border-neutral-900 bg-neutral-900 font-medium text-white" : "border-neutral-300"}`}>
                {k.label}
              </button>
            ))}
          </fieldset>
          <div>
            <label htmlFor="pf-kind-custom" className={lab}>Или впишите свой тип платежа</label>
            <Input id="pf-kind-custom" list="pf-kind-list" value={customKind} maxLength={80} autoComplete="off" placeholder="напр. оплата по акту, зачёт переплаты"
              onChange={(e) => {
                const t = e.target.value;
                const hit = kinds.find((k) => k.label.toLowerCase() === t.trim().toLowerCase());
                if (hit) { setKind(hit.v); setCustomKind(""); } else { setCustomKind(t); if (t.trim()) setKind("OTHER"); }
              }} />
            <datalist id="pf-kind-list">{kinds.map((k) => <option key={k.v} value={k.label} />)}</datalist>
          </div>
          {quote && !quote.error && quote.total != null && quote.total > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Быстрая сумма">
              {PRESET_PERCENTS.map((p) => (
                <Button key={p} type="button" variant="outline" size="sm" onClick={() => { setMode("percent"); setPercent(String(p)); setAmount(String(percentAmount(base, p)).replace(".", ",")); }} className={mode === "percent" && num(percent) === p ? "border-neutral-900" : ""}>
                  {p} % · {money(percentAmount(base, p))}
                </Button>
              ))}
              <Button type="button" variant="outline" size="sm" disabled={rest <= 0} onClick={() => { setMode("rest"); setAmount(String(rest).replace(".", ",")); }} className={mode === "rest" ? "border-neutral-900" : ""}>
                Остаток · {money(rest)}
              </Button>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="pf-amount" className={lab}>Сумма, ₽</label>
              <Input id="pf-amount" inputMode="decimal" autoComplete="off" value={mode === "amount" ? amount : Number.isFinite(amountNum) ? String(amountNum).replace(".", ",") : ""} onChange={(e) => { setMode("amount"); setAmount(e.target.value); }} placeholder="напр. 1 500 000,50" />
            </div>
            <div>
              <label htmlFor="pf-date" className={lab}>Дата оплаты</label>
              <Input id="pf-date" type="date" value={paidAt} min={requireYear && payYear ? `${payYear}-01-01` : undefined} max={requireYear && payYear ? `${payYear}-12-31` : undefined} onChange={(e) => setPaidAt(e.target.value)} />
            </div>
            <div>
              <label htmlFor="pf-pp" className={lab}>№ п/п (платёжки)</label>
              <Input id="pf-pp" value={ppNo} onChange={(e) => setPpNo(e.target.value)} autoComplete="off" placeholder="напр. 43831" />
            </div>
            <div>
              <label htmlFor="pf-method" className={lab}>Способ</label>
              <Select id="pf-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="BANK_TRANSFER">Банк. перевод</option>
                <option value="CASH">Наличные</option>
                <option value="CARD">Карта</option>
                <option value="OTHER">Другое</option>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="pf-note" className={lab}>{(kind === "OTHER" || kind === "REFUND") && !customKind.trim() ? "Пометка (обязательно): что это за платёж" : "Пометка"}</label>
              <Input id="pf-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} autoComplete="off" />
            </div>
          </div>
          {noTargetAdvance && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={allocateLater} onChange={(e) => setAllocateLater(e.target.checked)} /> Аванс без разнесения — «разнести позже»
            </label>
          )}
          {afterRemaining != null && Number.isFinite(amountNum) && (
            <p className={`text-sm ${afterRemaining < -0.005 ? "font-medium text-red-600" : "text-neutral-700"}`}>
              Остаток после этой оплаты: <b>{money(afterRemaining)}</b>{afterRemaining < -0.005 && " (переплата)"}
            </p>
          )}
        </section>
      )}

      {step === 3 && (
        <section className="flex flex-col gap-3 text-sm">
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <p><b>{quote?.label ?? (noTargetAdvance ? "Аванс без привязки" : "")}</b></p>
            <p>{PAY_KINDS.find((k) => k.v === kind)?.label}: <b>{money(kind === "REFUND" ? -Math.abs(amountNum) : amountNum)}</b> от {paidAt}{ppNo ? `, п/п № ${ppNo}` : ""}</p>
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={markConfirmed} disabled={!confirmOk} onChange={(e) => setMarkConfirmed(e.target.checked)} className="mt-1 accent-neutral-900" />
            <span>Отметить «подтверждено»{!confirmOk && <InfoHint label="Когда можно отметить"><p>Доступно, если указан № п/п с датой и суммой. Письмо-согласование оплатой не считается.</p></InfoHint>}</span>
          </label>
        </section>
      )}

      {step === 4 && recalc && (
        <section className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-white p-3 text-sm" data-testid="pf-result">
          <h3 className="block-title">Оплата записана — что пересчиталось</h3>
          <p className="font-medium">{recalc.title}</p>
          {recalc.total != null && (
            <p>Остаток: {money(recalc.remainingBefore)} → <b>{money(recalc.remainingAfter)}</b> · оплачено {money(recalc.paidBefore)} → <b>{money(recalc.paidAfter)}</b> (из {money(recalc.total)})</p>
          )}
          {recalc.debtAfter != null && <p>Долг поставщику: {money(recalc.debtBefore)} → <b>{money(recalc.debtAfter)}</b></p>}
          <p>Подтверждение: <b>{recalc.confirmation}</b></p>
          {recalc.tasks.length > 0 && (
            <div className="rounded-md bg-amber-50 p-2 text-amber-900">
              <p className="font-medium">Что осталось сделать</p>
              <ul className="list-disc pl-5">{recalc.tasks.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
          )}
          <div>
            <Button type="button" onClick={() => { onDone?.(); if (!onDone) window.location.reload(); }}>Готово</Button>
          </div>
        </section>
      )}

      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {askConfirm && (
        <div role="alertdialog" aria-label="Подтвердите запись" className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>{askConfirm}</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => { setAskConfirm(""); save(true); }} disabled={pending}>Всё равно записать</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setAskConfirm("")}>Исправить</Button>
          </div>
        </div>
      )}
      {step < 4 && !askConfirm && (
        <div className="flex flex-wrap gap-2">
          {step > 1 && <Button type="button" variant="outline" onClick={() => setStep((step - 1) as 1 | 2)} disabled={pending}>← Назад</Button>}
          {step === 1 && <Button type="button" onClick={() => next(2)} disabled={!hasTarget || !!quote?.error}>Далее</Button>}
          {step === 2 && <Button type="button" onClick={() => next(3)}>Далее</Button>}
          {step === 3 && <Button type="button" onClick={() => save()} disabled={pending}>{pending ? "Сохраняем…" : "Сохранить оплату"}</Button>}
          {onDone && <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>Отмена</Button>}
        </div>
      )}
    </div>
  );
}

/**
 * Кнопка «Внести оплату» на карточках закупки, ТЗ и в панели «Документы и оплата»: открывает ЕДИНЫЙ мастер оплаты
 * (components/payment-wizard) с зафиксированной целью. Эта форма остаётся только для «Возврата / зачёта» внутри мастера.
 */
export function PaymentFormButton({ label = "Внести оплату", preset, variant = "outline", size = "sm" }: { label?: string; preset?: PaymentPreset; variant?: "outline" | "default"; size?: "sm" | "default"; requireYear?: boolean }) {
  return <PaymentWizardButton label={label} preset={preset} variant={variant} size={size} />;
}
