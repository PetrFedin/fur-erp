"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { CreateDialog, useCreateDialog } from "@/components/create-dialog";
import { EditDialog, Field } from "@/components/edit-dialog";
import { DeleteEntityButton } from "@/components/delete-entity-button";
import { acceptAfterRework, addCustomShipmentLine, addShipmentLines, deleteShipmentLine, listShipmentCandidates, saveLineReworks, updateShipmentLine, type ReworkInput } from "../../actions";
import type { ShipmentCandidate } from "@/lib/shipment-data";
import { useUnsavedGuard } from "@/lib/use-unsaved-guard";
import { ACCEPT_NEEDS_READY, REWORK_STATE_LABEL, STAGE_LABEL, reworkRemainText, type ReworkState } from "@/lib/shipment-stage";
import { type LineEditValues, type LineRow } from "./shared";

/** «+ Добавить из ТЗ»: окно со списком позиций загруженных ТЗ (не отменённых). */
export function AddLinesButton({ shipmentId, asReady = false }: { shipmentId: string; asReady?: boolean }) {
  return (
    <CreateDialog label={asReady ? "+ Добавить артикул" : "+ Добавить из ТЗ"} title={asReady ? "Добавить артикул в список к приёмке" : "Добавить в отгрузку из ТЗ"} wide hint="Отметьте позиции и укажите, сколько штук входит в эту отгрузку. Цвет, размер и вид меха берутся из ТЗ.">
      <AddLinesBody shipmentId={shipmentId} asReady={asReady} />
    </CreateDialog>
  );
}

type PickState = { on: boolean; qty: string };

const defaultQty = (c: ShipmentCandidate) => Math.max(0, c.qtyTz - c.inOthers - c.inHere);

const sel = "h-9 max-md:h-10";

function AddLinesBody({ shipmentId, asReady }: { shipmentId: string; asReady: boolean }) {
  const dlg = useCreateDialog();
  const router = useRouter();
  const [cands, setCands] = useState<ShipmentCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, PickState>>({});
  const [q, setQ] = useState("");
  const [cu, setCu] = useState({ article: "", color: "", size: "", furKind: "", quantity: "1" });
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

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (cands ?? []).filter((c) => {
      const hay = [c.workOrder, c.label, c.article, c.color ?? "", c.size ?? "", c.furKind].join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [cands, q]);

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

  const hasCustom = cu.article.trim() !== "";
  const submit = () => {
    setError(null);
    const items = chosen.map((c) => ({ key: c.key, qty: Number(get(c).qty.replace(/\s/g, "")) }));
    if (items.length === 0 && !hasCustom) return setError("Отметьте хотя бы одну позицию или впишите свой артикул");
    if (items.some((i) => !Number.isInteger(i.qty) || i.qty <= 0)) return setError("У каждой отмеченной позиции количество — целое число больше 0");
    start(async () => {
      if (items.length > 0) {
        const r = await addShipmentLines(shipmentId, items, asReady);
        if (r.error) return setError(r.error);
      }
      if (hasCustom) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(cu)) fd.set(k, v);
        const r = await addCustomShipmentLine(shipmentId, fd, asReady);
        if (r.error) return setError(r.error);
      }
      router.refresh();
      dlg?.close();
    });
  };

  if (loadError) return <p role="alert" className="text-sm text-red-700">{loadError}</p>;
  if (!cands) return <p className="py-6 text-center text-sm text-neutral-500">Загружаем позиции ТЗ…</p>;

  return (
    <div className="flex flex-col gap-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: № ТЗ, артикул, цвет" aria-label="Поиск по позициям ТЗ" autoFocus />

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
                  <td className="px-2 py-1.5">{c.color ?? "–"}</td>
                  <td className="px-2 py-1.5">{c.size ?? "–"}</td>
                  <td className="px-2 py-1.5">{c.furKind || "–"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{c.qtyTz}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{c.inOthers + c.inHere || "–"}{c.inHere ? <span className="block text-[11px] text-neutral-500">из них здесь {c.inHere}</span> : null}</td>
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

      <details className="rounded-lg border border-neutral-200 px-3 py-2" open={hasCustom}>
        <summary className="cursor-pointer text-sm text-neutral-700">Нет в ТЗ? Добавить свой артикул</summary>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Field label="Артикул / название"><Input value={cu.article} maxLength={120} onChange={(e) => setCu({ ...cu, article: e.target.value })} /></Field>
          <Field label="Цвет"><Input value={cu.color} maxLength={80} onChange={(e) => setCu({ ...cu, color: e.target.value })} /></Field>
          <Field label="Размер"><Input value={cu.size} maxLength={40} onChange={(e) => setCu({ ...cu, size: e.target.value })} /></Field>
          <Field label="Вид меха"><Input value={cu.furKind} maxLength={80} onChange={(e) => setCu({ ...cu, furKind: e.target.value })} /></Field>
          <Field label="Шт."><Input value={cu.quantity} inputMode="numeric" onChange={(e) => setCu({ ...cu, quantity: e.target.value })} /></Field>
        </div>
      </details>

      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-xs text-neutral-600">Отмечено: {chosen.length + (hasCustom ? 1 : 0)} · {total + (hasCustom ? Number(cu.quantity) || 0 : 0)} шт.</span>
        <Button type="button" variant="ghost" onClick={dlg?.close} disabled={pending}>Отмена</Button>
        <Button type="button" onClick={submit} disabled={pending || (chosen.length === 0 && !hasCustom)}>{pending ? "Добавляем…" : "Добавить в отгрузку"}</Button>
      </div>
    </div>
  );
}

/** Правка строки отгрузки: количество, размер, принято, возврат, комментарий. */
export function LineEdit({ v }: { v: LineEditValues }) {
  return (
    <EditDialog title="Изменить строку отгрузки" hint={v.label} label="Изменить" action={updateShipmentLine.bind(null, v.id)}>
      <Field label="В отгрузке, шт.">
        <Input name="quantity" inputMode="numeric" required defaultValue={v.quantity} />
      </Field>
      <Field label="Размер">
        <Input name="size" maxLength={40} defaultValue={v.size} />
      </Field>
      <Field label="№ изделия" hint="Номер из списка, например 279">
        <Input name="itemNo" maxLength={60} defaultValue={v.itemNo} />
      </Field>
      <Field label="Стадия" hint="Меняется кнопками в таблице">
        <Input readOnly value={STAGE_LABEL[v.stage]} aria-readonly />
      </Field>
      <Field label="Принято, шт." hint={v.stage === "READY" ? "Пусто — ещё не отмечено" : ACCEPT_NEEDS_READY}>
        <Input name="acceptedQty" inputMode="numeric" defaultValue={v.accepted} readOnly={v.stage !== "READY"} />
      </Field>
      <Field label="Возврат, шт." hint="Возвращено подрядчику / не принято">
        <Input name="returnedQty" inputMode="numeric" defaultValue={v.returned} readOnly={v.stage !== "READY"} />
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

type ReworkDraft = { id?: string; text: string; state: ReworkState; note: string; meta?: string };

/** Окно «Что дорабатывать»: пункты (текст, состояние, комментарий «где доработка / что изменено»), новый пункт, «Принято после доработки». */
export function ReworkBody({ line }: { line: LineRow }) {
  const dlg = useCreateDialog();
  const router = useRouter();
  const init: ReworkDraft[] = line.reworks.map((r) => ({ id: r.id, text: r.text, state: r.state, note: r.note, meta: `${r.created}${r.updated ? ` · изменено: ${r.updated}` : ""}` }));
  const [items, setItems] = useState<ReworkDraft[]>(init);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const key = (xs: ReworkDraft[]) => JSON.stringify(xs.map((x) => [x.id ?? "", x.text, x.state, x.note]));
  const dirty = key(items) !== key(init);
  const guard = useUnsavedGuard(dirty);
  const payload = (): ReworkInput[] => items.map((x) => ({ id: x.id, text: x.text, state: x.state, note: x.note }));
  const upd = (i: number, patch: Partial<ReworkDraft>) => setItems((p) => p.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const remain = reworkRemainText(items.filter((x) => x.text.trim()));
  const canAccept = items.some((x) => x.text.trim()) && !remain;
  const save = () => {
    setError(null);
    start(async () => {
      const r = await saveLineReworks(line.id, payload());
      if (r.error) return setError(r.error);
      router.refresh();
      dlg?.close();
    });
  };
  const accept = () => {
    setError(null);
    start(async () => {
      const r = await acceptAfterRework(line.id, payload());
      if (r.error) return setError(r.error);
      router.refresh();
      dlg?.close();
    });
  };
  return (
    <div className="flex flex-col gap-3">
      {guard}
      {items.map((it, i) => (
        <div key={it.id ?? `new-${i}`} className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
          <Field label={`Пункт ${i + 1}: что именно дорабатывать`} wide>
            <Textarea rows={2} maxLength={1000} value={it.text} onChange={(e) => upd(i, { text: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Состояние">
              <Select value={it.state} onChange={(e) => upd(i, { state: e.target.value as ReworkState })}>
                {(Object.keys(REWORK_STATE_LABEL) as ReworkState[]).map((k) => <option key={k} value={k}>{REWORK_STATE_LABEL[k]}</option>)}
              </Select>
            </Field>
            <Field label="Комментарий: где доработка, что изменено">
              <Input maxLength={1000} value={it.note} onChange={(e) => upd(i, { note: e.target.value })} />
            </Field>
          </div>
          <div className="flex items-center justify-between text-[11px] text-neutral-500">
            <span>{it.meta ?? "новый пункт"}</span>
            <button type="button" className="text-red-700 hover:underline" onClick={() => setItems((p) => p.filter((_, k) => k !== i))}>Убрать пункт</button>
          </div>
        </div>
      ))}
      <div><Button type="button" variant="outline" size="sm" onClick={() => setItems((p) => [...p, { text: "", state: "OPEN", note: "" }])}>+ Добавить пункт</Button></div>
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!canAccept && <p className="text-xs text-neutral-600">«Принято после доработки» станет доступно, когда все пункты исправлены и приняты{remain ? ` (осталось — ${remain})` : ""}.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={dlg?.close} disabled={pending}>Отмена</Button>
        <Button type="button" variant="outline" onClick={save} disabled={pending || !dirty}>{pending ? "Сохраняем…" : "Сохранить"}</Button>
        <Button type="button" onClick={accept} disabled={pending || !canAccept}>Принято после доработки</Button>
      </div>
    </div>
  );
}
