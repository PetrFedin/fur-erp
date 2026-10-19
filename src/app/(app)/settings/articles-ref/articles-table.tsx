"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { articleKey, searchArticleList } from "@/lib/article-key";
import { LocalFilterBar } from "@/components/filters/filter-bar";
import type { CategorySelectOption } from "@/components/category-select";
import Link from "next/link";
import { mergeArticles, deleteArticle } from "./actions";
import { ArticleForm } from "@/app/(app)/models/article-form";
import { saveArticleForm } from "@/app/(app)/models/actions";
import { DeleteEntityButton } from "@/components/delete-entity-button";
import { ICON_BTN, IconPencil } from "@/components/icons";
import { formatMoney, formatQty } from "@/lib/utils";

export type ArticleRow = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  categoryRefId: string | null;
  salesCode: string | null;
  salesName: string | null;
  aliases: string[];
  lengthClass?: string | null;
  isActive: boolean;
  sellingPrice: number | null;
  seasons: string[];
  tzCount: number;
  produced: number;
  /** Почему артикул нельзя удалить (есть ТЗ, план, остатки); null — можно. */
  deleteBlocker?: string | null;
  description?: string | null;
};

type SortKey = "name" | "category" | "salesCode" | "price" | "tz" | "produced";
const fmtPrice = (n: number | null) => (n == null ? "—" : formatMoney(n));
const fmtQty = (n: number) => formatQty(n);

function MergePanel({ source, rows, onClose }: { source: ArticleRow; rows: ArticleRow[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<ArticleRow | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const found = useMemo(() => searchArticleList(rows.filter((r) => r.id !== source.id), q, 8), [rows, source.id, q]);
  return (
    <div className="flex flex-col gap-2 bg-amber-50 p-3 text-sm">
      <p>
        Объединить <b>{source.name}</b> (ТЗ: {source.tzCount}) с другим артикулом. Все ТЗ, плановые поставки, остатки и движения готовой продукции переедут
        в выбранный, а код и написания <b>{source.name}</b> станут его другими написаниями. Запись <b>{source.name}</b> будет удалена.
      </p>
      {!target ? (
        <>
          <Input autoFocus placeholder="Какой артикул оставить (код, название, код продаж…)" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-md" />
          <ul className="flex max-w-md flex-col">
            {found.map((h) => (
              <li key={h.article.id}>
                <button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-amber-100" onClick={() => setTarget(rows.find((r) => r.id === h.article.id)!)}>
                  <b>{h.article.name}</b> <span className="text-neutral-500">{(h.article.category ?? "").replace(/\s+/g, " ")}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>
          Оставить: <b>{target.name}</b> <button type="button" className="text-blue-700 underline" onClick={() => setTarget(null)}>выбрать другой</button>
        </p>
      )}
      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{err}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={!target || pending}
          onClick={() =>
            start(async () => {
              const r = await mergeArticles(source.id, target!.id);
              if (r.error) setErr(r.error);
              else onClose();
            })
          }
        >
          {pending ? "Объединяю…" : "Объединить"}
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>Отмена</Button>
      </div>
    </div>
  );
}

/** Фильтры панели: q — поиск (наш код, код продаж, название, другое написание), sales=none — без кода продаж, status=active — только активные. */
export type ArticleFilters = { q: string; noSales: boolean; onlyActive: boolean };

export function ArticlesRefTable({ rows, canEdit, categories = [], canCreateCategory = false, initial = { q: "", noSales: false, onlyActive: false } }: { rows: ArticleRow[]; canEdit: boolean; categories?: CategorySelectOption[]; canCreateCategory?: boolean; initial?: ArticleFilters }) {
  const [q, setQ] = useState(initial.q);
  const [onlyNoSales, setOnlyNoSales] = useState(initial.noSales);
  const [onlyActive, setOnlyActive] = useState(initial.onlyActive);

  // Состояние фильтров — в адресной строке (q, sales, status), без перезагрузки страницы.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      const url = new URL(window.location.href);
      for (const n of ["q", "sales", "status"]) url.searchParams.delete(n);
      if (q.trim()) url.searchParams.set("q", q.trim());
      if (onlyNoSales) url.searchParams.set("sales", "none");
      if (onlyActive) url.searchParams.set("status", "active");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch {
      /* адресная строка недоступна — фильтры работают и без неё */
    }
  }, [q, onlyNoSales, onlyActive]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [editing, setEditing] = useState<string | null>(null);
  const [merging, setMerging] = useState<string | null>(null);

  const view = useMemo(() => {
    let list = rows;
    if (q.trim()) {
      const ids = new Set(searchArticleList(rows, q, 500).map((h) => h.article.id));
      list = list.filter((r) => ids.has(r.id));
    }
    if (onlyNoSales) list = list.filter((r) => !r.salesCode?.trim());
    if (onlyActive) list = list.filter((r) => r.isActive);
    const val = (r: ArticleRow): string | number => {
      switch (sort.key) {
        case "name": return articleKey(r.name);
        case "category": return (r.category ?? "").toLowerCase();
        case "salesCode": return (r.salesCode ?? "").toLowerCase();
        case "price": return r.sellingPrice ?? -1;
        case "tz": return r.tzCount;
        case "produced": return r.produced;
      }
    };
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ru", { numeric: true });
      return c * sort.dir || a.name.localeCompare(b.name, "ru", { numeric: true });
    });
  }, [rows, q, onlyNoSales, onlyActive, sort]);

  const noSales = rows.filter((r) => !r.salesCode?.trim()).length;
  const th = (label: string, key: SortKey, cls = "") => (
    <Th className={cls}>
      <button type="button" className="hover:underline" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </button>
    </Th>
  );

  return (
    <div className="flex flex-col gap-3">
      <LocalFilterBar
        title="Фильтры артикулов"
        controls={[
          { type: "text", name: "q", label: "Поиск", placeholder: "Наш код, код в продажах, название, другое написание" },
          { type: "multi", name: "sales", label: "Код продаж", single: true, allLabel: "Все", options: [{ value: "none", label: `Без кода продаж (${noSales})` }] },
          { type: "multi", name: "status", label: "Статус", single: true, allLabel: "Все", options: [{ value: "active", label: "Только активные" }] },
        ]}
        values={{ q: q ? [q] : [], sales: onlyNoSales ? ["none"] : [], status: onlyActive ? ["active"] : [] }}
        onChange={(name, v) => {
          if (name === "q") setQ(v[0] ?? "");
          else if (name === "sales") setOnlyNoSales(v.length > 0);
          else setOnlyActive(v.length > 0);
        }}
        onReset={() => { setQ(""); setOnlyNoSales(false); setOnlyActive(false); }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-neutral-500">Показано {view.length} из {rows.length}</span>
        <span className="ml-auto flex gap-2">
          <a href="/settings/articles-ref/export" className="inline-flex h-8 items-center rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium hover:bg-neutral-50">Скачать CSV</a>
          {canEdit && <Link href="/models/new" className="inline-flex h-8 items-center rounded-md bg-neutral-900 px-3 text-xs font-medium text-white hover:bg-neutral-800">+ Новый артикул</Link>}
        </span>
      </div>

      <Table>
        <Thead>
          <Tr>
            {th("Наш код", "name")}
            {th("Категория / название", "category")}
            <Th>SKU</Th>
            <Th>Длина</Th>
            {th("Код и название в продажах", "salesCode")}
            <Th>Другие написания</Th>
            {th("Цена, сезон", "price")}
            {th("ТЗ", "tz", "text-right")}
            {th("Готово", "produced", "text-right")}
            <Th>Статус</Th>
            {canEdit && <Th />}
          </Tr>
        </Thead>
        <Tbody>
          {view.map((r) => {
            const noCode = !r.salesCode?.trim();
            const cols = canEdit ? 11 : 10;
            return (
              <Fragment key={r.id}>
                <Tr>
                  <Td className="whitespace-nowrap font-medium">{r.name}</Td>
                  <Td className="max-w-xs text-neutral-600">{(r.category ?? "").replace(/\s+/g, " ") || "—"}</Td>
                  <Td>{r.sku ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{r.lengthClass ?? "—"}</Td>
                  <Td className="min-w-48">
                    {noCode && !r.salesName ? (
                      <span className="text-neutral-400">—</span>
                    ) : (
                      <>
                        <div className="font-medium">{r.salesCode ?? <span className="text-amber-700">кода нет</span>}</div>
                        {r.salesName && <div className="line-clamp-2 text-xs text-neutral-500">{r.salesName}</div>}
                      </>
                    )}
                  </Td>
                  <Td className="max-w-56 text-xs text-neutral-600">{r.aliases.length ? r.aliases.join(", ") : "—"}</Td>
                  <Td className="whitespace-nowrap">
                    {fmtPrice(r.sellingPrice)}
                    {r.seasons.length > 0 && <div className="text-xs text-neutral-500">{r.seasons.join(", ")}</div>}
                  </Td>
                  <Td className="text-right">{r.tzCount}</Td>
                  <Td className="text-right">{fmtQty(r.produced)}</Td>
                  <Td><Badge variant={r.isActive ? "success" : "default"}>{r.isActive ? "Активен" : "Не активен"}</Badge></Td>
                  {canEdit && (
                    <Td className="whitespace-nowrap">
                      <button type="button" className={ICON_BTN} onClick={() => { setEditing(editing === r.id ? null : r.id); setMerging(null); }} title="Изменить" aria-label="Изменить"><IconPencil /></button>
                      <button type="button" className="ml-3 text-neutral-500 hover:underline" onClick={() => { setMerging(merging === r.id ? null : r.id); setEditing(null); }}>Объединить…</button>
                      <span className="ml-3 inline-block align-middle">
                        <DeleteEntityButton
                          label="Удалить" variant="ghost" className="h-auto px-0 py-0 text-neutral-500 hover:underline" showReason={false}
                          confirmText={`Удалить артикул ${r.name}? Это нельзя отменить. Нормы расхода артикула удалятся вместе с ним.`}
                          blockedReason={r.deleteBlocker}
                          action={() => deleteArticle(r.id)}
                        />
                      </span>
                    </Td>
                  )}
                </Tr>
                {editing === r.id && (
                  <Tr>
                    <Td colSpan={cols} className="bg-neutral-50 p-3">
                      <ArticleForm
                        mode="edit" embedded
                        action={saveArticleForm.bind(null, r.id)}
                        categories={categories}
                        canCreateCategory={canCreateCategory}
                        onCancel={() => setEditing(null)}
                        initial={{
                          name: r.name, sku: r.sku ?? "", lengthClass: r.lengthClass ?? "", salesCode: r.salesCode ?? "", salesName: r.salesName ?? "",
                          aliases: r.aliases.join(", "), category: (r.category ?? "").replace(/\s+/g, " ").trim(), categoryRefId: r.categoryRefId,
                          sellingPrice: r.sellingPrice == null ? "" : String(r.sellingPrice).replace(".", ","), description: r.description ?? "", isActive: r.isActive,
                        }}
                      />
                      {r.deleteBlocker && <p className="mt-1 text-xs text-neutral-500">Удалить нельзя: {r.deleteBlocker}</p>}
                    </Td>
                  </Tr>
                )}
                {merging === r.id && (
                  <Tr><Td colSpan={cols} className="p-0"><MergePanel source={r} rows={rows} onClose={() => setMerging(null)} /></Td></Tr>
                )}
              </Fragment>
            );
          })}
          {view.length === 0 && (
            <Tr><Td colSpan={canEdit ? 11 : 10} className="py-8 text-center text-neutral-500">Ничего не найдено</Td></Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
