import { formatMoney } from "@/lib/utils";
import { ROUND_MIN } from "@/lib/raw-rounding";
import { alignColumn, roundRub } from "@/lib/money-round";
import { DUE_LABEL, dueHint, payNumbers } from "@/lib/pay-display";
import type { YearFilter } from "@/lib/year-filter";
import { InfoHint } from "@/components/info-hint";
import { SupplierDebtHint } from "@/components/supplier-debt-hint";
import type { DashboardData } from "@/lib/dashboard-data";
import { WidgetRow } from "@/components/widget-row";
import { SERVICES_LABEL } from "@/lib/service-purchase";
import { TERMS } from "@/lib/terms";
import { TILE_BOX, TileHead, TileValue, TileList, type TileItem } from "./tile";
import { BridgeHint } from "./mode-line";
import { formatCompactMoney } from "./compact";

/** Срок «дд.мм.гггг» уже прошёл (конец дня). */
function isPastRu(date: string): boolean {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 23, 59, 59).getTime() < Date.now() : false;
}

/**
 * Три плитки оплат: «Общая стоимость», «Оплачено», «К оплате» — одни и те же цифры на Главной и в «Оплаты → Все».
 * Всегда с НДС; 4% отдельной суммой не добавляются (оплачены в составе оплат ТЗ).
 */
export function PayTiles({ drill = false, d, c4Mode, year, only, id = "pay", title = "Оплаты", headerEnd, bare = false, defaultCollapsed = false }: { /** Страницы «Оплаты»: строки долга — ссылки на списки с остатком, а долг по сырью разделён на «за поставленное» и «по заказам, ещё не поставлено». */ drill?: boolean; /** Свёрнуто по умолчанию (на Главной эти цифры уже в полосе «Главное»). */ defaultCollapsed?: boolean; /** Только три плитки, без WidgetRow и сетки: их кладёт в общий ряд «Сырьё | Оплаты» вызывающий (RawCards pay). */ bare?: boolean; /** Ссылка «→ Раздел» над кнопками «Свернуть/Закрепить». */ headerEnd?: React.ReactNode; /** id и заголовок ряда виджетов (запоминание «свернуть/закрепить»). */ id?: string; title?: string; d: DashboardData; c4Mode: "on" | "off"; year: YearFilter; /** Только мех или только подкладка (страница «Сырьё»): без работы и без общих подсказок по долгу. */ only?: "fur" | "lining" }) {
  const { debt } = d;
  const mln = (v: number) => formatCompactMoney(v);
  const prodPaid = d.paidByItem.work;
  const money = (v: number) => formatMoney(roundRub(v));
  const dash = (v: number) => (Math.abs(v) < 0.5 ? "—" : money(v));
  // Деньги — целые рубли, сходящиеся на экране (src/lib/money-round.ts): мех + подкладка выровнены вместе с плитками «Куплено / Использовано / Остаток»,
  // оплачено и к оплате делятся по статьям так, чтобы Σ статей == показанному итогу.
  const N = payNumbers(d, c4Mode, only);
  const { furD, linD, inFur, inLin, inWork, inServ, adv, P, L, T, paidAll, leftAll, due, roundAll, totalAll, furPaidD, linPaidD, furLeftD, linLeftD } = N;
  const part = (v: number, whole: number) => (whole > 0.5 ? v / whole : null);
  const list = (whole: number, fur: number, furSplit: { stock: number; used: number }, furC4: number, lin: number, linSplit: { stock: number; used: number }, linC4: number, serv: number, work: number, warn?: boolean, workLabel = "Работа подрядчику"): TileItem[] => [
    ...(inFur ? [
      ...(only ? [] : [{ k: "Мех", v: money(fur), share: part(fur, whole), tone: warn && fur > 0 ? "text-amber-700" : undefined }]),
      { k: "остаток на складе", v: dash(furSplit.stock), sub: !only },
      { k: "использовано", v: dash(furSplit.used), sub: !only },
      { k: "4%", v: dash(furC4), sub: !only },
    ] : []),
    ...(inLin ? [
      ...(only ? [] : [{ k: "Подкладка", v: money(lin), share: part(lin, whole), tone: warn && lin > 0 ? "text-amber-700" : undefined }]),
      { k: "остаток на складе", v: dash(linSplit.stock), sub: !only },
      { k: "использовано", v: dash(linSplit.used), sub: !only },
      { k: "4%", v: dash(linC4), sub: !only },
    ] : []),
    ...(inServ && Math.abs(serv) >= 0.5 ? [{ k: SERVICES_LABEL, v: money(serv), share: part(serv, whole), tone: warn && serv > 0 ? "text-amber-700" : undefined }] : []),
    ...(inWork ? [{ k: workLabel, v: money(work), share: part(work, whole), tone: warn && work > 0 ? "text-amber-700" : undefined }] : []),
  ];

  // Оплачено по типам платежа: аванс, доплата, окончательный расчёт и прочее (только те, что есть); сумма и число платежей.
  // Показываем, когда Σ типов = «Оплачено всего» (без фильтров); при фильтрах «Оплачено» пересчитано по статьям, разбивки по типам для него нет.
  const TYPE_LABEL = { ADVANCE: "Аванс", PARTIAL: "Доплата", FINAL: "Окончательный платёж", OTHER: "Прочие платежи" } as const;
  const typeRows = d.paidByType.filter((t) => t.count > 0 || Math.abs(t.amount) >= 0.5);
  const typeSum = typeRows.reduce((a, t) => a + t.amount, 0);
  const typesOk = inWork && !only && typeRows.length > 0 && Math.abs(typeSum - paidAll) < 1;
  const typeAl = alignColumn(typeRows.map((t) => t.amount), paidAll); // типы платежа складываются в показанное «Оплачено всего»
  const typeItems: TileItem[] = typeRows.map((t, i) => ({ k: TYPE_LABEL[t.type], v: money(typeAl.values[i]), share: part(typeAl.values[i], paidAll) }));

  // Строки долга ведут к спискам, где этот остаток виден по партиям закупки и по ТЗ (только на страницах «Оплаты»).
  const DEBT_LINK: Record<string, string> = { "Мех": "/payments?tab=suppliers&asort=rem&adir=desc", "Подкладка": "/payments?tab=suppliers&asort=rem&adir=desc", [SERVICES_LABEL]: "/payments?tab=suppliers&asort=rem&adir=desc", [TERMS.workRest]: "/payments?tab=clients" };
  const drillItems = (items: TileItem[]): TileItem[] => (drill ? items.map((x) => (typeof x.k === "string" && DEBT_LINK[x.k] ? { ...x, href: DEBT_LINK[x.k] } : x)) : items);
  // Долг по сырью: «за поставленное» (мех получен, УПД и счета) отдельно от «по заказам» (мех не получен: выставленный счёт и ожидаемое). Σ = долг по сырью в плитке.
  const rawLeft = L.fur + L.lining + L.services;
  const splitAl = alignColumn([debt.receivedNet.toNumber(), debt.invoiced.toNumber() + debt.expected.toNumber()], rawLeft).values;
  const split: [number, number] | null = rawLeft >= 0.5 && Math.abs(debt.receivedNet.toNumber() + debt.invoiced.toNumber() + debt.expected.toNumber() - rawLeft) < 2 ? [splitAl[0], splitAl[1]] : null;

  const tiles = (
    <>
      <div key="total" className={TILE_BOX}>
        <TileHead>Общая стоимость</TileHead>
        <div className="absolute right-3 top-3">
          <InfoHint label="Что такое общая стоимость" align="right">
            <p>Оплачено + К оплате: сырьё (мех с шкурами подрядчика, подкладка), услуги по УПД и работа по заведённым ТЗ. Всегда с НДС, 4% отдельно не добавляются. Доля — от общей стоимости.</p>
            {adv >= 1 ? <p className="mt-1">Аванс подрядчику (неразнесённый) {money(adv)} в стоимость не входит: это предоплата работ по ТЗ, которых ещё нет в базе. Он есть в «Оплачено всего».</p> : null}
          </InfoHint>
        </div>
        <TileValue compact={bare}>{money(totalAll)}</TileValue>
        <TileList stack={bare} items={[...list(totalAll, T.fur, { stock: furD.stock, used: furD.used }, furD.c4, T.lining, { stock: linD.stock, used: linD.used }, linD.c4, T.services, T.work, true), ...(Math.abs(roundAll) >= ROUND_MIN ? [{ k: "Округление", v: money(roundAll) }] : [])]} />
      </div>

      <div key="paid" className={TILE_BOX}>
        <TileHead>Оплачено всего</TileHead>
        {inWork ? (
          <div className="absolute right-3 top-3">
            <InfoHint label="Чем «Оплачено всего» отличается от оплат по партиям" align="right">
              <p>«Оплачено всего» — всё оплаченное, сырьё и работа. В «Партиях пошива» и карточке партии показано меньше («Оплачено, разнесено на партии»): разница {money(d.clientDebtInfo.unallocated)} — аванс подрядчику, ещё не отнесённый к партиям.</p>
            </InfoHint>
          </div>
        ) : null}
        <TileValue compact={bare}>{money(paidAll)}</TileValue>
        <div data-testid="paid-by-item">
          <TileList stack={bare} items={list(paidAll, P.fur, furPaidD, furD.c4, P.lining, linPaidD, linD.c4, P.services, P.work, true)} />
        </div>
        {typesOk ? (
          <div data-testid="paid-by-type" className="mt-2 border-t border-neutral-100 pt-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">По типам платежа</div>
            <TileList stack={bare} items={typeItems} />
          </div>
        ) : null}
      </div>

      <div key="left" className={TILE_BOX} data-testid="debt-bridge">
        <TileHead>{inWork ? DUE_LABEL : "К оплате всего"}</TileHead>
        <div className={"absolute right-3 top-3 flex items-center gap-1" + (only ? " hidden" : "")}>
          <BridgeHint label="Как сходится долг поставщику">
            {inWork ? <p><b>{DUE_LABEL}</b> = долг до зачёта аванса {money(leftAll)} − аванс подрядчику {money(due.adv)}, не меньше нуля. {dueHint(money(leftAll), money(L.work))}</p> : null}
            <p>К оплате всего (до зачёта аванса) = за мех и подкладку {money(L.fur + L.lining)}{inServ ? ` + за услуги по УПД ${money(L.services)}` : ""} + за работу подрядчику {money(L.work)}. Всегда с НДС.</p>
            <p className="mt-1">Долг по работе — остаток работы по заведённым ТЗ (не меньше нуля; договор №1605: аванс 70%, доплата 30% после сдачи). Неразнесённый аванс подрядчику вычитается в главном числе (брутто в расчётах не меняется).</p>
            <p className="mt-1">Долг поставщику: закупки {mln(debt.total.toNumber())} (мех получен {mln(d.bridge.purchases.received)} + ещё не получен {mln(d.bridge.purchases.draft)}) − оплачено {mln(d.supplierCashPaid)} = {mln(debt.debt.toNumber())}.{d.supplierOverpaid >= 1 ? <> В «оплачено» входят переплаты, зачтённые в долг: {money(d.supplierOverpaid)} (оплата аукциона или закупки сверх её стоимости).</> : null} Его части (по УПД, счёт не оплачен, ожидаемое) в сумме дают этот долг.</p>
          </BridgeHint>
          <SupplierDebtHint debt={debt} year={year} align="right" />
        </div>
        <TileValue compact={bare} className={(inWork ? due.net : leftAll) > 0 ? "text-amber-700" : ""}>{money(inWork ? due.net : leftAll)}</TileValue>
        <TileList stack={bare} items={drillItems(list(leftAll, L.fur, furLeftD, 0, L.lining, linLeftD, 0, L.services, L.work, true, TERMS.workRest))} />
        {drill && !only && split ? (
          <div data-testid="debt-split" className="mt-2 border-t border-neutral-100 pt-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{TERMS.rawDebt}</div>
            <TileList stack={bare} items={[
              { k: "за поставленное (УПД и счета)", v: money(split[0]) },
              { k: "по заказам, ещё не поставлено", v: money(split[1]) },
            ]} />
          </div>
        ) : null}
        {inWork && adv >= 1 ? (
          <div data-testid="advance-line" className="mt-2 border-t border-neutral-100 pt-2">
            <TileList stack={bare} items={[{
              k: <span className="inline-flex items-center gap-1">Аванс подрядчику<InfoHint label="Что такое аванс подрядчику" align="right"><p>Оплачен, ТЗ ещё не привязаны: погасится работой по будущим ТЗ. Вычтен из главного числа; входит в «Оплачено всего». {dueHint(money(leftAll), money(L.work))}</p></InfoHint></span>,
              v: `−${money(adv)}${due.net <= 0 && due.creditLeft > 0 ? ` (К доплате 0, аванс остаётся в зачёте ${money(due.creditLeft)})` : ""}`,
            }]} />
          </div>
        ) : null}
        {d.invoiceDeadlines.length > 0 && !only ? (
          <div className="mt-2 border-t border-neutral-100 pt-2 text-xs text-neutral-600">
            <div className="font-medium text-neutral-700">Ближайшие сроки счетов</div>
            {d.invoiceDeadlines.map((x) => {
              const late = isPastRu(x.date);
              return <div key={x.auction + x.date} className={late ? "text-red-700" : undefined}>{x.date} · {x.auction} · <b className="tabular-nums">{formatMoney(x.amount.toFixed(0))}</b>{late ? " · просрочен" : ""}</div>;
            })}
          </div>
        ) : null}
      </div>
    </>
  );
  if (bare) return tiles;
  return (
    <WidgetRow defaultCollapsed={defaultCollapsed} headerEnd={headerEnd} id={id + (only ? "-" + only : "")} title={only === "fur" ? "Оплаты — мех" : only === "lining" ? "Оплаты — подкладка" : title}>
      <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-3 print:grid-cols-3">{tiles}</div>
    </WidgetRow>
  );
}
