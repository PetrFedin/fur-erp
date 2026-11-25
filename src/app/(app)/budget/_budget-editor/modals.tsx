"use client";

import { formatPercent } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { effUp, normKey, srcInfo, type BudgetNode, type BudgetParams, type BudgetStat } from "@/lib/budget-calc";
import { BTN, BTN_PRIMARY, FIELD, Modal } from "../ui";
import type { ImportRow } from "../actions";
import type { UpKey } from "./parts";

/** Окна редактора бюджета: источник статистики, надбавки (все и одной строки), предпросмотр загрузки из файла. */
export function StatModal({ statFor, byId, pairOptions, setStat, setStatFor }: { statFor: string; byId: Map<string, BudgetNode>; pairOptions: BudgetStat[]; setStat: (id: string, key: string) => void; setStatFor: (id: string | null) => void }) {
  return (
        <Modal title={`Данные системы: ${byId.get(statFor)?.name}`} onClose={() => setStatFor(null)}>
          <p className="mb-2 text-xs text-neutral-500">{srcInfo(byId.get(statFor)!).label}. Выберите, по какой статистике «мех × категория» считать эту категорию. «По названию» — мех блока и название категории.</p>
          <select aria-label="Статистика системы" className={FIELD} value={`${byId.get(statFor)?.statFur ?? ""}|${byId.get(statFor)?.statCat ?? ""}`} onChange={(e) => { setStat(statFor, e.target.value); setStatFor(null); }}>
            <option value="|">По названию</option>
            {byId.get(statFor)?.statFur && !pairOptions.some((x) => x.key === `${byId.get(statFor)?.statFur}|${byId.get(statFor)?.statCat}`) ? <option value={`${byId.get(statFor)?.statFur}|${byId.get(statFor)?.statCat}`}>{byId.get(statFor)?.statFur} · {byId.get(statFor)?.statCat}</option> : null}
            {pairOptions.map((x) => <option key={x.key} value={x.key}>{x.fur} · {x.cat} ({x.qty} изд.)</option>)}
          </select>
        </Modal>
  );
}

export function UpAllModal({ kids, byId, params, setUp, setUpAll }: { kids: Map<string | null, BudgetNode[]>; byId: Map<string, BudgetNode>; params: BudgetParams; setUp: (id: string, k: UpKey, v: number | null) => void; setUpAll: (v: boolean) => void }) {
  return (
        <Modal title="Надбавки по типам меха и категориям" onClose={() => setUpAll(false)} wide>
          <div className="mb-3 text-xs text-neutral-500">Пустое поле — с уровня выше. Общие надбавки версии: {formatPercent(params.upFur)} / {formatPercent(params.upLining)} / {formatPercent(params.upWork)}.<InfoHint label="Как работают надбавки" wide><p>Пустое поле — берётся с уровня выше (в подсказке поля то, что действует сейчас). 0 — без надбавки. Строки с замком не пересчитываются.</p></InfoHint></div>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white"><tr className="border-b border-neutral-200 text-left text-xs text-neutral-500"><th className="py-1 font-medium">Тип меха · категория</th><th className="w-20 px-1 text-right font-medium">Шкура, %</th><th className="w-20 px-1 text-right font-medium">Подкладка, %</th><th className="w-20 px-1 text-right font-medium">Работа, %</th></tr></thead>
              <tbody>
                {(() => {
                  // Порядок: тип меха → все его категории → длины категории (Short / Regular / Long).
                  const rows: BudgetNode[] = [];
                  for (const fur of kids.get(null) ?? []) {
                    rows.push(fur);
                    for (const cat of (kids.get(fur.id) ?? []).filter((x) => x.kind === "cat")) {
                      rows.push(cat);
                      for (const len of (kids.get(cat.id) ?? []).filter((x) => x.kind === "len")) rows.push(len);
                    }
                  }
                  return rows;
                })().map((n) => {
                  const par = n.parentId ? byId.get(n.parentId) : undefined;
                  const inh = par ? effUp(par, byId, params) : null;
                  return (
                    <tr key={n.id} className={"border-t border-neutral-100 " + (n.kind === "fur" ? "bg-neutral-50 font-semibold" : "")}>
                      <td className={"py-1 pr-2 " + (n.kind === "cat" ? "pl-4 font-normal" : n.kind === "len" ? "pl-8 font-normal text-neutral-600" : "")}>{n.name}{n.locked ? <span className="ml-1 text-[11px]" title="Замок: не пересчитывается">🔒</span> : null}</td>
                      {(["upFur", "upLining", "upWork"] as const).map((k) => {
                        const cur = inh ? (k === "upFur" ? inh.fur : k === "upLining" ? inh.lining : inh.work) : params[k];
                        return (
                          <td key={k} className="px-1 py-0.5">
                            <input type="text" inputMode="decimal" defaultValue={typeof n[k] === "number" ? String(n[k]).replace(".", ",") : ""} placeholder={String(cur).replace(".", ",")} aria-label={`${n.name}: ${k === "upFur" ? "шкура" : k === "upLining" ? "подкладка" : "работа"}, %`}
                              onChange={(e) => { const t = e.target.value.trim().replace(",", "."); const x = Number(t); setUp(n.id, k, t === "" || !Number.isFinite(x) ? null : x); }}
                              className="ui-field w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-right text-sm tabular-nums focus-visible:outline-none" />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end border-t border-neutral-200 pt-3"><button type="button" className={BTN_PRIMARY} onClick={() => setUpAll(false)}>Готово</button></div>
        </Modal>
  );
}

export function UpNodeModal({ upNode, byId, params, setUp, setUpFor }: { upNode: BudgetNode; byId: Map<string, BudgetNode>; params: BudgetParams; setUp: (id: string, k: UpKey, v: number | null) => void; setUpFor: (id: string | null) => void }) {
  return (
        <Modal title={`Надбавки: ${upNode.name}`} onClose={() => setUpFor(null)}>
          <div className="mb-3 text-xs text-neutral-500">Для этой строки и всего, что внутри. Пустое поле — с уровня выше.<InfoHint label="Как работают надбавки" wide><p>Пустое поле — берётся с уровня выше (в подсказке поля то, что действует сейчас). 0 — без надбавки.</p></InfoHint></div>
          <div className="grid grid-cols-3 gap-3">
            {([["upFur", "Шкура, %"], ["upLining", "Подкладка, %"], ["upWork", "Работа, %"]] as const).map(([k, label]) => {
              const parent = upNode.parentId ? byId.get(upNode.parentId) : undefined;
              const inh = parent ? effUp(parent, byId, params) : null;
              const cur = inh ? (k === "upFur" ? inh.fur : k === "upLining" ? inh.lining : inh.work) : params[k];
              return (
                <label key={k} className="flex flex-col gap-1 text-xs text-neutral-500">{label}
                  <input type="text" inputMode="decimal" defaultValue={typeof upNode[k] === "number" ? String(upNode[k]).replace(".", ",") : ""} placeholder={String(cur).replace(".", ",")} aria-label={label}
                    onChange={(e) => { const t = e.target.value.trim().replace(",", "."); const x = Number(t); setUp(upNode.id, k, t === "" || !Number.isFinite(x) ? null : x); }}
                    className={FIELD + " text-right"} />
                </label>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end border-t border-neutral-200 pt-3"><button type="button" className={BTN_PRIMARY} onClick={() => setUpFor(null)}>Готово</button></div>
        </Modal>
  );
}

export function ImportPreviewModal({ preview, importStats, setPreview, applyImport }: { preview: { rows: ImportRow[]; warnings: string[]; sheet: string; fileName: string }; importStats: { newFurs: number; exist: number; lynx: number } | null; setPreview: (v: null) => void; applyImport: () => void }) {
  return (
        <Modal title="Загрузка из файла" onClose={() => setPreview(null)} wide>
          <p className="text-sm text-neutral-800">Файл «{preview.fileName}»{preview.sheet ? `, лист «${preview.sheet}»` : ""}: будет добавлено или обновлено <b>{preview.rows.length}</b> строк.</p>
          <p className="mt-1 text-xs text-neutral-500">
            {importStats ? `Новых типов сырья: ${importStats.newFurs}. Уже есть в бюджете (значения обновятся): ${importStats.exist}.` : ""}
            {importStats?.lynx ? ` Строки «Рысь» (${importStats.lynx}) после загрузки закроются замком.` : ""} Остальные строки бюджета не меняются; цены без значений в файле заполнятся по данным системы.
          </p>
          {preview.warnings.length ? <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">{preview.warnings.slice(0, 5).map((w) => <li key={w}>{w}</li>)}</ul> : null}
          <div className="mt-3 max-h-[40vh] overflow-auto rounded-md border border-neutral-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white text-neutral-500 [&>tr]:border-b [&>tr]:border-neutral-200"><tr><th className="px-2 py-1 text-left font-medium">Тип сырья</th><th className="px-2 py-1 text-left font-medium">Категория</th><th className="px-2 py-1 text-right font-medium">Бюджет, шт.</th><th className="px-2 py-1 text-left font-medium">Значения</th></tr></thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className="border-t border-neutral-100"><td className="px-2 py-1">{r.fur}</td><td className="px-2 py-1">{r.cat}</td><td className="px-2 py-1 text-right tabular-nums">{r.pcs}</td>
                    <td className="px-2 py-1 text-neutral-500">{[r.hides, r.hidePrice, r.meters, r.meterPrice, r.work].some((v) => v != null) ? "из файла" : normKey(r.fur) === "рысь" ? "ручные (рысь)" : "по данным системы"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end border-t border-neutral-200 pt-3 gap-2">
            <button type="button" className={BTN} onClick={() => setPreview(null)}>Отмена</button>
            <button type="button" className={BTN_PRIMARY} onClick={applyImport}>Добавить {preview.rows.length} строк</button>
          </div>
        </Modal>
  );
}
