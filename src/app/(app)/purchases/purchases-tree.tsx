"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, type ReactNode } from "react";
import { cn, formatMoney, formatPercent, formatQty } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";
import { InfoHint } from "@/components/info-hint";
import { Chevron, Dash, SCROLL_BOX, TD, rowTone } from "@/components/tree-table";
import { TH, THGroup } from "@/components/table-head";
import { UNIT } from "@/lib/units";
import { TotalLabel } from "@/components/total-label";
import { LotUsageMini } from "@/components/lot-usage-bar";
import { RowCard } from "@/components/responsive-rows";
import { shortMaterialName } from "@/lib/material-name";
import { aggregate, type Agg, type TreeItem, type TreePurchase, type TreeYear } from "./purchases-agg";

export type { PurchaseStatus, TreeBatch, TreePurchase, TreeYear } from "./purchases-agg";

/** Служебная строка таблицы (не закупка): «Шкуры подрядчика», «Округление». Входит в «Всего, ₽»; paid — оплачено по ней. */
export type ExtraRow = { key: string; label: string; sub?: string; href?: string; sum: number; paid: number; note?: ReactNode };

// ───────────────────────────── общие расчёты и ячейки ─────────────────────────────

const money = (v: number) => (Math.abs(v) < 0.005 ? <Dash /> : formatMoney(v.toFixed(2)));
const qty = (v: number) => (Math.abs(v) < 0.0005 ? <Dash /> : formatQty(v));
const restCls = (v: number) => (v > 0.5 ? " text-amber-700" : v < -0.5 ? " text-emerald-700" : "");
const BL = " border-l border-neutral-200";
const cnt = (n: number, one: string, few: string, many: string) => `${n} ${n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n < 10 || n > 20) ? few : many}`;
const usedPct = (a: Pick<Agg, "usedValue" | "recvValue" | "hasLots">) => (a.hasLots && a.recvValue > 0.5 ? (a.usedValue / a.recvValue) * 100 : null);
const remText = (a: Pick<Agg, "remFur" | "remLining" | "hasLots">) => {
  if (!a.hasLots) return <Dash />;
  const parts = [a.remFur > 0.0005 ? `${formatQty(a.remFur)} шт.` : null, a.remLining > 0.0005 ? `${formatQty(a.remLining)} м` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : <Dash />;
};
/** Служебные строки (шкуры подрядчика, округление): сумма, оплачено, ссылка ↗ на детализацию, пояснение в «i». */
function ExtraLabel({ x }: { x: ExtraRow }) {
  return (
    <>
      {x.label}
      {x.href ? <Link href={x.href} className="ml-1.5 text-[10px] text-neutral-400 hover:text-blue-700 hover:underline" title={`Открыть: ${x.label}`} aria-label={`Открыть: ${x.label}`}>↗</Link> : null}
      {x.note ? <InfoHint label={`Что такое «${x.label}»`} align="left">{x.note}</InfoHint> : null}
      {x.sub ? <div className="text-[11px] text-neutral-500">{x.sub}</div> : null}
    </>
  );
}

/** Заголовок блока колонок: подпись, нижняя линия, вертикальная линия слева. */

function useSum() {
  const { mode } = useVatDisplay();
  return { word: mode === "excl" ? "без НДС" : "с НДС", pick: (a: { total: number; totalExcl: number }) => (mode === "excl" ? a.totalExcl : a.total) };
}

function HelpHint() {
  return (
    <InfoHint label="Как читать таблицу закупок" wide>
      <p><b>Год → партия закупки (аукцион) → закупка → позиции (лоты), расходы, оплаты.</b> Год — по дате заказа закупки. Нажмите ›, чтобы раскрыть вглубь; ↗ ведёт в карточку закупки или лота.</p>
      <p className="mt-1"><b>Сумма</b> — позиции плюс расходы закупки (режим «с НДС / без НДС» из шапки); <b>Оплачено</b> — оплаты закупки и её доля в оплатах партии (пропорционально сумме); <b>Долг</b> = Сумма с НДС − Оплачено. Оплата и долг всегда с НДС; 4% к закупкам не применяется.</p>
      <p className="mt-1"><b>Использовано, %</b> — доля стоимости лотов закупки, списанных в ТЗ (без 4%); <b>Остаток</b> — шкуры (шт.) и подкладка (м) на складе. У закупок без лотов (черновик) — «—».</p>
      <p className="mt-1">«Всего, ₽» совпадает с плитками выше и с Главной. Отменённые закупки в итог не входят.</p>
    </InfoHint>
  );
}

// ───────────────────────────── дерево «По годам и партиям» ─────────────────────────────

const TREE_COLS = [250, 84, 64, 60, 84, 88, 116, 104, 112, 116, 104];
const NAME_CELL = "sticky left-0 z-[1] bg-inherit px-2 py-1.5 text-left align-top";
const LINK = "text-blue-700 hover:underline";

export function PurchasesTree({ years, extras = [] }: { years: TreeYear[]; extras?: ExtraRow[] }) {
  const { word, pick } = useSum();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const flip = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n; };
  const arrow = (isOpen: boolean, onClick: () => void, label: string) => (
    <button type="button" onClick={onClick} aria-expanded={isOpen} aria-label={`Раскрыть: ${label}`}><Chevron open={isOpen} /></button>
  );
  const all = years.flatMap((y) => y.batches.flatMap((b) => b.purchases));
  const tot = aggregate(all);
  const exSum = extras.reduce((a, x) => a + x.sum, 0);
  const exPaid = extras.reduce((a, x) => a + x.paid, 0);

  /** Ячейки строки уровня «год / партия / закупка» по агрегату. */
  const cells = (a: Agg, o: { date?: ReactNode } = {}) => (
    <>
      <td className={TD + BL + " text-xs"}>{o.date ?? <Dash />}</td>
      <td className={TD}>{a.purchases > 0 ? a.purchases : <Dash />}</td>
      <td className={TD}>{a.lots > 0 ? a.lots : <Dash />}</td>
      <td className={TD}>{qty(a.fur)}</td>
      <td className={TD}>{qty(a.lining)}</td>
      <td className={TD}>{money(pick(a))}</td>
      <td className={TD + BL}>{usedPct(a) != null ? formatPercent(usedPct(a)) : <Dash />}</td>
      <td className={TD + " text-xs"}>{remText(a)}</td>
      <td className={TD + BL}>{money(a.paid)}</td>
      <td className={TD + restCls(a.rest)}>{money(a.rest)}</td>
    </>
  );
  const empty = (n: number) => Array.from({ length: n }, (_, i) => <td key={i} className={TD} />);

  return (
    <section aria-labelledby="pur-tree" className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 id="pur-tree" className="text-base font-semibold">Закупки по годам и партиям</h2>
        <HelpHint />
      </div>
      <div className={SCROLL_BOX}>
        <table className="w-full table-fixed text-sm" style={{ minWidth: TREE_COLS.reduce((a, b) => a + b, 0) }}>
          <colgroup>{TREE_COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <thead>
            <tr>
              <TH rowSpan={2} align="left" className="sticky left-0 z-[2] bg-white" label="Год / партия / закупка / лот" />
              <THGroup colSpan={6}>Закупка</THGroup>
              <THGroup colSpan={2}>Использование</THGroup>
              <THGroup colSpan={2}>Оплата</THGroup>
            </tr>
            <tr className="border-b border-neutral-200">
              <TH sep align="center" label="Дата" />
              <TH label="Закупок" unit={UNIT.pcs} />
              <TH label="Лотов" unit={UNIT.pcs} />
              <TH label="Шкур" unit={UNIT.pcs} />
              <TH label="Подкладка" unit={UNIT.m} />
              <TH label="Сумма" unit={`${UNIT.rub} · ${word}`} />
              <TH sep label="Использовано" unit={UNIT.pct} />
              <TH label="Остаток" unit="шт. · м" />
              <TH sep label="Оплачено" unit={UNIT.rub} />
              <TH label="Долг" unit={UNIT.rub} />
            </tr>
          </thead>
          <tbody>
            {years.map((y) => {
              const yk = `y${y.year}`;
              const yOpen = !closed.has(yk);
              const list = y.batches.flatMap((b) => b.purchases);
              return (
                <Fragment key={yk}>
                  <tr className={rowTone(0) + " font-semibold"}>
                    <td className={NAME_CELL}><span className="mr-1 inline-block align-middle">{arrow(yOpen, () => setClosed((s) => flip(s, yk)), String(y.year))}</span>{y.year}<span className="ml-1.5 text-xs font-normal text-neutral-500">{cnt(y.batches.length, "партия", "партии", "партий")}</span></td>
                    {cells(aggregate(list))}
                  </tr>
                  {yOpen ? y.batches.map((b) => {
                    const bk = `${yk}:${b.key}`;
                    const bOpen = open.has(bk);
                    const ba = aggregate(b.purchases);
                    return (
                      <Fragment key={bk}>
                        <tr className={rowTone(1, bOpen)}>
                          <td className={NAME_CELL + " pl-5"} title={b.title}>
                            <span className="mr-1 inline-block align-middle">{arrow(bOpen, () => setOpen((s) => flip(s, bk)), b.label)}</span>{b.label}
                            {b.href ? <Link href={b.href} className="ml-1.5 text-[10px] text-neutral-400 hover:text-blue-700 hover:underline" title="Открыть в «Оплатах» с этой партией" aria-label={`Оплаты партии ${b.label}`}>↗</Link> : null}
                            <div className="pl-5 text-[11px] text-neutral-500">
                              {b.href ? <Link href={b.href} className={LINK}>оплаты ›</Link> : null}
                              {b.docsHref ? <Link href={b.docsHref} className={cn(LINK, b.href && "ml-2")}>документы ›</Link> : null}
                            </div>
                          </td>
                          {cells(ba, { date: b.purchases[0]?.date })}
                        </tr>
                        {bOpen ? b.purchases.map((p) => {
                          const pk = `${bk}:${p.id}`;
                          const pOpen = open.has(pk);
                          const pa = aggregate([p]);
                          const cancelled = p.status === "CANCELLED";
                          return (
                            <Fragment key={pk}>
                              <tr className={rowTone(2, pOpen) + (cancelled ? " opacity-60" : "")}>
                                <td className={NAME_CELL + " pl-9"}>
                                  <span className="mr-1 inline-block align-middle">{arrow(pOpen, () => setOpen((s) => flip(s, pk)), p.number)}</span>
                                  <span className="font-medium text-neutral-900">{p.number}</span>
                                  <Link href={`/purchases/${p.id}`} className="ml-1.5 text-[10px] text-neutral-400 hover:text-blue-700 hover:underline" title="Открыть закупку" aria-label={`Открыть закупку ${p.number}`}>↗</Link>
                                  {p.invoice ? <span className="ml-1.5 text-[11px] text-neutral-500">счёт {p.invoice}</span> : null}
                                  <div className="pl-5 text-[11px]">
                                    <Link href={`/purchases/${p.id}`} className={LINK}>закупка ›</Link>
                                    <Link href={p.auction ? `/payments?auction=${encodeURIComponent(p.auction)}#auction-block` : "/payments"} className={LINK + " ml-2"}>оплаты ›</Link>
                                    <Link href={p.auction ? `/documents?auction=${encodeURIComponent(p.auction)}` : `/purchases/${p.id}`} className={LINK + " ml-2"}>документы ›</Link>
                                  </div>
                                </td>
                                {cells(cancelled ? { ...pa, total: 0, totalExcl: 0, paid: 0, rest: 0 } : pa, { date: p.date })}
                              </tr>
                              {pOpen ? (
                                <>
                                  {([
                                    ["items", "Позиции (лоты)", p.items.length, p.items.reduce((a, x) => a + x.sum, 0), null],
                                    ["exp", "Расходы закупки", p.expenses.length, p.expenses.reduce((a, x) => a + x.sum, 0), null],
                                    ["pay", "Оплаты", p.pays.length + (Math.abs(p.paidBatch) > 0.5 ? 1 : 0), null, p.paid],
                                  ] as const).map(([g, label, n, total, paid]) => {
                                    const gk = `${pk}:${g}`;
                                    const gOpen = open.has(gk);
                                    return (
                                      <Fragment key={gk}>
                                        <tr className={rowTone(2, gOpen)}>
                                          <td className={NAME_CELL + " pl-14"}>
                                            <span className="mr-1 inline-block w-4 align-middle">{n > 0 ? arrow(gOpen, () => setOpen((s) => flip(s, gk)), label) : null}</span>
                                            {label}<span className="ml-1.5 text-neutral-500">{n > 0 ? n : "нет"}</span>
                                          </td>
                                          {empty(5)}
                                          <td className={TD}>{total != null ? money(total) : <Dash />}</td>
                                          {empty(2)}
                                          <td className={TD + BL}>{paid != null ? money(paid) : <Dash />}</td>
                                          {empty(1)}
                                        </tr>
                                        {gOpen && g === "items" ? p.items.map((x) => <ItemRows key={x.id} x={x} open={open} flip={(k) => setOpen((s) => flip(s, k))} pk={gk} />) : null}
                                        {gOpen && g === "exp" ? p.expenses.map((x) => (
                                          <tr key={x.id} className={rowTone(3)}>
                                            <td className={NAME_CELL + " pl-20"}>{x.label}</td>
                                            {empty(5)}<td className={TD}>{money(x.sum)}</td>{empty(4)}
                                          </tr>
                                        )) : null}
                                        {gOpen && g === "pay" ? (
                                          <>
                                            {p.pays.map((x) => (
                                              <tr key={x.id} className={rowTone(3)}>
                                                <td className={NAME_CELL + " pl-20"}><span className="tabular-nums">{x.date}</span>{x.doc ? <span className="ml-2 text-neutral-500">{x.doc}</span> : null}</td>
                                                {empty(8)}<td className={TD + BL}>{money(x.amount)}</td>{empty(1)}
                                              </tr>
                                            ))}
                                            {Math.abs(p.paidBatch) > 0.5 ? (
                                              <tr className={rowTone(3)}>
                                                <td className={NAME_CELL + " pl-20"}>Остальные оплаты партии<div className="text-[11px] text-neutral-400">доля закупки, пропорционально сумме</div></td>
                                                {empty(8)}<td className={TD + BL}>{money(p.paidBatch)}</td>{empty(1)}
                                              </tr>
                                            ) : null}
                                          </>
                                        ) : null}
                                      </Fragment>
                                    );
                                  })}
                                </>
                              ) : null}
                            </Fragment>
                          );
                        }) : null}
                      </Fragment>
                    );
                  }) : null}
                </Fragment>
              );
            })}
            {years.length === 0 ? <tr><td colSpan={11} className="px-3 py-6 text-center text-sm text-neutral-500">Закупок нет.</td></tr> : null}
            {extras.map((x) => (
              <tr key={x.key} className={rowTone(1)}>
                <td className={NAME_CELL + " pl-5"}><ExtraLabel x={x} /></td>
                {empty(5)}<td className={TD}>{money(x.sum)}</td>{empty(2)}<td className={TD + BL}>{money(x.paid)}</td><td className={TD}><Dash /></td>
              </tr>
            ))}
            {years.length > 0 ? (
              <tr className="row-total">
                <td className="sticky left-0 z-[1] bg-inherit px-2 py-1.5 text-left"><TotalLabel /></td>
                {cells({ ...tot, total: tot.total + exSum, totalExcl: tot.totalExcl + exSum, paid: tot.paid + exPaid }, { date: <Dash /> })}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Строка лота (позиции закупки): вид меха / ткань, цвет, размер, цена ₽/$, сумма, использовано и остаток; раскрывается до ТЗ-потребителей. */
function ItemRows({ x, open, flip, pk }: { x: TreeItem; open: Set<string>; flip: (k: string) => void; pk: string }) {
  const key = `${pk}:${x.id}`;
  const isOpen = open.has(key);
  const canOpen = x.usages.length > 0;
  const detail = [x.color, x.size ?? x.grade].filter(Boolean).join(" · ");
  const prices = [x.priceRub != null ? `${formatMoney(x.priceRub.toFixed(2))}/${x.unit}` : null, x.priceUsd != null ? `$${x.priceUsd.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null].filter(Boolean).join(" · ");
  const isFur = x.unit === "шт.";
  return (
    <>
      <tr className={rowTone(3, isOpen)}>
        <td className={NAME_CELL + " pl-20"}>
          <span className="mr-1 inline-block w-4 align-middle">{canOpen ? <button type="button" onClick={() => flip(key)} aria-expanded={isOpen} aria-label={`Раскрыть ТЗ лота ${x.lot ?? ""}`}><Chevron open={isOpen} /></button> : null}</span>
          <span className="text-neutral-800" title={x.material}>{shortMaterialName(x.material)}</span>
          {x.lot ? <span className="ml-1.5 text-neutral-500">лот № {x.lot}</span> : null}
          {x.lotId ? (
            <Link href={`/analytics/raw/lot/${x.lotId}`} title="Открыть карточку лота" aria-label={`Карточка лота ${x.lot ?? ""}`} className="ml-1.5 text-[10px] text-neutral-400 hover:text-blue-700 hover:underline">↗</Link>
          ) : (
            <span className="ml-1.5 text-[10px] text-neutral-300" title="Лота на складе ещё нет: закупка не принята" aria-label="Карточки лота нет">—</span>
          )}
          {detail || prices ? <div className="pl-5 text-[11px] text-neutral-500">{[detail, prices].filter(Boolean).join(" · ")}</div> : null}
        </td>
        <td className={TD + BL} />
        <td className={TD} />
        <td className={TD}>1</td>
        <td className={TD}>{isFur ? formatQty(x.qty) : <Dash />}</td>
        <td className={TD}>{!isFur ? formatQty(x.qty) : <Dash />}</td>
        <td className={TD}>{money(x.sum)}</td>
        <td className={TD + BL}>
          {x.recv != null && x.recv > 0 ? <LotUsageMini recv={x.recv} used={x.used} unit={x.unit} className="ml-auto w-full max-w-24" /> : <Dash />}
        </td>
        <td className={TD + " text-xs"}>{x.recv != null && x.rem > 0.0005 ? `${formatQty(x.rem)} ${x.unit}` : <Dash />}</td>
        <td className={TD + BL} />
        <td className={TD} />
      </tr>
      {isOpen ? x.usages.map((u) => (
        <tr key={u.orderId} className={rowTone(3)}>
          <td className={NAME_CELL + " pl-28"}><Link href={`/production/${u.orderId}`} className={LINK}>ТЗ {u.number}</Link></td>
          <td className={TD + BL} /><td className={TD} /><td className={TD} />
          <td className={TD}>{isFur ? formatQty(u.qty) : <Dash />}</td>
          <td className={TD}>{!isFur ? formatQty(u.qty) : <Dash />}</td>
          <td className={TD}>{money(u.sum)}</td>
          <td className={TD + BL} /><td className={TD} /><td className={TD + BL} /><td className={TD} />
        </tr>
      )) : null}
    </>
  );
}

// ───────────────────────────── «Списком»: плоская таблица закупок ─────────────────────────────

export type ListSort = { key: string; dir: "asc" | "desc" };
const LIST_COLS = [150, 62, 130, 84, 60, 84, 88, 116, 104, 112, 116, 104];

/**
 * Одна секция режима «Списком» — закупки меха (шкуры, шт.) или подкладки (метры). Закупка со смешанным составом попадает в обе секции своей частью
 * (кол-во, сумма, оплата и долг делятся по стоимости позиций вида; расходы — пропорционально); суммы секций вместе дают общий итог.
 */
export function PurchasesList({ id, title, unitLabel, rows, allRows, extras = [], sort, sortHrefs, footer }: { id: string; title: string; unitLabel: string; rows: TreePurchase[]; /** Все строки секции (итог считается по ним, а не только по показанным). */ allRows?: TreePurchase[]; extras?: ExtraRow[]; sort: ListSort; sortHrefs: Record<string, string>; footer?: ReactNode }) {
  const router = useRouter();
  const { word, pick } = useSum();
  const tot = aggregate(allRows ?? rows);
  const exSum = extras.reduce((a, x) => a + x.sum, 0);
  const exPaid = extras.reduce((a, x) => a + x.paid, 0);
  const isFurSec = unitLabel === "шт.";
  const head = (k: string, label: ReactNode, o: { left?: boolean; bl?: boolean; unit?: string } = {}) => (
    <TH label={label} unit={o.unit} align={o.left ? "left" : "right"} sep={o.bl} sort={sort.key === k ? sort.dir : "none"} href={sortHrefs[k] ?? "#"} />
  );
  const qtyOf = (p: Pick<Agg, "fur" | "lining">) => (isFurSec ? p.fur : p.lining);
  return (
    <section aria-labelledby={id} className="space-y-2" data-testid={id}>
      <div className="flex items-center gap-2">
        <h2 id={id} className="text-base font-semibold">{title}</h2>
        <span className="text-xs text-neutral-500">{cnt(tot.purchases, "закупка", "закупки", "закупок")} · {formatQty(qtyOf(tot))} {unitLabel}</span>
        <HelpHint />
      </div>
      {/* Телефон: карточки-строки с ключевыми полями. */}
      <div className="flex flex-col gap-2 md:hidden">
        {rows.map((p) => (
          <RowCard
            key={p.id}
            title={<>{p.number}</>}
            href={`/purchases/${p.id}`}
            subtitle={[p.batchLabel, p.date].join(" · ")}
            fields={[
              { label: `Сумма (${word})`, value: money(pick(p)), strong: true },
              { label: `Кол-во, ${unitLabel}`, value: qty(qtyOf(p)) },
              { label: "Использовано", value: usedPct(p) != null ? formatPercent(usedPct(p)) : <Dash /> },
              { label: "Оплачено", value: p.status === "CANCELLED" ? <Dash /> : money(p.paid) },
              { label: "Долг", value: p.status === "CANCELLED" || Math.abs(p.rest) < 0.5 ? <Dash /> : <span className={restCls(p.rest)}>{money(p.rest)}</span> },
            ]}
            details={[
              { label: "Лотов", value: p.lots > 0 ? p.lots : null },
              { label: "Остаток", value: p.hasLots ? remText(p) : null },
              { label: "Счёт", value: p.invoice },
            ]}
          />
        ))}
        {rows.length === 0 ? <p className="py-6 text-center text-sm text-neutral-500">Закупок нет.</p> : null}
      </div>
      <div className={cn(SCROLL_BOX, "hidden md:block")}>
        <table className="w-full table-fixed text-sm" style={{ minWidth: LIST_COLS.reduce((a, b) => a + b, 0) }}>
          <colgroup>{LIST_COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <thead>
            <tr>
              <TH rowSpan={2} align="left" className="sticky left-0 z-[2] bg-white" label="№ закупки" sort={sort.key === "number" ? sort.dir : "none"} href={sortHrefs.number ?? "#"} />
              <THGroup colSpan={6}>Закупка</THGroup>
              <THGroup colSpan={2}>Использование</THGroup>
              <THGroup colSpan={2}>Оплата</THGroup>
            </tr>
            <tr className="border-b border-neutral-200">
              {head("year", "Год", { bl: true })}
              {head("batch", "Партия", { left: true })}
              {head("date", "Дата", { bl: true })}
              {head("lots", "Лотов", { unit: UNIT.pcs })}
              {head(isFurSec ? "fur" : "lining", isFurSec ? "Шкур" : "Подкладка", { unit: unitLabel })}
              {head("total", "Сумма", { unit: `${UNIT.rub} · ${word}` })}
              {head("used", "Использовано", { bl: true, unit: UNIT.pct })}
              {head("rem", "Остаток", { unit: unitLabel })}
              {head("paid", "Оплачено", { bl: true, unit: UNIT.rub })}
              {head("rest", "Долг", { unit: UNIT.rub })}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const cancelled = p.status === "CANCELLED";
              return (
                <tr
                  key={p.id}
                  onClick={() => router.push(`/purchases/${p.id}`)}
                  className={cn("cursor-pointer border-b border-neutral-100 hover:bg-neutral-50", cancelled && "opacity-60")}
                >
                  <td className="sticky left-0 z-[1] bg-inherit px-2 py-1.5 text-left font-medium">
                    <Link href={`/purchases/${p.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{p.number}</Link>
                    <span aria-hidden className="ml-1 text-[10px] text-neutral-400">↗</span>
                  </td>
                  <td className={TD + BL}>{p.year}</td>
                  <td className={TD + " truncate !text-left text-xs"} title={p.batchLabel}>{p.batchLabel}</td>
                  <td className={TD + BL + " text-xs"}>{p.date}</td>
                  <td className={TD}>{p.lots > 0 ? p.lots : <Dash />}</td>
                  <td className={TD}>{qty(qtyOf(p))}</td>
                  <td className={TD}>{cancelled ? <Dash /> : money(pick(p))}</td>
                  <td className={TD + BL}>{usedPct(p) != null ? formatPercent(usedPct(p)) : <Dash />}</td>
                  <td className={TD + " text-xs"}>{remText(p)}</td>
                  <td className={TD + BL}>{cancelled ? <Dash /> : money(p.paid)}</td>
                  <td className={TD + restCls(p.rest)}>{cancelled ? <Dash /> : money(p.rest)}</td>
                </tr>
              );
            })}
            {rows.length === 0 ? <tr><td colSpan={12} className="px-3 py-6 text-center text-sm text-neutral-500">Закупок нет.</td></tr> : null}
            {extras.map((x) => (
              <tr key={x.key} className="border-b border-neutral-100 bg-neutral-50/40 text-[13px]">
                <td className="sticky left-0 z-[1] bg-white px-2 py-1.5 text-left" colSpan={1}><ExtraLabel x={x} /></td>
                <td className={TD + BL} /><td className={TD} /><td className={TD} /><td className={TD} /><td className={TD} />
                <td className={TD}>{money(x.sum)}</td>
                <td className={TD + BL} /><td className={TD} />
                <td className={TD + BL}>{money(x.paid)}</td><td className={TD}><Dash /></td>
              </tr>
            ))}
            {rows.length > 0 ? (
              <tr className="row-total">
                <td className="sticky left-0 z-[1] bg-inherit px-2 py-1.5 text-left"><TotalLabel /></td>
                <td className={TD + BL} /><td className={TD} /><td className={TD} />
                <td className={TD}>{tot.lots}</td>
                <td className={TD}>{qty(qtyOf(tot))}</td>
                <td className={TD}>{money(pick(tot) + exSum)}</td>
                <td className={TD + BL}>{usedPct(tot) != null ? formatPercent(usedPct(tot)) : <Dash />}</td>
                <td className={TD + " text-xs"}>{remText(tot)}</td>
                <td className={TD + BL}>{money(tot.paid + exPaid)}</td>
                <td className={TD + restCls(tot.rest)}>{money(tot.rest)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {footer ? <div key="footer">{footer}</div> : null}
    </section>
  );
}
