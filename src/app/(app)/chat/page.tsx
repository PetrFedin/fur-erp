import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canUseChat, groupMembers, loadReactions, loadThread, recipientOptions, resolveEntity, supplierName, threadWhere, viewerOf } from "@/lib/chat";
import { statusLabelFor, TOPIC_OF_ENTITY, GROUP_TOPICS, createTopicsFor, canCreateGroup, canManageGroup, eligibleForTopic, ENTITY_TYPES, REACTIONS, SUPPLIER_ENTITY_TYPES, awaitsMyAnswer, entityHrefFor, isUnread, mentionsUser, participantsLabel, splitMentions } from "@/lib/chat-core";
import { cn } from "@/lib/utils";
import { TelegramConnect } from "./telegram-connect";
import { telegramToken } from "@/lib/channels/telegram";
import { hasRole, ACCESS } from "@/lib/access";
import { ChatAutoRefresh, ChatMenu, Composer, ListFilters, NewChatForm, Reactions, ScrollBottom } from "./chat-client";

export const metadata = { title: "Чат" };

const STATUS_TONE = { OPEN: "bg-amber-100 text-amber-900", ANSWERED: "bg-emerald-100 text-emerald-800", CLOSED: "bg-neutral-200 text-neutral-700" } as const;
const FILTERS = [
  { key: "", label: "Все" },
  { key: "await", label: "Ждут ответа" },
  { key: "groups", label: "Группы" },
  { key: "closed", label: "Закрытые" },
] as const;

const TZ = "Europe/Moscow";
const timeFmt = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayKey = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(d);
const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: TZ });
const shortFmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", timeZone: TZ });
/** Время в списке: сегодня — часы и минуты, иначе дата. */
const listTime = (d: Date, now: Date) => (dayKey(d) === dayKey(now) ? timeFmt.format(d) : shortFmt.format(d));
function dayLabel(d: Date, now: Date) {
  if (dayKey(d) === dayKey(now)) return "Сегодня";
  if (dayKey(d) === dayKey(new Date(now.getTime() - 86400000))) return "Вчера";
  return dayFmt.format(d);
}
const fileSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  const s = await requireSession({ allowSupplier: true });
  if (!canUseChat(s.user.role)) redirect("/dashboard");
  const v = viewerOf(s);
  const sp = await searchParams;
  const f = FILTERS.some((x) => x.key === one(sp.f)) ? one(sp.f) : "";
  const q = one(sp.q).trim().slice(0, 80);
  const entityTypes = v.side === "SUPPLIER" ? Object.fromEntries(SUPPLIER_ENTITY_TYPES.map((t) => [t, ENTITY_TYPES[t]])) : ENTITY_TYPES;
  // Фильтр «по теме» — те же темы, что при создании чата.
  const topicsAll = Object.keys(GROUP_TOPICS).filter((t) => eligibleForTopic(t, v.role) && (v.side !== "SUPPLIER" || createTopicsFor("SUPPLIER").includes(t)));
  const e = topicsAll.includes(one(sp.e)) ? one(sp.e) : "";
  const threadId = one(sp.thread);
  const isNew = one(sp.new) === "1";
  const now = new Date();

  // «Написать / Запросить» и «Создать группу» с карточки записи: открываем последнее общее обсуждение по записи или готовим «Новый чат» с записью.
  let preset: { type: string; id: string; label: string; topic?: string; supplierKey?: string } | null = null;
  const entityParam = one(sp.entity) || one(sp.group);
  if (entityParam) {
    const [type, id] = entityParam.split(":");
    const ent = type && id ? await resolveEntity(v, type, id) : null;
    if (ent) {
      if (one(sp.entity)) {
        const ex = await prisma.chatThread.findFirst({ where: { AND: [threadWhere(v)], kind: { not: "GROUP" }, entityType: ent.type, entityId: ent.id }, orderBy: { lastMessageAt: "desc" }, select: { id: true } });
        if (ex) redirect(`/chat?thread=${ex.id}`);
      }
      const topic = TOPIC_OF_ENTITY[ent.type];
      preset = {
        type: ent.type, id: ent.id, label: ent.label,
        topic: topic && createTopicsFor(v.role).includes(topic) ? topic : undefined,
        supplierKey: v.side !== "SUPPLIER" && ent.supplierId ? `s:${ent.supplierId}` : undefined,
      };
    }
  }

  const where = {
    AND: [
      threadWhere(v),
      f === "closed" ? { status: "CLOSED" as const } : { status: { not: "CLOSED" as const } },
      ...(f === "await" ? [{ kind: "REQUEST" as const }] : []),
      ...(f === "groups" ? [{ kind: "GROUP" as const }] : []),
      ...(e ? [{ topic: e }] : []),
      ...(q ? [{ OR: [{ subject: { contains: q, mode: "insensitive" as const } }, { entityLabel: { contains: q, mode: "insensitive" as const } }, { messages: { some: { body: { contains: q, mode: "insensitive" as const } } } }] }] : []),
    ],
  };
  const [rowsRaw, selected] = await Promise.all([
    prisma.chatThread.findMany({
      where, orderBy: { lastMessageAt: "desc" }, take: 150,
      include: {
        reads: { where: { userId: v.id }, select: { lastReadAt: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, authorName: true, authorId: true, attachments: { select: { id: true }, take: 1 } } },
        _count: { select: { members: true } },
      },
    }),
    threadId ? loadThread(v, threadId) : Promise.resolve(null),
  ]);
  const rows = f === "await" ? rowsRaw.filter((t) => awaitsMyAnswer(t, v.side)) : rowsRaw;
  // Сколько новых сообщений в каждом непрочитанном чате.
  const unreadCount = new Map<string, number>();
  await Promise.all(rows.map(async (t) => {
    if (!isUnread(t, t.reads[0]?.lastReadAt, v.side)) return;
    const n = await prisma.chatMessage.count({
      where: { threadId: t.id, ...(t.reads[0] ? { createdAt: { gt: t.reads[0].lastReadAt } } : {}), ...(t.kind === "GROUP" ? { NOT: { authorId: v.id } } : { authorSide: { not: v.side } }) },
    });
    unreadCount.set(t.id, Math.max(1, n));
  }));

  if (threadId && !selected) notFound();
  const supplier = selected ? await supplierName(v.organizationId, selected.supplierId) : "";
  const peerLabel = v.side === "SUPPLIER" ? s.user.organizationName : supplier || "Подрядчик";
  let messages: Awaited<ReturnType<typeof loadMessages>> = [];
  let entityHref: string | null = null;
  let reactions: Awaited<ReturnType<typeof loadReactions>> = { available: false, byMessage: new Map() };
  if (selected) {
    messages = await loadMessages(selected.id);
    reactions = await loadReactions(v, messages.map((m) => m.id));
    let inboxKind: string | null = null;
    if (selected.entityType === "SupplierInbox" && selected.entityId) inboxKind = (await prisma.supplierInbox.findUnique({ where: { id: selected.entityId }, select: { kind: true } }))?.kind ?? null;
    entityHref = entityHrefFor(selected.entityType, selected.entityId, v.side, { inboxKind });
  }
  const selUnread = selected ? isUnread(selected, (await prisma.chatRead.findUnique({ where: { threadId_userId: { threadId: selected.id, userId: v.id } }, select: { lastReadAt: true } }))?.lastReadAt, v.side) : false;
  const listHref = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    const m = { f, q, e, ...over };
    for (const [k, val] of Object.entries(m)) if (val) p.set(k, val);
    const qs = p.toString();
    return `/chat${qs ? "?" + qs : ""}`;
  };
  const myTg = await prisma.channelLink.count({ where: { organizationId: v.organizationId, userId: v.id, channel: "TELEGRAM" } });
  const showForm = canCreateGroup(v.role) && (isNew || !!preset) && !selected;
  const members = selected?.kind === "GROUP" ? await groupMembers(v.organizationId, selected.id) : [];
  const topicsForMe = createTopicsFor(v.role);
  // «Вы, Анна, Веллмех»: подрядчик в группе — одним именем компании.
  const otherNames = [...new Set(members.filter((m) => m.userId !== v.id).map((m) => (m.isSupplier ? m.orgName : m.name)))];
  const who = !selected ? "" : selected.kind === "GROUP" ? participantsLabel(otherNames) : `${participantsLabel([peerLabel])} · видят все сотрудники`;
  const mentionNames = [...new Set([...otherNames, ...messages.map((m) => m.authorName)])].filter((n) => n !== v.name);
  const isGroupSel = selected?.kind === "GROUP";
  const canManage = isGroupSel && canManageGroup({ id: v.id, role: v.role }, members);
  const canEdit = !!selected && (isGroupSel ? canManage : v.side !== "SUPPLIER" || selected.createdById === v.id);
  const canClose = !!selected && (isGroupSel ? canManage : true);
  const menuTopics = !selected ? [] : isGroupSel ? topicsForMe : v.side === "SUPPLIER" ? [] : topicsForMe.filter((t) => GROUP_TOPICS[t]?.supplier);
  const options = showForm ? await recipientOptions(v) : [];
  const rightOpen = !!selected || showForm;
  const filtered = !!(q || e || f);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid h-[calc(100dvh-11rem)] min-h-[30rem] gap-3 md:h-[calc(100dvh-9.5rem)] lg:grid-cols-[22rem_minmax(0,1fr)]">
        <section aria-label="Список чатов" className={cn("flex min-h-0 min-w-0 flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3", rightOpen && "max-lg:hidden")}>
          <h1 className="text-lg font-semibold">Чаты</h1>
          {canCreateGroup(v.role) && <Link href="/chat?new=1" className="inline-flex h-10 items-center justify-center rounded-md bg-neutral-900 px-3 text-sm font-medium text-white hover:bg-neutral-800 max-md:min-h-11">+ Новый чат</Link>}
          <ListFilters q={q} f={f} e={e} topics={Object.fromEntries(topicsAll.map((t) => [t, t]))} />
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((x) => (
              <Link key={x.key} href={listHref({ f: x.key, thread: "" })} aria-current={f === x.key ? "page" : undefined}
                className={cn("inline-flex items-center rounded-full border px-3 py-1 text-xs max-md:min-h-11", f === x.key ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 hover:bg-neutral-100")}>{x.label}</Link>
            ))}
          </div>
          <ul className="-mx-3 flex min-h-0 flex-1 flex-col divide-y divide-neutral-200 overflow-y-auto border-t border-neutral-200">
            {rows.length === 0 && (
              <li className="p-4 text-sm text-neutral-600">
                {filtered ? "Нет результатов." : "Нет чатов."}
              </li>
            )}
            {rows.map((t) => {
              const n = unreadCount.get(t.id) ?? 0;
              const last = t.messages[0];
              const waits = awaitsMyAnswer(t, v.side);
              const mentioned = n > 0 && !!last && last.authorId !== v.id && mentionsUser(last.body, v.name);
              return (
                <li key={t.id}>
                  <Link href={listHref({ thread: t.id })} aria-current={selected?.id === t.id ? "true" : undefined}
                    className={cn("block px-3 py-2.5 hover:bg-neutral-50 max-md:min-h-11", selected?.id === t.id && "bg-neutral-100")}>
                    <div className="flex items-baseline gap-2">
                      <span className={cn("min-w-0 flex-1 truncate text-sm", n ? "font-semibold" : "font-medium")}>{t.subject}</span>
                      <span className={cn("shrink-0 text-[11px]", n ? "font-medium text-red-700" : "text-neutral-600")}>{listTime(t.lastMessageAt, now)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-neutral-600">
                        {last ? `${last.authorName}: ${last.body || (last.attachments.length ? "Файл" : "")}` : "Нет сообщений"}
                      </span>
                      {n > 0 && <span aria-label={`Непрочитанных: ${n}`} className="min-w-5 shrink-0 rounded-full bg-red-700 px-1.5 text-center text-[11px] font-semibold leading-5 text-white">{n}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                      {t.kind === "GROUP" && <span className="rounded bg-violet-100 px-1.5 py-px text-violet-900">{t._count.members === 2 ? "Личный" : `Группа · ${t._count.members}`}{t.topic ? ` · ${t.topic}` : ""}</span>}
                      {t.kind !== "GROUP" && t.topic && <span className="rounded bg-sky-100 px-1.5 py-px text-sky-900">{t.topic}</span>}
                      {mentioned && <span className="rounded bg-red-100 px-1.5 py-px font-medium text-red-900">вас упомянули</span>}
                      {t.entityLabel && <span className="max-w-full truncate rounded bg-neutral-100 px-1.5 py-px text-neutral-800">{t.entityLabel}</span>}
                      {waits && <span className="rounded bg-amber-100 px-1.5 py-px font-medium text-amber-900">ждёт ответа</span>}
                      {t.status === "CLOSED" && <span className="rounded bg-neutral-200 px-1.5 py-px text-neutral-700">закрыт</span>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          {/* Без токена бота подключать нечего: рядовому пользователю (и поставщику) подсказку «добавьте токен в .env» не показываем. */}
          {(!!telegramToken() || hasRole(v.role, ACCESS.channels)) && <details className="text-sm">
            <summary className="cursor-pointer py-1 text-neutral-700 max-md:min-h-11">Подключить Telegram</summary>
            <div className="mt-2 flex flex-col gap-2">
              <TelegramConnect linked={myTg > 0} hasToken={!!telegramToken()} />
              {hasRole(v.role, ACCESS.channels) && <a href="/settings/channels" className="text-sm text-blue-800 underline">Каналы: группы поставщика, привязки, WhatsApp</a>}
            </div>
          </details>}
        </section>

        <section aria-label="Переписка" data-chat-pane className={cn("min-h-0 min-w-0 overflow-y-auto", !rightOpen && "max-lg:hidden")}>
          {showForm && <NewChatForm options={options} topics={topicsForMe} entityTypes={entityTypes} viewerRole={v.role} preset={preset} backHref={listHref({ thread: "" })} />}
          {!showForm && !selected && (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600">
              Выберите чат.
            </div>
          )}
          {!showForm && selected && (
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white">
              <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-200 px-3 py-2">
                <Link href={listHref({ thread: "" })} aria-label="Назад к списку чатов" className="inline-flex h-11 items-center rounded-md px-2 text-sm text-neutral-800 hover:bg-neutral-100 lg:hidden">← Назад</Link>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-semibold">{selected.subject}</h2>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-700">
                    <span>{who}</span>
                    {selected.topic && <span className="rounded bg-sky-100 px-1.5 py-px text-sky-900">{selected.topic}</span>}
                    {selected.kind === "REQUEST" && <span className={cn("rounded px-1.5 py-px", STATUS_TONE[selected.status])}>{statusLabelFor(selected.status, selected.createdBySide, v.side)}</span>}
                    {selected.kind !== "REQUEST" && selected.status === "CLOSED" && <span className={cn("rounded px-1.5 py-px", STATUS_TONE.CLOSED)}>Закрыт</span>}
                    {selected.entityLabel && (entityHref
                      ? <Link href={entityHref} className="rounded bg-neutral-100 px-1.5 py-px text-neutral-900 underline">{selected.entityLabel} →</Link>
                      : <span className="rounded bg-neutral-100 px-1.5 py-px">{selected.entityLabel}</span>)}
                  </div>
                </div>
                <ChatMenu
                  threadId={selected.id} kind={selected.kind} subject={selected.subject} topic={selected.topic ?? ""} topicChoices={menuTopics}
                  closed={selected.status === "CLOSED"} canEdit={canEdit} canManage={canManage} canClose={canClose}
                  members={members} me={v.id} telegramOn={!!telegramToken()}
                />
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto bg-neutral-50 p-3">
                {messages.length === 0 && <p className="m-auto text-sm text-neutral-600">Нет сообщений.</p>}
                {messages.map((m, i) => {
                  const mine = m.authorId ? m.authorId === v.id : m.authorSide === v.side;
                  const newDay = i === 0 || dayKey(messages[i - 1].createdAt) !== dayKey(m.createdAt);
                  const groups = reactions.byMessage.get(m.id) ?? [];
                  return (
                    <div key={m.id} className="flex flex-col">
                      {newDay && <div className="my-2 self-center rounded-full bg-neutral-200 px-3 py-0.5 text-[11px] text-neutral-800">{dayLabel(m.createdAt, now)}</div>}
                      <div className={cn("flex max-w-[88%] flex-col gap-1 md:max-w-[75%]", mine ? "items-end self-end" : "items-start self-start")}>
                        <div className={cn("min-w-0 max-w-full break-words rounded-2xl px-3 py-2 text-sm", mine ? "bg-neutral-900 text-white" : "border border-neutral-200 bg-white")}>
                          {!mine && <div className="mb-0.5 text-xs font-semibold text-neutral-700">{m.authorName}{m.authorSide !== v.side && selected.kind !== "GROUP" ? ` · ${m.authorSide === "SUPPLIER" ? supplier || "Поставщик" : s.user.organizationName}` : ""}</div>}
                          {m.body && <div className="whitespace-pre-wrap">{splitMentions(m.body).map((p, k) => p.mention
                            ? <span key={k} className={cn("rounded px-1 font-medium", mentionsUser(p.text, v.name) ? "bg-amber-200 text-amber-950" : mine ? "bg-neutral-700 text-white" : "bg-sky-100 text-sky-900")}>{p.text}</span>
                            : <span key={k}>{p.text}</span>)}</div>}
                          {m.attachments.length > 0 && (
                            <div className={cn("flex flex-col gap-1.5", m.body && "mt-2")}>
                              {m.attachments.map((a) => (
                                /^image\//.test(a.mimeType)
                                  ? <a key={a.id} href={`/api/chat/files/${a.id}`} target="_blank" rel="noreferrer" aria-label={`Открыть изображение ${a.originalName}`}><img src={`/api/chat/files/${a.id}`} alt={a.originalName} className="max-h-56 max-w-full rounded-md" /></a>
                                  : (
                                    <a key={a.id} href={`/api/chat/files/${a.id}`} download={a.originalName}
                                      className={cn("flex min-h-11 items-center gap-2 rounded-lg border px-2.5 py-1.5", mine ? "border-neutral-600 bg-neutral-800 hover:bg-neutral-700" : "border-neutral-200 bg-neutral-50 hover:bg-neutral-100")}>
                                      <span aria-hidden className="text-lg">📄</span>
                                      <span className="min-w-0"><span className="block truncate text-sm font-medium">{a.originalName}</span><span className={cn("block text-[11px]", mine ? "text-neutral-300" : "text-neutral-600")}>{fileSize(a.sizeBytes)} · скачать</span></span>
                                    </a>
                                  )
                              ))}
                            </div>
                          )}
                        </div>
                        {reactions.available && <Reactions messageId={m.id} groups={groups} options={REACTIONS} alignRight={mine} />}
                        <div className="px-1 text-[11px] text-neutral-600">
                          {timeFmt.format(m.createdAt)}
                          {m.source === "TELEGRAM" && " · из Telegram"}
                          {m.source === "WHATSAPP" && " · из WhatsApp"}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <ScrollBottom dep={messages.at(-1)?.id ?? ""} />
              </div>
              {selected.status === "CLOSED" && <div className="border-t border-neutral-200 px-3 py-2 text-sm text-neutral-700">Чат закрыт. Новое сообщение откроет его заново.</div>}
              <Composer threadId={selected.id} people={mentionNames} />
              <ChatAutoRefresh threadId={selected.id} unread={selUnread} lastAt={selected.lastMessageAt.toISOString()} />
            </div>
          )}
        </section>
      </div>
      {!selected && <ChatAutoRefresh />}
    </div>
  );
}

function loadMessages(threadId: string) {
  return prisma.chatMessage.findMany({
    where: { threadId }, orderBy: { createdAt: "asc" }, take: 500,
    include: { attachments: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true }, orderBy: { createdAt: "asc" } } },
  });
}
