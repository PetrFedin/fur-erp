"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useKeepingForm } from "@/lib/use-keeping-form";
import { COMMENT_KINDS, COMMENT_PRIORITIES, KIND_LABEL, MAX_TEXT, PRIORITY_LABEL } from "@/lib/comments-core";
import { createCommentAction } from "@/app/(app)/comments/actions";
import { type Mode } from "./shared";

const DRAFT_KEY = "fur-erp:comment-draft";

type Draft = { text: string; kind: string; priority: string };

function readDraft(): Draft {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null") as Partial<Draft> | null;
    if (d && typeof d.text === "string") return { text: d.text.slice(0, MAX_TEXT), kind: d.kind ?? "REMARK", priority: d.priority ?? "NORMAL" };
  } catch {
    /* хранилище недоступно — черновика нет */
  }
  return { text: "", kind: "REMARK", priority: "NORMAL" };
}

function writeDraft(d: Draft | null) {
  try {
    if (!d || !d.text.trim()) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* ничего: черновик необязателен */
  }
}

/** Выбранные строки таблиц (отмеченные галочки): первые ячейки, до 10 строк. */
function checkedRows(): string[] {
  const out: string[] = [];
  document.querySelectorAll<HTMLInputElement>("main input[type=checkbox]:checked").forEach((cb) => {
    if (cb.closest("[data-comment-ui]") || out.length >= 10) return;
    const row = cb.closest("tr, li, [data-row]");
    const t = (row?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (t) out.push(t);
  });
  return out;
}

function pageParams(search: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of new URLSearchParams(search)) (out[k] ??= []).push(v);
  return out;
}

export function NewForm({
  hidden,
  open,
  mode,
  setMode,
  picked,
  quote,
  entity,
  pageUrl,
  pathname,
  search,
  pageTitle,
  onPick,
  onSaved,
}: {
  hidden: boolean;
  open: boolean;
  mode: Mode;
  setMode: (m: Mode) => void;
  picked: { id: string; label: string } | null;
  quote: string;
  entity: { type: string; key: string; label: string } | null;
  pageUrl: string;
  pathname: string;
  search: string;
  pageTitle: string;
  onPick: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(createCommentAction, null);
  const { setForm: keepRef, onSubmit: keepSubmit } = useKeepingForm(formAction, state, pending, false);
  const [text, setText] = useState(() => readDraft().text);
  const [kind, setKind] = useState(() => readDraft().kind);
  const [priority, setPriority] = useState(() => readDraft().priority);
  const [done, setDone] = useState<number | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const ctxField = useRef<HTMLInputElement | null>(null);

  // Ответ пришёл: очищаем поле и черновик (адаптация состояния при рендере, побочные действия — в эффекте ниже).
  if (state?.ok && state.at && state.at !== done) {
    setDone(state.at);
    setText("");
  }
  useEffect(() => {
    if (state?.ok && state.at) {
      writeDraft(null);
      onSaved();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.at]);

  useEffect(() => {
    writeDraft({ text, kind, priority });
  }, [text, kind, priority]);

  useEffect(() => {
    if (open && !hidden) {
      const t = setTimeout(() => area.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open, hidden]);

  const effectiveMode: Mode = mode === "entity" && !entity ? "page" : mode === "block" && !picked ? "page" : mode === "selection" && !quote ? "page" : mode;
  const send = effectiveMode;

  return (
    <form
      ref={keepRef}
      hidden={hidden}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        if (ctxField.current) {
          ctxField.current.value = JSON.stringify({
            url: pageUrl,
            params: pageParams(search),
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            quote: send === "selection" ? quote : undefined,
            anchorLabel: send === "block" || send === "selection" ? picked?.label : undefined,
            selectedRows: checkedRows(),
            target: send,
          });
        }
        keepSubmit(e);
      }}
    >
      <input type="hidden" name="pagePath" value={pageUrl} />
      <input type="hidden" name="pageTitle" value={pageTitle} />
      <input type="hidden" name="context" defaultValue="" ref={ctxField} />
      {send === "entity" && entity && (
        <>
          <input type="hidden" name="entityType" value={entity.type} />
          <input type="hidden" name="entityKey" value={entity.key} />
        </>
      )}
      {(send === "block" || send === "selection") && picked && <input type="hidden" name="anchor" value={picked.id} />}

      <fieldset className="flex flex-col gap-1.5 text-sm">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">К чему относится</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="target" checked={effectiveMode === "page"} onChange={() => setMode("page")} className="mt-1" />
          <span>
            Вся страница
            <span className="block break-all text-xs text-neutral-500">{pageTitle || pathname} · {pageUrl}</span>
          </span>
        </label>
        {entity && (
          <label className="flex items-start gap-2">
            <input type="radio" name="target" checked={effectiveMode === "entity"} onChange={() => setMode("entity")} className="mt-1" />
            <span>
              Запись: {entity.label}
              <span className="block text-xs text-neutral-500">комментарий увидят и на карточке записи</span>
            </span>
          </label>
        )}
        <label className="flex items-start gap-2">
          <input type="radio" name="target" checked={effectiveMode === "block"} onChange={() => (picked ? setMode("block") : onPick())} className="mt-1" />
          <span className="min-w-0">
            Конкретный блок{picked && effectiveMode === "block" ? `: ${picked.label}` : ""}
            <span className="mt-0.5 block">
              <button type="button" onClick={onPick} className="rounded-md border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50">
                {picked ? "Указать другой блок" : "Указать блок на странице"}
              </button>
            </span>
          </span>
        </label>
        {quote && (
          <label className="flex items-start gap-2">
            <input type="radio" name="target" checked={effectiveMode === "selection"} onChange={() => setMode("selection")} className="mt-1" />
            <span className="min-w-0">
              Выделенный текст
              <span className="block break-words text-xs italic text-neutral-600">«{quote.slice(0, 160)}»{quote.length > 160 ? "…" : ""}</span>
            </span>
          </label>
        )}
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        <span className="sr-only">Текст комментария</span>
        <textarea
          ref={area}
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_TEXT}
          rows={5}
          required
          placeholder="Что нужно учесть при доработке?"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
        />
        <span className="text-right text-xs text-neutral-500">{text.length} / {MAX_TEXT}</span>
      </label>

      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col text-xs text-neutral-500">
          Тип
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="mt-0.5 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900">
            {COMMENT_KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-neutral-500">
          Приоритет
          <select name="priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="mt-0.5 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900">
            {COMMENT_PRIORITIES.map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>
        </label>
      </div>

      {state?.error && <p role="alert" className="rounded-md bg-red-50 px-2 py-1.5 text-sm text-red-700">{state.error}</p>}
      {state?.ok && !pending && text === "" && <p role="status" className="rounded-md bg-emerald-50 px-2 py-1.5 text-sm text-emerald-800">Комментарий сохранён.</p>}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-neutral-500">Esc — закрыть, текст сохранится. В снимок попадут адрес с фильтрами, год, НДС, 4 %.</span>
        <button type="submit" disabled={pending || !text.trim()} className="shrink-0 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
          {pending ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>
    </form>
  );
}
