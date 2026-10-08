import { prisma } from "@/lib/prisma";
import { buildAttentionBlocks, computeAttention, countAttentionBlocks } from "@/lib/attention";
import { loadVerifyFlags } from "@/lib/verification";
import { computeDocCoverage } from "@/lib/doc-coverage";
import { loadTaskBlocks, stripCoveredPayments, type TaskBlocks } from "@/lib/task-docs";
import type { YearFilter } from "@/lib/year-filter";

/** Три числа раздела «Контроль»: задачи, ждёт проверки, записей с пробелами документов. */
export type ControlTopBlock = { id: string; title: string; count: number; priority: "red" | "yellow" | "gray"; href: string };
export type ControlCounts = {
  /** Открытые задачи = по данным (attention) + документы для поиска + решения владельца: ровно то, что показывает центр задач. */
  tasks: number;
  urgent: number;
  waiting: number;
  docGaps: number;
  /** Из tasks: документы для поиска и решения владельца (блоки центра задач). */
  docTasks: number;
  decisions: number;
  /** Крупнейшие блоки задач (для Сводки). */
  top?: ControlTopBlock[];
  /** Блоки «Документы для поиска» и «Решения владельца» (центр задач берёт их отсюда, чтобы числа совпали). */
  blocks?: TaskBlocks;
};

const TTL_MS = 20_000;
const cache = new Map<string, { at: number; value: Promise<ControlCounts> }>();

/**
 * Считает числа теми же функциями, что страницы раздела (attention.ts, verification.ts, doc-coverage.ts), ничего не дублируя.
 * Короткий кэш в памяти (20 с): панель вкладок стоит на шести страницах подряд, пересчитывать на каждой незачем.
 */
export function loadControlCounts(organizationId: string, year: YearFilter, opts: { fresh?: boolean } = {}): Promise<ControlCounts> {
  const key = `${organizationId}:${year}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = (async () => {
    const [allRows, vf, coverage, blocks] = await Promise.all([
      computeAttention(prisma, organizationId, year),
      loadVerifyFlags(prisma, organizationId, year),
      computeDocCoverage(prisma, organizationId),
      loadTaskBlocks(prisma, organizationId),
    ]);
    // Оплаты, описанные задачами на документы, не считаются второй раз в «Нет платёжек» / «Аванс без привязки».
    const attentionRows = stripCoveredPayments(allRows, blocks.coveredPaymentIds);
    const a = countAttentionBlocks(buildAttentionBlocks(attentionRows));
    const v = Object.values(vf.counts).reduce((s, c) => ({ total: s.total + c.total, verified: s.verified + c.verified }), { total: 0, verified: 0 });
    const top: ControlTopBlock[] = buildAttentionBlocks(attentionRows)
      .filter((b) => b.meta.kind !== "info" && b.count > 0)
      .map((b) => ({ id: b.id, title: b.meta.title, count: b.count, priority: b.priority, href: b.meta.link?.href ?? "/attention" }));
    if (blocks.openDocs > 0) top.push({ id: "doc-tasks", title: "Документы для поиска и загрузки", count: blocks.openDocs, priority: blocks.urgentDocs > 0 ? "red" : "yellow", href: "/attention#doc-tasks" });
    if (blocks.openDecisions > 0) top.push({ id: "owner-decisions", title: "Решения владельца", count: blocks.openDecisions, priority: "yellow", href: "/attention#owner-decisions" });
    top.sort((x, y) => y.count - x.count);
    return {
      tasks: a.main + blocks.openDocs + blocks.openDecisions,
      urgent: a.red + blocks.urgentDocs,
      waiting: v.total - v.verified,
      docGaps: coverage.total.rowsWithGaps,
      docTasks: blocks.openDocs,
      decisions: blocks.openDecisions,
      top: top.slice(0, 3),
      blocks,
    };
  })();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

/** Сбросить кэш чисел организации (после решения владельца и т. п.), чтобы вкладки и Сводка не показывали старое. */
export function invalidateControlCounts(organizationId: string): void {
  for (const k of cache.keys()) if (k.startsWith(`${organizationId}:`)) cache.delete(k);
}
