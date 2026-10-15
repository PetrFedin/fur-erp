import { Clamp } from "@/components/clamp";
import Link from "next/link";
import { TH as Head } from "@/components/table-head";
import type { ReactNode } from "react";
import { formatMoney } from "@/lib/utils";
import { TotalLabel } from "@/components/total-label";
import { SourceDocs } from "@/components/source-docs";
import type { SourceDocsData } from "@/lib/source-docs";
import { bareNo } from "@/lib/payment-parties";

/** Одна оплата в упрощённом виде: что, когда, сколько, подтверждена ли и есть ли файлы. */
export type PayLine = {
  id: string;
  date: string;
  amount: string;
  what: string;
  /** Счёт, по которому платили (номер и дата), со ссылкой на закупку, если известна. */
  invoice?: { text: string; href?: string };
  /** Основание без номера п/п и повторов даты: счёт, письмо и т. п. */
  comment?: string;
  ppNo: string | null;
  confirmed: boolean;
  status: "COMPLETED" | "PENDING" | "CANCELLED";
  overdue?: boolean;
  docCount: number;
  /** Документы-основания оплаты (свёрнуто). */
  sourceDocs?: SourceDocsData;
  /** Кнопки «Изменить / удалить» — прячутся под «⋯». */
  controls?: ReactNode;
};

/** Какие файлы к оплате нужны — подсказка под таблицей и у оплаты без файлов. */

export function PaymentLinesTable({ lines, emptyText }: { lines: PayLine[]; emptyText: string }) {
  const hasComment = lines.some((l) => Boolean(l.comment));
  const hasDocs = lines.some((l) => l.sourceDocs);
  if (lines.length === 0) return <p className="rounded-md bg-neutral-50 px-3 py-4 text-center text-sm text-neutral-500">{emptyText}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <th className="py-1.5 pr-2 font-medium">Дата</th>
            <Head label="Сумма" unit="₽" align="right" className="px-2" />
            <th className="px-2 py-1.5 font-medium">Оплата</th>
            <th className="px-2 py-1.5 font-medium">Счёт</th>
            {hasComment ? <th className="px-2 py-1.5 font-medium">Комментарий</th> : null}
            <th className="px-2 py-1.5 font-medium">П/п</th>
            {hasDocs ? <th className="px-2 py-1.5 font-medium">Документы-основания</th> : null}
            <th className="px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className={"border-b border-neutral-100 align-top" + (l.status !== "COMPLETED" ? " opacity-60" : "")}>
              <td className="whitespace-nowrap py-2 pr-2">{l.date}</td>
              <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums">{formatMoney(l.amount)}</td>
              <td className="px-2 py-2">
                {l.what}
              </td>
              <td className="whitespace-nowrap px-2 py-2">
                {l.invoice ? (l.invoice.href ? <Link href={l.invoice.href} className="text-blue-700 hover:underline">{l.invoice.text}</Link> : l.invoice.text) : <span className="text-neutral-400">—</span>}
              </td>
              {hasComment ? <td className="max-w-[18rem] px-2 py-2 text-xs text-neutral-600"><Clamp>{l.comment ?? ""}</Clamp></td> : null}
              <td className="whitespace-nowrap px-2 py-2 text-neutral-600">{l.ppNo ? bareNo(l.ppNo) : "—"}</td>
              {hasDocs ? <td className="px-2 py-2">{l.sourceDocs ? <SourceDocs compact data={l.sourceDocs} /> : <span className="text-neutral-400">—</span>}</td> : null}
              <td className="px-2 py-2 text-right">
                {l.controls ? (
                  <details className="relative inline-block text-left">
                    <summary className="cursor-pointer list-none rounded px-2 py-0.5 text-neutral-500 hover:bg-neutral-100" aria-label="Изменить оплату">⋯</summary>
                    <div className="absolute right-0 z-10 mt-1 w-80 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg">{l.controls}</div>
                  </details>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Закупка группы: за что платим и сколько оплачено / осталось. */
export type PurchaseLine = {
  id: string;
  number: string;
  invoice: string | null;
  note: string | null;
  total: string;
  paid: string;
  due: string;
  received: boolean;
};

export function PurchaseLinesTable({ lines, withPaid }: { lines: PurchaseLine[]; withPaid: boolean }) {
  const sum = (k: "total" | "paid" | "due") => lines.reduce((s, l) => s + Number(l[k]), 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <th className="py-1.5 pr-2 font-medium">Закупка</th>
            <th className="px-2 py-1.5 font-medium">Мех</th>
            <Head label="Стоимость" unit="₽" align="right" className="px-2" />
            {withPaid ? <Head label="Оплачено" unit="₽" align="right" className="px-2" /> : null}
            {withPaid ? <Head label="Остаток" unit="₽" align="right" className="px-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const due = Number(l.due);
            return (
              <tr key={l.id} className="border-b border-neutral-100">
                <td className="py-2 pr-2">
                  <Link href={`/purchases/${l.id}`} className="text-blue-700 hover:underline">{l.number}</Link>
                  {l.invoice ? <span className="block text-xs text-neutral-500">счёт {l.invoice}</span> : null}
                </td>
                <td className="max-w-[18rem] px-2 py-2 text-neutral-600"><Clamp>{l.note ?? "—"}</Clamp></td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatMoney(l.total)}</td>
                {withPaid ? <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatMoney(l.paid)}</td> : null}
                {withPaid ? (
                  <td className={"whitespace-nowrap px-2 py-2 text-right font-medium tabular-nums " + (due > 0.5 ? "text-amber-700" : due < -0.5 ? "text-emerald-700" : "")}>
                    {Math.abs(due) <= 0.5 ? "—" : formatMoney(String(due))}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="row-total">
            <td className="py-2 pr-2"><TotalLabel /></td>
            <td />
            <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatMoney(String(sum("total")))}</td>
            {withPaid ? <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatMoney(String(sum("paid")))}</td> : null}
            {withPaid ? <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatMoney(String(sum("due")))}</td> : null}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
