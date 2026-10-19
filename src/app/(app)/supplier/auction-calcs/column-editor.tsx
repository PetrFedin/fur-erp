"use client";

import { useMemo, useState } from "react";
import { InfoHint } from "@/components/info-hint";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { parseFormula, FormulaError } from "@/lib/calc-formula";
import { EMPTY_SPEC, OP_HINT, OP_LABEL, buildFormula, buildTextRule, previewFormula, type OpKind, type Spec } from "@/lib/formula-builder";
import { paramList, type CalcPayload, type ColRule, type CustomCol, type SheetCol } from "@/lib/supplier-calc";

export type Draft = {
  id: string | null; title: string; unit: string; kind: "input" | "formula"; text: boolean;
  formula: string; rules: ColRule[]; total: "sum" | "avg" | "none"; spec: Spec;
};
export const newDraft = (kind: "input" | "formula" = "formula"): Draft => ({ id: null, title: "", unit: "", kind, text: false, formula: "", rules: [], total: "sum", spec: { ...EMPTY_SPEC } });
export const draftFrom = (c: CustomCol): Draft => ({
  id: c.id, title: c.title, unit: c.unit, kind: c.kind === "input" ? "input" : "formula", text: !!c.text,
  formula: c.formula, rules: c.rules ?? [], total: c.total ?? "sum", spec: { ...EMPTY_SPEC, op: "custom", text: c.formula },
});

const OPS = Object.keys(OP_LABEL) as OpKind[];

/** Операнд: столбец (по букве), параметр (по имени) или число/выражение. */
function Operand({ value, onChange, cols, params, label }: { value: string; onChange: (v: string) => void; cols: SheetCol[]; params: string[]; label: string }) {
  const isCol = cols.some((c) => c.letter === value);
  const isParam = params.includes(value);
  const [numMode, setNumMode] = useState(() => value !== "" && !isCol && !isParam);
  const sel = numMode ? "__num" : value;
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        <Select className="w-64" value={sel} onChange={(e) => {
          if (e.target.value === "__num") { setNumMode(true); onChange(""); } else { setNumMode(false); onChange(e.target.value); }
        }}>
          <option value="">— выберите —</option>
          <optgroup label="Столбец">{cols.map((c) => <option key={c.id} value={c.letter}>{c.letter} — {c.title}</option>)}</optgroup>
          <optgroup label="Параметр">{params.map((n) => <option key={n} value={n}>{n}</option>)}</optgroup>
          <option value="__num">Число…</option>
        </Select>
        {numMode && <Input className="w-32" inputMode="decimal" placeholder="например 1,22" value={value} onChange={(e) => onChange(e.target.value)} />}
      </div>
    </div>
  );
}

function Checks({ cols, value, onChange }: { cols: SheetCol[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {cols.map((c) => (
        <label key={c.id} className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={value.includes(c.letter)} onChange={(e) => onChange(e.target.checked ? [...value, c.letter] : value.filter((x) => x !== c.letter))} />
          <span className="font-mono text-xs text-neutral-500">{c.letter}</span> {c.title}
        </label>
      ))}
    </div>
  );
}

/** Редактор столбца: название, ввод/формула, конструктор операции, текст формулы с живым примером, правила для блоков строк. */
export function ColumnEditor({ draft, setDraft, p, cols, canInput, manualCount, onSave, onCancel, onApplyAll }: {
  draft: Draft; setDraft: (d: Draft) => void; p: CalcPayload; cols: SheetCol[]; canInput: boolean; manualCount: number;
  onSave: (d: Draft) => string | null; onCancel: () => void; onApplyAll?: () => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(draft.rules.length > 0);
  const params = useMemo(() => paramList(p).map((q) => q.name), [p]);
  // столбцы-источники: все числовые, кроме самого редактируемого
  const numCols = cols.filter((c) => !c.text && c.id !== draft.id);
  const inputCols = cols.filter((c) => c.kind === "input" && c.id !== draft.id);
  const sp = draft.spec;
  const setSpec = (patch: Partial<Spec>) => {
    const spec = { ...sp, ...patch };
    const f = buildFormula(spec);
    setDraft({ ...draft, spec, formula: f ?? (spec.op === "custom" ? draft.formula : draft.formula) });
  };
  const pv = useMemo(() => (draft.kind === "formula" ? previewFormula(p, draft.formula, draft.id ?? undefined) : null), [p, draft.formula, draft.id, draft.kind]);
  const textCol = (letter: string) => cols.find((c) => c.letter === letter)?.text === true;

  const save = () => {
    let d = draft;
    if (d.kind === "formula" && sp.op === "cond" && textCol(sp.a)) {
      const col = cols.find((c) => c.letter === sp.a)!;
      const eq = (s: string) => (s.trim().startsWith("=") ? s.trim() : "=" + s.trim());
      if (!sp.then.trim() || !sp.otherwise.trim() || !sp.b.trim()) return setErr("Заполните значение, «то» и «иначе»");
      const r = buildTextRule(col.id, sp.b.trim(), eq(sp.then), eq(sp.otherwise));
      d = { ...d, formula: r.formula, rules: [...r.rules, ...d.rules] };
    }
    const m = onSave(d);
    setErr(m);
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-neutral-300 bg-neutral-50 p-3">
      <h3 className="text-sm font-semibold">{draft.id ? "Столбец" : "Новый столбец"}</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <div className="sm:col-span-2"><Label>Название</Label><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Сбор аукциона, ₽" /></div>
        <div><Label>Единица (необязательно)</Label><Input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="₽" /></div>
        <div>
          <Label>Что в столбце</Label>
          <Select value={draft.kind} disabled={!canInput || !!draft.id} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "input" | "formula" })}>
            <option value="formula">Считается по формуле</option>
            <option value="input">Заполняю сам (ввод)</option>
          </Select>
        </div>
      </div>

      {draft.kind === "input" && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.checked })} /> Это текст (названия, не числа)</label>
      )}

      {draft.kind === "formula" && (
        <>
          <div>
            <Label>Что посчитать</Label>
            <div className="flex flex-wrap gap-1.5">
              {OPS.map((o) => (
                <button key={o} type="button" onClick={() => setSpec({ op: o, text: o === "custom" ? draft.formula : sp.text })}
                  className={`rounded-full border px-2.5 py-1 text-xs ${sp.op === o ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white hover:bg-neutral-100"}`}>{OP_LABEL[o]}</button>
              ))}
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">Что делает<InfoHint label="Что делает" wide>{OP_HINT[sp.op]}</InfoHint></p>
          </div>

          <div className="flex flex-col gap-2">
            {(sp.op === "sum" || sp.op === "product") && <Checks cols={numCols} value={sp.cols} onChange={(cols) => setSpec({ cols })} />}
            {sp.op === "mulNum" && (<><Operand label="Столбец" value={sp.a} onChange={(a) => setSpec({ a })} cols={numCols} params={[]} /><Operand label="Умножить на (число, параметр или столбец)" value={sp.b} onChange={(b) => setSpec({ b })} cols={numCols} params={params} /></>)}
            {sp.op === "pct" && (<><Operand label="Столбец" value={sp.a} onChange={(a) => setSpec({ a })} cols={numCols} params={[]} /><Operand label="Процент (число или параметр)" value={sp.b} onChange={(b) => setSpec({ b })} cols={[]} params={params} /></>)}
            {sp.op === "pctProduct" && (<><Checks cols={numCols} value={sp.cols} onChange={(cols) => setSpec({ cols })} /><Operand label="Процент (число или параметр)" value={sp.b} onChange={(b) => setSpec({ b })} cols={[]} params={params} /></>)}
            {sp.op === "diff" && (<><Operand label="Из (уменьшаемое)" value={sp.a} onChange={(a) => setSpec({ a })} cols={numCols} params={params} /><Operand label="Вычесть" value={sp.b} onChange={(b) => setSpec({ b })} cols={numCols} params={params} /></>)}
            {sp.op === "divCount" && (<><Operand label="Общая сумма (столбец или число, можно выражение 34143-1103)" value={sp.a} onChange={(a) => setSpec({ a })} cols={numCols} params={params} /><Operand label="Разделить на количество шкур" value={sp.b} onChange={(b) => setSpec({ b })} cols={numCols} params={params} /><Operand label="НДС, % (если нужно добавить)" value={sp.c} onChange={(c) => setSpec({ c })} cols={[]} params={params} /></>)}
            {sp.op === "rate" && (<><Operand label="Курс" value={sp.a} onChange={(a) => setSpec({ a })} cols={numCols} params={params} /><Operand label="Комиссия, %" value={sp.b} onChange={(b) => setSpec({ b })} cols={[]} params={params} /></>)}
            {sp.op === "round" && (
              <div className="flex flex-wrap items-end gap-2">
                <Operand label="Столбец" value={sp.a} onChange={(a) => setSpec({ a })} cols={numCols} params={[]} />
                <div><Label>Знаков после запятой</Label><Select className="w-44" value={sp.digits} onChange={(e) => setSpec({ digits: e.target.value })}><option value="2">2 — до копеек</option><option value="0">0 — до рубля</option><option value="1">1</option><option value="4">4</option></Select></div>
              </div>
            )}
            {sp.op === "cond" && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-end gap-2">
                  <Operand label="Если (столбец; для текста — например «Мех»)" value={sp.a} onChange={(a) => setSpec({ a })} cols={cols.filter((c) => c.id !== draft.id)} params={[]} />
                  <div><Label>сравнение</Label><Select className="w-24" value={sp.cmp} onChange={(e) => setSpec({ cmp: e.target.value as Spec["cmp"] })}>{[">", "<", ">=", "<=", "=", "<>"].map((x) => <option key={x} value={x}>{x}</option>)}</Select></div>
                  <div><Label>значение</Label><Input className="w-40" value={sp.b} placeholder="100 или норка" onChange={(e) => setSpec({ b: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div><Label>То (формула или число)</Label><Input className="font-mono" value={sp.then} placeholder="D*7,95%+0,1" onChange={(e) => setSpec({ then: e.target.value })} /></div>
                  <div><Label>Иначе</Label><Input className="font-mono" value={sp.otherwise} placeholder="D*9,2%" onChange={(e) => setSpec({ otherwise: e.target.value })} /></div>
                </div>
                {textCol(sp.a) && <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">Условие по тексту<InfoHint label="Условие по тексту" wide>Условие по тексту записывается правилом столбца: для строк, где значение равно «{sp.b || "…"}», — формула «то», для остальных — «иначе».</InfoHint></p>}
              </div>
            )}
            {sp.op === "custom" && null}
          </div>

          <div>
            <Label>Формула (можно править текстом)</Label>
            <Input value={draft.formula} onChange={(e) => setDraft({ ...draft, formula: e.target.value, spec: { ...sp, op: "custom", text: e.target.value } })} placeholder="=D*курс*4,5%" className="font-mono" />
            {pv && (
              <p className={`mt-1 text-sm ${pv.error ? "text-red-600" : "text-emerald-800"}`}>
                {pv.error ? `Ошибка: ${pv.error}` : `Пример на строке ${pv.rowNo}: ${pv.text}`}
              </p>
            )}
            <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">Как писать формулу<InfoHint label="Как писать формулу" wide>Как в Excel: буква столбца берёт значение этой строки, H3 — конкретную ячейку, имя параметра — число из блока «Параметры». + − * / ( ), проценты 4,5 %, ROUND(x;2), MIN, MAX, IF(условие;a;b), SUM(H) — итог по столбцу, SUM(D:I) — сумма столбцов строки, AVERAGE, SUBTOTAL(9;H). Аргументы через «;».</InfoHint></p>
          </div>

          <div className="flex flex-col gap-2">
            <button type="button" className="self-start text-sm underline decoration-dotted" onClick={() => setShowRules((v) => !v)}>{showRules ? "▾" : "▸"} Другая формула для части строк{draft.rules.length ? ` (правил: ${draft.rules.length})` : ""}</button>
            {showRules && (
              <div className="flex flex-col gap-2 rounded border border-neutral-200 bg-white p-2">
                <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">Как работают правила<InfoHint label="Как работают правила" wide>Например: для строк 3–35 одна формула, для 36–62 другая; или для меха «свакара» ставка 9,2 %, для «норка» 7,95 % + 0,1 $. Сверху вниз: подходящее первое правило важнее основной формулы.</InfoHint></p>
                {draft.rules.map((r, k) => (
                  <div key={k} className="flex flex-wrap items-end gap-2 border-b border-neutral-100 pb-2">
                    <div><Label>со строки</Label><Input className="w-20" inputMode="numeric" value={r.rowFrom ?? ""} onChange={(e) => setDraft({ ...draft, rules: draft.rules.map((x, j) => (j === k ? { ...x, rowFrom: e.target.value === "" ? undefined : Number(e.target.value) } : x)) })} /></div>
                    <div><Label>по строку</Label><Input className="w-20" inputMode="numeric" value={r.rowTo ?? ""} onChange={(e) => setDraft({ ...draft, rules: draft.rules.map((x, j) => (j === k ? { ...x, rowTo: e.target.value === "" ? undefined : Number(e.target.value) } : x)) })} /></div>
                    <div>
                      <Label>и если в столбце</Label>
                      <Select className="w-44" value={r.whenCol ?? ""} onChange={(e) => setDraft({ ...draft, rules: draft.rules.map((x, j) => (j === k ? { ...x, whenCol: e.target.value || undefined } : x)) })}>
                        <option value="">— без условия —</option>
                        {inputCols.map((c) => <option key={c.id} value={c.id}>{c.letter} — {c.title}</option>)}
                      </Select>
                    </div>
                    {r.whenCol && (
                      <>
                        <div><Label>значение</Label><Select className="w-24" value={r.op ?? "="} onChange={(e) => setDraft({ ...draft, rules: draft.rules.map((x, j) => (j === k ? { ...x, op: e.target.value as ColRule["op"] } : x)) })}>{["=", "<>", ">", "<", ">=", "<=", "содержит"].map((x) => <option key={x}>{x}</option>)}</Select></div>
                        <div><Label>&nbsp;</Label><Input className="w-32" value={r.whenValue ?? ""} placeholder="норка" onChange={(e) => setDraft({ ...draft, rules: draft.rules.map((x, j) => (j === k ? { ...x, whenValue: e.target.value } : x)) })} /></div>
                      </>
                    )}
                    <div className="min-w-[200px] flex-1"><Label>то формула</Label><Input className="font-mono" value={r.formula} placeholder="=D*7,95%+0,1" onChange={(e) => setDraft({ ...draft, rules: draft.rules.map((x, j) => (j === k ? { ...x, formula: e.target.value } : x)) })} /></div>
                    <button type="button" className="px-2 pb-2 text-neutral-400 hover:text-red-600" title="Убрать правило" onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, j) => j !== k) })}>×</button>
                  </div>
                ))}
                <div><Button type="button" size="sm" variant="outline" onClick={() => setDraft({ ...draft, rules: [...draft.rules, { formula: "" }] })}>+ Правило</Button></div>
              </div>
            )}
          </div>
        </>
      )}

      {!draft.text && (
        <div className="max-w-xs">
          <Label>Итог внизу столбца</Label>
          <Select value={draft.total} onChange={(e) => setDraft({ ...draft, total: e.target.value as Draft["total"] })}>
            <option value="sum">Сумма</option><option value="avg">Среднее</option><option value="none">Не показывать</option>
          </Select>
        </div>
      )}

      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={save}>{draft.id ? "Сохранить столбец" : "Добавить столбец ко всем строкам"}</Button>
        {onApplyAll && manualCount > 0 && <Button type="button" size="sm" variant="outline" onClick={onApplyAll}>Применить формулу ко всем строкам ({manualCount} вручную)</Button>}
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Отмена</Button>
      </div>
    </div>
  );
}

/** Проверка черновика перед сохранением: текст ошибки или null. */
export function draftProblem(d: Draft): string | null {
  if (!d.title.trim()) return "Введите название столбца";
  if (d.kind === "input") return null;
  const srcs = [d.formula, ...d.rules.map((r) => r.formula)].filter((x) => x.trim());
  if (srcs.length === 0) return "Задайте формулу: выберите операцию или впишите текст";
  for (const [k, src] of [d.formula, ...d.rules.map((r) => r.formula)].entries()) {
    if (!src.trim()) { if (k === 0 && d.rules.length) continue; return k === 0 ? "Задайте основную формулу" : `Правило ${k}: пустая формула`; }
    try { parseFormula(src); } catch (e) { return `${k === 0 ? "Формула" : `Правило ${k}`}: ${e instanceof FormulaError ? e.message : "ошибка в формуле"}`; }
  }
  return null;
}
