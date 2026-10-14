"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { markThreadRead, searchEntitiesAction, sendMessage, setThreadClosed, startThread } from "./actions";

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
