"use client";

import { Fragment, useMemo, useState } from "react";
import type { MinkSexStock, PcsParams, PcsRow } from "@/lib/budget-pcs";
import { computeSupply, overridesFromParams, type SupplyFurRow } from "@/lib/fw27-supply";
import { buildPlan, INTAKE_MONTHS, NI, NM, PLAN_MONTHS, planInputFromSupply, planRows, RAW_FURS, TARGET_LOAD_DEFAULT, type PlanState } from "@/lib/fw27-plan";
import { formatInt } from "@/lib/utils";
import { savePlanState } from "./actions";

type Data = { pcsId: string; pcsName: string; rows: PcsRow[]; params: PcsParams; raw: { fur: string; stock: number; need: number; total?: number }[]; mix: { RTW: number; Acc: number }; price: Record<string, number>; minkStock: MinkSexStock | null; state: PlanState };

const TH = "whitespace-nowrap px-2 py-1.5 text-right text-xs font-medium text-neutral-500 border-l border-neutral-200";
const TD = "whitespace-nowrap px-1.5 py-1 text-right text-sm tabular-nums border-l border-neutral-200";
const cell = (v: number) => (Math.round(v) ? formatInt(Math.round(v)) : "–");
const pctTxt = (v: number) => `${Math.round(v * 100)} %`;
const BLOCK = { RTW: "Одежда", Acc: "Аксессуары" } as const;
const parse = (s: string) => { if (s.trim() === "") return null; const x = parseFloat(s.replace(",", ".").replace(/\s/g, "")); return Number.isFinite(x) ? x : null; };

/** Поле месяца: показывает итоговое значение; своё значение подсвечено; пусто — снова авто. */
function Cell({ value, manual, onSet, label, disabled, width = "w-14", suffix = "" }: { value: string; manual: boolean; onSet: (v: number | null) => void; label: string; disabled: boolean; width?: string; suffix?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input inputMode="decimal" aria-label={label} disabled={disabled} value={draft ?? (manual ? value : "")} placeholder={value + suffix}
      onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft !== null) { onSet(parse(draft)); setDraft(null); } }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={`${width} min-h-8 rounded border px-1 text-right text-sm tabular-nums placeholder:text-neutral-700 disabled:bg-transparent disabled:border-transparent ${manual ? "border-[var(--ui-accent)] bg-[var(--ui-soft)] font-semibold" : "border-neutral-200 bg-white"}`} />
  );
}

export function PlanView({ data, canEdit }: { data: Data; canEdit: boolean }) {
  const [st, setSt] = useState<PlanState>(data.state ?? {});
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);
  const upd = (f: (s: PlanState) => PlanState) => { setSt((s) => f(s)); setDirty(true); };

  // Закупка — тем же расчётом, что Budget PCS (сохранённые параметры), отсюда годное по блокам и сколько покупаем.
  const supply = useMemo(() => computeSupply({ rows: data.rows, blocks: ["RTW", "Acc"], raw: data.raw, mix: data.mix, price: data.price, minkStock: data.minkStock, params: data.params, ov: overridesFromParams(data.params) }), [data]);
  const furRows = supply.rows.filter((r): r is SupplyFurRow => !r.mixed);
  const prows = useMemo(() => planRows(data.rows, data.params, data.mix), [data]);
  const base = useMemo(() => planInputFromSupply(furRows), [furRows]);
  const plan = useMemo(() => buildPlan({ prows, lpool: base.lpool, buy: base.buy, state: st }), [prows, base, st]);

  const setProd = (key: string, m: number, v: number | null) => upd((s) => { const a = [...(s.prod?.[key] ?? Array(NM).fill(null))]; a[m] = v; return { ...s, prod: { ...(s.prod ?? {}), [key]: a } }; });
  const setIntake = (f: string, j: number, v: number | null) => upd((s) => { const a = [...(s.intake?.[f] ?? Array(NI).fill(null))]; a[j] = v; return { ...s, intake: { ...(s.intake ?? {}), [f]: a } }; });
  const setLoad = (m: number, v: number | null) => upd((s) => { const a = [...(s.targetLoad ?? plan.targetLoad)]; a[m] = v == null ? plan.targetLoad[m] : v / 100; return { ...s, targetLoad: a }; });
  const save = async () => { setMsg("Сохраняю…"); const r = await savePlanState(st); if (r.ok) { setDirty(false); setMsg(`Сохранено ${new Date(r.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" })}`); } else setMsg(r.error); };
  const resetAll = () => { setSt({ lead: st.lead, capRtw: st.capRtw, capAcc: st.capAcc, targetLoad: st.targetLoad, noWinter: st.noWinter }); setDirty(true); };

  const rtwPlan = prows.filter((r) => r.block === "RTW").reduce((a, r) => a + r.pcs, 0), accPlan = prows.filter((r) => r.block === "Acc").reduce((a, r) => a + r.pcs, 0);
  const allOk = RAW_FURS.every((f) => plan.raw[f].ok);
  const winterRows = RAW_FURS.flatMap((f) => plan.winter[f].map((w) => ({ f, ...w })));
  const shortT = RAW_FURS.map((f) => ({ f, max: Math.max(...plan.shortTarget[f]) })).filter((x) => x.max >= 0.5);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">План производства 2027 по месяцам</h1>
          
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? <span className="text-xs text-neutral-500" role="status">Есть несохранённые изменения</span> : msg ? <span className="text-xs text-neutral-500" role="status">{msg}</span> : null}
          {canEdit ? <button type="button" onClick={resetAll} className="min-h-11 rounded-lg border border-neutral-300 bg-white px-4 text-sm hover:border-neutral-500">Сбросить правки по месяцам</button> : null}
          {canEdit ? <button type="button" onClick={save} disabled={!dirty} className="min-h-11 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-50">Сохранить</button> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Параметры плана">
        {([["lead", "От прихода до шитья, мес.", plan.lead], ["capRtw", "Мощность одежда, изд./мес.", plan.capRtw], ["capAcc", "Мощность аксессуары, изд./мес.", plan.capAcc]] as const).map(([k, label, v]) => (
          <label key={k} className="flex flex-col gap-1 text-xs text-neutral-600">{label}
            <input inputMode="decimal" disabled={!canEdit} defaultValue={String(v)} key={`${k}-${v}`} onBlur={(e) => { const x = parse(e.target.value); upd((s) => ({ ...s, [k]: x })); }}
              className="min-h-11 w-28 rounded-lg border border-neutral-300 bg-white px-2 text-right text-sm tabular-nums" />
          </label>
        ))}
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled={!canEdit} checked={!st.noWinter} onChange={(e) => upd((s) => ({ ...s, noWinter: !e.target.checked }))} className="h-5 w-5" />Докупать зимой, чтобы шить по целевой загрузке</label>
      </div>

      {/* 1. Производство */}
      <section className="overflow-x-auto rounded-lg border border-neutral-200 bg-white" aria-label="Производство по месяцам">
        <table className="w-full min-w-[960px]">
          <thead><tr className="border-b border-neutral-200"><th className="px-3 py-1.5 text-left text-xs font-medium text-neutral-500">1. Производство, шт.</th>{PLAN_MONTHS.map((m) => <th key={m} className={TH}>{m}</th>)}<th className={TH}>Итого</th><th className={TH}>План</th><th className={TH}>Сверка</th></tr></thead>
          <tbody>
            {prows.map((r) => {
              const v = plan.prod[r.key], man = st.prod?.[r.key] ?? [], tot = v.reduce((a, b) => a + b, 0);
              return (
                <tr key={r.key} className="border-b border-neutral-100">
                  <td className="px-3 py-1 text-sm">{r.fur} · {BLOCK[r.block]}</td>
                  {v.map((x, m) => <td key={m} className={TD}><Cell value={String(x)} manual={man[m] != null} disabled={!canEdit} label={`${r.fur} ${BLOCK[r.block]}, ${PLAN_MONTHS[m]}`} onSet={(nv) => setProd(r.key, m, nv)} /></td>)}
                  <td className={TD + " font-semibold"}>{cell(tot)}</td><td className={TD}>{cell(r.pcs)}</td>
                  <td className={TD + (tot === r.pcs && v.every((x) => x >= 0) ? " text-green-800" : " text-red-700 font-semibold")}>{tot === r.pcs && v.every((x) => x >= 0) ? "✓" : `≠ ${tot - r.pcs}`}</td>
                </tr>
              );
            })}
            {([["Одежда — всего", plan.rtw, rtwPlan], ["Аксессуары — всего", plan.acc, accPlan]] as const).map(([lab, arr, p]) => (
              <tr key={lab} className="border-b border-neutral-200 bg-neutral-50 font-semibold"><td className="px-3 py-1 text-sm">{lab}</td>{arr.map((x, m) => <td key={m} className={TD}>{cell(x)}</td>)}<td className={TD}>{cell(arr.reduce((a, b) => a + b, 0))}</td><td className={TD}>{cell(p)}</td><td className={TD} /></tr>
            ))}
            <tr className="border-b border-neutral-200 bg-neutral-100 font-semibold"><td className="px-3 py-1 text-sm">ВСЕГО изделий</td>{plan.rtw.map((x, m) => <td key={m} className={TD}>{cell(x + plan.acc[m])}</td>)}<td className={TD}>{cell([...plan.rtw, ...plan.acc].reduce((a, b) => a + b, 0))}</td><td className={TD}>{cell(rtwPlan + accPlan)}</td><td className={TD} /></tr>
            {([["Загрузка: одежда", plan.rtw.map((x) => x / plan.capRtw)], ["Загрузка: аксессуары", plan.acc.map((x) => x / plan.capAcc)], ["Одежда: сшито нарастающим итогом, % плана", plan.rtwCum]] as const).map(([lab, arr]) => (
              <tr key={lab} className="border-b border-neutral-100"><td className="px-3 py-1 text-sm">{lab}</td>{arr.map((x, m) => <td key={m} className={TD + (lab.startsWith("Загрузка") && x > 1.0001 ? " text-red-700 font-semibold" : "")}>{pctTxt(x)}</td>)}<td className={TD} colSpan={3} /></tr>
            ))}
            <tr className="border-b border-neutral-100"><td className="px-3 py-1 text-sm">Целевая загрузка одежды, %</td>{plan.targetLoad.map((x, m) => <td key={m} className={TD}><Cell value={String(Math.round(x * 100))} suffix="" manual={st.targetLoad != null && Math.round(st.targetLoad[m] * 100) !== Math.round(TARGET_LOAD_DEFAULT[m] * 100)} disabled={!canEdit} label={`Целевая загрузка, ${PLAN_MONTHS[m]}`} onSet={(nv) => setLoad(m, nv)} /></td>)}<td className={TD} colSpan={3} /></tr>
          </tbody>
        </table>
      </section>

      {/* 2. Приход */}
      <section className="overflow-x-auto rounded-lg border border-neutral-200 bg-white" aria-label="Приход купленного сырья по месяцам">
        <table className="w-full min-w-[960px]">
          <thead><tr className="border-b border-neutral-200"><th className="px-3 py-1.5 text-left text-xs font-medium text-neutral-500">2. Приход купленного сырья, % закупки (шкур)</th>{INTAKE_MONTHS.map((m) => <th key={m} className={TH}>{m}</th>)}<th className={TH}>Итого</th></tr></thead>
          <tbody>
            {RAW_FURS.map((f) => {
              const v = plan.intake[f], man = st.intake?.[f] ?? [], buy = base.buy[f] ?? 0;
              return (
                <Fragment key={f}>
                  <tr className="border-b border-neutral-100">
                    <td className="px-3 py-1 text-sm">{f} <span className="text-xs text-neutral-500">закупка {cell(buy)} шк.</span></td>
                    {v.map((x, j) => <td key={j} className={TD}><Cell value={String(Math.round(x * 1000) / 10)} suffix="" width="w-12" manual={man[j] != null} disabled={!canEdit} label={`Приход ${f}, ${INTAKE_MONTHS[j]}, %`} onSet={(nv) => setIntake(f, j, nv)} /></td>)}
                    <td className={TD + (Math.abs(v.reduce((a, b) => a + b, 0) - 1) < 0.001 ? "" : " text-red-700 font-semibold")}>{pctTxt(v.reduce((a, b) => a + b, 0))}</td>
                  </tr>
                  <tr className="border-b border-neutral-200 text-neutral-600"><td className="px-3 py-0.5 pl-6 text-xs">шкур</td>{v.map((x, j) => <td key={j} className={TD + " text-xs"}>{cell(x * buy)}</td>)}<td className={TD + " text-xs"}>{cell(buy)}</td></tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <p className="px-3 py-2 text-xs text-neutral-600">По умолчанию — как приходило в 2025–2026 (весенние аукционы — летом) плюс зимняя часть закупки, чтобы шить одежду по целевой загрузке. Свой процент месяца — следующие месяцы этого меха пропорционально уменьшаются, итог 100 %.{winterRows.length ? " Зимой (по умолчанию): " + winterRows.map((w) => `${w.f} ${formatInt(Math.round(w.qty))} шк. к ${INTAKE_MONTHS[w.idx]}`).join(", ") + "." : ""}</p>
      </section>

      {/* 3. Сырьё */}
      <section className="overflow-x-auto rounded-lg border border-neutral-200 bg-white" aria-label="Сырьё по месяцам">
        <table className="w-full min-w-[960px]">
          <thead><tr className="border-b border-neutral-200"><th className="px-3 py-1.5 text-left text-xs font-medium text-neutral-500">3. Годное сырьё под план, шк.</th>{PLAN_MONTHS.map((m) => <th key={m} className={TH}>{m}</th>)}<th className={TH}>Итого</th></tr></thead>
          <tbody>
            {RAW_FURS.map((f) => {
              const x = plan.raw[f];
              const lines = [["Остаток на начало", x.start, null], ["Приход", x.inc, x.inc.reduce((a, b) => a + b, 0)], ["Расход на шитьё", x.use, x.use.reduce((a, b) => a + b, 0)], ["Остаток на конец", x.end, x.end[NM - 1]], [`из него ещё не готово (пришло < ${plan.lead} мес.)`, x.notReady, null]] as const;
              return (
                <Fragment key={f}>
                  {lines.map(([lab, arr, tot], k) => (
                    <tr key={lab} className={"border-b " + (k === lines.length - 1 ? "border-neutral-300" : "border-neutral-100") + (k === 0 ? " bg-neutral-50" : "")}>
                      <td className="px-3 py-1 text-sm">{k === 0 ? <b>{f} </b> : null}{lab}{k === 0 ? <span className={"ml-2 text-xs " + (x.ok ? "text-green-800" : "text-red-700 font-semibold")}>{x.ok ? "✓ хватает" : "≠ не хватает — сдвиньте шитьё или приход"}</span> : null}</td>
                      {arr.map((v, m) => <td key={m} className={TD + (k === 3 && v - x.notReady[m] < -0.5 ? " text-red-700 font-semibold" : "")}>{cell(v)}</td>)}
                      <td className={TD}>{tot == null ? "" : cell(tot)}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        
      </section>

      {shortT.length ? <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm">Чтобы шить одежду по целевой загрузке, при таком приходе не хватает: {shortT.map((x) => `${x.f} ${formatInt(Math.round(x.max))} шк.`).join(", ")} — включите «Докупать зимой» или перенесите приход на более ранние месяцы.</p> : null}
    </div>
  );
}
