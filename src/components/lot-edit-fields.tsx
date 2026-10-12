"use client";

import { useState, type ReactNode } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { SaveStatus, InlineSelect, InlineText } from "@/components/lot-inline";
import { formatMoney, formatQty } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { LotChange, LotPlan } from "@/lib/lot-reprice";
import {
  applyLotChange, previewLotChange, saveLotPurchaseFields, saveLotReceivedDate, setLotRemaining, changeLotMaterial, relinkLotPurchase,
  type PurchasePatch,
} from "@/app/(app)/analytics/raw/lot/[id]/actions";

const BOX =
  "w-full min-w-[3.25rem] rounded border bg-white px-1.5 py-0.5 text-sm outline-none transition-colors disabled:cursor-default disabled:opacity-60 " +
  "border-neutral-200 hover:border-neutral-400 focus:border-neutral-700 focus:ring-1 focus:ring-neutral-300";

const m2 = (v: number | string) => formatMoney(Number(v).toFixed(2));

/** Окно «что изменится» перед пересчётом лота: сам лот, списания по ТЗ и их себестоимость, состав цены. */
export function PlanView({ plan, title }: { plan: LotPlan; title: string }) {
  const th = "px-1.5 py-1 text-xs font-medium text-neutral-500";
  const td = "px-1.5 py-1 tabular-nums";
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base font-semibold">{title}</p>
      {plan.lines.length ? (
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-neutral-200"><th className={th}>Показатель</th><th className={cn(th, "text-right")}>Было</th><th className={cn(th, "text-right")}>Станет</th></tr></thead>
          <tbody>
            {plan.lines.map((l) => (
              <tr key={l.label} className="border-b border-neutral-100"><td className="px-1.5 py-1">{l.label}</td><td className={cn(td, "text-right text-neutral-500")}>{l.before}</td><td className={cn(td, "text-right font-medium")}>{l.after}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {plan.orders.length ? (
        <div>
          <p className="mb-1 text-sm font-medium">Затронутые ТЗ ({plan.orders.length})</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-sm">
              <thead><tr className="border-b border-neutral-200"><th className={th}>ТЗ</th><th className={cn(th, "text-right")}>Списано, шт.</th><th className={cn(th, "text-right")}>Сырьё из лота до → после, ₽</th><th className={cn(th, "text-right")}>Себестоимость ТЗ до → после, ₽</th></tr></thead>
              <tbody>
                {plan.orders.map((o) => (
                  <tr key={o.id} className="border-b border-neutral-100">
                    <td className="px-1.5 py-1">№{o.number} <span className="text-xs text-neutral-500">{o.status}</span></td>
                    <td className={cn(td, "text-right")}>{formatQty(o.qty)}</td>
                    <td className={cn(td, "text-right")}>{m2(o.usageBefore)} → <b>{m2(o.usageAfter)}</b></td>
                    <td className={cn(td, "text-right")}>{o.orderBefore != null ? <>{m2(o.orderBefore)} → <b>{m2(o.orderAfter ?? 0)}</b></> : <span className="text-xs text-neutral-500">не завершено — считается на лету</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : <p className="text-sm text-neutral-600">Списаний по ТЗ нет — другие разделы не затрагиваются, кроме закупки и итогов.</p>}
      {plan.comp ? (
        <div>
          <p className="mb-1 text-sm font-medium">Состав цены лота (без НДС, ₽ за весь лот)</p>
          <table className="w-full text-left text-sm">
            <tbody>
              {plan.comp.map((c) => (
                <tr key={c.label} className="border-b border-neutral-100"><td className="px-1.5 py-0.5">{c.label}</td><td className={cn(td, "text-right text-neutral-500")}>{m2(c.before)}</td><td className={cn(td, "text-right", Math.abs(c.after - c.before) >= 0.005 && "font-medium")}>{m2(c.after)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {plan.notes.length ? <ul className="list-disc space-y-0.5 pl-5 text-xs text-neutral-600">{plan.notes.map((x) => <li key={x}>{x}</li>)}</ul> : null}
    </div>
  );
}

/** Пересчёт лота с окном подтверждения: предпросмотр → «что изменится» → запись. */
export function useLotChange(lotId: string) {
  const { ask, node } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const run = async (change: LotChange, title: string, onCancel?: () => void): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const pv = await previewLotChange(lotId, change);
      if ("error" in pv) { setError(pv.error); onCancel?.(); return false; }
      if (!pv.plan.changed) { onCancel?.(); return true; }
      const ok = await ask(<PlanView plan={pv.plan} title={title} />, { ok: "Пересчитать и сохранить", wide: true });
      if (!ok) { onCancel?.(); return false; }
      const r = await applyLotChange(lotId, change, pv.plan.hash);
      if (r.error) { setError(r.error); onCancel?.(); return false; }
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось пересчитать лот");
      onCancel?.();
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error, saved, node };
}

export type NumField = "qty" | "unitPrice" | "unitExcl" | "unitIncl" | "totalIncl" | "vatRate" | "hammerExcl" | "hammerUsd";

const TITLES: Record<NumField, string> = {
  qty: "Изменить количество лота", unitPrice: "Изменить цену в закупке", unitExcl: "Изменить цену лота без НДС", unitIncl: "Изменить цену лота с НДС",
  totalIncl: "Изменить сумму лота", vatRate: "Изменить ставку НДС лота", hammerExcl: "Изменить молоток (₽)", hammerUsd: "Изменить молоток ($)",
};

/** Числовое поле паспорта лота (цена, количество, НДС, молоток): Enter / уход из поля → «что изменится» → пересчёт. */
export function LotNumberField({ lotId, field, value, label, suffix }: { lotId: string; field: NumField; value: string; label: string; suffix?: string }) {
  const [draft, setDraft] = useState(value);
  const [nonce, setNonce] = useState(0);
  const [keep, setKeep] = useState<"incl" | "excl">("incl");
  const ch = useLotChange(lotId);
  const dirty = draft.trim().replace(",", ".") !== value;
  const commit = () => {
    if (!dirty) return;
    const change: LotChange = { [field]: draft.trim() };
    if (field === "vatRate") change.vatKeep = keep;
    void ch.run(change, TITLES[field], () => { setDraft(value); setNonce((n) => n + 1); });
  };
  return (
    <span className="block" key={nonce}>
      <span className="flex items-center gap-1">
        <input
          type="text" inputMode="decimal" aria-label={label} value={draft} disabled={ch.busy}
          onChange={(e) => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } if (e.key === "Escape") { setDraft(value); e.currentTarget.blur(); } }}
          className={cn(BOX, "text-right tabular-nums", ch.error && "border-red-500 bg-red-50")}
        />
        {suffix ? <span className="shrink-0 text-xs text-neutral-500">{suffix}</span> : null}
      </span>
      {field === "vatRate" ? (
        <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
          при смене ставки:
          <label className="inline-flex items-center gap-1"><input type="radio" name={`keep-${lotId}`} checked={keep === "incl"} onChange={() => setKeep("incl")} />сохранить сумму с НДС</label>
          <label className="inline-flex items-center gap-1"><input type="radio" name={`keep-${lotId}`} checked={keep === "excl"} onChange={() => setKeep("excl")} />сохранить цену без НДС</label>
        </span>
      ) : null}
      <span className="flex items-center gap-1"><SaveStatus pending={ch.busy} saved={ch.saved} error={ch.error} /></span>
      {ch.node}
    </span>
  );
}

/** Остаток лота: ручная корректировка (разница записывается движением склада). */
export function LotRemainingField({ lotId, value }: { lotId: string; value: string }) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { ask, node } = useConfirm();
  const commit = async () => {
    if (draft.trim().replace(",", ".") === value) return;
    const ok = await ask(`Изменить остаток лота с ${value} на ${draft.trim()}? Разница будет записана движением склада «Корректировка»; списания в ТЗ не меняются.`, { ok: "Изменить остаток" });
    if (!ok) { setDraft(value); return; }
    setBusy(true);
    const r = await setLotRemaining(lotId, draft);
    setBusy(false);
    if (r.error) { setError(r.error); setDraft(value); } else { setError(null); setSaved(true); setTimeout(() => setSaved(false), 1800); }
  };
  return (
    <span className="block">
      <input type="text" inputMode="decimal" aria-label="Остаток" value={draft} disabled={busy} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } if (e.key === "Escape") { setDraft(value); e.currentTarget.blur(); } }}
        className={cn(BOX, "text-right tabular-nums", error && "border-red-500 bg-red-50")} />
      <SaveStatus pending={busy} saved={saved} error={error} />
      {node}
    </span>
  );
}

/** Дата по месту: прихода лота или закупки. */
export function LotDateField({ lotId, kind, value, label }: { lotId: string; kind: "received" | "order"; value: string; label: string }) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const commit = async () => {
    if (!draft || draft === value) return;
    setBusy(true);
    const r = kind === "received" ? await saveLotReceivedDate(lotId, draft) : await saveLotPurchaseFields(lotId, { orderDate: draft });
    setBusy(false);
    if (r.error) { setError(r.error); setDraft(value); } else { setError(null); setSaved(true); setTimeout(() => setSaved(false), 1800); }
  };
  return (
    <span className="block">
      <input type="date" aria-label={label} value={draft} disabled={busy} onChange={(e) => setDraft(e.target.value)} onBlur={commit} className={cn(BOX, "w-auto", error && "border-red-500 bg-red-50")} />
      <SaveStatus pending={busy} saved={saved} error={error} />
    </span>
  );
}

export type Opt = { value: string; label: string };

/** Выбор из справочника по месту: поставщик, аукцион, вид меха / ткань, закупка-основание. */
export function LotChoiceField({ lotId, kind, value, options, label, emptyLabel, note }: { lotId: string; kind: "supplier" | "auction" | "material" | "purchase"; value: string; options: Opt[]; label: string; emptyLabel?: string; note?: ReactNode }) {
  const { ask, node } = useConfirm();
  const save = async (v: string) => {
    if (kind === "supplier" || kind === "auction") {
      const scope = kind === "supplier" ? "поставщика" : "аукцион";
      const ok = await ask(`Сменить ${scope} закупки? Это относится ко всей закупке-основанию, не только к этому лоту.`, { ok: "Сменить" });
      if (!ok) return { error: "Отменено" };
      const patch: PurchasePatch = kind === "supplier" ? { supplierId: v } : { auctionId: v };
      return saveLotPurchaseFields(lotId, patch);
    }
    if (kind === "material") return changeLotMaterial(lotId, v);
    const ok = await ask("Перенести лот в другую закупку? Позиция закупки и движения склада лота переедут вместе с ним, подтверждение обеих закупок сбросится.", { ok: "Перенести" });
    if (!ok) return { error: "Отменено" };
    return relinkLotPurchase(lotId, v);
  };
  return (
    <span className="block">
      <InlineSelect value={value} options={options} label={label} emptyLabel={emptyLabel} onSave={save} />
      {note ? <span className="block text-[11px] text-neutral-500">{note}</span> : null}
      {node}
    </span>
  );
}

/** Текст закупки по месту: счёт, УПД (действует на всю закупку-основание). */
export function LotPurchaseText({ lotId, kind, value, label }: { lotId: string; kind: "invoiceNumber" | "transferDocument"; value: string; label: string }) {
  return <InlineText value={value} label={label} maxLength={200} onSave={(v) => saveLotPurchaseFields(lotId, { [kind]: v })} />;
}
