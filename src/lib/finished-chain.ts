// ЦЕПОЧКА ГОТОВОЙ ПРОДУКЦИИ (решение владельца 2026-10-20: «готовая отдельно, и она стыкуется с тем, что отгружено, а то, что пришло потом, продаётся»):
//   Произведено (ТЗ, завершённые) → Готовая продукция на складе ателье = Произведено − Отгружено → Отгружено / Принято (приёмка по отгрузкам, ЗИ)
//   → Приход в рознице (выгрузка «поступления») → Продано (нетто) → Остаток в рознице = Приход − Продано.
// Чистые функции без БД: данные собирает finished-chain-server.ts. «Остаток ГП» — НЕ «произведено»: изделия, ушедшие на отгрузку, со склада ателье вычитаются.

export type ChainInput = {
  /** Произведено: выпуск завершённых ТЗ (production-totals.ts, producedUnits); без отменённых и без ремонта. */
  produced: number;
  /** Отгружено со склада ателье: Σ (количество − возвращено) по отгрузкам «Отгружено» и «Принято». */
  shipped: number;
  /** Принято по приёмке (Σ acceptedQty отгрузок «Принято»). */
  accepted: number;
  /** Приход в рознице: Σ строк «поступления» (Delivery PCS) выгрузки. */
  storeReceived: number;
  /** Продано (нетто возвратов). */
  sold: number;
};

export type ChainNote = { code: "shipped-gt-produced" | "accepted-gt-shipped" | "store-ne-accepted" | "sold-gt-received"; text: string };

export type Chain = ChainInput & {
  /** Готовая продукция на складе ателье = Произведено − Отгружено (не меньше нуля; если отгружено больше — флаг). */
  atAtelier: number;
  /** В пути: отгружено, но ещё не принято. */
  inTransit: number;
  /** Остаток в рознице = Приход − Продано. */
  storeStock: number;
  /** Расхождение «Приход в рознице − Принято по отгрузкам»: приход бывает и по другим документам, поэтому только флаг. */
  receivedVsAccepted: number;
  notes: ChainNote[];
};

export function finishedChain(i: ChainInput): Chain {
  const notes: ChainNote[] = [];
  const raw = i.produced - i.shipped;
  if (raw < 0) notes.push({ code: "shipped-gt-produced", text: `отгружено ${i.shipped} шт. больше, чем произведено в завершённых ТЗ (${i.produced} шт.): часть ТЗ не закрыта (статус «в работе») или отгрузка идёт раньше закрытия` });
  if (i.accepted > i.shipped) notes.push({ code: "accepted-gt-shipped", text: `принято ${i.accepted} шт. больше, чем отгружено ${i.shipped} шт.` });
  const diff = i.storeReceived - i.accepted;
  if (diff !== 0) notes.push({ code: "store-ne-accepted", text: `приход в рознице ${i.storeReceived} шт. ≠ принято по отгрузкам ${i.accepted} шт. (разница ${diff > 0 ? "+" : ""}${diff})` });
  if (i.sold > i.storeReceived) notes.push({ code: "sold-gt-received", text: `продано ${i.sold} шт. больше прихода ${i.storeReceived} шт. (приход по старым заказам не в выгрузке)` });
  return { ...i, atAtelier: Math.max(0, raw), inTransit: Math.max(0, i.shipped - i.accepted), storeStock: i.storeReceived - i.sold, receivedVsAccepted: diff, notes };
}

/**
 * Правило закрытия ТЗ по приёмке (предложение, пробный расчёт — запись только по решению владельца): ТЗ в статусе «В работе»/«Запланировано», у которого
 * по принятым отгрузкам принято не меньше планового количества, считается выпущенным: статус «Завершено», выпуск = принято. Кандидат НЕ предлагается, если:
 * принято меньше плана (часть изделий ещё в работе), либо по ТЗ есть возвраты (returnedQty > 0) или открытая доработка — решение владельца.
 */
export type CloseCandidateIn = { number: string; status: string; planned: number; accepted: number; returned: number; shippedNotAccepted: number };
export type CloseVerdict = { number: string; verdict: "close" | "wait" | "skip"; reason: string; produced: number };
export function closeByAcceptance(o: CloseCandidateIn): CloseVerdict {
  if (o.status === "COMPLETED" || o.status === "CANCELLED") return { number: o.number, verdict: "skip", reason: "ТЗ уже завершено/отменено", produced: 0 };
  if (o.accepted <= 0) return { number: o.number, verdict: "skip", reason: "приёмки по ТЗ нет", produced: 0 };
  if (o.returned > 0) return { number: o.number, verdict: "wait", reason: `есть возвраты ${o.returned} шт. — решение владельца`, produced: 0 };
  if (o.accepted < o.planned) return { number: o.number, verdict: "wait", reason: `принято ${o.accepted} из ${o.planned} шт.: ТЗ не закрыто`, produced: 0 };
  return { number: o.number, verdict: "close", reason: `принято ${o.accepted} ≥ плана ${o.planned}${o.shippedNotAccepted > 0 ? `; ещё в пути ${o.shippedNotAccepted} шт.` : ""}`, produced: o.accepted };
}
