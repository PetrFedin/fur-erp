"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useUnsavedGuard } from "@/lib/use-unsaved-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { auctionKey } from "@/lib/auction-key";
import { buildFurIndex } from "@/lib/fur-ref";
import {
  validateRows,
  type BatchHeader,
  type BatchPayload,
  type BatchPreview,
  type BatchResult,
  type Decisions,
  serviceVatPctFor,
  type IntakeContext,
  type IntakeRow,
} from "@/lib/batch-intake";
import { formatMoney } from "@/lib/utils";
import { createBatch, previewBatch } from "./actions";
import { getCbrRate } from "../cbr-actions";
import { LotsStep } from "./lots-step";
import { useConfirm } from "@/components/confirm-dialog";
import { CompositionTable, ExpensesBlock } from "./expenses-block";
import { compositionOf, EMPTY_EXPENSES, hasAnyExpense, type BatchExpenses } from "@/lib/batch-expenses";
import type { DocState, Draft, TableInfo, WizardRefs } from "./shared";

const STEPS = ["Аукцион", "Лоты", "Проверка", "Итог"];
const today = () => new Date().toISOString().slice(0, 10);
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const numOf = (s: string) => Number(s.replace(/[\s ]/g, "").replace(",", "."));
const money = (n: number) => formatMoney(n);
const fmt = (n: number, d = 0) => n.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });

function initialHeader(refs: WizardRefs): BatchHeader {
  const wm = refs.suppliers.find((s) => /веллмех|wellm/i.test(s.name)) ?? refs.suppliers[0];
  return {
    auctionId: "",
    newAuction: null,
    supplierId: wm?.id ?? "",
    warehouseId: (refs.warehouses.find((w) => w.isDefault) ?? refs.warehouses[0])?.id ?? "",
    orderDate: today(),
    currency: "RUB",
    exchangeRate: "",
    vatDefault: "22",
    invoiceNumber: "",
    receiveNow: true,
    notes: "",
  };
}

export function BatchWizard({
  refs,
  debtNow,
  userKey,
  can,
}: {
  refs: WizardRefs;
  debtNow: number;
  userKey: string;
  can: { auctions: boolean; materials: boolean; colors: boolean };
}) {
  const draftKey = `fur-erp.batch-draft.v1:${userKey}`;
  const [step, setStep] = useState(1);
  const [header, setHeader] = useState<BatchHeader>(() => initialHeader(refs));
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [nextN, setNextN] = useState(1);
  const [info, setInfo] = useState<TableInfo | null>(null);
  const [decisions, setDecisions] = useState<Decisions>({ fur: {}, color: {} });
  const [pct, setPct] = useState<Partial<Record<"fee" | "broker", boolean>>>({});
  const [expenses, setExpenses] = useState<BatchExpenses>(EMPTY_EXPENSES);
  const [docs, setDocs] = useState<DocState[]>([]); // документы партии больше не прикладываются: массив всегда пуст (формат запроса не меняем)
  const [ack, setAck] = useState(false);
  const [key, setKey] = useState(() => newKey());
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  const dupAsked = useRef(false);
  const { ask, node: confirmNode } = useConfirm();
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [rateMsg, setRateMsg] = useState<string | null>(null);
  useUnsavedGuard(hydrated && !result && (rows.length > 0 || step > 1), { links: false });

  // ----- черновик (localStorage): восстанавливается сам при открытии, сохраняется при каждом изменении
  useEffect(() => {
    if (!hydrated || result) return;
    const t = setTimeout(() => {
      try {
        if (rows.length === 0 && step === 1 && !header.auctionId && !header.newAuction && !hasAnyExpense(expenses)) return;
        const d: Draft = { v: 1, savedAt: Date.now(), step: Math.min(step, 3), header, rows, decisions, pct, info: info ? { fileName: info.fileName, headers: info.headers, headerIdx: info.headerIdx, mapping: info.mapping, note: info.note } : null, nextN, expenses };
        window.localStorage.setItem(draftKey, JSON.stringify(d));
      } catch {
        /* хранилище недоступно */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [hydrated, result, step, header, rows, decisions, pct, info, nextN, expenses, draftKey]);

  function clearDraft() {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
  }
  function restore(d: Draft) {
    setHeader({ ...initialHeader(refs), ...d.header });
    setRows(d.rows);
    setDecisions(d.decisions);
    setPct(d.pct);
    setNextN(d.nextN);
    setExpenses({ ...EMPTY_EXPENSES, ...(d.expenses ?? {}) });
    setInfo(d.info ? { ...d.info, table: [] } : null);
    setStep(Math.min(Math.max(d.step, 1), 3));
    setRestoredAt(d.savedAt);
  }
  /** «Сбросить»: стирает черновик и возвращает мастер в начальное состояние. */
  function resetDraft() {
    clearDraft();
    restart();
    setRestoredAt(null);
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as Draft;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (d.v === 1 && Array.isArray(d.rows) && (d.rows.length > 0 || d.step > 1 || (d.expenses && hasAnyExpense(d.expenses)))) restore(d);
      }
    } catch {
      /* без черновика */
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // ----- проверка строк (тот же код, что и на сервере)
  const rate = header.currency === "RUB" ? 1 : numOf(header.exchangeRate) || 1;
  const ctx: IntakeContext = useMemo(
    () => ({
      currency: header.currency || "RUB",
      vatDefault: header.vatDefault.trim() === "" ? 22 : numOf(header.vatDefault),
      materials: refs.materials,
      furIndex: refs.furRefs.length > 0 ? buildFurIndex(refs.furRefs) : undefined,
      colors: refs.colors,
      existingLots: new Map(header.auctionId && !header.newAuction ? (refs.lotsByAuction[header.auctionId] ?? []) : []),
      rate,
      pctCols: pct,
    }),
    [header.currency, header.vatDefault, header.auctionId, header.newAuction, refs, rate, pct],
  );
  const validation = useMemo(() => validateRows(rows, ctx, decisions), [rows, ctx, decisions]);

  // ----- серверный предпросмотр (суммы, сверка документов)
  const payload = useMemo<Omit<BatchPayload, "key" | "ackMismatch">>(
    () => ({
      header,
      rows,
      decisions,
      pct,
      expenses: Object.fromEntries(Object.entries(expenses).filter(([k, v]) => typeof v === "string" && v.trim() !== "" && k !== "applied")) as Record<string, string>,
      docs: docs.map((d, i) => ({ idx: i, name: d.name, kind: d.kind, number: d.number, date: d.date, amount: d.amount })),
    }),
    [header, rows, decisions, pct, expenses, docs],
  );
  const seq = useRef(0);
  useEffect(() => {
    if (step !== 3) return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await previewBatch(JSON.stringify({ ...payload, key: "preview-only", ackMismatch: false }));
        if (my !== seq.current) return;
        if ("error" in res) setPreviewErr(res.error);
        else {
          setPreview(res.preview);
          setPreviewErr(null);
        }
      } catch {
        if (my === seq.current) setPreviewErr("Не удалось получить итоги с сервера. Проверьте соединение.");
      }
    }, 350);
    return () => clearTimeout(t);
  }, [payload, step]);

  // ----- шаг 1
  const headerProblems: string[] = [];
  if (!header.newAuction && !header.auctionId) headerProblems.push("Выберите аукцион из справочника или создайте новый");
  if (header.newAuction) {
    const nm = header.newAuction.name.trim();
    const k = auctionKey(nm);
    const clash = refs.auctions.find((a) => [a.name, ...a.aliases].some((v) => auctionKey(v) === k));
    if (nm.length < 2) headerProblems.push("Укажите короткое имя нового аукциона");
    else if (clash) headerProblems.push(`Аукцион «${clash.name}» уже есть в справочнике — выберите его из списка`);
  }
  if (!header.supplierId) headerProblems.push("Выберите поставщика / посредника");
  if (!header.orderDate) headerProblems.push("Укажите дату закупки");
  if (header.currency !== "RUB" && !(numOf(header.exchangeRate) > 0)) headerProblems.push(`Укажите курс ${header.currency} → RUB`);
  if (header.orderDate && header.receiveNow && header.orderDate > today()) headerProblems.push("Дата закупки в будущем, а мех принимается на склад сразу: поправьте дату или снимите «Принять на склад сразу»");

  const set = <K extends keyof BatchHeader>(k: K, v: BatchHeader[K]) => setHeader((h) => ({ ...h, [k]: v }));

  function pickAuction(id: string) {
    const a = refs.auctions.find((x) => x.id === id);
    setHeader((h) => ({ ...h, auctionId: id, newAuction: null, currency: a?.currency && a.currency !== h.currency ? a.currency : h.currency }));
  }

  async function fetchRate() {
    setRateMsg(null);
    try {
      const r = await getCbrRate(header.currency, header.orderDate);
      if (r.error || !r.rate) return setRateMsg(r.error ?? "Курс не получен — введите вручную");
      set("exchangeRate", r.rate.replace(".", ","));
      autoRate.current = r.rate.replace(".", ",");
      setRateMsg(`курс ЦБ на дату ${r.date}: ${r.rate.replace(".", ",")} — проверьте`);
    } catch {
      setRateMsg("Не удалось получить курс — введите вручную");
    }
  }

  // Не рубль: курс подставляется сам — курсом ЦБ на дату закупки (пока пользователь не ввёл свой). Курс остаётся редактируемым и обязательным.
  const autoRate = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated || header.currency === "RUB" || !header.orderDate) return;
    const cur = header.exchangeRate.trim();
    if (cur !== "" && cur !== autoRate.current) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchRate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, header.currency, header.orderDate]);

  // ----- создание
  function submit() {
    if (sending.current || pending) return;
    if (preview && preview.dupInvoices.length > 0 && !dupAsked.current) {
      const d = preview.dupInvoices[0];
      void ask(`Счёт № ${d.invoice} уже есть на закупке ${d.purchaseNumber} этого поставщика. Это та же поставка? Если да, партию создавать не нужно. Продолжить и создать новую?`, { ok: "Продолжить", wide: true }).then((ok) => {
        if (!ok) return;
        dupAsked.current = true;
        submit();
      });
      return;
    }
    sending.current = true;
    setError(null);
    const fd = new FormData();
    fd.set("payload", JSON.stringify({ ...payload, key, ackMismatch: ack }));
    for (const d of docs) fd.append("files", d.file);
    startTransition(async () => {
      try {
        const res = await createBatch(fd);
        if ("error" in res) {
          setError(res.error);
          return;
        }
        clearDraft();
        setResult(res);
        setStep(4);
      } catch {
        setError("Нет ответа от сервера. Партия могла создаться: проверьте список закупок, повторное нажатие «Создать» не создаст дубль.");
      } finally {
        sending.current = false;
        dupAsked.current = false;
      }
    });
  }

  function restart() {
    setStep(1);
    setHeader(initialHeader(refs));
    setRows([]);
    setNextN(1);
    setInfo(null);
    setDecisions({ fur: {}, color: {} });
    setPct({});
    setExpenses(EMPTY_EXPENSES);
    setDocs([]);
    setAck(false);
    setPreview(null);
    setResult(null);
    setError(null);
    setKey(newKey());
  }

  const canNext2 = rows.length > 0 && validation.errorCount === 0;
  const blocked = (preview?.blocking.length ?? 1) > 0 || (preview?.mismatchDocs ?? 0) > 0 && !ack;

  return (
    <div className="flex flex-col gap-3">
      {restoredAt !== null && !result && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--ui-accent)] bg-[var(--ui-soft)] px-3 py-2 text-sm text-neutral-900" data-draft-banner role="status">
          <span>Черновик восстановлен (сохранён {new Date(restoredAt).toLocaleString("ru-RU")}): лотов {rows.length}{hasAnyExpense(expenses) ? ", расходы партии на месте" : ""}. Он сохраняется сам при каждом изменении.</span>
          <Button size="sm" variant="outline" onClick={resetDraft}>Сбросить</Button>
        </div>
      )}

      <div aria-label="Прогресс" className="flex flex-col gap-1.5">
        <ol className="flex flex-wrap gap-1 text-xs">
          {STEPS.map((s, i) => {
            const n = i + 1;
            const done = n < step;
            const canGo = !result && n < step;
            return (
              <li key={s}>
                <button
                  type="button"
                  disabled={!canGo}
                  onClick={() => setStep(n)}
                  aria-current={n === step ? "step" : undefined}
                  className={"rounded-full border px-3 py-1 " + (n === step ? "border-neutral-900 bg-neutral-900 text-white" : done ? "border-green-300 bg-green-50 text-green-900" : "border-neutral-200 text-neutral-500")}
                >
                  {n}. {s}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="h-1 overflow-hidden rounded bg-neutral-100">
          <div className="h-full bg-neutral-900 transition-all" style={{ width: `${((step - (step === 4 ? 0 : 1)) / 3) * 100}%` }} />
        </div>
        <div className="text-xs text-neutral-500">Шаг {step} из 4</div>
      </div>

      <Card>
        <CardContent className="pt-4">
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div>
                <Label>Аукцион</Label>
                <div className="mb-2 flex gap-3 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name="am" checked={!header.newAuction} onChange={() => set("newAuction", null)} /> Из справочника
                  </label>
                  {can.auctions && (
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="am" checked={!!header.newAuction} onChange={() => setHeader((h) => ({ ...h, auctionId: "", newAuction: { name: "", date: "", house: "" } }))} /> Новый аукцион
                    </label>
                  )}
                </div>
                {!header.newAuction ? (
                  <Select id="auctionId" value={header.auctionId} onChange={(e) => pickAuction(e.target.value)} aria-label="Аукцион из справочника">
                    <option value="">Выберите аукцион…</option>
                    {refs.auctions.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}{a.house ? ` · ${a.house}` : ""}</option>
                    ))}
                  </Select>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <Label htmlFor="na-name">Короткое имя</Label>
                      <Input id="na-name" placeholder="например, СП 12.26" value={header.newAuction.name} onChange={(e) => set("newAuction", { ...header.newAuction!, name: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="na-date">Дата аукциона</Label>
                      <Input id="na-date" type="date" value={header.newAuction.date} onChange={(e) => set("newAuction", { ...header.newAuction!, date: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="na-house">Аукционный дом</Label>
                      <Input id="na-house" placeholder="Союзпушнина" value={header.newAuction.house} onChange={(e) => set("newAuction", { ...header.newAuction!, house: e.target.value })} />
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {refs.suppliers.length > 1 && (
                  <div>
                    <Label htmlFor="supplierId">Поставщик / посредник</Label>
                    <Select id="supplierId" value={header.supplierId} onChange={(e) => set("supplierId", e.target.value)}>
                      <option value="">Выберите…</option>
                      {refs.suppliers.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                    </Select>
                  </div>
                )}
                <div>
                  <Label htmlFor="orderDate">Дата закупки</Label>
                  <Input id="orderDate" type="date" value={header.orderDate} onChange={(e) => set("orderDate", e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="currency">Валюта цен в файле</Label>
                  <Select id="currency" value={header.currency} onChange={(e) => set("currency", e.target.value)}>
                    <option value="RUB">RUB — рубль</option>
                    <option value="USD">USD — доллар</option>
                    <option value="EUR">EUR — евро</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="vatDefault">НДС по умолчанию, %</Label>
                  <Input id="vatDefault" inputMode="decimal" value={header.vatDefault} onChange={(e) => set("vatDefault", e.target.value)} />
                </div>
                {header.currency !== "RUB" && (
                  <div>
                    <Label htmlFor="exchangeRate">Курс {header.currency} → RUB</Label>
                    <Input id="exchangeRate" inputMode="decimal" placeholder="например, 84,4075" value={header.exchangeRate} onChange={(e) => set("exchangeRate", e.target.value)} />
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={fetchRate}>Курс ЦБ на дату</Button>
                      {rateMsg && <span className="text-xs text-neutral-500">{rateMsg}</span>}
                    </div>
                  </div>
                )}
                {/* Место под поле курса резервируется и для рубля: при выборе USD/EUR остальная разметка не сдвигается. */}
                {header.currency === "RUB" && <div aria-hidden className="invisible h-[6.25rem]" />}
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={header.receiveNow} onChange={(e) => set("receiveNow", e.target.checked)} />
                Принять на склад сразу
                <span className="text-xs text-neutral-500">без галочки — черновик, мех в пути</span>
              </label>

              <details className="rounded-md border border-neutral-200 px-3 py-2">
                <summary className="cursor-pointer text-sm text-neutral-600">Дополнительно</summary>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="invoiceNumber">Счёт аукциона № (если в таблице нет столбца «Счёт»)</Label>
                    <Input id="invoiceNumber" value={header.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="invoiceDate">Дата счёта</Label>
                    <Input id="invoiceDate" type="date" value={header.invoiceDate ?? ""} onChange={(e) => set("invoiceDate", e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="invoiceAmount">Сумма счёта аукциона по документу, ₽ (для сверки)</Label>
                    <Input id="invoiceAmount" inputMode="decimal" placeholder="необязательно" value={header.invoiceAmount ?? ""} onChange={(e) => set("invoiceAmount", e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="serviceVat">НДС на сборы аукциона и выделку, %</Label>
                    <Input id="serviceVat" inputMode="decimal" placeholder={`по дате: ${serviceVatPctFor(header.orderDate)}`} value={header.serviceVat ?? ""} onChange={(e) => set("serviceVat", e.target.value)} />
                    <p className="mt-1 text-xs text-neutral-500">Пусто — 22% (закупки до 2026 года — 20%). Для иностранного аукциона со ввозным НДС в таможенных платежах укажите 0, а НДС строк — 0, платежи — в «Таможне».</p>
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="notes">Заметки</Label>
                    <Textarea id="notes" rows={2} value={header.notes} onChange={(e) => set("notes", e.target.value)} />
                  </div>
                </div>
              </details>
            </div>
          )}

          {step === 2 && (
            <LotsStep
              refs={refs}
              rows={rows}
              setRows={setRows}
              nextN={nextN}
              setNextN={setNextN}
              info={info}
              setInfo={setInfo}
              decisions={decisions}
              setDecisions={setDecisions}
              setPct={setPct}
              validation={validation}
              can={can}
              currencyHint={(cur, rt) => {
                setHeader((h) => ({
                  ...h,
                  currency: cur && h.currency === "RUB" ? cur : h.currency,
                  exchangeRate: rt && !h.exchangeRate ? rt.replace(".", ",") : h.exchangeRate,
                }));
              }}
            />
          )}
          {step === 2 && (
            <div className="mt-4">
              <ExpensesBlock rows={rows} setRows={setRows} pct={pct} setPct={setPct} e={expenses} setE={setExpenses} ctx={{ rate, currency: header.currency || "RUB", vatDefault: ctx.vatDefault, serviceVatPct: serviceVatPctFor(header.orderDate, header.serviceVat) }} />
            </div>
          )}

          {step === 3 && (
            <ReviewStep preview={preview} previewErr={previewErr} header={header} refs={refs} ack={ack} setAck={setAck} debtNow={debtNow} rows={rows} pct={pct} rate={rate} vatDefault={ctx.vatDefault} serviceVatPct={serviceVatPctFor(header.orderDate, header.serviceVat)} />
          )}

          {step === 4 && result && <ResultStep result={result} onRestart={restart} />}
        </CardContent>
      </Card>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
      {confirmNode}

      {step < 4 && (
        <div className="flex flex-wrap items-center justify-between gap-2 pb-20 sm:pb-16">
          <Button type="button" variant="outline" disabled={step === 1 || pending} onClick={() => setStep(step - 1)}>← Назад</Button>
          <div className="flex flex-col items-end gap-1">
            {step === 1 && headerProblems.length > 0 && <span className="text-xs text-neutral-500">{headerProblems[0]}</span>}
            {step === 2 && !canNext2 && <span className="text-xs text-neutral-500">{rows.length === 0 ? "Добавьте хотя бы один лот" : `Исправьте ошибки в таблице: ${validation.errorCount}`}</span>}
            {step === 1 && <Button type="button" disabled={headerProblems.length > 0} onClick={() => setStep(2)}>Далее: лоты →</Button>}
            {step === 2 && <Button type="button" disabled={!canNext2} onClick={() => setStep(3)}>Далее: проверка →</Button>}
            {step === 3 && (
              <>
                {preview && preview.blocking.length > 0 && <span className="text-xs text-red-700">{preview.blocking[0]}</span>}
                <Button type="button" disabled={blocked || pending} onClick={submit}>{pending ? "Создаём…" : "Создать партию"}</Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-neutral-100 py-1.5 text-sm last:border-0">
      <span className="text-neutral-600">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

function ReviewStep({
  preview, previewErr, header, refs, ack, setAck, debtNow, rows, pct, rate, vatDefault, serviceVatPct,
}: {
  preview: BatchPreview | null; previewErr: string | null; header: BatchHeader; refs: WizardRefs; ack: boolean; setAck: (v: boolean) => void; debtNow: number;
  rows: IntakeRow[]; pct: Partial<Record<"fee" | "broker", boolean>>; rate: number; vatDefault: number; serviceVatPct: number;
}) {
  const comp = useMemo(() => compositionOf(rows, { rate, currency: header.currency || "RUB", vatDefault, pct, serviceVatPct }), [rows, rate, header.currency, vatDefault, pct, serviceVatPct]);
  if (previewErr) return <p className="text-sm text-red-700">{previewErr}</p>;
  if (!preview) return <p className="text-sm text-neutral-500">Считаем итоги…</p>;
  const t = preview.totals;
  const aName = header.newAuction ? `${header.newAuction.name.trim()} (новый)` : (refs.auctions.find((a) => a.id === header.auctionId)?.name ?? "—");
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <div>
          <Row label="Аукцион">{aName}</Row>
          <Row label="Валюта и курс">{header.currency}{header.currency !== "RUB" ? `, ${header.exchangeRate}` : ""}</Row>
          <Row label="Закупок будет создано">{preview.purchases.length}</Row>
          <Row label="Лотов">{fmt(t.lots)}</Row>
          <Row label="Шкур / единиц">{fmt(t.qty, 0)}</Row>
        </div>
        <div>
          <Row label="Сумма с НДС">{money(t.inclVat)}</Row>
          <Row label="Сумма без НДС">{money(t.exclVat)}</Row>
          <Row label="Средняя цена, ₽ за шкуру (с НДС)">{money(t.avgInclPerUnit)}</Row>
          <Row label="Средняя цена, ₽ за шкуру (без НДС)">{money(t.avgExclPerUnit)}</Row>
          {t.avgForeign !== null && <Row label={`Средний молоток, ${header.currency} за шкуру`}>{fmt(t.avgForeign, 2)}</Row>}
          <Row label="Приёмка на склад">{preview.receiving ? "сразу" : "нет, черновик"}</Row>
        </div>
      </div>
      <div className="rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
        Долг поставщику сейчас: <b>{money(debtNow)}</b>. После создания он вырастет на сумму закупок с НДС (≈ {money(t.inclVat)}) за вычетом оплат по этому аукциону, если они уже внесены.
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3" data-create-summary>
        <h2 className="text-sm font-semibold">Что будет создано</h2>
        <p className="text-sm text-neutral-700">Закупок: <b>{preview.purchases.length}</b>, лотов: <b>{fmt(t.lots)}</b>, шкур: <b>{fmt(t.qty)}</b>, на сумму <b>{money(t.inclVat)}</b> с НДС; {preview.receiving ? "мех будет принят на склад" : "закупки останутся черновиками"}.</p>
        <CompositionTable c={comp} serverTotal={t.inclVat} />
        <details className="text-xs">
          <summary className="cursor-pointer text-neutral-600">Лоты и себестоимость за шкуру ({comp.perLot.length})</summary>
          <div className="mt-1 max-h-72 overflow-auto">
            <table className="w-full min-w-[420px]">
              <thead className="text-left text-neutral-500"><tr><th className="py-1">Лот</th><th>Мех</th><th className="text-right">Шт.</th><th className="text-right">За шкуру, ₽</th><th className="text-right">Итого, ₽</th></tr></thead>
              <tbody>
                {comp.perLot.map((l) => (
                  <tr key={l.n} className="border-t border-neutral-100"><td className="py-0.5">{l.lot || "—"}</td><td>{l.material}</td><td className="text-right tabular-nums">{fmt(l.qty)}</td><td className="text-right tabular-nums">{fmt(l.unitIncl, 2)}</td><td className="text-right tabular-nums">{fmt(l.totalIncl, 2)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
      {preview.purchases.length > 1 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead className="text-left text-neutral-600"><tr><th className="py-1">Счёт аукциона</th><th>Лотов</th><th>Шт.</th><th className="text-right">С НДС</th><th className="text-right">Без НДС</th></tr></thead>
            <tbody>
              {preview.purchases.map((p) => (
                <tr key={p.key} className="border-t border-neutral-100"><td className="py-1">{p.invoice || "—"}</td><td>{p.lots}</td><td>{fmt(p.qty)}</td><td className="text-right">{money(p.inclVat)}</td><td className="text-right">{money(p.exclVat)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(preview.newMaterials.length > 0 || preview.newColors.length > 0 || header.newAuction) && (
        <div className="rounded-lg bg-[var(--ui-soft)] px-3 py-2 text-sm text-neutral-900">
          Вместе с партией будет добавлено в справочники:
          <ul className="list-disc pl-5">
            {header.newAuction && <li>аукцион «{header.newAuction.name.trim()}»</li>}
            {preview.newMaterials.length > 0 && <li>материалы: {preview.newMaterials.join(", ")}</li>}
            {preview.newColors.length > 0 && <li>цвета (на подтверждение): {preview.newColors.join(", ")}</li>}
          </ul>
        </div>
      )}
      {preview.planDiffRows > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Расчёт приложения отличается от «Себестоимости за единицу» из файла больше чем на 1 ₽ в строках: {preview.planDiffRows}. Причина обычно в округлении курса; сверьте итог с документом.</p>
      )}
      {preview.docs.some((d) => d.recon) && (
        <div className="flex flex-col gap-2">
          {preview.docs.filter((d) => d.recon).map((d) => (
            <div key={d.idx} className={"rounded-md px-3 py-2 text-sm " + (d.recon!.ok ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900")}>
              <b>{d.name}:</b> {d.recon!.message}
              {d.recon!.reasons.map((x, j) => <div key={j} className="mt-1 text-xs">Возможная причина — {x}</div>)}
            </div>
          ))}
        </div>
      )}
      {preview.mismatchDocs > 0 && (
        <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          Я вижу расхождение суммы документа с лотами и всё равно создаю партию (проверю документ позже)
        </label>
      )}
      {preview.dupInvoices.length > 0 && (
        <ul className="list-disc rounded-md bg-amber-50 px-8 py-2 text-sm text-amber-900" data-dup-invoice>
          {preview.dupInvoices.map((d) => (
            <li key={d.invoice}>Счёт № {d.invoice} уже на закупке <b>{d.purchaseNumber}</b> — это та же поставка? Если счёт законно делится на две закупки, продолжайте; при создании будет окно подтверждения.</li>
          ))}
        </ul>
      )}
      {preview.blocking.length > 0 && (
        <ul className="list-disc rounded-md bg-red-50 px-8 py-2 text-sm text-red-700">{preview.blocking.map((b, i) => <li key={i}>{b}</li>)}</ul>
      )}
    </div>
  );
}

function ResultStep({ result, onRestart }: { result: BatchResult; onRestart: () => void }) {
  const delta = (a: number | null, b: number) => (a === null ? null : b - a);
  return (
    <div className="flex flex-col gap-4" data-batch-result>
      <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
        {result.duplicate ? "Эта партия уже была создана — повторное нажатие дубля не создало." : "Партия создана."} Аукцион «{result.auction.name}»{result.auction.created ? " (добавлен в справочник)" : ""}, закупок: {result.purchases.length}, лотов: {fmt(result.totals.lots)}, шт.: {fmt(result.totals.qty)}, на сумму {money(result.totals.inclVat)} с НДС{result.receiving ? ", мех принят на склад" : ", закупки — черновики"}.
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold">Что пересчиталось</h2>
        <Row label="Долг поставщику (с НДС)">
          {result.debt.before !== null ? `${money(result.debt.before)} → ` : ""}{money(result.debt.after)}
          {delta(result.debt.before, result.debt.after) !== null && <span className="ml-2 text-xs text-neutral-500">(+{money(delta(result.debt.before, result.debt.after)!)})</span>}
        </Row>
        <Row label="Закуплено (Главная, с НДС)">{result.purchased.before !== null ? `${money(result.purchased.before)} → ` : ""}{money(result.purchased.after)}</Row>
        {result.stock.map((s) => (
          <Row key={s.material} label={`Остаток: ${s.material}, шт.`}>{fmt(s.before, 0)} → {fmt(s.after, 0)}</Row>
        ))}
        {!result.receiving && <Row label="Остаток меха">не изменился: закупки не приняты</Row>}
        <p className="mt-1 text-xs text-neutral-500">Главная (Закуплено, Остаток, Долг поставщику) и страница «Сырьё» уже показывают новые цифры. <Link href="/dashboard" className="underline">Открыть Сводку →</Link></p>
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold">Созданные закупки</h2>
        <ul className="text-sm">
          {result.purchases.map((p) => (
            <li key={p.id} className="flex justify-between gap-2 border-b border-neutral-100 py-1">
              <Link href={`/purchases/${p.id}`} className="underline">{p.number}{p.invoice ? ` · счёт ${p.invoice}` : ""}</Link>
              <span>{p.lots} лот. · {money(p.inclVat)}</span>
            </li>
          ))}
        </ul>
        <Link href={`/lots?auction=${encodeURIComponent(result.auction.name)}`} className="mt-1 inline-block text-sm underline">Лоты на странице «Сырьё» →</Link>
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold">Что сделать дальше</h2>
        {result.tasks.length === 0 ? (
          <p className="text-sm text-neutral-500">Задач нет.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {result.tasks.map((t, i) => (
              <li key={i}><Link href={t.href} className="underline">{t.text}</Link></li>
            ))}
          </ul>
        )}
      </div>
      <div><Button type="button" variant="outline" onClick={onRestart}>Завести ещё одну партию</Button></div>
    </div>
  );
}
