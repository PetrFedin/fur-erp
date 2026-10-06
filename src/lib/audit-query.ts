import type { Prisma } from "@prisma/client";
import { MODEL_TITLES, fieldLabel, showValue } from "@/lib/audit-core";

export const PAGE_SIZE = 50;

export type HistoryFilters = { from: string; to: string; actor: string; model: string; action: string; q: string; page: number };

const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 100) : "");

export function parseHistoryFilters(sp: Record<string, string | string[] | undefined>): HistoryFilters {
  const date = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : "");
  const page = Math.max(1, Math.floor(Number(str(sp.page))) || 1);
  return {
    from: date(sp.from),
    to: date(sp.to),
    actor: str(sp.actor),
    model: Object.keys(MODEL_TITLES).includes(str(sp.model)) ? str(sp.model) : "",
    action: ["create", "update", "delete"].includes(str(sp.action)) ? str(sp.action) : "",
    q: str(sp.q),
    page,
  };
}

/** Условие выборки журнала: организация обязательна, период считаем по московским суткам. */
export function historyWhere(organizationId: string, f: HistoryFilters): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [{ organizationId }];
  if (f.from) and.push({ at: { gte: new Date(`${f.from}T00:00:00+03:00`) } });
  if (f.to) and.push({ at: { lt: new Date(new Date(`${f.to}T00:00:00+03:00`).getTime() + 86_400_000) } });
  if (f.actor) and.push(f.actor.startsWith("src:") ? { actorId: null, source: f.actor.slice(4) } : { actorId: f.actor });
  if (f.model) and.push({ model: f.model });
  if (f.action) and.push({ action: f.action });
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
    case "ColorRef": return "/settings/colors";
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

/** Краткое изменение: строки «поле: было → стало» (для update), либо описание для create/delete. */
export function summaryLines(r: Pick<LogRow, "action" | "changes">): string[] {
  const c = (r.changes ?? {}) as Ch;
  if (r.action === "update") {
    const out: string[] = [];
    if (isPair(c.verifiedAt)) out.push(c.verifiedAt[1] ? "подтверждено" : "подтверждение снято");
    if (isPair(c.confirmedAt) && !c.verifiedAt) out.push(c.confirmedAt[1] ? "оплата подтверждена" : "подтверждение оплаты снято");
    for (const [k, v] of Object.entries(c)) {
      if (k === "verifiedAt" || k === "verifiedBy" || k === "confirmedAt" || k === "confirmedBy") continue;
      if (isPair(v)) out.push(`${fieldLabel(k)}: ${showValue(v[0])} → ${showValue(v[1])}`);
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
    return Object.entries(c).filter(([, v]) => isPair(v)).map(([k, v]) => `${fieldLabel(k)}: ${showValue((v as [unknown, unknown])[0])} → ${showValue((v as [unknown, unknown])[1])}`);
  }
  return [];
}

export function snapshotText(changes: unknown): string {
  return JSON.stringify(changes, null, 2);
}
