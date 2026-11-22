import { Breadcrumbs } from "@/components/breadcrumbs";
import { InfoHint } from "@/components/info-hint";
import Link from "next/link";
import { ControlTabs } from "@/components/control-tabs";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { martFreshForReport } from "@/lib/mart/read";
import { loadMartExpected } from "@/lib/mart/expected";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { approveExpectedAction, rebuildMartAction } from "./actions";

export const metadata = { title: "Данные" };

const STATUS: Record<string, { label: string; cls: string; order: number }> = {
  fail: { label: "не сходится", cls: "bg-red-100 text-red-800", order: 0 },
  warn: { label: "внимание", cls: "bg-amber-100 text-amber-900", order: 1 },
  info: { label: "справка", cls: "bg-neutral-100 text-neutral-700", order: 2 },
  ok: { label: "сходится", cls: "bg-green-100 text-green-800", order: 3 },
};

/** Куда вести по ключу проверки: где это исправляется. */
const FIX: Record<string, { href: string; label: string }> = {
  ordered: { href: "/settings/import", label: "Загрузка данных" },
  received: { href: "/settings/import", label: "Загрузка данных" },
  sold: { href: "/settings/import", label: "Загрузка данных" },
  stock: { href: "/settings/import", label: "Загрузка данных" },
  stockRetail: { href: "/settings/import", label: "Загрузка данных" },
  priceOrphans: { href: "/settings/articles-ref", label: "Справочник артикулов" },
  shipmentOrphans: { href: "/shipments", label: "Отгрузки" },
  movementOrphans: { href: "/settings/import", label: "Загрузка данных" },
  keyDup: { href: "/articles", label: "Изделия" },
  noTz: { href: "/production", label: "Производство" },
  noCostSold: { href: "/production", label: "Производство" },
  noCostStock: { href: "/production", label: "Производство" },
  lotNoPurchase: { href: "/lots", label: "Сырьё" },
  lotQtyBalance: { href: "/lots", label: "Сырьё" },
  purchaseVsLots: { href: "/purchases", label: "Закупки" },
  usageVsMaterial: { href: "/lots", label: "Сырьё" },
  payOverAlloc: { href: "/payments", label: "Оплаты" },
};

const fmt = (v: unknown) => (v == null ? "—" : Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 2 }));
const fmtAt = (d: Date | null | undefined) => (d ? d.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

const MSG: Record<string, string> = {
  rebuild: "Пересборка запущена в фоне. Обновите страницу через минуту.",
  approved: "Эталон утверждён по текущим итогам витрины. Идёт пересборка, проверки обновятся через минуту.",
  "no-data": "Витрины ещё нет: сначала загрузите данные и пересоберите её.",
};

export default async function DataCheckPage({ searchParams }: PageProps<"/data-check">) {
  const session = await requireSession();
  if (!hasRole(session.user.role, ACCESS.dataCheck)) {
    return (
      <div className="flex flex-col gap-3">
        <ControlTabs active="data" />
        <h1 className="text-xl font-semibold">Данные</h1>
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Нет доступа: проверки данных видят владелец и администратор.</p>
      </div>
    );
  }
  const orgId = session.user.organizationId;
  const sp = await searchParams;
  const msg = typeof sp.msg === "string" ? MSG[sp.msg] : undefined;
  const [state, expected, checkRows, loads] = await Promise.all([
    martFreshForReport(orgId),
    loadMartExpected(prisma, orgId),
    prisma.dmCheck.findMany({ where: { organizationId: orgId }, orderBy: { builtAt: "desc" } }),
    prisma.dmLoad.findMany({ where: { organizationId: orgId }, orderBy: { loadedAt: "desc" } }),
  ]);
  const builtAt = checkRows[0]?.builtAt ?? null;
  const checks = checkRows.filter((r) => builtAt && r.builtAt.getTime() === builtAt.getTime()).sort((a, b) => (STATUS[a.status]?.order ?? 9) - (STATUS[b.status]?.order ?? 9));
  const counts = { fail: 0, warn: 0, info: 0, ok: 0 } as Record<string, number>;
  for (const c of checks) counts[c.status] = (counts[c.status] ?? 0) + 1;
  const lastLoadBySource = new Map<string, (typeof loads)[number]>();
  for (const l of loads) if (!lastLoadBySource.has(l.source)) lastLoadBySource.set(l.source, l);
  const stateText = state === "fresh" ? "свежая: построена после последних загрузок" : state === "stale" ? "устарела: после сборки были загрузки" : "не построена (на демо витрина не собирается)";

  return (
    <div className="flex flex-col gap-4">
      <ControlTabs active="data" />
      <Breadcrumbs items={[{ label: "Контроль", href: "/attention" }, { label: "Данные" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          Данные
          <InfoHint>Проверки единой витрины данных: сходятся ли итоги с эталоном, что без пары, чего не хватает. Ничего не пересчитывается на странице — показана последняя сборка.</InfoHint>
        </h1>
        <div className="flex flex-wrap gap-2">
          <form action={rebuildMartAction}><button className={buttonVariants({ variant: "outline", size: "sm" })}>Пересобрать</button></form>
          <form action={approveExpectedAction}><button className={buttonVariants({ variant: "secondary", size: "sm" })} title="Текущие итоги витрины становятся эталоном с сегодняшней датой">Утвердить числа как эталон</button></form>
        </div>
      </div>
      {msg ? <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-800" role="status">{msg}</p> : null}

      <div className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>Собрана: <b>{fmtAt(builtAt)}</b> (мск)</span>
          <span>Состояние: <b>{stateText}</b></span>
          <span>Эталон: <b>{expected.fromData ? `утверждён ${expected.approvedAt ? fmtAt(new Date(expected.approvedAt)) : ""}${expected.approvedBy ? `, ${expected.approvedBy}` : ""}` : "по умолчанию (сезонные блоки отчёта)"}</b></span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {(["fail", "warn", "info", "ok"] as const).map((k) => (
            <span key={k} className={cn("rounded-full px-2 py-0.5 font-medium tabular-nums", STATUS[k].cls)}>{STATUS[k].label}: {counts[k] ?? 0}</span>
          ))}
        </div>
      </div>

      {checks.length === 0 ? (
        <p className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-700">Проверок нет: витрина ещё не собиралась. Загрузите данные и нажмите «Пересобрать».</p>
      ) : (
        <Table>
          <Thead>
            <Tr><Th>Проверка</Th><Th className="text-right">Ожидалось</Th><Th className="text-right">Получилось</Th><Th>Статус</Th><Th>Что делать</Th></Tr>
          </Thead>
          <Tbody>
            {checks.map((c) => {
              const st = STATUS[c.status] ?? STATUS.info;
              const fix = FIX[c.key];
              return (
                <Tr key={c.id}>
                  <Td className="align-top">
                    <div className={c.status === "info" ? "text-neutral-600" : undefined}>{c.label}</div>
                    {c.note ? <div className="mt-0.5 text-xs text-neutral-500">{c.note}</div> : null}
                  </Td>
                  <Td className="text-right align-top tabular-nums">{fmt(c.expected)}</Td>
                  <Td className="text-right align-top tabular-nums">{fmt(c.actual)}</Td>
                  <Td className="align-top"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", st.cls)}>{st.label}</span></Td>
                  <Td className="align-top text-sm">{fix && c.status !== "ok" ? <Link href={fix.href} className="underline">{fix.label}</Link> : <span className="text-neutral-400">—</span>}</Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Загрузки, из которых собрана витрина</h2>
        {lastLoadBySource.size === 0 ? (
          <p className="text-sm text-neutral-600">Записей о загрузках нет.</p>
        ) : (
          <Table>
            <Thead><Tr><Th>Источник</Th><Th>Данные на</Th><Th className="text-right">Строк</Th><Th>Загружено</Th><Th>Примечание</Th></Tr></Thead>
            <Tbody>
              {Array.from(lastLoadBySource.values()).map((l) => (
                <Tr key={l.id}>
                  <Td>{l.source}</Td>
                  <Td>{l.asOf ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{fmt(l.rows)}</Td>
                  <Td>{fmtAt(l.loadedAt)}</Td>
                  <Td className="text-sm text-neutral-600">{l.note ?? ""}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
