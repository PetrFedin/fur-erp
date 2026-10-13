import { Breadcrumbs } from "@/components/breadcrumbs";
import { InfoHint } from "@/components/info-hint";
import Link from "next/link";
import { ControlTabs } from "@/components/control-tabs";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { MODEL_TITLES } from "@/lib/audit-core";
import { PAGE_SIZE, actorText, fmtAt, historyWhere, parseHistoryFilters, recordHref, type LogRow } from "@/lib/audit-query";
import { ActionBadge, ChangeCell, entityTitle } from "@/components/audit-change";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { FilterBar } from "@/components/filters/filter-bar";

export const metadata = { title: "История" };

export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  const session = await requireSession();
  if (!hasRole(session.user.role, ACCESS.history)) {
    return (
      <div className="flex flex-col gap-3">
        <ControlTabs active="history" />
        <h1 className="text-xl font-semibold">История</h1>
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Нет доступа: журнал изменений читают владелец, администратор и бухгалтер. Ваша роль к нему доступа не имеет.
        </p>
      </div>
    );
  }
  if (!("auditLog" in prisma)) {
    return (
      <div className="flex flex-col gap-3">
        <ControlTabs active="history" />
        <h1 className="text-xl font-semibold">История</h1>
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Журнал ещё не подключён к работающему серверу: после обновления схемы сервер нужно перезапустить.
        </p>
      </div>
    );
  }
  const sp = await searchParams;
  const f = parseHistoryFilters(sp);
  const where = historyWhere(session.user.organizationId, f);
  const [total, rows, actors] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { at: "desc" }, skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE }) as Promise<LogRow[]>,
    prisma.auditLog.groupBy({ by: ["actorId", "actorName", "source"], where: { organizationId: session.user.organizationId } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // В журнале у ТЗ записан внутренний номер («П-2026-0176»); на экране показываем номер ТЗ из документа, а внутренний — в подсказке.
  const orderIds = Array.from(new Set(rows.filter((r) => r.model === "ProductionOrder").map((r) => r.recordId)));
  const woById = new Map((orderIds.length ? await prisma.productionOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, number: true, workOrderNumber: true } }) : []).map((o) => [o.id, o]));
  // Старые записи журнала подписаны внутренним id («Лот cmv06…», «Движение готовой продукции cmv4…») — на экране показываем человеческую подпись.
  const idLabelRows = rows.filter((r) => (r.model === "RawMaterialLot" || r.model === "FinishedGoodsMovement") && /\bc[a-z0-9]{20,}\b/.test(r.label ?? ""));
  const lotIds = idLabelRows.filter((r) => r.model === "RawMaterialLot").map((r) => r.recordId);
  const moveIds = idLabelRows.filter((r) => r.model === "FinishedGoodsMovement").map((r) => r.recordId);
  const lotById = new Map((lotIds.length ? await prisma.rawMaterialLot.findMany({ where: { id: { in: lotIds } }, select: { id: true, lotNumber: true } }) : []).map((l) => [l.id, l.lotNumber]));
  const moveById = new Map((moveIds.length ? await prisma.finishedGoodsMovement.findMany({ where: { id: { in: moveIds } }, select: { id: true, date: true } }) : []).map((m) => [m.id, m.date]));
  const shownLabel = (r: LogRow): { text: string; title?: string } => {
    const o = r.model === "ProductionOrder" ? woById.get(r.recordId) : undefined;
    const wo = o?.workOrderNumber?.trim();
    if (wo) return { text: `ТЗ ${wo}`, title: `внутренний номер ${o!.number}` };
    const idRe = /\s*\bc[a-z0-9]{20,}\b/;
    if (r.model === "RawMaterialLot" && r.label && idRe.test(r.label)) {
      const n = lotById.get(r.recordId);
      return { text: r.label.replace(idRe, n ? ` ${n}` : " без номера").trim() };
    }
    if (r.model === "FinishedGoodsMovement" && r.label && idRe.test(r.label)) {
      const d = moveById.get(r.recordId);
      return { text: d ? `Движение готовой продукции от ${d.toLocaleDateString("ru-RU")}` : "Движение готовой продукции" };
    }
    return { text: r.label ?? r.recordId };
  };

  const actorOptions = new Map<string, string>();
  for (const a of actors) {
    if (a.actorId) actorOptions.set(a.actorId, a.actorName ?? a.actorId);
    else actorOptions.set(`src:${a.source}`, a.source);
  }

  // Ссылки сохраняют все фильтры (мультивыбор — повтором параметра); смена страницы их не сбрасывает.
  const qs = (over: { page?: number }) => {
    const p = new URLSearchParams();
    if (f.from) p.set("from", f.from);
    if (f.to) p.set("to", f.to);
    for (const [k, vals] of [["actor", f.actor], ["model", f.model], ["action", f.action]] as const) for (const v of vals) p.append(k, v);
    if (f.q) p.set("q", f.q);
    if (over.page && over.page > 1) p.set("page", String(over.page));
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const exportQs = qs({});

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Контроль", href: "/attention" }, { label: "История" }]} />
      <ControlTabs active="history" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">История</h1>
          <div className="text-sm text-neutral-500">
            Записей: {total}
            <InfoHint label="О журнале">
              <p>Журнал всегда полный: общий год из шапки здесь не применяется.</p>
            </InfoHint>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/history/comments" className={buttonVariants({ variant: "outline" })} title="Замечания, ошибки и идеи к частям проекта — для доработки">
            Комментарии
          </Link>
          <a href={`/history/export${exportQs}`} className={buttonVariants({ variant: "outline" })}>
            Экспорт CSV
          </a>
        </div>
      </div>

      <FilterBar
        title="Фильтры журнала"
        oneRow
        hideChips
        className="print:hidden"
        controls={[
          { type: "text", name: "q", label: "Поиск", aliases: ["dq"], placeholder: "З-2026-0014, ТЗ 19, id…" },
          { type: "multi", name: "actor", label: "Кто", options: [...actorOptions].map(([value, label]) => ({ value, label })), allLabel: "Все" },
          { type: "multi", name: "model", label: "Что", options: Object.entries(MODEL_TITLES).map(([value, label]) => ({ value, label })), allLabel: "Всё" },
          { type: "multi", name: "action", label: "Действие", more: true, options: [{ value: "create", label: "Создано" }, { value: "update", label: "Изменено" }, { value: "delete", label: "Удалено" }], allLabel: "Любое" },
          { type: "date", name: "from", label: "С даты" },
          { type: "date", name: "to", label: "По дату" },
        ]}
      />

      <Table>
        <Thead>
          <Tr>
            <Th>Когда</Th>
            <Th>Кто</Th>
            <Th>Что</Th>
            <Th>Действие</Th>
            <Th>Изменение</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={5} className="py-6 text-center text-neutral-500">
                Записей нет. Журнал ведётся с момента его включения.
              </Td>
            </Tr>
          )}
          {rows.map((r) => {
            const href = r.action === "delete" ? null : recordHref(r.model, r.recordId, r.label);
            const shown = shownLabel(r);
            return (
              <Tr key={r.id} className="align-top">
                <Td className="whitespace-nowrap text-xs">{fmtAt(r.at)}</Td>
                <Td className="text-xs">{actorText(r)}</Td>
                <Td className="text-xs">
                  <div className="text-neutral-500">{entityTitle(r.model)}</div>
                  {href ? (
                    <Link href={href} className="text-blue-700 hover:underline" title={shown.title}>
                      {shown.text}
                    </Link>
                  ) : (
                    <span title={shown.title}>{shown.text}</span>
                  )}
                </Td>
                <Td>
                  <ActionBadge action={r.action} />
                </Td>
                <Td>
                  <ChangeCell row={r} />
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>

      <div className="flex items-center justify-between text-sm">
        <span className="text-neutral-500">
          Страница {f.page} из {pages}
        </span>
        <div className="flex gap-2">
          {f.page > 1 && (
            <Link href={`/history${qs({ page: f.page - 1 })}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              ← Новее
            </Link>
          )}
          {f.page < pages && (
            <Link href={`/history${qs({ page: f.page + 1 })}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Старше →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
