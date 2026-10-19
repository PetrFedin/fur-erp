"use client";

import { useRef } from "react";

export type ZiInvoiceLine = { supply: string; boutique: string; size: string; sum: number; vat: number };
export type ZiDiffView = {
  article: string;
  orderPrice: number;
  invoicePrice: number;
  diff: number;
  fileName: string;
  docId: string | null;
  sheet: string;
  row: number;
  orderCell: string;
  invoiceCell: string;
  diffCell: string;
  invoiceLines: ZiInvoiceLine[];
  /** ЗИ из файлов поставок, в которых есть строки этого артикула. */
  zi: { supply: string; numbers: string[] }[];
  anchors: string[];
};

const money = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Цифра-ссылка: по клику окно «Откуда цифра» (файл, лист, строка, ячейка; для накладной — строки ЗИ и арифметика). */
export function ZiSourceButton({ v, which }: { v: ZiDiffView; which: "order" | "invoice" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const value = which === "order" ? v.orderPrice : v.invoicePrice;
  const cell = which === "order" ? v.orderCell : v.invoiceCell;
  const col = which === "order" ? "заказ" : "поставщик";
  const close = () => ref.current?.close();
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className="inline-flex min-h-11 min-w-11 items-center justify-end px-1 text-blue-700 underline decoration-dotted underline-offset-2 hover:text-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 md:min-h-0" aria-label={`Откуда цифра ${money(value)} ₽, ${v.article}`} data-zi-source={which}>
        {money(value)}
      </button>
      <dialog
        ref={ref}
        onClick={(e) => { if (e.target === ref.current) close(); }}
        className="m-auto w-[calc(100vw-2rem)] max-w-lg rounded-xl border border-neutral-200 bg-white p-0 text-left shadow-xl backdrop:bg-black/40 max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
        aria-label="Откуда цифра"
      >
        <div className="flex max-h-[85vh] flex-col max-sm:max-h-none max-sm:h-dvh">
          <div className="flex items-start justify-between gap-2 border-b border-neutral-200 px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-neutral-900">Откуда цифра</h2>
              <p className="text-xs text-neutral-500">{v.article} · {which === "order" ? "заказ ЦУМ" : "накладная поставщика"}</p>
            </div>
            <button type="button" onClick={close} className="min-h-11 min-w-11 rounded-md px-3 text-sm text-neutral-700 hover:bg-neutral-100" aria-label="Закрыть">✕</button>
          </div>
          <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3 text-sm">
            <p className="text-2xl font-semibold tabular-nums">{money(value)} ₽</p>
            <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1">
              <dt className="text-neutral-500">Файл</dt><dd className="break-all">{v.fileName}</dd>
              <dt className="text-neutral-500">Лист</dt><dd>{v.sheet}</dd>
              <dt className="text-neutral-500">Колонка</dt><dd>«{col}»</dd>
              <dt className="text-neutral-500">Строка</dt><dd>{v.row}</dd>
              <dt className="text-neutral-500">Ячейка</dt><dd className="font-medium">{cell}</dd>
            </dl>
            <p className="text-xs text-neutral-600">Цена за единицу с НДС, как в листе сверки.{which === "order" ? " Это цифра заказа ЦУМ из файла, мы её не пересчитывали." : ""}</p>
            {which === "invoice" && (
              <div className="flex flex-col gap-1" data-zi-invoice-lines>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Строки накладных, из которых получена цена</h3>
                <ul className="flex flex-col gap-1 text-xs">
                  {v.invoiceLines.map((l, i) => (
                    <li key={i} className="rounded border border-neutral-200 px-2 py-1">
                      <span className="font-medium">{l.supply}</span> · {l.boutique} · р. {l.size}: {money(l.sum)} без НДС + НДС {money(l.vat)} ({l.sum ? Math.round((l.vat / l.sum) * 100) : 0}%) = <b>{money(Math.round((l.sum + l.vat) * 100) / 100)}</b> ₽
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-neutral-600">ЗИ в этих файлах: {v.zi.map((z) => `${z.supply} — ${z.numbers.join(", ")}`).join("; ")}. Какая строка к какому ЗИ относится, файл не говорит.</p>
              </div>
            )}
            <p className="text-xs">
              Разница в листе: ячейка {v.diffCell} = {money(v.diff)} ₽ (заказ − накладная).
              {v.anchors.length > 0 && <> <a href={`#${v.anchors[0]}`} onClick={close} className="inline-flex min-h-11 items-center text-blue-700 underline">Показать в таблице приёмки выше</a></>}
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-neutral-200 px-4 py-3">
            {v.docId && <a href={`/api/drive-docs/${v.docId}?download=1`} className="inline-flex min-h-11 items-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700">Открыть файл</a>}
            <button type="button" onClick={close} className="min-h-11 rounded-md border border-neutral-300 px-4 text-sm hover:bg-neutral-50">Закрыть</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
