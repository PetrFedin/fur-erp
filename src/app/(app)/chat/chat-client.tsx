"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createThreadBindCode } from "./channel-actions";
import { changeMemberAction, createGroupAction, eligibleUsersAction, markThreadRead, searchEntitiesAction, sendMessage, setThreadClosed, startThread } from "./actions";

const FILE_ACCEPT = ".pdf,.xlsx,.docx,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf";

/** Раз в 10 секунд обновляет страницу (новые сообщения), при открытии непрочитанного отмечает его прочитанным. */
export function ChatAutoRefresh({ threadId, unread, lastAt }: { threadId?: string; unread?: boolean; lastAt?: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!threadId || !unread) return;
    markThreadRead(threadId).then(() => router.refresh()).catch(() => {});
  }, [threadId, unread, lastAt, router]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 10000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}

/** Прокручивает переписку вниз при открытии и новых сообщениях. */
export function ScrollBottom({ dep }: { dep: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "end" }); }, [dep]);
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

export function Composer({ threadId }: { threadId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [err, setErr] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [pending, start] = useTransition();
  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const fd = new FormData(formRef.current!);
    start(async () => {
      const r = await sendMessage({}, fd);
      if (r.error) { setErr(r.error); return; }
      setErr(""); setNames([]); formRef.current?.reset(); router.refresh();
    });
  }
  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-2 border-t border-neutral-200 bg-white p-3">
      <input type="hidden" name="threadId" value={threadId} />
      <textarea
        name="body" rows={2} maxLength={4000} placeholder="Напишите сообщение… (Enter — отправить, Shift+Enter — новая строка)"
        className="w-full resize-y rounded-md border border-neutral-300 px-3 py-2 text-sm"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
      />
      {names.length > 0 && <div className="truncate text-xs text-neutral-500">{names.join(", ")}</div>}
      <div className="flex items-center justify-between gap-2">
        <FilePick names={names} onChange={setNames} />
        <div className="flex items-center gap-2">
          {err && <span role="alert" className="text-xs text-red-700">{err}</span>}
          <Button type="submit" size="sm" disabled={pending}>{pending ? "Отправляю…" : "Отправить"}</Button>
        </div>
      </div>
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
