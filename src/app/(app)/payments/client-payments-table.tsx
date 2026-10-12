import { SourceDocs } from "@/components/source-docs";
import type { SourceDocsData } from "@/lib/source-docs";
import { uniqueLabelCount } from "@/lib/tz-key";
import { TH as Head, THGroup } from "@/components/table-head";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { InfoHint } from "@/components/info-hint";
import { YearGroup } from "./year-group";
import { formatMoney } from "@/lib/utils";
import { TotalLabel } from "@/components/total-label";

/** Один заказ (ТЗ), за который заказчик платил: что за изделие и сколько. */
export type PaidGood = { id: string; number: string; /** Номер ТЗ как в карточке («96»); нет — внутренний номер. */ label?: string; model: string; qty: number; batch: number | null; /** Часть этой оплаты, отнесённая на ТЗ (разнесение), ₽. */ paid: number | null; article?: string | null; fur?: string | null; /** Себестоимость ТЗ с 4% и НДС, ₽. */ cost?: number | null; /** Работа по ТЗ (к оплате заказчиком), ₽. */ work?: number | null; /** Оплачено по ТЗ всеми платежами, ₽. */ paidTotal?: number | null };

export type ClientPayRow = {
  id: string;
  date: string;
  /** Дата оплаты ГГГГ-ММ-ДД — для перехода в детализацию. */
  iso: string;
  year: number;
  amount: number;
  type: string;
  client: string;
  goods: PaidGood[];
  /** Сумма разнесения оплаты по ТЗ (все записи разнесения), ₽. */
  allocated: number;
  /** В основании платежа сказано про шкуры подрядчика (сверх работы ТЗ). */
  hidesNote: boolean;
  /** Оплачено по дате без шкур подрядчика (они — сырьё): то, что идёт в «Оплачено» за товар. */
  paid: number;
  /** К оплате по дате: часть работы ТЗ, закрываемая этой оплатой (без повторов между датами). */
  due: number;
  /** Счёт из основания платежа, найденный в Drive (когда файлов у самой оплаты нет). */
  invoiceDocs?: { title: string; url: string }[];
  /** Пояснение к оплате из карточки платежа (за что): «Аванс 70% за 82 изделия…». */
  note?: string;
  /** Основание платежа (счёт, п/п) без повтора даты — для подписи у даты без ТЗ. */
  basis?: string;
  /** Оплата нулевая: сумма вынесена в оплату закупки (номер). */
  movedTo: string | null;
  docCount: number;
  /** Документы-основания оплаты (свёрнуто). */
  sourceDocs?: SourceDocsData;
  confirmed: boolean;
  verify?: ReactNode;
  docTitle: string;
};

const qtyText = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} шт.`;

const money = (n: number) => formatMoney(n.toFixed(2));

/** Остаток по ТЗ: к оплате − оплачено всего. Жёлтый — недоплата, зелёный (+) — оплачено больше. */
function Rest({ work, paid }: { work: number | null | undefined; paid: number | null | undefined }) {
  if (work == null || work <= 0) return <span className="text-neutral-400">—</span>;
  const diff = work - (paid ?? 0);
  if (Math.abs(diff) <= 0.5) return <span className="text-neutral-500">—</span>;
  return diff > 0 ? <span className="font-medium text-amber-700">{money(diff)}</span> : <span className="font-medium text-emerald-700">+{money(-diff)}</span>;
}

/** Сумма оплаты и расхождение с тем, что разнесено на ТЗ. Остаток шкур подрядчика — не работа ТЗ, это не расхождение. */
export function SplitLine({ amount, allocated, hidesNote, movedTo }: { amount: number; allocated: number; hidesNote: boolean; movedTo: string | null }) {
  const diff = amount - allocated;
  let tail: ReactNode;
  if (amount === 0) tail = <span className="text-neutral-600">нулевая оплата{movedTo ? `: сумма вынесена в оплату закупки ${movedTo}` : ""}</span>;
  else if (Math.abs(diff) <= 0.5) tail = <span className="text-emerald-700">расхождений нет</span>;
  else if (Math.abs(diff) < 1) tail = <span className="text-neutral-600">округление {money(diff)}</span>;
  else if (diff > 0 && hidesNote) tail = <span className="text-neutral-700">{money(diff)} — сверх работы ТЗ: шкуры подрядчика (не работа, к ТЗ не относится)</span>;
  else tail = <span className="font-medium text-amber-700">не разнесено {money(diff)}</span>;
  return (
    <p className="text-sm">
      Разнесено на ТЗ: <b className="tabular-nums">{money(allocated)}</b>
      {" · "}
      {tail}
    </p>
  );
}

export function Goods({ goods }: { goods: PaidGood[] }) {
  if (goods.length === 0) return <span className="text-neutral-500">Оплата пока не привязана ни к одному ТЗ — ТЗ ещё не назначены.</span>;
  const total = goods.reduce((s, g) => s + g.qty, 0);
  const sum = (f: (g: PaidGood) => number) => goods.reduce((a, g) => a + f(g), 0);
  const work = sum((g) => g.work ?? 0);
  const paidTotal = sum((g) => g.paidTotal ?? 0);
  const left = work - paidTotal;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <th className="py-1.5 pr-2 font-medium">ТЗ</th>
            <th className="px-2 py-1.5 font-medium">Артикул</th>
            <th className="px-2 py-1.5 font-medium">Мех</th>
            <th className="px-2 py-1.5 font-medium">Партия</th>
            <Head label="Кол-во" unit="шт." align="right" className="px-2" />
            <Head label="Стоимость" unit="₽" align="right" className="px-2" />
            <Head label="Оплачено" unit="₽" align="right" className="px-2" />
            <Head label="Задолженность" unit="₽" align="right" className="px-2" />
          </tr>
        </thead>
        <tbody>
          {goods.map((g) => (
            <tr key={g.id} className="border-b border-neutral-100">
              <td className="whitespace-nowrap py-1.5 pr-2"><Link href={`/production/${g.id}`} className="text-blue-700 hover:underline">ТЗ {g.label ?? g.number} ›</Link></td>
              <td className="whitespace-nowrap px-2 py-1.5">{g.article ?? g.model}</td>
              <td className="px-2 py-1.5 text-neutral-600">{g.fur ?? "—"}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-neutral-600">{g.batch ?? "—"}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{qtyText(g.qty)}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{g.work != null ? money(g.work) : "—"}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{g.paidTotal != null ? money(g.paidTotal) : "—"}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums"><Rest work={g.work} paid={g.paidTotal} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="row-total">
            <td className="py-1.5 pr-2"><TotalLabel extra={`${uniqueLabelCount(goods.map((g) => ({ id: g.id, label: g.label })))} ТЗ`} /></td>
            <td /><td /><td />
            <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{qtyText(total)}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{money(work)}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{money(paidTotal)}</td>
            <td className={"whitespace-nowrap px-2 py-1.5 text-right tabular-nums " + (left > 0.5 ? "text-amber-700" : left < -0.5 ? "text-emerald-700" : "")}>{Math.abs(left) <= 0.5 ? "—" : left > 0 ? money(left) : `+${money(-left)}`}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Оплаты одной даты — одной строкой: дата в списке не повторяется. */
function groupByDate(list: ClientPayRow[]): { iso: string; rows: ClientPayRow[] }[] {
  const out: { iso: string; rows: ClientPayRow[] }[] = [];
  for (const r of list) {
    const g = out.find((x) => x.iso === r.iso);
    if (g) g.rows.push(r); else out.push({ iso: r.iso, rows: [r] });
  }
  return out;
}

export function ClientPaymentsTable({ rows }: { rows: ClientPayRow[] }) {
  const years = Array.from(new Set(rows.map((r) => r.year))).sort((a, b) => a - b);
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table className="w-full min-w-[1000px] table-fixed text-sm">
        <colgroup><col className="w-[170px]" /><col className="w-[110px]" /><col /><col /><col /><col className="w-[170px]" /><col className="w-[150px]" /></colgroup>
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            <th colSpan={2} />
            <THGroup colSpan={3}>Расчёт</THGroup>
            <THGroup colSpan={2}>Проверка</THGroup>
          </tr>
          <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <th className="px-3 py-2 font-medium"><span className="inline-flex items-center gap-1 whitespace-nowrap">Дата<InfoHint label="Что внутри даты"><p>Нажмите на дату оплаты — откроется страница этой даты: все оплаты за день и за какой товар они пришли (ТЗ, изделие, количество, партия).</p></InfoHint></span></th>
            <th className="px-3 py-2 font-medium">Тип</th>
            <Head label="Стоимость" unit="₽" align="right" sep className="px-3" />
            <Head label="Оплачено" unit="₽" align="right" className="px-3" />
            <Head label="Задолженность" unit="₽" align="right" className="px-3" />
            <th className="border-l border-neutral-200 px-3 py-2 font-medium">Подтверждение</th>
            <th className="px-3 py-2 font-medium">Счёт</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => {
            const list = rows.filter((r) => r.year === y);
            return (
              <YearGroup
                key={y}
                label={y}
                sub={`${groupByDate(list).length} ${groupByDate(list).length === 1 ? "дата" : "дат"}`}
                labelSpan={2}
                cells={(() => {
                  const due = list.reduce((s2, r) => s2 + r.due, 0);
                  const paid = list.reduce((s2, r) => s2 + r.paid, 0);
                  const left = due - paid;
                  return (
                    <>
                      <td className="whitespace-nowrap border-l border-neutral-200 px-3 py-2 text-right tabular-nums">{due > 0.5 ? money(due) : <span className="text-neutral-400">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(paid)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{Math.abs(left) <= 0.5 ? <span className="text-neutral-400">—</span> : left > 0 ? <span className="font-medium text-amber-700">{money(left)}</span> : <span className="font-medium text-emerald-700">+{money(-left)}</span>}</td>
                      <td colSpan={2} className="border-l border-neutral-200" />
                    </>
                  );
                })()}
              >
                {groupByDate(list).map((g) => {
                  const r = g.rows[0];
                  const many = g.rows.length > 1;
                  return (
                    <tr key={g.iso} className="border-b border-neutral-100 align-top">
                      <td className="whitespace-nowrap px-3 py-2">
                        <Link href={`/payments?tab=clients&pdate=${g.iso}`} className="text-blue-700 hover:underline" title="Открыть: что входит в эту дату">{r.date} ›</Link>
                      </td>
                      <td className="px-3 py-2">{Array.from(new Set(g.rows.map((x) => x.type))).join(", ")}</td>
                      {(() => {
                        const due = g.rows.reduce((a2, x) => a2 + x.due, 0);
                        const paid = g.rows.reduce((a2, x) => a2 + x.paid, 0);
                        const left = due - paid;
                        return (
                          <>
                            <td className="whitespace-nowrap border-l border-neutral-200 px-3 py-2 text-right tabular-nums">{due > 0.5 ? money(due) : <span className="text-neutral-400">—</span>}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(paid)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                              {Math.abs(left) <= 0.5 ? <span className="text-neutral-400">—</span> : left > 0 ? <span className="font-medium text-amber-700">{money(left)}</span> : <span className="font-medium text-emerald-700" title="оплачено больше, чем к оплате по этой дате (аванс вперёд)">+{money(-left)}</span>}
                            </td>
                          </>
                        );
                      })()}
                      <td className="border-l border-neutral-200 px-3 py-2">
                        {!many && r.verify && !r.confirmed ? (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-800">подтвердить…</summary>
                            <div className="mt-1 w-72">{r.verify}</div>
                          </details>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {(() => {
                          const links = g.rows.flatMap((x) => x.invoiceDocs ?? []);
                          const linkEls = links.map((d) => <a key={d.url} href={d.url} target="_blank" rel="noreferrer" className="mr-1 text-xs text-blue-700 hover:underline">{d.title} ↗</a>);
                          return links.length ? <>{linkEls}</> : <span className="text-neutral-400">—</span>;
                        })()}
                        {g.rows.filter((x) => x.sourceDocs).map((x, i) => (
                          <div key={i} className="mt-1"><SourceDocs compact data={x.sourceDocs!} popover="right" /></div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </YearGroup>
            );
          })}
          {rows.length === 0 ? (
            <tr><td colSpan={7} className="px-3 py-8 text-center text-neutral-500">Оплат за производство пока нет</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
