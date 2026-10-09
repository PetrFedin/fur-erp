"use server";

import { prisma } from "@/lib/prisma";
import { requireRole, requireSession } from "@/lib/session";
import { loadBudgetStats } from "@/lib/budget-stats";
import { DEFAULT_PARAMS, autoCalc, parseNodes, templateNodes, type BudgetNode, type BudgetParams, type BudgetStat, type NodeSrc } from "@/lib/budget-calc";

const EDIT = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const n = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, -1e12), 1e12) : d);
const s = (v: unknown, max = 80) => String(v ?? "").trim().slice(0, max);

function cleanParams(p: Partial<BudgetParams> | null | undefined): BudgetParams {
  return { upFur: n(p?.upFur, DEFAULT_PARAMS.upFur), upLining: n(p?.upLining, DEFAULT_PARAMS.upLining), upWork: n(p?.upWork, DEFAULT_PARAMS.upWork), c4: n(p?.c4, DEFAULT_PARAMS.c4) };
}

const SRC: NodeSrc[] = ["art", "pair", "none", "manual"];

/** Проверка дерева: допустимые виды и родители (тип сырья → категория → артикул), уникальные id, числа в границах. */
function cleanNodes(input: unknown): BudgetNode[] | null {
  if (!Array.isArray(input) || input.length > 800) return null;
  const out: BudgetNode[] = [];
  const kindById = new Map<string, string>();
  for (const raw of input as Partial<BudgetNode>[]) {
    const kind = raw.kind === "fur" || raw.kind === "cat" || raw.kind === "art" ? raw.kind : null;
    const id = s(raw.id, 40);
    if (!kind || !id || kindById.has(id)) continue;
    const parentId = raw.parentId ? s(raw.parentId, 40) : null;
    const need = kind === "fur" ? null : kind === "cat" ? "fur" : "cat";
    if (kind === "fur" ? parentId !== null : kindById.get(parentId ?? "") !== need) continue;
    kindById.set(id, kind);
    const b = raw.base;
    out.push({
      id, kind, parentId, name: s(raw.name, 120), modelId: raw.modelId ? s(raw.modelId, 40) : null,
      pcs: Math.max(0, n(raw.pcs)), locked: !!raw.locked,
      hides: Math.max(0, n(raw.hides)), hidePrice: Math.max(0, n(raw.hidePrice)), meters: Math.max(0, n(raw.meters)), meterPrice: Math.max(0, n(raw.meterPrice)), work: Math.max(0, n(raw.work)),
      statFur: s(raw.statFur), statCat: s(raw.statCat),
      base: b ? { hides: n(b.hides), hidePrice: n(b.hidePrice), meters: n(b.meters), meterPrice: n(b.meterPrice), work: n(b.work) } : null,
      sample: Math.max(0, n(raw.sample)), src: SRC.includes(raw.src as NodeSrc) ? (raw.src as NodeSrc) : "none",
    });
  }
  return out;
}

/** Свежая статистика системы для кнопки «Автоматический расчёт». */
export async function refreshBudgetStats(): Promise<BudgetStat[]> {
  const session = await requireSession();
  return loadBudgetStats(session.user.organizationId);
}

/** Сохранение версии (параметры и дерево одним документом). Утверждённую версию не меняет. */
export async function saveBudget(id: string, params: BudgetParams, nodes: BudgetNode[], comment?: string): Promise<Res<{ at: string }>> {
  const session = await requireRole(...EDIT);
  const clean = cleanNodes(nodes);
  if (!clean) return { ok: false, error: "Слишком много строк или неверный формат" };
  const row = await prisma.budgetScenario.findFirst({ where: { id: s(id, 40), organizationId: session.user.organizationId }, select: { id: true, status: true } });
  if (!row) return { ok: false, error: "Бюджет не найден" };
  if (row.status === "APPROVED") return { ok: false, error: "Версия утверждена: верните её в черновик, чтобы менять" };
  const saved = await prisma.budgetScenario.update({
    where: { id: row.id },
    data: { params: cleanParams(params), lines: clean as object[], ...(comment === undefined ? {} : { comment: s(comment, 500) || null }), updatedBy: session.user.name ?? null },
  });
  return { ok: true, at: saved.updatedAt.toISOString() };
}

/** Новый бюджет: пустой, копия существующего или по Budget PCS FW27 (строки с готовым автоматическим расчётом). */
export async function createBudget(input: { name: string; season: string; template: "empty" | "copy" | "fw27"; copyFromId?: string }): Promise<Res<{ id: string }>> {
  const session = await requireRole(...EDIT);
  const orgId = session.user.organizationId;
  const name = s(input?.name, 80);
  const season = s(input?.season, 20) || "FW27";
  if (!name) return { ok: false, error: "Введите название бюджета" };
  let params = DEFAULT_PARAMS;
  let nodes: BudgetNode[] = [];
  let parentId: string | null = null;
  let comment: string | null = null;
  if (input.template === "copy") {
    const src = await prisma.budgetScenario.findFirst({ where: { id: s(input.copyFromId, 40), organizationId: orgId } });
    if (!src) return { ok: false, error: "Бюджет для копирования не найден" };
    params = cleanParams(src.params as Partial<BudgetParams>);
    nodes = parseNodes(src.lines);
    parentId = src.id;
    comment = src.comment;
  } else if (input.template === "fw27") {
    nodes = autoCalc(templateNodes(), await loadBudgetStats(orgId), params);
  }
  const row = await prisma.budgetScenario.create({
    data: { organizationId: orgId, season, name, status: "DRAFT", comment, parentId, params, lines: (cleanNodes(nodes) ?? []) as object[], createdBy: session.user.name ?? null, updatedBy: session.user.name ?? null },
  });
  return { ok: true, id: row.id };
}

export async function duplicateBudget(id: string): Promise<Res<{ id: string }>> {
  const session = await requireRole(...EDIT);
  const src = await prisma.budgetScenario.findFirst({ where: { id: s(id, 40), organizationId: session.user.organizationId } });
  if (!src) return { ok: false, error: "Бюджет не найден" };
  const row = await prisma.budgetScenario.create({
    data: {
      organizationId: src.organizationId, season: src.season, name: `${src.name} (копия)`.slice(0, 80), status: "DRAFT", comment: src.comment, parentId: src.id,
      params: src.params as object, lines: (cleanNodes(parseNodes(src.lines)) ?? []) as object[], createdBy: session.user.name ?? null, updatedBy: session.user.name ?? null,
    },
  });
  return { ok: true, id: row.id };
}

export async function renameBudget(id: string, name: string, season: string): Promise<Res> {
  const session = await requireRole(...EDIT);
  const nm = s(name, 80);
  if (!nm) return { ok: false, error: "Введите название" };
  const r = await prisma.budgetScenario.updateMany({ where: { id: s(id, 40), organizationId: session.user.organizationId }, data: { name: nm, season: s(season, 20) || "FW27", updatedBy: session.user.name ?? null } });
  return r.count ? { ok: true } : { ok: false, error: "Бюджет не найден" };
}

export async function setBudgetStatus(id: string, status: "DRAFT" | "APPROVED"): Promise<Res> {
  const session = await requireRole(...EDIT);
  if (status !== "DRAFT" && status !== "APPROVED") return { ok: false, error: "Неверный статус" };
  const r = await prisma.budgetScenario.updateMany({ where: { id: s(id, 40), organizationId: session.user.organizationId }, data: { status, updatedBy: session.user.name ?? null } });
  return r.count ? { ok: true } : { ok: false, error: "Бюджет не найден" };
}

export async function deleteBudget(id: string): Promise<Res> {
  const session = await requireRole(...EDIT);
  const r = await prisma.budgetScenario.deleteMany({ where: { id: s(id, 40), organizationId: session.user.organizationId } });
  return r.count ? { ok: true } : { ok: false, error: "Бюджет не найден" };
}
