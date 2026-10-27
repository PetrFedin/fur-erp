"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";

export type SaveResult = { error?: string } | void | undefined;

const BOX =
  "w-full min-w-[3.25rem] rounded border bg-white px-1.5 py-0.5 text-sm outline-none transition-colors disabled:cursor-default disabled:opacity-60 " +
  "border-neutral-200 hover:border-neutral-400 focus:border-neutral-700 focus:ring-1 focus:ring-neutral-300";

/** Состояние сохранения по месту: «сохраняем… / ✓ сохранено», ошибка красным. */
export function useInlineSave() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const run = (fn: () => Promise<SaveResult>, onFail?: () => void) => {
    start(async () => {
      try {
        const r = await fn();
        const err = r && typeof r === "object" && "error" in r ? r.error : undefined;
        setError(err ?? null);
        if (err) onFail?.();
        else {
          setSaved(true);
          setTimeout(() => setSaved(false), 1800);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить");
        onFail?.();
      }
    });
  };
  return { pending, error, saved, run, clearError: () => setError(null) };
}

export function SaveStatus({ pending, saved, error }: { pending: boolean; saved: boolean; error: string | null }) {
  return (
    <>
      {pending ? <span className="shrink-0 text-[11px] text-neutral-500" aria-live="polite">сохраняем…</span> : null}
      {!pending && saved ? <span className="shrink-0 text-[11px] text-emerald-700" aria-live="polite">✓ сохранено</span> : null}
      {error ? <span className="mt-0.5 block text-xs text-red-700" role="alert">{error}</span> : null}
    </>
  );
}

/** Текстовое поле по месту: Enter или уход из поля сохраняет, Esc отменяет. area — многострочное (Ctrl/Cmd+Enter). */
export function InlineText({
  value, onSave, label, area = false, placeholder, maxLength, readOnly = false, className,
}: {
  value: string;
  onSave: (v: string) => Promise<SaveResult>;
  label: string;
  area?: boolean;
  placeholder?: string;
  maxLength?: number;
  readOnly?: boolean;
  className?: string;
}) {
  return <InlineTextInner key={value} {...{ value, onSave, label, area, placeholder, maxLength, readOnly, className }} />;
}

function InlineTextInner({ value, onSave, label, area, placeholder, maxLength, readOnly, className }: {
  value: string; onSave: (v: string) => Promise<SaveResult>; label: string; area: boolean; placeholder?: string; maxLength?: number; readOnly: boolean; className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const s = useInlineSave();
  if (readOnly) return <span className={cn("block whitespace-pre-wrap break-words px-1.5 py-0.5 text-sm", className)}>{value || "–"}</span>;
  const commit = () => {
    if (draft.trim() === value.trim()) return s.clearError();
    s.run(() => onSave(draft), () => setDraft(value));
  };
  const common = {
    value: draft,
    "aria-label": label,
    "aria-invalid": s.error ? true : undefined,
    disabled: s.pending,
    placeholder,
    maxLength,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    className: cn(BOX, s.error && "border-red-500 bg-red-50", className),
  };
  return (
    <span className="block">
      {area ? (
        <textarea
          rows={2}
          {...common}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === "Escape") { setDraft(value); e.currentTarget.blur(); }
          }}
        />
      ) : (
        <input
          type="text"
          {...common}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === "Escape") { setDraft(value); e.currentTarget.blur(); }
          }}
        />
      )}
      <span className="flex items-center gap-1"><SaveStatus pending={s.pending} saved={s.saved} error={s.error} /></span>
    </span>
  );
}

export type OptionItem = { value: string; label: string };

/** Выбор из списка (выбор сразу сохраняется); allowCustom — пункт «своё…» открывает поле ввода. */
export function InlineSelect({
  value, options, onSave, label, readOnly = false, allowCustom = false, emptyLabel = "–",
}: {
  value: string;
  options: OptionItem[];
  onSave: (v: string) => Promise<SaveResult>;
  label: string;
  readOnly?: boolean;
  allowCustom?: boolean;
  emptyLabel?: string;
}) {
  const known = options.some((o) => o.value === value);
  const [custom, setCustom] = useState(false);
  const s = useInlineSave();
  if (readOnly) return <span className="block px-1.5 py-0.5 text-sm">{value || "–"}</span>;
  if (custom) {
    return (
      <span className="block">
        <InlineText value="" label={label} placeholder="Введите своё значение" onSave={async (v) => { const r = await onSave(v); if (!r?.error) setCustom(false); return r; }} />
        <button type="button" className="text-xs text-neutral-500 hover:underline" onClick={() => setCustom(false)}>отмена</button>
      </span>
    );
  }
  return (
    <span className="block">
      <select
        value={value}
        aria-label={label}
        disabled={s.pending}
        className={cn(BOX, s.error && "border-red-500 bg-red-50")}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__custom") return setCustom(true);
          s.run(() => onSave(v));
        }}
      >
        <option value="">{emptyLabel}</option>
        {!known && value ? <option value={value}>{value}</option> : null}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        {allowCustom ? <option value="__custom">своё значение…</option> : null}
      </select>
      <span className="flex items-center gap-1"><SaveStatus pending={s.pending} saved={s.saved} error={s.error} /></span>
    </span>
  );
}
