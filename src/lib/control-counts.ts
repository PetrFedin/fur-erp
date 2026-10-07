import { prisma } from "@/lib/prisma";
import { buildAttentionBlocks, computeAttention, countAttentionBlocks } from "@/lib/attention";
import { loadVerifyFlags } from "@/lib/verification";
import { computeDocCoverage } from "@/lib/doc-coverage";
import type { YearFilter } from "@/lib/year-filter";

/** Три числа раздела «Контроль»: задачи, ждёт проверки, записей с пробелами документов. */
export type ControlCounts = { tasks: number; urgent: number; waiting: number; docGaps: number };

const TTL_MS = 20_000;
const cache = new Map<string, { at: number; value: Promise<ControlCounts> }>();

/**
 * Считает числа теми же функциями, что страницы раздела (attention.ts, verification.ts, doc-coverage.ts), ничего не дублируя.
 * Короткий кэш в памяти (20 с): панель вкладок стоит на шести страницах подряд, пересчитывать на каждой незачем.
 */
export function loadControlCounts(organizationId: string, year: YearFilter): Promise<ControlCounts> {
  const key = `${organizationId}:${year}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = (async () => {
    const [attentionRows, vf, coverage] = await Promise.all([
      computeAttention(prisma, organizationId, year),
      loadVerifyFlags(prisma, organizationId, year),
      computeDocCoverage(prisma, organizationId),
    ]);
    const a = countAttentionBlocks(buildAttentionBlocks(attentionRows));
    const v = Object.values(vf.counts).reduce((s, c) => ({ total: s.total + c.total, verified: s.verified + c.verified }), { total: 0, verified: 0 });
    return { tasks: a.main, urgent: a.red, waiting: v.total - v.verified, docGaps: coverage.total.rowsWithGaps };
  })();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}
