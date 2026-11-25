import Link from "next/link";
import { registryCoverage, type RegStat } from "@/lib/registry-coverage";
import { formatDate, formatMoney, formatPercent } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { cn } from "@/lib/utils";
import { TILE_BOX, TileHead } from "@/app/(app)/dashboard/tile";
import { barTone, pctTone } from "./tones";

// ------------------------------------------------------------------ реестр

const fmtPct = (p: number) => formatPercent(p);
const regDate = (iso: string) => formatDate(new Date(iso));

function RegStatTile({ s }: { s: RegStat }) {
  return (
    <div className={TILE_BOX + " shadow-sm print:shadow-none"} title={s.what}>
      <TileHead>{s.label}</TileHead>
      <div className={cn("mt-1 text-2xl font-semibold leading-9 tabular-nums", pctTone(s.percent))}>{fmtPct(s.percent)}</div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div className={cn("h-full rounded-full", barTone(s.percent))} style={{ width: `${s.percent}%` }} />
      </div>
      <div className="mt-1 text-xs text-neutral-500">{s.have}</div>
    </div>
  );
}

export function RegistryBlock() {
  const r = registryCoverage;
  return (
    <details aria-label="Покрытие реестром" className="group rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="flex items-center gap-2 block-title">
          Покрытие реестром
          <InfoHint wide label="Что такое покрытие реестром и как обновить сверку">
            <div className="space-y-2">
              <p>Сколько записей единого реестра (xlsx) нашлось в базе: лоты, остатки, закупки, ТЗ, оплаты. Сверка от {regDate(r.checkedAt)} (реестр — от {regDate(r.registryDate)}).</p>
              <p><b>Как обновить сверку.</b> Сверка делается вне приложения: реестр из таблицы сравнивается с базой. После новой сверки попросите разработчика обновить данные этой страницы.</p>
              <p>Обновление не меняет данные в базе.</p>
            </div>
          </InfoHint>
        </h2>
        <span className="text-xs text-neutral-500">сверка от {regDate(r.checkedAt)} · в реестре, но не в базе: {r.registryOnly.length} · <span className="text-blue-700">показать ›</span></span>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
      <div className="grid grid-cols-2 max-sm:grid-cols-2! gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {r.coverage.map((s) => (
          <RegStatTile key={s.key} s={s} />
        ))}
      </div>
      <h3 className="text-sm font-medium">Обратное покрытие: что из базы подтверждено реестром</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {r.backCoverage.map((s) => (
          <RegStatTile key={s.key} s={s} />
        ))}
      </div>

      <h3 className="text-sm font-medium">Есть в реестре, но нет в базе ({r.registryOnly.length})</h3>
      <ul className="flex flex-col gap-2">
        {r.registryOnly.map((it, i) => (
          <li key={i} className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm">
            <div className="break-words font-medium text-neutral-900">{it.title}</div>
            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-neutral-600">
              {it.qty !== null ? <span>{it.qty} шт</span> : null}
              {it.amount !== null ? <span className="tabular-nums">{formatMoney(String(it.amount))}</span> : null}
              <span>
                лист «{it.sheet}», {it.rows.includes("–") || it.rows.includes(",") ? "строки" : "строка"} {it.rows}
              </span>
              {it.note ? <span className="text-amber-700">{it.note}</span> : null}
              {it.kind === "purchase" ? (
                <Link href="/purchases/batch" className="underline hover:text-neutral-900">
                  Как добавить
                </Link>
              ) : (
                <Link href="/purchases?q=%D0%97-2026-0058" className="underline hover:text-neutral-900">
                  Открыть закупку
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-2 text-xs text-neutral-500">
        Как добавить недостающие записи
        <InfoHint wide label="Как добавить запись из реестра">
          «Как добавить»: откройте «Закупки → Новая закупка», внесите поставщика, лоты и сумму по строкам реестра;  Если закупка не ваша — отметьте строки отчёта у владельца как «не наша».
        </InfoHint>
      </p>
      </div>
    </details>
  );
}
