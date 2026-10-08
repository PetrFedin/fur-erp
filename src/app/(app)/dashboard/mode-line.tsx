"use client";

import { useVatDisplay } from "@/lib/vat-display";
import { InfoHint } from "@/components/info-hint";

/** Режимы страницы: год, активные фильтры. НДС и 4% берутся из переключателей шапки. */
export type ModeInfo = {
  year: string;
  /** Текст активных фильтров («мех ×1, НДС ×1») либо null, если фильтров нет. */
  filters: string | null;
};

/**
 * Единственная строка режимов на странице — в заголовке: «все годы · с НДС · с 4%».
 * Подробности (что от чего зависит) — в «i», в блоках повторять не нужно.
 */
export function PageModes({ info, c4 }: { info: ModeInfo; c4: "on" | "off" }) {
  const { mode } = useVatDisplay();
  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-x-1.5 text-sm font-normal text-neutral-500" data-testid="mode-line">
      <span>· {info.year} · {mode === "incl" ? "с НДС" : "без НДС"} · {c4 === "on" ? "с 4%" : "без 4%"}</span>
      {info.filters ? <b className="font-medium text-amber-700">· фильтры: {info.filters}</b> : null}
      <InfoHint label="Какие режимы действуют" wide>
        <p><b>Год</b>, <b>цены (с НДС / без НДС)</b> и <b>4% к сырью</b> переключаются в шапке сайта и действуют на всю страницу.</p>
        <p className="mt-1">Блоки «Сырьё» и «Производство», обе таблицы динамики и «Долг заказчиков» зависят от фильтров ниже. Долг и оплаты поставщику (всегда с НДС) и «Задачи» — не зависят от фильтров и от 4%.</p>
        <p className="mt-1">«Таблица по годам» не зависит от года шапки: показывает все годы.</p>
      </InfoHint>
    </span>
  );
}

/** Пояснение «как сходятся цифры» — теперь в значке «i» рядом с заголовком блока, а не абзацем в потоке страницы. */
export function BridgeHint({ label, children, warn = false }: { label: string; children: React.ReactNode; warn?: boolean }) {
  return (
    <InfoHint label={label} wide className={warn ? "[&>button]:border-amber-500 [&>button]:text-amber-700" : undefined}>
      {children}
    </InfoHint>
  );
}
