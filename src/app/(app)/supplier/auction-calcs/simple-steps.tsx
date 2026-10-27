"use client";

import { useId, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { FORMAT_LABEL, STAGE_LABEL, emptyRow, headerRate, newId, rowFilled, type CalcFormat, type CalcHeader, type CalcPayload, type CalcTotals } from "@/lib/supplier-calc";
import { expenseFields, getOther, hasOtherExtras, parsePasted, setOther } from "@/lib/supplier-calc-simple";
import { formatRate, formatNum } from "@/lib/utils";

const money = (n: number) => (Number.isFinite(n) ? formatNum(n, 1) : "–");
const cellCls = "h-9 w-full rounded border border-neutral-300 bg-white px-1.5 text-sm tabular-nums read-only:border-transparent read-only:bg-transparent";

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="flex items-baseline gap-2 text-base font-semibold"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-xs text-white">{n}</span>{title}{hint && <span className="text-xs font-normal text-neutral-500">{hint}</span>}</h2>
      {children}
    </section>
  );
}
function F({ label, v, on, ro, ph, type, className }: { label: string; v: string; on: (v: string) => void; ro: boolean; ph?: string; type?: string; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={v} readOnly={ro} placeholder={ph} type={type} onChange={(e) => on(e.target.value)} />
    </div>
  );
}

export function SimpleSteps({ p, setP, t, ro, missing, onAuction, onFormat, uploadSlot, notify }: {
  p: CalcPayload; setP: Dispatch<SetStateAction<CalcPayload>>; t: CalcTotals; ro: boolean; missing: string[];
  onAuction: (auction: string, seller: string) => void; onFormat: (f: CalcFormat) => void; uploadSlot: ReactNode; notify: (text: string, bad?: boolean) => void;
}) {
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const h = p.header;
  const cur = h.currency === "EUR" ? "€" : "$";
  const setH = (k: keyof CalcHeader, v: string) => setP((x) => ({ ...x, header: { ...x.header, [k]: v } }));
  const setRate = (k: string, v: string) => setP((x) => ({ ...x, header: { ...x.header, rates: { ...(x.header.rates ?? {}), [k]: v } } }));
  const setCell = (i: number, k: string, v: string) => setP((x) => ({ ...x, rows: x.rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  const newRow = (x: CalcPayload) => ({ ...emptyRow(x.format), _id: newId(), invoice: x.header.invoice, dest: x.header.dest });
  const { main, more } = expenseFields(p.format);

  const applyPaste = () => {
    const r = parsePasted(text);
    if ("error" in r) return notify(r.error, true);
    setP((x) => {
      const keep = x.rows.filter(rowFilled);
      return { ...x, rows: [...keep, ...r.rows.map((row) => ({ ...newRow(x), ...row }))] };
    });
    setText("");
    setPaste(false);
    notify(`Добавлено лотов: ${r.rows.length}${r.skipped ? `, пропущено строк без количества или цены: ${r.skipped}` : ""}.`);
  };

  return (
    <>
      <Step n={1} title="Аукцион">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <F label="Аукцион" v={h.auction} on={(v) => onAuction(v, h.seller)} ro={ro} ph="СП 09.26" />
          <F label="№ счёта" v={h.invoice} on={(v) => setH("invoice", v)} ro={ro} ph="3017" />
          <F label="Дата счёта" v={h.invoiceDate} on={(v) => setH("invoiceDate", v)} ro={ro} type="date" />
          <F label="Курс ЦБ на дату" v={h.cbRate} on={(v) => setH("cbRate", v)} ro={ro} ph="84,4075" />
          <F label="Продавец" v={h.seller} on={(v) => onAuction(h.auction, v)} ro={ro} ph="Союзпушнина" />
        </div>
        <details className="group text-sm">
          <summary className="cursor-pointer select-none text-neutral-600 underline decoration-dotted max-md:py-3">Ещё поля</summary>
          <div className="mt-3 flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2">
                <Label>Формат расчёта</Label>
                <Select value={p.format} disabled={ro} onChange={(e) => onFormat(e.target.value as CalcFormat)}>
                  {(Object.keys(FORMAT_LABEL) as CalcFormat[]).map((k) => <option key={k} value={k}>{FORMAT_LABEL[k]}</option>)}
                </Select>
                <p className="mt-1 text-xs text-neutral-500">Выбирается сам по названию аукциона; здесь можно сменить.</p>
              </div>
              <div>
                <Label>Стадия</Label>
                <Select value={p.stage ?? "FINAL"} disabled={ro} onChange={(e) => setP((x) => ({ ...x, stage: e.target.value as "PRELIM" | "FINAL" }))}>
                  {(["PRELIM", "FINAL"] as const).map((k) => <option key={k} value={k}>{STAGE_LABEL[k]}</option>)}
                </Select>
              </div>
              <div>
                <Label>Валюта счёта</Label>
                <Select value={h.currency} disabled={ro} onChange={(e) => setH("currency", e.target.value)}><option value="USD">USD</option><option value="EUR">EUR</option></Select>
              </div>
              <F label="Надбавка агента, %" v={h.agentPct} on={(v) => setH("agentPct", v)} ro={ro} ph="например 1,5" />
              <div>
                <Label>Курс для расчёта</Label>
                <div className="flex h-9 items-center rounded-md border border-neutral-200 bg-neutral-50 px-3 text-sm tabular-nums">{t.rate ? formatRate(t.rate) : "–"}</div>
              </div>
              <F className="sm:col-span-2" label="Комментарий к курсу" v={h.rateComment} on={(v) => setH("rateComment", v)} ro={ro} ph="Курс ЦБ на … + 1,5 %" />
              <F label="Кому оформлен счёт (bayer)" v={h.buyer} on={(v) => setH("buyer", v)} ro={ro} />
              <F label="Куда (завод выделки)" v={h.dest} on={(v) => setH("dest", v)} ro={ro} ph="Прогресс, XIN…" />
              <F label="№ брокера" v={h.broker} on={(v) => setH("broker", v)} ro={ro} />
              <F label="Срок оплаты" v={h.dueDate} on={(v) => setH("dueDate", v)} ro={ro} type="date" />
              <F label="НДС, %" v={h.vat} on={(v) => setH("vat", v)} ro={ro} ph="22" />
              <F label="Дата аванса" v={h.advanceDate} on={(v) => setH("advanceDate", v)} ro={ro} type="date" />
              <F label="Аванс, ₽" v={h.advance} on={(v) => setH("advance", v)} ro={ro} />
              <F label="Промежуточный платёж, ₽" v={h.interim} on={(v) => setH("interim", v)} ro={ro} />
            </div>
            {more.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-neutral-600">Другие ставки формата (пусто = 0)</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {more.map((c) => <F key={c.key} label={c.label} v={headerRate(h, c.key)} on={(v) => setRate(c.key, v)} ro={ro} ph={c.ph} />)}
                </div>
              </div>
            )}
          </div>
        </details>
      </Step>

      <Step n={2} title="Лоты" hint="как в аукционном счёте">
        {!ro && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setP((x) => ({ ...x, rows: [...x.rows, newRow(x)] }))}>+ строка</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setPaste((v) => !v)}>Вставить из Excel</Button>
            {uploadSlot}
          </div>
        )}
        {paste && !ro && (
          <div className="flex flex-col gap-2 rounded-md border border-dashed border-neutral-300 p-3">
            <Label>Скопируйте строки из Excel и вставьте сюда</Label>
            <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Порядок колонок: лот, мех, цвет/размер, кол-во, цена\n4\tСоболь\tтёмный 1\t30\t360"} />
            <div className="flex gap-2"><Button type="button" size="sm" onClick={applyPaste}>Добавить лоты</Button><Button type="button" size="sm" variant="ghost" onClick={() => { setPaste(false); setText(""); }}>Отмена</Button></div>
          </div>
        )}
        <Table className="min-w-[760px]">
          <Thead>
            <Tr>
              <Th className="w-20">Лот</Th><Th>Мех</Th><Th>Цвет / размер</Th><Th className="w-24">Кол-во</Th><Th className="w-28">Цена, {cur}</Th>
              <Th className="w-40 text-right text-neutral-500">Себестоимость за шкуру, ₽</Th><Th className="w-36 text-right text-neutral-500">За лот, ₽</Th>{!ro && <Th className="w-8" />}
            </Tr>
          </Thead>
          <Tbody>
            {p.rows.map((r, i) => {
              const c = t.calcs[i];
              const filled = rowFilled(r);
              return (
                <Tr key={r._id ?? i}>
                  {(["lot", "fur", "size", "qty", "price"] as const).map((k) => (
                    <Td key={k} className="p-1">
                      <input value={r[k] ?? ""} readOnly={ro} inputMode={k === "qty" || k === "price" ? "decimal" : "text"} aria-label={`${k} ${i + 1}`} onChange={(e) => setCell(i, k, e.target.value)} className={cellCls} />
                    </Td>
                  ))}
                  <Td className="whitespace-nowrap text-right tabular-nums text-neutral-600">{filled ? (c.ok ? money(c.unitRub) : <span className="text-xs text-red-600">{c.problems.join(", ")}</span>) : ""}</Td>
                  <Td className="whitespace-nowrap text-right tabular-nums text-neutral-600">{filled && c.ok ? money(c.totalRub) : ""}</Td>
                  {!ro && <Td className="p-1"><button type="button" className="px-2 text-neutral-400 hover:text-red-600" title="Убрать строку" onClick={() => setP((x) => ({ ...x, rows: x.rows.filter((_, j) => j !== i) }))}>×</button></Td>}
                </Tr>
              );
            })}
            {p.rows.length === 0 && <Tr><Td colSpan={8} className="py-6 text-center text-neutral-500">Лотов нет — нажмите «+ строка» или вставьте таблицу из Excel</Td></Tr>}
          </Tbody>
        </Table>
      </Step>

      <Step n={3} title="Расходы" hint="пусто = 0; серое — только пример">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {main.map((c) => <F key={c.key} label={c.label} v={headerRate(h, c.key)} on={(v) => setRate(c.key, v)} ro={ro} ph={c.ph} />)}
          <F label="Прочее, ₽ за шкуру" v={getOther(p)} on={(v) => setP((x) => setOther(x, v))} ro={ro} ph="например 50" />
        </div>
        {hasOtherExtras(p) && <p className="text-xs text-neutral-500">Есть и другие расходы — они учтены, править их можно в расширенном режиме.</p>}
        {missing.length > 0 && !ro && <p className="text-sm text-amber-800">Ставка не указана (считается как 0): {missing.join("; ")}.</p>}
      </Step>
    </>
  );
}
