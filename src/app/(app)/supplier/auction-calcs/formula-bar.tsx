"use client";

import { InfoHint } from "@/components/info-hint";
import { explicitRowRefs, shiftFormula, FormulaError } from "@/lib/calc-formula";
import { UNIT_COL, calcAll, matchRule, type CalcPayload, type Sheet } from "@/lib/supplier-calc";
import { useState, type Dispatch, type SetStateAction } from "react";

const fmt = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "" : n.toLocaleString("ru-RU", { maximumFractionDigits: 4 }));
const withEq = (s: string) => (s.trim().startsWith("=") ? s.trim() : `=${s.trim()}`);

type Overrides = NonNullable<CalcPayload["overrides"]>;
type Plan = { rows: { j: number; id: string; text: string | null }[]; error?: string };

/** Что получит каждая строка ниже при «Протянуть вниз»: сдвинутая формула ячейки; для ячейки без своей правки — возврат к формуле столбца. */
export function planFill(p: CalcPayload, sh: Sheet, i: number, colId: string): Plan {
  const src = p.overrides?.[p.rows[i]?._id]?.[colId];
  const rows: Plan["rows"] = [];
  try {
    for (let j = i + 1; j < p.rows.length; j++) {
      if (!sh.used[j]) continue;
      const id = p.rows[j]._id;
      if (src === undefined || src.trim() === "") { if (p.overrides?.[id]?.[colId] !== undefined) rows.push({ j, id, text: null }); continue; }
      rows.push({ j, id, text: src.trim().startsWith("=") ? shiftFormula(src, j - i) : src });
    }
  } catch (e) {
    return { rows: [], error: e instanceof FormulaError ? e.message : "Не удалось сдвинуть формулу" };
  }
  return { rows };
}

function withOverrides(p: CalcPayload, colId: string, plan: Plan): CalcPayload {
  const o: Overrides = { ...(p.overrides ?? {}) };
  for (const r of plan.rows) {
    const cur = { ...(o[r.id] ?? {}) };
    if (r.text === null) delete cur[colId]; else cur[colId] = r.text;
    if (Object.keys(cur).length) o[r.id] = cur; else delete o[r.id];
  }
  return { ...p, overrides: o };
}

function Field({ value, readOnly, live, placeholder, onCommit, label }: { value: string; readOnly: boolean; live: boolean; placeholder?: string; onCommit: (v: string) => void; label: string }) {
  const [txt, setTxt] = useState(value);
  const commit = () => { if (txt !== value) onCommit(txt); };
  return (
    <input aria-label={label} value={txt} readOnly={readOnly} placeholder={placeholder} spellCheck={false}
      onChange={(e) => { setTxt(e.target.value); if (live) onCommit(e.target.value); }}
      onBlur={() => { if (!live) commit(); }}
      onKeyDown={(e) => { if (e.key === "Enter" && !live) { e.preventDefault(); commit(); } else if (e.key === "Escape") setTxt(value); }}
      className={`h-9 min-w-0 flex-1 basis-56 rounded border px-2 font-mono text-sm outline-none focus:ring-2 focus:ring-sky-400 max-md:h-11 ${readOnly ? "border-neutral-200 bg-neutral-100 text-neutral-600" : "border-neutral-300 bg-white"}`} />
  );
}

/**
 * Строка формул над таблицей (как в Excel): адрес выбранной ячейки, её полная формула, подстановка для строки и «Протянуть вниз».
 * Правка — тем же механизмом, что и в ячейке (overrides строки); сохраняется кнопкой «Сохранить черновик».
 */
export function FormulaBar({ p, setP, sh, act, ro, lockReason, fillInput }: {
  p: CalcPayload; setP: Dispatch<SetStateAction<CalcPayload>>; sh: Sheet; act: { i: number; id: string } | null; ro: boolean; lockReason: string | null;
  fillInput: (r: number, ci: number) => void;
}) {
  const [preview, setPreview] = useState<{ colId: string; i: number; plan: Plan } | null>(null);
  const [undo, setUndo] = useState<Overrides | null>(null);
  const col = act ? sh.cols.find((x) => x.id === act.id) : undefined;
  const row = act ? p.rows[act.i] : undefined;
  if (!act || !col || !row) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm">
        <span className="font-mono text-xs text-neutral-500">ячейка</span>
        <span className="text-neutral-500">Нажмите на ячейку — здесь её формула</span>
        <InfoHint label="Про строку формул">{HELP}</InfoHint>
      </div>
    );
  }
  const n = act.i + 1;
  const cc = (p.customColumns ?? []).find((x) => x.id === col.id);
  const ovr = row._id ? p.overrides?.[row._id]?.[col.id] : undefined;
  const cell = sh.cells[col.id]?.[act.i];
  const isCol = (l: string) => sh.cols.some((c) => c.letter === l);
  const editableCalc = col.kind === "custom" || col.id === UNIT_COL;
  const canEdit = !ro && (col.kind === "input" || editableCalc);
  const letterOf = (id: string) => sh.cols.find((c) => c.id === id)?.letter ?? "?";

  // полная формула расчёта этой ячейки
  let colFormula: string | null = null; // формула столбца для этой строки
  if (cc && cc.kind !== "input") {
    const rule = (cc.rules ?? []).find((r) => matchRule(r, n, row));
    const f = rule ? rule.formula : cc.formula;
    colFormula = f && f.trim() ? withEq(f) : null;
  } else if (col.id === "total") colFormula = `=${letterOf(sh.unitCol)}${n}*${letterOf(sh.qtyCol)}${n}`;
  const shown = ovr !== undefined && ovr.trim() !== "" ? ovr : col.kind === "input" ? (row[col.id] ?? "") : colFormula ?? "";
  const explicit = shown.trim().startsWith("=") ? explicitRowRefs(shown, n, isCol) : null;
  const how = ovr !== undefined && ovr.trim() !== "" ? "вручную" : col.kind === "input" ? "ввод" : "по формуле";

  const setOv = (v: string | null) => setP((x) => {
    const o = { ...(x.overrides ?? {}) };
    const r = { ...(o[row._id] ?? {}) };
    if (v === null || v.trim() === "") delete r[col.id]; else r[col.id] = v;
    if (Object.keys(r).length) o[row._id] = r; else delete o[row._id];
    return { ...x, overrides: o };
  });
  const commit = (v: string) => {
    if (col.kind === "input") return setP((x) => ({ ...x, rows: x.rows.map((r, j) => (j === act.i ? { ...r, [col.id]: v } : r)) }));
    setOv(colFormula && withEq(v) === colFormula ? null : v);
  };

  // «Протянуть вниз»
  const openFill = () => {
    if (col.kind === "input") return fillInput(act.i, sh.cols.findIndex((x) => x.id === col.id));
    setPreview({ colId: col.id, i: act.i, plan: planFill(p, sh, act.i, col.id) });
  };
  const pv = preview && preview.colId === col.id && preview.i === act.i ? preview : null;
  let pvInfo: { first: string; last: string; errors: number } | null = null;
  if (pv && pv.plan.rows.length) {
    const next = calcAll(withOverrides(p, col.id, pv.plan)).sheet.cells[col.id] ?? [];
    const f = pv.plan.rows[0], l = pv.plan.rows[pv.plan.rows.length - 1];
    const show = (r: typeof f) => `${r.j + 1}: ${r.text ?? "формула столбца"} → ${next[r.j]?.err ? "ошибка" : fmt(next[r.j]?.v)}`;
    pvInfo = { first: show(f), last: pv.plan.rows.length > 1 ? show(l) : "", errors: pv.plan.rows.filter((r) => next[r.j]?.err).length };
  }
  const apply = () => {
    if (!pv || pv.plan.error || !pv.plan.rows.length) return;
    setUndo(p.overrides ?? {});
    setP((x) => withOverrides(x, pv.colId, pv.plan));
    setPreview(null);
  };

  const noWrite = ro ? lockReason ?? "Править нельзя" : col.id === "total" || col.id === "unitUsd" ? "Считается по формуле формата, править нельзя. Правьте «Цена за шкуру, ₽» или свои столбцы." : null;

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm" data-testid="formula-bar">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-neutral-300 bg-white px-2 py-1 font-mono text-xs" aria-label="Адрес ячейки">{col.letter}{n}</span>
        <Field key={`${act.i}-${col.id}-${col.kind === "input" ? "" : shown}`} label={`Формула ячейки ${col.letter}${n}`} value={shown} readOnly={!canEdit} live={col.kind === "input"}
          placeholder={col.id === UNIT_COL ? "по формуле формата — впишите своё значение или =формулу" : undefined} onCommit={commit} />
        {canEdit && (
          <button type="button" onClick={openFill} className="inline-flex min-h-9 items-center rounded border border-neutral-300 bg-white px-3 text-xs hover:bg-neutral-100 max-md:min-h-11" title="Формула этой ячейки на все строки ниже; адреса сдвигаются (E1→E2), $ закрепляет">Протянуть вниз</button>
        )}
        {undo && !pv && <button type="button" onClick={() => { setP((x) => ({ ...x, overrides: undo })); setUndo(null); }} className="inline-flex min-h-9 items-center px-2 text-xs text-blue-700 underline max-md:min-h-11">Отменить протяжку</button>}
        <InfoHint label="Про строку формул">{HELP}</InfoHint>
      </div>
      <p className="font-mono text-xs text-neutral-600">
        {explicit ? `${explicit} → ` : ""}{cell?.err ? <span className="text-red-600">{cell.err}</span> : fmt(cell?.v) || "–"} <span className="font-sans text-neutral-600">({how})</span>
        {noWrite && <span className="ml-2 font-sans text-amber-800">{noWrite}</span>}
        {!noWrite && canEdit && col.kind !== "input" && <span className="ml-2 font-sans text-neutral-500">Enter — применить; «↩» в ячейке вернёт формулу столбца.</span>}
      </p>
      {pv && (
        <div className="flex flex-col gap-1 rounded border border-sky-300 bg-white p-2 text-xs" role="status">
          {pv.plan.error ? <span className="text-red-600">{pv.plan.error}. Протянуть нельзя.</span>
            : pv.plan.rows.length === 0 ? <span>Ниже нечего менять: нет заполненных строк или правок.</span>
            : <>
              <span className="font-mono text-neutral-700">строка {pvInfo?.first}{pvInfo?.last ? <><br />строка {pvInfo.last}</> : null}</span>
              {pvInfo && pvInfo.errors > 0 && <span className="text-red-600">С ошибкой получится строк: {pvInfo.errors}. Проверьте адреса ячеек.</span>}
            </>}
          <div className="flex flex-wrap gap-2">
            {!pv.plan.error && pv.plan.rows.length > 0 && <button type="button" onClick={apply} className="inline-flex min-h-9 items-center rounded bg-neutral-900 px-3 text-xs text-white max-md:min-h-11">Применить к {pv.plan.rows.length} {rowsWord(pv.plan.rows.length)}</button>}
            <button type="button" onClick={() => setPreview(null)} className="inline-flex min-h-9 items-center rounded border border-neutral-300 px-3 text-xs max-md:min-h-11">Отмена</button>
          </div>
        </div>
      )}
    </div>
  );
}

const rowsWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "строке" : "строкам");

const HELP = "Слева адрес ячейки (столбец и строка), в поле — её полная формула; под ней та же формула с номером строки и результат. Белые поля и серые ячейки с подсказкой «Нажмите, чтобы изменить» можно править: впишите число или формулу со знака «=» (например =M+500 или =E1*2) и нажмите Enter. «Протянуть вниз» переносит формулу на строки ниже со сдвигом адресов (E1→E2), знак $ закрепляет ($E$1). Сохраняется кнопкой «Сохранить черновик».";
