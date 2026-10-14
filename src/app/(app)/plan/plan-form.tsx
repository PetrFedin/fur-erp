"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { InfoHint } from "@/components/info-hint";
import { ColorSelect, type ColorSelectOption } from "@/components/color-select";
import { PlanArticlePicker, type ArticleOption, type ArticleValue } from "@/components/plan-article-picker";
import { LETTER_SIZES, NUMERIC_SIZES, cleanSize, compareSizeLabels, parsePastedPlan, parseCellQty, type ParsedPaste } from "@/lib/plan-sizes";
import { FUR_TEXT_RULES } from "@/lib/product-category";
import { useKeepingForm } from "@/lib/use-keeping-form";
import { savePlan, type PlanFormState } from "./actions";
import { ICON_BTN_DANGER, IconTrash } from "@/components/icons";

type Row = {
  key: string;
  article: ArticleValue;
  name: string;
  color: string;
  furType: string;
  notes: string;
  qty: Record<string, string>;
};

export type PlanInitial = {
  editId: string;
  seasonId: string | null;
  article: ArticleValue;
  name: string;
  color: string;
  furType: string;
  notes: string;
  sizes: Record<string, number>;
};

let counter = 0;
const newKey = () => `r${++counter}`;
// Ключ первой строки фиксирован: счётчик модуля на сервере растёт между запросами и давал рассинхрон гидрации (name c-r5 против c-r1).
const emptyRow = (key: string = newKey()): Row => ({ key, article: { code: "", modelId: null }, name: "", color: "", furType: "", notes: "", qty: {} });
const initialState: PlanFormState = {};

export function PlanForm({
  seasons,
  models,
  colorRefs,
  canCreateArticle,
  canCreateColor,
  defaultSeasonId,
  initial,
}: {
  seasons: { id: string; code: string }[];
  models: ArticleOption[];
  colorRefs: ColorSelectOption[];
  canCreateArticle: boolean;
  canCreateColor: boolean;
  defaultSeasonId: string;
  initial?: PlanInitial;
}) {
  const [state, formAction, pending] = useActionState(savePlan, initialState);
  const { setForm: keepRef, onSubmit: keepSubmit } = useKeepingForm(formAction, state, pending);
  const [seasonId, setSeasonId] = useState(initial ? (initial.seasonId ?? "") : defaultSeasonId);
  const [newSeason, setNewSeason] = useState("");
  const [sizes, setSizes] = useState<string[]>(() =>
    initial ? Object.keys(initial.sizes).sort(compareSizeLabels) : [...LETTER_SIZES],
  );
  const [rows, setRows] = useState<Row[]>(() =>
    initial
      ? [{ key: "r0", article: initial.article, name: initial.name, color: initial.color, furType: initial.furType, notes: initial.notes, qty: Object.fromEntries(Object.entries(initial.sizes).map(([k, v]) => [k, String(v)])) }]
      : [emptyRow("r0")],
  );
  const [addSize, setAddSize] = useState("");
  const [paste, setPaste] = useState("");
  const [parsed, setParsed] = useState<ParsedPaste | null>(null);
  const cells = useRef(new Map<string, HTMLInputElement>());
  const articleInputs = useRef(new Map<string, HTMLInputElement>());
  const focusRef = useRef<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const setFocusReq = (k: string) => {
    focusRef.current = k;
    setFocusTick((t) => t + 1);
  };

  useEffect(() => {
    const k = focusRef.current;
    if (!k) return;
    focusRef.current = null;
    const el = cells.current.get(k) ?? articleInputs.current.get(k);
    el?.focus();
    el?.select?.();
  }, [focusTick]);

  const upd = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const total = (r: Row) => sizes.reduce((s, sz) => {
    const v = parseCellQty(r.qty[sz] ?? "");
    return s + (v && !Number.isNaN(v) ? v : 0);
  }, 0);
  const grand = rows.reduce((s, r) => s + total(r), 0);

  const addSizes = (list: string[]) =>
    setSizes((cur) => [...new Set([...cur, ...list.map(cleanSize).filter(Boolean)])].sort(compareSizeLabels));

  const onEnter = (rowIdx: number, szIdx: number) => {
    const r = rows[rowIdx];
    if (szIdx + 1 < sizes.length) return setFocusReq(`${r.key}|${sizes[szIdx + 1]}`);
    if (rowIdx + 1 < rows.length) return setFocusReq(`${rows[rowIdx + 1].key}|${sizes[0]}`);
    const nr = emptyRow();
    setRows((rs) => [...rs, nr]);
    setFocusReq(nr.key);
  };

  const payload = useMemo(() => {
    const out = rows.map((r) => {
      const q: Record<string, number> = {};
      for (const sz of sizes) {
        const v = parseCellQty(r.qty[sz] ?? "");
        if (v !== null) q[sz] = Number.isNaN(v) ? -1 : v;
      }
      return {
        articleCode: r.article.code.trim(),
        modelId: r.article.modelId,
        articleName: r.name.trim() || undefined,
        color: r.color.trim() || undefined,
        furType: r.furType.trim() || undefined,
        notes: r.notes.trim() || undefined,
        sizes: q,
      };
    });
    return JSON.stringify({ seasonId: seasonId === "__new" ? undefined : seasonId || undefined, newSeasonCode: seasonId === "__new" ? newSeason.trim() || undefined : undefined, editId: initial?.editId, rows: out });
  }, [rows, sizes, seasonId, newSeason, initial]);

  // Черновик: сетка размеров большая, а случайное обновление страницы стирало её целиком.
  // Хранится в localStorage этого браузера (с обёрткой try/catch: в приватном окне его может не быть).
  const draftKey = `furerp:plan-draft:${initial?.editId ?? "new"}`;
  const [basePayload] = useState(payload);
  const dirty = payload !== basePayload;
  const [draftRestored, setDraftRestored] = useState(false);
  const submittedRef = useRef(false);
  const failedRef = useRef(false);
  useEffect(() => {
    failedRef.current = !!state.error;
  }, [state.error]);

  /* eslint-disable react-hooks/set-state-in-effect -- восстановление черновика из localStorage возможно только после монтирования (иначе рассинхрон гидрации) */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw) as { rows?: Row[]; sizes?: string[]; seasonId?: string; newSeason?: string };
      if (!Array.isArray(d.rows) || d.rows.length === 0 || !Array.isArray(d.sizes)) return;
      setRows(d.rows.map((r) => ({ ...r, key: newKey() })));
      setSizes(d.sizes);
      setSeasonId(d.seasonId ?? "");
      setNewSeason(d.newSeason ?? "");
      setDraftRestored(true);
    } catch {
      /* нет доступа к хранилищу или битый черновик — работаем без него */
    }
    // только при открытии страницы
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!dirty) return;
    try {
      window.localStorage.setItem(draftKey, JSON.stringify({ rows, sizes, seasonId, newSeason }));
    } catch {
      /* ignore */
    }
  }, [dirty, rows, sizes, seasonId, newSeason, draftKey]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Успешное сохранение уводит со страницы (redirect) — тогда черновик больше не нужен.
  useEffect(
    () => () => {
      if (submittedRef.current && !failedRef.current) {
        try {
          window.localStorage.removeItem(draftKey);
        } catch {
          /* ignore */
        }
      }
    },
    [draftKey],
  );

  const dropDraft = () => {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  const loadParsed = () => {
    if (!parsed || parsed.rows.length === 0) return;
    addSizes(parsed.sizes);
    const imported: Row[] = parsed.rows.map((r) => {
      const match = models.find((m) => m.name.toLowerCase() === r.articleCode.toLowerCase());
      return {
        key: newKey(),
        article: { code: match?.name ?? r.articleCode, modelId: match?.id ?? null },
        name: r.articleName ?? "",
        color: r.color ?? "",
        furType: r.furType ?? "",
        notes: r.notes ?? "",
        qty: Object.fromEntries(Object.entries(r.sizes).map(([k, v]) => [k, String(v)])),
      };
    });
    setRows((rs) => [...rs.filter((r) => r.article.code.trim() || Object.values(r.qty).some(Boolean)), ...imported]);
    setParsed(null);
    setPaste("");
  };

  return (
    <form
      ref={keepRef}
      onSubmit={(e) => {
        submittedRef.current = true;
        keepSubmit(e);
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="payload" value={payload} />
      {draftRestored && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Восстановлен несохранённый черновик плана. Проверьте данные и нажмите «Сохранить».{" "}
          <button type="button" className="underline" onClick={dropDraft}>Отбросить черновик</button>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label htmlFor="plan-season">
            Сезон{" "}
            <InfoHint>Сезон нужен, чтобы сверять план с ТЗ: факт считается по ТЗ этого сезона. Сезоны можно завести здесь или в блоке «Сезоны» ниже; даты сезона нужны для правила «ТЗ по дате → сезон».</InfoHint>
          </Label>
          <Select id="plan-season" value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
            <option value="">Без сезона</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.code}</option>
            ))}
            <option value="__new">+ Создать сезон…</option>
          </Select>
        </div>
        {seasonId === "__new" && (
          <div>
            <Label htmlFor="plan-newseason">Код нового сезона</Label>
            <Input id="plan-newseason" value={newSeason} onChange={(e) => setNewSeason(e.target.value)} placeholder="Например FW26/27" maxLength={30} />
          </div>
        )}
      </div>

      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="font-medium">Размеры (колонки):</span>
          <Button type="button" variant="outline" size="sm" onClick={() => addSizes([...LETTER_SIZES])}>XS–XXL</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => addSizes([...NUMERIC_SIZES])}>38–50</Button>
          <Input value={addSize} onChange={(e) => setAddSize(e.target.value)} placeholder="свой размер" className="h-8 w-28" maxLength={12}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addSizes([addSize]);
                setAddSize("");
              }
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => { addSizes([addSize]); setAddSize(""); }}>+ размер</Button>
          <InfoHint>
            Колонки общие для всех строк. Пустая ячейка = 0. Enter переходит к следующей ячейке (на последней — добавляется новая строка), Tab работает как обычно. Колонку, где нигде нет количеств, можно убрать крестиком.
          </InfoHint>
        </div>
      </div>

      {rows.map((r, ri) => (
        <div key={r.key} className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-neutral-600">{initial ? "Правка позиции" : `Позиция ${ri + 1}`}</span>
            {!initial && (
              <span className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => setRows((rs) => { const c = { ...r, key: newKey(), qty: { ...r.qty } }; const i = rs.findIndex((x) => x.key === r.key); return [...rs.slice(0, i + 1), c, ...rs.slice(i + 1)]; })}>Копировать</Button>
                <Button type="button" variant="ghost" size="sm" disabled={rows.length === 1} className={ICON_BTN_DANGER} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} title="Удалить" aria-label="Удалить"><IconTrash /></Button>
              </span>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <Label>Артикул</Label>
              <PlanArticlePicker
                options={models}
                value={r.article}
                canCreate={canCreateArticle}
                onChange={(v) => upd(r.key, { article: v })}
                inputRef={(el) => { if (el) articleInputs.current.set(r.key, el); else articleInputs.current.delete(r.key); }}
              />
            </div>
            <div>
              <Label>Название (необязательно)</Label>
              <Input value={r.name} onChange={(e) => upd(r.key, { name: e.target.value })} maxLength={200} placeholder="Пальто, жилет…" className="h-10" />
            </div>
            <div>
              <Label>Цвет</Label>
              <ColorSelect refs={colorRefs} canCreate={canCreateColor} name={`c-${r.key}`} refName={`cr-${r.key}`} defaultValue={r.color} onChange={(t) => upd(r.key, { color: t })} placeholder="Цвет" />
            </div>
            <div>
              <Label>Вид меха</Label>
              <Input value={r.furType} onChange={(e) => upd(r.key, { furType: e.target.value })} list="plan-fur-list" maxLength={100} placeholder="Соболь, норка…" className="h-10" />
            </div>
          </div>

          <div className="mt-3 overflow-x-auto pb-1">
            <div className="flex min-w-max items-end gap-2">
              {sizes.map((sz, si) => (
                <div key={sz} className="w-[4.5rem] shrink-0">
                  <div className="mb-1 flex items-center justify-between text-xs font-medium text-neutral-600">
                    <span>{sz}</span>
                    {ri === 0 && rows.every((x) => !(x.qty[sz] ?? "").trim()) && (
                      <button type="button" aria-label={`Убрать размер ${sz}`} className="text-neutral-500 hover:text-red-600" onClick={() => setSizes((s) => s.filter((x) => x !== sz))}>×</button>
                    )}
                  </div>
                  <input
                    ref={(el) => { const k = `${r.key}|${sz}`; if (el) cells.current.set(k, el); else cells.current.delete(k); }}
                    value={r.qty[sz] ?? ""}
                    inputMode="numeric"
                    aria-label={`${sz}, количество`}
                    onChange={(e) => upd(r.key, { qty: { ...r.qty, [sz]: e.target.value } })}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnter(ri, si); } }}
                    onFocus={(e) => e.currentTarget.select()}
                    className={`h-10 w-full rounded-md border bg-white px-2 text-center text-sm tabular-nums shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 ${Number.isNaN(parseCellQty(r.qty[sz] ?? "") ?? 0) ? "border-red-400" : "border-neutral-300"}`}
                    placeholder="0"
                  />
                </div>
              ))}
              <div className="w-20 shrink-0 text-right">
                <div className="mb-1 text-xs font-medium text-neutral-600">Всего, шт.</div>
                <div className="flex h-10 items-center justify-end text-base font-semibold tabular-nums">{total(r)}</div>
              </div>
            </div>
          </div>
          <div className="mt-2">
            <Input value={r.notes} onChange={(e) => upd(r.key, { notes: e.target.value })} maxLength={1000} placeholder="Заметка к позиции (необязательно)" className="h-9" />
          </div>
        </div>
      ))}
      <datalist id="plan-fur-list">
        {FUR_TEXT_RULES.map((f) => <option key={f.label} value={f.label} />)}
      </datalist>

      {!initial && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => { const nr = emptyRow(); setRows((rs) => [...rs, nr]); setFocusReq(nr.key); }}>+ Ещё позиция</Button>
          <span className="text-sm text-neutral-500">Всего, шт. в форме: <b className="tabular-nums text-neutral-900">{grand}</b> в {rows.length} поз.</span>
        </div>
      )}

      {!initial && (
        <details className="rounded-md border border-neutral-200 p-3">
          <summary className="cursor-pointer text-sm font-medium">Вставить из Excel / CSV</summary>
          <p className="mt-2 text-xs text-neutral-500">
            Скопируйте в Excel ячейки с заголовком: «Артикул», при желании «Название», «Цвет», «Мех», затем размеры (XS S M … или 42 44 46). Вставьте сюда — покажем предпросмотр, и только потом загрузим в форму.
          </p>
          <textarea
            value={paste}
            onChange={(e) => { setPaste(e.target.value); setParsed(null); }}
            rows={5}
            placeholder={"Артикул\tЦвет\tXS\tS\tM\tL\nM012\tчёрный\t2\t4\t4\t2"}
            className="mt-2 w-full rounded-md border border-neutral-300 p-2 font-mono text-xs"
          />
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setParsed(parsePastedPlan(paste))} disabled={!paste.trim()}>Разобрать</Button>
            {parsed && parsed.rows.length > 0 && <Button type="button" size="sm" onClick={loadParsed}>Загрузить {parsed.rows.length} поз. в форму</Button>}
          </div>
          {parsed && (
            <div className="mt-3 text-sm">
              {parsed.errors.length > 0 && (
                <ul className="mb-2 list-disc pl-5 text-xs text-amber-700">
                  {parsed.errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}
                  {parsed.errors.length > 8 && <li>…и ещё {parsed.errors.length - 8}</li>}
                </ul>
              )}
              {parsed.rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead><tr className="text-left text-neutral-500"><th className="pr-3">Артикул</th><th className="pr-3">Цвет</th>{parsed.sizes.map((s) => <th key={s} className="px-2 text-right">{s}</th>)}<th className="px-2 text-right">Итого</th></tr></thead>
                    <tbody>
                      {parsed.rows.slice(0, 30).map((r, i) => (
                        <tr key={i} className="border-t border-neutral-100">
                          <td className="pr-3 font-medium">{r.articleCode}</td><td className="pr-3">{r.color ?? ""}</td>
                          {parsed.sizes.map((s) => <td key={s} className="px-2 text-right tabular-nums">{r.sizes[s] ?? ""}</td>)}
                          <td className="px-2 text-right font-semibold tabular-nums">{Object.values(r.sizes).reduce((a, b) => a + b, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsed.rows.length > 30 && <p className="mt-1 text-xs text-neutral-500">Показаны первые 30 из {parsed.rows.length}.</p>}
                </div>
              )}
            </div>
          )}
        </details>
      )}

      {state.error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{state.error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>{pending ? "Сохраняем…" : initial ? "Сохранить изменения" : `Сохранить план (${rows.length} поз.)`}</Button>
        {initial && <a href={initial.seasonId ? `/plan?season=${initial.seasonId}` : "/plan"} className="text-sm text-neutral-500 hover:underline">Отмена</a>}
      </div>
    </form>
  );
}
