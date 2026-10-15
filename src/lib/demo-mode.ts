/**
 * Демо-режим (стенд для внешних тестировщиков: render.yaml, DEMO_BUILD=true).
 *
 * Реальные реквизиты, фамилии и тексты, зашитые в исходный код, в демо-сборку попасть не должны. Это закрыто в ДВА слоя:
 *  1) на сборке: scripts/demo-static-data.mjs (запускается в Dockerfile при DEMO_BUILD=true) подменяет реальные значения в src/
 *     вымышленными, обезличивает Word-шаблоны ТЗ и пресеты расчётов (таблица подмен — scripts/demo-sanitize.mjs); поэтому в .next
 *     реальных строк нет вообще;
 *  2) в работе: isDemoBuild() — единое место, где код узнаёт, что он в демо (скрыть внешние ссылки на реальные файлы и т.п.).
 * Боевой режим (без DEMO_BUILD) ничем не затрагивается.
 */

/** Демо-сборка? Сервер читает DEMO_BUILD, клиент — NEXT_PUBLIC_DEMO_BUILD (в Dockerfile задаётся вместе). */
export function isDemoBuild(): boolean {
  return process.env.DEMO_BUILD === "true" || process.env.NEXT_PUBLIC_DEMO_BUILD === "true";
}

/** Вымышленные значения демо (ИНН Веллмех-демо совпадает с тем, что make-demo-db пишет в демо-базу). */
export const DEMO_VALUES = {
  contractor: "ООО «Демо-Подрядчик»",
  customer: "ООО «Демо-Заказчик»",
  contractorInn: "7701000000",
  signerCustomer: "Иванов И. И.",
  signerContractor: "Петров П. П.",
  address: "г. Город, ул. Демо, 1",
} as const;

/** В демо — вымышленное значение, в боевом режиме — настоящее. */
export const demoOr = <T,>(real: T, demo: T): T => (isDemoBuild() ? demo : real);
