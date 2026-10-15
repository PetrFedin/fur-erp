/**
 * Этапы сырья аукциона (Веллмех ведёт руками): справочник этапов и расчёт «где сырьё сейчас, когда ждать».
 * Чистая логика без БД — используется страницами, чипами в списках и scripts/test-raw-stage.ts.
 */
export const RAW_STAGES = [
  { key: "AUCTION_BOUGHT", label: "Куплено на аукционе" },
  { key: "PAID", label: "Оплачено аукциону" },
  { key: "SHIPPED_AUCTION", label: "Отправлено с аукциона (логистика)" },
  { key: "CUSTOMS", label: "Таможня / доставка" },
  { key: "TO_MOSCOW", label: "В пути в Москву" },
  { key: "ARRIVED_MSK", label: "Пришло в Москву" },
  { key: "TO_DRESSING", label: "В пути на выделку" },
  { key: "DRESSING", label: "Выделка" },
  { key: "TONING", label: "Тонировка / покраска" },
  { key: "DYEING", label: "Крашение" },
  { key: "FROM_DRESSING", label: "Возврат с выделки" },
  { key: "TO_WAREHOUSE", label: "В пути на склад" },
  { key: "AT_WAREHOUSE", label: "На складе Веллмеха" },
  { key: "READY_TO_SEND", label: "Готово к отправке нам" },
  { key: "SENT_TO_US", label: "Отправлено нам" },
  { key: "HANDED", label: "Передано нам (УПД)" },
  { key: "DELIVERED", label: "Пришло к нам" },
] as const;
export type RawStageKey = (typeof RAW_STAGES)[number]["key"];
export const RAW_STAGE_KEYS: string[] = RAW_STAGES.map((s) => s.key);
export const STAGE_NAME: Record<string, string> = Object.fromEntries(RAW_STAGES.map((s) => [s.key, s.label]));
/** Короткие подписи для чипа в списках. */
const SHORT: Record<string, string> = { TO_MOSCOW: "В пути в Москву", ARRIVED_MSK: "В Москве", READY_TO_SEND: "Готово к отправке нам", SENT_TO_US: "Отправлено нам", DELIVERED: "Пришло к нам", SHIPPED_AUCTION: "Отправлено с аукциона", CUSTOMS: "Таможня", AT_WAREHOUSE: "На складе Веллмеха" };
export const stageShort = (k: string) => SHORT[k] ?? STAGE_NAME[k] ?? k;

export type StageStatusKey = "PLANNED" | "IN_PROGRESS" | "DONE";
export const STAGE_STATUS_LABEL: Record<StageStatusKey, string> = { PLANNED: "Запланировано", IN_PROGRESS: "В работе", DONE: "Готово" };
export const STAGE_STATUS_CLASS: Record<StageStatusKey, string> = {
  PLANNED: "bg-neutral-100 text-neutral-700",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  DONE: "bg-green-100 text-green-800",
};

export type StageLike = {
  stage: string; status: string; place?: string | null;
  plannedStart?: Date | null; plannedEnd?: Date | null; factStart?: Date | null; factEnd?: Date | null;
};

const DAY = 86400000;
const stageIdx = (k: string) => RAW_STAGE_KEYS.indexOf(k);
/** Дата → полночь UTC (даты этапов хранятся как «день», без времени). */
export const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
/** «Сегодня» как день UTC-полночь (по местному календарному дню сервера). */
export const todayDay = (now: Date = new Date()) => Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
export const diffDays = (a: Date | number, b: Date | number) => Math.round(((typeof a === "number" ? a : dayOf(a)) - (typeof b === "number" ? b : dayOf(b))) / DAY);

export function ruShort(d: Date | null | undefined): string {
  if (!d) return "";
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Порядок ленты: по справочнику, внутри этапа — по дате начала. */
export function sortStages<T extends StageLike>(list: T[]): T[] {
  const t = (s: T) => (s.factStart ?? s.plannedStart)?.getTime() ?? Infinity;
  return [...list].sort((a, b) => stageIdx(a.stage) - stageIdx(b.stage) || t(a) - t(b));
}

/** Длительность этапа словами: «в работе 5 дн.», «заняло 12 дн.», «план 10 дн.» или "". */
export function stageDuration(s: StageLike, today: number): string {
  if (s.status === "IN_PROGRESS" && s.factStart) return `в работе ${Math.max(0, diffDays(today, s.factStart))} дн.`;
  if (s.status === "DONE" && s.factStart && s.factEnd) return `заняло ${Math.max(0, diffDays(s.factEnd, s.factStart))} дн.`;
  if (s.plannedStart && s.plannedEnd) return `план ${Math.max(0, diffDays(s.plannedEnd, s.plannedStart))} дн.`;
  return "";
}

export type RawSummary = {
  /** now — идёт этап; between — предыдущий готов, следующий ещё не начат; done — всё пройдено; null — этапов нет. */
  state: "now" | "between" | "done";
  stage: string;
  place: string;
  /** Когда начался текущий этап (факт). */
  since: Date | null;
  /** Ожидаемая дата прибытия: плановый конец последнего незавершённого этапа (приоритет — «на склад» / «передано нам»). */
  eta: Date | null;
  /** Дней до ожидаемой даты (отрицательно — просрочено). */
  daysLeft: number | null;
  overdue: boolean;
};

const ARRIVAL = ["TO_WAREHOUSE", "AT_WAREHOUSE", "SENT_TO_US", "HANDED", "DELIVERED"];

export function summarizeStages(list: StageLike[], now: Date = new Date()): RawSummary | null {
  if (list.length === 0) return null;
  const today = todayDay(now);
  const sorted = sortStages(list);
  const open = sorted.filter((s) => s.status !== "DONE");
  const running = sorted.filter((s) => s.status === "IN_PROGRESS");
  let state: RawSummary["state"];
  let cur: StageLike;
  if (running.length > 0) { state = "now"; cur = running[running.length - 1]; }
  else if (open.length > 0) { state = "between"; cur = open[0]; }
  else { state = "done"; cur = sorted[sorted.length - 1]; }
  const ends = (xs: StageLike[]) => xs.map((s) => s.plannedEnd).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
  const arrival = ends(open.filter((s) => ARRIVAL.includes(s.stage)));
  const anyEnds = ends(open);
  const eta = state === "done" ? null : (arrival.length ? arrival[arrival.length - 1] : anyEnds.length ? anyEnds[anyEnds.length - 1] : null);
  const daysLeft = eta ? diffDays(eta, today) : null;
  return { state, stage: cur.stage, place: cur.place ?? "", since: state === "now" ? cur.factStart ?? null : null, eta, daysLeft, overdue: daysLeft != null && daysLeft < 0 };
}

/** Этапы, после которых цепочка считается пройденной (мех у нас или передан нам). */
const LAST_STAGES = ["HANDED", "DELIVERED"];
const daysWord = (n: number) => `${n} дн.`;
/** Строка «Сейчас: Выделка · МК ЛИС · с 02.10 · ждём к 20.10 (осталось 5 дн.)». */
export function summaryLine(s: RawSummary): string {
  const name = STAGE_NAME[s.stage] ?? s.stage;
  if (s.state === "done") return LAST_STAGES.includes(s.stage) ? `Все этапы пройдены · ${name}` : `Последний внесённый этап: ${name} — готово. Следующий этап ещё не внесён`;
  const parts = [s.state === "between" ? `Далее: ${name}` : name];
  if (s.place) parts.push(s.place);
  if (s.since) parts.push(`с ${ruShort(s.since)}`);
  if (s.eta) parts.push(`ждём к ${ruShort(s.eta)} (${s.daysLeft! < 0 ? `просрочено на ${daysWord(-s.daysLeft!)}` : s.daysLeft === 0 ? "сегодня" : `осталось ${daysWord(s.daysLeft!)}`})`);
  return parts.join(" · ");
}
/** Короткий чип для списков: «Выделка · ждём к 20.10». */
export function summaryChip(s: RawSummary): string {
  if (s.state === "done") return stageShort(s.stage);
  return `${stageShort(s.stage)}${s.eta ? ` · ждём к ${ruShort(s.eta)}` : ""}`;
}
