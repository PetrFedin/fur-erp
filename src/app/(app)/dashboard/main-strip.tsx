"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatPercent, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { WidgetRow } from "@/components/widget-row";
import { TILE_BOX, TileHead, TileList, TileValue } from "./tile";
import { formatCompactMoney } from "./compact";
import type { ReliabilityData, StripData } from "@/lib/main-strip";

const full = (v: number) => formatMoney(v.toFixed(2));
const mln = (v: number) => <span title={full(v)}>{formatCompactMoney(v)}</span>;

/** Плитка полосы: вся плитка — ссылка в раздел (растянутая ссылка в заголовке), «i» лежит поверх и остаётся нажимаемой. */
function StripTile({ title, href, hint, hintLabel, value, valueClass = "", children, wide = false }: { title: string; href: string; hint: ReactNode; hintLabel: string; value?: ReactNode; valueClass?: string; children?: ReactNode; wide?: boolean }) {
  return (
    <div className={TILE_BOX + " tile-click" + (wide ? " xl:col-span-2" : "")}>
      <TileHead>
        <Link href={href} className="after:absolute after:inset-0 after:rounded-lg hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">{title}</Link>
      </TileHead>
      <div className="absolute right-3 top-3 z-10"><InfoHint label={hintLabel} align="right">{hint}</InfoHint></div>
      {value != null ? <TileValue className={valueClass}>{value}</TileValue> : null}
      {children}
    </div>
  );
}

/**
 * Полоса «Главное»: 9 показателей и «Надёжность данных» одним рядом плиток. Каждая плитка ведёт в раздел (с теми же фильтрами, что «→ Сырьё» и «→ ТЗ»).
 * Все числа готовит loadDashboard (src/lib/main-strip.ts собирает их без новых формул); «с НДС / без НДС» переключается общим переключателем шапки.
 */
export function MainStrip({ s, r, hrefs }: { s: StripData; r: ReliabilityData; hrefs: { fur: string; lining: string; prod: string } }) {
  const { mode: vat } = useVatDisplay();
  const vatW = vat === "incl" ? "с НДС" : "без НДС";
  const closedPct = r.amount > 0 ? (r.paid / r.amount) * 100 : 0;
  const docsPct = r.amount > 0 ? (r.paidDocs / r.amount) * 100 : 0;
  return (
    <WidgetRow id="main" title="Главное" headerEnd={<Link href="/attention" className="text-xs text-blue-700 hover:underline print:hidden">→ Контроль</Link>}>
      <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 print:grid-cols-5">
        <StripTile title="Мех" href={hrefs.fur} hintLabel="Что такое «Мех» в полосе" value={mln(s.fur.recvValue[vat])}
          hint={<><p>Куплено на сумму ({vatW}) и в штуках, использовано в ТЗ и остаток на складе — те же цифры, что в блоке «Сырьё».</p><p className="mt-1">Заказанный, но не полученный мех входит в «Куплено» и «остаток на складе».</p></>}>
          <TileList items={[{ k: "Куплено", v: `${formatQty(s.fur.recvQty)} шт.` }, { k: "использовано", v: `${formatQty(s.fur.usedQty)} шт.`, sub: true }, { k: "остаток на складе", v: `${formatQty(s.fur.remQty)} шт.`, sub: true }]} />
        </StripTile>

        <StripTile title="Подкладка" href={hrefs.lining} hintLabel="Что такое «Подкладка» в полосе" value={mln(s.lining.recvValue[vat])}
          hint={<p>Куплено на сумму ({vatW}) и в метрах, остаток на складе — те же цифры, что в блоке «Сырьё».</p>}>
          <TileList items={[{ k: "Куплено", v: `${formatQty(s.lining.recvQty)} м` }, { k: "остаток на складе", v: `${formatQty(s.lining.remQty)} м`, sub: true }]} />
        </StripTile>

        <StripTile title="Себестоимость" href={hrefs.prod} hintLabel="Что такое себестоимость в полосе" value={mln(s.prod.cost[vat])}
          hint={<><p>Факт по всем ТЗ: сырьё, расходы ТЗ, шкуры подрядчика и работа ({vatW}). Это цифра «Всего» плитки «Себестоимость» в блоке «Производство».</p><p className="mt-1">«На 1 изделие» — без работы и без ремонта: Σ себестоимость ÷ Σ изделий.</p></>}>
          <TileList items={[{ k: "в т. ч. работа", v: full(s.prod.work), sub: true }, { k: "На 1 изделие", v: s.prod.avg ? full(s.prod.avg[vat]) : "—" }]} />
        </StripTile>

        <StripTile title="Произведено" href={hrefs.prod} hintLabel="Что такое «произведено»" value={`${formatQty(s.prod.qty)} шт.`}
          hint={<p>Изделия по всем ТЗ (завершённые и в работе), без ремонта. Та же цифра, что в блоке «Производство».</p>}>
          <TileList items={[{ k: "ТЗ", v: formatQty(s.prod.orders) }]} />
        </StripTile>

        <StripTile title="Работа" href="/payments?tab=clients" hintLabel="Что такое «Работа» в полосе" value={mln(s.work.accrued)}
          hint={<><p>Долг по работе (общий баланс) = работа по всем ТЗ минус все оплаты работы, включая авансы, ещё не привязанные к партиям (договор №1605: аванс 70 %, доплата 30 % после сдачи). Начислено = оплачено + долг. Оплачено и к оплате — те же цифры, что в «Оплаты → За производство» и в плитках «Оплачено» и «К оплате» на этой странице (всегда с НДС).</p></>}>
          <TileList items={[{ k: "Начислено", v: full(s.work.accrued) }, { k: "оплачено", v: full(s.work.paid), sub: true }, { k: "Долг по работе (общий баланс)", v: full(s.work.left), sub: true, tone: s.work.left > 0 ? "text-amber-700" : undefined }]} />
        </StripTile>

        <StripTile title="Оплачено поставщикам" href="/payments?tab=suppliers" hintLabel="Что такое «Оплачено поставщикам»" value={mln(s.supplier.paid)}
          hint={<p>Оплаты за мех и подкладку и остаток долга по сырью — как в «Оплаты → За сырьё». Всегда с НДС; 4% отдельно не добавляются.</p>}>
          <TileList items={[{ k: "Оплачено всего", v: full(s.supplier.paid) }, { k: "Долг по сырью", v: full(s.supplier.debt), tone: s.supplier.debt > 0 ? "text-amber-700" : undefined }]} />
        </StripTile>

        <StripTile title="Общая задолженность" href="/payments" hintLabel="Что такое общая задолженность" value={mln(s.total.left)} valueClass={s.total.left > 0 ? "text-amber-700" : ""}
          hint={<><p>К оплате всего = долг по сырью + долг по работе — цифра «К оплате» плиток оплат на этой странице.</p><p className="mt-1">Оплачено всего {full(s.total.paid)}; общая стоимость = оплачено + к оплате = {full(s.total.all)}.</p></>}>
          <TileList items={[{ k: "К оплате всего", v: full(s.total.left) }, { k: "Оплачено всего", v: full(s.total.paid) }]} />
        </StripTile>

        <StripTile title="Просрочки и сроки" href="/payments?tab=suppliers" hintLabel="Что такое просрочки" value={s.overdue.count > 0 ? mln(s.overdue.amount) : "Нет"} valueClass={s.overdue.count > 0 ? "text-red-700" : ""}
          hint={<p>Счета поставщика, срок оплаты которых (по документам Drive) уже прошёл, и ближайший срок. Источник — те же «Ближайшие сроки счетов», что в плитке «К оплате».</p>}>
          <TileList items={[{ k: "Просрочено счетов", v: String(s.overdue.count), tone: s.overdue.count > 0 ? "text-red-700" : undefined }, { k: s.overdue.nextDate ? `Ожидает: ${s.overdue.nextDate}` : "Ожидает оплаты", v: s.overdue.nextDate ? full(s.overdue.nextAmount) : "—" }]} />
        </StripTile>

        <StripTile wide title="Надёжность данных" href="/reconciliation" hintLabel="Что значит «Надёжность данных»" value={<span title={`${full(r.paidDocs)} из ${full(r.amount)}`}>{`${formatCompactMoney(r.paidDocs)} из ${formatCompactMoney(r.amount)} (${formatPercent(docsPct)})`}</span>}
          hint={<>
            <p><b>Подтверждено документами</b> — оплаты счетов, у которых есть п/п, баланс, УПД или расчёт с отметкой «оплачено».</p>
            <p className="mt-1"><b>Согласовано письмом</b> — в письме сказано «оплачено», но без даты и п/п. «Только согласовано» — не оплата. <b>Без подтверждения</b> — документов нет.</p>
            <p className="mt-1">Закрыто {formatPercent(closedPct)} ({full(r.paid)} из {full(r.amount)}) — оплачено по документам и письмом от суммы счетов реестра (все годы). «Подтверждено строк» — оплаты, закупки, ТЗ и партии, проверенные вручную или авто по документам. «Решения владельца» — вопросы, ждущие ответа в «Контроле».</p>
          </>}>
          <TileList items={[
            { k: "Подтверждено документами", v: full(r.paidDocs) },
            { k: "письмом согласовано", v: full(r.paidLetter), sub: true },
            { k: "только согласовано, не оплата", v: full(r.approved), sub: true },
            { k: "без подтверждения", v: full(r.none), sub: true, tone: r.none > 0 ? "text-amber-700" : undefined },
            { k: "Подтверждено строк", v: `${r.rowsVerified} из ${r.rowsTotal}` },
            { k: "Решений владельца", v: String(r.decisions), tone: r.decisions > 0 ? "text-amber-700" : undefined },
          ]} />
        </StripTile>
      </div>
    </WidgetRow>
  );
}
