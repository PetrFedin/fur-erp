import type { Prisma } from "@prisma/client";
import { MODEL_TITLES, fieldLabel, showValue } from "@/lib/audit-core";

const isComplex = (v: unknown) => (typeof v === "object" && v !== null) || (typeof v === "string" && /^c[a-z0-9]{20,}$/.test(v));

export const PAGE_SIZE = 50;

/** actor / model / action — мультивыбор (повтор параметра: `model=Purchase&model=Payment`); пусто — все. */
export type HistoryFilters = { from: string; to: string; actor: string[]; model: string[]; action: string[]; q: string; page: number };

const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 100) : "");
const many = (v: string | string[] | undefined): string[] =>
  Array.from(new Set((Array.isArray(v) ? v : v == null ? [] : [v]).map(str).filter(Boolean))).slice(0, 60);

export function parseHistoryFilters(sp: Record<string, string | string[] | undefined>): HistoryFilters {
  const date = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : "");
  const page = Math.max(1, Math.floor(Number(str(sp.page))) || 1);
  return {
    from: date(sp.from),
    to: date(sp.to),
    actor: many(sp.actor),
    model: many(sp.model).filter((m) => Object.keys(MODEL_TITLES).includes(m)),
    action: many(sp.action).filter((a) => ["create", "update", "delete"].includes(a)),
    q: str(sp.q || sp.dq),
    page,
  };
}

/** Условие выборки журнала: организация обязательна, период считаем по московским суткам. */
export function historyWhere(organizationId: string, f: HistoryFilters): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [{ organizationId }];
  if (f.from) and.push({ at: { gte: new Date(`${f.from}T00:00:00+03:00`) } });
  if (f.to) and.push({ at: { lt: new Date(new Date(`${f.to}T00:00:00+03:00`).getTime() + 86_400_000) } });
  if (f.actor.length) {
    and.push({ OR: f.actor.map((a) => (a.startsWith("src:") ? { actorId: null, source: a.slice(4) } : { actorId: a })) });
  }
  if (f.model.length) and.push({ model: { in: f.model } });
  if (f.action.length) and.push({ action: { in: f.action } });
  if (f.q) {
    and.push({
      OR: [
        { label: { contains: f.q, mode: "insensitive" } },
        { recordId: f.q },
        { actorName: { contains: f.q, mode: "insensitive" } },
        { model: { contains: f.q, mode: "insensitive" } },
      ],
    });
  }
  return { AND: and };
}

/** Куда вести ссылку «открыть запись» (если у записи есть карточка). */
export function recordHref(model: string, recordId: string, label: string | null): string | null {
  if (recordId.startsWith("batch:")) return null;
  switch (model) {
    case "Purchase": return `/purchases/${recordId}`;
    case "ProductionOrder": return `/production/${recordId}`;
    case "ProductModel": return `/models/${recordId}`;
    case "Supplier": return `/suppliers/${recordId}`;
    case "Client": return `/clients/${recordId}`;
    case "Fitting": return `/fittings/${recordId}`;
    case "Payment":
    case "ProductionPayment": return "/payments";
    case "ProductionBatch": {
      const n = label?.match(/№(\d+)/)?.[1];
      return n ? `/production/batches/${n}` : null;
    }
    case "Comment":
    case "CommentReply": return "/comments";
    case "ColorRef": return "/settings/colors";
    case "FurAttrRef": return "/settings/fur-attrs";
    case "FurRef": return "/settings/furs";
    default: return null;
  }
}

export type LogRow = {
  id: string;
  at: Date;
  actorName: string | null;
  actorRole: string | null;
  source: string;
  model: string;
  recordId: string;
  action: string;
  changes: unknown;
  label: string | null;
  batchId: string | null;
};

export const ACTION_LABEL: Record<string, string> = { create: "создано", update: "изменено", delete: "удалено" };

const msk = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtAt = (d: Date) => msk.format(d).replace(",", "");

export function actorText(r: Pick<LogRow, "actorName" | "actorRole" | "source">): string {
  const role = r.actorRole ? ` (${r.actorRole})` : "";
  if (r.source === "ui") return `${r.actorName ?? "—"}${role}`;
  if (r.actorName) return `${r.actorName}${role} · ${r.source}`;
  return r.source;
}

type Ch = Record<string, unknown>;
const isPair = (v: unknown): v is [unknown, unknown] => Array.isArray(v) && v.length === 2;

/** Строка «поле: было → стало»; для составных значений (JSON) и нераспознанных полей — «изменено: <поле>», полный вид — в «Подробнее». */
function pairLine(k: string, v: [unknown, unknown], full: boolean): string {
  const label = fieldLabel(k);
  if (full) return `${label}: ${isComplex(v[0]) ? JSON.stringify(v[0]) : showValue(v[0])} → ${isComplex(v[1]) ? JSON.stringify(v[1]) : showValue(v[1])}`;
  if (isComplex(v[0]) || isComplex(v[1]) || label === k) return `изменено: ${label}`;
  return `${label}: ${showValue(v[0])} → ${showValue(v[1])}`;
}

/** Есть ли в записи изменения, свёрнутые в «изменено: <поле>» (для них нужен блок «Подробнее»). */
export function hasCollapsed(r: Pick<LogRow, "action" | "changes">): boolean {
  return summaryLines(r).some((l) => l.startsWith("изменено: "));
}

/** Краткое изменение: строки «поле: было → стало» (для update), либо описание для create/delete. */
export function summaryLines(r: Pick<LogRow, "action" | "changes">): string[] {
  const c = (r.changes ?? {}) as Ch;
  if (r.action === "update") {
    const out: string[] = [];
    if (isPair(c.verifiedAt)) out.push(c.verifiedAt[1] ? "подтверждено" : "подтверждение снято");
    if (isPair(c.confirmedAt) && !c.verifiedAt) out.push(c.confirmedAt[1] ? "оплата подтверждена" : "подтверждение оплаты снято");
    for (const [k, v] of Object.entries(c)) {
      if (k === "verifiedAt" || k === "verifiedBy" || k === "confirmedAt" || k === "confirmedBy") continue;
      if (isPair(v)) out.push(pairLine(k, v, false));
    }
    return out;
  }
  if (typeof c.count === "number" && Array.isArray(c.ids)) return [`${c.count} шт.`];
  return [];
}

/** Подробности: все пары «поле: было → стало» либо все поля снимка. */
export function detailLines(r: Pick<LogRow, "action" | "changes">): string[] {
  const c = (r.changes ?? {}) as Ch;
  if (r.action === "update" && !("ids" in c)) {
    return Object.entries(c).filter(([, v]) => isPair(v)).map(([k, v]) => pairLine(k, v as [unknown, unknown], true));
  }
  return [];
}

export function snapshotText(changes: unknown): string {
  return JSON.stringify(changes, null, 2);
}
