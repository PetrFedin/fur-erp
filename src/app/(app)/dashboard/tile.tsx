import { formatShare } from "@/lib/utils";
import type { ReactNode } from "react";

// Общая вертикальная раскладка плиток Сводки: заголовок, крупная цифра, подпись и список стоят на одном уровне у всех плиток ряда.
// Высоты заголовка (2 строки) и подписи (2 строки) зарезервированы — многострочный текст не сдвигает соседние плитки.

export const TILE_BOX = "tile-box relative flex h-full flex-col rounded-lg border border-neutral-200 bg-white p-4 text-left print:break-inside-avoid";

export function TileHead({ children }: { children: ReactNode }) {
  return <div data-comment-title className="flex min-h-5 items-start gap-1.5 pr-6 text-xs font-semibold uppercase leading-4 tracking-wide text-neutral-500">{children}</div>;
}

export function TileValue({ children, className = "", compact = false }: { children: ReactNode; className?: string; /** Узкая плитка (ряд из шести): цифра text-base с подписью «Сумма», как в плитках сырья. */ compact?: boolean }) {
  if (compact) {
    // Пустая строка высотой с «Количество» в плитках сырья: суммы ₽ сырья и оплат стоят на одной горизонтали.
    return (
      <div>
        <div aria-hidden className="h-[60px]" />
        <div className="min-h-4 text-[11px] leading-4 text-neutral-500">Сумма</div>
        <div className={"min-h-6 whitespace-nowrap text-base font-semibold leading-6 tabular-nums " + className}>{children}</div>
      </div>
    );
  }
  return <div className={"mt-1 flex min-h-7 items-center text-xl font-semibold leading-7 tabular-nums " + className}>{children}</div>;
}

export function TileCaption({ children }: { children?: ReactNode }) {
  return <div className="mt-0.5 min-h-5 text-xs leading-4 text-neutral-500">{children}</div>;
}

export type TileItem = {
  k: ReactNode;
  v: ReactNode;
  /** Доля от суммы плитки (0–1): серым мелким рядом с цифрой. */
  share?: number | null;
  /** Вложенная строка: отступ и серый мелкий шрифт. */
  sub?: boolean;
  tone?: string;
};

const pct = (s: number) => formatShare(s);

/** Список «статья — сумма — доля %» под крупной цифрой плитки (как в плитках Оплат на Главной). */
export function TileList({ items, stack = false }: { items: TileItem[]; /** Узкая плитка (ряд из шести): подпись над цифрой, а не в одну строку. */ stack?: boolean }) {
  if (stack) {
    return (
      <dl className="mt-2 space-y-1 text-xs">
        {items.map((x, i) => (
          <div key={i}>
            <dt className="min-h-4 whitespace-nowrap text-[11px] leading-4 text-neutral-500">{x.k}</dt>
            <dd className={"whitespace-nowrap text-sm font-medium leading-5 tabular-nums " + (x.tone ?? "")}>
              {x.v}
              {x.share != null && Number.isFinite(x.share) ? <span className="ml-1.5 text-[11px] font-normal text-neutral-400">{pct(x.share)}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className="mt-2 space-y-0.5 text-xs">
      {items.map((x, i) => (
        <div key={i} className={"flex justify-between gap-3" + (x.sub ? " pl-3 text-xs" : "")}>
          <dt className={x.sub ? "text-neutral-500" : "font-medium text-neutral-700"}>{x.k}</dt>
          <dd className={"whitespace-nowrap text-right tabular-nums " + (x.sub ? "text-neutral-600 " : "font-medium ") + (x.tone ?? "")}>
            {x.v}
            {x.share != null && Number.isFinite(x.share) ? <span className="ml-1.5 text-[11px] font-normal text-neutral-400">{pct(x.share)}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
