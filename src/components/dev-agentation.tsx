"use client";

import { Agentation } from "agentation";

/** Панель замечаний для Claude: подключается только в dev, в сборку для продакшена не попадает. */
export function DevAgentation() {
  return <Agentation />;
}
