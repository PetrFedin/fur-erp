// ЕДИНЫЙ словарь подписей «себестоимость» и «выпуск» (docs/terms-glossary.md). Только подписи на экране — расчёты не здесь.
//   • Себестоимость сырья = мех + подкладка (+ шкуры подрядчика) + 4 % (режим «С 4%») + расходы ТЗ. БЕЗ работы подрядчика.
//   • Полная себестоимость = себестоимость сырья + работа подрядчика (как плитка «Себестоимость» на Главной).
export const COST_RAW_LABEL = "Себестоимость сырья";
export const COST_FULL_LABEL = "Полная себестоимость";
export const COST_RAW_HINT = "Мех + подкладка + расходы ТЗ; в режиме «С 4%» — и надбавка 4% к сырью. Работа подрядчика не входит.";
export const COST_FULL_HINT = "Себестоимость сырья (мех + подкладка + 4% + расходы ТЗ) плюс работа подрядчика.";
/** «Себестоимость сырья (с 4 %)» / «(без 4 %)»; без режима — просто «Себестоимость сырья». */
export const costRawLabel = (c4?: "on" | "off" | boolean | null) =>
  c4 == null ? COST_RAW_LABEL : `${COST_RAW_LABEL} (${c4 === true || c4 === "on" ? "с 4 %" : "без 4 %"})`;

export const OUTPUT_LABEL = "В выпуске";
/** Подсказка «i»: что входит в «В выпуске». */
export const outputHint = (done: number, inWork: number, fmt: (v: number) => string = String) =>
  `В выпуске ${fmt(done + inWork)} шт. = готово ${fmt(done)} шт. (завершённые ТЗ) + в работе ${fmt(inWork)} шт. (план ТЗ «В работе» и «Запланировано»). Без отменённых и без ремонта.`;

/** ЕДИНОЕ определение: «лот» = полученная партия сырья на складе; «позиция» = строка заказа, по которой лота ещё нет (заказано, не получено). */
export const LOTS_RULE = "Лот — партия сырья, уже полученная на склад. Позиция — строка заказа, по которой лота ещё нет (заказано, не получено); после приёмки она станет лотом.";
/** «лотов 279, позиций заказано 100»; нули не пишем (если нет ничего — «лотов 0»). */
export function lotsText(lots: number, orderedPositions: number): string {
  return [lots > 0 || orderedPositions === 0 ? `лотов ${lots}` : null, orderedPositions > 0 ? `позиций заказано ${orderedPositions}` : null].filter(Boolean).join(", ");
}

/** Строка состава закупки для подсчёта: настоящий лот (получен), заказанное-не-полученное (одна строка = несколько позиций) или шкуры подрядчика (лотов нет). */
export type LotRow = { kind: "lot" | "planned" | "hides"; positions?: number };
/**
 * ЕДИНЫЙ подсчёт «лотов» для всех подписей (шапка источников, плитка вида, окно состава): ни одна подпись не считает строки как лоты.
 *   lots — лоты: партии сырья, уже полученные на склад (LOTS_RULE);
 *   positions — позиции заказа, по которым лота ещё нет (строка «заказано, не получено» содержит несколько позиций);
 *   hidesRows — строки «шкуры подрядчика» (сырьё Веллмех в счетах за пошив): лотов закупки у них нет, в лоты и позиции не входят.
 * Раньше шапка писала «300 лотов» (= 295 лотов + 3 строки заказанного, а это 100 позиций, + 2 строки шкур подрядчика), плитка — «лотов 295, позиций заказано 100».
 */
export function lotCounts(rows: LotRow[]): { lots: number; positions: number; hidesRows: number } {
  let lots = 0, positions = 0, hidesRows = 0;
  for (const r of rows) {
    if (r.kind === "lot") lots += 1;
    else if (r.kind === "planned") positions += r.positions ?? 1;
    else hidesRows += 1;
  }
  return { lots, positions, hidesRows };
}
/** «лотов 295, позиций заказано 100, шкуры подрядчика без лотов»; нули не пишем (нет ничего — «лотов 0»). */
export function lotCountsText(c: { lots: number; positions: number; hidesRows: number }): string {
  const base = lotsText(c.lots, c.positions);
  return c.hidesRows > 0 ? (c.lots === 0 && c.positions === 0 ? "шкуры подрядчика без лотов" : `${base}, шкуры подрядчика без лотов`) : base;
}
