"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import {
  ALL_FIELDS,
  EMPTY_ROW,
  applyMapping,
  detectColumns,
  parsePasteTable,
  percentColumns,
  type ColorDecision,
  type Decisions,
  type FieldKey,
  type FurDecision,
  type IntakeRow,
  type Mapping,
  type RowCheck,
  type ValidationResult,
} from "@/lib/batch-intake";
import { parseIntakeFile } from "./actions";
import type { TableInfo, WizardRefs } from "./shared";

const cell = "h-8 w-full rounded border border-neutral-300 bg-white px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400";

type Props = {
  refs: WizardRefs;
  rows: IntakeRow[];
  setRows: (r: IntakeRow[] | ((p: IntakeRow[]) => IntakeRow[])) => void;
  nextN: number;
  setNextN: (n: number) => void;
  info: TableInfo | null;
  setInfo: (i: TableInfo | null) => void;
  decisions: Decisions;
  setDecisions: (d: Decisions) => void;
  setPct: (p: Partial<Record<"fee" | "broker", boolean>>) => void;
  validation: ValidationResult;
  currencyHint: (cur: string | null, rate: string | null) => void;
  can: { materials: boolean; colors: boolean };
};

export function LotsStep(p: Props) {
  const { refs, rows, setRows, info, validation, decisions, setDecisions } = p;
  const [mode, setMode] = useState<"file" | "paste" | "manual">("file");
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const checkOf = new Map<number, RowCheck>(validation.checks.map((c) => [c.n, c]));

  const hasCalc = info ? (["fee", "dressing", "transport", "broker", "transit"] as FieldKey[]).some((k) => info.mapping[k] !== undefined) : false;
  const showInvoice = rows.some((r) => r.invoice.trim()) || (info?.mapping.invoice !== undefined);

  function load(table: string[][], fileName: string | null) {
    if (rows.length > 0 && !window.confirm(`Заменить ${rows.length} строк в таблице новыми данными?`)) return;
    const det = detectColumns(table);
    const data = applyMapping(table, det.headerIdx, det.mapping, 1);
    p.setRows(data);
    p.setNextN(data.length + 1);
    p.setPct(percentColumns(table, det.headerIdx, det.mapping));
    p.setDecisions({ fur: {}, color: {} });
    const found = Object.keys(det.mapping).length;
    p.setInfo({
      fileName,
      headers: det.headers,
      headerIdx: det.headerIdx,
      mapping: det.mapping,
      table,
      note: det.headerIdx >= 0 ? `Шапка найдена в строке ${det.headerIdx + 1}, распознано столбцов: ${found}.` : "Шапки нет — столбцы взяты по порядку: Лот, Мех, Цвет, Размер/сорт, Кол-во, Цена, Валюта, НДС.",
    });
    const rateCol = det.mapping.rate;
    let rate: string | null = null;
    if (rateCol !== undefined) {
      const vals = [...new Set(data.map((r) => r.rate).filter(Boolean))];
      if (vals.length === 1) rate = vals[0];
    }
    p.currencyHint(det.currencyHint, rate);
    setMsg({ text: `Загружено строк: ${data.length}. ${det.headerIdx >= 0 ? `Шапка найдена, столбцов: ${found}.` : "Шапки нет — столбцы по порядку."}`, error: false });
  }

  function onFile(f: File | undefined) {
    if (!f) return;
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set("file", f);
      let res;
      try {
        res = await parseIntakeFile(fd);
      } catch {
        setMsg({ text: "Не удалось отправить файл. Проверьте соединение и повторите.", error: true });
        return;
      }
      if ("error" in res) return setMsg({ text: res.error, error: true });
      load(res.table, res.fileName);
      if (res.truncated) setMsg({ text: "Файл большой: прочитаны первые 3000 строк.", error: false });
    });
  }

  function remap(k: FieldKey, col: string) {
    if (!info) return;
    const mapping: Mapping = { ...info.mapping };
    if (col === "") delete mapping[k];
    else mapping[k] = Number(col);
    if (!window.confirm("Столбцы будут разобраны заново — ручные правки в таблице потеряются. Продолжить?")) return;
    const data = applyMapping(info.table, info.headerIdx, mapping, 1);
    setRows(data);
    p.setNextN(data.length + 1);
    p.setPct(percentColumns(info.table, info.headerIdx, mapping));
    p.setInfo({ ...info, mapping });
  }

  function patch(n: number, k: keyof IntakeRow, v: string) {
    setRows((prev) => prev.map((r) => (r.n === n ? { ...r, [k]: v } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, { n: p.nextN, ...EMPTY_ROW }]);
    p.setNextN(p.nextN + 1);
  }
  function delRow(n: number) {
    setRows((prev) => prev.filter((r) => r.n !== n));
  }

  const qty = rows.reduce((s, r) => s + (Number(r.qty.replace(/\s/g, "").replace(",", ".")) || 0), 0);
  const errRows = validation.checks.filter((c) => c.errors.length > 0).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1 border-b border-neutral-200 pb-2" role="tablist">
        {(
          [
            ["file", "Загрузить файл"],
            ["paste", "Вставить из таблицы"],
            ["manual", "Ввести вручную"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={mode === k}
            onClick={() => setMode(k)}
            className={"rounded-md px-3 py-1.5 text-sm " + (mode === k ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100")}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "file" && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-neutral-600">
            Файл с расчётом лотов или каталогом: Excel (.xlsx) или CSV/TXT. Столбцы распознаются по шапке: лот, мех, цвет, размер/сорт, количество, цена (молоток), валюта, НДС, счёт; если есть столбцы расчёта (аукционный сбор, выделка, транспорт, брокерский) — стоимость лота считается по ним.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt,.tsv" aria-label="Файл с лотами" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} className="text-sm" disabled={pending} />
            {pending && <span className="text-xs text-neutral-500">Читаем файл…</span>}
          </div>
        </div>
      )}
      {mode === "paste" && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-neutral-600">Скопируйте строки в Excel или Google-таблице и вставьте сюда (вместе с шапкой или без). Без шапки столбцы идут по порядку: Лот, Мех, Цвет, Размер/сорт, Кол-во, Цена, Валюта, НДС.</p>
          <Textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Лот\tМех\tЦвет\tРазмер\tКол-во\tЦена\n101\tСоболь\tЧёрный\tXL\t30\t360"} aria-label="Вставка из таблицы" />
          <div>
            <Button type="button" variant="outline" size="sm" disabled={!paste.trim()} onClick={() => { load(parsePasteTable(paste), null); setPaste(""); }}>
              Разобрать вставленное
            </Button>
          </div>
        </div>
      )}
      {mode === "manual" && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-neutral-600">Добавляйте строки кнопкой ниже и заполняйте прямо в таблице.</p>
          <div>
            <Button type="button" variant="outline" size="sm" onClick={addRow}>+ Добавить строку</Button>
          </div>
        </div>
      )}

      {msg && <p className={"rounded-md px-3 py-2 text-sm " + (msg.error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800")}>{msg.text}</p>}

      {info && info.table.length > 0 && (
        <details className="rounded-md border border-neutral-200 px-3 py-2 text-sm">
          <summary className="cursor-pointer text-neutral-700">
            Столбцы файла{info.fileName ? ` «${info.fileName}»` : ""}: {info.note} <span className="text-neutral-500">(изменить)</span>
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {ALL_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-0.5 text-xs text-neutral-600">
                {f.label}
                <select
                  className="h-8 rounded border border-neutral-300 bg-white px-1 text-xs text-neutral-900"
                  value={info.mapping[f.key] ?? ""}
                  onChange={(e) => remap(f.key, e.target.value)}
                >
                  <option value="">— нет —</option>
                  {(info.headers.length ? info.headers : info.table[0]).map((h, i) => (
                    <option key={i} value={i}>{`${i + 1}. ${h || "(без названия)"}`}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>
      )}
      {hasCalc && (
        <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900">
          В файле найдены столбцы расчёта (сбор, выделка, транспорт, брокерский): себестоимость лота будет рассчитана по ним — так же, как в «Править расчёт». Итоговые суммы смотрите на следующих шагах.
        </p>
      )}

      {(validation.unknownFurs.length > 0 || validation.unknownColors.length > 0) && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">Нужно решить по справочникам</p>
          {validation.unknownFurs.map((u) => {
            const d = decisions.fur[u.key];
            return (
              <div key={u.key} className="flex flex-col gap-1 border-t border-amber-200 pt-2 sm:flex-row sm:items-center">
                <span className="sm:w-1/2">Мех «{u.text}» — нет в справочнике ({u.rows.length} стр.)</span>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label={`Заменить мех «${u.text}» на`}
                    className="h-8 rounded border border-neutral-300 bg-white px-1 text-xs"
                    value={d?.mode === "ref" ? d.id : ""}
                    onChange={(e) => e.target.value && setDecisions({ ...decisions, fur: { ...decisions.fur, [u.key]: { mode: "ref", id: e.target.value } satisfies FurDecision } })}
                  >
                    <option value="">{u.suggestion ? `Заменить на… (подсказка: ${u.suggestion.name})` : "Заменить на…"}</option>
                    {refs.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  {p.can.materials ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setDecisions({ ...decisions, fur: { ...decisions.fur, [u.key]: { mode: "add" } } })}>
                      Добавить «{u.text}» в справочник
                    </Button>
                  ) : (
                    <span className="text-xs text-neutral-500">Добавлять материалы может владелец, администратор, закупщик, технолог</span>
                  )}
                </div>
              </div>
            );
          })}
          {validation.unknownColors.map((u) => {
            const d = decisions.color[u.key];
            return (
              <div key={u.key} className="flex flex-col gap-1 border-t border-amber-200 pt-2 sm:flex-row sm:items-center">
                <span className="sm:w-1/2">Цвет «{u.text}» — нет в справочнике ({u.rows.length} стр.)</span>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label={`Заменить цвет «${u.text}» на`}
                    className="h-8 rounded border border-neutral-300 bg-white px-1 text-xs"
                    value={d?.mode === "ref" ? d.id : ""}
                    onChange={(e) => e.target.value && setDecisions({ ...decisions, color: { ...decisions.color, [u.key]: { mode: "ref", id: e.target.value } satisfies ColorDecision } })}
                  >
                    <option value="">{u.suggestion ? `Заменить на… (подсказка: ${u.suggestion.name})` : "Заменить на…"}</option>
                    {refs.colors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {p.can.colors && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setDecisions({ ...decisions, color: { ...decisions.color, [u.key]: { mode: "add" } } })}>
                      Добавить в справочник
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDecisions({ ...decisions, color: { ...decisions.color, [u.key]: { mode: "keep" } } })}>
                    Оставить как есть
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          Строк: <b>{rows.length}</b> · шт.: <b>{qty.toLocaleString("ru-RU")}</b> ·{" "}
          {errRows > 0 ? <span className="font-medium text-red-700">строк с ошибками: {errRows}</span> : <span className="text-green-700">ошибок нет</span>}
          {validation.warningCount > 0 && <span className="text-amber-700"> · предупреждений: {validation.warningCount}</span>}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>+ Строка</Button>
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-neutral-200">
          <table className="w-full min-w-[820px] border-collapse text-xs">
            <thead className="bg-neutral-50 text-left text-neutral-600">
              <tr>
                <th className="w-8 px-1 py-1.5">№</th>
                <th className="px-1 py-1.5">Лот</th>
                <th className="px-1 py-1.5">Мех</th>
                <th className="px-1 py-1.5">Цвет</th>
                <th className="px-1 py-1.5">Размер / сорт</th>
                <th className="px-1 py-1.5">Кол-во</th>
                <th className="px-1 py-1.5">Цена</th>
                <th className="px-1 py-1.5">НДС %</th>
                {showInvoice && <th className="px-1 py-1.5">Счёт №</th>}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const c = checkOf.get(r.n);
                const bad = (c?.errors.length ?? 0) > 0;
                const warn = !bad && (c?.warnings.length ?? 0) > 0;
                const tone = bad ? "bg-red-50" : warn ? "bg-amber-50" : "";
                const issues = c ? [...c.errors.map((t) => ({ t, e: true })), ...c.warnings.map((t) => ({ t, e: false })), ...c.infos.map((t) => ({ t, e: null as boolean | null }))] : [];
                return [
                  <tr key={r.n} className={`border-t border-neutral-100 ${tone}`} data-row-state={bad ? "error" : warn ? "warning" : "ok"}>
                    <td className="px-1 py-1 text-neutral-500">{i + 1}</td>
                    {(["lot", "material", "color", "grade", "qty", "price", "vat"] as const).map((k) => (
                      <td key={k} className="px-1 py-1">
                        <input
                          className={cell + (k === "qty" || k === "price" || k === "vat" ? " text-right" : "")}
                          value={r[k]}
                          onChange={(e) => patch(r.n, k, e.target.value)}
                          aria-label={`${ALL_FIELDS.find((f) => f.key === k)?.label}, строка ${i + 1}`}
                          inputMode={k === "qty" || k === "price" || k === "vat" ? "decimal" : undefined}
                        />
                      </td>
                    ))}
                    {showInvoice && (
                      <td className="px-1 py-1">
                        <input className={cell} value={r.invoice} onChange={(e) => patch(r.n, "invoice", e.target.value)} aria-label={`Счёт №, строка ${i + 1}`} />
                      </td>
                    )}
                    <td className="px-1 py-1 text-center">
                      <button type="button" onClick={() => delRow(r.n)} className="text-neutral-500 hover:text-red-600" aria-label={`Удалить строку ${i + 1}`}>×</button>
                    </td>
                  </tr>,
                  issues.length > 0 ? (
                    <tr key={r.n + "-i"} className={tone}>
                      <td />
                      <td colSpan={showInvoice ? 9 : 8} className="px-1 pb-1.5 text-[11px] leading-snug">
                        {issues.map((x, j) => (
                          <span key={j} className={"mr-3 inline-block " + (x.e === true ? "text-red-700" : x.e === false ? "text-amber-800" : "text-neutral-500")}>
                            {x.e === true ? "● " : x.e === false ? "▲ " : "• "}
                            {x.t}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
