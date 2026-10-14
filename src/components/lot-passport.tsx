"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/confirm-dialog";
import { useUnsavedGuard } from "@/lib/use-unsaved-guard";
import { LotEditCtx, type LotEditHandler } from "@/components/lot-edit-ctx";
import { ColorSelect, type ColorSelectOption } from "@/components/color-select";
import { SaveStatus, useInlineSave } from "@/components/lot-inline";
import { saveLotAttrs, saveLotFields } from "@/app/(app)/analytics/raw/lot/[id]/actions";
import { ICON_BTN, IconPencil } from "@/components/icons";

export type PassportField = {
  label: string;
  /** Что правится по месту; без key поле только для чтения. */
  key?: "lotNumber" | "grade" | "sizeGrade" | "notes" | "color" | "attrs";
  /** Текущее значение для правки (текст; для attrs — не используется). */
  value?: string;
  refId?: string | null;
  /** Показ в режиме чтения. */
  node?: ReactNode;
  /** Редактор по месту (клиентский компонент, собранный страницей): поле правится в карточке лота — первоисточнике. */
  editor?: ReactNode;
  /** Мелкая строка под значением: почему не правится / куда идти. */
  note?: ReactNode;
};
export type PassportSection = { title: string; fields: PassportField[] };

export type AttrOption = { id: string; name: string; group: string | null };

const SIZES = ["XXXL", "XXL", "XL", "L", "M", "S", "XS"].map((s) => ({ value: s, label: s }));

function AttrsEditor({ lotId, current, options }: { lotId: string; current: string[]; options: AttrOption[] }) {
  const s = useInlineSave();
  const byId = new Map(options.map((o) => [o.id, o]));
  const set = (ids: string[]) => s.run(() => saveLotAttrs(lotId, ids));
  const free = options.filter((o) => !current.includes(o.id));
  return (
    <span className="block">
      <span className="flex flex-wrap items-center gap-1.5">
        {current.length === 0 ? <span className="text-sm text-neutral-500">—</span> : null}
        {current.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-full border border-neutral-300 px-2 py-0.5 text-xs">
            {byId.get(id)?.name ?? id}
            <button type="button" aria-label={`Убрать признак ${byId.get(id)?.name ?? ""}`} disabled={s.pending} onClick={() => set(current.filter((x) => x !== id))} className="text-neutral-500 hover:text-red-700">×</button>
          </span>
        ))}
        <select
          aria-label="Добавить признак меха"
          value=""
          disabled={s.pending || free.length === 0}
          onChange={(e) => e.target.value && set([...current, e.target.value])}
          className="h-6 rounded border border-neutral-200 bg-white px-1 text-xs hover:border-neutral-400"
        >
          <option value="">+ признак</option>
          {free.map((o) => <option key={o.id} value={o.id}>{o.group ? `${o.group}: ` : ""}{o.name}</option>)}
        </select>
      </span>
      <SaveStatus pending={s.pending} saved={s.saved} error={s.error} />
    </span>
  );
}

type Drafts = { lotNumber?: string; grade?: string; notes?: string; sizeGrade?: string; color?: { text: string; refId: string } };
const INPUT = "w-full min-w-[3.25rem] rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-sm outline-none transition-colors hover:border-neutral-400 focus:border-neutral-700 focus:ring-1 focus:ring-neutral-300";

/**
 * «Паспорт лота»: таблица «поле → значение» блоками. По умолчанию — просмотр; «Править» открывает режим правки:
 * текстовые поля (№ лота, цвет, размер, сорт, примечание) сохраняются кнопкой «Сохранить» вместе, цена и количество — через окно «что изменится»,
 * «Отмена» сбрасывает введённое. Остальные поля (признаки, закупка, дата, остаток) сохраняются по месту со своими подтверждениями.
 */
export function LotPassport({
  lotId, sections, canEdit, canAddColor, colorOptions, attrOptions, attrIds,
}: {
  lotId: string;
  sections: PassportSection[];
  canEdit: boolean;
  canAddColor: boolean;
  colorOptions: ColorSelectOption[];
  attrOptions: AttrOption[];
  attrIds: string[];
}) {
  const router = useRouter();
  const { ask, node: confirmNode } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [epoch, setEpoch] = useState(0);
  const [dirtyNums, setDirtyNums] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handlers = useRef(new Map<string, LotEditHandler>());

  const report = useCallback((id: string, dirty: boolean, h: LotEditHandler) => {
    handlers.current.set(id, h);
    setDirtyNums((p) => {
      if (p.has(id) === dirty) return p;
      const n = new Set(p);
      if (dirty) n.add(id); else n.delete(id);
      return n;
    });
  }, []);
  const unregister = useCallback((id: string) => {
    handlers.current.delete(id);
    setDirtyNums((p) => {
      if (!p.has(id)) return p;
      const n = new Set(p);
      n.delete(id);
      return n;
    });
  }, []);
  const ctx = useMemo(() => (editing ? { epoch, report, unregister } : null), [editing, epoch, report, unregister]);

  const orig = useMemo(() => {
    const o: Record<string, string> = {};
    for (const sec of sections) for (const f of sec.fields) if (f.key && f.key !== "attrs" && f.key !== "color") o[f.key] = f.value ?? "";
    return o;
  }, [sections]);
  const colorField = useMemo(() => sections.flatMap((x) => x.fields).find((f) => f.key === "color"), [sections]);
  const textChanged = (["lotNumber", "grade", "notes", "sizeGrade"] as const).filter((k) => drafts[k] !== undefined && drafts[k]!.trim() !== (orig[k] ?? "").trim());
  const colorChanged = drafts.color != null && drafts.color.text.trim() !== (colorField?.value ?? "").trim();
  const dirty = textChanged.length > 0 || colorChanged || dirtyNums.size > 0;
  const guard = useUnsavedGuard(editing && dirty);

  const cancel = async () => {
    if (dirty && !(await ask("Отменить введённые изменения?", { ok: "Отменить изменения", danger: true }))) return;
    setDrafts({});
    setEpoch((n) => n + 1);
    setError(null);
    setEditing(false);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (textChanged.length || colorChanged) {
        const patch: Parameters<typeof saveLotFields>[1] = {};
        for (const k of textChanged) patch[k] = drafts[k]!;
        if (colorChanged && drafts.color) patch.color = drafts.color;
        const r = await saveLotFields(lotId, patch);
        if (r?.error) { setError(r.error); return; }
        setDrafts({});
      }
      // Цена и количество: по очереди окно «что изменится». Отмена в окне — остаёмся в режиме правки.
      for (const [id, h] of Array.from(handlers.current.entries())) {
        if (!dirtyNums.has(id)) continue;
        const ok = await h.commit();
        if (!ok) { router.refresh(); return; }
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const draftOf = (k: "lotNumber" | "grade" | "notes" | "sizeGrade", v: string) => drafts[k] ?? v;
  const edit = (f: PassportField): ReactNode => {
    const v = f.value ?? "";
    const text = (k: "lotNumber" | "grade" | "notes", max: number, area = false) =>
      area ? (
        <textarea rows={2} aria-label={f.label} maxLength={max} value={draftOf(k, v)} onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))} className={INPUT} />
      ) : (
        <input type="text" aria-label={f.label} maxLength={max} value={draftOf(k, v)} onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))} className={INPUT} />
      );
    switch (f.key) {
      case "lotNumber": return text("lotNumber", 100);
      case "grade": return text("grade", 500);
      case "notes": return text("notes", 2000, true);
      case "sizeGrade": {
        const cur = draftOf("sizeGrade", v);
        return (
          <>
            <input type="text" list="lot-sizes" aria-label={f.label} placeholder="определить из сорта" maxLength={20} value={cur} onChange={(e) => setDrafts((d) => ({ ...d, sizeGrade: e.target.value }))} className={INPUT} />
            <datalist id="lot-sizes">{SIZES.map((x) => <option key={x.value} value={x.value} />)}</datalist>
          </>
        );
      }
      case "color":
        return (
          <ColorSelect key={`${v}|${epoch}`} refs={colorOptions} defaultValue={v} defaultRefId={f.refId ?? null} canCreate={canAddColor} onChange={(text, rid) => setDrafts((d) => ({ ...d, color: { text, refId: rid } }))} className="[&_input]:h-7 [&_input]:px-1.5 [&_input]:text-sm [&_input]:shadow-none" />
        );
      case "attrs": return <AttrsEditor lotId={lotId} current={attrIds} options={attrOptions} />;
      default: return null;
    }
  };
  return (
    <LotEditCtx.Provider value={ctx}>
      {guard}
      {confirmNode}
      {canEdit ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <button type="button" onClick={save} disabled={busy || !dirty} className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50">{busy ? "Сохраняем…" : "Сохранить"}</button>
              <button type="button" onClick={cancel} disabled={busy} className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50">Отмена</button>
              <span className="text-xs text-neutral-500">Цена и количество перед записью покажут окно «что изменится».</span>
            </>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className={ICON_BTN} title="Править" aria-label="Править"><IconPencil /></button>
          )}
          {error ? <span role="alert" className="text-xs text-red-700">{error}</span> : null}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full table-fixed text-left">
          <tbody>
            {sections.map((sec) => (
              <PassportBlock key={sec.title} sec={sec} canEdit={canEdit && editing} edit={edit} />
            ))}
          </tbody>
        </table>
      </div>
    </LotEditCtx.Provider>
  );
}

function PassportBlock({ sec, canEdit, edit }: { sec: PassportSection; canEdit: boolean; edit: (f: PassportField) => ReactNode }) {
  return (
    <>
      <tr>
        <th colSpan={2} className="border-t border-neutral-200 bg-neutral-50/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 first:border-t-0">{sec.title}</th>
      </tr>
      {sec.fields.map((f) => {
        const editable = canEdit && (f.key || f.editor);
        return (
          <tr key={f.label} className="border-t border-neutral-100 align-top">
            <th scope="row" className="w-[40%] px-3 py-1.5 text-xs font-medium text-neutral-500 sm:w-56">{f.label}</th>
            <td className="min-w-0 break-words px-2 py-1 text-sm">
              {editable ? (f.editor ?? edit(f)) : <span className="block whitespace-pre-wrap px-1.5 py-0.5 tabular-nums">{f.node ?? (f.value ? f.value : "—")}</span>}
              {f.note && (editable || !canEdit) ? <span className="block px-1.5 text-[11px] leading-4 text-neutral-500">{f.note}</span> : null}
            </td>
          </tr>
        );
      })}
    </>
  );
}
