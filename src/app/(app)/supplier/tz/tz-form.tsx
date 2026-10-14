"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { emptyItem, emptyMaterial, defaultTerms, tzTotals, type TzKind, type TzPayload, TZ_KIND_LABEL } from "@/lib/tz-vendor";
import { deleteTzDraft, saveTzDraft, sendTz } from "./actions";

const money = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export type LotOpt = { id: string; lot: string; material: string; color: string; remaining: string };

export function TzForm({ id, initial, readOnly, colors, models, lots, batches, reviewNote }: { id: string | null; initial: TzPayload; readOnly: boolean; colors: string[]; models: string[]; lots: LotOpt[]; batches: { value: string; label: string }[]; reviewNote?: string | null }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const t = useMemo(() => tzTotals(p), [p]);
  const ro = readOnly;
  const repair = p.kind === "REPAIR";

  const setItem = (i: number, k: string, v: string) => setP((x) => ({ ...x, items: x.items.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  const setMat = (i: number, k: string, v: string) => setP((x) => ({ ...x, materials: x.materials.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  const setTerm = (k: keyof TzPayload["terms"], v: string) => setP((x) => ({ ...x, terms: { ...x.terms, [k]: v } }));
  const setSigner = (k: keyof TzPayload["signers"], v: string) => setP((x) => ({ ...x, signers: { ...x.signers, [k]: v } }));

  const run = (fn: () => Promise<{ error?: string; id?: string }>, okText: string, after?: (r: { id?: string }) => void) =>
    start(async () => {
      const r = await fn();
      if (r.error) setMsg({ text: r.error, bad: true });
      else { setMsg({ text: okText }); after?.(r); }
    });
  const save = () => run(() => saveTzDraft(id, JSON.stringify(p)), "Черновик сохранён", (r) => { if (!id && r.id) router.replace(`/supplier/tz/${r.id}`); else router.refresh(); });
  const send = () => {
    if (!confirm("Отправить ТЗ нам? После отправки править его нельзя.")) return;
    run(async () => {
      const saved = id ? { id } : await saveTzDraft(null, JSON.stringify(p));
      if ("error" in saved && saved.error) return saved;
      return sendTz(saved.id!, JSON.stringify(p));
    }, "Отправлено", (r) => router.replace(`/supplier/tz/${r.id ?? id}`));
  };
  const download = () =>
    start(async () => {
      const res = await fetch(`/api/supplier/tz/${id ?? "new"}/docx`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
      if (!res.ok) return setMsg({ text: "Не удалось сформировать Word", bad: true });
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `ПРИЛОЖЕНИЕ ${p.number}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    });
  const addLot = (lotId: string) => {
    const l = lots.find((x) => x.id === lotId);
    if (!l) return;
    setP((x) => ({ ...x, materials: [...x.materials, { ...emptyMaterial(), name: `${l.material}${l.color ? " " + l.color : ""}`, lot: l.lot }] }));
  };

  const cellInput = (v: string, on: (v: string) => void, w: number, list?: string, num = false) => (
    <input value={v} readOnly={ro} list={list} inputMode={num ? "decimal" : "text"} onChange={(e) => on(e.target.value)} style={{ width: w }}
      className="h-8 rounded border border-neutral-200 bg-white px-1.5 text-sm tabular-nums read-only:border-transparent read-only:bg-transparent" />
  );

  return (
    <div className="flex flex-col gap-5">
      {reviewNote && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">Комментарий проверяющего: {reviewNote}</div>}
      <datalist id="tz-colors">{colors.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="tz-models">{models.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Вид</Label>
          <Select value={p.kind} disabled={ro} onChange={(e) => setP((x) => ({ ...x, kind: e.target.value as TzKind, terms: defaultTerms(e.target.value as TzKind) }))}>
            {(Object.keys(TZ_KIND_LABEL) as TzKind[]).map((k) => <option key={k} value={k}>{TZ_KIND_LABEL[k]}</option>)}
          </Select>
        </div>
        <F label="Номер ТЗ (= номер приложения)" v={p.number} on={(v) => setP((x) => ({ ...x, number: v }))} ro={ro} />
        <F label="Дата" v={p.date} on={(v) => setP((x) => ({ ...x, date: v }))} ro={ro} type="date" />
        <F label="Город" v={p.city} on={(v) => setP((x) => ({ ...x, city: v }))} ro={ro} />
        <F label="Договор подряда" v={p.contract} on={(v) => setP((x) => ({ ...x, contract: v }))} ro={ro} />
        <F label="Заказчик" v={p.customer} on={(v) => setP((x) => ({ ...x, customer: v }))} ro={ro} />
        <div>
          <Label>Партия</Label>
          <Input value={p.batch} readOnly={ro} list="tz-batches" placeholder="номер, например 22" inputMode="numeric" onChange={(e) => setP((x) => ({ ...x, batch: e.target.value }))} />
          <datalist id="tz-batches">{batches.map((b) => <option key={b.value} value={b.value} label={b.label} />)}</datalist>
          <p className="mt-0.5 text-[11px] text-neutral-500">Выберите из списка или впишите номер новой партии.</p>
        </div>
        <F label="НДС, %" v={p.vatPct} on={(v) => setP((x) => ({ ...x, vatPct: v }))} ro={ro} />
      </div>

      <h2 className="text-sm font-semibold">{repair ? "Услуги" : "Изделия"} — каждое изделие отдельной строкой</h2>
      <Table className="min-w-[1000px]">
        <Thead><Tr>
          <Th>№</Th><Th>{repair ? "Наименование услуги" : "Наименование Продукции"}</Th><Th>Цвет</Th><Th>Модель</Th><Th>Материал Продукции</Th><Th>Размер</Th><Th>Подкладка</Th><Th>Количество</Th>
          <Th title="сколько шкур уходит на одно изделие">Расход шкур на изделие</Th><Th>Стоимость работ за ед., ₽</Th><Th>{repair ? "Стоимость материала" : "Стоимость продукции"} за ед., ₽</Th><Th className="text-right">ИТОГО, ₽</Th>{!ro && <Th />}
        </Tr></Thead>
        <Tbody>
          {p.items.map((r, i) => (
            <Tr key={i}>
              <Td className="text-neutral-500">{i + 1}</Td>
              <Td className="p-1">{cellInput(r.name, (v) => setItem(i, "name", v), 150)}</Td>
              <Td className="p-1">{cellInput(r.color, (v) => setItem(i, "color", v), 90, "tz-colors")}</Td>
              <Td className="p-1">{cellInput(r.model, (v) => setItem(i, "model", v), 80, "tz-models")}</Td>
              <Td className="p-1">{cellInput(r.material, (v) => setItem(i, "material", v), 150)}</Td>
              <Td className="p-1">{cellInput(r.size, (v) => setItem(i, "size", v), 55)}</Td>
              <Td className="p-1">{cellInput(r.lining, (v) => setItem(i, "lining", v), 120)}</Td>
              <Td className="p-1">{cellInput(r.qty, (v) => setItem(i, "qty", v), 55, undefined, true)}</Td>
              <Td className="p-1">{cellInput(r.pelts, (v) => setItem(i, "pelts", v), 60, undefined, true)}</Td>
              <Td className="p-1">{cellInput(r.work, (v) => setItem(i, "work", v), 80, undefined, true)}</Td>
              <Td className="p-1">{cellInput(r.price, (v) => setItem(i, "price", v), 90, undefined, true)}</Td>
              <Td className="whitespace-nowrap text-right tabular-nums">{money(t.itemTotals[i] ?? 0)}</Td>
              {!ro && <Td className="p-1"><button type="button" className="px-1 text-neutral-400 hover:text-red-600" title="Убрать" onClick={() => setP((x) => ({ ...x, items: x.items.filter((_, j) => j !== i) }))}>×</button></Td>}
            </Tr>
          ))}
          <Tr><Td colSpan={7} className="font-semibold">Итого:</Td><Td className="font-semibold tabular-nums">{t.qty}</Td><Td className="tabular-nums text-neutral-600">{t.pelts ? `${t.pelts} шк.` : ""}</Td><Td className="font-semibold tabular-nums">{money(t.work)}</Td><Td /><Td className="text-right font-semibold tabular-nums">{money(t.total)}</Td>{!ro && <Td />}</Tr>
        </Tbody>
      </Table>
      {!ro && (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setP((x) => ({ ...x, items: [...x.items, { ...(x.items.at(-1) ?? emptyItem()) }] }))}>+ Изделие (копия последнего)</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setP((x) => ({ ...x, items: [...x.items, emptyItem()] }))}>+ Пустая строка</Button>
        </div>
      )}

      <h2 className="text-sm font-semibold">Заказчик передал (сырьё, материалы)</h2>
      <Table className="min-w-[800px]">
        <Thead><Tr><Th>Наименование материалов</Th><Th>Лот</Th><Th>Единица</Th><Th>Количество сырья</Th><Th>Стоимость за единицу в рублях без НДС</Th><Th>НДС, %</Th><Th className="text-right">Общая стоимость, ₽</Th>{!ro && <Th />}</Tr></Thead>
        <Tbody>
          {p.materials.map((m, i) => (
            <Tr key={i}>
              <Td className="p-1">{cellInput(m.name, (v) => setMat(i, "name", v), 240)}</Td>
              <Td className="p-1">{cellInput(m.lot, (v) => setMat(i, "lot", v), 80)}</Td>
              <Td className="p-1">{cellInput(m.unit, (v) => setMat(i, "unit", v), 70)}</Td>
              <Td className="p-1">{cellInput(m.qty, (v) => setMat(i, "qty", v), 70, undefined, true)}</Td>
              <Td className="p-1">{cellInput(m.priceNet, (v) => setMat(i, "priceNet", v), 100, undefined, true)}</Td>
              <Td className="p-1">{cellInput(m.vatPct, (v) => setMat(i, "vatPct", v), 55, undefined, true)}</Td>
              <Td className="whitespace-nowrap text-right tabular-nums">{money(t.matTotals[i] ?? 0)}</Td>
              {!ro && <Td className="p-1"><button type="button" className="px-1 text-neutral-400 hover:text-red-600" onClick={() => setP((x) => ({ ...x, materials: x.materials.filter((_, j) => j !== i) }))}>×</button></Td>}
            </Tr>
          ))}
          <Tr><Td colSpan={6} className="font-semibold">ИТОГО:</Td><Td className="text-right font-semibold tabular-nums">{money(t.materials)}</Td>{!ro && <Td />}</Tr>
        </Tbody>
      </Table>
      {!ro && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setP((x) => ({ ...x, materials: [...x.materials, emptyMaterial()] }))}>+ Материал</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setP((x) => ({ ...x, materials: [...x.materials, { ...emptyMaterial(), name: "Подкладка", unit: "Метр" }] }))}>+ Подкладка</Button>
          <Select className="w-80" value="" onChange={(e) => addLot(e.target.value)}>
            <option value="">Добавить наш лот из остатков…</option>
            {lots.map((l) => <option key={l.id} value={l.id}>{l.lot || "без номера"} · {l.material}{l.color ? ` · ${l.color}` : ""} · остаток {l.remaining}</option>)}
          </Select>
        </div>
      )}

      <h2 className="text-sm font-semibold">Условия</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <F label="Порядок оплаты" v={p.terms.payment} on={(v) => setTerm("payment", v)} ro={ro} />
        <F label="Срок завершения Работ (не позднее)" v={p.terms.deadline} on={(v) => setTerm("deadline", v)} ro={ro} type="date" />
        <F label="Срок поставки Продукции" v={p.terms.delivery} on={(v) => setTerm("delivery", v)} ro={ro} />
        <F label="Место поставки/самовывоза" v={p.terms.place} on={(v) => setTerm("place", v)} ro={ro} />
        <F label="Способ поставки" v={p.terms.method} on={(v) => setTerm("method", v)} ro={ro} />
        <F label="Иные характеристики Продукции" v={p.terms.other} on={(v) => setTerm("other", v)} ro={ro} />
        <F label="Заказчик — должность" v={p.signers.customerPost} on={(v) => setSigner("customerPost", v)} ro={ro} />
        <F label="Заказчик — подписант" v={p.signers.customerName} on={(v) => setSigner("customerName", v)} ro={ro} />
        <F label="Подрядчик — должность" v={p.signers.contractorPost} on={(v) => setSigner("contractorPost", v)} ro={ro} />
        <F label="Подрядчик — подписант" v={p.signers.contractorName} on={(v) => setSigner("contractorName", v)} ro={ro} />
      </div>
      <p className="text-sm font-semibold">Общая стоимость ТЗ: <span className="tabular-nums">{money(t.total)}</span> руб. в т.ч. НДС {p.vatPct}%</p>

      <div className="flex flex-wrap items-center gap-2">
        {!ro && <Button type="button" disabled={pending} onClick={save}>Сохранить черновик</Button>}
        {!ro && <Button type="button" variant="outline" disabled={pending} onClick={send}>Отправить нам</Button>}
        <Button type="button" variant="outline" disabled={pending} onClick={download}>Скачать Word</Button>
        {!ro && id && <Button type="button" variant="ghost" disabled={pending} onClick={() => { if (confirm("Удалить черновик?")) run(() => deleteTzDraft(id), "Удалено", () => router.replace("/supplier/tz")); }}>Удалить черновик</Button>}
      </div>
      {msg && <p role="status" className={msg.bad ? "text-sm text-red-600" : "text-sm text-green-700"}>{msg.text}</p>}
    </div>
  );
}

function F({ label, v, on, ro, type }: { label: string; v: string; on: (v: string) => void; ro: boolean; type?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input value={v} readOnly={ro} type={type} onChange={(e) => on(e.target.value)} />
    </div>
  );
}
