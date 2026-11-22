import type { ReactNode } from "react";
import { TILE_BOX, TileHead } from "@/app/(app)/dashboard/tile";
import { InfoHint } from "@/components/info-hint";

/**
 * Единая полоса итогов уровня раздела «Сырьё» (аукцион, счёт, лот, вид меха): одни и те же пять чисел на каждом уровне —
 * куплено → использовано → остаток → оплачено → долг. Под суммой — количество, ₽ за единицу и $ за единицу (если есть цена в долларах).
 * Суммы приходят готовыми в обоих вариантах НДС (компонент Money) и режиме 4 % — здесь только раскладка.
 */
export type LevelTile = {
  key: string;
  title: string;
  hint?: ReactNode;
  /** Главная сумма (обычно <Money …/>). */
  main: ReactNode;
  /** Строки под суммой: подпись + значение. */
  lines?: { k: string; v: ReactNode }[];
  /** Подсвечивает сумму (долг к оплате). */
  tone?: "warn" | "ok";
};

export function LevelSummary({ tiles, label = "Итоги" }: { tiles: LevelTile[]; label?: string }) {
  return (
    <section aria-label={label} data-testid="level-summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.key} className={TILE_BOX + " relative"}>
          <TileHead>{t.title}</TileHead>
          {t.hint ? <span className="absolute right-3 top-3"><InfoHint label={t.title} align="right">{t.hint}</InfoHint></span> : null}
          <div className={"mt-1 flex min-h-7 items-center text-xl font-semibold leading-7 tabular-nums " + (t.tone === "warn" ? "text-amber-700" : t.tone === "ok" ? "text-emerald-700" : "")}>{t.main}</div>
          <dl className="mt-1 space-y-0.5 text-xs text-neutral-600">
            {(t.lines ?? []).map((l) => (
              <div key={l.k} className="flex items-baseline justify-between gap-2">
                <dt className="text-neutral-500">{l.k}</dt>
                <dd className="tabular-nums">{l.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
}
