"use client";

import { InfoHint } from "@/components/info-hint";
import { TH as Head } from "@/components/table-head";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { emptyDraft, type TzDraft } from "@/lib/tz-import-core";
import type { TzAnalysis, TzIssue } from "@/lib/tz-import-server";
import { parseTzInput, checkTzDrafts, createTzBatch, type ImportResult } from "../import-actions";
import { useConfirm } from "@/components/confirm-dialog";
import { formatMoney, formatQty } from "@/lib/utils";

const money = (n: number) => formatMoney(n);
const qtyFmt = (n: number) => formatQty(n);

type FieldDef = { k: keyof TzDraft; label: string; w?: string; ph?: string; issue?: TzIssue["field"] };
const FIELDS: FieldDef[] = [
  { k: "number", label: "№ ТЗ", issue: "number", ph: "напр. 169" },
  { k: "article", label: "Артикул / модель", issue: "article" },
  { k: "colors", label: "Цвет(а)", issue: "colors", ph: "Чёрный или Синий ×2 (42, 46); Чёрный ×1" },
  { k: "sizes", label: "Размеры и количество", issue: "qty", ph: "44×2, 46×3" },
  { k: "qty", label: "Кол-во, шт.", issue: "qty", ph: "если не по размерам" },
  { k: "batch", label: "Партия №", issue: "batch" },
  { k: "client", label: "Заказчик", issue: "client" },
  { k: "price", label: "Цена работы за 1 шт., ₽", issue: "price" },
  { k: "calcTotal", label: "Сумма расчёта (для сверки), ₽", issue: "sum" },
];

export function TzImportWizard() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<TzDraft[]>([]);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [analysis, setAnalysis] = useState<Record<string, TzAnalysis> | null>(null);
  const [createRefs, setCreateRefs] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();
  const { ask, node: confirmNode } = useConfirm();

  const active = drafts.filter((d) => !skip.has(d.key));
  const blocking = analysis ? active.some((d) => analysis[d.key]?.blocking) : true;
  const analysed = analysis ? active.every((d) => analysis[d.key]) : false;

  function parse() {
    setError("");
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    fd.set("text", text);
    start(async () => {
      try {
        const r = await parseTzInput(fd);
        setNotes(r.notes ?? []);
        if (r.error) return setError(r.error);
        setDrafts([...drafts, ...(r.drafts ?? [])]);
        setAnalysis(null);
        setStep(2);
      } catch {
        setError("Не удалось разобрать: сервер отклонил запрос или пропала связь.");
      }
    });
  }
  function manual() {
    setDrafts([...drafts, emptyDraft("вручную")]);
    setAnalysis(null);
    setStep(2);
  }
  function edit(key: string, k: keyof TzDraft, v: string) {
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, [k]: v } : d)));
    setAnalysis(null);
  }
  function check() {
    setError("");
    start(async () => {
      try {
        const r = await checkTzDrafts(active, { createRefs });
        if (r.error) return setError(r.error);
        setAnalysis(Object.fromEntries((r.analysis ?? []).map((a) => [a.key, a])));
      } catch {
        setError("Не удалось проверить: пропала связь.");
      }
    });
  }
  async function create() {
    if (pending) return; // защита от двойной отправки
    // Мягкие предупреждения (повтор № ТЗ, нет цены работы) не блокируют, но требуют подтверждения.
    const soft = active.flatMap((d) => (analysis?.[d.key]?.issues ?? []).filter((i) => i.level === "warn" && (i.field === "number" || i.field === "price")).map((i) => `ТЗ ${d.number || "без номера"}: ${i.text}`));
    if (soft.length > 0) {
      const ok = await ask(
        <div className="flex flex-col gap-2">
          <p className="font-medium">Проверьте перед созданием</p>
          <ul className="list-disc pl-5 text-neutral-700">{soft.slice(0, 12).map((x, i) => <li key={i}>{x}</li>)}</ul>
          {soft.length > 12 ? <p className="text-xs text-neutral-500">…и ещё {soft.length - 12}</p> : null}
        </div>,
        { ok: "Всё равно создать", wide: true },
      );
      if (!ok) return;
    }
    setError("");
    const fd = new FormData();
    fd.set("drafts", JSON.stringify(active));
    // Повтор № ТЗ подтверждён в окне выше: только с этим флагом сервер создаёт ТЗ с уже занятым номером (защита от повторной отправки).
    fd.set("confirmDuplicates", active.some((d) => analysis?.[d.key]?.issues.some((i) => i.field === "number" && i.level === "warn")) ? "1" : "0");
    fd.set("createRefs", createRefs ? "1" : "0");
    for (const f of files) fd.append("files", f);
    start(async () => {
      try {
        const r = await createTzBatch(fd);
        if (r.error) {
          setError(r.error);
          if (r.analysis) setAnalysis(Object.fromEntries(r.analysis.map((a) => [a.key, a])));
          return;
        }
        setResult(r);
        setStep(3);
      } catch {
        setError("Не удалось создать ТЗ: сервер отклонил запрос или пропала связь. Проверьте список ТЗ — возможно, они уже созданы.");
      }
    });
  }

  const steps = ["1. Источник", "2. Проверка и правка", "3. Что пересчиталось"];
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Шаги">
        {steps.map((s, i) => (
          <li key={s} className={`rounded-full border px-3 py-1 ${step === i + 1 ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-600"}`}>
            {s}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
          <div>
            <label htmlFor="tz-files" className="mb-1 block text-sm font-medium">
              Файлы приложения / расчёта ТЗ — один или несколько
            </label>
            <input id="tz-files" data-testid="tz-files" type="file" multiple accept=".xlsx,.csv,.txt,.docx,.pdf" className="w-full text-sm" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            <p className="mt-1 text-xs text-neutral-500">Форматы: xlsx, csv, docx, pdf с текстом.<InfoHint label="Какие столбцы нужны" wide>xlsx / csv — таблица с заголовками («№ ТЗ», «Артикул», «Цвет», «Размеры», «Кол-во», «Партия», «Заказчик», «Цена работы», «Лот», «Расход»; одна строка — один лот, № ТЗ можно не повторять); docx и pdf с текстом — строки «ТЗ № …», «Артикул: …», «Цвет: …», «Лот … количество». PDF-скан без текста не читается — вставьте таблицу.</InfoHint></p>
          </div>
          <div>
            <label htmlFor="tz-text" className="mb-1 block text-sm font-medium">
              …или вставьте таблицу из Excel / текст
            </label>
            <textarea id="tz-text" value={text} onChange={(e) => setText(e.target.value)} rows={6} className="ui-field w-full rounded-lg border border-neutral-300 p-2 font-mono text-xs" placeholder={"№ ТЗ\tАртикул\tЦвет\tРазмеры\tПартия\tЦена работы\tЛот\tРасход\n169\tM012\tЧёрный\t44×2, 46×1\t7\t1500\t300687\t12,5"} />
          </div>
          {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {notes.length > 0 && <ul className="text-xs text-neutral-600">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={parse} disabled={pending || (files.length === 0 && !text.trim())}>
              {pending ? "Разбираем…" : "Разобрать"}
            </Button>
            <Button type="button" variant="outline" onClick={manual} disabled={pending}>
              Ввести ТЗ вручную
            </Button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-4">
          {notes.length > 0 && <ul className="text-xs text-neutral-600">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={createRefs} onChange={(e) => { setCreateRefs(e.target.checked); setAnalysis(null); }} />
            Создавать недостающие артикулы, цвета (как «предложенные») и заказчиков
          </label>
          {drafts.map((d) => {
            const a = analysis?.[d.key];
            const off = skip.has(d.key);
            const issueOf = (f?: TzIssue["field"]) => (f && a ? a.issues.filter((i) => i.field === f) : []);
            return (
              <div key={d.key} data-testid="tz-draft" className={`rounded-lg border p-3 ${off ? "opacity-50" : ""} ${a?.blocking ? "border-red-300" : a ? "border-emerald-200" : "border-neutral-200"} bg-white`}>
                <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-semibold">ТЗ {d.number || "без номера"}</span>
                  <span className="text-xs text-neutral-500">источник: {d.source}</span>
                  <label className="ml-auto flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={!off} onChange={(e) => setSkip((s) => { const n = new Set(s); if (e.target.checked) n.delete(d.key); else n.add(d.key); return n; })} />
                    создать
                  </label>
                  <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={() => { setDrafts((x) => x.filter((y) => y.key !== d.key)); setAnalysis(null); }}>
                    Убрать
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {FIELDS.map((f) => {
                    const is = issueOf(f.issue);
                    const cls = is.some((i) => i.level === "error") ? "border-red-400 bg-red-50" : is.length ? "border-amber-400 bg-amber-50" : "";
                    return (
                      <label key={f.k} className="flex flex-col gap-1 text-xs text-neutral-500">
                        {f.label}
                        <Input value={d[f.k]} placeholder={f.ph} onChange={(e) => edit(d.key, f.k, e.target.value)} className={cls} aria-label={`${f.label} (ТЗ ${d.number || "новое"})`} />
                      </label>
                    );
                  })}
                  <label className="flex flex-col gap-1 text-xs text-neutral-500 sm:col-span-2 lg:col-span-3">
                    Материалы: «лот количество [4% | без4]» — по строке на лот
                    <textarea value={d.materials} onChange={(e) => edit(d.key, "materials", e.target.value)} rows={Math.min(8, Math.max(2, d.materials.split("\n").length))} className={`ui-field rounded-md border p-2 font-mono text-xs ${issueOf("materials").some((i) => i.level === "error") ? "border-red-400 bg-red-50" : "border-neutral-300"}`} />
                  </label>
                </div>
                {a && (
                  <div className="mt-2 flex flex-col gap-1 text-xs">
                    {a.issues.map((i, n) => (
                      <p key={n} className={i.level === "error" ? "text-red-700" : "text-amber-700"}>
                        {i.level === "error" ? "Ошибка: " : "Внимание: "}
                        {i.text}
                      </p>
                    ))}
                    <p className="text-neutral-600">
                      {a.qty != null ? `${qtyFmt(a.qty)} шт.` : "кол-во не определено"} · списаний: {a.lots.length} · сырьё {money(a.costBase)} (с 4 %: {money(a.costWith4)}) · работа {money(a.work)}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
          {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => { setDrafts([...drafts, emptyDraft("вручную")]); setAnalysis(null); }} disabled={pending}>
              + ТЗ вручную
            </Button>
            <Button type="button" variant="outline" onClick={() => setStep(1)} disabled={pending}>
              ← Добавить ещё файлы
            </Button>
            <Button type="button" variant="outline" onClick={check} disabled={pending || active.length === 0}>
              {pending ? "Проверяем…" : "Проверить"}
            </Button>
            <Button type="button" onClick={create} disabled={pending || !analysed || blocking || active.length === 0}>
              {pending ? "Создаём…" : `Создать ТЗ: ${active.length}`}
            </Button>
          </div>
          {!analysed && <p className="text-xs text-neutral-500">«Создать» станет доступно после «Проверить» — без красных ошибок. Любая правка требует новой проверки.</p>}
        </section>
      )}

      {step === 3 && result?.ok && <ResultView r={result} />}
      {confirmNode}
    </div>
  );
}

function ResultView({ r }: { r: ImportResult }) {
  const t = r.totals!;
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-emerald-200 bg-white p-4" data-testid="tz-result">
      <h2 className="block-title">Создано ТЗ: {r.orders!.length}</h2>
      <p className="text-sm text-neutral-700">
        ТЗ в учёте: {t.ordersBefore} → {t.ordersAfter}. Сырья списано на {money(t.rawSpent)}.
        {(t.created.articles || t.created.colors || t.created.clients) > 0 && ` Создано в справочниках: артикулов ${t.created.articles}, цветов ${t.created.colors}, заказчиков ${t.created.clients}.`}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="pr-3">ТЗ</th><Head label="Кол-во" unit="шт." align="left" /><Head label="Себестоимость сырья" unit="₽" align="left" /><Head label="С 4 %" unit="₽" align="left" /><Head label="Работа" unit="₽" align="left" /><th>Не хватает документов</th>
            </tr>
          </thead>
          <tbody>
            {r.orders!.map((o) => (
              <tr key={o.id} className="border-t border-neutral-100">
                <td className="py-1 pr-3"><Link className="text-blue-600 hover:underline" href={`/production/${o.id}`}>№ {o.workOrderNumber || o.number}</Link></td>
                <td className="pr-3">{qtyFmt(o.qty)}</td><td className="pr-3">{money(o.cost)}</td><td className="pr-3">{money(o.costWith4)}</td><td className="pr-3">{money(o.work)}</td>
                <td className="text-xs text-amber-700">{o.missingDocs.length ? o.missingDocs.join("; ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.lots!.length > 0 && (
        <div>
          <h3 className="block-title">Остаток меха по лотам</h3>
          <ul className="text-sm text-neutral-700">{r.lots!.map((l) => <li key={l.lotNumber}>лот {l.lotNumber} ({l.material}): {qtyFmt(l.before)} → {qtyFmt(l.after)}</li>)}</ul>
        </div>
      )}
      {r.batches!.length > 0 && (
        <div>
          <h3 className="block-title">Партии</h3>
          <ul className="text-sm text-neutral-700">
            {r.batches!.map((b) => (
              <li key={b.number}>
                <Link className="text-blue-600 hover:underline" href={`/production/batches/${b.number}`}>Партия {b.number}</Link>: ТЗ {b.ordersBefore} → {b.ordersAfter}; себестоимость {money(b.costBefore)} → {money(b.costAfter)}; работа {money(b.workBefore)} → {money(b.workAfter)}; остаток к оплате {money(b.remainingAfter)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">Что дальше</p>
        <p className="text-xs">Счёт на работу и оплаты — на карточке ТЗ в блоке «Документы и оплата» и в <Link className="underline" href="/verify">Контроле → Задачи</Link>. Цифры «Сводки» обновились: <Link className="underline" href="/dashboard">открыть Сводку</Link>.</p>
      </div>
      <div className="flex gap-2">
        <Link className="text-sm text-blue-600 hover:underline" href="/production">К списку ТЗ</Link>
        <Link className="text-sm text-blue-600 hover:underline" href="/production/import">Загрузить ещё</Link>
      </div>
    </section>
  );
}
