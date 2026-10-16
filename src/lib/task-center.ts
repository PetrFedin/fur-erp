import type { VerifyKind, VerifyRow } from "@/lib/verification";

/**
 * Единый центр задач: группировка того, что уже считают attention.ts, verification.ts и doc-coverage.ts.
 * Здесь НИЧЕГО не пересчитывается — только раскладка замечаний (blockers) строк «Подтвердить» по понятным категориям.
 * Один факт — одно место: «нет документа» и «нет платёжки» показываются одной сводной строкой со ссылкой
 * (подробности — «Документы» и «Подтвердить»), а не десятками повторов.
 */
export type TaskCategoryId = "doc" | "receipt" | "sum" | "confirm" | "date" | "price" | "composition" | "other";

export const TASK_LABELS: Record<TaskCategoryId, { label: string; action: string; hint: string }> = {
  doc: { label: "Нет документа", action: "Приложить", hint: "Не хватает обязательного документа у закупки, ТЗ, партии или оплаты (УПД, счёт, приложение ТЗ). Список по записям — вкладка «Документы»." },
  receipt: { label: "Нет платёжки", action: "Найти платёжку", hint: "Оплата внесена по письму или расчёту, а платёжного поручения нет. Деньги в долге учтены; нужна выписка банка. Список по оплатам — «Подтвердить → Платежи»." },
  sum: { label: "Расхождение суммы", action: "Сверить", hint: "Сумма в базе не равна сумме по документам или сверка с документами не сошёлся на 100%." },
  confirm: { label: "Ждёт подтверждения", action: "Подтвердить", hint: "Замечаний нет — запись готова, остаётся нажать «Подтвердить»." },
  date: { label: "Нет даты", action: "Внести дату", hint: "Нет настоящей даты ТЗ (в приложении только шаблонная) или она похожа на шаблон." },
  price: { label: "Нет цены", action: "Задать цену", hint: "Не задана цена работы или сумма." },
  composition: { label: "Нет состава", action: "Внести состав", hint: "Нет списаний сырья, лотов или не задано количество." },
  other: { label: "Прочее: не хватает данных", action: "Открыть", hint: "Партия или заказчик не указаны, оплата не привязана, закупка в черновике и т. п." },
};

export function classifyBlocker(text: string): TaskCategoryId {
  const t = text.toLowerCase();
  if (/платёжк|п\/п|дата оплаты взята/.test(t)) return "receipt";
  if (/нет документа|приложение к тз не прикреплено|нет панели документов/.test(t)) return "doc";
  if (/≠|не сошлось|не совпал|реестр/.test(t)) return "sum";
  if (/цена работы|сумма не задана/.test(t)) return "price";
  if (/дат[аы] тз|шаблон/.test(t)) return "date";
  if (/состав|количество не задано|нет лотов/.test(t)) return "composition";
  return "other";
}

const TAB_OF: Record<VerifyKind, string> = { payment: "payments", prodPayment: "payments", purchase: "purchases", order: "orders", batch: "batches" };

export type TaskItem = { key: string; title: string; sub: string | null; text: string; href: string; actionHref: string };
export type TaskCategory = {
  id: TaskCategoryId;
  count: number;
  /** Куда ведёт «все N»: страница, где эти записи правятся. */
  seeAllHref: string;
  items: TaskItem[];
};

/** Раскладка ждущих подтверждения строк: категории со списками (дата, цена, состав, сумма, прочее) и счётчик «готово к подтверждению». */
export function buildTaskCategories(rows: VerifyRow[], perCategory = 6): { lists: TaskCategory[]; ready: number; docRows: number; receiptRows: number } {
  const waiting = rows.filter((r) => !r.verified);
  const by = new Map<TaskCategoryId, { rows: Map<string, TaskItem>; kinds: Map<string, number> }>();
  let docRows = 0, receiptRows = 0;
  for (const r of waiting) {
    const seenHere = new Set<TaskCategoryId>();
    for (const b of r.blockers) {
      const id = classifyBlocker(b.text);
      if (seenHere.has(id)) continue;
      seenHere.add(id);
      if (id === "doc") { docRows++; continue; }
      if (id === "receipt") { receiptRows++; continue; }
      const g = by.get(id) ?? { rows: new Map(), kinds: new Map() };
      g.rows.set(r.key, { key: r.key, title: r.title, sub: r.sub, text: b.text, href: r.href, actionHref: b.href ?? r.href });
      const tab = TAB_OF[r.kind];
      g.kinds.set(tab, (g.kinds.get(tab) ?? 0) + 1);
      by.set(id, g);
    }
  }
  const lists: TaskCategory[] = [];
  for (const id of ["sum", "date", "price", "composition", "other"] as const) {
    const g = by.get(id);
    if (!g) continue;
    const tab = [...g.kinds.entries()].sort((a, b) => b[1] - a[1])[0][0];
    lists.push({ id, count: g.rows.size, seeAllHref: `/verify?tab=${tab}&verified=blocked`, items: [...g.rows.values()].slice(0, perCategory) });
  }
  return { lists, ready: waiting.filter((r) => r.ready).length, docRows, receiptRows };
}
