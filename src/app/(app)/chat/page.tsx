import Link from "next/link";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canUseChat, chatCounts, groupMembers, loadThread, resolveEntity, supplierName, threadWhere, viewerOf } from "@/lib/chat";
import { GROUP_TOPICS, TOPIC_OF_ENTITY, canCreateGroup, canManageGroup, eligibleForTopic, ENTITY_TYPES, REQUEST_TYPES, SUPPLIER_ENTITY_TYPES, awaitsMyAnswer, entityHrefFor, isUnread } from "@/lib/chat-core";
import { cn } from "@/lib/utils";
import { TelegramConnect } from "./telegram-connect";
import { telegramToken } from "@/lib/channels/telegram";
import { hasRole, ACCESS } from "@/lib/access";
import { ChatAutoRefresh, CloseButton, Composer, GroupMembers, NewGroupForm, NewRequestForm, ScrollBottom } from "./chat-client";

export const metadata = { title: "Чат" };

const STATUS_LABEL = { OPEN: "Открыт", ANSWERED: "Ответ получен", CLOSED: "Закрыт" } as const;
const STATUS_TONE = { OPEN: "bg-amber-100 text-amber-900", ANSWERED: "bg-emerald-100 text-emerald-800", CLOSED: "bg-neutral-200 text-neutral-600" } as const;
const FILTERS = [
  { key: "", label: "Все" },
  { key: "mine", label: "Мои" },
  { key: "await", label: "Ждут моего ответа" },
  { key: "req", label: "Запросы" },
  { key: "closed", label: "Закрытые" },
] as const;

const fmt = (d: Date) => new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(d);
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  const s = await requireSession({ allowSupplier: true });
  if (!canUseChat(s.user.role)) redirect("/dashboard");
  const v = viewerOf(s);
  const sp = await searchParams;
  const f = FILTERS.some((x) => x.key === one(sp.f)) ? one(sp.f) : "";
  const q = one(sp.q).trim().slice(0, 80);
  const threadId = one(sp.thread);
  const isNew = one(sp.new) === "1";

  // «Написать / Запросить» с карточки записи: открываем последнее обсуждение по записи или готовим форму.
  let preset: { type: string; id: string; label: string } | null = null;
  const entityParam = one(sp.entity);
  if (entityParam) {
    const [type, id] = entityParam.split(":");
    const e = type && id ? await resolveEntity(v, type, id) : null;
    if (e) {
      const ex = await prisma.chatThread.findFirst({ where: { AND: [threadWhere(v)], kind: { not: "GROUP" }, entityType: e.type, entityId: e.id }, orderBy: { lastMessageAt: "desc" }, select: { id: true } });
      if (ex) redirect(`/chat?thread=${ex.id}`);
      preset = { type: e.type, id: e.id, label: e.label };
    }
  }

  let groupPreset: { topic: string; name: string; type: string; id: string; label: string } | null = null;
  const gp = one(sp.group);
  if (gp && canCreateGroup(v.role)) {
    const [type, id] = gp.split(":");
    const e = type && id ? await resolveEntity(v, type, id) : null;
    const topic = e ? TOPIC_OF_ENTITY[e.type] : undefined;
    if (e && topic && eligibleForTopic(topic, v.role)) groupPreset = { topic, name: `Группа: ${e.label}`, type: e.type, id: e.id, label: e.label };
  }
  const where = {
    AND: [
      threadWhere(v),
      { kind: { not: "GROUP" as const } },
      f === "closed" ? { status: "CLOSED" as const } : { status: { not: "CLOSED" as const } },
      ...(f === "mine" ? [{ createdById: v.id }] : []),
      ...(f === "req" ? [{ kind: "REQUEST" as const }] : []),
      ...(q ? [{ OR: [{ subject: { contains: q, mode: "insensitive" as const } }, { entityLabel: { contains: q, mode: "insensitive" as const } }, { messages: { some: { body: { contains: q, mode: "insensitive" as const } } } }] }] : []),
    ],
  };
  const groups = await prisma.chatThread.findMany({
    where: { AND: [threadWhere(v), { kind: "GROUP" }, ...(q ? [{ subject: { contains: q, mode: "insensitive" as const } }] : [])] },
    orderBy: { lastMessageAt: "desc" }, take: 100,
    include: { reads: { where: { userId: v.id }, select: { lastReadAt: true } }, _count: { select: { members: true } } },
  });
  const [rowsRaw, counts, selected] = await Promise.all([
    prisma.chatThread.findMany({
      where, orderBy: { lastMessageAt: "desc" }, take: 150,
      include: { reads: { where: { userId: v.id }, select: { lastReadAt: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, authorName: true, attachments: { select: { id: true }, take: 1 } } } },
    }),
    chatCounts(v),
    threadId ? loadThread(v, threadId) : Promise.resolve(null),
  ]);
  const rows = f === "await" ? rowsRaw.filter((t) => awaitsMyAnswer(t, v.side)) : rowsRaw;
  const supplier = selected ? await supplierName(v.organizationId, selected.supplierId) : "";
  const peerLabel = v.side === "SUPPLIER" ? s.user.organizationName : supplier || "Поставщик";

  let messages: Awaited<ReturnType<typeof loadMessages>> = [];
  let entityHref: string | null = null;
  if (selected) {
    messages = await loadMessages(selected.id);
    let inboxKind: string | null = null;
    if (selected.entityType === "SupplierInbox" && selected.entityId) inboxKind = (await prisma.supplierInbox.findUnique({ where: { id: selected.entityId }, select: { kind: true } }))?.kind ?? null;
    entityHref = entityHrefFor(selected.entityType, selected.entityId, v.side, { inboxKind });
  }
  const selUnread = selected ? isUnread(selected, (await prisma.chatRead.findUnique({ where: { threadId_userId: { threadId: selected.id, userId: v.id } }, select: { lastReadAt: true } }))?.lastReadAt, v.side) : false;
  const listHref = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    const m = { f, q, ...over };
    for (const [k, val] of Object.entries(m)) if (val) p.set(k, val);
    const qs = p.toString();
    return `/chat${qs ? "?" + qs : ""}`;
  };
  const entityTypes = v.side === "SUPPLIER" ? Object.fromEntries(SUPPLIER_ENTITY_TYPES.map((t) => [t, ENTITY_TYPES[t]])) : ENTITY_TYPES;
  const myTg = await prisma.channelLink.count({ where: { organizationId: v.organizationId, userId: v.id, channel: "TELEGRAM" } });
  const showForm = isNew || (!!preset && !selected);
  const showGroupForm = canCreateGroup(v.role) && (one(sp.newgroup) === "1" || !!groupPreset) && !selected;
  const members = selected?.kind === "GROUP" ? await groupMembers(selected.id) : [];
  const topicsForMe = Object.keys(GROUP_TOPICS).filter((t) => eligibleForTopic(t, v.role));

  return (
    <div className="flex flex-col gap-3">
      <Breadcrumbs items={[{ label: "Чат" }]} />
      <ChatAutoRefresh threadId={selected?.id} unread={selUnread} lastAt={selected?.lastMessageAt.toISOString()} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Чат</h1>
          <p className="text-sm text-neutral-600">
            {counts.awaiting > 0 ? <Link href={listHref({ f: "await", thread: "" })} className="font-medium text-amber-800 underline">Ждут вашего ответа: {counts.awaiting}</Link> : "Ждут вашего ответа: 0"}
            {counts.unread > 0 && <span className="ml-3 text-neutral-500">Непрочитанных: {counts.unread}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {canCreateGroup(v.role) && <Link href="/chat?newgroup=1" className="inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium hover:bg-neutral-50 max-md:min-h-10">+ Группа</Link>}
          <Link href="/chat?new=1" className="inline-flex h-9 items-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700 max-md:min-h-10">Новый запрос</Link>
        </div>
      </div>

      <div className="grid min-h-[60vh] gap-3 md:grid-cols-[22rem_1fr]">
        <section aria-label="Обсуждения" className={cn("flex min-w-0 flex-col gap-2", (selected || showForm || showGroupForm) && "max-md:hidden")}>
          <form action="/chat" className="flex gap-2">
            {f && <input type="hidden" name="f" value={f} />}
            <input name="q" defaultValue={q} placeholder="Поиск по теме, записи, тексту" className="h-9 min-w-0 flex-1 rounded-md border border-neutral-300 px-3 text-sm" />
          </form>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((x) => (
              <Link key={x.key} href={listHref({ f: x.key })} aria-current={f === x.key ? "page" : undefined}
                className={cn("rounded-full border px-2.5 py-0.5 text-xs", f === x.key ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:bg-neutral-100")}>{x.label}</Link>
            ))}
          </div>
          <h3 className="mt-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Мои чаты (запросы по записям)</h3>
          <ul className="flex flex-col divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
            {rows.length === 0 && <li className="p-4 text-sm text-neutral-500">Обсуждений пока нет. Нажмите «Новый запрос».</li>}
            {rows.map((t) => {
              const unread = isUnread(t, t.reads[0]?.lastReadAt, v.side);
              const last = t.messages[0];
              return (
                <li key={t.id}>
                  <Link href={`/chat?thread=${t.id}${f ? `&f=${f}` : ""}`} className={cn("block px-3 py-2 hover:bg-neutral-50", selected?.id === t.id && "bg-neutral-100")}>
                    <div className="flex items-center gap-1.5">
                      <span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>{t.subject}</span>
                      <span className="shrink-0 text-[11px] text-neutral-400">#{t.number}</span>
                      {unread && <span className="shrink-0 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">новое</span>}
                      <span className="ml-auto shrink-0 text-[11px] text-neutral-500">{fmt(t.lastMessageAt)}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
                      {t.kind === "REQUEST" && <span className={cn("rounded px-1.5 py-px", STATUS_TONE[t.status])}>Запрос · {STATUS_LABEL[t.status]}</span>}
                      {t.kind === "GENERAL" && t.status === "CLOSED" && <span className={cn("rounded px-1.5 py-px", STATUS_TONE.CLOSED)}>Закрыт</span>}
                      {t.entityLabel && <span className="truncate rounded bg-neutral-100 px-1.5 py-px text-neutral-700">{t.entityLabel}</span>}
                    </div>
                    {last && <div className="mt-0.5 truncate text-xs text-neutral-500">{last.authorName}: {last.body || (last.attachments.length ? "📎 файл" : "")}</div>}
                  </Link>
                </li>
              );
            })}
          </ul>
          <h3 className="mt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Группы</h3>
          <ul aria-label="Группы" className="flex flex-col divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
            {groups.length === 0 && <li className="p-3 text-sm text-neutral-500">Групп пока нет.</li>}
            {groups.map((g) => {
              const unread = isUnread(g, g.reads[0]?.lastReadAt, v.side);
              return (
                <li key={g.id}>
                  <Link href={`/chat?thread=${g.id}`} className={cn("block px-3 py-2 hover:bg-neutral-50", selected?.id === g.id && "bg-neutral-100")}>
                    <div className="flex items-center gap-1.5">
                      <span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>{g.subject}</span>
                      {unread && <span className="shrink-0 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">новое</span>}
                      <span className="ml-auto shrink-0 text-[11px] text-neutral-500">{fmt(g.lastMessageAt)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-[11px]">
                      <span className="rounded bg-violet-100 px-1.5 py-px text-violet-800">{g.topic}</span>
                      <span className="text-neutral-500">участников: {g._count.members}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="Переписка" className={cn("min-w-0", !selected && !showForm && !showGroupForm && "max-md:hidden")}>
          {showGroupForm && <NewGroupForm topics={topicsForMe} preset={groupPreset} />}
          {showForm && !showGroupForm && <NewRequestForm entityTypes={entityTypes} preset={preset} requestTypes={REQUEST_TYPES} />}
          {!showForm && !showGroupForm && !selected && <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">Выберите обсуждение слева или создайте новый запрос.</div>}
          {!showForm && !showGroupForm && selected && (
            <div className="flex h-[70vh] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-neutral-200 px-3 py-2">
                <div className="min-w-0">
                  <Link href={listHref({})} className="text-xs text-neutral-500 underline md:hidden">← К списку</Link>
                  <h2 className="truncate text-base font-semibold">{selected.subject}</h2>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-600">
                    {selected.kind === "GROUP" ? <span className="rounded bg-violet-100 px-1.5 py-px text-violet-800">Группа · {selected.topic}</span> : <span>{peerLabel}</span>}
                    {selected.kind === "REQUEST" && <span className={cn("rounded px-1.5 py-px", STATUS_TONE[selected.status])}>{selected.requestType ? selected.requestType + " · " : ""}{STATUS_LABEL[selected.status]}</span>}
                    {selected.entityLabel && (entityHref
                      ? <Link href={entityHref} className="rounded bg-neutral-100 px-1.5 py-px text-neutral-800 underline">{selected.entityLabel}</Link>
                      : <span className="rounded bg-neutral-100 px-1.5 py-px">{selected.entityLabel}</span>)}
                  </div>
                </div>
                {selected.kind === "GROUP" && <div className="w-full"><GroupMembers threadId={selected.id} topic={selected.topic ?? ""} me={v.id} canManage={canManageGroup({ id: v.id, role: v.role }, members)} members={members} telegramOn={!!telegramToken()} /></div>}
                {(selected.kind === "REQUEST" || selected.status === "CLOSED") && <CloseButton threadId={selected.id} closed={selected.status === "CLOSED"} />}
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto bg-neutral-50 p-3">
                {messages.map((m) => {
                  const mine = m.authorSide === v.side;
                  return (
                    <div key={m.id} className={cn("flex max-w-[85%] flex-col gap-0.5", mine ? "self-end items-end" : "self-start items-start")}>
                      <div className="text-[11px] text-neutral-500">
                        {m.authorName} · {mine ? "Мы" : m.authorSide === "SUPPLIER" ? supplier || "Веллмех" : s.user.organizationName} · {fmt(m.createdAt)}
                        {m.source === "TELEGRAM" && <span className="ml-1 rounded bg-sky-100 px-1 text-sky-800">из Telegram</span>}
                        {m.source === "WHATSAPP" && <span className="ml-1 rounded bg-emerald-100 px-1 text-emerald-800">из WhatsApp</span>}
                      </div>
                      <div className={cn("whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm", mine ? "bg-neutral-900 text-white" : "border border-neutral-200 bg-white")}>
                        {m.body}
                        {m.attachments.length > 0 && (
                          <div className={cn("flex flex-col gap-1", m.body && "mt-2")}>
                            {m.attachments.map((a) => (
                              /^image\//.test(a.mimeType)
                                ? <a key={a.id} href={`/api/chat/files/${a.id}`} target="_blank" rel="noreferrer"><img src={`/api/chat/files/${a.id}`} alt={a.originalName} className="max-h-48 rounded-md" /></a>
                                : <a key={a.id} href={`/api/chat/files/${a.id}`} className="underline">📎 {a.originalName}</a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <ScrollBottom dep={messages.at(-1)?.id ?? ""} />
              </div>
              {selected.status === "CLOSED"
                ? <div className="border-t border-neutral-200 p-3 text-sm text-neutral-500">Запрос закрыт. Новое сообщение откроет его заново.</div>
                : null}
              <Composer threadId={selected.id} />
            </div>
          )}
        </section>
      </div>
      <details className="max-w-3xl rounded-lg border border-neutral-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-medium">Подключить Telegram</summary>
        <div className="mt-2 flex flex-col gap-2">
          <TelegramConnect linked={myTg > 0} hasToken={!!telegramToken()} />
          {hasRole(v.role, ACCESS.channels) && <a href="/settings/channels" className="text-sm text-blue-700 underline">Каналы: группы поставщика, привязки, WhatsApp</a>}
        </div>
      </details>
    </div>
  );
}

function loadMessages(threadId: string) {
  return prisma.chatMessage.findMany({
    where: { threadId }, orderBy: { createdAt: "asc" }, take: 500,
    include: { attachments: { select: { id: true, originalName: true, mimeType: true }, orderBy: { createdAt: "asc" } } },
  });
}
