"use client";

import { useState } from "react";
import { LENGTHS } from "@/lib/budget-calc";
import { BTN_PRIMARY, FIELD, Modal, SEG_BOX, segBtn } from "./ui";

export type ArticleOpt = { id: string; label: string; hint: string; search: string; cat: string };
export type AddKind = "fur" | "cat" | "len" | "art";

const TITLES: Record<AddKind, { title: string; ph: string; custom: string }> = {
  fur: { title: "Добавить тип сырья", ph: "Поиск или своё название (Норка+Соболь, Лиса…)", custom: "Добавить тип сырья" },
  cat: { title: "Добавить категорию", ph: "Поиск или своё название категории", custom: "Добавить категорию" },
  art: { title: "Добавить артикул", ph: "Код или название артикула", custom: "Новый плановый артикул" },
  len: { title: "Добавить длину", ph: "", custom: "" },
};

/**
 * Выбор из справочника (меха /settings/furs, категории /settings/categories, артикулы системы) либо своё название.
 * Свой артикул — плановый: существует только в бюджете, каталог изделий не меняется.
 */
export function AddDialog({ kind: kind0, names, articles, taken, catName, context, lenMode, takenLens, pairLabel, onClose, onPick }: {
  kind: AddKind; names: string[]; articles: ArticleOpt[]; taken: string[]; catName?: string; context?: string; onClose: () => void;
  /** Для склейки «мех × категория»: можно добавить длину. "both" — артикул или длина на выбор, "only" — только длина (у категории уже есть длины). Без признака длина не предлагается. */
  lenMode?: "both" | "only"; takenLens?: string[]; pairLabel?: string;
  onPick: (v: { name: string; modelId: string | null; kind: AddKind }) => void;
}) {
  const [asLen, setAsLen] = useState(lenMode === "only");
  const kind: AddKind = kind0 === "art" && lenMode && asLen ? "len" : kind0;
  const [q, setQ] = useState("");
  const [allArt, setAllArt] = useState(false);
  const t = TITLES[kind];
  const cn = (catName ?? "").trim().toLowerCase();
  const inCat = (a: ArticleOpt) => !!cn && a.cat.trim().toLowerCase() === cn;
  const catCount = kind === "art" ? articles.filter(inCat).length : 0;
  const byCat = kind === "art" && !!cn && !allArt && catCount > 0;
  const ql = q.trim().toLowerCase();
  const list: Array<{ key: string; label: string; hint?: string; modelId: string | null }> =
    kind === "len"
      ? LENGTHS.map((l) => ({ key: l, label: l, modelId: null }))
      : kind === "art"
      ? articles.filter((a) => (!byCat || inCat(a)) && (!ql || a.search.includes(ql) || a.label.toLowerCase().includes(ql))).slice(0, 80).map((a) => ({ key: a.id, label: a.label, hint: a.hint, modelId: a.id }))
      : names.filter((n) => !ql || n.toLowerCase().includes(ql)).map((n) => ({ key: n, label: n, modelId: null }));
  const exact = list.some((x) => x.label.toLowerCase() === ql);
  const isTaken = (x: { label: string; modelId: string | null }) => (kind === "len" ? (takenLens ?? []).includes(x.label.toLowerCase()) : taken.includes(kind === "art" ? (x.modelId ?? "") : x.label.toLowerCase()));
  const pick = (v: { name: string; modelId: string | null }) => onPick({ ...v, kind });
  return (
    <Modal title={lenMode === "both" ? "Добавить артикул или длину" : t.title} onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        {lenMode === "both" ? (
          <div className={SEG_BOX + " self-start"} role="group" aria-label="Что добавить">
            <button type="button" className={segBtn(!asLen)} aria-pressed={!asLen} onClick={() => { setAsLen(false); setQ(""); }}>Артикул</button>
            <button type="button" className={segBtn(asLen)} aria-pressed={asLen} onClick={() => { setAsLen(true); setQ(""); }}>Длина</button>
          </div>
        ) : null}
        {kind === "len" ? <p className="text-xs text-neutral-500">{lenMode === "only" ? "Категория уже разбита по длинам: артикулы добавляются внутрь длины. " : ""}Длина добавится в «{pairLabel}». Штуки категории станут суммой по длинам.</p> : null}
        {kind === "art" && context ? <p className="text-xs text-neutral-500">{context}</p> : null}
        {kind === "art" && cn && catCount > 0 ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-500">{byCat ? `Показаны артикулы категории «${catName}»: ${catCount}` : "Показаны все артикулы системы"}</span>
            <button type="button" onClick={() => setAllArt((v) => !v)} className="text-blue-700 hover:underline">{byCat ? "Показать все" : "Только этой категории"}</button>
          </div>
        ) : null}
        {kind !== "len" ? <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.ph} className={FIELD} aria-label="Поиск" maxLength={120}
          onKeyDown={(e) => { if (e.key === "Enter" && q.trim() && !exact && list.length === 0) pick({ name: q.trim(), modelId: null }); }} /> : null}
        {kind !== "len" && q.trim() && !exact ? (
          <button type="button" onClick={() => pick({ name: q.trim(), modelId: null })} className={BTN_PRIMARY + " justify-start"}>
            + {t.custom}: «{q.trim()}»
          </button>
        ) : null}
        <ul className="-mx-1 max-h-[50vh] divide-y divide-neutral-100 overflow-y-auto border-t border-neutral-200">
          {list.map((x) => {
            const used = isTaken(x);
            return (
              <li key={x.key}>
                <button type="button" disabled={used} title={x.hint} onClick={() => pick({ name: x.label, modelId: x.modelId })}
                  className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ui-field border border-transparent hover:bg-neutral-50 disabled:text-neutral-600 disabled:hover:bg-transparent">
                  <span>{x.label}</span>{used ? <span className="text-[11px] text-neutral-600">уже добавлено</span> : null}
                </button>
              </li>
            );
          })}
          {list.length === 0 ? <li className="px-2 py-3 text-xs text-neutral-500">{kind === "art" ? "Артикул не найден в системе — можно создать плановый." : "Нет в справочнике — можно добавить своё название."}</li> : null}
        </ul>
        {kind === "art" ? <p className="border-t border-neutral-200 pt-2 text-[11px] text-neutral-500">Плановый артикул живёт только в этом бюджете и не создаёт изделие в каталоге.</p> : null}
      </div>
    </Modal>
  );
}
