import Link from "next/link";
import { Decimal } from "@prisma/client/runtime/library";
import type { Commission4Mode } from "@/lib/commission4-mode";
import type { TzPos } from "@/lib/order-label";
import { orderKey, articlesWord } from "@/lib/tz-key";
import { orderLabel, orderHint, posText } from "@/lib/order-label";
import { TzGroupRows } from "../tz-group-rows";
import { DeliveredSwitch } from "../delivered-switch";
import { Tr, Td } from "@/components/ui/table";
import { Money } from "@/components/money";
import { VatLabel } from "@/components/vat-label";
import { orderColorNames } from "@/lib/order-filter-options";
import { formatMoney, formatQty, formatDec1 } from "@/lib/utils";
import { batchLabel } from "@/lib/batch-label";
import { RowCard } from "@/components/responsive-rows";
import { ArticleName } from "@/components/article-name";
import { articleLabel } from "@/lib/article-label";
import { TzVatBadge } from "@/components/tz-vat-badge";
import { vatBreakdown } from "@/lib/tz-vat";
import type { ListOrder } from "./config";
import type { Deliv, Full, StatOf } from "./stat";

type P = { o: ListOrder; total: Decimal; totalExcl: Decimal };

export type RowCtx = {
  c4: string;
  c4Mode: Commission4Mode;
  canEdit: boolean;
  showClient: boolean;
  showContractor: boolean;
  tzPos: Map<string, TzPos>;
  furOf: Map<string, string>;
  cards: React.ReactNode[];
  fullOf: (o: ListOrder, total: Decimal, totalExcl: Decimal) => Full;
  statOf: StatOf;
  labelOf: (o: ListOrder) => string;
  matchOf: (o: ListOrder) => { rank: number; label: string | null } | null;
  delivOf: (o: ListOrder) => Deliv;
  delivNote: (o: ListOrder) => string | undefined;
};

/** Строки списка ТЗ: позиция (строка + карточка для телефона) и строка-ТЗ с несколькими артикулами. */
export function makeRowRenderers({ c4, c4Mode, canEdit, showClient, showContractor, tzPos, furOf, cards, fullOf, statOf, labelOf, matchOf, delivOf, delivNote }: RowCtx) {
  const renderPos = ({ o, total, totalExcl }: P, child: boolean) => {
            const href = `/production/${o.id}`;
            const vatB = vatBreakdown(o.materialUsages, c4Mode);
            const full = fullOf(o, total, totalExcl);
            const st = statOf(o, full);
            const fur = furOf.get(o.id) || "–";
            const card = (
              <RowCard
                key={o.id}
                title={`${labelOf(o)}${matchOf(o)?.label ? ` (${matchOf(o)!.label})` : ""}`}
                href={href}
                subtitle={`${articleLabel(o.productModel)}${fur !== "–" ? ` · ${fur}` : ""}`}
                fields={[
                  {
                    label: <VatLabel base={`Себестоимость с работой${c4}`} />,
                    value: full.incl.isZero() ? "–" : <><Money incl={full.incl} excl={full.excl} /></>,
                    strong: true,
                  },
                  { label: "Изделий", value: st.units > 0 ? `${formatQty(st.units)} шт.` : "–" },
                ]}
                details={[
                  { label: "Шкур", value: st.hides > 0 ? formatDec1(st.hides) : undefined },
                  { label: <VatLabel base="Мех" />, value: st.fur.incl.isZero() ? undefined : <Money incl={st.fur.incl} excl={st.fur.excl} /> },
                  { label: "Подкладка, м", value: st.liningQty > 0 ? formatDec1(st.liningQty) : undefined },
                  { label: <VatLabel base="Подкладка" />, value: st.lining.incl.isZero() ? undefined : <Money incl={st.lining.incl} excl={st.lining.excl} /> },
                  { label: "Работа", value: st.work > 0 ? formatMoney(Math.round(st.work)) : undefined },
                  { label: "Партия пошива", value: o.batch ? batchLabel(o.batch.number, o.batch.year, [o]) : "вне партий" },
                  { label: "Цвет", value: orderColorNames(o).join("; ") || undefined },
                  { label: "Заказчик", value: o.client?.name },
                  { label: "Ставка НДС", value: <TzVatBadge b={vatB} /> },
                  { label: "Word ТЗ", value: <a href={`/api/production/${o.id}/word`} className="inline-flex min-h-11 items-center text-blue-700 hover:underline">Открыть Word</a> },
                ]}
              />
            );
            const cell = "p-0";
            const link = "block px-3 py-2";
            const num = `${cell} text-right tabular-nums`;
            const dash = <span className="text-neutral-500">–</span>;
            // «Без 4%» — не на экране, а в подсказке при наведении.
            const nt = (n: { incl: Decimal; excl: Decimal } | null) => (n ? { title: `Без 4%: ${formatMoney(Math.round(n.incl.toNumber()))} ₽ с НДС` } : {});
            const tr = (
              <Tr key={o.id} className={child ? "cursor-pointer bg-neutral-50/70" : "cursor-pointer"}>
                <Td className={`${cell} font-medium`}>
                  {o.batch ? (
                    <Link href={`/production/batches/${o.batch.number}`} className={`${link} whitespace-nowrap hover:underline`} title={`Партия пошива ${o.batch.number}${o.batch.year ? `, ${o.batch.year}` : ""}`}>{o.batch.number}</Link>
                  ) : (
                    <Link href={`${href}#card-batch`} className={link} title="Партия не указана — откройте ТЗ и выберите или введите партию">
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-300">–</span>
                    </Link>
                  )}
                </Td>
                <Td className={`${cell} font-medium`}>
                  <Link href={href} className={`${link} whitespace-nowrap hover:underline`}>
                    {child ? <span className="pl-4 text-xs font-normal text-neutral-600" title={orderHint(o)}>{[posText(tzPos.get(o.id)?.posIndex, tzPos.get(o.id)?.posCount), articleLabel(o.productModel)].filter(Boolean).join(" · ")}</span> : <span title={orderHint(o)}>{labelOf(o)}</span>}
                    {matchOf(o)?.label && <span className="ml-2 text-xs font-normal text-neutral-500">({matchOf(o)!.label})</span>}
                  </Link>
                  <a href={`/api/production/${o.id}/word`} className="block px-3 pb-2 text-xs font-normal text-blue-700 hover:underline" title="Финальный Word этого ТЗ">Word</a>
                </Td>
                <Td className={cell}>
                  {o.status === "CANCELLED" ? <span className={`${link} text-xs text-neutral-500`}>отменено</span> : <DeliveredSwitch ids={delivOf(o) === "off" ? [o.id] : []} state={delivOf(o)} note={delivNote(o)} canEdit={canEdit} units={st.units} label={`ТЗ ${labelOf(o)}`} />}
                </Td>
                <Td className={`${cell} text-neutral-700`}><Link href={href} className={`${link} whitespace-nowrap`}>{fur}</Link></Td>
                <Td className={cell}>
                  <div className={`${link} max-w-[16rem]`}>
                    <Link href={`/models/${o.productModel.id}`} className="hover:underline" title="Открыть артикул"><ArticleName model={o.productModel} compact /></Link>
                    <Link href={href} className="block truncate text-xs text-neutral-500 hover:underline">{[o.productModel.category?.trim(), orderColorNames(o).join("; "), showClient ? o.client?.name : "", showContractor ? o.contractor?.name : ""].filter(Boolean).join(" · ")}</Link>
                  </div>
                </Td>
                <Td className={`${num} border-l border-neutral-200`}><Link href={href} className={link}>{st.units > 0 ? formatQty(st.units) : dash}</Link></Td>
                <Td className={num}><Link href={href} className={link}>{st.hides > 0 ? formatDec1(st.hides) : dash}</Link></Td>
                <Td className={`${num} border-l border-neutral-200`}><Link href={href} className={link} {...nt(st.furNoC4)}>{st.fur.incl.isZero() ? dash : <Money incl={st.fur.incl} excl={st.fur.excl} />}</Link></Td>
                <Td className={num}><Link href={href} className={link}>{st.liningQty > 0 ? formatDec1(st.liningQty) : dash}</Link></Td>
                <Td className={num}><Link href={href} className={link} {...nt(st.liningNoC4)}>{st.lining.incl.isZero() ? dash : <Money incl={st.lining.incl} excl={st.lining.excl} />}</Link></Td>
                <Td className={`${num} border-l border-neutral-200`}><Link href={href} className={link}>{st.work > 0 ? formatMoney(Math.round(st.work)) : dash}</Link></Td>
                <Td className={`${num} font-medium`}>
                  <Link href={href} className={link} {...nt(st.noC4)}>
                    {full.incl.isZero() ? dash : <Money incl={full.incl} excl={full.excl} />}
                  </Link>
                </Td>
                <Td className={cell}><Link href={href} className={`${link} whitespace-nowrap`}>{vatB.kind === "22" ? null : <TzVatBadge b={vatB} compact hint={false} />}</Link></Td>
              </Tr>
            );
    return { card, tr };
  };

  // Строка-ТЗ с несколькими артикулами: суммы по позициям (каждая позиция — отдельная запись, итоги не двоятся).
  const renderGroup = (g: P[]) => {
    const rows = g.map((x) => {
      const full = fullOf(x.o, x.total, x.totalExcl);
      return { x, full, st: statOf(x.o, full) };
    });
    const zero = () => ({ incl: new Decimal(0), excl: new Decimal(0) });
    const add = (a: { incl: Decimal; excl: Decimal }, b: { incl: Decimal; excl: Decimal }) => ({ incl: a.incl.add(b.incl), excl: a.excl.add(b.excl) });
    const tot = rows.reduce((a, r) => ({
      units: a.units + r.st.units, hides: a.hides + r.st.hides, liningQty: a.liningQty + r.st.liningQty, work: a.work + r.st.work,
      fur: add(a.fur, r.st.fur), lining: add(a.lining, r.st.lining), full: add(a.full, r.full),
    }), { units: 0, hides: 0, liningQty: 0, work: 0, fur: zero(), lining: zero(), full: zero() });
    const first = g[0].o;
    const tzNo = orderLabel({ workOrderNumber: first.workOrderNumber, number: first.number });
    const batches = Array.from(new Set(g.map((x) => x.o.batch?.number ?? null)));
    const furs = Array.from(new Set(g.flatMap((x) => (furOf.get(x.o.id) || "–").split(" + "))));
    const models = Array.from(new Set(g.map((x) => articleLabel(x.o.productModel))));
    const count = `${g.length} ${articlesWord(g.length)}`;
    const cell = "p-0";
    const link = "block px-3 py-2";
    const num = `${cell} text-right tabular-nums`;
    const dash = <span className="text-neutral-500">–</span>;
    const firstHref = `/production/${first.id}`;
    const children = rows.map((r) => renderPos(r.x, true).tr);
    const match = g.map((x) => matchOf(x.o)?.label).find(Boolean);
    cards.push(
      <RowCard
        key={`tz-${orderKey(first)}`}
        title={`${tzNo} · ${count}`}
        subtitle={`${models.slice(0, 4).join(", ")}${models.length > 4 ? "…" : ""}${furs[0] !== "–" ? ` · ${furs.join(" + ")}` : ""}${match ? ` (${match})` : ""}`}
        badge={<span className="text-xs text-neutral-500">один ТЗ</span>}
        fields={[
          { label: <VatLabel base={`Себестоимость с работой${c4}`} />, value: tot.full.incl.isZero() ? "–" : <Money incl={tot.full.incl} excl={tot.full.excl} />, strong: true },
          { label: "Изделий", value: tot.units > 0 ? `${formatQty(tot.units)} шт.` : "–" },
        ]}
        details={[
          { label: "Партия пошива", value: batches.length === 1 && first.batch ? batchLabel(first.batch.number, first.batch.year, [first]) : batches.length > 1 ? "несколько" : "вне партий" },
          { label: "Работа", value: tot.work > 0 ? formatMoney(Math.round(tot.work)) : undefined },
          ...rows.map((r) => ({
            key: r.x.o.id,
            label: <Link href={`/production/${r.x.o.id}`} className="text-blue-700 hover:underline">{articleLabel(r.x.o.productModel)}</Link>,
            value: `${r.st.units > 0 ? `${formatQty(r.st.units)} шт.` : "–"} · ${labelOf(r.x.o)}`,
          })),
        ]}
      />,
    );
    return (
      <TzGroupRows
        key={`tz-${orderKey(first)}`}
        count={count}
        n={g.length}
        href={firstHref}
        before={
          <Td className={`${cell} font-medium`}>
            {batches.length === 1 && first.batch ? (
              <Link href={`/production/batches/${first.batch.number}`} className={`${link} whitespace-nowrap hover:underline`} title={`Партия пошива ${first.batch.number}${first.batch.year ? `, ${first.batch.year}` : ""}`}>{first.batch.number}</Link>
            ) : batches.length > 1 ? <span className={`${link} text-xs text-neutral-500`}>несколько</span> : (
              <Link href={`${firstHref}#card-batch`} className={link}><span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-300">–</span></Link>
            )}
          </Td>
        }
        label={<>{tzNo}{match ? <span className="ml-2 text-xs font-normal text-neutral-500">({match})</span> : null}</>}
        after={
          <>
            <Td className={cell}>
              <DeliveredSwitch
                ids={g.filter((x) => delivOf(x.o) === "off" && x.o.status !== "CANCELLED").map((x) => x.o.id)}
                state={(() => { const st2 = g.filter((x) => x.o.status !== "CANCELLED").map((x) => delivOf(x.o)); return st2.every((v) => v === "on") ? "on" : st2.every((v) => v === "off") ? "off" : "partial"; })()}
                note={g.map((x) => delivNote(x.o)).find(Boolean)}
                canEdit={canEdit}
                units={g.filter((x) => delivOf(x.o) === "off" && x.o.status !== "CANCELLED").reduce((a, x) => a + Number(x.o.plannedQuantity), 0)}
                label={`ТЗ ${tzNo}`}
              />
            </Td>
            <Td className={`${cell} text-neutral-700`}><span className={`${link} whitespace-nowrap`}>{furs.join(" + ")}</span></Td>
            <Td className={cell}><span className={`${link} max-w-[16rem] truncate text-xs text-neutral-600`}>{models.join(", ")}</span></Td>
            <Td className={`${num} border-l border-neutral-200`}><span className={link}>{tot.units > 0 ? formatQty(tot.units) : dash}</span></Td>
            <Td className={num}><span className={link}>{tot.hides > 0 ? formatDec1(tot.hides) : dash}</span></Td>
            <Td className={`${num} border-l border-neutral-200`}><span className={link}>{tot.fur.incl.isZero() ? dash : <Money incl={tot.fur.incl} excl={tot.fur.excl} />}</span></Td>
            <Td className={num}><span className={link}>{tot.liningQty > 0 ? formatDec1(tot.liningQty) : dash}</span></Td>
            <Td className={num}><span className={link}>{tot.lining.incl.isZero() ? dash : <Money incl={tot.lining.incl} excl={tot.lining.excl} />}</span></Td>
            <Td className={`${num} border-l border-neutral-200`}><span className={link}>{tot.work > 0 ? formatMoney(Math.round(tot.work)) : dash}</span></Td>
            <Td className={`${num} font-medium`}><span className={link}>{tot.full.incl.isZero() ? dash : <Money incl={tot.full.incl} excl={tot.full.excl} />}</span></Td>
            <Td className={cell}><span className={link} /></Td>
          </>
        }
      >
        {children}
      </TzGroupRows>
    );
  };
  return { renderPos, renderGroup };
}
