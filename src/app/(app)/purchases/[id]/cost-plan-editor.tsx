"use client";

import { CbrRateButton } from "../cbr-rate-button";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeNumberInput } from "@/lib/input";
import { computeCostPlan, roundQty, roundPrice, roundVat, roundRate } from "@/lib/cost-plan";
import { updateCostPlanItem, updateCostPlanRate } from "../actions";

export type CostPlanEditorItem = {
  id: string;
  lotNumber: string | null;
  quantity: number;
  price: number;
  rate: number;
  feePct: number;
  dressing: number;
  transport: number;
  brokerPct: number;
  transit: number;
  vat: number;
};

const FIELDS: { name: keyof CostPlanEditorItem; label: string; hint?: string }[] = [
  { name: "quantity", label: "Количество, шт." },
  { name: "price", label: "Цена лота" },
  { name: "feePct", label: "Сборы аукциона, %", hint: "по умолчанию 7,35 = 5,5 + 1,25 + 0,6 из счёта" },
  { name: "dressing", label: "Выделка, ₽ (с НДС 22%)" },
  { name: "transport", label: "Транспорт на выделку, ₽" },
  { name: "brokerPct", label: "Брокерский %", hint: "по умолчанию 4,5" },
  { name: "transit", label: "Комиссия за транзит, ₽" },
  { name: "vat", label: "Ставка НДС, %", hint: "по умолчанию 22" },
];

const fmt = (n: number) =>
  Number.isFinite(n) ? n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const show = (n: number) => String(n).replace(".", ",");

/** Кнопка «Править расчёт» + окно с формой и живым пересчётом себестоимости. */
export function CostPlanItemEditor({
  purchaseId,
  item,
  currencySymbol = "$",
}: {
  purchaseId: string;
  item: CostPlanEditorItem;
  currencySymbol?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [vals, setVals] = useState<Record<string, string>>({});

  const initial = () =>
    Object.fromEntries(FIELDS.map((f) => [f.name, show(item[f.name] as number)])) as Record<string, string>;
  const openForm = () => {
    setVals(initial());
    setError(null);
    setOpen(true);
  };

  const n = (k: string) => {
    const x = normalizeNumberInput(vals[k]);
    return typeof x === "number" ? x : NaN;
  };
  const calc = computeCostPlan({
    // Значения округляются до точности колонок БД — так же, как на сервере (расчёт = пересчёт из сохранённого).
    quantity: roundQty(n("quantity")),
    price: roundPrice(n("price")),
    rate: roundRate(item.rate),
    feePct: n("feePct"),
    dressing: n("dressing"),
    transport: n("transport"),
    brokerPct: n("brokerPct"),
    transit: Number.isNaN(n("transit")) && !(vals.transit ?? "").trim() ? 0 : n("transit"),
    vat: roundVat(n("vat")),
  });

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={openForm}>
        Править расчёт
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !pending) setOpen(false);
          }}
        >
          <form
            className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden whitespace-normal rounded-lg bg-white text-left font-normal shadow-xl"
            action={(formData) => {
              setError(null);
              start(async () => {
                const res = await updateCostPlanItem(purchaseId, item.id, formData);
                if (res?.error) setError(res.error);
                else setOpen(false);
              });
            }}
          >
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <h3 className="text-base font-semibold">Править расчёт лота {item.lotNumber ?? ""}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <label key={f.name} className="flex flex-col gap-1 text-xs text-neutral-500" title={f.hint}>
                  {f.name === "price" ? `Цена лота, ${currencySymbol}` : f.label}
                  <Input
                    name={f.name}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    className="text-neutral-900"
                    value={vals[f.name] ?? ""}
                    onChange={(e) => setVals((v) => ({ ...v, [f.name]: e.target.value }))}
                  />
                  {f.hint && <span className="text-[11px] text-neutral-500">{f.hint}</span>}
                </label>
              ))}
              <label className="flex flex-col gap-1 text-xs text-neutral-500">
                Курс ЦБ (общий на закупку)
                <Input value={show(item.rate)} readOnly disabled className="text-neutral-700 disabled:opacity-100" />
                <span className="text-[11px] text-neutral-500">меняется формой «Курс закупки» в блоке расчёта</span>
              </label>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t border-neutral-200 bg-white p-3 shadow-[0_-4px_8px_-6px_rgba(0,0,0,0.15)]">
            <div className="break-words rounded-md bg-neutral-50 px-3 py-2 text-sm">
    <div>
      Себестоимость единицы: <b>{fmt(calc.unitIncl)} ₽</b>{" "}
      <span className="text-xs text-neutral-500">(без НДС {fmt(calc.unitExcl)} ₽)</span>
    </div>
    <div>
      Всего, ₽: <b>{fmt(calc.totalIncl)} ₽</b>{" "}
      <span className="text-xs text-neutral-500">(без НДС {fmt(calc.totalExcl)} ₽)</span>
    </div>
    <div className="mt-1 hidden text-xs text-neutral-500 sm:block">
      товар {fmt(calc.goods)} · сборы {fmt(calc.fee)} + НДС {fmt(calc.feeVat)} · НДС на товар {fmt(calc.goodsVat)} ·
      брокер {fmt(calc.broker)}
    </div>
  </div>
              <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Сохранение…" : "Сохранить расчёт"}
              </Button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

/** Курс закупки с расчётом: общий для всех лотов, пересчитывает расчёт каждого. */
export function CostPlanRateForm({
  purchaseId,
  currency,
  exchangeRate,
  orderDate,
}: {
  purchaseId: string;
  currency: string;
  exchangeRate: string;
  /** Дата закупки «ГГГГ-ММ-ДД» — дата курса ЦБ по умолчанию. */
  orderDate?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      action={(formData) => {
        setError(null);
        start(async () => {
          const res = await updateCostPlanRate(purchaseId, formData);
          if (res?.error) setError(res.error);
        });
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        Курс закупки {currency} → RUB (для всех лотов)
        <Input name="exchangeRate" type="text" inputMode="decimal" defaultValue={exchangeRate.replace(".", ",")} className="w-36" />
      </label>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Пересчёт…" : "Пересчитать все лоты"}
      </Button>
      <CbrRateButton currency={currency} defaultDate={orderDate} />
      {error && <span className="text-sm text-red-600">{error}</span>}
    </form>
  );
}
