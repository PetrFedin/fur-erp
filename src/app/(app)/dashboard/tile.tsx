import type { ReactNode } from "react";

// Общая вертикальная раскладка плиток Сводки: заголовок, крупная цифра, подпись и список стоят на одном уровне у всех плиток ряда.
// Высоты заголовка (2 строки) и подписи (2 строки) зарезервированы — многострочный текст не сдвигает соседние плитки.

export const TILE_BOX = "relative flex h-full flex-col rounded-lg border border-neutral-200 bg-white p-4 text-left print:break-inside-avoid";

export function TileHead({ children }: { children: ReactNode }) {
  return <div data-comment-title className="flex min-h-8 items-start gap-1.5 pr-6 text-xs font-semibold uppercase leading-4 tracking-wide text-neutral-500">{children}</div>;
}

export function TileValue({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={"mt-1 flex min-h-9 items-center text-2xl font-semibold leading-9 tabular-nums " + className}>{children}</div>;
}

export function TileCaption({ children }: { children?: ReactNode }) {
  return <div className="mt-1 min-h-8 text-xs leading-4 text-neutral-500">{children}</div>;
}
