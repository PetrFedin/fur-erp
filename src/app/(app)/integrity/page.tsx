import { Breadcrumbs } from "@/components/breadcrumbs";
import Link from "next/link";
import { WidgetRow } from "@/components/widget-row";
import { ControlTabs } from "@/components/control-tabs";
import { requireSession } from "@/lib/session";
import { getIntegrityReport } from "@/lib/integrity";
import { fmtNum } from "@/lib/integrity/checks";
import { InfoHint } from "@/components/info-hint";
import { cn } from "@/lib/utils";
import type { CheckResult } from "@/lib/integrity/types";
import { RecheckButton } from "./recheck-button";
import { TILE_BOX, TileHead, TileValue } from "@/app/(app)/dashboard/tile";

export const metadata = { title: "Проверка данных" };
export const dynamic = "force-dynamic";

function tone(c: CheckResult) {
  if (c.status === "ok") return { dot: "bg-emerald-500", label: "сходится", cls: "text-emerald-700" };
  if (c.status === "known") return { dot: "bg-neutral-400", label: "известно", cls: "text-neutral-600" };
  if (c.severity === "error") return { dot: "bg-red-600", label: "не сходится", cls: "text-red-700" };
  if (c.severity === "warn") return { dot: "bg-amber-500", label: "внимание", cls: "text-amber-700" };
  return { dot: "bg-neutral-400", label: "справочно", cls: "text-neutral-600" };
}

/** Величина расхождения по проверке: сумма разниц в ₽ либо число записей. */
function magnitude(c: CheckResult) {
  const list = c.violations.length ? c.violations : c.known;
  if (!list.length) return "—";
  const rub = list.filter((v) => v.unit === "₽" && v.delta != null).reduce((s, v) => s + Math.abs(v.delta!), 0);
  return rub > 0 ? `всего ${fmtNum(Math.round(rub * 100) / 100)} ₽ · ${list.length} зап.` : `${list.length} зап.`;
}

export default async function IntegrityPage() {
  const session = await requireSession();
  const r = await getIntegrityReport(session.user.organizationId);
  // По умолчанию — только то, что не сходится; сошедшиеся проверки свёрнуты в одну строку.
  const attention = r ? r.results.filter((c) => c.status !== "ok") : [];
  const okChecks = r ? r.results.filter((c) => c.status === "ok") : [];
  const groups = [...new Set(attention.map((c) => c.group))];
  return (
    <div className="space-y-4">
      <Breadcrumbs items={[{ label: "Контроль", href: "/attention" }, { label: "Проверка данных" }]} />
      <ControlTabs active="integrity" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold text-neutral-900">Проверка данных</h1><span className="ml-2 align-middle text-sm font-normal">
              <InfoHint wide label="О проверке данных">
                <p>Всё, что сведено (остатки, стоимости, себестоимость, оплаты, долг, подтверждения), пересчитывается из нижних уровней и сравнивается с тем, что записано сверху. Только чтение: ничего не меняется.</p>
                <p className="mt-2">Известные объяснимые расхождения показаны серым с причиной и не считаются ошибкой.</p>
              </InfoHint>
            </span></div>
        </div>
        <div className="flex items-center gap-3">
          {r && <span className="text-xs text-neutral-500">Проверено {new Date(r.checkedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })} · {r.ms} мс</span>}
          <RecheckButton />
        </div>
      </div>
      {!r && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">Проверка не выполнилась (подробности в логе сервера). Нажмите «Проверить сейчас».</div>}
      {r && (
        <>
          <WidgetRow id="integrity" title="Проверка данных — итоги">
          <div className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {[
              { k: "Ошибок", v: r.failingErrors, tone: r.failingErrors ? "text-red-700" : "text-emerald-700" },
              { k: "Предупреждений", v: r.failingWarns, tone: r.failingWarns ? "text-amber-700" : "text-emerald-700" },
              { k: "Объяснённых", v: r.knownCount, tone: "" },
              { k: "К сведению", v: r.failingInfo, tone: "" },
              { k: "Проверок", v: r.checksTotal, tone: "" },
            ].map((c) => (
              <div key={c.k} className={TILE_BOX + " shadow-sm print:shadow-none"}>
                <TileHead>{c.k}</TileHead>
                <TileValue className={c.tone}>{c.v}</TileValue>
              </div>
            ))}
          </div>
          </WidgetRow>
          {groups.map((g) => (
            <section key={g} className="space-y-1.5">
              <h2 className="text-base font-semibold">{g}</h2>
              <div className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
                {attention.filter((c) => c.group === g).map((c) => {
                  const t = tone(c);
                  const open = c.status === "fail";
                  return (
                    <details key={c.id} open={open} className="group px-3 py-2">
                      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
                        <span className={cn("size-2.5 shrink-0 rounded-full", t.dot)} aria-hidden />
                        <span className="min-w-0 flex-1 text-sm font-medium text-neutral-900">{c.title}</span>
                        <span className={cn("text-xs font-medium", t.cls)}>{t.label}</span>
                        <span className="text-xs tabular-nums text-neutral-600">{magnitude(c)}</span>
                        <span className="text-xs text-neutral-500">проверено записей: {c.checked}</span>
                      </summary>
                      <div className="mt-2 space-y-2 pl-5 text-sm text-neutral-700">
                        <div className="text-xs text-neutral-500">
                          <InfoHint wide label="Что проверяется и где исправлять">
                            <p>{c.what}</p>
                            <p className="mt-1"><b>Допуск:</b> {c.tolerance}.</p>
                            <p className="mt-1"><b>Где исправлять:</b> {c.fix}</p>
                          </InfoHint>
                          <span className="ml-1">что проверяется и где исправлять</span>
                        </div>
                        {c.error && <p className="text-red-700">Проверка не выполнилась: {c.error}</p>}
                        {c.violations.length > 0 && (
                          <ul className="space-y-1">
                            {c.violations.slice(0, 25).map((v) => (
                              <li key={v.key} className="flex flex-wrap items-baseline gap-x-2">
                                <span>{v.message}</span>
                                {v.delta != null && <b className="tabular-nums">разница {fmtNum(v.delta)} {v.unit}</b>}
                                <Link href={v.href} className="text-blue-700 hover:underline">{v.entity.label}</Link>
                              </li>
                            ))}
                            {c.violations.length > 25 && <li className="text-xs text-neutral-500">…и ещё {c.violations.length - 25}</li>}
                          </ul>
                        )}
                        {c.known.length > 0 && (
                          <div className="rounded-md bg-neutral-50 p-2 text-xs text-neutral-600">
                            <div className="font-medium">Известно: {c.known[0].reason}</div>
                            <div className="mt-0.5 text-neutral-500">Решение: {c.known[0].decision}</div>
                            <ul className="mt-1 space-y-0.5">
                              {c.known.slice(0, 15).map((v) => (
                                <li key={v.key}>{v.message} <Link href={v.href} className="text-blue-700 hover:underline">{v.entity.label}</Link></li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            </section>
          ))}
          {okChecks.length > 0 && (
            <details className="rounded-lg border border-neutral-200 bg-white">
              <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-neutral-50">Сходится: {okChecks.length} проверок</summary>
              <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
                {okChecks.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 px-3 py-1.5 text-sm">
                    <span className="size-2.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                    <span className="min-w-0 flex-1 text-neutral-800">{c.title}</span>
                    <span className="text-xs text-neutral-500">записей: {c.checked}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
