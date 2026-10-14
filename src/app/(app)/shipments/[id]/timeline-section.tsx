"use client";

import type { ReactNode } from "react";
import { FoldHeader, useFold } from "./fold";

/** Раздел «Хронология»: «Свернуть» / «Закрепить» как у виджетов; свёрнутый прячет и кнопку «+ Этап». */
export function TimelineSection({ count, action, children }: { count: number; action: ReactNode; children: ReactNode }) {
  const fold = useFold("timeline");
  return (
    <>
      <FoldHeader title={<>Хронология <span className="font-normal text-neutral-500">({count})</span></>} fold={fold} actions={action} />
      <div className={fold.open ? "flex flex-col gap-2" : "hidden"}>{children}</div>
    </>
  );
}
