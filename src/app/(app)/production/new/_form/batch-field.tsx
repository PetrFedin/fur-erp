"use client";
import { Input, Select } from "@/components/ui/input";
import { Field } from "./parts";

type BatchOpt = { id: string; number: number; label: string; empty?: boolean; tz?: string[] };

/** Поле «Партия пошива»: поиск, выбор из списка или новая партия по номеру. */
export function BatchField({ batches, batchSel, setBatchSel, batchNew, setBatchNew, batchQuery, setBatchQuery, onBatch }: {
  batches: BatchOpt[];
  batchSel: string;
  setBatchSel: (v: string) => void;
  batchNew: string;
  setBatchNew: (v: string) => void;
  batchQuery: string;
  setBatchQuery: (v: string) => void;
  onBatch: (v: string, newNum?: string) => void;
}) {
  return (
    <Field label="Партия пошива" hint="Партия поставки. Партия 6 — без надбавки 4 %. Можно выбрать из списка или завести новую по номеру.">
      {batches.length > 8 ? (
        <Input className="mb-1" placeholder="Поиск партии: номер или год" aria-label="Поиск партии пошива" value={batchQuery} onChange={(e) => setBatchQuery(e.target.value)} />
      ) : null}
      <Select value={batchSel} onChange={(e) => { setBatchSel(e.target.value); onBatch(e.target.value); }} aria-label="Партия пошива">
        <option value="">Партия не указана</option>
        {batches
          .filter((b) => b.id === batchSel || (!b.empty && (!batchQuery.trim() || b.label.toLowerCase().includes(batchQuery.trim().toLowerCase()))))
          .map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        <option value="__new__">＋ Новая партия…</option>
      </Select>
      {batchSel === "__new__" && (
        <Input className="mt-1" inputMode="numeric" placeholder="Номер новой партии" aria-label="Номер новой партии" value={batchNew} onChange={(e) => { setBatchNew(e.target.value); onBatch("__new__", e.target.value); }} />
      )}
      {batchSel === "__new__" && batchNew.trim() !== "" && (() => {
        const hit = batches.find((b) => b.number === Number(batchNew));
        return hit ? (
          <p className="mt-1 text-xs text-amber-700" data-batch-hint>Партия {hit.number} уже есть: {hit.tz && hit.tz.length ? `ТЗ ${hit.tz.join(", ")}` : "ТЗ пока нет"}. <button type="button" className="underline" onClick={() => { setBatchSel(hit.id); onBatch(hit.id); }}>Выбрать её</button></p>
        ) : (
          <p className="mt-1 text-xs text-amber-700" data-batch-hint>Партии {batchNew.trim()} ещё нет — будет создана новая.</p>
        );
      })()}
      {batchSel && batchSel !== "__new__" && (() => {
        const hit = batches.find((b) => b.id === batchSel);
        return hit && hit.tz && hit.tz.length ? <p className="mt-1 text-xs text-neutral-500">Партия {hit.number}: ТЗ {hit.tz.join(", ")}</p> : null;
      })()}
    </Field>
  );
}
