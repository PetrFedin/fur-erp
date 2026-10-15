"use client";

import { InfoHint } from "@/components/info-hint";
import { useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { INBOX_FILE_KINDS } from "@/lib/supplier-inbox-consts";
import { CalcDetail } from "./calc-detail";
import { SimpleSteps } from "./simple-steps";
import { FinalFigures } from "./final-figures";
import { FormatPicker } from "./format-picker";
import { InvoiceMaker } from "./invoice-maker";
import { detectFormat, finalFigures, needsAdvanced } from "@/lib/supplier-calc-simple";
import { FORMAT_LABEL, STAGE_LABEL, calcYear, remapCustomRefs, syncLetters, calcAll, columnsFor, emptyRow, headerRate, missingRates, rowFilled, newId, rateCols, switchFormat, type CalcFormat, type CalcPayload, type CalcHeader } from "@/lib/supplier-calc";
import { attachInboxFile, deleteCalcDraft, parseCalcFile, removeInboxFile, saveCalcDraft, sendCalc } from "./actions";

const money = (n: number) => (Number.isFinite(n) ? n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
export type FileRow = { id: string; originalName: string; kind: string; sizeBytes: number };

export function CalcForm({ id, initial, readOnly, files, reviewNote, years = [], lockReason }: { id: string | null; initial: CalcPayload; readOnly: boolean; files: FileRow[]; reviewNote?: string | null; years?: number[]; lockReason?: string | null }) {
  const router = useRouter();
  const [p, setP] = useState<CalcPayload>(initial);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const [tab0, setTab] = useState<"calc" | "detail">("detail");
  // Простой вид по умолчанию; расчёты со своими столбцами/формулами открываются сразу в расширенном, чтобы ничего не спрятать.
  const [advanced, setAdvanced] = useState(() => needsAdvanced(initial));
  const [formatTouched, setFormatTouched] = useState(id !== null);
  const [fileKind, setFileKind] = useState("AUCTION_INVOICE");
  const fileRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const t = useMemo(() => calcAll(p), [p]);
  const isSheet = p.format === "SHEET";
  // в свободной таблице есть только лист; в остальных форматах — ещё простая таблица «Расчёт»
  const tab = isSheet ? "detail" : tab0;
  const cols = columnsFor(p.format);
  const cur = p.header.currency === "EUR" ? "€" : "$";

  const setRate = (k: string, v: string) => setP((x) => ({ ...x, header: { ...x.header, rates: { ...(x.header.rates ?? {}), [k]: v } } }));
  const missing = useMemo(() => missingRates(p), [p]);
  const setH = (k: keyof CalcHeader, v: string) => setP((x) => ({ ...x, header: { ...x.header, [k]: v } }));
  const setCell = (i: number, k: string, v: string) => setP((x) => ({ ...x, rows: x.rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  const run = (fn: () => Promise<{ error?: string; ok?: boolean; id?: string } | void>, okText: string, after?: (r: { id?: string }) => void) =>
    start(async () => {
      const r = (await fn()) ?? {};
      if (r.error) setMsg({ text: r.error, bad: true });
      else {
        setMsg({ text: okText });
        after?.(r);
      }
    });

  const out = () => syncLetters({ ...p, header: { ...p.header, year: p.header.year || String(calcYear(p.header) ?? new Date().getFullYear()) }, rows: p.rows.map((r) => (rowFilled(r) ? { ...r, invoice: r.invoice || p.header.invoice, dest: r.dest || p.header.dest } : r)) });
  const save = () => run(() => saveCalcDraft(id, JSON.stringify(out())), "Черновик сохранён", (r) => { if (!id && r.id) router.replace(`/supplier/auction-calcs/${r.id}`); else router.refresh(); });
  const send = () => {
    const warn = missing.length ? `\n\nСтавка не указана (считается как 0): ${missing.join("; ")}.` : "";
    if (!confirm(`Отправить расчёт нам? После отправки править его нельзя.${warn}`)) return;
    run(async () => {
      const saved = id ? { id } : await saveCalcDraft(null, JSON.stringify(out()));
      if ("error" in saved && saved.error) return saved;
      return sendCalc(saved.id!, JSON.stringify(out()));
    }, "Отправлено", (r) => router.replace(`/supplier/auction-calcs/${r.id ?? id}`));
  };
  const upload = (f: File) => {
    const fd = new FormData();
    fd.set("file", f);
    start(async () => {
      const r = await parseCalcFile(fd);
      if (r.error || !r.payload) return setMsg({ text: r.error ?? "Не удалось прочитать файл", bad: true });
      setP(r.payload);
      setMsg({ text: (r.warnings ?? []).join(" ") + " Это только черновик на экране — нажмите «Сохранить черновик»." });
    });
  };
  const attach = (list: FileList) => {
    if (!id) return setMsg({ text: "Сначала сохраните черновик, потом прикрепляйте файлы", bad: true });
    const fd = new FormData();
    Array.from(list).forEach((f) => fd.append("files", f));
    run(() => attachInboxFile(id, fileKind, fd), "Файл прикреплён", () => { router.refresh(); if (attachRef.current) attachRef.current.value = ""; });
  };

  const downloadXlsx = () =>
    start(async () => {
      const res = await fetch(`/api/supplier/auction-calcs/${id ?? "new"}/xlsx`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(out()) });
      if (!res.ok) return setMsg({ text: "Не удалось сформировать Excel", bad: true });
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `расчет закупки ${p.header.auction || "аукцион"}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    });

  const ro = readOneOnly(readOnly);
  const curYear = calcYear(p.header) ?? new Date().getFullYear();
  const yearList = [...new Set([...years, curYear])].sort((a, b) => b - a);
  const pickYear = (v: string) => {
    if (v === "__new") {
      const y = Number((window.prompt("Новый год аукциона, например 2027") ?? "").trim());
      if (Number.isInteger(y) && y >= 2000 && y <= 2100) setH("year", String(y));
      return;
    }
    setH("year", v);
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Label className="mb-0">Год аукциона</Label>
        {ro ? <b>{curYear}</b> : (
          <Select className="w-40" value={String(curYear)} onChange={(e) => pickYear(e.target.value)} aria-label="Год аукциона">
            {yearList.map((y) => <option key={y} value={y}>{y}</option>)}
            <option value="__new">+ новый год…</option>
          </Select>
        )}
        <InfoHint label="Про год">По году расчёт ляжет в списке «Расчёты аукционов» и в «Сырьё»; закупка у нас получит тот же год.</InfoHint>
      </div>
      {reviewNote && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">Комментарий проверяющего: {reviewNote}</div>}
      {!advanced && (
        <>
          {ro && <FinalFigures {...finalFigures(p, t)} />}
          {!ro && <p className="text-sm text-neutral-600">Перенесите из аукционного счёта: аукцион, лоты и цены. Расходы добавьте ниже — остальное посчитается само.</p>}
          <SimpleSteps p={p} setP={setP} t={t} ro={ro} missing={missing} notify={(text, bad) => setMsg({ text, bad })}
            onAuction={(auction, seller) => setP((x) => {
              const d = !formatTouched ? detectFormat(auction, seller) : null;
              const y = { ...x, header: { ...x.header, auction, seller } };
              return d && d !== x.format ? remapCustomRefs(y, switchFormat(y, d)) : y;
            })}
            onFormat={(f) => { setFormatTouched(true); setP((x) => remapCustomRefs(x, switchFormat(x, f))); }}
            uploadSlot={<>
              <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt,.tsv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => fileRef.current?.click()}>Загрузить файл Excel</Button>
            </>} />
        </>
      )}
      {advanced && (
        <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormatPicker p={p} setP={setP} ro={ro} notify={(text, bad) => setMsg({ text, bad })} onClassic={(f) => setP((x) => remapCustomRefs(x, switchFormat({ ...x, format: x.format === "SHEET" ? "SP_RP" : x.format, customColumns: x.format === "SHEET" ? [] : x.customColumns, params: x.format === "SHEET" ? [] : x.params, formatId: undefined, formatName: undefined, qtyColumn: x.format === "SHEET" ? undefined : x.qtyColumn, priceColumn: undefined, unitCostColumn: x.format === "SHEET" ? undefined : x.unitCostColumn }, f)))} />
        <div>
          <Label>Стадия расчёта</Label>
          <Select value={p.stage ?? "FINAL"} disabled={ro} onChange={(e) => setP((x) => ({ ...x, stage: e.target.value as "PRELIM" | "FINAL" }))}>
            {(["PRELIM", "FINAL"] as const).map((k) => <option key={k} value={k}>{STAGE_LABEL[k]}</option>)}
          </Select>
        </div>
        <H label="Аукцион" v={p.header.auction} on={(v) => setH("auction", v)} ro={ro} ph="СП 09-26" />
        <H label="Номер аукционного счёта" v={p.header.invoice} on={(v) => setH("invoice", v)} ro={ro} />
        <H label="Дата счёта" v={p.header.invoiceDate} on={(v) => setH("invoiceDate", v)} ro={ro} type="date" />
        <H label="Продавец" v={p.header.seller} on={(v) => setH("seller", v)} ro={ro} ph="Союзпушнина, SAGA…" />
        <div>
          <Label>Валюта счёта</Label>
          <Select value={p.header.currency} disabled={ro} onChange={(e) => setH("currency", e.target.value)}><option value="USD">USD</option><option value="EUR">EUR</option></Select>
        </div>
        {!isSheet && (<>
        <H label="Курс ЦБ на дату" v={p.header.cbRate} on={(v) => setH("cbRate", v)} ro={ro} />
        <H label="Надбавка агента, %" v={p.header.agentPct} on={(v) => setH("agentPct", v)} ro={ro} ph="например 1,5" />
        <div>
          <Label>Курс для расчёта</Label>
          <div className="flex h-9 items-center rounded-md border border-neutral-200 bg-neutral-50 px-3 text-sm tabular-nums">{t.rate ? t.rate.toLocaleString("ru-RU", { maximumFractionDigits: 6 }) : "—"}</div>
        </div>
        <div className="sm:col-span-2"><H label="Комментарий к курсу" v={p.header.rateComment} on={(v) => setH("rateComment", v)} ro={ro} ph="Расчётный курс ЦБ на … + 1,5 % агентская комиссия" /></div>
        </>)}
        <H label="Кому оформлен счёт (bayer)" v={p.header.buyer} on={(v) => setH("buyer", v)} ro={ro} />
        <H label="Куда (завод выделки)" v={p.header.dest} on={(v) => setH("dest", v)} ro={ro} ph="Прогресс, МК ЛИС, XIN…" />
        <H label="№ брокера" v={p.header.broker} on={(v) => setH("broker", v)} ro={ro} />
        <H label="Срок оплаты" v={p.header.dueDate} on={(v) => setH("dueDate", v)} ro={ro} type="date" />
        {!isSheet && <H label="НДС, %" v={p.header.vat} on={(v) => setH("vat", v)} ro={ro} ph="22 (для 2025 года — 20)" />}
      </div>

      {!isSheet && <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3">
        <h2 className="text-sm font-semibold">Ставки расчёта</h2>
        <p className="text-xs text-neutral-500">Вводите вы. Пустая ставка считается как 0. Ставка строки (в таблице) важнее: если ячейка заполнена, берётся она. Серый текст в полях — только пример, он не подставляется.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {rateCols(p.format).map((c) => (
            <div key={c.key}>
              <Label>{c.rate!.label}</Label>
              <Input value={headerRate(p.header, c.key)} readOnly={ro} inputMode="decimal" placeholder={c.rate!.ph} onChange={(e) => setRate(c.key, e.target.value)} />
            </div>
          ))}
        </div>
        {missing.length > 0 && !ro && <p className="text-sm text-amber-800">Ставка не указана: {missing.join("; ")}. Считается как 0 — проверьте перед отправкой.</p>}
      </section>}

      <div className="flex gap-1 border-b border-neutral-200" role="tablist">
        {(isSheet ? ([["detail", "Таблица как в Excel — столбцы и формулы"]] as const) : ([["detail", "Таблица как в Excel — столбцы и формулы"], ["calc", "Расчёт (простая таблица)"]] as const)).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === k ? "border-neutral-900 font-semibold" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}>{l}</button>
        ))}
      </div>

      {tab === "detail" && <CalcDetail p={p} setP={setP} t={t} ro={ro} lockReason={lockReason} />}

      {tab === "calc" && !ro && (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt,.tsv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => fileRef.current?.click()}>Загрузить из Excel</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setP((x) => ({ ...x, rows: [...x.rows, { ...emptyRow(x.format), _id: newId(), invoice: x.header.invoice, dest: x.header.dest }] }))}>+ Лот</Button>
          <span className="text-xs text-neutral-500">Файл только читается в черновик на экране — ничего не сохраняется, пока вы не нажмёте «Сохранить черновик».</span>
        </div>
      )}

      {tab === "calc" && <Table className="min-w-[900px]" stickyHeader>
        <Thead>
          <Tr>
            <Th>№</Th>
            {cols.map((c) => <Th key={c.key} title={c.hint}>{c.label}</Th>)}
            <Th className="text-right">Цена за шкуру, ₽</Th>
            {p.format === "SAGA" && <Th className="text-right">Цена за шкуру, $</Th>}
            <Th className="text-right">Сумма, ₽</Th>
            {!ro && <Th />}
          </Tr>
        </Thead>
        <Tbody>
          {p.rows.map((r, i) => {
            const c = t.calcs[i];
            return (
              <Tr key={i}>
                <Td className="text-neutral-500">{i + 1}</Td>
                {cols.map((col) => (
                  <Td key={col.key} className="p-1">
                    <input
                      value={r[col.key] ?? ""}
                      readOnly={ro}
                      inputMode={col.text ? "text" : "decimal"}
                      title={col.hint}
                      placeholder={col.rate && headerRate(p.header, col.key) ? headerRate(p.header, col.key) : undefined}
                      onChange={(e) => setCell(i, col.key, e.target.value)}
                      style={{ width: col.width ?? 80 }}
                      className="h-8 rounded border border-neutral-200 bg-white px-1.5 text-sm tabular-nums read-only:border-transparent read-only:bg-transparent"
                    />
                  </Td>
                ))}
                <Td className="whitespace-nowrap text-right tabular-nums">{c.ok ? money(c.unitRub) : <span className="text-xs text-red-600">{c.problems.join(", ")}</span>}</Td>
                {p.format === "SAGA" && <Td className="whitespace-nowrap text-right tabular-nums">{c.unitUsd != null && c.ok ? money(c.unitUsd) : "—"}</Td>}
                <Td className="whitespace-nowrap text-right tabular-nums">{c.ok ? money(c.totalRub) : "—"}</Td>
                {!ro && <Td className="p-1"><button type="button" className="px-2 text-neutral-400 hover:text-red-600" title="Убрать строку" onClick={() => setP((x) => ({ ...x, rows: x.rows.filter((_, j) => j !== i) }))}>×</button></Td>}
              </Tr>
            );
          })}
        </Tbody>
      </Table>}
      {tab === "calc" && <p className="-mt-3 text-xs text-neutral-500">Цену в {cur} и ставки можно вводить числом или простой формулой, например 6,8*1,156. Пустое «курс» в строке — курс из шапки; пустая ставка в строке — ставка из блока «Ставки расчёта». Свои столбцы и формулы — на вкладке «Таблица как в Excel».</p>}

      {!isSheet && <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Прочие расходы</h2>
        <p className="text-xs text-neutral-500">Расходы на весь счёт (сборы аукциона, счёт перевозчика, таможенный аванс, авиадоставка) делятся на все шкуры поровну; «на шкуру» добавляется к каждой шкуре как есть.</p>
        {p.header.extras.map((e, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input className="w-64" placeholder="Название" value={e.name} readOnly={ro} onChange={(ev) => setP((x) => ({ ...x, header: { ...x.header, extras: x.header.extras.map((y, j) => (j === i ? { ...y, name: ev.target.value } : y)) } }))} />
            <Input className="w-32" inputMode="decimal" placeholder="Сумма, ₽" value={e.amount} readOnly={ro} onChange={(ev) => setP((x) => ({ ...x, header: { ...x.header, extras: x.header.extras.map((y, j) => (j === i ? { ...y, amount: ev.target.value } : y)) } }))} />
            <Select className="w-52" value={e.mode} disabled={ro} onChange={(ev) => setP((x) => ({ ...x, header: { ...x.header, extras: x.header.extras.map((y, j) => (j === i ? { ...y, mode: ev.target.value as "perHide" | "total" } : y)) } }))}>
              <option value="total">на весь счёт (делится на шкуры)</option><option value="perHide">на шкуру</option>
            </Select>
            {!ro && <button type="button" className="px-2 text-neutral-400 hover:text-red-600" onClick={() => setP((x) => ({ ...x, header: { ...x.header, extras: x.header.extras.filter((_, j) => j !== i) } }))}>×</button>}
          </div>
        ))}
        {!ro && <div><Button type="button" size="sm" variant="outline" onClick={() => setP((x) => ({ ...x, header: { ...x.header, extras: [...x.header.extras, { name: "", amount: "", mode: "total" }] } }))}>+ Расход</Button></div>}
      </section>}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><Label>Всего шкур</Label><div className="flex h-9 items-center text-sm font-semibold tabular-nums">{t.qty.toLocaleString("ru-RU")}</div></div>
        <div><Label>Итого по себестоимости, ₽</Label><div className="flex h-9 items-center text-sm font-semibold tabular-nums">{money(t.totalRub)}</div></div>
        <H label="Дата аванса" v={p.header.advanceDate} on={(v) => setH("advanceDate", v)} ro={ro} type="date" />
        <H label="Аванс, ₽" v={p.header.advance} on={(v) => setH("advance", v)} ro={ro} />
        <H label="Промежуточный платёж, ₽" v={p.header.interim} on={(v) => setH("interim", v)} ro={ro} />
        <div><Label>Остаток к оплате, ₽</Label><div className="flex h-9 items-center text-sm font-semibold tabular-nums">{money(t.rest)}</div></div>
      </section>

        </>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Вложения</h2>
        {files.length === 0 && <p className="text-sm text-neutral-500">Нет файлов. PDF аукционного счёта, счёт Веллмеха на аванс, спецификация к Договору купли-продажи №2502 от 26.02.2025, УПД.</p>}
        {files.map((f) => (
          <div key={f.id} className="flex items-center gap-3 text-sm">
            <a className="inline-block text-blue-700 underline max-md:py-3" href={`/api/supplier/inbox-files/${f.id}`}>{f.originalName}</a>
            <span className="text-neutral-500">{INBOX_FILE_KINDS.find((k) => k.key === f.kind)?.label} · {(f.sizeBytes / 1048576).toFixed(1)} МБ</span>
            {!ro && <button type="button" className="text-neutral-400 hover:text-red-600" onClick={() => run(() => removeInboxFile(f.id), "Файл убран", () => router.refresh())}>×</button>}
          </div>
        ))}
        {!ro && (
          <div className="flex flex-wrap items-center gap-2">
            <Select className="w-72" value={fileKind} onChange={(e) => setFileKind(e.target.value)}>{INBOX_FILE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</Select>
            <input ref={attachRef} type="file" multiple accept=".pdf,.xlsx,.docx,.jpg,.jpeg,.png" className="hidden" onChange={(e) => { if (e.target.files?.length) attach(e.target.files); }} />
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => attachRef.current?.click()}>Прикрепить файл</Button>
            <span className="text-xs text-neutral-500">PDF, Excel, Word, фото до 25 МБ{id ? "" : " · доступно после сохранения черновика"}</span>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={downloadXlsx}>Скачать Excel</Button>
        <InfoHint label="Что в файле">Детальный расчёт стоимости сырья, как в письмах: лист «ММ-расчёт» с живыми формулами и лист «Параметры» (курс, ставки).</InfoHint>
      </div>

      <InvoiceMaker id={id} payload={out()} />

      <div className="text-sm"><button type="button" className="text-neutral-500 underline decoration-dotted hover:text-neutral-800" onClick={() => setAdvanced((v) => !v)}>{advanced ? "← Простой вид" : "Расширенный режим (свои столбцы и формулы)"}</button></div>
      {!ro && <p className="text-xs text-neutral-500">«Сохранить черновик» — виден только вам. «Отправить нам» — расчёт и приложенные файлы уйдут нам на проверку; после отправки править нельзя, пока мы не вернём или не примем.</p>}
      {msg && <p role="status" className={msg.bad ? "text-sm text-red-600" : "text-sm text-green-700"}>{msg.text}</p>}
      {!advanced && (() => {
        const f = finalFigures(p, t);
        return (
          <div className="sticky bottom-0 z-20 -mx-1 flex flex-col gap-2 rounded-lg border border-neutral-300 bg-white/95 p-3 shadow-lg backdrop-blur md:flex-row md:items-center md:justify-between">
            <div className="text-sm" aria-live="polite">
              <span className="text-neutral-500">Итого:</span> {f.lots} лотов · {f.qty.toLocaleString("ru-RU")} шкур · <b className="text-lg tabular-nums">{money(f.totalRub)} ₽</b> · средняя себестоимость шкуры <b className="text-lg tabular-nums">{money(f.avgRub)} ₽</b>
            </div>
            {!ro && (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" disabled={pending} onClick={save} title="Сохранить для себя: мы расчёт не увидим, пока вы его не отправите">Сохранить черновик</Button>
                <Button type="button" variant="outline" disabled={pending} onClick={send} title="Расчёт и приложенные файлы уйдут нам на проверку. После отправки править нельзя, пока мы не вернём">Отправить нам</Button>
                {id && <Button type="button" variant="ghost" disabled={pending} onClick={() => { if (confirm("Удалить черновик?")) run(() => deleteCalcDraft(id), "Удалено", () => router.replace("/supplier/auction-calcs")); }}>Удалить</Button>}
              </div>
            )}
          </div>
        );
      })()}
      {advanced && !ro && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={pending} onClick={save} title="Сохранить для себя: мы расчёт не увидим, пока вы его не отправите">Сохранить черновик</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={send} title="Расчёт и приложенные файлы уйдут нам на проверку. После отправки править нельзя, пока мы не вернём">Отправить нам</Button>
          {id && <Button type="button" variant="ghost" disabled={pending} onClick={() => { if (confirm("Удалить черновик?")) run(() => deleteCalcDraft(id), "Удалено", () => router.replace("/supplier/auction-calcs")); }}>Удалить черновик</Button>}
        </div>
      )}
    </div>
  );
}

const readOneOnly = (b: boolean) => b;

function H({ label, v, on, ro, ph, type }: { label: string; v: string; on: (v: string) => void; ro: boolean; ph?: string; type?: string }) {
  const id = useId();
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={v} readOnly={ro} placeholder={ph} type={type} onChange={(e) => on(e.target.value)} />
    </div>
  );
}

