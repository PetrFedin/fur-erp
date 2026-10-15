// Чистая логика чата (без базы и сервера): видимость, статусы запроса, безопасные подписи записей,
// маршрутизация входящих из мессенджеров, получатели рассылки. Проверяется в scripts/test-chat.ts.

export type Side = "INTERNAL" | "SUPPLIER" | "EXTERNAL";
export type ThreadStatus = "OPEN" | "ANSWERED" | "CLOSED";
export type ThreadKind = "GENERAL" | "REQUEST" | "GROUP";

/** Внутренние роли, которым открыт чат (ключ chat в access.ts). */
export const CHAT_INTERNAL_ROLES = ["OWNER", "ADMIN", "TECHNOLOGIST", "PURCHASER", "ACCOUNTANT"] as const;

export const REQUEST_TYPES = ["Документ", "Подтверждение статуса", "Уточнение", "Срок", "Оплата", "Другое"] as const;

export const ENTITY_TYPES: Record<string, string> = {
  ProductionOrder: "ТЗ",
  ProductModel: "Артикул",
  Purchase: "Закупка / аукцион",
  Payment: "Оплата",
  Shipment: "Отгрузка",
  CalendarEvent: "Запись календаря",
  SupplierInbox: "Расчёт / ТЗ поставщика",
  RawMaterialLot: "Лот сырья",
};

export const sideOfRole = (role: string | null | undefined): Side => (role === "SUPPLIER" ? "SUPPLIER" : "INTERNAL");

type Viewer = { role: string; organizationId: string; supplierId?: string | null };
type ThreadScope = { organizationId: string; supplierId: string | null };

/** Видит ли пользователь обсуждение: своя организация; поставщик — только свои (supplierId совпал), внутренние — все. */
export function canSeeThread(u: Viewer, t: ThreadScope): boolean {
  if (u.organizationId !== t.organizationId) return false;
  if (u.role === "SUPPLIER") return !!u.supplierId && t.supplierId === u.supplierId;
  return (CHAT_INTERNAL_ROLES as readonly string[]).includes(u.role);
}

/** Статус запроса после нового сообщения: ответила другая сторона → «Ответ получен»; автор снова пишет → «Открыт»; в закрытый — открывается заново. */
export function nextStatus(t: { kind: ThreadKind; status: ThreadStatus; createdBySide: Side }, authorSide: Side): ThreadStatus {
  if (t.status === "CLOSED") return "OPEN";
  if (t.kind !== "REQUEST") return t.status;
  if (authorSide !== t.createdBySide && t.status === "OPEN") return "ANSWERED";
  if (authorSide === t.createdBySide && t.status === "ANSWERED") return "OPEN";
  return t.status;
}

/** Непрочитано: последнее сообщение от другой стороны и новее отметки прочтения. */
export function isUnread(t: { lastMessageAt: Date; lastMessageSide: Side; kind?: ThreadKind }, lastReadAt: Date | null | undefined, mySide: Side): boolean {
  // В группах участников обеих сторон несколько: свои сообщения читаются сразу (отметка прочтения при отправке), чужие — по времени.
  if (t.kind !== "GROUP" && t.lastMessageSide === mySide) return false;
  return !lastReadAt || t.lastMessageAt.getTime() > lastReadAt.getTime();
}

/** Ждёт ответа этой стороны: открытый запрос, в котором последнее слово за другой стороной. */
export function awaitsMyAnswer(t: { kind: ThreadKind; status: ThreadStatus; lastMessageSide: Side }, mySide: Side): boolean {
  return t.kind === "REQUEST" && t.status !== "CLOSED" && t.lastMessageSide !== mySide;
}

/** Убирает из подписи деньги: суммы с валютой, ₽/$/€, «руб». Подпись видят обе стороны, цен в ней быть не должно. */
export function stripMoney(s: string): string {
  return s
    .replace(/\d[\d\s.,]*\s*(?:₽|\$|€|руб(?:\.|лей|ля)?|RUB|USD|EUR|р\.)/gi, "")
    .replace(/[₽$€]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s·,-]+$/g, "")
    .trim();
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const ddmmyyyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;

export type LabelInput = {
  number?: string | null;
  auctionSession?: string | null;
  name?: string | null;
  title?: string | null;
  date?: Date | null;
  articleCode?: string | null;
  purchaseNumber?: string | null;
  lotNumber?: string | null;
};

/** Безопасная подпись записи: «ТЗ 160», «Аукцион СП 09-26», «Отгрузка …» — без денег и внутренних названий. */
export function safeEntityLabel(type: string, d: LabelInput): string {
  let raw: string;
  switch (type) {
    case "ProductionOrder": raw = `ТЗ ${d.number ?? ""}`; break;
    case "ProductModel": raw = `Артикул ${d.name ?? ""}`; break;
    case "Purchase": raw = d.auctionSession ? `Аукцион ${d.auctionSession}` : `Закупка ${d.number ?? ""}`; break;
    case "Payment": raw = `Оплата${d.date ? " " + ddmmyyyy(d.date) : ""}${d.purchaseNumber ? " · " + d.purchaseNumber : ""}`; break;
    case "Shipment": raw = `Отгрузка ${d.name ?? (d.date ? ddmmyyyy(d.date) : "")}`; break;
    case "CalendarEvent": raw = `Календарь · ${d.articleCode ?? ""}${d.date ? " · " + ddmmyyyy(d.date) : ""}`; break;
    case "SupplierInbox": raw = d.title ?? "Расчёт"; break;
    case "RawMaterialLot": raw = `Лот ${d.lotNumber ?? ""}`; break;
    default: raw = d.title ?? d.name ?? "Запись";
  }
  return clip(stripMoney(raw.trim()), 120) || "Запись";
}

/** Куда ведёт запись для стороны; null — этой стороне страница закрыта (ссылку не показываем). */
export function entityHrefFor(type: string | null, id: string | null, side: Side, extra?: { inboxKind?: string | null }): string | null {
  if (!type || !id) return null;
  if (side === "SUPPLIER") {
    switch (type) {
      case "Purchase": return `/supplier/raw/${id}`;
      case "Shipment": return `/shipments/${id}`;
      case "SupplierInbox": return extra?.inboxKind === "AUCTION_CALC" ? `/supplier/auction-calcs/${id}` : `/supplier/tz/${id}`;
      case "CalendarEvent": return "/supplier/calendar";
      case "ProductModel": return "/articles";
      default: return null;
    }
  }
  switch (type) {
    case "Purchase": return `/purchases/${id}`;
    case "ProductionOrder": return `/production/${id}`;
    case "ProductModel": return `/models/${id}`;
    case "Payment": return `/payments/${id}`;
    case "Shipment": return `/shipments/${id}`;
    case "CalendarEvent": return "/calendar";
    case "SupplierInbox": return `/inbox/${id}`;
    case "RawMaterialLot": return `/analytics/raw/lot/${id}`;
    default: return null;
  }
}

/** Типы записей, по которым запрос может создать сам поставщик (только его собственные записи). */
export const SUPPLIER_ENTITY_TYPES = ["Purchase", "Shipment", "SupplierInbox", "CalendarEvent", "ProductModel"] as const;

// ───────── Telegram: команды и маршрутизация входящих ─────────

export type ParsedCommand =
  | { cmd: "start"; arg: string }
  | { cmd: "bind"; arg: string }
  | { cmd: "t"; threadNo: string; text: string }
  | { cmd: "new"; text: string }
  | { cmd: "help" }
  | null;

/** Разбор «/start КОД», «/bind КОД», «/t 12 текст», «/new тема», «/help» (с возможным @имя_бота). */
export function parseCommand(text: string): ParsedCommand {
  const m = /^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  const rest = (m[2] ?? "").trim();
  if (cmd === "start") return { cmd: "start", arg: rest };
  if (cmd === "bind") return { cmd: "bind", arg: rest };
  if (cmd === "help") return { cmd: "help" };
  if (cmd === "new") return { cmd: "new", text: rest };
  if (cmd === "t") {
    const mm = /^(\S+)\s*([\s\S]*)$/.exec(rest);
    return mm ? { cmd: "t", threadNo: mm[1], text: mm[2].trim() } : { cmd: "t", threadNo: "", text: "" };
  }
  return null;
}

export type IncomingRoute =
  | { type: "unbound" }
  | { type: "post"; threadId: string; text: string; how: "reply" | "cmd" | "last" }
  | { type: "new"; subject: string; text: string }
  | { type: "empty" }
  | { type: "notfound"; threadNo: string };

/** Куда пойдёт входящее сообщение мессенджера: reply на сообщение бота → тот же тред; /t N; /new; иначе последний активный тред. */
export function routeIncoming(i: {
  text: string;
  linked: boolean;
  replyThreadId?: string | null;
  lastActiveThreadId?: string | null;
  /** Находит тред по номеру из «/t N» (номер, суффикс id или сам id). */
  resolveThreadNo: (no: string) => string | null;
}): IncomingRoute {
  if (!i.linked) return { type: "unbound" };
  const cmd = parseCommand(i.text);
  if (cmd?.cmd === "t") {
    const id = cmd.threadNo ? i.resolveThreadNo(cmd.threadNo) : null;
    if (!id) return { type: "notfound", threadNo: cmd.threadNo };
    return cmd.text ? { type: "post", threadId: id, text: cmd.text, how: "cmd" } : { type: "empty" };
  }
  if (cmd?.cmd === "new") return cmd.text ? { type: "new", subject: cmd.text.slice(0, 120), text: cmd.text } : { type: "empty" };
  if (i.replyThreadId) return { type: "post", threadId: i.replyThreadId, text: i.text, how: "reply" };
  if (i.lastActiveThreadId) return { type: "post", threadId: i.lastActiveThreadId, text: i.text, how: "last" };
  return { type: "new", subject: i.text.slice(0, 120) || "Сообщение из Telegram", text: i.text };
}

export type LinkLite = { id: string; channel: string; externalChatId: string; userId: string | null; supplierId: string | null; kind: "PRIVATE" | "GROUP" };

/**
 * Кому разослать сообщение. Пишет внутренний — группа поставщика и личные чаты пользователей-поставщиков этого поставщика;
 * пишет поставщик — личные чаты внутренних пользователей и внутренняя группа (GROUP без поставщика и человека).
 * Петля: не отправляем в тот чат, откуда сообщение пришло, и самому автору в его личный чат.
 */
export function pickRecipients(m: {
  threadSupplierId: string | null;
  authorSide: Side;
  authorId: string | null;
  originChatId: string | null;
  links: LinkLite[];
  /** Роль каждого привязанного пользователя (userId → роль). */
  roleOf: (userId: string) => string | null;
  /** Поставщик пользователя (для личных чатов поставщика). */
  supplierOfUser: (userId: string) => string | null;
}): LinkLite[] {
  return m.links.filter((l) => {
    if (m.originChatId && l.externalChatId === m.originChatId) return false;
    if (l.userId && m.authorId && l.userId === m.authorId) return false;
    if (m.authorSide === "SUPPLIER") {
      if (l.kind === "GROUP") return !l.supplierId && !l.userId;
      const role = l.userId ? m.roleOf(l.userId) : null;
      return !!role && (CHAT_INTERNAL_ROLES as readonly string[]).includes(role);
    }
    // пишет внутренний (или внешний)
    if (!m.threadSupplierId) return false;
    if (l.kind === "GROUP") return l.supplierId === m.threadSupplierId;
    return !!l.userId && m.roleOf(l.userId) === "SUPPLIER" && m.supplierOfUser(l.userId) === m.threadSupplierId;
  });
}

/** Текст сообщения для мессенджера: «💬 Веллмех · ТЗ 160 · Тема\nИмя: текст» + ссылка на платформу. */
export function formatForMessenger(i: { supplierName: string; entityLabel: string | null; subject: string; authorName: string; body: string; threadId: string; appUrl: string; threadNo?: number | string }): string {
  const head = ["💬", [i.supplierName, i.entityLabel, i.subject].filter(Boolean).join(" · ") + (i.threadNo ? ` (#${i.threadNo})` : "")].join(" ");
  const url = `${i.appUrl.replace(/\/$/, "")}/chat?thread=${i.threadId}`;
  return `${head}\n${i.authorName}: ${i.body}\n\nОткрыть в платформе: ${url}`;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Одноразовый код привязки: 8 знаков без похожих (0/O, 1/I). */
export function makeBindCode(rand: (n: number) => Uint8Array): string {
  const bytes = rand(8);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** Срок кода и проверка: не просрочен и не использован. */
export const BIND_CODE_TTL_MS = 15 * 60 * 1000;
export function bindCodeValid(c: { expiresAt: Date; usedAt: Date | null }, now = new Date()): boolean {
  return !c.usedAt && c.expiresAt.getTime() > now.getTime();
}

/** Идентификатор внешнего сообщения для идемпотентности: «чат:сообщение». */
export const externalMsgId = (chatId: string | number, messageId: string | number) => `${chatId}:${messageId}`;

// ───────── Группы по темам ─────────

/** Темы групп: кто из ролей имеет доступ к теме и может ли быть участником поставщик (SUPPLIER). Оплаты и «Общее» — только свои. */
export const GROUP_TOPICS: Record<string, { roles: readonly string[]; supplier: boolean }> = {
  "Оплаты": { roles: ["OWNER", "ADMIN", "ACCOUNTANT"], supplier: false },
  "Отгрузки": { roles: ["OWNER", "ADMIN", "TECHNOLOGIST"], supplier: true },
  "Аукционы": { roles: ["OWNER", "ADMIN", "PURCHASER"], supplier: true },
  "Сырьё": { roles: ["OWNER", "ADMIN", "PURCHASER"], supplier: true },
  "ТЗ": { roles: ["OWNER", "ADMIN", "TECHNOLOGIST"], supplier: true },
  "Изделия": { roles: ["OWNER", "ADMIN", "TECHNOLOGIST"], supplier: true },
  "Календарь": { roles: ["OWNER", "ADMIN", "TECHNOLOGIST"], supplier: true },
  "Общее": { roles: ["OWNER", "ADMIN", "TECHNOLOGIST", "PURCHASER", "ACCOUNTANT"], supplier: false },
};

/** Может ли пользователь с этой ролью быть участником группы этой темы. */
export function eligibleForTopic(topic: string, role: string): boolean {
  const t = GROUP_TOPICS[topic];
  if (!t) return false;
  return role === "SUPPLIER" ? t.supplier : t.roles.includes(role);
}

/** Тема по умолчанию для группы, созданной из карточки записи. */
export const TOPIC_OF_ENTITY: Record<string, string> = {
  ProductionOrder: "ТЗ", ProductModel: "Изделия", Purchase: "Аукционы", Payment: "Оплаты", Shipment: "Отгрузки",
  CalendarEvent: "Календарь", SupplierInbox: "Аукционы", RawMaterialLot: "Сырьё",
};

type Member = { userId: string; role: "OWNER" | "MEMBER" };
/** Менять состав группы может её владелец и OWNER/ADMIN из числа участников; выйти может любой участник. */
export function canManageGroup(u: { id: string; role: string }, members: Member[]): boolean {
  const me = members.find((m) => m.userId === u.id);
  if (!me) return false;
  return me.role === "OWNER" || u.role === "OWNER" || u.role === "ADMIN";
}
/** Создать группу могут внутренние роли чата; поставщик — нет. */
export const canCreateGroup = (role: string) => (CHAT_INTERNAL_ROLES as readonly string[]).includes(role);

// ───────── Реакции ─────────

/** Набор реакций рабочего чата: нравится, сделано/согласовано, вопрос, спасибо, срочно/отлично, посмотрю. */
export const REACTIONS = ["👍", "✅", "❓", "❤️", "🔥", "👀"] as const;
export const isReaction = (e: string): boolean => (REACTIONS as readonly string[]).includes(e);

export type ReactionGroup = { emoji: string; count: number; mine: boolean; names: string[] };

/** Сворачивает строки реакций в группы по эмодзи (в порядке набора): счётчик, «моя» и список имён. */
export function groupReactions(rows: { emoji: string; userId: string }[], meId: string, nameOf: (userId: string) => string): ReactionGroup[] {
  const out: ReactionGroup[] = [];
  for (const emoji of REACTIONS) {
    const r = rows.filter((x) => x.emoji === emoji);
    if (r.length) out.push({ emoji, count: r.length, mine: r.some((x) => x.userId === meId), names: r.map((x) => nameOf(x.userId)) });
  }
  return out;
}
