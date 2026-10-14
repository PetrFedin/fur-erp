// Расчёты и форматы раздела «Отгрузки»: чистые функции без базы и React (годятся и серверу, и клиенту, и скриптам).
//
// Время этапа хранится как «настенное»: 09.10.2026 19:07 = 2026-10-09T19:07:00Z (без пересчёта поясов),
// поэтому на экране оно одинаково у всех и не зависит от пояса сервера и браузера; интервалы — просто разница.
import { orderColors, type OrderColorsInput } from "@/lib/order-colors";
import { parseOrderSizesDetailed } from "@/lib/order-sizes";

/** Часовой пояс, в котором «сейчас» превращается в настенное время (команда работает по Москве). */
export const SHIPMENT_TZ = "Europe/Moscow";

const p2 = (n: number) => String(n).padStart(2, "0");

/** «2026-10-09» + «19:07» → Date (настенное время); пустое время → 00:00. */
export function wallToDate(date: string, time?: string | null): Date {
  const t = time && /^\d{2}:\d{2}$/.test(time) ? time : "00:00";
  return new Date(`${date}T${t}:00.000Z`);
}

/** Текущее настенное время в SHIPMENT_TZ как Date (UTC-метка с цифрами московских часов). */
export function wallNow(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SHIPMENT_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const g = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
  const h = g("hour") === "24" ? "00" : g("hour");
  return new Date(`${g("year")}-${g("month")}-${g("day")}T${h}:${g("minute")}:00.000Z`);
}

export const wallDateIso = (d: Date) => d.toISOString().slice(0, 10);
export const wallTimeHm = (d: Date) => d.toISOString().slice(11, 16);

const ruDay = (d: Date) => `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;

/** «09.10.2026 19:07»; время неизвестно — «05.10.2026». */
export function fmtWall(d: Date, timeKnown: boolean): string {
  return timeKnown ? `${ruDay(d)} ${wallTimeHm(d)}` : ruDay(d);
}

export type StampLike = { occurredAt: Date; timeKnown: boolean };

/** Разница между двумя этапами: «2 дн. 17 ч 59 мин»; если время одного не указано — только дни («3 дн.», «в тот же день»). */
export function formatInterval(a: StampLike, b: StampLike): string {
  const bothKnown = a.timeKnown && b.timeKnown;
  if (!bothKnown) {
    const da = Date.UTC(a.occurredAt.getUTCFullYear(), a.occurredAt.getUTCMonth(), a.occurredAt.getUTCDate());
    const db = Date.UTC(b.occurredAt.getUTCFullYear(), b.occurredAt.getUTCMonth(), b.occurredAt.getUTCDate());
    const days = Math.round(Math.abs(db - da) / 86_400_000);
    return days === 0 ? "в тот же день" : `${days} дн.`;
  }
  let min = Math.round(Math.abs(b.occurredAt.getTime() - a.occurredAt.getTime()) / 60_000);
  if (min === 0) return "менее минуты";
  const days = Math.floor(min / 1440);
  min -= days * 1440;
  const hours = Math.floor(min / 60);
  min -= hours * 60;
  return [days ? `${days} дн.` : "", hours ? `${hours} ч` : "", min ? `${min} мин` : ""].filter(Boolean).join(" ");
}

export type SortableEvent = StampLike & { createdAt: Date };

/**
 * Порядок хронологии: по дням; внутри дня этапы с известным временем — по времени, а с неизвестным —
 * в порядке внесения (createdAt). Так этап «без часа» остаётся там, куда его поставили, а не уезжает в начало суток.
 */
export function compareEvents(a: SortableEvent, b: SortableEvent): number {
  const da = wallDateIso(a.occurredAt);
  const db = wallDateIso(b.occurredAt);
  if (da !== db) return da < db ? -1 : 1;
  if (a.timeKnown && b.timeKnown) {
    const d = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (d !== 0) return d;
  }
  return a.createdAt.getTime() - b.createdAt.getTime();
}

export type IntervalNote = { text: string; fromTitle?: string; exact?: string };

/**
 * Подписи интервалов между соседними этапами (индекс i — перед этапом i; у первого пусто).
 * Если у этапа время известно, а у предыдущего нет, дополнительно считаем точный интервал от ближайшего более раннего этапа со временем
 * (`exact` + `fromTitle`): так «Анна 09.10 19:07 → Ольга 12.10 13:06» видно, даже если между ними стоит этап без часа.
 */
export function intervalNotes<T extends SortableEvent & { title: string }>(sorted: readonly T[]): (IntervalNote | null)[] {
  return sorted.map((e, i) => {
    if (i === 0) return null;
    const prev = sorted[i - 1];
    const note: IntervalNote = { text: formatInterval(prev, e) };
    if (e.timeKnown && !prev.timeKnown) {
      for (let j = i - 2; j >= 0; j--) {
        if (sorted[j].timeKnown) {
          note.exact = formatInterval(sorted[j], e);
          note.fromTitle = sorted[j].title;
          break;
        }
      }
    }
    return note;
  });
}

// ───────────── итоги приёмки ─────────────

export type EventLineLike = { shipmentLineId: string; accepted: number | null; rejected: number | null; returned: number | null };
export type LineAcceptance = { accepted: number; rejected: number; returned: number };

/** Накопительная сумма по всем этапам, где поля заполнены (ожидаемые этапы не учитываются): по строке отгрузки. */
export function acceptanceByLine(events: readonly { expected: boolean; lines: readonly EventLineLike[] }[]): Map<string, LineAcceptance> {
  const out = new Map<string, LineAcceptance>();
  for (const ev of events) {
    if (ev.expected) continue;
    for (const l of ev.lines) {
      const cur = out.get(l.shipmentLineId) ?? { accepted: 0, rejected: 0, returned: 0 };
      cur.accepted += l.accepted ?? 0;
      cur.rejected += l.rejected ?? 0;
      cur.returned += l.returned ?? 0;
      out.set(l.shipmentLineId, cur);
    }
  }
  return out;
}

export type ShipmentTotals = {
  inShipment: number;
  accepted: number;
  rejected: number;
  returned: number;
  /** Не принято и возвращено вместе. */
  notAccepted: number;
  /** Ещё не принято: в отгрузке минус принято (не меньше 0). */
  remaining: number;
};

export function shipmentTotals(lines: readonly { id: string; quantity: number }[], acc: Map<string, LineAcceptance>): ShipmentTotals {
  let inShipment = 0, accepted = 0, rejected = 0, returned = 0, remaining = 0;
  for (const l of lines) {
    const a = acc.get(l.id) ?? { accepted: 0, rejected: 0, returned: 0 };
    inShipment += l.quantity;
    accepted += a.accepted;
    rejected += a.rejected;
    returned += a.returned;
    remaining += Math.max(0, l.quantity - a.accepted);
  }
  return { inShipment, accepted, rejected, returned, notAccepted: rejected + returned, remaining };
}

/** Доля 0–1 (null, если делить не на что). */
export const shareOf = (part: number, whole: number) => (whole > 0 ? part / whole : null);

// ───────────── название по умолчанию ─────────────

export const MONTHS_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

/** «Отгрузка октябрь 2026 · 1»: N — порядковый номер среди отгрузок этого месяца (следующий после наибольшего занятого). */
export function defaultShipmentName(month0: number, year: number, existingNames: readonly (string | null)[]): string {
  const prefix = `Отгрузка ${MONTHS_NOM[month0]} ${year} · `;
  let max = 0;
  for (const n of existingNames) {
    if (n && n.startsWith(prefix)) {
      const k = parseInt(n.slice(prefix.length), 10);
      if (Number.isFinite(k) && k > max) max = k;
    }
  }
  return `${prefix}${max + 1}`;
}

// ───────────── строки отгрузки из позиций ТЗ ─────────────

export type CandidateRow = { color: string | null; size: string | null; qty: number };

type OrderForRows = OrderColorsInput & { plannedQuantity: number; size: string | null };

/** Разбивка количества по размерам: если известна (число размеров в записи = количеству), то строка на размер; иначе одна строка с размером из текста. */
function splitBySize(sizeText: string | null | undefined, qty: number): { size: string | null; qty: number }[] {
  const raw = (sizeText ?? "").trim();
  const p = parseOrderSizesDetailed(raw);
  if (p.kind === "sizes" && p.perUnit.length === qty && qty > 0) {
    const counts = new Map<string, number>();
    for (const s of p.perUnit) counts.set(s, (counts.get(s) ?? 0) + 1);
    return [...counts].map(([size, n]) => ({ size, qty: n }));
  }
  return [{ size: raw || null, qty }];
}

/** Строки-кандидаты одной позиции ТЗ: по цвету (составной цвет — по строке на цвет) и по размеру (если разбивка известна). */
export function candidateRows(o: OrderForRows): CandidateRow[] {
  const planned = Math.max(0, Math.round(o.plannedQuantity));
  const colors = orderColors(o);
  if (colors.length === 0) return splitBySize(o.size, planned).map((s) => ({ color: null, ...s }));
  if (colors.length === 1 && colors[0].quantity == null) return splitBySize(colors[0].sizes ?? o.size, planned).map((s) => ({ color: colors[0].name, ...s }));
  const out: CandidateRow[] = [];
  for (const c of colors) {
    const qty = c.quantity ?? (colors.length === 1 ? planned : 0);
    for (const s of splitBySize(c.sizes ?? (colors.length === 1 ? o.size : null), qty)) out.push({ color: c.name, ...s });
  }
  return out;
}

export const lineKey = (orderId: string, color: string | null | undefined, size: string | null | undefined) =>
  `${orderId}|${(color ?? "").trim()}|${(size ?? "").trim()}`;

/** Ссылки на документы этапа: строки, начинающиеся с http(s), — ссылки; остальное — просто текст. */
export function parseDocLinks(text: string | null | undefined): { text: string; href: string | null }[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /(https?:\/\/\S+)/.exec(s);
      return { text: s, href: m ? m[1] : null };
    });
}
