import Link from "next/link";
import { InfoHint } from "@/components/info-hint";
import { TILE_BOX, TileCaption, TileHead, TileValue } from "@/app/(app)/dashboard/tile";
import { STAGE_STYLES, type Stage } from "@/lib/calendar-actions";
import { formatQty, formatShare } from "@/lib/utils";

// Общие мелкие элементы оформления календаря (по docs/ui-style-guide.md): сегменты, кнопки, плитки-итоги.

/** Кнопка-ссылка в акцентном стиле (оранжевая рамка при наведении). */
export const BTN = "btn btn-accent inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-50 max-md:min-h-10";
export const BTN_ICON = "btn btn-accent inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-300 bg-white text-sm text-neutral-700 hover:bg-neutral-50 max-md:min-h-10 max-md:w-10";
/** Поля форм календаря: рамка акцентного цвета при наведении и фокусе. */
export const FIELD = "ui-field h-10 rounded-lg text-xs";

export type SegItem = { key: string; label: string; href: string; on: boolean; title?: string };

/** Сегмент-переключатель режимов (ссылки): активный — акцентный (bg-neutral-900), остальные белые. */
export function Segment({ label, items }: { label: string; items: SegItem[] }) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-lg border border-neutral-300 text-xs">
      {items.map((it, i) => (
        <Link key={it.key} href={it.href} title={it.title} aria-current={it.on ? "page" : undefined}
          className={`inline-flex h-8 items-center whitespace-nowrap px-3 font-medium max-md:min-h-10 ${i > 0 ? "border-l border-neutral-300" : ""} ${it.on ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50"}`}>
          {it.label}
        </Link>
      ))}
    </div>
  );
}

/** Подпись над группой сегментов (мини-подпись 10px, как у полей фильтров). */
export function MiniLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{children}</span>;
}

const STAGE_TILES: Stage[] = ["plan", "raw", "work", "ready", "shipped"];
/** Плитки на экране: «Сырьё» и «Отгружено» вынесены во вторую строку плитки «В выпуске» (в сумму входят по-прежнему). */
const SHOWN_TILES: Stage[] = ["plan", "work", "ready"];

/**
 * Плитки-итоги календаря (внутри WidgetRow): «Произведено» (ремонт отдельно), стадии, «Просрочено».
 * Числа приходят готовыми из calendar-table / calendar-pipeline — здесь только оформление.
 */
export function SummaryTiles({ grand, overdue, overdueEvents, stageHref, activeStage, period }: {
  grand: Record<Stage, number>;
  overdue: number;
  /** Просроченные события календаря (только в «Детально»). */
  overdueEvents?: number;
  stageHref: (k: Stage) => string;
  activeStage: string[];
  /** Плитка «События» за месяц/неделю — только в «Детально». */
  period?: { label: string; total: number; count: number };
}) {
  const prod = STAGE_TILES.reduce((a, k) => a + grand[k], 0);
  const num = (v: number) => (v > 0 ? formatQty(v) : "—");
  const cols = period ? "xl:grid-cols-6" : "xl:grid-cols-5";
  return (
    <div className={`grid grid-cols-1 items-stretch gap-3 md:grid-cols-4 ${cols} print:grid-cols-4`}>
      {period && (
        <div className={TILE_BOX}>
          <TileHead>События · {period.label}</TileHead>
          <TileValue>{num(period.total)}{period.total > 0 && <span className="ml-1 text-xs font-normal text-neutral-500">шт.</span>}</TileValue>
          <TileCaption>{period.count > 0 ? `событий: ${formatQty(period.count)}` : null}</TileCaption>
        </div>
      )}
      <div className={TILE_BOX}>
        <TileHead>В выпуске</TileHead>
        <div className="absolute right-3 top-3">
          <InfoHint label="Что такое «В выпуске»" wide>
            <p>Все изделия ТЗ без отменённых и без ремонта (как «В выпуске» на Главной за тот же год): готово + в работе. Ремонт считается отдельно и сюда не входит; в режиме «Стадии» итог «Всего с ремонтом» больше на число изделий в ремонте.</p>
            <p className="mt-1">Стадии справа: план → сырьё (мех закуплен и списан) → в работе (раскрой / пошив) → готово (на складе) → отгружено. Нажмите стадию — таблицы отфильтруются по ней.</p>
            <p className="mt-1">Число изделий — в штуках; количество шкур в данных ТЗ отдельно не хранится.</p>
          </InfoHint>
        </div>
        <TileValue>{num(prod)}{prod > 0 && <span className="ml-1 text-xs font-normal text-neutral-500">шт.</span>}</TileValue>
        <TileCaption>
          {grand.raw > 0 || grand.shipped > 0 ? <span title={`${STAGE_STYLES.raw.hint}; ${STAGE_STYLES.shipped.hint.toLowerCase()}`}>{[grand.raw > 0 ? `сырьё ${formatQty(grand.raw)}` : "", grand.shipped > 0 ? `отгружено ${formatQty(grand.shipped)}` : ""].filter(Boolean).join(" · ")}</span> : null}
          {grand.repair > 0 ? <span className="block text-rose-700">ремонт отдельно: {formatQty(grand.repair)} шт.</span> : null}
        </TileCaption>
      </div>
      {SHOWN_TILES.map((k) => {
        const st = STAGE_STYLES[k];
        const on = activeStage.length === 1 && activeStage[0] === k;
        return (
          <Link key={k} href={stageHref(k)} title={st.hint} aria-current={on ? "true" : undefined} className={TILE_BOX + " tile-click"} style={on ? { borderColor: "var(--ui-accent)" } : undefined}>
            <TileHead><i className={`mt-1 size-2 shrink-0 rounded-full ${st.dot}`} aria-hidden />{st.label}</TileHead>
            <TileValue>{num(grand[k])}{grand[k] > 0 && <span className="ml-1 text-xs font-normal text-neutral-500">шт.</span>}</TileValue>
            <TileCaption>{prod > 0 && grand[k] > 0 ? `${formatShare(grand[k] / prod)} от выпуска` : null}</TileCaption>
          </Link>
        );
      })}
      <div className={TILE_BOX}>
        <TileHead>Просрочено</TileHead>
        <TileValue className={overdue > 0 ? "text-red-700" : ""}>{overdue > 0 ? formatQty(overdue) : "—"}{overdue > 0 && <span className="ml-1 text-xs font-normal text-neutral-500">ТЗ</span>}</TileValue>
        <TileCaption>{overdueEvents != null && overdueEvents > 0 ? `событий: ${formatQty(overdueEvents)}` : null}</TileCaption>
      </div>
    </div>
  );
}
