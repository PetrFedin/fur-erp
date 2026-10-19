"use client";

import { useRef } from "react";

export type ZiSumView = {
  label: string;
  items: { supply: string; boutique: string; size: string; sheet: string; row: number | null; sum: number; vat: number }[];
  /** ЗИ из файлов поставок, в которых есть эти строки. */
  zi: { supply: string; numbers: string[] }[];
  files: { supply: string; fileName: string; docId: string }[];
  /** Сверка с ТЗ (полный текст), если это первая строка ТЗ. */
  check?: string;
};

const money = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Сумма накладной — ссылка: по клику окно «Откуда цифра» (строки накладных ЗИ, арифметика, файл). */
export function ZiSumButton({ v, total }: { v: ZiSumView; total: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => ref.current?.close();
  const incl = r2(v.items.reduce((t, i) => t + i.sum + i.vat, 0));
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className="inline-flex min-h-11 min-w-11 items-center justify-end px-1 text-blue-700 underline decoration-dotted underline-offset-2 hover:text-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 md:min-h-0" aria-label={`Откуда цифра ${money(total)} ₽, ${v.label}`} data-zi-source>
        {money(total)}
      </button>
      <dialog
        ref={ref}
        onClick={(e) => { if (e.target === ref.current) close(); }}
        className="m-auto w-[calc(100vw-2rem)] max-w-lg rounded-xl border border-neutral-200 bg-white p-0 text-left shadow-xl backdrop:bg-black/40 max-sm:m-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
        aria-label="Откуда цифра"
      >
        <div className="flex max-h-[85vh] flex-col max-sm:h-dvh max-sm:max-h-none">
          <div className="flex items-start justify-between gap-2 border-b border-neutral-200 px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-neutral-900">Откуда цифра</h2>
              <p className="text-xs text-neutral-500">{v.label} · накладная ЦУМ (ЗИ)</p>
            </div>
            <button type="button" onClick={close} className="min-h-11 min-w-11 rounded-md px-3 text-sm text-neutral-700 hover:bg-neutral-100" aria-label="Закрыть">✕</button>
          </div>
          <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3 text-sm">
            <p className="text-2xl font-semibold tabular-nums">{money(total)} ₽ <span className="text-xs font-normal text-neutral-500">с НДС</span></p>
            <ul className="flex flex-col gap-1 text-xs" data-zi-invoice-lines>
              {v.items.map((l, i) => (
                <li key={i} className="rounded border border-neutral-200 px-2 py-1">
                  <span className="font-medium">{l.supply}</span> · {l.boutique} · р. {l.size} · лист {l.sheet}{l.row ? `, строка ${l.row}` : ""}: {money(l.sum)} без НДС + НДС {money(l.vat)} ({l.sum ? Math.round((l.vat / l.sum) * 100) : 0}%) = <b>{money(r2(l.sum + l.vat))}</b> ₽ с НДС
                </li>
              ))}
            </ul>
            {v.check && <p className="text-xs font-medium text-neutral-800">Сверка с ТЗ (себестоимость с работой, с НДС, с 4%): {v.check}</p>}
            <p className="text-xs text-neutral-600">Итого с НДС: {money(incl)} ₽ (без НДС {money(r2(v.items.reduce((t, i) => t + i.sum, 0)))} ₽). ЗИ в файлах: {v.zi.map((z) => `${z.supply} — ${z.numbers.join(", ")}`).join("; ")}. Какая строка к какому ЗИ относится, файл не говорит.</p>
          </div>
          <div className="flex justify-end gap-2 border-t border-neutral-200 px-4 py-3">
            {v.files.map((f) => (
              <a key={f.docId} href={`/api/drive-docs/${f.docId}?download=1`} className="inline-flex min-h-11 items-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700">Открыть файл {f.supply}</a>
            ))}
            <button type="button" onClick={close} className="min-h-11 rounded-md border border-neutral-300 px-4 text-sm hover:bg-neutral-50">Закрыть</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
