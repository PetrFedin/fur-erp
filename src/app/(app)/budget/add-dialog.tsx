"use client";

import { useState } from "react";
import { BTN_PRIMARY, FIELD, Modal } from "./ui";

export type ArticleOpt = { id: string; label: string; hint: string; search: string; cat: string };
export type AddKind = "fur" | "cat" | "art";

const TITLES: Record<AddKind, { title: string; ph: string; custom: string }> = {
  fur: { title: "Добавить тип сырья", ph: "Поиск или своё название (Норка+Соболь, Лиса…)", custom: "Добавить тип сырья" },
  cat: { title: "Добавить категорию", ph: "Поиск или своё название категории", custom: "Добавить категорию" },
  art: { title: "Добавить артикул", ph: "Код или название артикула", custom: "Новый плановый артикул" },
};

/**
 * Выбор из справочника (меха /settings/furs, категории /settings/categories, артикулы системы) либо своё название.
 * Свой артикул — плановый: существует только в бюджете, каталог изделий не меняется.
 */
export function AddDialog({ kind, names, articles, taken, catName, context, onClose, onPick }: {
  kind: AddKind; names: string[]; articles: ArticleOpt[]; taken: string[]; catName?: string; context?: string; onClose: () => void;
  onPick: (v: { name: string; modelId: string | null }) => void;
}) {
  const [q, setQ] = useState("");
  const [allArt, setAllArt] = useState(false);
  const t = TITLES[kind];
  const cn = (catName ?? "").trim().toLowerCase();
  const inCat = (a: ArticleOpt) => !!cn && a.cat.trim().toLowerCase() === cn;
  const catCount = kind === "art" ? articles.filter(inCat).length : 0;
  const byCat = kind === "art" && !!cn && !allArt && catCount > 0;
  const ql = q.trim().toLowerCase();
  const list: Array<{ key: string; label: string; hint?: string; modelId: string | null }> =
    kind === "art"
      ? articles.filter((a) => (!byCat || inCat(a)) && (!ql || a.search.includes(ql) || a.label.toLowerCase().includes(ql))).slice(0, 80).map((a) => ({ key: a.id, label: a.label, hint: a.hint, modelId: a.id }))
      : names.filter((n) => !ql || n.toLowerCase().includes(ql)).map((n) => ({ key: n, label: n, modelId: null }));
  const exact = list.some((x) => x.label.toLowerCase() === ql);
  const isTaken = (x: { label: string; modelId: string | null }) => taken.includes(kind === "art" ? (x.modelId ?? "") : x.label.toLowerCase());
  return (
    <Modal title={t.title} onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        {kind === "art" && context ? <p className="text-xs text-neutral-500">{context}</p> : null}
        {kind === "art" && cn && catCount > 0 ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-500">{byCat ? `Показаны артикулы категории «${catName}»: ${catCount}` : "Показаны все артикулы системы"}</span>
            <button type="button" onClick={() => setAllArt((v) => !v)} className="text-blue-700 hover:underline">{byCat ? "Показать все" : "Только этой категории"}</button>
          </div>
        ) : null}
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.ph} className={FIELD} aria-label="Поиск" maxLength={120}
          onKeyDown={(e) => { if (e.key === "Enter" && q.trim() && !exact && list.length === 0) onPick({ name: q.trim(), modelId: null }); }} />
        {q.trim() && !exact ? (
          <button type="button" onClick={() => onPick({ name: q.trim(), modelId: null })} className={BTN_PRIMARY + " justify-start"}>
            + {t.custom}: «{q.trim()}»
          </button>
        ) : null}
        <ul className="-mx-1 max-h-[50vh] overflow-y-auto">
          {list.map((x) => {
            const used = isTaken(x);
            return (
              <li key={x.key}>
                <button type="button" disabled={used} title={x.hint} onClick={() => onPick({ name: x.label, modelId: x.modelId })}
                  className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-50 disabled:text-neutral-400 disabled:hover:bg-transparent">
                  <span>{x.label}</span>{used ? <span className="text-[11px] text-neutral-400">уже добавлено</span> : null}
                </button>
              </li>
            );
          })}
          {list.length === 0 ? <li className="px-2 py-3 text-xs text-neutral-500">{kind === "art" ? "Артикул не найден в системе — можно создать плановый." : "Нет в справочнике — можно добавить своё название."}</li> : null}
        </ul>
        {kind === "art" ? <p className="text-[11px] text-neutral-500">Плановый артикул живёт только в этом бюджете и не создаёт изделие в каталоге.</p> : null}
      </div>
    </Modal>
  );
}
