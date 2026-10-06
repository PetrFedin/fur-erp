import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { MODEL_TITLES } from "@/lib/audit-core";
import { PAGE_SIZE, actorText, fmtAt, historyWhere, parseHistoryFilters, recordHref, type LogRow } from "@/lib/audit-query";
import { ActionBadge, ChangeCell, entityTitle } from "@/components/audit-change";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";

export const metadata = { title: "История изменений" };

export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  const session = await requireSession();
  if (!hasRole(session.user.role, ACCESS.history)) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">История изменений</h1>
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Нет доступа: журнал изменений читают владелец, администратор и бухгалтер. Ваша роль к нему доступа не имеет.
        </p>
      </div>
    );
  }
  if (!("auditLog" in prisma)) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">История изменений</h1>
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

  const actorOptions = new Map<string, string>();
  for (const a of actors) {
    if (a.actorId) actorOptions.set(a.actorId, a.actorName ?? a.actorId);
    else actorOptions.set(`src:${a.source}`, a.source);
  }

  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ from: f.from, to: f.to, actor: f.actor, model: f.model, action: f.action, q: f.q, ...over })) {
      if (v !== "" && v !== undefined && !(k === "page" && Number(v) <= 1)) p.set(k, String(v));
    }
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const exportQs = qs({ page: 1 });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">История изменений</h1>
          <p className="text-sm text-neutral-500">
            Журнал всегда полный: общий год из шапки здесь не применяется. Записей по фильтру: {total}.
          </p>
        </div>
        <a href={`/history/export${exportQs}`} className={buttonVariants({ variant: "outline" })}>
          Экспорт CSV
        </a>
      </div>

      <form method="get" action="/history" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          С даты
          <Input type="date" name="from" defaultValue={f.from} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          По дату
          <Input type="date" name="to" defaultValue={f.to} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Кто
          <Select name="actor" defaultValue={f.actor}>
            <option value="">все</option>
            {[...actorOptions].map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Что
          <Select name="model" defaultValue={f.model}>
            <option value="">всё</option>
            {Object.entries(MODEL_TITLES).map(([k, t]) => (
              <option key={k} value={k}>
                {t}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Действие
          <Select name="action" defaultValue={f.action}>
            <option value="">любое</option>
            <option value="create">создано</option>
            <option value="update">изменено</option>
            <option value="delete">удалено</option>
          </Select>
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs text-neutral-500 sm:col-span-1">
          Поиск (номер, название, id)
          <Input type="search" name="q" defaultValue={f.q} placeholder="З-2026-0014, ТЗ 19…" />
        </label>
        <div className="flex items-end gap-2">
          <Button type="submit">Найти</Button>
          <Link href="/history" className={buttonVariants({ variant: "ghost" })}>
            Сбросить
          </Link>
        </div>
      </form>

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
            return (
              <Tr key={r.id} className="align-top">
                <Td className="whitespace-nowrap text-xs">{fmtAt(r.at)}</Td>
                <Td className="text-xs">{actorText(r)}</Td>
                <Td className="text-xs">
                  <div className="text-neutral-400">{entityTitle(r.model)}</div>
                  {href ? (
                    <Link href={href} className="text-blue-700 hover:underline">
                      {r.label ?? r.recordId}
                    </Link>
                  ) : (
                    <span>{r.label ?? r.recordId}</span>
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
