/**
 * «Оставить комментарий»: чистая логика без доступа к БД и без server-only — её используют серверные действия,
 * страница /comments, выгрузка задач, клиентская панель и скрипт-проверка (scripts/test-comments.ts).
 */
import type { Prisma } from "@prisma/client";
import { defineFilters, parseFilters, type FilterOption } from "@/lib/filters";
import { toCsv } from "@/lib/csv";

export const COMMENT_STATUSES = ["OPEN", "DONE", "WONTFIX"] as const;
export const COMMENT_KINDS = ["REMARK", "BUG", "IDEA", "QUESTION"] as const;
export const COMMENT_PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export type CStatus = (typeof COMMENT_STATUSES)[number];
export type CKind = (typeof COMMENT_KINDS)[number];
export type CPriority = (typeof COMMENT_PRIORITIES)[number];

export const STATUS_LABEL: Record<CStatus, string> = { OPEN: "Открыто", DONE: "Учтено", WONTFIX: "Не будем делать" };
export const KIND_LABEL: Record<CKind, string> = { REMARK: "Замечание", BUG: "Ошибка", IDEA: "Идея", QUESTION: "Вопрос" };
export const PRIORITY_LABEL: Record<CPriority, string> = { LOW: "Низкий", NORMAL: "Обычный", HIGH: "Высокий" };

export const MAX_TEXT = 4000;
export const MAX_REPLY = 2000;
export const MAX_NOTE = 1000;
export const EDIT_WINDOW_MS = 15 * 60_000;
export const RATE_MAX = 30;
export const RATE_WINDOW_MS = 60_000;
export const PAGE_SIZE = 50;

/** Какие записи можно комментировать «к записи»: тип → название (для подписи); подпись самой записи считает сервер. */
export const ENTITY_TITLES: Record<string, string> = {
  Purchase: "Закупка",
  ProductionOrder: "ТЗ",
  ProductionBatch: "Партия",
  ProductModel: "Модель",
  RawMaterialLot: "Лот сырья",
  Supplier: "Поставщик",
  Client: "Заказчик",
  Fitting: "Примерка",
  Shipment: "Отгрузка",
};

/** Запись, которой посвящена открытая страница (по маршруту). key — то, что стоит в адресе (для партии — её номер). */
export function entityFromPath(pathname: string): { type: string; key: string } | null {
  const seg = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
  const bad = (k: string | undefined) => !k || k === "new" || k === "batches" || k === "edit";
  const one = (root: string, type: string) => (seg.length === 2 && seg[0] === root && !bad(seg[1]) ? { type, key: decodeURIComponent(seg[1]) } : null);
  if (seg[0] === "production" && seg[1] === "batches" && seg.length === 3 && !bad(seg[2])) return { type: "ProductionBatch", key: decodeURIComponent(seg[2]) };
  if (seg[0] === "analytics" && seg[1] === "raw" && seg[2] === "lot" && seg.length === 4) return { type: "RawMaterialLot", key: decodeURIComponent(seg[3]) };
  return (
    one("purchases", "Purchase") ??
    one("production", "ProductionOrder") ??
    one("models", "ProductModel") ??
    one("suppliers", "Supplier") ??
    one("clients", "Client") ??
    one("fittings", "Fitting") ??
    one("shipments", "Shipment")
  );
}

/** Адрес без параметров и якоря. */
export const basePath = (url: string) => url.split("#")[0].split("?")[0];

/** Адрес страницы для хранения: только свой путь (начинается с одной «/»), без якоря, не длиннее 500 знаков. */
export function normalizePagePath(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const u = url.split("#")[0].trim();
  if (!u.startsWith("/") || u.startsWith("//") || u.includes("\\") || /[\u0000-\u001f]/.test(u)) return null;
  return u.slice(0, 500);
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "");
export const cleanText = clean;

export function parseEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

// ───────────── права ─────────────

/** Менять статус и удалять чужие комментарии: ключ ACCESS.comments (src/lib/access.ts). Создавать и отвечать может любой вошедший. */
export type Actor = { id: string; role: string };
type Own = { authorId: string; createdAt: Date; status: string };

export const canEditOwn = (c: Own, u: Actor, now = Date.now()) => c.authorId === u.id && now - c.createdAt.getTime() <= EDIT_WINDOW_MS;
export const canDeleteOwn = (c: Own, u: Actor) => c.authorId === u.id && c.status === "OPEN";

// ───────────── лимит частоты ─────────────

/** Не больше RATE_MAX записей в минуту на ключ (пользователя). true — можно (и запись учтена). */
export function rateAllow(store: Map<string, number[]>, key: string, now = Date.now(), max = RATE_MAX, windowMs = RATE_WINDOW_MS): boolean {
  const list = (store.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    store.set(key, list);
    return false;
  }
  list.push(now);
  store.set(key, list);
  if (store.size > 5000) for (const [k, v] of store) if (v.every((t) => now - t >= windowMs)) store.delete(k);
  return true;
}

// ───────────── контекст ─────────────

export type CommentContext = {
  url?: string;
  params?: Record<string, string[]>;
  year?: string;
  vat?: string;
  commission4?: string;
  role?: string;
  capturedAt?: string;
  viewport?: string;
  target?: "page" | "entity" | "block" | "selection";
  quote?: string;
  anchorLabel?: string;
  selectedRows?: string[];
};

export const asContext = (v: unknown): CommentContext => (v && typeof v === "object" && !Array.isArray(v) ? (v as CommentContext) : {});

/** Режимы показа человеческим языком. */
const VAT_TEXT: Record<string, string> = { incl: "с НДС", excl: "без НДС" };
const C4_TEXT: Record<string, string> = { on: "с 4%", off: "без 4%" };

export function contextText(c: CommentContext): string {
  const parts: string[] = [];
  if (c.year) parts.push(`год: ${c.year === "all" ? "все" : c.year}`);
  if (c.vat) parts.push(`НДС: ${VAT_TEXT[c.vat] ?? c.vat}`);
  if (c.commission4) parts.push(`4%: ${C4_TEXT[c.commission4] ?? c.commission4}`);
  if (c.params) {
    const f = Object.entries(c.params).map(([k, v]) => `${k}=${v.join(",")}`);
    if (f.length) parts.push(`фильтры: ${f.join("; ")}`);
  }
  if (c.selectedRows?.length) parts.push(`выбрано: ${c.selectedRows.join(" | ")}`);
  if (c.viewport) parts.push(`окно ${c.viewport}`);
  return parts.join("; ");
}

/** Приводит присланный клиентом контекст к безопасному виду (длины, типы); год, НДС и 4% потом подставляет сервер из cookie. */
export function sanitizeContext(raw: unknown): CommentContext {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: CommentContext = {};
  const url = normalizePagePath(r.url);
  if (url) out.url = url;
  if (r.params && typeof r.params === "object" && !Array.isArray(r.params)) {
    const params: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(r.params as Record<string, unknown>).slice(0, 30)) {
      const vals = (Array.isArray(v) ? v : [v]).map((x) => clean(x, 120)).filter(Boolean).slice(0, 20);
      if (vals.length) params[clean(k, 40)] = vals;
    }
    if (Object.keys(params).length) out.params = params;
  }
  const vp = clean(r.viewport, 20);
  if (/^\d{2,5}x\d{2,5}$/.test(vp)) out.viewport = vp;
  const quote = clean(r.quote, 600);
  if (quote) out.quote = quote;
  const al = clean(r.anchorLabel, 120);
  if (al) out.anchorLabel = al;
  if (Array.isArray(r.selectedRows)) {
    const rows = r.selectedRows.map((x) => clean(x, 80)).filter(Boolean).slice(0, 10);
    if (rows.length) out.selectedRows = rows;
  }
  if (r.target === "page" || r.target === "entity" || r.target === "block" || r.target === "selection") out.target = r.target;
  return out;
}

/** Идентификатор блока: латиница, цифры, «:._-», кириллица — без пробелов и кавычек. */
export function cleanAnchor(v: unknown): string | null {
  const a = clean(v, 80).replace(/[^\p{L}\p{N}:._\-]/gu, "");
  return a || null;
}

// ───────────── ссылки ─────────────

export type LinkableComment = { id: string; pagePath: string; anchor: string | null };
/** Ссылка «Открыть место»: страница с теми же фильтрами; #cm=<блок> прокручивает к блоку и подсвечивает его. */
export function commentHref(c: LinkableComment): string {
  return `${c.pagePath}#cm=${c.anchor ? encodeURIComponent(c.anchor) : "page"}.${c.id}`;
}

// ───────────── фильтры страницы /comments ─────────────

export const commentFilterSchema = defineFilters({
  status: { kind: "multi", label: "Статус", allowed: COMMENT_STATUSES },
  kind: { kind: "multi", label: "Тип", allowed: COMMENT_KINDS },
  priority: { kind: "multi", label: "Приоритет", allowed: COMMENT_PRIORITIES },
  author: { kind: "multi", label: "Автор" },
  section: { kind: "multi", label: "Страница" },
  entity: { kind: "multi", label: "Запись", allowed: Object.keys(ENTITY_TITLES) },
  from: { kind: "date", label: "С даты" },
  to: { kind: "date", label: "По дату" },
  q: { kind: "text", label: "Поиск", aliases: ["dq"], maxLen: 100 },
  sort: { kind: "single", label: "Сортировка", role: "state", maxLen: 12, allowed: ["new", "priority", "page"] },
});
export type CommentFilters = ReturnType<typeof parseCommentFilters>;
export const parseCommentFilters = (sp: Record<string, string | string[] | undefined>) => parseFilters(commentFilterSchema, sp);

export const SORT_OPTIONS: FilterOption[] = [
  { value: "new", label: "Сначала новые" },
  { value: "priority", label: "По приоритету" },
  { value: "page", label: "По странице" },
];

/** Условие выборки: организация обязательна. Период считаем по московским суткам (как журнал). */
export function commentWhere(organizationId: string, f: CommentFilters): Prisma.CommentWhereInput {
  const and: Prisma.CommentWhereInput[] = [{ organizationId }];
  if (f.status.length) and.push({ status: { in: f.status as CStatus[] } });
  if (f.kind.length) and.push({ kind: { in: f.kind as CKind[] } });
  if (f.priority.length) and.push({ priority: { in: f.priority as CPriority[] } });
  if (f.author.length) and.push({ authorId: { in: f.author } });
  if (f.entity.length) and.push({ entityType: { in: f.entity } });
  if (f.section.length) and.push({ OR: f.section.flatMap((s) => [{ pagePath: s }, { pagePath: { startsWith: s + "?" } }]) });
  if (f.from) and.push({ createdAt: { gte: new Date(`${f.from}T00:00:00+03:00`) } });
  if (f.to) and.push({ createdAt: { lt: new Date(new Date(`${f.to}T00:00:00+03:00`).getTime() + 86_400_000) } });
  if (f.q) {
    and.push({
      OR: [
        { text: { contains: f.q, mode: "insensitive" } },
        { entityLabel: { contains: f.q, mode: "insensitive" } },
        { pageTitle: { contains: f.q, mode: "insensitive" } },
        { authorName: { contains: f.q, mode: "insensitive" } },
        { replies: { some: { text: { contains: f.q, mode: "insensitive" } } } },
      ],
    });
  }
  return { AND: and };
}

export function commentOrder(sort: string): Prisma.CommentOrderByWithRelationInput[] {
  if (sort === "priority") return [{ priority: "desc" }, { createdAt: "desc" }];
  if (sort === "page") return [{ pagePath: "asc" }, { createdAt: "desc" }];
  return [{ createdAt: "desc" }];
}

// ───────────── выгрузка «задач на доработку» ─────────────

export type ExportReply = { authorName: string; authorRole: string; createdAt: Date; text: string };
export type ExportComment = {
  id: string;
  authorName: string;
  authorRole: string;
  createdAt: Date;
  text: string;
  status: string;
  kind: string;
  priority: string;
  pagePath: string;
  pageTitle: string;
  entityType: string | null;
  entityLabel: string | null;
  anchor: string | null;
  context: unknown;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  replies: ExportReply[];
};

const msk = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtMsk = (d: Date) => msk.format(d).replace(",", "");

const kindText = (k: string) => KIND_LABEL[k as CKind] ?? k;
const prioText = (p: string) => PRIORITY_LABEL[p as CPriority] ?? p;
const statusText = (s: string) => STATUS_LABEL[s as CStatus] ?? s;
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ");

/** Для Markdown: многострочный текст — с отступом, чтобы оставался частью пункта списка. */
const indent = (s: string, pad = "  ") => s.split("\n").map((l, i) => (i === 0 ? l : pad + l)).join("\n");

/**
 * Markdown со списком задач: страница → блок → запись → текст → тип/приоритет → ссылка с контекстом.
 * Файл целиком можно отдать разработчику или агенту. Порядок: страницы по адресу, внутри — блоки, высокий приоритет выше.
 */
export function buildTasksMarkdown(rows: ExportComment[], opts: { origin: string; generatedAt?: Date; filterNote?: string }): string {
  const prioRank: Record<string, number> = { HIGH: 0, NORMAL: 1, LOW: 2 };
  const sorted = [...rows].sort(
    (a, b) =>
      basePath(a.pagePath).localeCompare(basePath(b.pagePath)) ||
      (a.anchor ?? "").localeCompare(b.anchor ?? "") ||
      (prioRank[a.priority] ?? 1) - (prioRank[b.priority] ?? 1) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const out: string[] = [];
  out.push(`# Задачи на доработку — МехУчёт`);
  out.push("");
  out.push(`Выгружено: ${fmtMsk(opts.generatedAt ?? new Date())} (МСК). Комментариев: ${rows.length}.${opts.filterNote ? ` ${opts.filterNote}` : ""}`);
  out.push(`Структура: страница → блок → запись → текст. Ссылка открывает то же место с теми же фильтрами; в скобках — тип и приоритет.`);
  let curPage = "";
  let curBlock = "\u0000";
  for (const c of sorted) {
    const ctx = asContext(c.context);
    const base = basePath(c.pagePath);
    if (base !== curPage) {
      curPage = base;
      curBlock = "\u0000";
      out.push("", `## Страница: ${oneLine(c.pageTitle) || base} (\`${base}\`)`);
    }
    const blockKey = c.anchor ?? "";
    if (blockKey !== curBlock) {
      curBlock = blockKey;
      out.push("", `### ${c.anchor ? `Блок: ${oneLine(ctx.anchorLabel ?? c.anchor)} (\`${c.anchor}\`)` : "Вся страница / запись"}`);
    }
    const mark = c.status === "OPEN" ? "[ ]" : "[x]";
    const head = `- ${mark} **${kindText(c.kind)} · ${prioText(c.priority)}**${c.status !== "OPEN" ? ` · ${statusText(c.status)}` : ""}`;
    out.push("", head + (c.entityLabel ? ` · запись: ${oneLine(c.entityLabel)}` : ""));
    out.push(`  ${indent(c.text.trim())}`);
    if (ctx.quote) out.push(`  > Выделено: «${oneLine(ctx.quote)}»`);
    const meta = [`${c.authorName} (${c.authorRole})`, fmtMsk(c.createdAt)];
    out.push(`  — ${meta.join(", ")}`);
    out.push(`  Ссылка: ${opts.origin}${commentHref(c)}`);
    const ct = contextText(ctx);
    if (ct) out.push(`  Контекст: ${ct}`);
    if (c.resolutionNote) out.push(`  Как учтено: ${oneLine(c.resolutionNote)}`);
    for (const r of c.replies) out.push(`  - Ответ ${r.authorName} (${fmtMsk(r.createdAt)}): ${oneLine(r.text)}`);
  }
  out.push("");
  return out.join("\n");
}

export function buildTasksCsv(rows: ExportComment[], origin: string): string {
  const header = ["Создан (МСК)", "Автор", "Роль", "Статус", "Тип", "Приоритет", "Страница", "Адрес страницы", "Блок", "Запись", "Текст", "Выделенное", "Контекст", "Как учтено", "Ответы", "Ссылка"];
  const data = rows.map((c) => {
    const ctx = asContext(c.context);
    return [
      fmtMsk(c.createdAt),
      c.authorName,
      c.authorRole,
      statusText(c.status),
      kindText(c.kind),
      prioText(c.priority),
      c.pageTitle,
      c.pagePath,
      c.anchor ? `${ctx.anchorLabel ?? ""} [${c.anchor}]`.trim() : "",
      c.entityLabel ?? "",
      c.text,
      ctx.quote ?? "",
      contextText(ctx),
      c.resolutionNote ?? "",
      c.replies.map((r) => `${r.authorName}: ${oneLine(r.text)}`).join(" | "),
      `${origin}${commentHref(c)}`,
    ];
  });
  return toCsv(header, data);
}
