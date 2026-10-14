import Link from "next/link";
import type { ReactNode } from "react";
import { WidgetRow } from "@/components/widget-row";
import { InfoHint } from "@/components/info-hint";
import { TILE_BOX, TileHead, TileValue, TileCaption } from "../dashboard/tile";

/** Плитка-итог страницы раздела «ТЗ»: подпись, крупная цифра (нет значения — «—»), мелкая строка; href — плитка-ссылка с оранжевой рамкой. */
export type SummaryTile = {
  key: string;
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  href?: string;
  hint?: ReactNode;
  /** Цвет цифры (например, text-red-700 для просрочки). */
  tone?: string;
};

/**
 * Ряд плиток-итогов страницы в стиле Главной: WidgetRow, «→ Раздел» над «Свернуть/Закрепить», равные плитки сеткой.
 * Данные приходят готовыми со страницы — здесь только оформление.
 */
export function SummaryTiles({ id, title, linkHref, linkLabel, tiles, collapseWith }: { collapseWith?: ReactNode; id: string; title: string; linkHref?: string; linkLabel?: string; tiles: SummaryTile[] }) {
  const cols = tiles.length >= 5 ? "md:grid-cols-3 xl:grid-cols-5" : tiles.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3";
  return (
    <WidgetRow
      id={id}
      title={title}
      collapseWith={collapseWith}
      headerEnd={linkHref ? <Link href={linkHref} className="text-xs text-blue-700 hover:underline print:hidden">{linkLabel ?? "→ Раздел"}</Link> : undefined}
    >
      <div className={"grid grid-cols-1 items-stretch gap-3 print:grid-cols-4 " + cols}>
        {tiles.map((t) => {
          const body = (
            <>
              <TileHead>{t.label}</TileHead>
              <TileValue className={t.tone}>{t.value}</TileValue>
              <TileCaption>{t.caption}</TileCaption>
            </>
          );
          return (
            <div key={t.key} className="relative">
              {t.href ? (
                <Link href={t.href} className={TILE_BOX + " tile-click"}>{body}</Link>
              ) : (
                <div className={TILE_BOX}>{body}</div>
              )}
              {t.hint ? (
                <span className="absolute right-3 top-3"><InfoHint label={`Что значит: ${t.label}`}>{t.hint}</InfoHint></span>
              ) : null}
            </div>
          );
        })}
      </div>
    </WidgetRow>
  );
}
