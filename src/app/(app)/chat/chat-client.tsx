"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createThreadBindCode } from "./channel-actions";
import { changeMemberAction, createChatAction, eligibleUsersAction, markThreadRead, searchEntitiesAction, sendMessage, setThreadClosed, toggleReactionAction, updateThreadAction, type NewChatState } from "./actions";
import { planNewChat } from "@/lib/chat-core";
import type { RecipientOption } from "@/lib/chat";

const FILE_ACCEPT = ".pdf,.xlsx,.docx,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf";

/** Раз в 5 секунд обновляет страницу (новые сообщения), при открытии непрочитанного отмечает его прочитанным. */
export function ChatAutoRefresh({ threadId, unread, lastAt }: { threadId?: string; unread?: boolean; lastAt?: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!threadId || !unread) return;
    markThreadRead(threadId).then(() => router.refresh()).catch(() => {});
  }, [threadId, unread, lastAt, router]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 5000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}

/** Прокручивает переписку вниз при открытии и новых сообщениях. */
export function ScrollBottom({ dep }: { dep: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const down = () => { el.scrollTop = el.scrollHeight; };
    down();
    // Картинки догружаются и растягивают ленту: первые секунды держим низ.
    const until = Date.now() + 3000;
    const onLoad = () => { if (Date.now() < until) down(); };
    el.addEventListener("load", onLoad, true);
    return () => el.removeEventListener("load", onLoad, true);
  }, [dep]);
  return <div ref={ref} />;
}

function FilePick({ names, onChange, name = "files" }: { names: string[]; onChange: (n: string[]) => void; name?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs hover:bg-neutral-50 max-md:min-h-10">
      <span aria-hidden>📎</span>
      <span>{names.length ? `Файлов: ${names.length}` : "Прикрепить"}</span>
      <input
        type="file" name={name} multiple accept={FILE_ACCEPT} className="sr-only"
        onChange={(e) => onChange(Array.from(e.target.files ?? []).map((f) => f.name))}
      />
    </label>
  );
}

const MAX_FILES = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const OK_EXT = /\.(pdf|xlsx|docx|jpe?g|png)$/i;
const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

/** Поле ввода: Enter отправляет, Shift+Enter — перенос; файлы — скрепкой, перетаскиванием на окно переписки или вставкой из буфера. */
export function Composer({ threadId, people = [] }: { threadId: string; people?: string[] }) {
  const router = useRouter();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [err, setErr] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [pending, start] = useTransition();
  const [mention, setMention] = useState<{ q: string; from: number } | null>(null);

  /** Подсказка «@имя»: смотрим слово перед кареткой. */
  function checkMention(el: HTMLTextAreaElement) {
    const before = el.value.slice(0, el.selectionStart);
    const m = /(?:^|\s)@([\p{L}\p{N}_-]*)$/u.exec(before);
    setMention(m ? { q: m[1].toLowerCase(), from: before.length - m[1].length - 1 } : null);
  }
  const suggest = mention ? people.filter((n) => n.toLowerCase().split(/\s+/).some((w) => w.startsWith(mention.q))).slice(0, 5) : [];
  function pickMention(name: string) {
    const el = taRef.current;
    if (!el || !mention) return;
    const first = name.split(/\s+/)[0];
    const caret = el.selectionStart;
    el.value = el.value.slice(0, mention.from) + "@" + first + " " + el.value.slice(caret);
    const pos = mention.from + first.length + 2;
    el.setSelectionRange(pos, pos);
    setMention(null);
    el.focus();
  }

  function addFiles(list: File[]) {
    const bad = list.filter((f) => !OK_EXT.test(f.name) && !/^image\/(jpeg|png)$/.test(f.type));
    const good = list.filter((f) => !bad.includes(f));
    if (bad.length) setErr(`Можно PDF, Excel, Word, JPG и PNG. Не принят: ${bad.map((f) => f.name).join(", ")}`);
    else setErr("");
    if (good.length === 0) return;
    setFiles((cur) => {
      const next = [...cur, ...good];
      if (next.length > MAX_FILES) { setErr(`Не больше ${MAX_FILES} файлов в одном сообщении`); return next.slice(0, MAX_FILES); }
      if (next.some((f) => f.size > MAX_FILE_BYTES)) { setErr("Файл больше 25 МБ"); return cur; }
      if (next.reduce((n, f) => n + f.size, 0) > MAX_FILE_BYTES) { setErr("Все файлы вместе не больше 25 МБ"); return cur; }
      return next;
    });
  }

  // Перетаскивание на всё окно переписки.
  useEffect(() => {
    const pane = formRef.current?.closest("[data-chat-pane]");
    if (!pane) return;
    const over = (e: Event) => { if ((e as DragEvent).dataTransfer?.types.includes("Files")) { e.preventDefault(); setDrag(true); } };
    const leave = (e: Event) => { if (!pane.contains((e as DragEvent).relatedTarget as Node | null)) setDrag(false); };
    const drop = (e: Event) => { e.preventDefault(); setDrag(false); addFiles(Array.from((e as DragEvent).dataTransfer?.files ?? [])); };
    pane.addEventListener("dragover", over); pane.addEventListener("dragleave", leave); pane.addEventListener("drop", drop);
    return () => { pane.removeEventListener("dragover", over); pane.removeEventListener("dragleave", leave); pane.removeEventListener("drop", drop); };
  }, []);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const body = taRef.current?.value.trim() ?? "";
    if (!body && files.length === 0) { setErr("Напишите сообщение или приложите файл"); return; }
    const fd = new FormData();
    fd.set("threadId", threadId);
    fd.set("body", body);
    for (const f of files) fd.append("files", f);
    start(async () => {
      const r = await sendMessage({}, fd);
      if (r.error) { setErr(r.error); return; }
      setErr(""); setFiles([]); setMention(null); if (taRef.current) { taRef.current.value = ""; taRef.current.style.height = "auto"; }
      router.refresh();
      taRef.current?.focus();
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="relative flex flex-col gap-2 border-t border-neutral-200 bg-white p-2 md:p-3">
      {drag && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-neutral-500 bg-white/90 text-sm font-medium">Отпустите файлы, чтобы прикрепить</div>}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Прикреплённые файлы">
          {files.map((f, i) => (
            <li key={i} className="flex max-w-full items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 py-1 pl-2 pr-1 text-xs">
              <span className="truncate">{f.name}</span><span className="shrink-0 text-neutral-500">{fmtSize(f.size)}</span>
              <button type="button" aria-label={`Убрать ${f.name}`} onClick={() => setFiles((c) => c.filter((_, j) => j !== i))} className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-200 max-md:h-11 max-md:w-11">×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-neutral-300 bg-white text-lg hover:bg-neutral-50 md:h-10 md:w-10" title="Прикрепить файл (PDF, Excel, Word, JPG, PNG)">
          <span aria-hidden>📎</span><span className="sr-only">Прикрепить файл</span>
          <input type="file" multiple accept={FILE_ACCEPT} className="sr-only" onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        </label>
        <textarea
          ref={taRef} rows={1} maxLength={4000} aria-label="Сообщение" placeholder="Сообщение (Enter — отправить)"
          className="max-h-40 min-h-11 w-full min-w-0 resize-none rounded-md border border-neutral-300 px-3 py-2.5 text-sm md:min-h-10 md:py-2"
          onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 160) + "px"; checkMention(t); }}
          onClick={(e) => checkMention(e.currentTarget)}
          onKeyDown={(e) => {
            if (suggest.length && (e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) { e.preventDefault(); pickMention(suggest[0]); return; }
            if (e.key === "Escape") setMention(null);
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }}
          onPaste={(e) => { const fl = Array.from(e.clipboardData.files); if (fl.length) { e.preventDefault(); addFiles(fl.map((f) => (f.name && f.name !== "image.png" ? f : new File([f], `снимок-${Date.now()}.png`, { type: f.type })))); } }}
        />
        <Button type="submit" disabled={pending} className="h-11 shrink-0 px-4 md:h-10">{pending ? "…" : "Отправить"}</Button>
      </div>
      {suggest.length > 0 && (
        <ul role="listbox" aria-label="Кого упомянуть" className="absolute bottom-full left-2 z-20 mb-1 min-w-48 overflow-hidden rounded-md border border-neutral-200 bg-white shadow-md md:left-14">
          {suggest.map((n) => (
            <li key={n}><button type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => pickMention(n)} className="flex min-h-11 w-full items-center px-3 text-left text-sm hover:bg-neutral-100 md:min-h-9">@{n}</button></li>
          ))}
        </ul>
      )}
      {err && <p role="alert" className="text-xs text-red-700">{err}</p>}
    </form>
  );
}

/** Реакции под сообщением: счётчики с подсказкой «кто поставил», повторное нажатие снимает; «+» открывает набор. */
export function Reactions({ messageId, groups, options, alignRight = false }: { alignRight?: boolean; messageId: string; groups: { emoji: string; count: number; mine: boolean; names: string[] }[]; options: readonly string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const toggle = (emoji: string) => {
    setOpen(false); setOptimistic(emoji);
    start(async () => {
      const r = await toggleReactionAction(messageId, emoji);
      setOptimistic(null);
      if (r.error) { setErr(r.error); return; }
      setErr(""); router.refresh();
    });
  };
  const chip = "inline-flex items-center gap-1 rounded-full border px-2 text-xs h-7 max-md:h-11 max-md:min-w-11 max-md:justify-center";
  return (
    <div className="relative flex flex-wrap items-center gap-1">
      {groups.map((g) => (
        <button key={g.emoji} type="button" disabled={pending} aria-pressed={g.mine} title={g.names.join(", ")} aria-label={`${g.emoji} ${g.count}: ${g.names.join(", ")}`}
          onClick={() => toggle(g.emoji)}
          className={`${chip} ${g.mine ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white hover:bg-neutral-100"} ${optimistic === g.emoji ? "opacity-60" : ""}`}>
          <span aria-hidden>{g.emoji}</span><span>{g.count}</span>
        </button>
      ))}
      <button type="button" aria-label="Добавить реакцию" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`${chip} border-transparent text-neutral-500 hover:border-neutral-300 hover:bg-white`}>
        <span aria-hidden>☺</span><span aria-hidden>+</span>
      </button>
      {open && (
        <div role="menu" className={`absolute top-full z-20 mt-1 flex gap-1 ${alignRight ? "right-0" : "left-0"} rounded-lg border border-neutral-200 bg-white p-1 shadow-md`}>
          {options.map((e) => (
            <button key={e} type="button" role="menuitem" aria-label={`Реакция ${e}`} onClick={() => toggle(e)} className="flex h-9 w-9 items-center justify-center rounded text-lg hover:bg-neutral-100 max-md:h-11 max-md:w-11">{e}</button>
          ))}
        </div>
      )}
      {err && <span role="alert" className="text-xs text-red-700">{err}</span>}
    </div>
  );
}

/** Поиск по чатам и фильтр по теме (записи, к которой привязан чат); тема применяется сразу. */
export function ListFilters({ q, f, e, topics }: { q: string; f: string; e: string; topics: Record<string, string> }) {
  return (
    <form action="/chat" className="flex flex-col gap-2">
      {f && <input type="hidden" name="f" value={f} />}
      <input type="search" name="q" defaultValue={q} aria-label="Поиск по чатам" placeholder="Найти чат или сообщение" className="h-10 min-w-0 rounded-md border border-neutral-300 px-3 text-sm" />
      <select name="e" defaultValue={e} aria-label="Фильтр по теме" onChange={(ev) => ev.currentTarget.form?.requestSubmit()} className="h-10 rounded-md border border-neutral-300 bg-white px-2 text-sm">
        <option value="">Все темы</option>
        {Object.entries(topics).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </form>
  );
}

type Ent = { id: string; label: string };
const SEL = "h-10 rounded-md border border-neutral-300 bg-white px-2 text-sm max-md:h-11";
const INP = "h-10 w-full rounded-md border border-neutral-300 px-3 text-sm max-md:h-11";
const CUSTOM = "__custom";

/** Единое окно «+ Новый чат»: кому → тема → (запись) → название и сообщение. Один человек — личный чат, несколько — группа. */
export function NewChatForm({ options, topics, entityTypes, viewerRole, preset, backHref }: {
  options: RecipientOption[];
  topics: string[];
  entityTypes: Record<string, string>;
  viewerRole: string;
  preset?: { type: string; id: string; label: string; topic?: string; supplierKey?: string } | null;
  backHref: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const supplierSide = viewerRole === "SUPPLIER";
  const [sel, setSel] = useState<string[]>(preset?.supplierKey && options.some((o) => o.key === preset.supplierKey) ? [preset.supplierKey] : []);
  const [q, setQ] = useState("");
  const [topicSel, setTopicSel] = useState<string>(preset?.topic && topics.includes(preset.topic) ? preset.topic : "");
  const [custom, setCustom] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [wait, setWait] = useState(true);
  const [names, setNames] = useState<string[]>([]);
  const [type, setType] = useState(preset?.type ?? "");
  const [picked, setPicked] = useState<Ent | null>(preset ? { id: preset.id, label: preset.label } : null);
  const [eq, setEq] = useState("");
  const [found, setFound] = useState<Ent[]>([]);
  const [dropped, setDropped] = useState("");
  const [dup, setDup] = useState<{ id: string; title: string } | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const isCustom = topicSel === CUSTOM;
  const topic: string | null | undefined = topicSel === "" ? undefined : isCustom ? null : topicSel;
  const byKey = new Map(options.map((o) => [o.key, o]));
  const chosen = sel.map((k) => byKey.get(k)).filter((o): o is RecipientOption => !!o);
  const supplierChosen = chosen.some((o) => o.kind === "supplier");
  const okForTopic = (o: RecipientOption) => topic === undefined || topic === null || o.topics.includes(topic);
  const list = options.filter((o) => !sel.includes(o.key) && okForTopic(o) && !(o.kind === "supplier" && supplierChosen) && (!q || o.name.toLowerCase().includes(q.toLowerCase())));
  // Роли на клиенте не известны (подрядчику их не отдаём): выбранные уже отфильтрованы по теме, сервер проверит по базе.
  const plan = topic === undefined ? null : planNewChat({ viewerRole, topic, internalRoles: chosen.filter((o) => o.kind === "user").map(() => "OWNER"), supplierCount: chosen.filter((o) => o.kind === "supplier").length });
  const planErr = plan && "error" in plan ? plan.error : "";
  const mode = plan && "mode" in plan ? plan.mode : null;
  const hint = mode === "supplier"
    ? (supplierSide ? "Общий вопрос: увидят наши сотрудники" : `Чат с подрядчиком «${chosen.find((o) => o.kind === "supplier")?.name}»: видят наши сотрудники с доступом и подрядчик`)
    : mode === "group" ? (chosen.length === 1 ? "Личный чат" : `Группа: вы и ещё ${chosen.length}`) : "";

  function pickTopic(t: string) {
    setTopicSel(t); setDup(null);
    if (t === "" || t === CUSTOM) { setDropped(""); return; }
    const gone = chosen.filter((o) => !o.topics.includes(t));
    setDropped(gone.length ? `Убрали из списка: ${gone.map((o) => o.name).join(", ")} — нет доступа к теме «${t}»` : "");
    if (gone.length) setSel((c) => c.filter((k) => !gone.some((o) => o.key === k)));
  }

  useEffect(() => {
    if (!type || picked) return;
    let dead = false;
    const t = setTimeout(() => { searchEntitiesAction(type, eq).then((r) => { if (!dead) setFound(r); }).catch(() => {}); }, 250);
    return () => { dead = true; clearTimeout(t); };
  }, [type, eq, picked]);

  function submit(e: React.FormEvent | null, force = false) {
    e?.preventDefault();
    setErr("");
    if (topic === undefined) { setErr("Выберите тему"); return; }
    if (topic === null && !custom.trim()) { setErr("Напишите свою тему"); return; }
    if (planErr) { setErr(planErr); return; }
    const fd = new FormData();
    const files = formRef.current?.querySelector<HTMLInputElement>('input[type="file"]')?.files;
    for (const f of Array.from(files ?? [])) fd.append("files", f);
    fd.set("payload", JSON.stringify({
      topic, customText: custom, title, body, waitAnswer: mode === "supplier" && wait, force,
      userIds: chosen.filter((o) => o.kind === "user").map((o) => o.id), supplierIds: chosen.filter((o) => o.kind === "supplier").map((o) => o.id),
      entityType: picked && type ? type : "", entityId: picked?.id ?? "",
    }));
    start(async () => {
      const r: NewChatState = await createChatAction({}, fd);
      if (r.existingId) { setDup({ id: r.existingId, title: r.existingTitle ?? "" }); return; }
      if (r.error && !r.threadId) { setErr(r.error); return; }
      router.push(`/chat?thread=${r.threadId}`);
      router.refresh();
    });
  }

  const chip = (on: boolean) => `inline-flex items-center rounded-full border px-3 py-1 text-sm max-md:min-h-11 ${on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white hover:bg-neutral-100"}`;

  return (
    <form ref={formRef} onSubmit={(e) => submit(e)} className="flex max-w-2xl flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <a href={backHref} className="inline-flex h-11 items-center rounded-md px-2 text-sm text-neutral-800 hover:bg-neutral-100 lg:hidden">← Назад</a>
        <h2 className="text-base font-semibold">Новый чат</h2>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">Кому{supplierSide ? " (пусто — всем нашим сотрудникам)" : ""}</legend>
        {chosen.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Выбранные получатели">
            {chosen.map((o) => (
              <li key={o.key} className="flex items-center gap-1 rounded-full bg-neutral-900 py-1 pl-3 pr-1 text-sm text-white">
                <span>{o.name}</span>{o.kind === "supplier" && <span className="text-[11px] text-neutral-300">подрядчик</span>}
                <button type="button" aria-label={`Убрать ${o.name}`} onClick={() => { setSel((c) => c.filter((k) => k !== o.key)); setDup(null); }} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-neutral-700 max-md:h-11 max-md:w-11">×</button>
              </li>
            ))}
          </ul>
        )}
        <input aria-label="Поиск получателя" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти по имени" className={INP} />
        <ul className="max-h-44 overflow-y-auto rounded-md border border-neutral-200">
          {list.length === 0 && <li className="px-3 py-2 text-sm text-neutral-600">{options.length === 0 ? "Некому писать" : "Никого не найдено"}</li>}
          {list.map((o) => (
            <li key={o.key}>
              <button type="button" onClick={() => { setSel((c) => [...c, o.key]); setQ(""); setDup(null); }} className="flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-100 md:min-h-9">
                <span>{o.name}</span>{o.hint && <span className="text-xs text-neutral-600">{o.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
        {supplierChosen && <p className="text-xs text-neutral-600">Подрядчики — по одному на чат, чтобы они не видели друг друга.</p>}
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">Тема</legend>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Тема">
          {topics.map((t) => <button key={t} type="button" aria-pressed={topicSel === t} onClick={() => pickTopic(t)} className={chip(topicSel === t)}>{t}</button>)}
          <button type="button" aria-pressed={isCustom} onClick={() => pickTopic(CUSTOM)} className={chip(isCustom)}>Своя тема</button>
        </div>
        {isCustom && <input aria-label="Своя тема" value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={100} placeholder="Например: Новая коллекция" className={INP} />}
        {isCustom && supplierSide && <p className="text-xs text-neutral-600">Своя тема — только общий вопрос нашим сотрудникам, без закрытых данных.</p>}
        {dropped && <p role="status" className="text-xs text-amber-900">{dropped}</p>}
      </fieldset>

      {hint && <p className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm" role="status">{hint}</p>}
      {planErr && <p role="alert" className="text-sm text-red-700">{planErr}</p>}

      <details className="text-sm" open={!!picked}>
        <summary className="cursor-pointer py-1 font-medium max-md:min-h-11">Привязать к записи (необязательно)</summary>
        <div className="mt-1 flex flex-col gap-1.5">
          {picked ? (
            <div className="flex items-center gap-2 rounded-md bg-neutral-100 px-3 py-1.5">
              <span className="font-medium">{picked.label}</span>
              <button type="button" className="text-xs text-neutral-700 underline max-md:min-h-11" onClick={() => { setPicked(null); setType(preset?.type ?? ""); setDup(null); }}>убрать</button>
            </div>
          ) : (
            <>
              <select aria-label="Тип записи" value={type} onChange={(e) => { setType(e.target.value); setEq(""); setFound([]); }} className={SEL}>
                <option value="">Без записи</option>
                {Object.entries(entityTypes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              {type && (
                <>
                  <input aria-label="Поиск записи" value={eq} onChange={(e) => setEq(e.target.value)} placeholder="Номер ТЗ, артикул, аукцион, отгрузка…" className={INP} />
                  <ul className="max-h-40 overflow-y-auto rounded-md border border-neutral-200">
                    {found.length === 0 && <li className="px-3 py-2 text-xs text-neutral-600">Ничего не найдено</li>}
                    {found.map((f) => <li key={f.id}><button type="button" onClick={() => { setPicked(f); setDup(null); }} className="flex min-h-11 w-full items-center px-3 py-1.5 text-left text-sm hover:bg-neutral-100 md:min-h-9">{f.label}</button></li>)}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      </details>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Название (необязательно)</span>
        <input value={title} onChange={(e) => { setTitle(e.target.value); setDup(null); }} maxLength={120} placeholder="По умолчанию: тема и получатели" className={INP} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Первое сообщение</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} className="rounded-md border border-neutral-300 px-3 py-2 text-sm" />
      </label>
      {mode === "supplier" && (
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={wait} onChange={(e) => setWait(e.target.checked)} className="h-4 w-4" />Жду ответа (покажем в «Ждут ответа»)</label>
      )}

      {dup && (
        <div role="status" className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <span>Такой чат уже есть: «{dup.title}».</span>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => router.push(`/chat?thread=${dup.id}`)}>Открыть существующий</Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => submit(null, true)}>Всё равно создать новый</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilePick names={names} onChange={setNames} />
        <div className="flex items-center gap-2">
          {err && <span role="alert" className="text-xs text-red-700">{err}</span>}
          {!dup && <Button type="submit" disabled={pending} className="h-11 md:h-10">{pending ? "Создаю…" : "Создать чат"}</Button>}
        </div>
      </div>
    </form>
  );
}

type ChatMember = { userId: string; name: string; role: string; isSupplier: boolean; supplierId: string | null; orgName: string };
type Cand = { id: string; name: string; isSupplier: boolean; supplierId: string | null; orgName: string };

/** Меню «⋯» в шапке: название и тема, участники, закрыть / открыть, Telegram — всё в одном месте. */
export function ChatMenu({ threadId, kind, subject, topic, topicChoices, closed, canEdit, canManage, canClose, members, me, telegramOn }: {
  threadId: string; kind: string; subject: string; topic: string; topicChoices: string[]; closed: boolean;
  canEdit: boolean; canManage: boolean; canClose: boolean; members: ChatMember[]; me: string; telegramOn: boolean;
}) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(subject);
  const [top, setTop] = useState(topic);
  const [add, setAdd] = useState<Cand[] | null>(null);
  const [err, setErr] = useState("");
  const [tg, setTg] = useState("");
  const [pending, start] = useTransition();
  const isGroup = kind === "GROUP";

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  const run = (fn: () => Promise<{ error?: string }>, done?: () => void) => start(async () => {
    const r = await fn();
    if (r.error) { setErr(r.error); return; }
    setErr(""); done?.(); router.refresh();
  });
  const member = (userId: string, op: "add" | "remove") => run(() => changeMemberAction(threadId, userId, op), () => { setAdd(null); if (userId === me) router.push("/chat"); });
  const loadAdd = () => eligibleUsersAction(topic).then((r) => setAdd(r.filter((p) => !members.some((m) => m.userId === p.id))));
  const supInGroup = members.find((m) => m.isSupplier)?.supplierId ?? null;
  const addList = (add ?? []).filter((p) => !p.isSupplier || !supInGroup || p.supplierId === supInGroup);
  const row = "flex min-h-11 w-full items-center rounded px-2 text-left text-sm hover:bg-neutral-100 md:min-h-9";

  return (
    <div ref={box} className="relative">
      <button type="button" aria-label="Действия с чатом" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 items-center justify-center rounded-md border border-neutral-300 bg-white text-lg hover:bg-neutral-50 md:h-10 md:w-10">⋯</button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 flex max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-3 shadow-lg">
          {canEdit && (
            <form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); run(() => updateThreadAction(threadId, name, top !== topic ? top : undefined)); }}>
              <label className="flex flex-col gap-1 text-xs text-neutral-700">Название
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={INP} />
              </label>
              {topic && topicChoices.length > 0 && (
                <label className="flex flex-col gap-1 text-xs text-neutral-700">Тема
                  <select value={top} onChange={(e) => setTop(e.target.value)} className={SEL}>
                    {[...new Set([topic, ...topicChoices])].map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
              )}
              <Button type="submit" size="sm" variant="outline" disabled={pending || (name === subject && top === topic)}>Сохранить</Button>
            </form>
          )}
          {isGroup && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-neutral-700">Участники: {members.length}</span>
              <ul className="flex flex-col">
                {members.map((m) => (
                  <li key={m.userId} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{m.userId === me ? "Вы" : m.name}{m.isSupplier ? ` · ${m.orgName}` : ""}{m.role === "OWNER" ? " (владелец)" : ""}</span>
                    {(canManage || m.userId === me) && <button type="button" disabled={pending} onClick={() => member(m.userId, "remove")} className="min-h-11 shrink-0 px-2 text-red-700 underline md:min-h-9">{m.userId === me ? "Выйти" : "Убрать"}</button>}
                  </li>
                ))}
              </ul>
              {canManage && (add === null
                ? <button type="button" className={`${row} underline`} onClick={loadAdd}>Добавить участника</button>
                : <select aria-label="Добавить участника" defaultValue="" onChange={(e) => e.target.value && member(e.target.value, "add")} className={SEL}>
                    <option value="">{addList.length ? "— выберите —" : "Некого добавить"}</option>
                    {addList.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isSupplier ? ` (${p.orgName})` : ""}</option>)}
                  </select>)}
            </div>
          )}
          {canClose && (
            <button type="button" role="menuitem" disabled={pending} className={row} onClick={() => run(() => setThreadClosed(threadId, !closed), () => setOpen(false))}>
              {closed ? "Открыть чат заново" : "Закрыть чат"}
            </button>
          )}
          {isGroup && canManage && telegramOn && (
            <div className="flex flex-col gap-1">
              <button type="button" className={`${row} underline`} onClick={() => createThreadBindCode(threadId).then((r) => setTg(r.error ?? `В группе Telegram с ботом напишите: ${r.hint} (код на ${r.minutes} минут)`))}>Привязать Telegram-группу</button>
              {tg && <p className="rounded bg-neutral-100 p-2 text-xs">{tg}</p>}
            </div>
          )}
          {err && <p role="alert" className="text-xs text-red-700">{err}</p>}
        </div>
      )}
    </div>
  );
}
