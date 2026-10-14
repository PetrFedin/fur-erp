"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/confirm-dialog";
import { CreateDialog, useCreateDialog } from "@/components/create-dialog";
import { EditDialog, Field } from "@/components/edit-dialog";
import { DeleteEntityButton } from "@/components/delete-entity-button";
import { acceptAfterRework, acceptAllOnReview, acceptLinesByReview, addShipmentLines, deleteShipmentLine, listShipmentCandidates, saveLineAcceptance, saveLineReworks, sendLineToRework, updateShipmentLine, type ReworkInput } from "../actions";
import type { ShipmentCandidate } from "@/lib/shipment-data";
import { useUnsavedGuard } from "@/lib/use-unsaved-guard";
import { InfoHint } from "@/components/info-hint";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { Dash } from "@/components/tree-table";
import { TotalLabel } from "@/components/total-label";
import { formatQty } from "@/lib/utils";
import { ACCEPT_NEEDS_READY, REWORK_STATE_LABEL, STAGE_LABEL, VIEW_LABEL, lineView, reworkRemainText, rowsText, type ReworkState, type Stage, type ViewKey } from "@/lib/shipment-stage";

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

export type LineEditValues = { id: string; label: string; quantity: number; size: string; comment: string; accepted: string; returned: string; itemNo: string; stage: Stage };

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
      <Field label="Возврат, шт." hint="Возвращено поставщику / не принято">
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


// ───────────── стадии: просмотр → доработка → готов к отгрузке ─────────────

export type ReworkRow = { id: string; text: string; state: ReworkState; note: string; created: string; updated: string };

type ReworkDraft = { id?: string; text: string; state: ReworkState; note: string; meta?: string };

/** Окно «На доработку» / «Вернуть на доработку»: обязателен первый пункт «что именно»; можно добавить несколько пунктов. */
function SendReworkBody({ line, returning }: { line: LineRow; returning: boolean }) {
  const dlg = useCreateDialog();
  const router = useRouter();
  const [items, setItems] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const guard = useUnsavedGuard(items.some((x) => x.trim() !== ""));
  const submit = () => {
    setError(null);
    if (!items[0]?.trim()) return setError("Укажите, что именно нужно доработать");
    start(async () => {
      const r = await sendLineToRework(line.id, items.map((text) => ({ text, state: "OPEN", note: "" })));
      if (r.error) return setError(r.error);
      router.refresh();
      dlg?.close();
    });
  };
  return (
    <div className="flex flex-col gap-3">
      {guard}
      {items.map((t, i) => (
        <Field key={i} label={i === 0 ? (returning ? "Причина возврата: что именно доработать" : "Что именно доработать") : `Пункт ${i + 1}`} wide>
          <Textarea rows={2} maxLength={1000} value={t} autoFocus={i === 0} onChange={(e) => setItems((p) => p.map((x, k) => (k === i ? e.target.value : x)))} />
        </Field>
      ))}
      <div><Button type="button" variant="outline" size="sm" onClick={() => setItems((p) => [...p, ""])}>+ Ещё пункт</Button></div>
      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={dlg?.close} disabled={pending}>Отмена</Button>
        <Button type="button" onClick={submit} disabled={pending}>{pending ? "Сохраняем…" : returning ? "Вернуть на доработку" : "Отправить на доработку"}</Button>
      </div>
    </div>
  );
}

/** Окно «Что дорабатывать»: пункты (текст, состояние, комментарий «где доработка / что изменено»), новый пункт, «Принято после доработки». */
function ReworkBody({ line }: { line: LineRow }) {
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

type SegKey = "all" | ViewKey;
const SEGMENTS: SegKey[] = ["all", "review", "rework", "ready", "accepted", "rejected"];

// ───────────── таблица «Состав отгрузки» с приёмкой прямо в ячейках ─────────────

export type LineRow = {
  id: string;
  /** Номер строки в таблице (для сообщений об ошибках). */
  n: number;
  order: ReactNode;
  article: ReactNode;
  /** Текстом: для поиска. */
  orderText: string;
  articleText: string;
  itemNo: string;
  stage: Stage;
  /** «кто, когда» последней смены стадии. */
  stageNote: string;
  reworks: ReworkRow[];
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

const parseQty = (s: string): number | null | undefined => {
  const t = s.replace(/\s/g, "");
  if (t === "") return null;
  return /^\d+$/.test(t) ? Number(t) : undefined;
};

/**
 * Состав отгрузки: список с примерки. У каждой строки стадия («Принято» по просмотру / «На доработку»), поиск, фильтр по стадии
 * и счётчики. Приёмка в Коптево (принято / не принято) — отдельный блок AcceptList под составом.
 */
export function LinesTable({ shipmentId, rows, canEdit, addButton, hint }: { shipmentId: string; rows: LineRow[]; canEdit: boolean; addButton?: ReactNode; hint?: ReactNode }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");
  const [seg, setSeg] = useState<SegKey>("all");
  const { ask, node: confirmNode } = useConfirm();

  const viewOf = (r: LineRow) => lineView({ stage: r.stage, quantity: r.quantity, acceptedQty: r.accepted, returnedQty: r.returned });
  const counts = rows.reduce<Record<ViewKey, number>>((c, r) => { c[viewOf(r).key]++; return c; }, { review: 0, rework: 0, ready: 0, accepted: 0, rejected: 0 });

  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (seg !== "all" && viewOf(r).key !== seg) return false;
    if (!needle) return true;
    return [r.itemNo, r.orderText, r.articleText, r.color ?? ""].some((x) => x.toLowerCase().includes(needle));
  });

  const acceptReview = (r: LineRow) => {
    setError(null);
    start(async () => {
      const res = await acceptLinesByReview(shipmentId, [r.id]);
      if (res.error) return setError(res.error);
      router.refresh();
    });
  };
  const acceptAllReview = async () => {
    setError(null);
    const n = counts.review;
    if (!(await ask(`Принять по просмотру ${rowsText(n)}? Товар просмотрен и полностью устраивает. В хронологии появится один этап.`, { ok: "Принято" }))) return;
    start(async () => {
      const res = await acceptAllOnReview(shipmentId);
      if (res.error) return setError(res.error);
      router.refresh();
    });
  };

  const totQty = rows.reduce((t, r) => t + r.quantity, 0);

  /** Статус строки и кнопки действий по стадии. */
  const stageCell = (r: LineRow) => {
    const v = viewOf(r);
    const openN = r.reworks.filter((x) => x.state !== "DONE").length;
    return (
      <div className="flex flex-col items-start gap-1" title={r.stageNote || undefined}>
        <Badge variant={v.variant}>{v.label}</Badge>
        {v.sub && <span className="text-[11px] text-neutral-600">{v.sub}</span>}
        {r.stage === "REWORK" && <span className="text-[11px] text-neutral-600">пунктов: {r.reworks.length}, не принято: {openN}</span>}
        {canEdit && r.stage === "REVIEW" && (
          <div className="flex flex-wrap gap-1">
            <Button type="button" size="sm" onClick={() => acceptReview(r)} disabled={pending} title="Товар просмотрен и полностью устраивает">Принято</Button>
            <CreateDialog label="На доработку" title="Отправить на доработку" hint={r.label} size="sm" variant="outline"><SendReworkBody line={r} returning={false} /></CreateDialog>
          </div>
        )}
        {canEdit && r.stage === "REWORK" && (
          <CreateDialog label="Что дорабатывать" title="Что дорабатывать" hint={r.label} size="sm" variant="outline" wide><ReworkBody line={r} /></CreateDialog>
        )}
        {canEdit && r.stage === "READY" && r.accepted == null && r.returned == null && (
          <CreateDialog label="Вернуть на доработку" title="Вернуть на доработку" hint={r.label} size="sm" variant="ghost"><SendReworkBody line={r} returning /></CreateDialog>
        )}
      </div>
    );
  };
  const editValues = (r: LineRow): LineEditValues => ({ id: r.id, label: r.label, quantity: r.quantity, size: r.size ?? "", comment: r.comment, accepted: r.accepted == null ? "" : String(r.accepted), returned: r.returned == null ? "" : String(r.returned), itemNo: r.itemNo, stage: r.stage });

  return (
    <section className="flex flex-col gap-2" aria-label="Состав отгрузки">
      {confirmNode}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="block-title flex items-center gap-1">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-touch-ok className="inline-flex items-center gap-1 hover:text-neutral-700">
            <span aria-hidden className={"inline-block w-3 transition-transform " + (open ? "rotate-90" : "")}>›</span>
            Состав отгрузки
          </button>
          {hint ? <InfoHint label="О составе отгрузки">{hint}</InfoHint> : null}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && counts.review > 0 && open && <Button type="button" variant="outline" size="sm" onClick={() => void acceptAllReview()} disabled={pending}>Принято всё, что на просмотре</Button>}
          {canEdit && addButton}
        </div>
      </div>
      <div className={open ? "flex flex-col gap-2" : "hidden"}>
        <p className="text-xs text-neutral-600" data-stage-counts>
          {(["review", "rework", "ready", "accepted", "rejected"] as ViewKey[]).map((k) => `${VIEW_LABEL[k]} ${counts[k]}`).join(" · ")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="h-8 w-56 max-md:h-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: №, ТЗ, артикул, цвет" aria-label="Поиск по составу отгрузки" />
          <div className="flex flex-wrap gap-1" role="group" aria-label="Фильтр по стадии">
            {SEGMENTS.map((k) => (
              <Button key={k} type="button" size="sm" variant={seg === k ? "default" : "outline"} aria-pressed={seg === k} onClick={() => setSeg(k)}>
                {k === "all" ? "Все" : VIEW_LABEL[k]}
              </Button>
            ))}
          </div>
          {(needle || seg !== "all") && <span className="text-xs text-neutral-500">показано {shown.length} из {rows.length}</span>}
        </div>
        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <ResponsiveRows
          table={
            <Table className="min-w-[1000px]">
              <Thead>
                <Tr>
                  <Th>№ изд.</Th>
                  <Th>ТЗ · поз.</Th>
                  <Th>Артикул</Th>
                  <Th>Цвет</Th>
                  <Th>Размер</Th>
                  <Th>Вид меха</Th>
                  <Th className="text-right" unit="шт.">В ТЗ</Th>
                  <Th className="text-right" unit="шт.">В отгрузке</Th>
                  <Th>Статус</Th>
                  {canEdit && <Th>Изменить</Th>}
                  {canEdit && <Th>Убрать</Th>}
                </Tr>
              </Thead>
              <Tbody>
                {shown.map((r) => (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap tabular-nums">{r.itemNo || <Dash />}</Td>
                    <Td className="whitespace-nowrap">{r.order}</Td>
                    <Td>{r.article}</Td>
                    <Td>{r.color ?? <Dash />}</Td>
                    <Td>{r.size ?? <Dash />}</Td>
                    <Td>{r.furKind ?? <Dash />}</Td>
                    <Td className="text-right tabular-nums">{r.inTz != null ? formatQty(r.inTz) : <Dash />}</Td>
                    <Td className="text-right font-medium tabular-nums">{formatQty(r.quantity)}</Td>
                    <Td className="min-w-40">{stageCell(r)}</Td>
                    {canEdit && <Td className="whitespace-nowrap"><LineEdit v={editValues(r)} /></Td>}
                    {canEdit && (
                      <Td className="whitespace-nowrap">
                        <LineDelete id={r.id} label={r.label} blockedReason={r.blockedReason} />
                        {r.blockedReason && <div className="text-[11px] text-neutral-500">есть приёмка</div>}
                      </Td>
                    )}
                  </Tr>
                ))}
                {rows.length > 0 && (
                  <Tr className="row-total">
                    <Td colSpan={7} className="text-right"><TotalLabel unit="шт." /></Td>
                    <Td className="text-right tabular-nums">{formatQty(totQty)}</Td>
                    <Td colSpan={canEdit ? 3 : 1} />
                  </Tr>
                )}
                {rows.length === 0 && (
                  <Tr>
                    <Td colSpan={canEdit ? 11 : 9} className="py-8 text-center text-neutral-500">Состав пока пуст{canEdit ? " — добавьте позиции кнопкой «+ Добавить из ТЗ»" : ""}</Td>
                  </Tr>
                )}
                {rows.length > 0 && shown.length === 0 && (
                  <Tr>
                    <Td colSpan={canEdit ? 11 : 9} className="py-6 text-center text-neutral-500">Ничего не найдено</Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
          }
        >
          {shown.map((r) => (
            <RowCard
              key={r.id}
              title={r.itemNo ? <>№{r.itemNo} · {r.title}</> : r.title}
              href={r.href}
              subtitle={r.subtitle}
              fields={[
                { label: "Статус", value: stageCell(r) },
                { label: "В ТЗ, шт.", value: r.inTz != null ? formatQty(r.inTz) : "—" },
                { label: "В отгрузке, шт.", value: formatQty(r.quantity), strong: true },
              ]}
              extra={
                canEdit ? (
                  <div className="flex items-center gap-1">
                    <LineEdit v={editValues(r)} />
                    <LineDelete id={r.id} label={r.label} blockedReason={r.blockedReason} />
                    {r.blockedReason && <span className="text-[11px] text-neutral-500">есть приёмка</span>}
                  </div>
                ) : undefined
              }
            />
          ))}
          {rows.length === 0 && <p className="py-6 text-center text-sm text-neutral-500">Состав пока пуст</p>}
        </ResponsiveRows>
      </div>
    </section>
  );
}

// ───────────── «Приёмка в Коптево»: список товаров на приёмке, «Принято» / «Не принято» по строкам ─────────────

type Mode = "none" | "accepted" | "rejected" | "partial";
type AD = { mode: Mode; acc: string; ret: string; comment: string };

function baseDraft(r: LineRow): AD {
  const a = r.accepted, b = r.returned;
  if (a == null && b == null) return { mode: "none", acc: "", ret: "", comment: r.comment };
  if ((a ?? 0) === r.quantity && (b ?? 0) === 0) return { mode: "accepted", acc: String(r.quantity), ret: "0", comment: r.comment };
  if ((a ?? 0) === 0 && (b ?? 0) === r.quantity) return { mode: "rejected", acc: "0", ret: String(r.quantity), comment: r.comment };
  return { mode: "partial", acc: a == null ? "" : String(a), ret: b == null ? "" : String(b), comment: r.comment };
}

/** Что уйдёт в базу из выбора; undefined — ввод неверный. */
function effOf(d: AD, qty: number): { a: number | null; b: number | null; comment: string | null } | undefined {
  const comment = d.comment.trim() || null;
  if (d.mode === "none") return { a: null, b: null, comment };
  if (d.mode === "accepted") return { a: qty, b: 0, comment };
  if (d.mode === "rejected") return { a: 0, b: qty, comment };
  const a = parseQty(d.acc), b = parseQty(d.ret);
  if (a == null || b == null) return undefined;
  return { a, b, comment };
}

function adError(d: AD, qty: number): string | null {
  if (d.mode === "none" || d.mode === "accepted") return null;
  const e = effOf(d, qty);
  if (!e) return "укажите целые числа «принято» и «не принято»";
  if (d.mode === "partial" && (e.a ?? 0) + (e.b ?? 0) !== qty) return `сумма должна быть ${qty}`;
  if ((e.b ?? 0) > 0 && !e.comment) return "укажите, почему не принято";
  return null;
}

const sameEff = (x: ReturnType<typeof effOf>, y: ReturnType<typeof effOf>) => !!x && !!y && x.a === y.a && x.b === y.b && x.comment === y.comment;

/**
 * «Список товаров на приёмке в Коптево» = строки состава со стадией «Готов к отгрузке». По каждой — «Принято» / «Не принято»
 * (у «Не принято» — обязательная причина; у строк с шт. > 1 — «частично»). Выбор копится черновиком и сохраняется общей панелью.
 */
export function AcceptList({ shipmentId, rows, canEdit, hasEvent, waiting }: { shipmentId: string; rows: LineRow[]; canEdit: boolean; hasEvent: boolean; waiting: { rework: number; review: number } }) {
  const router = useRouter();
  const ready = rows.filter((r) => r.stage === "READY");
  const [edits, setEdits] = useState<Record<string, AD>>({});
  const [committed, setCommitted] = useState<Record<string, AD>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(true);
  const { ask, node: confirmNode } = useConfirm();

  const sig = ready.map((r) => `${r.id}:${r.quantity}:${r.accepted}:${r.returned}:${r.comment}`).join("|");
  const [prevSig, setPrevSig] = useState(sig);
  if (sig !== prevSig) {
    setPrevSig(sig);
    setCommitted({});
    setEdits((p) => Object.fromEntries(Object.entries(p).filter(([id, d]) => { const r = ready.find((x) => x.id === id); return r && !sameEff(effOf(d, r.quantity), effOf(baseDraft(r), r.quantity)); })));
  }
  const base = (r: LineRow) => committed[r.id] ?? baseDraft(r);
  const cur = (r: LineRow) => edits[r.id] ?? base(r);
  const isDirty = (r: LineRow) => !!edits[r.id] && !sameEff(effOf(edits[r.id], r.quantity), effOf(base(r), r.quantity));
  const dirtyRows = ready.filter(isDirty);
  const guard = useUnsavedGuard(dirtyRows.length > 0);

  const setD = (r: LineRow, patch: Partial<AD>) => {
    setError(null);
    setEdits((p) => ({ ...p, [r.id]: { ...(p[r.id] ?? base(r)), ...patch } }));
  };
  const pick = (r: LineRow, m: "accepted" | "rejected") => setD(r, cur(r).mode === m ? { mode: "none" } : { mode: m });

  const save = () => {
    setError(null);
    for (const r of dirtyRows) {
      const e = adError(cur(r), r.quantity);
      if (e) return setError(`Строка ${r.n}: ${e}`);
    }
    const drafts = dirtyRows.map((r) => {
      const e = effOf(cur(r), r.quantity)!;
      return { id: r.id, n: r.n, accepted: e.a, returned: e.b, comment: e.comment };
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
  const acceptAllList = async () => {
    const m = ready.reduce((t, r) => t + r.quantity, 0);
    if (!(await ask(`Отметить «Принято» все ${rowsText(ready.length)} списка (${formatQty(m)} шт.)? Прежние отметки «Не принято» будут заменены. Изменения нужно будет сохранить.`, { ok: "Принять все" }))) return;
    setError(null);
    setEdits((p) => { const n = { ...p }; for (const r of ready) n[r.id] = { ...(p[r.id] ?? base(r)), mode: "accepted" }; return n; });
  };

  if (ready.length === 0) return null;
  const qtyReady = ready.reduce((t, r) => t + r.quantity, 0);
  const notIn = [waiting.rework ? `на доработке ${formatQty(waiting.rework)} шт.` : "", waiting.review ? `на просмотре ${formatQty(waiting.review)} шт.` : ""].filter(Boolean).join(", ");
  const panel = dirtyRows.length > 0 && (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm" data-unsaved-panel>
      <span className="mr-auto font-medium text-amber-900">Не сохранено: {rowsText(dirtyRows.length)}</span>
      <Button type="button" size="sm" onClick={save} disabled={pending}>{pending ? "Сохраняем…" : "Сохранить"}</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => { setEdits({}); setError(null); }} disabled={pending}>Отменить</Button>
    </div>
  );
  const seg = "h-8 max-md:h-10";
  return (
    <section className="flex flex-col gap-2" aria-label="Приёмка в Коптево" data-accept-list>
      {guard}
      {confirmNode}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="block-title flex items-center gap-1">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-touch-ok className="inline-flex items-center gap-1 hover:text-neutral-700">
            <span aria-hidden className={"inline-block w-3 transition-transform " + (open ? "rotate-90" : "")}>›</span>
            Список товаров на приёмке в Коптево
          </button>
        </h2>
        {canEdit && open && <Button type="button" variant="outline" size="sm" onClick={() => void acceptAllList()} disabled={pending}>Принять все по списку</Button>}
      </div>
      <div className={open ? "flex flex-col gap-2" : "hidden"}>
        <p className="text-xs text-neutral-600">На приёмку идёт {rowsText(ready.length)} / {formatQty(qtyReady)} шт.{notIn ? `; ${notIn} — не в списке` : ""}.{!hasEvent && " Приёмка в Коптево не создана — кнопка «+ Приёмка в Коптево» под хронологией."}</p>
        {panel}
        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Table className="min-w-[760px]">
          <Thead>
            <Tr>
              <Th>№ изд.</Th>
              <Th>ТЗ · поз.</Th>
              <Th>Артикул</Th>
              <Th>Цвет</Th>
              <Th>Размер</Th>
              <Th className="text-right" unit="шт.">Шт.</Th>
              <Th>Приёмка</Th>
            </Tr>
          </Thead>
          <Tbody>
            {ready.map((r) => {
              const d = cur(r);
              const err = adError(d, r.quantity);
              const showErr = d.mode !== "none" && err;
              const needComment = d.mode === "rejected" || (d.mode === "partial" && (parseQty(d.ret) ?? 0) > 0);
              return (
                <Tr key={r.id} className={isDirty(r) ? "bg-amber-50/50" : ""}>
                  <Td className="whitespace-nowrap tabular-nums">{r.itemNo || <Dash />}</Td>
                  <Td className="whitespace-nowrap">{r.order}</Td>
                  <Td>{r.article}</Td>
                  <Td>{r.color ?? <Dash />}</Td>
                  <Td>{r.size ?? <Dash />}</Td>
                  <Td className="text-right font-medium tabular-nums">{formatQty(r.quantity)}</Td>
                  <Td className="min-w-72">
                    {canEdit ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-1">
                          <Button type="button" size="sm" className={seg + (d.mode === "accepted" ? " bg-emerald-600 text-white hover:bg-emerald-700" : "")} variant={d.mode === "accepted" ? "default" : "outline"} aria-pressed={d.mode === "accepted"} onClick={() => pick(r, "accepted")}>Принято</Button>
                          <Button type="button" size="sm" className={seg + (d.mode === "rejected" ? " bg-red-600 text-white hover:bg-red-700" : "")} variant={d.mode === "rejected" ? "default" : "outline"} aria-pressed={d.mode === "rejected"} onClick={() => pick(r, "rejected")}>Не принято</Button>
                          {r.quantity > 1 && (
                            <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => setD(r, d.mode === "partial" ? { mode: "none" } : { mode: "partial", acc: String(r.quantity), ret: "0" })}>
                              {d.mode === "partial" ? "без разбивки" : "частично…"}
                            </button>
                          )}
                        </div>
                        {d.mode === "partial" && (
                          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                            <label className="flex items-center gap-1">принято <Input className="h-8 w-16 text-right tabular-nums max-md:h-10" inputMode="numeric" value={d.acc} aria-label={`Принято, ${r.label}`} onChange={(e) => setD(r, { acc: e.target.value })} /></label>
                            <label className="flex items-center gap-1">не принято <Input className="h-8 w-16 text-right tabular-nums max-md:h-10" inputMode="numeric" value={d.ret} aria-label={`Не принято, ${r.label}`} onChange={(e) => setD(r, { ret: e.target.value })} /></label>
                            <span>из {r.quantity}</span>
                          </div>
                        )}
                        {needComment && (
                          <Input className="h-8 max-md:h-10" maxLength={500} value={d.comment} aria-label={`Комментарий — почему не принято, ${r.label}`} placeholder="Комментарий — почему не принято (обязательно)" aria-invalid={!!showErr} onChange={(e) => setD(r, { comment: e.target.value })} />
                        )}
                        {showErr && <span className="text-[11px] text-red-700">{err}</span>}
                      </div>
                    ) : (
                      <span className="text-sm">{r.accepted == null && r.returned == null ? "—" : `принято ${r.accepted ?? 0}, не принято ${r.returned ?? 0}${r.comment ? ` — ${r.comment}` : ""}`}</span>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
        {panel}
      </div>
    </section>
  );
}
