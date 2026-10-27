"use client";

import { Clamp } from "@/components/clamp";
import { InfoHint } from "@/components/info-hint";
import { useRef, useState, type ClipboardEvent, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { QTY_COL, UNIT_COL, checkDiffs, rowFilled, columnUsers, newId, paramList, paramNameProblem, remapCustomRefs, syncLetters, type CalcPayload, type CalcTotals, type CustomCol, type SheetCol } from "@/lib/supplier-calc";
import { applySheetTable, findHeaderRow, parseClipboardTable, type PasteResult } from "@/lib/sheet-paste";
import { readCalcTable } from "./actions";
import { FormulaBar } from "./formula-bar";
import { ColumnEditor, draftFrom, draftProblem, newDraft, type Draft } from "./column-editor";

const fmt = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "" : n.toLocaleString("ru-RU", { maximumFractionDigits: 4 }));

/**
 * Единая таблица расчёта «как в Excel»: строка букв, строка названий, лоты, итог; шапка и первый столбец закреплены.
 * Белые ячейки — ввод, серые — формулы (вписанное вручную помечено), клик по названию своего столбца открывает конструктор формулы.
 * Tab/Enter/стрелки переходят по ячейкам, вставка из Excel заполняет столбцы ввода.
 */
export function CalcDetail({ p, setP, t, ro, lockReason }: { p: CalcPayload; setP: Dispatch<SetStateAction<CalcPayload>>; t: CalcTotals; ro: boolean; lockReason?: string | null }) {
  const sh = t.sheet;
  const isSheet = p.format === "SHEET";
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pname, setPname] = useState("");
  const [pval, setPval] = useState("");
  const [perr, setPerr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [report, setReport] = useState<PasteResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [act, setAct] = useState<{ i: number; id: string } | null>(null);
  const params = paramList(p);
  const customIds = new Set((p.customColumns ?? []).map((c) => c.id));

  const setOverride = (rowId: string, colId: string, v: string | null) =>
    setP((x) => {
      const o = { ...(x.overrides ?? {}) };
      const r = { ...(o[rowId] ?? {}) };
      if (v === null) delete r[colId]; else r[colId] = v;
      if (Object.keys(r).length) o[rowId] = r; else delete o[rowId];
      return { ...x, overrides: o };
    });
  const setCell = (i: number, k: string, v: string) => setP((x) => ({ ...x, rows: x.rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  const newRow = () => setP((x) => ({ ...x, rows: [...x.rows, { ...Object.fromEntries(Object.keys(x.rows[0] ?? {}).filter((k) => !k.startsWith("_")).map((k) => [k, ""])), _id: newId(), invoice: x.header.invoice, dest: x.header.dest }] }));

  const saveDraft = (d: Draft): string | null => {
    const prob = draftProblem(d);
    if (prob) return prob;
    setP((x) => {
      const cols = x.customColumns ?? [];
      const base = {
        title: d.title.trim(), unit: d.unit.trim(), kind: d.kind, text: d.kind === "input" ? d.text : undefined,
        formula: d.kind === "formula" ? d.formula.trim() : "",
        rules: d.kind === "formula" && d.rules.length ? d.rules.filter((r) => r.formula.trim()).map((r) => ({ ...r, formula: r.formula.trim() })) : undefined,
        total: d.total === "sum" ? undefined : d.total,
      };
      const next: CustomCol[] = d.id
        ? cols.map((c) => (c.id === d.id ? { ...c, ...base } : c))
        : [...cols, { id: newId("c"), letter: "", ...base }];
      return syncLetters({ ...x, customColumns: next });
    });
    setDraft(null);
    return null;
  };
  const removeCol = (c: CustomCol) => {
    const users = columnUsers(p, c.id);
    if (users.length) return setNote(`Столбец «${c.title}» нельзя удалить: на него ссылается формула столбца «${users.join("», «")}».`);
    if (!confirm(`Удалить столбец «${c.title}»?`)) return;
    setNote(null);
    setDraft(null);
    setP((x) => remapCustomRefs(x, {
      ...x,
      customColumns: (x.customColumns ?? []).filter((y) => y.id !== c.id),
      unitCostColumn: x.unitCostColumn === c.id ? undefined : x.unitCostColumn,
      qtyColumn: x.qtyColumn === c.id ? undefined : x.qtyColumn,
      priceColumn: x.priceColumn === c.id ? undefined : x.priceColumn,
      overrides: Object.fromEntries(Object.entries(x.overrides ?? {}).map(([rid, o]) => [rid, Object.fromEntries(Object.entries(o).filter(([k]) => k !== c.id))])),
    }));
  };
  /** Сдвиг своего столбца влево/вправо (и перетаскивание): ссылки в формулах переезжают на новые буквы. */
  const moveCol = (id: string, toId: string) => {
    if (id === toId) return;
    setP((x) => {
      const cols = [...(x.customColumns ?? [])];
      const a = cols.findIndex((c) => c.id === id), b = cols.findIndex((c) => c.id === toId);
      if (a < 0 || b < 0) return x;
      const [m] = cols.splice(a, 1);
      cols.splice(b, 0, m);
      return remapCustomRefs(x, { ...x, customColumns: cols });
    });
  };
  const addParam = () => {
    const prob = paramNameProblem(pname, [...params.map((q) => q.name)]);
    if (prob) return setPerr(prob);
    setPerr(null);
    setP((x) => ({ ...x, params: [...(x.params ?? []), { name: pname.trim().replace(/\s+/g, "_"), value: pval }] }));
    setPname(""); setPval("");
  };

  /** Таблица из Excel (буфер или файл) → лоты по заголовкам столбцов; сверка с формулами показывается в отчёте. */
  const applyTable = (table: string[][], replace: boolean) => {
    const r = applySheetTable(p, table, { replace });
    if ("error" in r) { setNote(r.error); setReport(null); return false; }
    setP(r.payload);
    setReport(r);
    setNote(null);
    return true;
  };
  const fillDown = (r: number, ci: number) => {
    const col = sh.cols[ci];
    if (!col || col.kind !== "input") return;
    const v = p.rows[r]?.[col.id] ?? "";
    setP((x) => ({ ...x, rows: x.rows.map((row, j) => (j > r && rowFilled(row) ? { ...row, [col.id]: v } : row)) }));
    setNote(`Значение «${v}» скопировано вниз по столбцу ${col.letter} (во все заполненные строки ниже).`);
  };
  const filledRows = p.rows.some(rowFilled);
  const uploadTable = async (f: File) => {
    const fd = new FormData();
    fd.set("file", f);
    const res = await readCalcTable(fd);
    if (res.error || !res.table) return setNote(res.error ?? "Не удалось прочитать файл");
    applyTable(res.table, !filledRows);
  };
  const rowParamList = p.rows.flatMap((row, i) => Object.entries(row).filter(([k, v]) => k.startsWith("@") && v.trim() !== "").map(([k, v]) => ({ i, k, v, name: k.slice(1) })));

  // ------------------------------------------------------------------------------------ клавиатура и вставка
  const focusCell = (r: number, c: number) => {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`[data-cell="${r}-${c}"]`);
    if (el) { el.focus(); el.select?.(); return true; }
    return false;
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "в")) { e.preventDefault(); fillDown(r, c); }
    else if (e.key === "Enter") { e.preventDefault(); focusCell(e.shiftKey ? r - 1 : r + 1, c); }
    else if (e.key === "ArrowDown") { e.preventDefault(); focusCell(r + 1, c); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusCell(r - 1, c); }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>, r: number, ci: number) => {
    const text = e.clipboardData.getData("text");
    if (!/[\t\n]/.test(text.replace(/\n$/, ""))) return; // одно значение — обычная вставка
    e.preventDefault();
    const tbl = parseClipboardTable(text);
    if (isSheet && findHeaderRow(tbl) >= 0) { applyTable(tbl, !filledRows); return; }
    const grid = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    const inputs = sh.cols.slice(ci).filter((c) => c.kind === "input");
    if (inputs.length === 0) return setNote("С этой ячейки вправо нет столбцов ввода — формулы вставкой не затираются.");
    setP((x) => {
      const rows = [...x.rows];
      grid.forEach((cells, gi) => {
        const ri = r + gi;
        while (rows.length <= ri) rows.push({ _id: newId(), invoice: x.header.invoice, dest: x.header.dest });
        const row = { ...rows[ri] };
        cells.forEach((v, gj) => { const col = inputs[gj]; if (col) row[col.id] = col.text ? v.trim() : v.replace(/[\s  ]/g, "").replace(/[₽$€]/g, ""); });
        rows[ri] = row;
      });
      return { ...x, rows };
    });
    setNote(`Вставлено строк: ${grid.length}, столбцов: ${Math.min(inputs.length, Math.max(...grid.map((g) => g.length)))}. Формулы остались на месте.`);
  };

  const unitChoices = sh.cols.filter((c) => (isSheet ? !c.text : c.kind !== "input") && c.id !== "total" && c.id !== "unitUsd");
  const qtyChoices = sh.cols.filter((c) => !c.text && c.kind !== "calc");
  const checks = checkDiffs(p, sh);
  const sumCols = sh.cols.filter((s) => sh.sums[s.id]);

  const headerCell = (c: SheetCol) => {
    const custom = customIds.has(c.id);
    return (
      <th key={c.id} draggable={custom && !ro} onDragStart={() => setDragId(c.id)} onDragOver={(e) => { if (dragId && custom) e.preventDefault(); }}
        onDrop={() => { if (dragId) moveCol(dragId, c.id); setDragId(null); }}
        className={`sticky top-[26px] z-20 min-w-[96px] border-b border-r border-neutral-300 px-2 py-1 text-left align-bottom text-xs font-semibold leading-tight ${custom ? "bg-sky-50 hover:bg-sky-100" : "bg-neutral-100"}`}
        title={custom ? "Нажмите, чтобы открыть конструктор формулы; можно перетащить" : c.hint}>
        <button type="button" disabled={!custom || ro} onClick={() => { const cc = (p.customColumns ?? []).find((x) => x.id === c.id); if (cc) setDraft(draftFrom(cc)); }} className="block w-full text-left disabled:cursor-default">
          {c.title}{c.unit && !c.title.includes(c.unit) ? <span className="font-normal text-neutral-500">, {c.unit}</span> : null}
          {c.kind !== "input" && c.formula ? <span className="block max-w-[200px] truncate text-[11px] font-normal text-neutral-400">{c.formula.replace(/^=/, "= ")}{c.rules?.length ? ` (+${c.rules.length} прав.)` : ""}</span> : null}
        </button>
      </th>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-1.5 text-sm text-neutral-600">Как заполнять<InfoHint label="Как заполнять таблицу">Таблица как в Excel: у каждого столбца своя буква. Белые ячейки заполняете вы, серые считаются по формуле (можно вписать значение вручную — ячейка пометится). Нажмите на название своего столбца (голубой), чтобы поменять формулу.</InfoHint></p>

      <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">Параметры<InfoHint label="Параметры для формул">Числа (курс, ставки), которые можно писать в формулах по имени. {isSheet ? "Для отдельной строки значение можно задать своё." : "Ставки формата берутся из блока «Ставки расчёта» на вкладке «Расчёт»."}</InfoHint></h2>
        {!isSheet && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {params.filter((q) => !q.own).map((q) => <span key={q.name} className="rounded-full bg-neutral-100 px-2 py-0.5" title={q.label}>{q.name}</span>)}
          </div>
        )}
        {(p.params ?? []).map((q, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input className="w-56 font-mono" value={q.name} readOnly={ro} onChange={(e) => setP((x) => ({ ...x, params: (x.params ?? []).map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))} />
            <Input className="w-40" inputMode="decimal" value={q.value} readOnly={ro} placeholder="значение" onChange={(e) => setP((x) => ({ ...x, params: (x.params ?? []).map((y, j) => (j === i ? { ...y, value: e.target.value } : y)) }))} />
            {(q.label || q.hint) && <span className="max-w-xs text-xs text-neutral-500"><Clamp>{q.label}{q.hint ? ` — например: ${q.hint}` : ""}</Clamp></span>}
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
          <Button type="button" size="sm" variant="outline" onClick={() => setDraft(newDraft("formula"))}>+ Столбец с формулой</Button>
          {isSheet && <Button type="button" size="sm" variant="outline" onClick={() => setDraft(newDraft("input"))}>+ Столбец для ввода</Button>}
          <Button type="button" size="sm" variant="outline" onClick={newRow}>+ Лот</Button>
          {isSheet && <Button type="button" size="sm" variant="outline" onClick={() => setPasteOpen((v) => !v)}>Вставить таблицу из Excel</Button>}
          {isSheet && (<>
            <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt,.tsv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadTable(f); e.target.value = ""; }} />
            <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>Загрузить файл Excel</Button>
          </>)}
          <span className="text-xs text-neutral-500">Скопируйте из Excel строки вместе с заголовками (invoice, lot, quantity, Закупка…) и вставьте (Ctrl+V) в любую ячейку — столбцы найдутся по названиям. Ctrl+D — копировать значение вниз.</span>
        </div>
      )}
      {pasteOpen && !ro && isSheet && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-neutral-300 p-3">
          <Label>Вставьте сюда таблицу из Excel (с заголовками)</Label>
          <textarea className="min-h-24 w-full rounded-md border border-neutral-300 p-2 font-mono text-xs" rows={5} value={pasteText} onChange={(e) => setPasteText(e.target.value)} autoFocus
            onPaste={(e) => { const tx = e.clipboardData.getData("text"); if (findHeaderRow(parseClipboardTable(tx)) >= 0) { e.preventDefault(); if (applyTable(parseClipboardTable(tx), !filledRows)) { setPasteOpen(false); setPasteText(""); } } }} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => { if (applyTable(parseClipboardTable(pasteText), false)) { setPasteOpen(false); setPasteText(""); } }}>{filledRows ? "Добавить к лотам" : "Вставить"}</Button>
            {filledRows && <Button type="button" size="sm" variant="outline" onClick={() => { if (confirm("Заменить все лоты таблицей из буфера?") && applyTable(parseClipboardTable(pasteText), true)) { setPasteOpen(false); setPasteText(""); } }}>Заменить все лоты</Button>}
            <Button type="button" size="sm" variant="ghost" onClick={() => { setPasteOpen(false); setPasteText(""); }}>Отмена</Button>
          </div>
        </div>
      )}
      {report && (
        <div role="status" className="flex flex-col gap-1 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm">
          <p className="font-medium">{report.notes.join(" ")} Распознаны столбцы: {report.mapped.join(", ")}.</p>
          {report.skipped.length > 0 && <p className="text-xs text-neutral-600">Не использованы (считаются у нас по формулам формата или не нужны): {report.skipped.join(", ")}.</p>}
          {report.checks.length > 0 && (
            <p className="text-xs">Сверка с вашим файлом по итогам столбцов: {report.checks.map((x) => `${x.title.replace(/ \(в файле [A-Z]+\)/, "")} — ${x.ok ? "совпало" : `в файле ${fmt(x.file)}, у нас ${fmt(x.ours)} — проверьте`}`).join("; ")}.</p>
          )}
          {report.rowParams.length > 0 && <p className="text-xs text-neutral-700">В файле у некоторых лотов другие значения, чем в шапке — записаны для этих строк: {report.rowParams.join("; ")}.</p>}
          {report.manualCells > 0 && <p className="text-xs text-amber-800">Ячеек со значением «вручную» из файла: {report.manualCells} (жёлтые).</p>}
          <div><button type="button" className="text-xs text-neutral-500 underline" onClick={() => setReport(null)}>скрыть</button></div>
        </div>
      )}
      {draft && !ro && (
        <ColumnEditor
          draft={draft} setDraft={setDraft} p={p} cols={sh.cols} canInput={isSheet}
          manualCount={draft.id ? Object.values(p.overrides ?? {}).filter((o) => o[draft.id!] !== undefined).length : 0}
          onSave={saveDraft} onCancel={() => setDraft(null)}
          onApplyAll={draft.id ? () => setP((x) => ({ ...x, overrides: Object.fromEntries(Object.entries(x.overrides ?? {}).map(([rid, o]) => [rid, Object.fromEntries(Object.entries(o).filter(([k]) => k !== draft.id))])) })) : undefined}
        />
      )}
      {note && <p className="text-sm text-neutral-700">{note}</p>}
      {rowParamList.length > 0 && (
        <details className="text-xs text-neutral-600" open={rowParamList.length <= 4}>
          <summary className="cursor-pointer py-2 font-semibold max-md:py-3.5">Свои значения в строках ({rowParamList.length})</summary>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {rowParamList.map((x) => (
            <span key={x.i + x.k} className="inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5">
              строка {x.i + 1}: {x.name} = {x.v.replace(".", ",")}
              {!ro && <button type="button" className="text-neutral-400 hover:text-red-600" title="Вернуть значение из шапки" onClick={() => setP((y) => ({ ...y, rows: y.rows.map((row, j) => { if (j !== x.i) return row; const n = { ...row }; delete n[x.k]; return n; }) }))}>×</button>}
            </span>
          ))}
          </div>
        </details>
      )}

      {(p.customColumns ?? []).length > 0 && !ro && (
        <section className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600">
          <span className="font-semibold">Свои столбцы:</span>
          {(p.customColumns ?? []).map((c) => {
            const col = sh.cols.find((x) => x.id === c.id)!;
            return (
              <span key={c.id} className="inline-flex items-center gap-1">
                <span className="rounded bg-neutral-100 px-1 font-mono">{col.letter}</span>{c.title}
                {sh.colErrors[c.id] && <span className="text-red-600">({sh.colErrors[c.id]})</span>}
                <button type="button" className="underline" onClick={() => setDraft(draftFrom(c))}>править</button>
                <button type="button" className="text-neutral-400 hover:text-red-600" onClick={() => removeCol(c)}>удалить</button>
              </span>
            );
          })}
        </section>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label>Себестоимость за единицу, ₽ (идёт в закупку при приёме)</Label>
          <Select value={sh.unitCol} disabled={ro} onChange={(e) => setP((x) => ({ ...x, unitCostColumn: e.target.value === UNIT_COL ? undefined : e.target.value || undefined }))}>
            {isSheet && <option value="">— выберите столбец —</option>}
            {unitChoices.map((c) => <option key={c.id} value={c.id}>{c.letter} — {c.title}</option>)}
          </Select>
        </div>
        <div>
          <Label>Количество</Label>
          <Select value={sh.qtyCol} disabled={ro} onChange={(e) => setP((x) => ({ ...x, qtyColumn: e.target.value === QTY_COL ? undefined : e.target.value || undefined }))}>
            {isSheet && <option value="">— выберите столбец —</option>}
            {qtyChoices.map((c) => <option key={c.id} value={c.id}>{c.letter} — {c.title}</option>)}
          </Select>
        </div>
        {isSheet && (
          <div>
            <Label>Закупка за шкуру (молоток) — для приёма</Label>
            <Select value={p.priceColumn ?? ""} disabled={ro} onChange={(e) => setP((x) => ({ ...x, priceColumn: e.target.value || undefined }))}>
              <option value="">— выберите столбец —</option>
              {qtyChoices.map((c) => <option key={c.id} value={c.id}>{c.letter} — {c.title}</option>)}
            </Select>
          </div>
        )}
      </section>

      <FormulaBar p={p} setP={setP} sh={sh} act={act} ro={ro} lockReason={lockReason ?? null} fillInput={fillDown} />
      <div ref={tableRef} className="table-keep scroll-hint max-h-[75vh] overflow-auto rounded-lg border border-neutral-300 bg-white">
        <table className="border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 min-w-[44px] border-b border-r border-neutral-300 bg-neutral-200 px-2 py-1 text-center text-[11px] font-normal text-neutral-500" />
              {sh.cols.map((c) => (
                <th key={c.id} className="sticky top-0 z-20 border-b border-r border-neutral-300 bg-neutral-200 px-2 py-1 text-center font-mono text-[11px] font-normal text-neutral-600">
                  {c.letter}
                  {c.id === sh.unitCol && <span className="ml-1 rounded bg-emerald-200 px-1 text-[11px] text-emerald-900">в закупку</span>}
                  {c.id === sh.qtyCol && c.id !== QTY_COL && <span className="ml-1 rounded bg-sky-200 px-1 text-[11px] text-sky-900">кол-во</span>}
                  {customIds.has(c.id) && !ro && (
                    <span className="ml-1 whitespace-nowrap">
                      <button type="button" title="Сдвинуть влево" className="px-0.5 text-neutral-500 hover:text-neutral-900" onClick={() => { const cs = p.customColumns ?? []; const k = cs.findIndex((x) => x.id === c.id); if (k > 0) moveCol(c.id, cs[k - 1].id); }}>◀</button>
                      <button type="button" title="Сдвинуть вправо" className="px-0.5 text-neutral-500 hover:text-neutral-900" onClick={() => { const cs = p.customColumns ?? []; const k = cs.findIndex((x) => x.id === c.id); if (k >= 0 && k < cs.length - 1) moveCol(c.id, cs[k + 1].id); }}>▶</button>
                    </span>
                  )}
                </th>
              ))}
              {!ro && <th className="sticky top-0 z-20 border-b border-neutral-300 bg-neutral-200 px-1" />}
            </tr>
            <tr>
              <th className="sticky left-0 top-[26px] z-30 border-b border-r border-neutral-300 bg-neutral-100 px-2 py-1 text-center text-[11px] font-normal text-neutral-500">№</th>
              {sh.cols.map(headerCell)}
              {!ro && <th className="sticky top-[26px] z-20 border-b border-neutral-300 bg-neutral-100 px-1" />}
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r, i) => (
              <tr key={r._id ?? i}>
                <td className="sticky left-0 z-10 border-b border-r border-neutral-200 bg-neutral-100 px-2 py-1 text-center text-xs text-neutral-500">{i + 1}</td>
                {sh.cols.map((c, ci) => {
                  if (c.kind === "input") {
                    return (
                      <td key={c.id} className="border-b border-r border-neutral-200 bg-white p-0">
                        <input data-cell={`${i}-${ci}`} value={r[c.id] ?? ""} readOnly={ro} inputMode={c.text ? "text" : "decimal"}
                          onChange={(e) => setCell(i, c.id, e.target.value)} onKeyDown={(e) => onKey(e, i, ci)} onPaste={(e) => onPaste(e, i, ci)} onFocus={(e) => { e.target.select(); setAct({ i, id: c.id }); }}
                          style={{ width: c.text ? 120 : 96 }} className={`h-8 border-0 bg-transparent px-2 text-sm outline-none focus:bg-sky-50 focus:ring-2 focus:ring-inset focus:ring-sky-400 ${c.text ? "" : "text-right tabular-nums"}`} />
                      </td>
                    );
                  }
                  const cell = sh.cells[c.id]?.[i];
                  const ovr = p.overrides?.[r._id]?.[c.id];
                  const editable = !ro && (c.kind === "custom" || c.id === UNIT_COL);
                  if (!sh.used[i]) return <td key={c.id} className="border-b border-r border-neutral-200 bg-neutral-50" />;
                  const isAct = act?.i === i && act.id === c.id;
                  return (
                    <td key={c.id} className={`border-b border-r border-neutral-200 p-0 ${isAct ? "outline outline-2 -outline-offset-2 outline-sky-400" : ""} ${cell?.manual ? "bg-amber-100" : "bg-neutral-100"} ${editable ? "hover:bg-sky-50" : ""}`}>
                      {editable ? (
                        <div className="flex items-center">
                          <input data-cell={`${i}-${ci}`} value={ovr !== undefined ? ovr : fmt(cell?.v)} title={cell?.err ?? (cell?.manual ? "Вручную. Нажмите, чтобы изменить; «↩» вернёт формулу" : "По формуле. Нажмите, чтобы изменить значение")}
                            onFocus={(e) => { e.target.select(); setAct({ i, id: c.id }); }} onChange={(e) => setOverride(r._id, c.id, e.target.value)} onKeyDown={(e) => onKey(e, i, ci)} inputMode="decimal"
                            style={{ width: 104 }} className={`h-8 cursor-text border-0 bg-transparent px-2 text-right text-sm tabular-nums outline-none ${cell?.err ? "bg-red-50 text-red-700" : ""}`} />
                          {cell?.manual && <button type="button" className="inline-flex min-h-8 items-center px-1.5 text-[11px] text-blue-700 max-md:min-h-11" title="Вернуть формулу" onClick={() => setOverride(r._id, c.id, null)}>↩</button>}
                        </div>
                      ) : (
                        <button type="button" data-cell={`${i}-${ci}`} onClick={() => setAct({ i, id: c.id })} onFocus={() => setAct({ i, id: c.id })} onKeyDown={(e) => onKey(e as unknown as KeyboardEvent<HTMLInputElement>, i, ci)}
                          title={cell?.err ?? (ro ? "Нажмите, чтобы увидеть формулу" : "Считается по формуле формата, править нельзя; формула — в строке над таблицей")}
                          className={`block min-h-8 w-full cursor-default px-2 py-1 text-right tabular-nums outline-none ${cell?.err ? "text-red-700" : ""}`}>{cell?.err ? "ошибка" : fmt(c.id === "total" ? t.calcs[i].totalRub : cell?.v)}</button>
                      )}
                      {cell?.err && <div className="max-w-[200px] px-2 pb-1 text-[11px] leading-tight text-red-600">{cell.err}</div>}
                    </td>
                  );
                })}
                {!ro && <td className="border-b border-neutral-200 bg-white px-1"><button type="button" className="px-1 text-neutral-400 hover:text-red-600" title="Убрать строку" onClick={() => setP((x) => ({ ...x, rows: x.rows.filter((_, j) => j !== i) }))}>×</button></td>}
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="sticky bottom-0 left-0 z-20 border-r border-t-2 border-neutral-400 bg-neutral-200 px-2 py-1 text-center text-xs">Итого</td>
              {sh.cols.map((c) => {
                const s = c.id === "total" ? { v: t.totalRub } : sh.sums[c.id];
                return <td key={c.id} className="sticky bottom-0 z-10 border-r border-t-2 border-neutral-400 bg-neutral-200 px-2 py-1 text-right tabular-nums" title={s?.err}>{s ? (s.err ? <span className="text-red-600">ошибка</span> : fmt(s.v)) : ""}</td>;
              })}
              {!ro && <td className="sticky bottom-0 z-10 border-t-2 border-neutral-400 bg-neutral-200" />}
            </tr>
          </tbody>
        </table>
      </div>

      <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">Контрольная разность<InfoHint label="Контрольная разность">Разность двух итогов, например «Итого по расчёту» минус «Итого в УПД»: должна быть в пределах допуска (копейки на округление).</InfoHint></h2>
        {(p.checks ?? []).map((c, i) => {
          const r = checks[i];
          const upd = (patch: Partial<typeof c>) => setP((x) => ({ ...x, checks: (x.checks ?? []).map((y, j) => (j === i ? { ...y, ...patch } : y)) }));
          return (
            <div key={c.id} className="flex flex-wrap items-end gap-2">
              <div><Label>Название</Label><Input className="w-48" value={c.title} readOnly={ro} onChange={(e) => upd({ title: e.target.value })} /></div>
              <div><Label>Итог столбца</Label><Select className="w-44" value={c.a} disabled={ro} onChange={(e) => upd({ a: e.target.value })}><option value="">–</option>{sumCols.map((s) => <option key={s.id} value={s.letter}>{s.letter} — {s.title.slice(0, 24)}</option>)}</Select></div>
              <div><Label>минус итог столбца</Label><Select className="w-44" value={c.b} disabled={ro} onChange={(e) => upd({ b: e.target.value })}><option value="">–</option>{sumCols.map((s) => <option key={s.id} value={s.letter}>{s.letter} — {s.title.slice(0, 24)}</option>)}</Select></div>
              <div><Label>Допуск</Label><Input className="w-24" inputMode="decimal" value={c.tol} readOnly={ro} onChange={(e) => upd({ tol: e.target.value })} /></div>
              <span className={`pb-2 text-sm ${r?.ok ? "text-emerald-700" : "text-red-600"}`}>{r?.diff == null ? r?.note : `${fmt(r.diff)} ${r.ok ? "— в допуске" : "— больше допуска"}`}</span>
              {!ro && <button type="button" className="px-2 pb-2 text-neutral-400 hover:text-red-600" onClick={() => setP((x) => ({ ...x, checks: (x.checks ?? []).filter((_, j) => j !== i) }))}>×</button>}
            </div>
          );
        })}
        {!ro && <div><Button type="button" size="sm" variant="outline" onClick={() => setP((x) => ({ ...x, checks: [...(x.checks ?? []), { id: newId("k"), title: "Контроль", a: "", b: "", tol: "0,01" }] }))}>+ Контрольная разность</Button></div>}
      </section>
    </div>
  );
}
