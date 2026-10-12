"use client";

import { useState, type ReactNode } from "react";
import { ColorSelect, type ColorSelectOption } from "@/components/color-select";
import { InlineSelect, InlineText, SaveStatus, useInlineSave } from "@/components/lot-inline";
import { saveLotAttrs, saveLotFields } from "@/app/(app)/analytics/raw/lot/[id]/actions";

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

function ColorEditor({ lotId, value, refId, options, canAdd }: { lotId: string; value: string; refId: string | null; options: ColorSelectOption[]; canAdd: boolean }) {
  const [draft, setDraft] = useState<{ text: string; refId: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  const s = useInlineSave();
  const dirty = draft != null && draft.text.trim() !== value.trim();
  const save = () => {
    if (!draft) return;
    s.run(() => saveLotFields(lotId, { color: draft }), () => { setDraft(null); setNonce((n) => n + 1); });
  };
  return (
    <span
      className="block"
      onKeyDown={(e) => {
        if (e.key === "Enter" && dirty) { e.preventDefault(); save(); }
        if (e.key === "Escape") { setDraft(null); setNonce((n) => n + 1); }
      }}
    >
      <ColorSelect key={`${value}|${nonce}`} refs={options} defaultValue={value} defaultRefId={refId} canCreate={canAdd} onChange={(text, rid) => setDraft({ text, refId: rid })} className="[&_input]:h-7 [&_input]:px-1.5 [&_input]:text-sm [&_input]:shadow-none" />
      <span className="mt-0.5 flex flex-wrap items-center gap-2">
        {dirty ? (
          <>
            <button type="button" onClick={save} disabled={s.pending} className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:border-neutral-500">Сохранить цвет</button>
            <button type="button" onClick={() => { setDraft(null); setNonce((n) => n + 1); }} className="text-xs text-neutral-500 hover:underline">Отмена</button>
          </>
        ) : null}
        <SaveStatus pending={s.pending} saved={s.saved} error={s.error} />
      </span>
    </span>
  );
}

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

/**
 * «Паспорт лота»: таблица «поле → значение» блоками. Поля с key правятся по месту (Enter или уход из поля — сохранить, Esc — отмена),
 * остальные (внутренний id, создан, последняя правка — записи журнала) — только чтение.
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
  const edit = (f: PassportField): ReactNode => {
    const v = f.value ?? "";
    switch (f.key) {
      case "lotNumber": return <InlineText value={v} label={f.label} maxLength={100} onSave={(x) => saveLotFields(lotId, { lotNumber: x })} />;
      case "grade": return <InlineText value={v} label={f.label} maxLength={500} onSave={(x) => saveLotFields(lotId, { grade: x })} />;
      case "notes": return <InlineText value={v} label={f.label} maxLength={2000} area onSave={(x) => saveLotFields(lotId, { notes: x })} />;
      case "sizeGrade": return <InlineSelect value={v} label={f.label} options={SIZES} allowCustom emptyLabel="определить из сорта" onSave={(x) => saveLotFields(lotId, { sizeGrade: x })} />;
      case "color": return <ColorEditor lotId={lotId} value={v} refId={f.refId ?? null} options={colorOptions} canAdd={canAddColor} />;
      case "attrs": return <AttrsEditor lotId={lotId} current={attrIds} options={attrOptions} />;
      default: return null;
    }
  };
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <table className="w-full table-fixed text-left">
        <tbody>
          {sections.map((sec) => (
            <PassportBlock key={sec.title} sec={sec} canEdit={canEdit} edit={edit} />
          ))}
        </tbody>
      </table>
    </div>
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
              {editable ? (f.editor ?? edit(f)) : <span className="block px-1.5 py-0.5 tabular-nums">{f.node ?? (f.value ? f.value : "—")}</span>}
              {f.note ? <span className="block px-1.5 text-[11px] leading-4 text-neutral-500">{f.note}</span> : null}
            </td>
          </tr>
        );
      })}
    </>
  );
}
