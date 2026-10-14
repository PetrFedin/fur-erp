"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { CreateDialog, useCreateDialog } from "@/components/create-dialog";
import { EditDialog, Field } from "@/components/edit-dialog";
import { DeleteEntityButton } from "@/components/delete-entity-button";
import { addShipmentLines, deleteShipmentLine, listShipmentCandidates, saveLineAcceptance, updateShipmentLine } from "../actions";
import type { ShipmentCandidate } from "@/lib/shipment-data";
import { useUnsavedGuard } from "@/lib/use-unsaved-guard";
import { InfoHint } from "@/components/info-hint";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { Dash } from "@/components/tree-table";
import { TotalLabel } from "@/components/total-label";
import { acceptLineError } from "@/lib/shipment-calc";
import { formatQty } from "@/lib/utils";

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

export type LineEditValues = { id: string; label: string; quantity: number; size: string; comment: string; accepted: string; returned: string };

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
      <Field label="Принято, шт." hint="Пусто — ещё не отмечено">
        <Input name="acceptedQty" inputMode="numeric" defaultValue={v.accepted} />
      </Field>
      <Field label="Возврат, шт." hint="Возвращено поставщику / не принято">
        <Input name="returnedQty" inputMode="numeric" defaultValue={v.returned} />
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


// ───────────── таблица «Состав отгрузки» с приёмкой прямо в ячейках ─────────────

export type LineRow = {
  id: string;
  /** Номер строки в таблице (для сообщений об ошибках). */
  n: number;
  order: ReactNode;
  article: ReactNode;
  color: string | null;
  size: string | null;
  furKind: string | null;
  inTz: number | null;
  quantity: number;
  accepted: number | null;
  returned: number | null;
  comment: string;
  /** «ТЗ 182 · артикул · цвет · р. 44» — для окон и подтверждений. */
  label: string;
  /** Почему строку нельзя убрать (есть приёмка); null — можно. */
  blockedReason: string | null;
  /** Подписи для мобильной карточки. */
  title: ReactNode;
  href: string;
  subtitle: string;
};

type Draft = { accepted: string; returned: string; comment: string };
const baseOf = (r: LineRow): Draft => ({ accepted: r.accepted == null ? "" : String(r.accepted), returned: r.returned == null ? "" : String(r.returned), comment: r.comment });
const same = (a: Draft, b: Draft) => a.accepted === b.accepted && a.returned === b.returned && a.comment === b.comment;
const parseQty = (s: string): number | null | undefined => {
  const t = s.replace(/\s/g, "");
  if (t === "") return null;
  return /^\d+$/.test(t) ? Number(t) : undefined;
};
const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "строка" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "строки" : "строк");

/**
 * Состав отгрузки: «Принято», «Возврат» и «Комментарий» вносятся прямо в ячейках. Ввод копится как черновик по всем строкам
 * (без автосохранения); над и под таблицей появляется «Не сохранено: N строк» с кнопками «Сохранить» / «Отменить».
 * «Сохранить» пишет все изменённые строки одним действием.
 */
export function LinesTable({ shipmentId, rows, canEdit, addButton, hint }: { shipmentId: string; rows: LineRow[]; canEdit: boolean; addButton?: ReactNode; hint?: ReactNode }) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, Draft>>({});
  /** Только что сохранённое: показываем как основу, пока страница не принесла обновлённые данные. */
  const [committed, setCommitted] = useState<Record<string, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(true);

  // Пришли новые данные страницы: сохранённое больше не нужно держать отдельно, а совпавшие с ними черновики — тоже.
  const sig = rows.map((r) => `${r.id}:${r.quantity}:${r.accepted}:${r.returned}:${r.comment}`).join("|");
  const [prevSig, setPrevSig] = useState(sig);
  if (sig !== prevSig) {
    setPrevSig(sig);
    setCommitted({});
    setEdits((p) => Object.fromEntries(Object.entries(p).filter(([id, d]) => { const r = rows.find((x) => x.id === id); return r && !same(d, baseOf(r)); })));
  }

  const base = (r: LineRow) => committed[r.id] ?? baseOf(r);
  const cur = (r: LineRow) => edits[r.id] ?? base(r);
  const dirtyRows = rows.filter((r) => edits[r.id] && !same(edits[r.id], base(r)));
  const guard = useUnsavedGuard(dirtyRows.length > 0);

  const set = (r: LineRow, patch: Partial<Draft>) => {
    setError(null);
    setEdits((p) => {
      const next = { ...(p[r.id] ?? base(r)), ...patch };
      const n = { ...p };
      if (same(next, base(r))) delete n[r.id];
      else n[r.id] = next;
      return n;
    });
  };
  const acceptAll = () => {
    setError(null);
    setEdits((p) => {
      const n = { ...p };
      for (const r of rows) {
        const next = { ...(p[r.id] ?? base(r)), accepted: String(r.quantity), returned: "0" };
        if (same(next, base(r))) delete n[r.id];
        else n[r.id] = next;
      }
      return n;
    });
  };

  const rowError = (r: LineRow): string | null => {
    const d = cur(r);
    const a = parseQty(d.accepted), b = parseQty(d.returned);
    if (a === undefined || b === undefined) return "целые числа";
    const bad = acceptLineError(r.n, r.quantity, a, b);
    return bad ? bad.replace(/^Строка \d+: /, "") : null;
  };

  const save = () => {
    setError(null);
    for (const r of dirtyRows) {
      const e = rowError(r);
      if (e) return setError(`Строка ${r.n}: ${e}`);
    }
    const drafts = dirtyRows.map((r) => {
      const d = cur(r);
      return { id: r.id, n: r.n, accepted: parseQty(d.accepted) ?? null, returned: parseQty(d.returned) ?? null, comment: d.comment.trim() || null };
    });
    const snapshot = Object.fromEntries(dirtyRows.map((r) => [r.id, cur(r)]));
    start(async () => {
      const res = await saveLineAcceptance(shipmentId, drafts);
      if (res.error) return setError(res.error);
      setCommitted((p) => ({ ...p, ...snapshot }));
      setEdits((p) => { const n = { ...p }; for (const id of Object.keys(snapshot)) delete n[id]; return n; });
      router.refresh();
    });
  };

  const tot = rows.reduce(
    (t, r) => { const d = cur(r); return { q: t.q + r.quantity, a: t.a + (parseQty(d.accepted) ?? 0), b: t.b + (parseQty(d.returned) ?? 0) }; },
    { q: 0, a: 0, b: 0 },
  );

  const panel = dirtyRows.length > 0 && (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm" data-unsaved-panel>
      <span className="mr-auto font-medium text-amber-900">Не сохранено: {dirtyRows.length} {plural(dirtyRows.length)}</span>
      <Button type="button" size="sm" onClick={save} disabled={pending}>{pending ? "Сохраняем…" : "Сохранить"}</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => { setEdits({}); setError(null); }} disabled={pending}>Отменить</Button>
    </div>
  );
  const num = "h-8 w-20 text-right tabular-nums max-md:h-10";
  const cell = (r: LineRow) => {
    const d = cur(r);
    const err = rowError(r);
    const changed = !!edits[r.id];
    return { d, err, changed };
  };

  return (
    <section className="flex flex-col gap-2" aria-label="Состав отгрузки">
      {guard}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="block-title flex items-center gap-1">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-touch-ok className="inline-flex items-center gap-1 hover:text-neutral-700">
            <span aria-hidden className={"inline-block w-3 transition-transform " + (open ? "rotate-90" : "")}>›</span>
            Состав отгрузки
          </button>
          {hint ? <InfoHint label="О составе отгрузки">{hint}</InfoHint> : null}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && rows.length > 0 && open && <Button type="button" variant="outline" size="sm" onClick={acceptAll}>Принять всё</Button>}
          {canEdit && addButton}
        </div>
      </div>
      <div className={open ? "flex flex-col gap-2" : "hidden"}>
        {panel}
        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <ResponsiveRows
          table={
            <Table className="min-w-[1100px]">
              <Thead>
                <Tr>
                  <Th>ТЗ · поз.</Th>
                  <Th>Артикул</Th>
                  <Th>Цвет</Th>
                  <Th>Размер</Th>
                  <Th>Вид меха</Th>
                  <Th className="text-right" unit="шт.">В ТЗ</Th>
                  <Th className="text-right" unit="шт.">В отгрузке</Th>
                  <Th className="text-right" unit="шт.">Принято</Th>
                  <Th className="text-right" unit="шт.">Возврат</Th>
                  <Th>Комментарий</Th>
                  {canEdit && <Th>Изменить</Th>}
                  {canEdit && <Th>Убрать</Th>}
                </Tr>
              </Thead>
              <Tbody>
                {rows.map((r) => {
                  const { d, err, changed } = cell(r);
                  return (
                    <Tr key={r.id} className={changed ? "bg-amber-50/50" : ""}>
                      <Td className="whitespace-nowrap">{r.order}</Td>
                      <Td>{r.article}</Td>
                      <Td>{r.color ?? <Dash />}</Td>
                      <Td>{r.size ?? <Dash />}</Td>
                      <Td>{r.furKind ?? <Dash />}</Td>
                      <Td className="text-right tabular-nums">{r.inTz != null ? formatQty(r.inTz) : <Dash />}</Td>
                      <Td className="text-right font-medium tabular-nums">{formatQty(r.quantity)}</Td>
                      <Td className="text-right">
                        {canEdit ? (
                          <Input className={"ml-auto " + num + (err ? " border-red-400" : "")} inputMode="numeric" value={d.accepted} aria-label={`Принято, ${r.label}`} aria-invalid={!!err}
                            onChange={(e) => set(r, { accepted: e.target.value })} />
                        ) : d.accepted === "" ? <Dash /> : <span className="tabular-nums">{d.accepted}</span>}
                      </Td>
                      <Td className="text-right">
                        {canEdit ? (
                          <Input className={"ml-auto " + num + (err ? " border-red-400" : "")} inputMode="numeric" value={d.returned} aria-label={`Возврат, ${r.label}`} aria-invalid={!!err}
                            onChange={(e) => set(r, { returned: e.target.value })} />
                        ) : d.returned === "" ? <Dash /> : <span className="tabular-nums">{d.returned}</span>}
                        {err && <span className="mt-0.5 block whitespace-normal text-[11px] text-red-700">{err}</span>}
                      </Td>
                      <Td className="min-w-48">
                        {canEdit ? (
                          <Input className="h-8 max-md:h-10" maxLength={500} value={d.comment} aria-label={`Комментарий, ${r.label}`} placeholder="причина, замечание" onChange={(e) => set(r, { comment: e.target.value })} />
                        ) : <span className="text-xs text-neutral-600">{d.comment}</span>}
                      </Td>
                      {canEdit && (
                        <Td className="whitespace-nowrap">
                          <LineEdit v={{ id: r.id, label: r.label, quantity: r.quantity, size: r.size ?? "", comment: base(r).comment, accepted: base(r).accepted, returned: base(r).returned }} />
                        </Td>
                      )}
                      {canEdit && (
                        <Td className="whitespace-nowrap">
                          <LineDelete id={r.id} label={r.label} blockedReason={r.blockedReason} />
                          {r.blockedReason && <div className="text-[11px] text-neutral-500">есть приёмка</div>}
                        </Td>
                      )}
                    </Tr>
                  );
                })}
                {rows.length > 0 && (
                  <Tr className="row-total">
                    <Td colSpan={6} className="text-right"><TotalLabel unit="шт." /></Td>
                    <Td className="text-right tabular-nums">{formatQty(tot.q)}</Td>
                    <Td className="text-right tabular-nums">{formatQty(tot.a)}</Td>
                    <Td className="text-right tabular-nums">{formatQty(tot.b)}</Td>
                    <Td colSpan={canEdit ? 3 : 1} />
                  </Tr>
                )}
                {rows.length === 0 && (
                  <Tr>
                    <Td colSpan={canEdit ? 12 : 10} className="py-8 text-center text-neutral-500">Состав пока пуст{canEdit ? " — добавьте позиции кнопкой «+ Добавить из ТЗ»" : ""}</Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
          }
        >
          {rows.map((r) => {
            const { d, err } = cell(r);
            const m = "h-10 w-full text-right tabular-nums";
            return (
              <RowCard
                key={r.id}
                title={r.title}
                href={r.href}
                subtitle={r.subtitle}
                fields={[
                  { label: "В ТЗ, шт.", value: r.inTz != null ? formatQty(r.inTz) : "—" },
                  { label: "В отгрузке, шт.", value: formatQty(r.quantity), strong: true },
                  { label: "Принято, шт.", value: canEdit ? <Input className={m} inputMode="numeric" value={d.accepted} aria-label={`Принято, ${r.label}`} onChange={(e) => set(r, { accepted: e.target.value })} /> : d.accepted || "—" },
                  { label: "Возврат, шт.", value: canEdit ? <Input className={m} inputMode="numeric" value={d.returned} aria-label={`Возврат, ${r.label}`} onChange={(e) => set(r, { returned: e.target.value })} /> : d.returned || "—" },
                  { label: "Комментарий", value: canEdit ? <Input className="h-10" maxLength={500} value={d.comment} aria-label={`Комментарий, ${r.label}`} onChange={(e) => set(r, { comment: e.target.value })} /> : d.comment || "—" },
                ]}
                extra={
                  <>
                    {err && <p className="mb-1 text-xs text-red-700">{err}</p>}
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <LineEdit v={{ id: r.id, label: r.label, quantity: r.quantity, size: r.size ?? "", comment: base(r).comment, accepted: base(r).accepted, returned: base(r).returned }} />
                        <LineDelete id={r.id} label={r.label} blockedReason={r.blockedReason} />
                        {r.blockedReason && <span className="text-[11px] text-neutral-500">есть приёмка</span>}
                      </div>
                    )}
                  </>
                }
              />
            );
          })}
          {rows.length === 0 && <p className="py-6 text-center text-sm text-neutral-500">Состав пока пуст</p>}
        </ResponsiveRows>
        {panel}
      </div>
    </section>
  );
}
