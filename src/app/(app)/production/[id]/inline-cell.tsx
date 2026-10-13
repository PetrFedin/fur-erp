"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useEditGuard } from "./edit-guard";

export type CellResult = { error?: string } | void | undefined;

/** Рамка редактируемой ячейки: видна при наведении и фокусе, красная при ошибке. */
const BOX =
  "w-full min-w-[3.25rem] rounded border bg-white px-1.5 py-0.5 text-sm tabular-nums outline-none transition-colors disabled:cursor-default disabled:opacity-60 " +
  "border-neutral-200 hover:border-neutral-400 focus:border-neutral-700 focus:ring-1 focus:ring-neutral-300";

type Common = {
  /** Сохранение значения; ошибка (error) подсвечивает ячейку и показывается под ней. */
  onSave: (value: string) => Promise<CellResult>;
  readOnly?: boolean;
  className?: string;
  /** Подпись для скринридера / подсказка. */
  label?: string;
  align?: "left" | "right";
  /** Вызывается на каждое нажатие (для живого пересчёта строки). */
  onDraft?: (value: string) => void;
};

/**
 * Редактируемая по месту ячейка: Enter или уход фокуса сохраняет, Esc возвращает прежнее значение.
 * После сохранения страница перечитывается сервером (revalidateAll) — значения и итоги приходят новыми пропсами.
 */
export function TextCell({
  value, type = "text", onSave, readOnly, className, label, align, onDraft, placeholder, step, min, suffix,
}: Common & { value: string; type?: "text" | "number" | "date"; placeholder?: string; step?: string; min?: string; suffix?: string }) {
  return <TextCellInner key={value} value={value} type={type} onSave={onSave} readOnly={readOnly} className={className} label={label} align={align} onDraft={onDraft} placeholder={placeholder} step={step} min={min} suffix={suffix} />;
}

export function SaveMark({ pending, saved }: { pending: boolean; saved: boolean }) {
  if (pending) return <span className="shrink-0 text-[11px] text-neutral-400" aria-live="polite">сохраняем…</span>;
  if (saved) return <span className="shrink-0 text-[11px] text-emerald-600" aria-live="polite">✓ сохранено</span>;
  return null;
}

export function useSaver(onSave: Common["onSave"], current: string) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const guard = useEditGuard();
  const asking = useRef(false);
  const save = async (next: string, revert: () => void) => {
    if (next.trim() === current.trim()) {
      setError(null);
      return;
    }
    if (asking.current) return;
    // Подтверждение у завершённого ТЗ — ДО transition: диалог не должен зависеть от pending-состояния.
    asking.current = true;
    let ok = false;
    try {
      ok = await guard();
    } finally {
      asking.current = false;
    }
    if (!ok) {
      revert();
      setError(null);
      return;
    }
    start(async () => {
      try {
        const r = await onSave(next);
        const err = r && typeof r === "object" && "error" in r ? r.error : undefined;
        setError(err ?? null);
        if (err) revert();
        else {
          setSaved(true);
          setTimeout(() => setSaved(false), 1800);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить");
        revert();
      }
    });
  };
  return { pending, error, save, saved };
}

function TextCellInner({
  value, type, onSave, readOnly, className, label, align, onDraft, placeholder, step, min, suffix,
}: Common & { value: string; type: "text" | "number" | "date"; placeholder?: string; step?: string; min?: string; suffix?: string }) {
  const [draft, setDraft] = useState(value);
  const { pending, error, save, saved } = useSaver(onSave, value);
  if (readOnly) return <span className={cn("block px-1.5 py-0.5 text-sm", align === "right" && "text-right tabular-nums", className)}>{value || <span className="text-neutral-300">—</span>}{suffix ? ` ${suffix}` : ""}</span>;
  return (
    <span className="block">
      <span className="flex items-center gap-1">
        <input
          type={type}
          value={draft}
          step={step}
          min={min}
          placeholder={placeholder}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          title={error ?? label}
          disabled={pending}
          inputMode={type === "number" ? "decimal" : undefined}
          onChange={(e) => { setDraft(e.target.value); onDraft?.(e.target.value); }}
          onBlur={() => save(draft, () => { setDraft(value); onDraft?.(value); })}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); }
            if (e.key === "Escape") { setDraft(value); onDraft?.(value); (e.currentTarget as HTMLInputElement).blur(); }
          }}
          className={cn(BOX, align === "right" && "text-right", error && "border-red-500 bg-red-50 focus:border-red-600", className)}
        />
        {suffix ? <span className="shrink-0 text-xs text-neutral-500">{suffix}</span> : null}
        <SaveMark pending={pending} saved={saved} />
      </span>
      {error ? <span className="mt-0.5 block text-xs text-red-600">{error}</span> : null}
    </span>
  );
}

/** Многострочное поле (примечание): Ctrl/Cmd+Enter или уход фокуса сохраняет. */
export function AreaCell({ value, onSave, readOnly, label, className }: Common & { value: string }) {
  return <AreaCellInner key={value} value={value} onSave={onSave} readOnly={readOnly} label={label} className={className} />;
}

function AreaCellInner({ value, onSave, readOnly, label, className }: Common & { value: string }) {
  const [draft, setDraft] = useState(value);
  const { pending, error, save, saved } = useSaver(onSave, value);
  if (readOnly) return <span className="block whitespace-pre-wrap px-1.5 py-0.5 text-sm">{value || <span className="text-neutral-300">—</span>}</span>;
  return (
    <span className="block">
      <textarea
        rows={2}
        value={draft}
        aria-label={label}
        title={error ?? label}
        disabled={pending}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => save(draft, () => setDraft(value))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); (e.currentTarget as HTMLTextAreaElement).blur(); }
          if (e.key === "Escape") { setDraft(value); (e.currentTarget as HTMLTextAreaElement).blur(); }
        }}
        className={cn(BOX, error && "border-red-500 bg-red-50", className)}
      />
      <SaveMark pending={pending} saved={saved} />
      {error ? <span className="mt-0.5 block text-xs text-red-600">{error}</span> : null}
    </span>
  );
}

export type SelectOpt = { value: string; label: string };

/** Ленивые варианты: в разметке — только текущий, полный список подставляется, когда список открывают. */
export type LazyOptions = { current: SelectOpt; get: () => SelectOpt[] | null; warm: () => Promise<unknown> };

/** Выпадающий список: выбор сразу сохраняется. */
export function SelectCell({ value, options, onSave, readOnly, label, className, emptyLabel = "—", lazy }: Common & { value: string; options: SelectOpt[]; emptyLabel?: string; lazy?: LazyOptions }) {
  const { pending, error, save, saved } = useSaver(onSave, value);
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  if (seen !== value) { setSeen(value); setDraft(value); }
  const full = lazy && open ? lazy.get() : null;
  const opts = lazy ? (full ? (full.some((o) => o.value === value) ? full : [lazy.current, ...full]) : [lazy.current]) : options;
  if (readOnly) return <span className="block px-1.5 py-0.5 text-sm">{opts.find((o) => o.value === value)?.label || <span className="text-neutral-300">—</span>}</span>;
  const warm = () => { if (lazy) lazy.warm().then(() => setTick((t) => t + 1), () => {}); };
  return (
    <span className="block">
      <select
        value={draft}
        aria-label={label}
        title={error ?? label}
        disabled={pending}
        onPointerEnter={lazy ? warm : undefined}
        onFocus={lazy ? () => { warm(); setOpen(true); } : undefined}
        onMouseDown={lazy ? () => setOpen(true) : undefined}
        onBlur={lazy ? () => setOpen(false) : undefined}
        onChange={(e) => { setDraft(e.target.value); save(e.target.value, () => setDraft(value)); }}
        className={cn(BOX, error && "border-red-500 bg-red-50", className)}
      >
        {!opts.some((o) => o.value === "") ? <option value="">{emptyLabel}</option> : null}
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <SaveMark pending={pending} saved={saved} />
      {error ? <span className="mt-0.5 block text-xs text-red-600">{error}</span> : null}
    </span>
  );
}

/** Рамка для комбобоксов (артикул, цвет): commit(значение) сохраняет с индикатором и ошибкой. */
export function ComboFrame({ onSave, children }: { onSave: (value: string) => Promise<CellResult>; children: (commit: (value: string) => void) => ReactNode }) {
  const { pending, error, save, saved } = useSaver(onSave, "\u0000");
  return (
    <span className="block">
      {children((v) => save(v, () => {}))}
      <SaveMark pending={pending} saved={saved} />
      {error ? <span className="mt-0.5 block text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
