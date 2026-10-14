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

/** «09.10.2026» (для карточки этапа). */
export const wallDateRu = ruDay;

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

// ───────────── итоги приёмки (по строкам отгрузки) ─────────────

/** Приёмка живёт на строке отгрузки: принято и возвращено поставщику (не принято); null — ещё не отмечено. */
export type AcceptLine = { quantity: number; acceptedQty: number | null; returnedQty: number | null };

export type ShipmentTotals = {
  /** «К отгрузке»: сумма количеств по строкам. */
  inShipment: number;
  accepted: number;
  /** «Не принято»: возвращено поставщику. */
  returned: number;
  /** Ещё ждёт приёмки: по каждой строке количество минус принято и возвращено (не меньше 0). */
  remaining: number;
  /** Сколько строк отмечено (принято или возврат заполнены). */
  filledLines: number;
};

export function shipmentTotals(lines: readonly AcceptLine[]): ShipmentTotals {
  let inShipment = 0, accepted = 0, returned = 0, remaining = 0, filledLines = 0;
  for (const l of lines) {
    const a = l.acceptedQty ?? 0, r = l.returnedQty ?? 0;
    inShipment += l.quantity;
    accepted += a;
    returned += r;
    remaining += Math.max(0, l.quantity - a - r);
    if (l.acceptedQty != null || l.returnedQty != null) filledLines++;
  }
  return { inShipment, accepted, returned, remaining, filledLines };
}

/** Проверка приёмки строки: целые ≥ 0 и принято + возврат не больше, чем в отгрузке; допускаем меньше («ещё не принято»). Текст ошибки или null. */
export function acceptLineError(n: number, quantity: number, accepted: number | null, returned: number | null): string | null {
  for (const v of [accepted, returned]) {
    if (v != null && (!Number.isInteger(v) || v < 0)) return `Строка ${n}: количества — целые числа не меньше 0`;
  }
  const sum = (accepted ?? 0) + (returned ?? 0);
  if (sum > quantity) return `Строка ${n}: принято + возврат (${sum}) больше, чем в отгрузке (${quantity})`;
  return null;
}

/** Автосводка для этапа приёмки: «Принято 70 из 77, возврат 7». */
export function acceptSummaryText(t: Pick<ShipmentTotals, "inShipment" | "accepted" | "returned">): string {
  return `Принято ${t.accepted} из ${t.inShipment}, возврат ${t.returned}`;
}

// ───────────── «на ком» этап ─────────────

export const SIDES = [
  { value: "WELLMEKH", label: "Веллмех" },
  { value: "CUM", label: "ЦУМ" },
] as const;
export const SIDE_LABEL: Record<string, string> = Object.fromEntries(SIDES.map((x) => [x.value, x.label]));
export const isSide = (v: string) => SIDES.some((x) => x.value === v);
export const SIDE_ERROR = "Укажите, на ком этап: Веллмех или ЦУМ";
/** «На ком» обязателен и только Веллмех / ЦУМ: текст ошибки или null. */
export const sideError = (v: string | null | undefined): string | null => (v && isSide(v) ? null : SIDE_ERROR);

// ───────────── действующие лица ─────────────

export type PeopleBySide = Record<string, string[]>;

/**
 * Список действующих лиц по компаниям: имена из этапов (без учёта регистра и пробелов по краям), по частоте, затем по алфавиту.
 * `extra` — дополнительные имена по компании (для ЦУМ: пользователи приложения); в конец, если их нет среди вписанных.
 * Отдельной таблицы нет: вписанный в этап человек сам попадает в список.
 */
export function buildPeopleBySide(
  events: readonly { side: string | null; responsibleName: string | null }[],
  extra: Partial<Record<string, readonly string[]>> = {},
): PeopleBySide {
  const out: PeopleBySide = {};
  for (const { value } of SIDES) {
    const count = new Map<string, { name: string; n: number }>();
    for (const e of events) {
      if (e.side !== value) continue;
      const name = (e.responsibleName ?? "").trim();
      if (!name) continue;
      const k = name.toLowerCase();
      const cur = count.get(k);
      if (cur) cur.n++;
      else count.set(k, { name, n: 1 });
    }
    const used = [...count.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "ru")).map((x) => x.name);
    const seen = new Set(used.map((x) => x.toLowerCase()));
    const more = [...new Set((extra[value] ?? []).map((x) => x.trim()).filter(Boolean))]
      .filter((x) => !seen.has(x.toLowerCase()))
      .sort((a, b) => a.localeCompare(b, "ru"));
    out[value] = [...used, ...more];
  }
  return out;
}

// ───────────── этап приёмки и итог поставки ─────────────

/** Ожидаемый этап приёмки: в названии «принят» / «приёмк» / «приемк» или место «Коптево» (регистр не важен). */
export function isAcceptanceEvent(e: { expected: boolean; title: string; place: string | null }): boolean {
  if (!e.expected) return false;
  return /принят|приёмк|приемк/i.test(e.title) || /коптево/i.test(e.place ?? "");
}

/** Короткая дата и время для ленты: «09.10» и «19:07» (время неизвестно — null). */
export function shortStamp(d: Date, timeKnown: boolean): { date: string; time: string | null; full: string } {
  return { date: `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}`, time: timeKnown ? wallTimeHm(d) : null, full: fmtWall(d, timeKnown) };
}

const WEEKDAYS_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** Заголовок дня ленты: «Пн, 12 октября 2026». */
export function dayHeading(d: Date): string {
  return `${WEEKDAYS_SHORT[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export type DayGroup<T> = {
  /** «2026-10-12». */
  day: string;
  heading: string;
  /** Этапы дня с индексом в общем (отсортированном) списке. */
  items: { event: T; index: number }[];
  /** past — день до сегодняшнего; today — сегодня; upcoming — все этапы дня ожидаемые или день позже сегодняшнего. */
  kind: "past" | "today" | "upcoming";
};

/** Группировка отсортированных этапов по календарным дням (настенное время). `todayIso` — сегодня в формате «2026-10-14». */
export function groupEventsByDay<T extends { occurredAt: Date; expected: boolean }>(sorted: readonly T[], todayIso: string): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  sorted.forEach((event, index) => {
    const day = wallDateIso(event.occurredAt);
    let g = out[out.length - 1];
    if (!g || g.day !== day) {
      g = { day, heading: dayHeading(event.occurredAt), items: [], kind: "past" };
      out.push(g);
    }
    g.items.push({ event, index });
  });
  for (const g of out) {
    g.kind = g.items.every((x) => x.event.expected) ? "upcoming" : g.day === todayIso ? "today" : g.day > todayIso ? "upcoming" : "past";
  }
  return out;
}

const dayNum = (d: Date) => Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);

/** Плановая дата → фактическая: «в срок», «опережение на N дн.», «задержка на N дн.» (разница в календарных днях). */
export function planVsFact(planned: Date, actual: Date): { days: number; text: string } {
  const days = dayNum(actual) - dayNum(planned);
  if (days === 0) return { days, text: "в срок" };
  return { days, text: days < 0 ? `опережение на ${-days} дн.` : `задержка на ${days} дн.` };
}

export type SummaryEvent = { id: string; title: string; occurredAt: Date; timeKnown: boolean; createdAt: Date; expected: boolean };

export type DeliverySummary = {
  first: { title: string; stamp: string } | null;
  accepted: { title: string; stamp: string };
  /** «первая запись → приёмка», например «5 дн. 20 ч». */
  firstToAccept: string | null;
  plan: { planned: string; actual: string; text: string; days: number };
  /** Ключевые интервалы между этапами цепочки: первый → документы → запись на приёмку → приёмка (что нашлось по названиям). */
  chain: { from: string; to: string; text: string }[];
};

const DOC_RE = /документ|упд/i;
const BOOK_RE = /записал|запис[ьи]/i;

/**
 * Сроки поставки. `events` — все этапы отгрузки; ожидаемые не учитываются. `acceptEventId` — этап приёмки.
 * Цепочка собирается по названиям (документы / запись на приёмку), которых нет — пропускаются; если ни одного нет, просто «первый → приёмка».
 */
export function deliverySummary(args: { plannedDate: Date; acceptedAt: Date; acceptEventId: string | null; events: readonly SummaryEvent[] }): DeliverySummary {
  const done = [...args.events].filter((e) => !e.expected).sort(compareEvents);
  const acc = done.find((e) => e.id === args.acceptEventId) ?? done[done.length - 1] ?? null;
  const before = done.filter((e) => e !== acc && (!acc || compareEvents(e, acc) < 0));
  const first = before[0] ?? null;
  const docs = before.find((e) => DOC_RE.test(e.title) && e !== first) ?? null;
  const book = [...before].reverse().find((e) => BOOK_RE.test(e.title) && e !== first && e !== docs) ?? null;
  const nodes = [first, docs, book, acc].filter((e): e is SummaryEvent => !!e).sort(compareEvents);
  const stampOf = (e: SummaryEvent) => fmtWall(e.occurredAt, e.timeKnown);
  const chain: DeliverySummary["chain"] = [];
  for (let i = 1; i < nodes.length; i++) chain.push({ from: nodes[i - 1].title, to: nodes[i].title, text: formatInterval(nodes[i - 1], nodes[i]) });
  const accAt = { occurredAt: args.acceptedAt, timeKnown: acc ? acc.timeKnown : true };
  return {
    first: first ? { title: first.title, stamp: stampOf(first) } : null,
    accepted: { title: acc?.title ?? "Приёмка", stamp: fmtWall(args.acceptedAt, accAt.timeKnown) },
    firstToAccept: first ? formatInterval(first, accAt) : null,
    plan: { planned: ruDay(args.plannedDate), actual: ruDay(args.acceptedAt), ...planVsFact(args.plannedDate, args.acceptedAt) },
    chain,
  };
}

export type OrderGroupLine = { orderKey: string; label: string; article: string; quantity: number; acceptedQty: number | null; returnedQty: number | null; comment: string | null };
export type OrderGroup = { key: string; label: string; article: string; quantity: number; accepted: number; returned: number; waiting: number; reasons: string[] };

/** Таблица итога «по ТЗ и артикулам»: суммы по ТЗ (с артикулом) и причины возврата из комментариев строк с возвратом. */
export function groupByOrder(lines: readonly OrderGroupLine[]): OrderGroup[] {
  const out = new Map<string, OrderGroup>();
  for (const l of lines) {
    const g = out.get(l.orderKey) ?? { key: l.orderKey, label: l.label, article: l.article, quantity: 0, accepted: 0, returned: 0, waiting: 0, reasons: [] };
    const a = l.acceptedQty ?? 0, r = l.returnedQty ?? 0;
    g.quantity += l.quantity;
    g.accepted += a;
    g.returned += r;
    g.waiting += Math.max(0, l.quantity - a - r);
    if (r > 0 && l.comment && !g.reasons.includes(l.comment)) g.reasons.push(l.comment);
    out.set(l.orderKey, g);
  }
  return [...out.values()];
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
