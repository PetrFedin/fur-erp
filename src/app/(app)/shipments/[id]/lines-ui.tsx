"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { CreateDialog, useCreateDialog } from "@/components/create-dialog";
import { EditDialog, Field } from "@/components/edit-dialog";
import { DeleteEntityButton } from "@/components/delete-entity-button";
import { addShipmentLines, deleteShipmentLine, listShipmentCandidates, updateShipmentLine } from "../actions";
import type { ShipmentCandidate } from "@/lib/shipment-data";

/** «+ Добавить из ТЗ»: окно со списком позиций загруженных ТЗ (не отменённых). */
export function AddLinesButton({ shipmentId }: { shipmentId: string }) {
  return (
    <CreateDialog label="+ Добавить из ТЗ" title="Добавить в отгрузку из ТЗ" wide hint="Отметьте позиции и укажите, сколько штук входит в эту отгрузку. Цвет, размер и вид меха берутся из ТЗ.">
      <AddLinesBody shipmentId={shipmentId} />
    </CreateDialog>
  );
}

type PickState = { on: boolean; qty: string };
const defaultQty = (c: ShipmentCandidate) => Math.max(0, c.qtyTz - c.inOthers - c.inHere);
const sel = "h-9 max-md:h-10";

function AddLinesBody({ shipmentId }: { shipmentId: string }) {
  const dlg = useCreateDialog();
  const router = useRouter();
  const [cands, setCands] = useState<ShipmentCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, PickState>>({});
  const [f, setF] = useState({ tz: "", article: "", color: "", size: "", fur: "", batch: "" });
  const [moreOpen, setMoreOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    listShipmentCandidates(shipmentId).then(
      (r) => alive && setCands(r),
      () => alive && setLoadError("Не удалось загрузить позиции ТЗ. Закройте окно и откройте снова."),
    );
    return () => { alive = false; };
  }, [shipmentId]);

  const opts = useMemo(() => {
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "ru", { numeric: true }));
    const list = cands ?? [];
    return {
      color: uniq(list.map((c) => c.color)),
      size: uniq(list.map((c) => c.size)),
      fur: uniq(list.flatMap((c) => c.furKind.split(" + ").filter(Boolean))),
      batch: uniq(list.map((c) => (c.batchNumber != null ? String(c.batchNumber) : null))),
    };
  }, [cands]);

  const shown = useMemo(() => {
    const tz = f.tz.trim().toLowerCase();
    const art = f.article.trim().toLowerCase();
    return (cands ?? []).filter(
      (c) =>
        (!tz || c.workOrder.toLowerCase().includes(tz) || c.label.toLowerCase().includes(tz)) &&
        (!art || c.article.toLowerCase().includes(art)) &&
        (!f.color || c.color === f.color) &&
        (!f.size || c.size === f.size) &&
        (!f.fur || c.furKind.split(" + ").includes(f.fur)) &&
        (!f.batch || String(c.batchNumber) === f.batch),
    );
  }, [cands, f]);

  const get = (c: ShipmentCandidate): PickState => picks[c.key] ?? { on: false, qty: String(defaultQty(c)) };
  const set = (c: ShipmentCandidate, patch: Partial<PickState>) => setPicks((p) => ({ ...p, [c.key]: { ...get(c), ...patch } }));
  const chosen = (cands ?? []).filter((c) => get(c).on);
  const allShownOn = shown.length > 0 && shown.every((c) => get(c).on);
  const total = chosen.reduce((s, c) => s + (Number(get(c).qty) || 0), 0);

  const toggleAll = (on: boolean) =>
    setPicks((p) => {
      const n = { ...p };
      for (const c of shown) n[c.key] = { qty: p[c.key]?.qty ?? String(defaultQty(c)), on };
      return n;
    });

  const submit = () => {
    setError(null);
    const items = chosen.map((c) => ({ key: c.key, qty: Number(get(c).qty.replace(/\s/g, "")) }));
    if (items.length === 0) return setError("Отметьте хотя бы одну позицию");
    if (items.some((i) => !Number.isInteger(i.qty) || i.qty <= 0)) return setError("У каждой отмеченной позиции количество — целое число больше 0");
    start(async () => {
      const r = await addShipmentLines(shipmentId, items);
      if (r.error) return setError(r.error);
      router.refresh();
      dlg?.close();
    });
  };

  if (loadError) return <p role="alert" className="text-sm text-red-700">{loadError}</p>;
  if (!cands) return <p className="py-6 text-center text-sm text-neutral-500">Загружаем позиции ТЗ…</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Field label="№ ТЗ"><Input value={f.tz} onChange={(e) => setF({ ...f, tz: e.target.value })} placeholder="182" /></Field>
        <Field label="Артикул"><Input value={f.article} onChange={(e) => setF({ ...f, article: e.target.value })} /></Field>
        <Field label="Цвет"><Pick2 value={f.color} onChange={(v) => setF({ ...f, color: v })} options={opts.color} /></Field>
        <Field label="Размер"><Pick2 value={f.size} onChange={(v) => setF({ ...f, size: v })} options={opts.size} /></Field>
        <Field label="Вид меха"><Pick2 value={f.fur} onChange={(v) => setF({ ...f, fur: v })} options={opts.fur} /></Field>
      </div>
      <div>
        <button type="button" className="text-xs text-neutral-600 hover:underline" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
          {moreOpen ? "Скрыть" : "Показать ещё"} {moreOpen ? "▴" : "▾"}
        </button>
        {moreOpen && (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Field label="Партия пошива"><Pick2 value={f.batch} onChange={(v) => setF({ ...f, batch: v })} options={opts.batch} /></Field>
          </div>
        )}
      </div>

      <div className="max-h-[48vh] overflow-auto rounded-lg border border-neutral-200">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="sticky top-0 bg-neutral-50 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-2 py-2">
                <input type="checkbox" aria-label="Отметить все показанные" checked={allShownOn} onChange={(e) => toggleAll(e.target.checked)} />
              </th>
              <th className="px-2 py-2">ТЗ · поз.</th>
              <th className="px-2 py-2">Артикул</th>
              <th className="px-2 py-2">Цвет</th>
              <th className="px-2 py-2">Размер</th>
              <th className="px-2 py-2">Вид меха</th>
              <th className="px-2 py-2 text-right">В ТЗ, шт.</th>
              <th className="px-2 py-2 text-right">В других отгрузках, шт.</th>
              <th className="px-2 py-2 text-right">В эту отгрузку, шт.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {shown.map((c) => {
              const p = get(c);
              const over = p.on && c.inOthers + c.inHere + (Number(p.qty) || 0) > c.qtyTz;
              return (
                <tr key={c.key} className={p.on ? "bg-amber-50/40" : ""}>
                  <td className="px-2 py-1.5"><input type="checkbox" aria-label={`Выбрать ${c.label}`} checked={p.on} onChange={(e) => set(c, { on: e.target.checked })} /></td>
                  <td className="whitespace-nowrap px-2 py-1.5">{c.label}</td>
                  <td className="px-2 py-1.5">{c.article}</td>
                  <td className="px-2 py-1.5">{c.color ?? "—"}</td>
                  <td className="px-2 py-1.5">{c.size ?? "—"}</td>
                  <td className="px-2 py-1.5">{c.furKind || "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{c.qtyTz}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{c.inOthers + c.inHere || "—"}{c.inHere ? <span className="block text-[11px] text-neutral-500">из них здесь {c.inHere}</span> : null}</td>
                  <td className="px-2 py-1.5 text-right">
                    <Input className={"ml-auto w-24 text-right tabular-nums " + sel} inputMode="numeric" value={p.qty} aria-label={`Количество, ${c.label}`}
                      onChange={(e) => set(c, { qty: e.target.value, on: p.on || e.target.value !== "" })} />
                    {over && <span className="mt-0.5 block text-[11px] text-amber-700">больше, чем в ТЗ ({c.qtyTz})</span>}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={9} className="px-2 py-6 text-center text-neutral-500">{cands.length ? "Ничего не найдено" : "Загруженных ТЗ пока нет"}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-xs text-neutral-600">Отмечено: {chosen.length} · {total} шт.</span>
        <Button type="button" variant="ghost" onClick={dlg?.close} disabled={pending}>Отмена</Button>
        <Button type="button" onClick={submit} disabled={pending || chosen.length === 0}>{pending ? "Добавляем…" : "Добавить в отгрузку"}</Button>
      </div>
    </div>
  );
}

function Pick2({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Все</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </Select>
  );
}

export type LineEditValues = { id: string; label: string; quantity: number; size: string; comment: string };

/** Правка строки отгрузки: количество, размер, комментарий. */
export function LineEdit({ v }: { v: LineEditValues }) {
  return (
    <EditDialog title="Изменить строку отгрузки" hint={v.label} label="Изменить" action={updateShipmentLine.bind(null, v.id)}>
      <Field label="В этой отгрузке, шт.">
        <Input name="quantity" inputMode="numeric" required defaultValue={v.quantity} />
      </Field>
      <Field label="Размер">
        <Input name="size" maxLength={40} defaultValue={v.size} />
      </Field>
      <Field label="Комментарий" wide>
        <Input name="comment" maxLength={500} defaultValue={v.comment} />
      </Field>
    </EditDialog>
  );
}

export function LineDelete({ id, label, blockedReason }: { id: string; label: string; blockedReason: string | null }) {
  return <DeleteEntityButton variant="ghost" confirmText={`Убрать из отгрузки: ${label}?`} label="Убрать" action={deleteShipmentLine.bind(null, id)} blockedReason={blockedReason} showReason={false} />;
}
