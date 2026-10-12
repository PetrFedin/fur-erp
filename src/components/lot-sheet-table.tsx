"use client";

import { useMemo, useState, type ReactNode } from "react";
import { TH as Head } from "@/components/table-head";
import { InfoHint } from "@/components/info-hint";
import { useConfirm } from "@/components/confirm-dialog";
import { TotalLabel } from "@/components/total-label";
import { COMP_CATS, CAT_LABEL, type CompCat } from "@/lib/price-composition";
import type { SheetRow } from "@/lib/lot-sheet";
import { saveLotSheetNotes } from "@/app/(app)/analytics/raw/lot/[id]/actions";
import { formatMoney } from "@/lib/utils";
import { useInlineSave, SaveStatus } from "@/components/lot-inline";

const nf = (max: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: max });
const num2 = nf(2);
const num4 = nf(4);

const FIELD = "w-full rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-xs outline-none hover:border-neutral-400 focus:border-neutral-700 focus:ring-1 focus:ring-neutral-300 disabled:opacity-60";
const money = (v: number | null) => (v == null || Math.abs(v) < 0.005 ? "—" : formatMoney(v.toFixed(2)));

type Draft = { title: string; cat: string; src: string };

/**
 * Таблица всех строк расчётного листа лота. Правятся названия для показа, категории сектора и источники (заметки к расчёту):
 * значения и цена лота не меняются — после приёмки в приложении нет безопасного пересчёта цены лота и списаний ТЗ,
 * цена и состав правятся в закупке до приёмки.
 */
export function LotSheetTable({
  lotId, rows, canEdit, sheetTotal, lotTotal, unitNode, lotNode, unitLabel, purchaseLink,
}: {
  lotId: string;
  rows: SheetRow[];
  canEdit: boolean;
  /** «Итого за готовое сырьё» из самого листа, ₽ с НДС (за лот). */
  sheetTotal: number | null;
  /** Цена лота с НДС за весь лот, ₽. */
  lotTotal: number;
  unitNode: ReactNode;
  lotNode: ReactNode;
  unitLabel: string;
  purchaseLink?: ReactNode;
}) {
  const orig = useMemo(() => new Map<number, Draft>(rows.map((r) => [r.idx, { title: r.title === r.label ? "" : r.title, cat: r.cat ?? "", src: r.src }])), [rows]);
  const [draft, setDraft] = useState<Record<number, Draft>>({});
  const s = useInlineSave();
  const { ask, node } = useConfirm();
  const cur = (r: SheetRow): Draft => draft[r.idx] ?? orig.get(r.idx)!;
  const changed = rows.filter((r) => {
    const d = draft[r.idx];
    const o = orig.get(r.idx)!;
    return d && (d.title !== o.title || d.cat !== o.cat || d.src !== o.src);
  });
  const patch = (r: SheetRow, k: keyof Draft, v: string) => setDraft((p) => ({ ...p, [r.idx]: { ...cur(r), [k]: v } }));
  const reset = () => setDraft({});
  const save = async () => {
    const ok = await ask(`Сохранить заметки к расчёту (строк: ${changed.length})? Цена лота ${unitLabel} и списания в ТЗ не изменятся: правятся только названия, категории и источники строк.`, { ok: "Сохранить" });
    if (!ok) return;
    s.run(() => saveLotSheetNotes(lotId, changed.map((r) => ({ idx: r.idx, ...(draft[r.idx] as Draft) }))), undefined);
    reset();
  };
  const diff = sheetTotal != null ? sheetTotal - lotTotal : null;
  const warn = diff != null && Math.abs(diff) > Math.max(1, lotTotal * 0.001);

  return (
    <div className="flex flex-col gap-2">
      <div className="table-scroll scroll-hint overflow-x-auto rounded-lg border border-neutral-200 bg-white p-3">
        <table className="w-full min-w-[46rem] table-fixed text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs font-medium text-neutral-500">
              <th className="w-[26%] px-1.5 py-1.5">Статья расчёта</th>
              <th className="w-[17%] px-1.5 py-1.5">Категория сектора</th>
              <th className="w-[11%] px-1.5 py-1.5 text-right">Значение</th>
              <Head label="На шкуру" unit="₽" align="right" className="w-[10%] px-1.5" />
              <Head label="Всего по лоту" unit="₽" align="right" className="w-[12%] px-1.5" />
              <Head label="в т.ч. НДС" unit="₽" align="right" className="w-[9%] px-1.5" />
              <th className="w-[15%] px-1.5 py-1.5">Источник</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = cur(r);
              const dirty = changed.includes(r);
              const catKey = (d.cat || r.autoCat || "") as CompCat | "";
              return (
                <tr key={r.idx} className={"border-b border-neutral-100 align-top " + (r.info ? "text-neutral-500" : "") + (dirty ? " bg-amber-50/50" : "")}>
                  <td className="px-1.5 py-1.5">
                    {canEdit ? (
                      <input aria-label={`Название статьи: ${r.label}`} className={FIELD} value={d.title} placeholder={r.label} maxLength={200} onChange={(e) => patch(r, "title", e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") patch(r, "title", orig.get(r.idx)!.title); }} />
                    ) : (
                      <span className="break-words">{r.title}</span>
                    )}
                    {r.title !== r.label && !canEdit ? <span className="block text-[11px] text-neutral-400">в расчёте: {r.label}</span> : null}
                  </td>
                  <td className="px-1.5 py-1.5">
                    {canEdit ? (
                      <select aria-label={`Категория: ${r.label}`} className={FIELD} value={d.cat} onChange={(e) => patch(r, "cat", e.target.value)}>
                        <option value="">{r.autoCat ? `${CAT_LABEL[r.autoCat]} (авто)` : "справочно (авто)"}</option>
                        {COMP_CATS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs">{catKey ? CAT_LABEL[catKey] : "справочно"}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">
                    {r.unit === "курс" ? num4.format(r.value) : r.unit === "%" ? `${num2.format(r.value)}%` : `${num2.format(r.value)}${r.unit === "$" ? " $" : ""}`}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{money(r.perUnit)}</td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{money(r.perLot)}</td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{money(r.vat)}</td>
                  <td className="px-1.5 py-1.5">
                    {canEdit ? (
                      <input aria-label={`Источник: ${r.label}`} className={FIELD} value={d.src} maxLength={200} onChange={(e) => patch(r, "src", e.target.value)} />
                    ) : (
                      <span className="break-words text-xs">{r.src}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr className="row-total">
              <td className="px-1.5 py-1.5" colSpan={3}><TotalLabel unit={`₽/${unitLabel.replace(/^за /, "")}`} note="цена лота" /></td>
              <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{unitNode}</td>
              <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{lotNode}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
      {warn ? (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          Итог расчётного листа ≠ цене лота на {formatMoney(Math.abs(diff!).toFixed(2))} ₽ (лист: {formatMoney((sheetTotal as number).toFixed(2))}, лот: {formatMoney(lotTotal.toFixed(2))}, с НДС).
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-xs print:hidden">
        {canEdit ? (
          <>
            <button type="button" disabled={changed.length === 0 || s.pending} onClick={save} className="btn-accent h-7 rounded-md border px-2 text-xs disabled:opacity-40">Сохранить заметки к расчёту{changed.length ? ` (${changed.length})` : ""}</button>
            <button type="button" disabled={changed.length === 0 || s.pending} onClick={reset} className="h-7 rounded-md border border-neutral-300 px-2 text-xs disabled:opacity-40">Отменить</button>
          </>
        ) : null}
        <SaveStatus pending={s.pending} saved={s.saved} error={s.error} />
        <InfoHint label="Что можно править в расчёте" wide>
          <p>Правятся названия для показа, категория сектора и источник строки. Значения, цена лота и списания ТЗ здесь не меняются: после приёмки в приложении нет безопасного пересчёта цены лота и себестоимости списаний, поэтому добавить или удалить статью нельзя.</p>
          <p className="mt-1">Цена, количество и состав расчёта правятся в закупке (пока она не принята и лот не списан). Категория вручную — пометка к таблице; график состава считается по расчёту.</p>
          <p className="mt-1">«На шкуру» и «Всего по лоту» определены по названию строки: в расчётных листах вперемешку суммы за лот и за шкуру. Для строк в $, курсов и процентов рублёвые столбцы пусты.</p>
        </InfoHint>
        {purchaseLink}
      </div>
      {node}
    </div>
  );
}
