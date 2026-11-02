"use server";

import { revalidateAll } from "@/lib/revalidate-all";
import { requireRole } from "@/lib/session";
import { putPlanState } from "@/lib/fw27-plan-data";
import { NI, NM, TARGET_LOAD_DEFAULT, type PlanState } from "@/lib/fw27-plan";

const EDIT = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;
type Res = { ok: true; at: string } | { ok: false; error: string };

const num = (v: unknown, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : null; };
const arr = (a: unknown, n: number, lo: number, hi: number) => Array.from({ length: n }, (_, i) => (Array.isArray(a) && a[i] != null ? num(a[i], lo, hi) : null));

/** Сохранить правки «План производства 2027» (мощность, срок, целевая загрузка, приход по месяцам, свои штуки по месяцам). */
export async function savePlanState(s: PlanState): Promise<Res> {
  const session = await requireRole(...EDIT);
  const clean: PlanState = {
    lead: num(s.lead, 0, 6) ?? 2,
    capRtw: s.capRtw == null ? null : num(s.capRtw, 1, 10000),
    capAcc: s.capAcc == null ? null : num(s.capAcc, 1, 10000),
    targetLoad: arr(s.targetLoad, NM, 0, 2).map((v, i) => v ?? TARGET_LOAD_DEFAULT[i]),
    intake: Object.fromEntries(Object.entries(s.intake ?? {}).slice(0, 10).map(([k, v]) => [String(k).slice(0, 40), arr(v, NI, 0, 100)]).filter(([, v]) => (v as (number | null)[]).some((x) => x != null))),
    prod: Object.fromEntries(Object.entries(s.prod ?? {}).slice(0, 40).map(([k, v]) => [String(k).slice(0, 60), arr(v, NM, 0, 100000)]).filter(([, v]) => (v as (number | null)[]).some((x) => x != null))),
    noWinter: !!s.noWinter,
    updatedBy: session.user.name ?? null,
  };
  await putPlanState(session.user.organizationId, clean);
  revalidateAll();
  return { ok: true, at: new Date().toISOString() };
}
