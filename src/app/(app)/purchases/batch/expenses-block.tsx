"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { compositionOf, EMPTY_EXPENSES, expenseProblems, hasAnyExpense, spreadExpenses, type BatchExpenses, type Composition } from "@/lib/batch-expenses";
import { formatMoney } from "@/lib/utils";
import type { IntakeRow } from "@/lib/batch-intake";

const money = (n: number) => formatMoney(n);
const fmt = (n: number, d = 0) => n.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });

type Ctx = { rate: number; currency: string; vatDefault: number };

/**
 * «Расходы партии» (шаг «Лоты»): общие суммы раскладываются на лоты в те же столбцы расчётного листа,
 * итог и «себестоимость за шкуру» пересчитываются сразу, до сохранения.
 */
export function ExpensesBlock({
  rows, setRows, pct, setPct, ctx,
}: {
  rows: IntakeRow[];
  setRows: (r: IntakeRow[] | ((p: IntakeRow[]) => IntakeRow[])) => void;
  pct: Partial<Record<"fee" | "broker", boolean>>;
  setPct: (p: Partial<Record<"fee" | "broker", boolean>>) => void;
  ctx: Ctx;
}) {
  const [e, setE] = useState<BatchExpenses>(EMPTY_EXPENSES);
  const [note, setNote] = useState<string | null>(null);
  const set = <K extends keyof BatchExpenses>(k: K, v: BatchExpenses[K]) => { setE((x) => ({ ...x, [k]: v })); setNote(null); };
  const comp = useMemo(() => compositionOf(rows, { ...ctx, pct }), [rows, ctx, pct]);
  const problems = expenseProblems(e);
  const rate = ctx.currency === "RUB" ? 1 : ctx.rate;
  const noRate = ctx.currency !== "RUB" && !(ctx.rate > 0);

  function apply() {
    const res = spreadExpenses(rows, rate, e);
    if (res.rows === 0) return setNote("Нет строк с количеством и ценой — сначала заполните таблицу лотов.");
    setRows((prev) => prev.map((r) => (res.patch.has(r.n) ? { ...r, ...res.patch.get(r.n)! } : r)));
    setPct({ ...pct, ...res.pct });
    setNote(`Расходы разнесены на лоты: ${res.rows}${res.skipped ? `; строк без количества или цены пропущено: ${res.skipped}` : ""}. Итог ниже пересчитан.`);
  }
  function clearAll() {
    setRows((prev) => prev.map((r) => ({ ...r, fee: "", dressing: "", transport: "", broker: "", transit: "" })));
    setPct({});
    setE(EMPTY_EXPENSES);
    setNote("Расходы в таблице лотов очищены.");
  }

  const unit = (m: "pct" | "rub", k: "fee" | "broker") => (
    <div className="flex gap-1">
      <Input inputMode="decimal" value={e[k]} onChange={(ev) => set(k, ev.target.value)} placeholder={m === "pct" ? "например, 7,35" : "сумма, ₽"} aria-label={k === "fee" ? "Сборы аукциона" : "Брокерский"} />
      <Select value={m} onChange={(ev) => set(k === "fee" ? "feeMode" : "brokerMode", ev.target.value as "pct" | "rub")} aria-label="Единица" className="w-20">
        <option value="pct">%</option>
        <option value="rub">₽</option>
      </Select>
    </div>
  );

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-3" data-expenses-block>
      <div>
        <h2 className="text-sm font-semibold">Расходы партии</h2>
        <p className="text-xs text-neutral-500">Общие суммы за всю партию. «Разнести на лоты» запишет их в столбцы расчётного листа каждого лота; в составе цены лота они попадут в «Выделку», «Транспорт», «Брокерский» и «Сбор». Пропустите то, чего нет.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><Label>Сборы аукциона (% от товара или ₽)</Label>{unit(e.feeMode, "fee")}</div>
        <div><Label>Брокерский (% от товара или ₽)</Label>{unit(e.brokerMode, "broker")}</div>
        <div><Label htmlFor="ex-dressing">Выделка, ₽ с НДС 22%</Label><Input id="ex-dressing" inputMode="decimal" value={e.dressing} onChange={(ev) => set("dressing", ev.target.value)} /></div>
        <div><Label htmlFor="ex-transport">Транспорт, ₽</Label><Input id="ex-transport" inputMode="decimal" value={e.transport} onChange={(ev) => set("transport", ev.target.value)} /></div>
        <div><Label htmlFor="ex-customs">Таможня, ₽</Label><Input id="ex-customs" inputMode="decimal" value={e.customs} onChange={(ev) => set("customs", ev.target.value)} /></div>
        <div><Label htmlFor="ex-transit">Комиссия за транзит денег, ₽</Label><Input id="ex-transit" inputMode="decimal" value={e.transit} onChange={(ev) => set("transit", ev.target.value)} /></div>
        <div><Label htmlFor="ex-other">Упаковка и прочее, ₽</Label><Input id="ex-other" inputMode="decimal" value={e.other} onChange={(ev) => set("other", ev.target.value)} /></div>
        <div>
          <Label htmlFor="ex-base">Делить рубли на лоты</Label>
          <Select id="ex-base" value={e.base} onChange={(ev) => set("base", ev.target.value as "qty" | "value")}>
            <option value="qty">поровну на каждую шкуру</option>
            <option value="value">пропорционально стоимости товара</option>
          </Select>
        </div>
      </div>
      <p className="text-xs text-neutral-500">Таможня и «упаковка и прочее» в расчётном листе идут одной строкой с транспортом. Сборы и брокерский в рублях переводятся в процент от стоимости товара всей партии.</p>
      {noRate && <p className="text-xs text-amber-800">Укажите курс на шаге 1 — без него стоимость товара не считается.</p>}
      {problems.length > 0 && <ul className="list-disc rounded-md bg-red-50 px-6 py-1.5 text-xs text-red-700">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" className="btn-accent" disabled={!hasAnyExpense(e) || problems.length > 0 || noRate || rows.length === 0} onClick={apply}>Разнести на лоты</Button>
        <Button type="button" size="sm" variant="outline" onClick={clearAll} disabled={rows.length === 0}>Очистить расходы в лотах</Button>
        {note && <span className="text-xs text-neutral-600" role="status">{note}</span>}
      </div>
      <CompositionTable c={comp} live />
    </section>
  );
}

export function CompositionTable({ c, live = false, serverTotal }: { c: Composition; live?: boolean; serverTotal?: number }) {
  if (c.lots === 0) return <p className="text-xs text-neutral-500">Состав цены появится, когда в таблице будут лоты с количеством и ценой.</p>;
  const vat = c.goodsVat + c.feeVat;
  const lines: [string, number][] = [
    ["Товар (молоток × курс)", c.goods],
    ["Сборы аукциона", c.fee],
    ["Брокерский", c.broker],
    ["Выделка (с НДС 22%)", c.dressing],
    ["Транспорт, таможня, прочее", c.transport],
    ["Комиссия за транзит", c.transit],
    ["НДС на товар и на сбор", vat],
  ].filter(([, v], i) => i === 0 || Math.abs(v as number) > 0.004) as [string, number][];
  const mismatch = serverTotal !== undefined && Math.abs(serverTotal - c.totalIncl) > 1;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-composition>
      <div>
        <div className="mb-1 text-xs font-medium text-neutral-500">Состав цены{live ? " (пересчитывается сразу)" : ""}</div>
        <table className="w-full text-sm">
          <tbody>
            {lines.map(([label, v]) => (
              <tr key={label} className="border-b border-neutral-100"><td className="py-1 text-neutral-600">{label}</td><td className="py-1 text-right tabular-nums">{money(v)}</td><td className="w-14 py-1 text-right text-xs tabular-nums text-neutral-500">{c.totalIncl > 0 ? `${fmt((v / c.totalIncl) * 100, 1)}%` : ""}</td></tr>
            ))}
            <tr><td className="py-1 font-semibold">Итого с НДС</td><td className="py-1 text-right font-semibold tabular-nums">{money(c.totalIncl)}</td><td /></tr>
            <tr><td className="py-1 text-neutral-600">Итого без НДС</td><td className="py-1 text-right tabular-nums">{money(c.totalExcl)}</td><td /></tr>
          </tbody>
        </table>
        {mismatch && <p className="mt-1 text-xs text-amber-800">Серверный расчёт ({money(serverTotal!)}) отличается от этого состава — доверяйте серверному итогу и проверьте строки.</p>}
      </div>
      <div className="flex flex-col justify-center gap-1 rounded-md bg-[var(--ui-soft)] px-3 py-2 text-sm">
        <div>Лотов: <b>{fmt(c.lots)}</b>, шкур: <b>{fmt(c.qty)}</b></div>
        <div>Себестоимость за шкуру с НДС: <b>{money(c.perUnitIncl)}</b></div>
        <div>Себестоимость за шкуру без НДС: <b>{money(c.perUnitExcl)}</b></div>
      </div>
    </div>
  );
}
