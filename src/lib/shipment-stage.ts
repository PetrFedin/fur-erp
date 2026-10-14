// Стадии строки отгрузки: просмотр → (доработка) → готов к отгрузке → финальная приёмка. Чистые функции: без базы и React.

export type Stage = "REVIEW" | "REWORK" | "READY";
export type ReworkState = "OPEN" | "DONE" | "MORE";

export const STAGE_LABEL: Record<Stage, string> = { REVIEW: "На просмотре", REWORK: "На доработке", READY: "Готов к отгрузке" };
export const REWORK_STATE_LABEL: Record<ReworkState, string> = { OPEN: "в работе", DONE: "исправлено, принято", MORE: "нужны ещё изменения" };
export const isReworkState = (v: string): v is ReworkState => v === "OPEN" || v === "DONE" || v === "MORE";

export const BLOCKED_BY_REWORK = "есть непринятые пункты доработки";
export const ACCEPT_NEEDS_READY = "сначала «Принято» по просмотру";

/** Ключ для счётчиков и фильтра: стадия, а у готовых — итог финальной приёмки. */
export type ViewKey = "review" | "rework" | "ready" | "accepted" | "rejected";
export const VIEW_LABEL: Record<ViewKey, string> = { review: "На просмотре", rework: "На доработке", ready: "Готов к отгрузке", accepted: "Принят", rejected: "Не принят" };

export type StageLine = { stage: Stage; quantity: number; acceptedQty: number | null; returnedQty: number | null };

export type LineView = { key: ViewKey; label: string; variant: "default" | "success" | "warning" | "danger" | "info"; sub: string | null };

export function lineView(l: StageLine): LineView {
  if (l.stage === "REVIEW") return { key: "review", label: STAGE_LABEL.REVIEW, variant: "default", sub: null };
  if (l.stage === "REWORK") return { key: "rework", label: STAGE_LABEL.REWORK, variant: "warning", sub: null };
  const a = l.acceptedQty ?? 0, r = l.returnedQty ?? 0;
  if (l.acceptedQty == null && l.returnedQty == null) return { key: "ready", label: STAGE_LABEL.READY, variant: "success", sub: null };
  const rest = Math.max(0, l.quantity - a - r);
  const parts: string[] = [];
  if (a > 0 && a < l.quantity) parts.push(`принято ${a} из ${l.quantity}`);
  if (r > 0 && a > 0) parts.push(`не принято ${r}`);
  if (rest > 0) parts.push(`ещё не принято ${rest}`);
  const sub = parts.length ? parts.join(" · ") : null;
  if (r > 0) return { key: "rejected", label: "Не принят", variant: "danger", sub };
  if (a >= l.quantity) return { key: "accepted", label: "Принят", variant: "success", sub };
  if (a > 0) return { key: "accepted", label: "Принят частично", variant: "info", sub };
  return { key: "ready", label: STAGE_LABEL.READY, variant: "success", sub };
}

export type ReworkItemLike = { state: ReworkState };
export const openReworks = (items: readonly ReworkItemLike[]) => items.filter((x) => x.state !== "DONE");

/** Что осталось доделать до «Принято после доработки» (для подсказки). */
export function reworkRemainText(items: readonly ReworkItemLike[]): string {
  const open = items.filter((x) => x.state === "OPEN").length;
  const more = items.filter((x) => x.state === "MORE").length;
  return [open ? `в работе: ${open}` : "", more ? `нужны ещё изменения: ${more}` : ""].filter(Boolean).join(", ");
}

export type StageMove = "TO_READY" | "TO_REWORK";
/** Можно ли перейти; текст ошибки или null. Из REWORK в READY — только когда все пункты исправлены и приняты. */
export function moveError(from: Stage, move: StageMove, items: readonly ReworkItemLike[], hasAcceptance: boolean): string | null {
  if (move === "TO_READY") {
    if (from === "READY") return "Строка уже готова к отгрузке";
    if (openReworks(items).length > 0) return BLOCKED_BY_REWORK;
    return null;
  }
  if (from === "REWORK") return "Строка уже на доработке";
  if (hasAcceptance) return "Сначала снимите «Принято» и «Возврат» по строке (очистите значения и сохраните)";
  return null;
}

/** Финальная приёмка (принято / возврат) — только у готовых к отгрузке. */
export const acceptanceAllowed = (stage: Stage) => stage === "READY";

const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
export const rowsText = (n: number) => `${n} ${plural(n, "строка", "строки", "строк")}`;

export function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

/** Названия автоэтапов хронологии (≤ 120 символов). */
export const eventTitles = {
  accepted: (article: string) => clip(`Принято по просмотру: ${article}`, 120),
  acceptedMany: (n: number) => `Принято по просмотру: ${rowsText(n)}`,
  rework: (article: string, first: string) => clip(`На доработку: ${article}: ${first}`, 120),
  afterRework: (article: string) => clip(`Принято после доработки: ${article}`, 120),
};
