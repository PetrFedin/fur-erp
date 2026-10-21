"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { VatInput } from "@/components/vat-input";
import { InfoHint } from "@/components/info-hint";
import { useVatDisplay } from "@/lib/vat-display";
import { resolveVatRate, vatPeriodLabel } from "@/lib/vat-by-date";
import { formatMoney, formatQty, formatDec1 } from "@/lib/utils";
import { createLiningBatchPurchase, type LiningBatchState } from "../../actions";

type Mat = { id: string; name: string; defaultVatRate: number | null; lots: number };
type Line = { key: number; materialId: string; newNumber: string; meters: string; price: string; vat: string; vatTouched: boolean };

const num = (v: string) => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const short = (n: string) => n.replace("Подкладочная ткань ", "Ткань ");

/** Форма «Купить подкладку»: шапка закупки + строки тканей; итоги пересчитываются сразу. Склад и статусы не спрашиваются. */
export function LiningBuyForm({ suppliers, materials, defaultSupplierId }: { suppliers: { id: string; name: string }[]; materials: Mat[]; defaultSupplierId: string }) {
  const router = useRouter();
  const { mode } = useVatDisplay();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<LiningBatchState>({});
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [supplierId, setSupplierId] = useState(defaultSupplierId);
  const [batchName, setBatchName] = useState("");
  const [batchTouched, setBatchTouched] = useState(false);
  const [invoice, setInvoice] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [notes, setNotes] = useState("");
  const [priceIncl, setPriceIncl] = useState(mode === "incl");
  const [seq, setSeq] = useState(1);
  const blank = (key: number): Line => ({ key, materialId: materials.find((m) => m.lots <= 1)?.id ?? "__new", newNumber: "", meters: "", price: "", vat: "", vatTouched: false });
  const [lines, setLines] = useState<Line[]>([blank(0)]);

  const autoBatch = useMemo(() => {
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? "Подкладка" : `Подкладка ${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCFullYear()).slice(2)}`;
  }, [date]);
  const batchShown = batchTouched ? batchName : autoBatch;

  const calc = lines.map((l) => {
    const mat = materials.find((m) => m.id === l.materialId);
    const auto = resolveVatRate(mat?.defaultVatRate ?? null, date || null);
    const vat = l.vatTouched && l.vat !== "" ? num(l.vat) : auto.rate;
    const meters = num(l.meters), price = num(l.price);
    const excl = priceIncl ? price / (1 + vat / 100) : price;
    const sumExcl = Math.round(meters * Math.round(excl * 100) / 100 * 100) / 100;
    const nds = Math.round(sumExcl * vat) / 100;
    return { auto, vat, meters, sumExcl, nds, sumIncl: sumExcl + nds, warn: date && l.vatTouched && l.vat !== "" && vat !== auto.byDate ? `Ставка ${vat} % не совпадает с датой (${vatPeriodLabel(date)} → ${auto.byDate} %)` : null };
  });
  const tot = calc.reduce((a, c) => ({ m: a.m + c.meters, excl: a.excl + c.sumExcl, nds: a.nds + c.nds, incl: a.incl + c.sumIncl }), { m: 0, excl: 0, nds: 0, incl: 0 });
  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = (more: boolean) => {
    const fd = new FormData();
    fd.set("date", date); fd.set("supplierId", supplierId); fd.set("batchName", batchShown); fd.set("invoiceNumber", invoice); fd.set("invoiceDate", invoiceDate); fd.set("notes", notes);
    fd.set("priceMode", priceIncl ? "incl" : "excl");
    fd.set("lines", JSON.stringify(lines.map((l) => ({ materialId: l.materialId, newNumber: l.newNumber, meters: l.meters, price: l.price, vat: l.vatTouched ? l.vat : "" }))));
    setState({});
    startTransition(async () => {
      const res = await createLiningBatchPurchase({}, fd);
      setState(res);
      if (res.ok) {
        if (more) { setLines([blank(seq)]); setSeq(seq + 1); setInvoice(""); setInvoiceDate(""); setNotes(""); window.scrollTo({ top: 0, behavior: "smooth" }); router.refresh(); }
        else router.push(res.purchaseId ? `/purchases/${res.purchaseId}` : "/lots?tab=lining");
      }
    });
  };

  const saveBar = (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" disabled={pending} onClick={() => submit(false)}>{pending ? "Сохраняю…" : "Сохранить закупку"}</Button>
      <Button type="button" variant="outline" disabled={pending} onClick={() => submit(true)}>Сохранить и добавить ещё</Button>
    </div>
  );

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(false); }} className="flex flex-col gap-4">
      {saveBar}
      {state.error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
      {state.ok ? <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{state.ok}</p> : null}

      <section className="rounded-lg border border-neutral-200 bg-white p-3" aria-labelledby="lb-head">
        <h2 id="lb-head" className="mb-2 text-base font-semibold">Закупка</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><Label htmlFor="lb-date">Дата закупки</Label><Input id="lb-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
          <div>
            <Label htmlFor="lb-sup">Поставщик</Label>
            <Select id="lb-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <p className="mt-1 text-[11px] text-neutral-500">Новый поставщик — в справочнике</p>
          </div>
          <div>
            <Label htmlFor="lb-batch">Аукцион / закупка</Label>
            <Input id="lb-batch" value={batchShown} onChange={(e) => { setBatchTouched(true); setBatchName(e.target.value); }} placeholder="Подкладка 05.26" />
            <p className="mt-1 text-[11px] text-neutral-500">По умолчанию «Подкладка ММ.ГГ»</p>
          </div>
          <div><Label htmlFor="lb-inv">№ счёта / УПД</Label><Input id="lb-inv" value={invoice} onChange={(e) => setInvoice(e.target.value)} /></div>
          <div><Label htmlFor="lb-invdate">Дата счёта</Label><Input id="lb-invdate" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
          <div className="sm:col-span-2 lg:col-span-4"><Label htmlFor="lb-notes">Примечание</Label><Input id="lb-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-3" aria-labelledby="lb-lines">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 id="lb-lines" className="text-base font-semibold">Ткани</h2>
            <InfoHint label="Как заполнять ткани" wide>
              <p>Ткань из справочника или «Новая ткань…» (номер). Метры добавляются в общий пул этой ткани. Цена за метр — {priceIncl ? "с НДС" : "без НДС"} (переключатель справа). НДС по дате закупки; ставку можно изменить.</p>
            </InfoHint>
          </div>
          <div role="tablist" aria-label="Цена за метр" className="inline-flex overflow-hidden rounded-lg border border-neutral-300 text-xs">
            {([[false, "Цена без НДС"], [true, "Цена с НДС"]] as const).map(([v, label]) => (
              <button key={String(v)} type="button" role="tab" aria-selected={priceIncl === v} onClick={() => setPriceIncl(v)} className={"px-3 py-1.5 " + (priceIncl === v ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50")}>{label}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {lines.map((l, i) => {
            const c = calc[i];
            return (
              <div key={l.key} className="grid grid-cols-2 items-end gap-3 rounded-lg border border-neutral-200 p-3 sm:grid-cols-4 lg:grid-cols-[1.4fr_0.8fr_1fr_0.8fr_1fr_auto]">
                <div className="col-span-2 sm:col-span-4 lg:col-span-1">
                  <Label htmlFor={`lb-mat-${l.key}`}>Ткань</Label>
                  <Select id={`lb-mat-${l.key}`} value={l.materialId} onChange={(e) => setLine(l.key, { materialId: e.target.value })}>
                    {materials.map((m) => <option key={m.id} value={m.id} disabled={m.lots > 1}>{short(m.name)}{m.lots > 1 ? ` — ${m.lots} лота, докупить нельзя` : ""}</option>)}
                    <option value="__new">+ Новая ткань…</option>
                  </Select>
                  {l.materialId === "__new" ? <Input aria-label="Номер новой ткани" placeholder="№ новой ткани" className="mt-1" value={l.newNumber} onChange={(e) => setLine(l.key, { newNumber: e.target.value })} required /> : null}
                </div>
                <div><Label htmlFor={`lb-m-${l.key}`}>Метров</Label><Input id={`lb-m-${l.key}`} type="number" step="0.001" min="0.001" value={l.meters} onChange={(e) => setLine(l.key, { meters: e.target.value })} required /></div>
                <div><Label htmlFor={`lb-p-${l.key}`}>Цена за м, ₽ {priceIncl ? "с НДС" : "без НДС"}</Label><Input id={`lb-p-${l.key}`} type="number" step="0.01" min="0" value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} required /></div>
                <div>
                  <Label htmlFor={`lb-v-${l.key}`}>НДС, %</Label>
                  <VatInput id={`lb-v-${l.key}`} value={l.vatTouched ? l.vat : String(c.auto.rate)} onChange={(e) => setLine(l.key, { vat: e.target.value, vatTouched: true })} />
                  <p className="mt-1 text-[11px] text-neutral-500">{vatPeriodLabel(date)}{c.auto.source === "material" ? " · ставка ткани" : ""}</p>
                  {c.warn ? <p className="mt-1 text-[11px] text-amber-700">{c.warn}</p> : null}
                </div>
                <div className="tabular-nums">
                  <div className="text-xs text-neutral-500">Сумма строки, ₽</div>
                  <div className="text-base font-semibold">{formatMoney(c.sumIncl.toFixed(2))}</div>
                  <div className="text-[11px] text-neutral-500">без НДС {formatMoney(c.sumExcl.toFixed(2))} · НДС {formatMoney(c.nds.toFixed(2))}</div>
                </div>
                <div className="col-span-2 sm:col-span-4 lg:col-span-1">
                  {lines.length > 1 ? <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="h-9 rounded-md border border-neutral-300 px-3 text-xs text-neutral-700 hover:bg-neutral-50" aria-label={`Убрать строку ${i + 1}`}>Убрать</button> : null}
                </div>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => { setLines((ls) => [...ls, blank(seq)]); setSeq(seq + 1); }} className="mt-3 h-9 rounded-md border border-dashed border-neutral-300 px-3 text-sm text-neutral-700 hover:border-neutral-500">+ Добавить ткань</button>
      </section>

      <section className="row-total rounded-lg px-3 py-2 tabular-nums" aria-label="Итоги закупки" data-testid="lining-totals">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span className="text-sm font-semibold">Всего, ₽</span>
          <span>Метров: <b>{formatDec1(Math.round(tot.m * 1000) / 1000)}</b></span>
          <span>Без НДС: <b>{formatMoney(tot.excl.toFixed(2))}</b></span>
          <span>НДС: <b>{formatMoney(tot.nds.toFixed(2))}</b></span>
          <span>С НДС: <b>{formatMoney(tot.incl.toFixed(2))}</b></span>
        </div>
      </section>
      {saveBar}
    </form>
  );
}
