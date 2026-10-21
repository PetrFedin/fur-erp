/**
 * Обучение по ролям: чистая логика (без БД и без server-only) — роли и доступ, ключи отзывов, проверка отзыва, хэш шага.
 * Используется страницами, серверными действиями, route handlers и скриптами build-training / test-training.
 */
import { createHash } from "node:crypto";
import type { RoleDoc, Step, TrainingRole } from "@/content/training/types";

export const TRAINING_ROLES: readonly TrainingRole[] = ["owner", "technologist", "purchaser", "accountant", "supplier"];

export const TRAINING_ROLE_LABEL: Record<TrainingRole, string> = {
  owner: "Владелец",
  technologist: "Технолог",
  purchaser: "Закупщик",
  accountant: "Бухгалтер",
  supplier: "Веллмех",
};

/** Системная роль → ключ её инструкции. Кладовщик и наблюдатель своей инструкции не имеют. */
export function trainingRoleOf(userRole: string | null | undefined): TrainingRole | null {
  switch (userRole) {
    case "OWNER": case "ADMIN": return "owner";
    case "TECHNOLOGIST": return "technologist";
    case "PURCHASER": return "purchaser";
    case "ACCOUNTANT": return "accountant";
    case "SUPPLIER": return "supplier";
    default: return null;
  }
}

export const isOwnerLike = (userRole: string | null | undefined) => userRole === "OWNER" || userRole === "ADMIN";

/** Какие инструкции можно читать: владелец и администратор — все заказчицкие (вкладки), остальные — только свою. Подрядчика читает только он сам. */
export function readableTrainingRoles(userRole: string | null | undefined): TrainingRole[] {
  if (isOwnerLike(userRole)) return ["owner", "technologist", "purchaser", "accountant", "supplier"];
  const own = trainingRoleOf(userRole);
  return own ? [own] : [];
}

/** Куда можно писать отзыв: в свою инструкцию; владелец и администратор — ещё и в заказчицкие (они принимают решения по всем ролям). Подрядчика не трогает никто, кроме него самого. */
export function writableTrainingRoles(userRole: string | null | undefined): TrainingRole[] {
  if (isOwnerLike(userRole)) return ["owner", "technologist", "purchaser", "accountant"];
  const own = trainingRoleOf(userRole);
  return own ? [own] : [];
}

export function parseTrainingRole(v: unknown): TrainingRole | null {
  return typeof v === "string" && (TRAINING_ROLES as readonly string[]).includes(v) ? (v as TrainingRole) : null;
}

/** Служебные «шаги» отзывов: сама роль и общий блок пожеланий внизу страницы. */
export const ABOUT_ID = "about";
export const GENERAL_ID = "general";

export const FEEDBACK_PREFIX = "training-feedback:";
export const feedbackKey = (role: TrainingRole, stepId: string, userId: string) => `${FEEDBACK_PREFIX}${role}:${stepId}:${userId}`;
export function parseFeedbackKey(key: string): { role: TrainingRole; stepId: string; userId: string } | null {
  if (!key.startsWith(FEEDBACK_PREFIX)) return null;
  const [role, stepId, ...rest] = key.slice(FEEDBACK_PREFIX.length).split(":");
  const userId = rest.join(":");
  const r = parseTrainingRole(role);
  return r && stepId && userId ? { role: r, stepId, userId } : null;
}

export const FEEDBACK_TYPES = [
  "Функционал", "Раздел", "Опция", "Действие", "Оформление", "Кнопка", "Добавить", "Убрать", "Разделить", "Объединить", "Детализация", "Другое",
] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export const COMMENT_MAX = 2000;
export const DECISIONS = ["agree", "disagree"] as const;
export type Decision = (typeof DECISIONS)[number];

export type FeedbackValue = {
  role: TrainingRole;
  stepId: string;
  userId: string;
  userName: string;
  userRole: string;
  decision: Decision | null;
  types: FeedbackType[];
  comment: string;
  /** Хэш шага на момент отзыва: видно, что отзыв относится к прежней версии. */
  stepHash: string;
  at: string;
  /** Отметка владельца «учтено». */
  resolved?: { at: string; by: string; note: string } | null;
};

/** Разбор и очистка отзыва с клиента. Возвращает ошибку по-русски либо чистые поля. Пустой отзыв — empty: true (запись снимается). */
export function cleanFeedbackInput(raw: { decision?: unknown; types?: unknown; comment?: unknown }):
  | { ok: true; decision: Decision | null; types: FeedbackType[]; comment: string; empty: boolean }
  | { ok: false; error: string } {
  const decision = raw.decision == null || raw.decision === "" ? null : (DECISIONS as readonly unknown[]).includes(raw.decision) ? (raw.decision as Decision) : "bad";
  if (decision === "bad") return { ok: false, error: "Неизвестный ответ" };
  if (raw.types != null && !Array.isArray(raw.types)) return { ok: false, error: "Неверный тип замечания" };
  const typesIn = (raw.types ?? []) as unknown[];
  if (typesIn.length > FEEDBACK_TYPES.length) return { ok: false, error: "Слишком много типов" };
  const types: FeedbackType[] = [];
  for (const t of typesIn) {
    if (typeof t !== "string" || !(FEEDBACK_TYPES as readonly string[]).includes(t)) return { ok: false, error: "Неверный тип замечания" };
    if (!types.includes(t as FeedbackType)) types.push(t as FeedbackType);
  }
  if (raw.comment != null && typeof raw.comment !== "string") return { ok: false, error: "Комментарий должен быть текстом" };
  // eslint-disable-next-line no-control-regex
  const comment = String(raw.comment ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (comment.length > COMMENT_MAX) return { ok: false, error: `Комментарий длиннее ${COMMENT_MAX} знаков` };
  return { ok: true, decision, types, comment, empty: !decision && !types.length && !comment };
}

/** Хэш шага: меняется при любой правке текста, адреса, действий подготовки, выносок. По нему видно, что скрин и PDF устарели. */
export function stepHash(step: Step): string {
  const { id, title, text, route, url, via, prep, callouts, result, region } = step;
  return createHash("sha1").update(JSON.stringify({ id, title, text, route, url, via, prep, callouts, result, region })).digest("hex").slice(0, 12);
}

/** Хэш всей инструкции (текст, цели, шаги): по нему PDF признаётся устаревшим. */
export function docHash(doc: RoleDoc): string {
  return createHash("sha1").update(JSON.stringify({ t: doc.title, a: doc.about, g: doc.goals, s: doc.steps.map(stepHash) })).digest("hex").slice(0, 12);
}

export type StepManifest = { hash: string; src: string; file: string; bytes: number; at: string };
export type RoleManifest = { steps: Record<string, StepManifest>; pdf?: { hash: string; file: string; bytes: number; pages: number; at: string } };
export type TrainingManifest = { builtAt: string; commit: string; appVersion: string; roles: Partial<Record<TrainingRole, RoleManifest>> };

/** Защита от CSV-инъекций при выгрузке в Excel: ячейка, начинающаяся с = + - @ или табуляции, получает апостроф. */
export function csvSafe(v: string): string {
  const s = /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
  return /[";\n\r,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Слова, которых не должно быть в инструкции и на скринах подрядчика (проверяет test-training.ts). */
export const SUPPLIER_FORBIDDEN = ["бюджет", "розниц", "наценк", "товар в магазине", "plu", "магазин"] as const;
