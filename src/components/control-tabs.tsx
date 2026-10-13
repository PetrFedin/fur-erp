import { Suspense } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { requireSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { loadControlCounts, type ControlCounts } from "@/lib/control-counts";
import { getIntegrityReport } from "@/lib/integrity";

const TABS = [
  { key: "tasks", href: "/attention", label: "Задачи", hint: "Что требует действия — единый список" },
  { key: "verify", href: "/verify", label: "Подтвердить", hint: "Подтверждение оплат, закупок, ТЗ и партий" },
  { key: "documents", href: "/documents", label: "Документы", hint: "Каких документов не хватает; расхождения и документы для поиска" },
  { key: "reconciliation", href: "/reconciliation", label: "Сверка", hint: "Что сходится на 100%, что нет; проверка данных: остатки, стоимости, оплаты, долг" },
  { key: "history", href: "/history", label: "История", hint: "Кто, когда и что изменил" },
] as const;

export type ControlTab = (typeof TABS)[number]["key"];

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100, b = a % 10;
  return `${n} ${a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many}`;
}

function count(key: ControlTab, c: ControlCounts | null, integrity: { n: number; red: boolean } | null): { n: number; tone: string; title: string } | null {
  // «Проверка данных» теперь внутри «Сверки»: её счётчик (расхождения в данных) показывает вкладка «Сверка».
  if (key === "reconciliation") return integrity && integrity.n > 0 ? { n: integrity.n, tone: integrity.red ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-900", title: plural(integrity.n, "расхождение", "расхождения", "расхождений") + " в данных" } : null;
  if (!c) return null;
  if (key === "tasks") return { n: c.tasks, tone: c.urgent > 0 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-900", title: plural(c.tasks, "вопрос", "вопроса", "вопросов") + (c.urgent ? `, срочных блоков: ${c.urgent}` : "") };
  if (key === "verify") return { n: c.waiting, tone: "bg-amber-100 text-amber-900", title: plural(c.waiting, "строка", "строки", "строк") + " ждут подтверждения" };
  if (key === "documents") return { n: c.docGaps, tone: "bg-amber-100 text-amber-900", title: plural(c.docGaps, "документ", "документа", "документов") + " с неполным комплектом" };
  return null;
}

function Bar({ active, counts, integrity = null }: { active: ControlTab; counts: ControlCounts | null; integrity?: { n: number; red: boolean } | null }) {
  return (
    <nav aria-label="Контроль" className="flex items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-neutral-200 pb-2">
      {TABS.map((t) => {
        const c = count(t.key, counts, integrity);
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            title={t.hint}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 max-md:min-h-9",
              on ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100",
            )}
          >
            {t.label}
            {c && c.n > 0 && (
              <span className={cn("rounded-full px-1.5 text-xs font-semibold tabular-nums", c.tone)} title={c.title} aria-label={c.title}>
                {c.n}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

async function Loaded({ active }: { active: ControlTab }) {
  const session = await requireSession();
  const year = await getYearFilter();
  const counts = await loadControlCounts(session.user.organizationId, year).catch(() => null);
  const rep = await getIntegrityReport(session.user.organizationId);
  const integrity = rep ? { n: rep.failingErrors + rep.failingWarns, red: rep.failingErrors > 0 } : null;
  return <Bar active={active} counts={counts} integrity={integrity} />;
}

/**
 * Вкладки раздела «Контроль» (одна панель на пяти страницах; «Анализ документов» влит в «Документы», «Проверка данных» — в «Сверку», «Комментарии» — рядом с «Историей»).
 * Счётчики подгружаются отдельно: страница не ждёт их, вкладки видны сразу.
 */
export function ControlTabs({ active }: { active: ControlTab }) {
  return (
    <Suspense fallback={<Bar active={active} counts={null} />}>
      <Loaded active={active} />
    </Suspense>
  );
}
