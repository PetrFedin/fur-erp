"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { parseFormula, FormulaError } from "@/lib/calc-formula";
import { QTY_COL, UNIT_COL, columnUsers, newId, paramList, paramNameProblem, syncLetters, type CalcPayload, type CalcTotals, type CustomCol } from "@/lib/supplier-calc";

const fmt = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "" : n.toLocaleString("ru-RU", { maximumFractionDigits: 4 }));

type Draft = { id: string | null; title: string; unit: string; formula: string };

export function CalcDetail({ p, setP, t, ro }: { p: CalcPayload; setP: Dispatch<SetStateAction<CalcPayload>>; t: CalcTotals; ro: boolean }) {
  const sh = t.sheet;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [pname, setPname] = useState("");
  const [pval, setPval] = useState("");
  const [perr, setPerr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const params = paramList(p);

  const setOverride = (rowId: string, colId: string, v: string | null) =>
    setP((x) => {
      const o = { ...(x.overrides ?? {}) };
      const r = { ...(o[rowId] ?? {}) };
      if (v === null) delete r[colId]; else r[colId] = v;
      if (Object.keys(r).length) o[rowId] = r; else delete o[rowId];
      return { ...x, overrides: o };
    });
  const setCell = (i: number, k: string, v: string) => setP((x) => ({ ...x, rows: x.rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));

  const saveDraft = () => {
    if (!draft) return;
    if (!draft.title.trim()) return setDraftErr("Введите название столбца");
    try { parseFormula(draft.formula); } catch (e) { return setDraftErr(e instanceof FormulaError ? e.message : "Ошибка в формуле"); }
    setDraftErr(null);
    setP((x) => {
      const cols = x.customColumns ?? [];
      const next: CustomCol[] = draft.id
        ? cols.map((c) => (c.id === draft.id ? { ...c, title: draft.title.trim(), unit: draft.unit.trim(), formula: draft.formula.trim() } : c))
        : [...cols, { id: newId("c"), letter: "", title: draft.title.trim(), unit: draft.unit.trim(), formula: draft.formula.trim() }];
      return syncLetters({ ...x, customColumns: next });
    });
    setDraft(null);
  };
  const removeCol = (c: CustomCol) => {
    const users = columnUsers(p, c.id);
    if (users.length) return setNote(`Столбец «${c.title}» нельзя удалить: на него ссылается формула столбца «${users.join("», «")}».`);
    if (!confirm(`Удалить столбец «${c.title}»?`)) return;
    setNote(null);
    setP((x) => syncLetters({
      ...x,
      customColumns: (x.customColumns ?? []).filter((y) => y.id !== c.id),
      unitCostColumn: x.unitCostColumn === c.id ? undefined : x.unitCostColumn,
      qtyColumn: x.qtyColumn === c.id ? undefined : x.qtyColumn,
      overrides: Object.fromEntries(Object.entries(x.overrides ?? {}).map(([rid, o]) => [rid, Object.fromEntries(Object.entries(o).filter(([k]) => k !== c.id))])),
    }));
  };
  const addParam = () => {
    const prob = paramNameProblem(pname, [...params.map((q) => q.name)]);
    if (prob) return setPerr(prob);
    setPerr(null);
    setP((x) => ({ ...x, params: [...(x.params ?? []), { name: pname.trim().replace(/\s+/g, "_"), value: pval }] }));
    setPname(""); setPval("");
  };

  const colEditor = draft && (
    <div className="flex flex-col gap-2 rounded-md border border-neutral-300 bg-neutral-50 p-3">
      <h3 className="text-sm font-semibold">{draft.id ? "Столбец" : "Новый столбец"}</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <div className="sm:col-span-2"><Label>Название</Label><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Сбор аукциона, ₽" /></div>
        <div><Label>Единица (необязательно)</Label><Input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="₽" /></div>
        <div className="sm:col-span-4">
          <Label>Формула</Label>
          <Input value={draft.formula} onChange={(e) => setDraft({ ...draft, formula: e.target.value })} placeholder="=H*курс*ставка_сбора/100" className="font-mono" />
          <p className="mt-1 text-xs text-neutral-500">Как в Excel: буква столбца берёт значение этой же строки, параметр — по имени. + − * / ( ), ROUND(x;2), MIN, MAX, IF(условие;a;b), SUM(столбец). Десятичная запятая или точка, аргументы через «;».</p>
        </div>
      </div>
      {draftErr && <p className="text-sm text-red-600">{draftErr}</p>}
      <div className="flex gap-2"><Button type="button" size="sm" onClick={saveDraft}>{draft.id ? "Сохранить столбец" : "Добавить столбец ко всем строкам"}</Button><Button type="button" size="sm" variant="ghost" onClick={() => { setDraft(null); setDraftErr(null); }}>Отмена</Button></div>
    </div>
  );

  const unitChoices = sh.cols.filter((c) => c.kind !== "input");
  const qtyChoices = sh.cols.filter((c) => (c.kind === "input" && !c.text) || c.kind === "custom");

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-neutral-600">Таблица как в Excel: у каждого столбца своя буква. Свой столбец считается по формуле для всех строк сразу; значение любой ячейки можно вписать вручную (она помечается «вручную»), «↩» возвращает формулу.</p>

      <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3">
        <h2 className="text-sm font-semibold">Параметры для формул</h2>
        <p className="text-xs text-neutral-500">Имена, которые можно писать в формулах вместо чисел. Ставки берутся из блока «Ставки расчёта» на вкладке «Расчёт».</p>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {params.filter((q) => !q.own).map((q) => <span key={q.name} className="rounded-full bg-neutral-100 px-2 py-0.5" title={q.label}>{q.name}</span>)}
        </div>
        {(p.params ?? []).map((q, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input className="w-56 font-mono" value={q.name} readOnly={ro} onChange={(e) => setP((x) => ({ ...x, params: (x.params ?? []).map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))} />
            <Input className="w-40" inputMode="decimal" value={q.value} readOnly={ro} onChange={(e) => setP((x) => ({ ...x, params: (x.params ?? []).map((y, j) => (j === i ? { ...y, value: e.target.value } : y)) }))} />
            {!ro && <button type="button" className="px-2 text-neutral-400 hover:text-red-600" title="Убрать параметр" onClick={() => setP((x) => ({ ...x, params: (x.params ?? []).filter((_, j) => j !== i) }))}>×</button>}
          </div>
        ))}
        {!ro && (
          <div className="flex flex-wrap items-center gap-2">
            <Input className="w-56 font-mono" placeholder="имя, например упаковка_шт" value={pname} onChange={(e) => setPname(e.target.value)} />
            <Input className="w-40" inputMode="decimal" placeholder="значение" value={pval} onChange={(e) => setPval(e.target.value)} />
            <Button type="button" size="sm" variant="outline" onClick={addParam}>+ Параметр</Button>
          </div>
        )}
        {perr && <p className="text-sm text-red-600">{perr}</p>}
      </section>

      {!ro && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => { setDraft({ id: null, title: "", unit: "", formula: "" }); setDraftErr(null); }}>+ Столбец</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setP((x) => ({ ...x, rows: [...x.rows, { ...Object.fromEntries(Object.keys(x.rows[0] ?? {}).map((k) => [k, ""])), _id: newId(), invoice: x.header.invoice, dest: x.header.dest }] }))}>+ Лот</Button>
        </div>
      )}
      {colEditor}
      {note && <p className="text-sm text-red-600">{note}</p>}

      {(p.customColumns ?? []).length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Свои столбцы</h2>
          {(p.customColumns ?? []).map((c) => {
            const col = sh.cols.find((x) => x.id === c.id)!;
            const manualCount = Object.values(p.overrides ?? {}).filter((o) => o[c.id] !== undefined).length;
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-8 rounded bg-neutral-100 px-1.5 py-0.5 text-center font-mono text-xs">{col.letter}</span>
                <span className="font-medium">{c.title}</span>
                <code className="rounded bg-neutral-50 px-1.5 text-xs">{c.formula || "—"}</code>
                {sh.colErrors[c.id] && <span className="text-xs text-red-600">{sh.colErrors[c.id]}</span>}
                {!ro && (
                  <>
                    <button type="button" className="text-xs underline" onClick={() => { setDraft({ id: c.id, title: c.title, unit: c.unit, formula: c.formula }); setDraftErr(null); }}>править</button>
                    {manualCount > 0 && <button type="button" className="text-xs underline" title="Вернуть формулу во все ячейки столбца" onClick={() => setP((x) => ({ ...x, overrides: Object.fromEntries(Object.entries(x.overrides ?? {}).map(([rid, o]) => [rid, Object.fromEntries(Object.entries(o).filter(([k]) => k !== c.id))])) }))}>применить формулу ко всем строкам ({manualCount} вручную)</button>}
                    <button type="button" className="text-xs text-neutral-400 hover:text-red-600" onClick={() => removeCol(c)}>удалить</button>
                  </>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>Себестоимость за единицу, ₽ (идёт в закупку при приёме)</Label>
          <Select value={sh.unitCol} disabled={ro} onChange={(e) => setP((x) => ({ ...x, unitCostColumn: e.target.value === UNIT_COL ? undefined : e.target.value }))}>
            {unitChoices.filter((c) => c.id !== "total" && c.id !== "unitUsd").map((c) => <option key={c.id} value={c.id}>{c.letter} — {c.title}</option>)}
          </Select>
        </div>
        <div>
          <Label>Количество</Label>
          <Select value={sh.qtyCol} disabled={ro} onChange={(e) => setP((x) => ({ ...x, qtyColumn: e.target.value === QTY_COL ? undefined : e.target.value }))}>
            {qtyChoices.map((c) => <option key={c.id} value={c.id}>{c.letter} — {c.title}</option>)}
          </Select>
        </div>
      </section>

      <Table className="min-w-[900px]" stickyHeader>
        <Thead>
          <Tr>
            <Th>№</Th>
            {sh.cols.map((c) => (
              <Th key={c.id} title={c.hint}>
                <div className="font-mono text-[11px] text-neutral-400">{c.letter}{c.id === sh.unitCol ? " · в закупку" : ""}{c.id === sh.qtyCol && c.id !== QTY_COL ? " · кол-во" : ""}</div>
                {c.title}{c.kind === "custom" && c.unit && !c.title.includes(c.unit) ? `, ${c.unit}` : ""}
              </Th>
            ))}
            {!ro && <Th />}
          </Tr>
        </Thead>
        <Tbody>
          {p.rows.map((r, i) => (
            <Tr key={r._id ?? i}>
              <Td className="text-neutral-500">{i + 1}</Td>
              {sh.cols.map((c) => {
                if (c.kind === "input") {
                  return (
                    <Td key={c.id} className="p-1">
                      <input value={r[c.id] ?? ""} readOnly={ro} inputMode={c.text ? "text" : "decimal"} onChange={(e) => setCell(i, c.id, e.target.value)}
                        style={{ width: c.text ? 110 : 80 }} className="h-8 rounded border border-neutral-200 bg-white px-1.5 text-sm tabular-nums read-only:border-transparent read-only:bg-transparent" />
                    </Td>
                  );
                }
                const cell = sh.cells[c.id]?.[i];
                const ovr = p.overrides?.[r._id]?.[c.id];
                const editable = !ro && (c.kind === "custom" || c.id === UNIT_COL);
                if (!sh.used[i]) return <Td key={c.id} />;
                return (
                  <Td key={c.id} className={`p-1 ${cell?.manual ? "bg-amber-50" : ""}`}>
                    {editable ? (
                      <div className="flex items-center gap-1">
                        <input
                          value={ovr !== undefined ? ovr : fmt(cell?.v)}
                          title={cell?.err ?? (cell?.manual ? "вручную" : "по формуле")}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setOverride(r._id, c.id, e.target.value)}
                          inputMode="decimal"
                          className={`h-8 w-28 rounded border px-1.5 text-right text-sm tabular-nums ${cell?.err ? "border-red-300 bg-red-50 text-red-700" : "border-neutral-200 bg-white"}`}
                        />
                        {cell?.manual && <button type="button" className="text-xs text-blue-700" title="Вернуть формулу" onClick={() => setOverride(r._id, c.id, null)}>↩ вручную</button>}
                      </div>
                    ) : (
                      <span className={`block px-1.5 text-right tabular-nums ${cell?.err ? "text-red-700" : ""}`} title={cell?.err}>{cell?.err ? "ошибка" : fmt(c.id === "total" ? t.calcs[i].totalRub : cell?.v)}{cell?.manual ? " (вручную)" : ""}</span>
                    )}
                    {cell?.err && <div className="max-w-[200px] text-[11px] leading-tight text-red-600">{cell.err}</div>}
                  </Td>
                );
              })}
              {!ro && <Td className="p-1"><button type="button" className="px-2 text-neutral-400 hover:text-red-600" title="Убрать строку" onClick={() => setP((x) => ({ ...x, rows: x.rows.filter((_, j) => j !== i) }))}>×</button></Td>}
            </Tr>
          ))}
          <Tr className="bg-neutral-50 font-semibold">
            <Td>Итого</Td>
            {sh.cols.map((c) => {
              const s = c.id === "total" ? { v: t.totalRub } : sh.sums[c.id];
              return <Td key={c.id} className="text-right tabular-nums" title={s?.err}>{s ? (s.err ? <span className="text-red-600">ошибка</span> : fmt(s.v)) : ""}</Td>;
            })}
            {!ro && <Td />}
          </Tr>
        </Tbody>
      </Table>
    </div>
  );
}
