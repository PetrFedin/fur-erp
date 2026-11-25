import Link from "next/link";
import { type SectionStat } from "@/lib/doc-coverage";
import { formatPercent } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { cn } from "@/lib/utils";
import { TILE_BOX, TileHead } from "@/app/(app)/dashboard/tile";
import { barTone, pctTone } from "./tones";

export function SummaryTile({ title, stat, href, strong }: { title: string; stat: SectionStat; href: string; strong?: boolean }) {
  return (
    <Link
      href={href}
      title="Показать записи этого раздела с пробелами"
      className={cn(TILE_BOX, "shadow-sm tile-click print:shadow-none", strong && "border-neutral-400")}
    >
      <TileHead>{title}</TileHead>
      <div className={cn("mt-1 text-2xl font-semibold leading-9 tabular-nums", pctTone(stat.percent))}>{stat.percent === null ? "–" : formatPercent(stat.percent)}</div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div className={cn("h-full rounded-full", barTone(stat.percent))} style={{ width: `${stat.percent ?? 0}%` }} />
      </div>
      <div className="mt-1 text-xs text-neutral-500">
        привязано {stat.have} из {stat.required}
      </div>
      <div className={cn("text-xs", stat.rowsWithGaps > 0 ? "text-red-600" : "text-emerald-700")}>
        {stat.rowsWithGaps > 0 ? `не прикреплено: ${stat.rowsWithGaps} из ${stat.rows}` : `без пробелов · ${stat.rows}`}
      </div>
    </Link>
  );
}

export function Legend({ totalGaps }: { totalGaps: number }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
      <span>Всего, записей с пробелами: <b>{totalGaps}</b></span>
      <InfoHint wide label="Условные обозначения таблиц">
        <ul className="space-y-1">
          <li><b className="text-emerald-700">✓ 2</b> — документ есть (сколько штук).</li>
          <li><b className="text-red-600">нет</b> — нужен по правилам, но не приложен.</li>
          <li><b>необяз.</b> — желателен, в пробелы не входит.</li>
          <li><b>не треб.</b> — по правилам не нужен.</li>
          <li>Колонка «Реестр»: <b className="text-emerald-700">✓ лист, строка</b> — запись найдена в едином реестре; <b className="text-red-700">нет в реестре</b>; серое — позже даты реестра; бледно-серое — в реестре не ведётся.</li>
        </ul>
      </InfoHint>
    </p>
  );
}
