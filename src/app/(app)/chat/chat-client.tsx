"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createThreadBindCode } from "./channel-actions";
import { changeMemberAction, createGroupAction, eligibleUsersAction, markThreadRead, searchEntitiesAction, sendMessage, setThreadClosed, startThread, toggleReactionAction } from "./actions";

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
export function Composer({ threadId }: { threadId: string }) {
  const router = useRouter();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [err, setErr] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [pending, start] = useTransition();

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
      setErr(""); setFiles([]); if (taRef.current) taRef.current.value = "";
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
          ref={taRef} rows={1} maxLength={4000} aria-label="Сообщение" placeholder="Сообщение"
          className="max-h-40 min-h-11 w-full min-w-0 resize-none rounded-md border border-neutral-300 px-3 py-2.5 text-sm md:min-h-10 md:py-2"
          onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 160) + "px"; }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          onPaste={(e) => { const fl = Array.from(e.clipboardData.files); if (fl.length) { e.preventDefault(); addFiles(fl.map((f) => (f.name && f.name !== "image.png" ? f : new File([f], `снимок-${Date.now()}.png`, { type: f.type })))); } }}
        />
        <Button type="submit" disabled={pending} className="h-11 shrink-0 px-4 md:h-10">{pending ? "…" : "Отправить"}</Button>
      </div>
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
      <select name="e" defaultValue={e} aria-label="Тема" onChange={(ev) => ev.currentTarget.form?.requestSubmit()} className="h-10 rounded-md border border-neutral-300 bg-white px-2 text-sm">
        <option value="">Все темы</option>
        {Object.entries(topics).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </form>
  );
}

export function CloseButton({ threadId, closed }: { threadId: string; closed: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => start(async () => { await setThreadClosed(threadId, !closed); router.refresh(); })}>
      {closed ? "Открыть заново" : "Закрыть запрос"}
    </Button>
  );
}

type Ent = { id: string; label: string };

export function NewRequestForm({
  entityTypes, preset, requestTypes, canPickGeneral = true,
}: {
  entityTypes: Record<string, string>;
  preset?: { type: string; id: string; label: string } | null;
  requestTypes: readonly string[];
  canPickGeneral?: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [type, setType] = useState(preset?.type ?? "");
  const [picked, setPicked] = useState<Ent | null>(preset ? { id: preset.id, label: preset.label } : null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Ent[]>([]);
  const [kind, setKind] = useState<"REQUEST" | "GENERAL">("REQUEST");
  const [names, setNames] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!type || picked) return;
    let dead = false;
    const t = setTimeout(() => { searchEntitiesAction(type, q).then((r) => { if (!dead) setFound(r); }).catch(() => {}); }, 250);
    return () => { dead = true; clearTimeout(t); };
  }, [type, q, picked]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData(formRef.current!);
    fd.set("kind", kind);
    if (picked && type) { fd.set("entityType", type); fd.set("entityId", picked.id); }
    start(async () => {
      const r = await startThread({}, fd);
      if (r.error) { setErr(r.error); return; }
      router.push(`/chat?thread=${r.threadId}`);
      router.refresh();
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="flex max-w-2xl flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-base font-semibold">Новое обсуждение</h2>
      <div className="flex gap-2 text-sm">
        {(["REQUEST", "GENERAL"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
            className={`rounded-full border px-3 py-1 ${kind === k ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:bg-neutral-100"}`}>
            {k === "REQUEST" ? "Запрос (ждёт ответа)" : "Просто сообщение"}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-600">По какой записи</span>
        <select aria-label="Тип записи" value={type} disabled={!!preset} onChange={(e) => { setType(e.target.value); setPicked(null); setQ(""); setFound([]); }} className="h-9 rounded-md border border-neutral-300 bg-white px-2">
          {canPickGeneral && <option value="">Общий вопрос (без записи)</option>}
          {Object.entries(entityTypes).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {type && !picked && (
          <>
            <input aria-label="Поиск записи" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Номер ТЗ, артикул, аукцион, отгрузка…" className="h-9 rounded-md border border-neutral-300 px-3" />
            <ul className="max-h-44 overflow-y-auto rounded-md border border-neutral-200">
              {found.length === 0 && <li className="px-3 py-2 text-xs text-neutral-500">Ничего не найдено</li>}
              {found.map((f) => (
                <li key={f.id}><button type="button" onClick={() => setPicked(f)} className="w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-100">{f.label}</button></li>
              ))}
            </ul>
          </>
        )}
        {picked && (
          <div className="flex items-center gap-2 rounded-md bg-neutral-100 px-3 py-1.5">
            <span className="font-medium">{picked.label}</span>
            {!preset && <button type="button" className="text-xs text-neutral-500 underline" onClick={() => setPicked(null)}>выбрать другую</button>}
          </div>
        )}
      </div>
      {kind === "REQUEST" && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-600">Тип запроса</span>
          <select name="requestType" defaultValue={requestTypes[0]} className="h-9 rounded-md border border-neutral-300 bg-white px-2">
            {requestTypes.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-600">Тема (необязательно)</span>
        <input name="subject" maxLength={160} className="h-9 rounded-md border border-neutral-300 px-3" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-600">Сообщение</span>
        <textarea name="body" rows={4} maxLength={4000} className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>
      <div className="flex items-center justify-between gap-2">
        <FilePick names={names} onChange={setNames} />
        <div className="flex items-center gap-2">
          {err && <span role="alert" className="text-xs text-red-700">{err}</span>}
          <Button type="submit" disabled={pending}>{pending ? "Создаю…" : kind === "REQUEST" ? "Отправить запрос" : "Отправить"}</Button>
        </div>
      </div>
    </form>
  );
}

type Person = { id: string; name: string; role: string; isSupplier: boolean };

/** Форма «+ Группа»: название, тема, участники чекбоксами с поиском (только те, у кого есть доступ к теме). */
export function NewGroupForm({ topics, preset }: { topics: string[]; preset?: { topic: string; name: string; type: string; id: string; label: string } | null }) {
  const router = useRouter();
  const [topic, setTopic] = useState(preset?.topic ?? topics[0]);
  const [name, setName] = useState(preset?.name ?? "");
  const [people, setPeople] = useState<Person[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => {
    let dead = false;
    eligibleUsersAction(topic).then((r) => { if (!dead) { setPeople(r); setChosen((c) => new Set([...c].filter((id) => r.some((p) => p.id === id)))); } }).catch(() => {});
    return () => { dead = true; };
  }, [topic]);
  const shown = people.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await createGroupAction({ name, topic, memberIds: [...chosen], entityType: preset?.type, entityId: preset?.id });
      if (r.error) { setErr(r.error); return; }
      router.push(`/chat?thread=${r.threadId}`); router.refresh();
    });
  }
  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-base font-semibold">Новая группа</h2>
      {preset && <div className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm">По записи: <b>{preset.label}</b></div>}
      <label className="flex flex-col gap-1 text-sm"><span className="text-neutral-600">Название</span>
        <input aria-label="Название группы" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-9 rounded-md border border-neutral-300 px-3" /></label>
      <label className="flex flex-col gap-1 text-sm"><span className="text-neutral-600">Тема</span>
        <select aria-label="Тема группы" value={topic} onChange={(e) => setTopic(e.target.value)} className="h-9 rounded-md border border-neutral-300 bg-white px-2">
          {topics.map((t) => <option key={t}>{t}</option>)}
        </select></label>
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-neutral-600">Участники (только те, у кого есть доступ к теме «{topic}»; вы добавлены сами)</span>
        <input aria-label="Поиск участника" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по имени" className="h-9 rounded-md border border-neutral-300 px-3" />
        <ul className="max-h-48 overflow-y-auto rounded-md border border-neutral-200">
          {shown.length === 0 && <li className="px-3 py-2 text-xs text-neutral-500">Никого</li>}
          {shown.map((p) => (
            <li key={p.id}><label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-neutral-50">
              <input type="checkbox" checked={chosen.has(p.id)} onChange={(e) => setChosen((c) => { const n = new Set(c); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />
              <span>{p.name}</span>{p.isSupplier && <span className="rounded bg-sky-100 px-1.5 text-[11px] text-sky-800">Веллмех</span>}
            </label></li>
          ))}
        </ul>
      </div>
      <div className="flex items-center justify-end gap-2">
        {err && <span role="alert" className="text-xs text-red-700">{err}</span>}
        <Button type="submit" disabled={pending}>{pending ? "Создаю…" : "Создать группу"}</Button>
      </div>
    </form>
  );
}

/** Участники группы в шапке: список, «Добавить», «Убрать», «Выйти». */
export function GroupMembers({ threadId, topic, me, canManage, members, telegramOn }: {telegramOn: boolean;  threadId: string; topic: string; me: string; canManage: boolean; members: { userId: string; name: string; role: string; isSupplier: boolean }[] }) {
  const router = useRouter();
  const [add, setAdd] = useState<Person[] | null>(null);
  const [err, setErr] = useState("");
  const [tg, setTg] = useState("");
  const [pending, start] = useTransition();
  const run = (userId: string, op: "add" | "remove") => start(async () => {
    const r = await changeMemberAction(threadId, userId, op);
    if (r.error) setErr(r.error); else { setErr(""); setAdd(null); router.refresh(); }
  });
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-neutral-700">Участники: {members.length}</summary>
      <ul className="mt-1 flex flex-col gap-1">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-2">
            <span>{m.name}{m.role === "OWNER" ? " (владелец)" : ""}</span>
            {m.isSupplier && <span className="rounded bg-sky-100 px-1.5 text-sky-800">Веллмех</span>}
            {(canManage || m.userId === me) && <button type="button" disabled={pending} onClick={() => run(m.userId, "remove")} className="text-red-700 underline">{m.userId === me ? "Выйти" : "Убрать"}</button>}
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="mt-2">
          {add === null
            ? <button type="button" className="underline" onClick={() => eligibleUsersAction(topic).then((r) => setAdd(r.filter((p) => !members.some((m) => m.userId === p.id))))}>Добавить участника</button>
            : <select aria-label="Добавить участника" defaultValue="" onChange={(e) => e.target.value && run(e.target.value, "add")} className="h-8 rounded-md border border-neutral-300 bg-white px-2">
                <option value="">— выберите —</option>{add.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isSupplier ? " (Веллмех)" : ""}</option>)}
              </select>}
        </div>
      )}
      {canManage && telegramOn && (
        <div className="mt-2">
          <button type="button" className="underline" onClick={() => createThreadBindCode(threadId).then((r) => setTg(r.error ?? `В группе Telegram с ботом напишите: ${r.hint} (код на ${r.minutes} минут)`))}>Привязать Telegram-группу</button>
          {tg && <p className="mt-1 rounded bg-neutral-100 p-2">{tg}</p>}
        </div>
      )}
      {err && <p role="alert" className="mt-1 text-red-700">{err}</p>}
    </details>
  );
}
