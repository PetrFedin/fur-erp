import { sortRows, type readSort, type thSort } from "@/lib/table-sort";
import { Fragment } from "react";
import Link from "next/link";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { Decimal } from "@prisma/client/runtime/library";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney } from "@/lib/utils";
import { shortAuctionName } from "@/lib/auction-names";
import { PAY_EPS, type AuctionPay } from "@/lib/auction-payments";
import { InfoHint } from "@/components/info-hint";
import { type payNumbers } from "@/lib/pay-display";
import { alignColumn } from "@/lib/money-round";
import { YearGroup } from "../year-group";
import { OVERPAY_NOTE } from "@/lib/overpay-notes";
import { auctionPeriod, fmtPct, fmtRemaining, sortByPeriod } from "./helpers";

export type Extra = { label: string; href?: string; title: string; total: Decimal; paid: Decimal; rem: Decimal };

/** Всё, что таблица партий берёт со страницы: выбранная партия, сортировка, строки «без аукциона» по годам и якоря итогов. */
export type AuctionsTableCtx = {
  selected: AuctionPay | null;
  auctionHref: (name: string) => string;
  anyPlanned: boolean;
  aSort: ReturnType<typeof readSort>;
  ath: (k: string) => ReturnType<typeof thSort>;
  extraByYear: Map<number, Extra[]>;
  showServiceSum: boolean;
  listFiltered: boolean;
  rawPay: ReturnType<typeof payNumbers> | null;
  yearAnchors: Map<number, { t: number; p: number; r: number }> | null;
  sumTotal: Decimal;
  sumPaid: Decimal;
  sumRemaining: Decimal;
  svcPurchases: number;
};

// o — суммы строки в целых рублях, сложенные под итог года (src/lib/money-round.ts); без o — точные суммы, как раньше.
const renderAuction = (c: AuctionsTableCtx, a: AuctionPay, o?: { t: number; p: number; r: number }) => {
  const { selected, auctionHref, anyPlanned } = c;
  const active = selected?.name === a.name;
  const remD = o ? new Decimal(o.r) : a.remaining;
  const href = `${auctionHref(a.name)}#auction-block`;
  return (
    <Tr key={a.name} className={active ? "bg-neutral-50" : undefined}>
      <Td className="min-w-[10rem] max-w-[18rem] font-medium">
        <Link href={href} scroll title={a.name} className="hover:underline">
          {shortAuctionName(a.name)}
        </Link>
      </Td>
      <Td className="whitespace-nowrap text-right">{formatMoney(o ? o.t : a.total.toString())}</Td>
      <Td className="whitespace-nowrap text-right">
        <span className="inline-flex items-baseline justify-end gap-2">
          <span>{formatMoney(o ? o.p : a.paid.toString())}</span>
          <span className={"text-xs font-medium " + (a.percentPaid < 99.95 ? "text-red-600" : "font-normal text-neutral-500")}>{fmtPct(a.percentPaid)}</span>
        </span>
      </Td>
      {anyPlanned && <Td className="whitespace-nowrap text-right">{a.planned.greaterThan(PAY_EPS) ? formatMoney(a.planned.toString()) : "–"}</Td>}
      <Td
        className={
          "whitespace-nowrap text-right font-semibold " +
          (a.remaining.greaterThan(0.005) ? "text-amber-700" : a.remaining.lessThan(-0.005) ? "text-emerald-700" : "")
        }
      >
        {fmtRemaining(remD)}
        {a.remaining.lessThan(-0.005) && OVERPAY_NOTE.some((n) => n.inline && n.rx.test(a.name)) ? (
          <InfoHint wide label="Где учтена переплата" align="right">
            <p>{OVERPAY_NOTE.find((n) => n.inline && n.rx.test(a.name))!.text}</p>
          </InfoHint>
        ) : null}
      </Td>
    </Tr>
  );
};

const extraRowEl = (anyPlanned: boolean, y: number, e: Extra, o?: { t: number; p: number; r: number }) => (
  <Tr key={`__extra_${y}_${e.label}`}>
    <Td className="min-w-[10rem] max-w-[18rem] font-medium text-neutral-600" title={e.title}>
      {e.href ? <Link href={e.href} scroll className="hover:underline">{e.label}</Link> : e.label}
    </Td>
    <Td className="whitespace-nowrap text-right">{formatMoney(o ? o.t : e.total.toString())}</Td>
    <Td className="whitespace-nowrap text-right">{formatMoney(o ? o.p : e.paid.toString())}</Td>
    {anyPlanned && <Td className="text-right">–</Td>}
    <Td className={"whitespace-nowrap text-right font-semibold " + (e.rem.greaterThan(0.005) ? "text-amber-700" : "")}>{fmtRemaining(o ? new Decimal(o.r) : e.rem)}</Td>
  </Tr>
);
const remClass = (r: Decimal) => (r.greaterThan(0.005) ? "text-amber-700" : r.lessThan(-0.005) ? "text-emerald-700" : "");
const auctionCard = (auctionHref: (name: string) => string, a: AuctionPay) => {
  const href = `${auctionHref(a.name)}#auction-block`;
  return (
    <RowCard
      key={a.name}
      title={shortAuctionName(a.name)}
      href={href}
      fields={[
        { label: "Остаток", value: <span className={remClass(a.remaining)}>{fmtRemaining(a.remaining)}</span>, strong: true },
        { label: "Стоимость", value: formatMoney(a.total.toString()) },
        { label: "Оплачено", value: `${formatMoney(a.paid.toString())} (${fmtPct(a.percentPaid)})` },
        ...(a.planned.greaterThan(PAY_EPS) ? [{ label: "Запланировано", value: formatMoney(a.planned.toString()) }] : []),
      ]}
      details={[{ label: "Закупок", value: a.purchases }]}
    />
  );
};
const serviceSumCard = (c: AuctionsTableCtx) => (
  <RowCard
    key="__service_sum"
    title="Закупки без аукциона"
    fields={[
      { label: "Остаток", value: <span className={remClass(c.sumRemaining)}>{fmtRemaining(c.sumRemaining)}</span>, strong: true },
      { label: "Стоимость", value: formatMoney(c.sumTotal.toString()) },
      { label: "Оплачено", value: formatMoney(c.sumPaid.toString()) },
    ]}
    details={[{ label: "Закупок", value: c.svcPurchases }]}
  />
);

/** Таблица партий закупки по годам (на телефоне — карточки). */
export const auctionsTable = (ctx: AuctionsTableCtx, rawList: AuctionPay[], withExtras = false) => {
  const { selected, anyPlanned, aSort, ath, extraByYear, showServiceSum, listFiltered, rawPay, yearAnchors } = ctx;
  const list = sortRows(sortByPeriod(rawList), aSort, { name: (a) => a.name, total: (a) => a.total.toNumber(), paid: (a) => a.paid.toNumber(), planned: (a) => a.planned.toNumber(), rem: (a) => a.remaining.toNumber() });
  const groups: { year: number | null; items: AuctionPay[] }[] = [];
  for (const a of list) {
    const y = auctionPeriod(a.name)?.year ?? null;
    const g = groups.find((x) => x.year === y);
    if (g) g.items.push(a); else groups.push({ year: y, items: [a] });
  }
  // Целые рубли, сходящиеся на экране: года складываются в «Общую стоимость» плиток (когда таблица показывает всё без фильтров), партии и строки «без аукциона» — в свой год.
  const calc = groups.map((g) => {
    const ex = withExtras && g.year != null ? (extraByYear.get(g.year) ?? []) : [];
    const nums = [...g.items.map((a) => ({ t: a.total.toNumber(), p: a.paid.toNumber(), r: a.remaining.toNumber() })), ...ex.map((e) => ({ t: e.total.toNumber(), p: e.paid.toNumber(), r: e.rem.toNumber() }))];
    return { ex, nums, t: nums.reduce((x, n) => x + n.t, 0), p: nums.reduce((x, n) => x + n.p, 0), r: nums.reduce((x, n) => x + n.r, 0) };
  });
  const anchored = withExtras && showServiceSum && !listFiltered && !selected && rawPay != null;
  // Года берём из «Динамики по годам» Главной, если они сходятся с документами (до 1,5 ₽ на год) и покрывают все группы таблицы.
  const fromYears = anchored && yearAnchors != null && groups.every((g, i) => g.year != null && yearAnchors.has(g.year) && Math.abs(yearAnchors.get(g.year)!.t - calc[i].t) < 1.5 && Math.abs(yearAnchors.get(g.year)!.p - calc[i].p) < 1.5 && Math.abs(yearAnchors.get(g.year)!.r - calc[i].r) < 1.5);
  const gTv = fromYears ? groups.map((g) => yearAnchors!.get(g.year!)!.t) : alignColumn(calc.map((c) => c.t), anchored ? rawPay!.totalAll : undefined).values;
  const gPv = fromYears ? groups.map((g) => yearAnchors!.get(g.year!)!.p) : alignColumn(calc.map((c) => c.p), anchored ? rawPay!.paidAll : undefined).values;
  const gRv = fromYears ? groups.map((g) => yearAnchors!.get(g.year!)!.r) : alignColumn(calc.map((c) => c.r), anchored ? rawPay!.leftAll : undefined).values;
  const rowV = calc.map((c, i) => ({
    t: alignColumn(c.nums.map((n) => n.t), gTv[i]).values,
    p: alignColumn(c.nums.map((n) => n.p), gPv[i]).values,
    r: alignColumn(c.nums.map((n) => n.r), gRv[i]).values,
  }));
  return (
  <ResponsiveRows
    table={
  <Table>
    <Thead>
      <Tr>
        <Th {...ath("name")}>Аукцион</Th>
        <Th {...ath("total")} className="text-right" unit="₽">Стоимость</Th>
        <Th {...ath("paid")} className="text-right" unit="₽">Оплачено</Th>
        {anyPlanned && <Th {...ath("planned")} className="text-right" unit="₽">Запланировано</Th>}
        <Th {...ath("rem")} className="text-right" unit="₽">Долг</Th>
      </Tr>
    </Thead>
    <Tbody>
      {groups.map((g, gi) => {
        // «Закупки без аукциона» и «Шкуры подрядчика» — внутри года оплаты: входят в итог года и раскрываются вместе с ним.
        const ex = calc[gi].ex;
        const gt = new Decimal(gTv[gi]), gp = new Decimal(gPv[gi]), gr = new Decimal(gRv[gi]);
        const rv = rowV[gi];
        return (
          <Fragment key={g.year ?? "none"}>
            {groups.length === 1 && g.items.length === 1 ? (
              g.items.map((a, i) => renderAuction(ctx, a, { t: rv.t[i], p: rv.p[i], r: rv.r[i] }))
            ) : (
              <YearGroup
                label={g.year ?? "Без года"}
                sub={`${g.items.length + ex.length} ${g.items.length + ex.length === 1 ? "партия" : g.items.length + ex.length < 5 ? "партии" : "партий"}`}
                defaultOpen={g.items.some((a) => a.name === selected?.name)}
                cells={
                  <>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(gt.toString())}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      <span className="inline-flex items-baseline justify-end gap-2">
                        <span>{formatMoney(gp.toString())}</span>
                        <span className={"text-xs font-medium " + (gt.greaterThan(0) && gp.div(gt).mul(100).lessThan(99.95) ? "text-red-600" : "font-normal text-neutral-500")}>{gt.greaterThan(0) ? fmtPct(Number(gp.div(gt).mul(100).toString())) : "–"}</span>
                      </span>
                    </td>
                    {anyPlanned && <td className="px-3 py-2 text-right">–</td>}
                    <td className={"whitespace-nowrap px-3 py-2 text-right tabular-nums " + remClass(gr)}>{fmtRemaining(gr)}</td>
                  </>
                }
              >
                {g.items.map((a, i) => renderAuction(ctx, a, { t: rv.t[i], p: rv.p[i], r: rv.r[i] }))}
                {ex.map((e, j) => { const k = g.items.length + j; return extraRowEl(anyPlanned, g.year!, e, { t: rv.t[k], p: rv.p[k], r: rv.r[k] }); })}
              </YearGroup>
            )}
          </Fragment>
        );
      })}
    </Tbody>
  </Table>
    }
  >
    {list.map((a) => auctionCard(ctx.auctionHref, a))}
    {withExtras && showServiceSum ? serviceSumCard(ctx) : null}
  </ResponsiveRows>
  );
};
