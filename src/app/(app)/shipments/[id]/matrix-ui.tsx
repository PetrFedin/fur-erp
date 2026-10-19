"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useConfirm } from "@/components/confirm-dialog";
import { clearAlloc, fillAllocFromZi, saveAlloc } from "../alloc-actions";
import { ALLOC_SITES, fmtDelta, lineDiff, sumDiff, validateAlloc, type AllocState, type ZiSite } from "@/lib/shipment-alloc";
import { formatMoneyExact } from "@/lib/utils";

export type MatrixRow = { id: string; label: string; article: string; color: string; size: string; order: string; quantity: number; accepted: number; returned: number; ziSites: ZiSite[] };
type DRej = { id: string; site: string; size: string; qty: string; reason: string };

const money = (n: number) => formatMoneyExact(n).replace(/\u00a0₽$/, "");
const uid = () => Math.random().toString(36).slice(2, 12);
const num = (s: string | undefined) => { const n = Number((s ?? "").replace(/\s/g, "")); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").trim();
const STICKY = "sticky left-0 z-[1] bg-white";

/**
 * Уровень 2 приёмки — матрица «позиции × площадки»: количества правятся в ячейках (пусто = 0), справа Σ, принято в Коптево и остаток.
 * Суммы ₽ с НДС — по площадкам, строкой под матрицей. «Не принято» — отдельный столбец с раскрытием (размер, количество, причина).
 * Сохраняется одной кнопкой; всё проверяется ещё и на сервере (только OWNER/ADMIN/TECHNOLOGIST).
 */
export function SitesMatrix({ shipmentId, rows, state, ziOrder, invoiceTotal, tzTotal }: { shipmentId: string; rows: MatrixRow[]; state: AllocState | null; ziOrder: string[]; invoiceTotal: number; tzTotal: number | null }) {
  const router = useRouter();
  const { ask, node } = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sites, setSites] = useState<string[]>(state?.sites ?? ziOrder);
  const [cells, setCells] = useState<Record<string, Record<string, string>>>(() => Object.fromEntries(Object.entries(state?.lines ?? {}).map(([id, l]) => [id, Object.fromEntries(Object.entries(l.cells).map(([k, v]) => [k, String(v)]))])));
  const [rej, setRej] = useState<Record<string, DRej[]>>(() => Object.fromEntries(Object.entries(state?.lines ?? {}).map(([id, l]) => [id, l.rej.map((r) => ({ id: r.id, site: r.site, size: r.size, qty: String(r.qty), reason: r.reason }))])));
  const [sums, setSums] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(state?.sums ?? {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])));
  const [dirty, setDirty] = useState(false);
  const [openRej, setOpenRej] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newSite, setNewSite] = useState("");
  const [renaming, setRenaming] = useState<{ site: string; value: string } | null>(null);

  const touch = () => { setDirty(true); setError(null); };
  const setCell = (id: string, site: string, v: string) => { touch(); setCells((p) => ({ ...p, [id]: { ...(p[id] ?? {}), [site]: v.replace(/[^\d]/g, "").slice(0, 4) } })); };
  const rejOf = (id: string) => rej[id] ?? [];
  const rejQty = (id: string) => rejOf(id).reduce((t, r) => t + num(r.qty), 0);
  const distributed = (r: MatrixRow) => sites.reduce((t, s) => t + num(cells[r.id]?.[s]), 0) + rejQty(r.id);
  const siteTotal = (s: string) => rows.reduce((t, r) => t + num(cells[r.id]?.[s]), 0);
  const siteUsed = (s: string) => siteTotal(s) > 0 || !!sums[s] || Object.values(rej).some((l) => l.some((x) => norm(x.site) === norm(s)));
  const zi = (s: string) => { let q = 0, sum = 0; for (const r of rows) for (const z of r.ziSites) if (norm(z.site) === norm(s)) { q += z.qty; sum += z.sum; } return { q, sum: Math.round(sum * 100) / 100 }; };
  const enteredSum = sites.reduce((t, s) => t + (Number((sums[s] ?? "").replace(/\s/g, "").replace(",", ".")) || 0), 0);

  const input = () => ({
    sites,
    cells: Object.fromEntries(rows.map((r) => [r.id, Object.fromEntries(sites.map((s) => [s, cells[r.id]?.[s] ?? ""]))])),
    rej: Object.fromEntries(rows.map((r) => [r.id, rejOf(r.id).map((x) => ({ id: x.id, site: x.site, size: x.size, qty: x.qty, reason: x.reason }))])),
    sums,
  });
  const save = () => {
    const ctx = Object.fromEntries(rows.map((r) => [r.id, { quantity: r.quantity, accepted: r.accepted, label: r.label }]));
    const pre = validateAlloc(input(), ctx, "", "");
    if ("error" in pre) return setError(pre.error);
    start(async () => { const res = await saveAlloc(shipmentId, input()); if (res.error) return setError(res.error); setDirty(false); router.refresh(); });
  };
  const fill = async () => {
    if ((dirty || state) && !(await ask("Заполнить по накладным ЗИ? Прежние правки матрицы будут заменены.", { ok: "Заполнить", danger: false }))) return;
    start(async () => { const res = await fillAllocFromZi(shipmentId); if (res.error) return setError(res.error); setDirty(false); router.refresh(); });
  };
  const clear = async () => {
    if (!(await ask("Очистить всю раскладку по площадкам?", { ok: "Очистить", danger: true }))) return;
    start(async () => { const res = await clearAlloc(shipmentId); if (res.error) return setError(res.error); setCells({}); setRej({}); setSums({}); setDirty(false); router.refresh(); });
  };
  const addSite = (name: string) => {
    const n = name.replace(/\s+/g, " ").trim();
    if (!n) return setError("Укажите название площадки");
    if (n.length > 60) return setError("Название площадки не длиннее 60 символов");
    if (sites.some((s) => norm(s) === norm(n))) return setError(`Площадка «${n}» уже есть`);
    if (sites.length >= 12) return setError("Не больше 12 площадок");
    touch(); setSites((p) => [...p, n]); setAdding(false); setNewSite("");
  };
  const rename = () => {
    if (!renaming) return;
    const n = renaming.value.replace(/\s+/g, " ").trim();
    if (!n) return setError("Укажите название площадки");
    if (sites.some((s) => s !== renaming.site && norm(s) === norm(n))) return setError(`Площадка «${n}» уже есть`);
    touch();
    setSites((p) => p.map((s) => (s === renaming.site ? n : s)));
    setCells((p) => Object.fromEntries(Object.entries(p).map(([id, m]) => [id, Object.fromEntries(Object.entries(m).map(([k, v]) => [k === renaming.site ? n : k, v]))])));
    setSums((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k === renaming.site ? n : k, v])));
    setRej((p) => Object.fromEntries(Object.entries(p).map(([id, l]) => [id, l.map((x) => (x.site === renaming.site ? { ...x, site: n } : x))])));
    setRenaming(null);
  };
  const free = ALLOC_SITES.filter((s) => !sites.some((x) => norm(x) === norm(s)));
  const totRej = rows.reduce((t, r) => t + rejQty(r.id), 0);
  const totAll = rows.reduce((t, r) => t + distributed(r), 0);
  const totAcc = rows.reduce((t, r) => t + r.accepted, 0);
  const sd = enteredSum > 0 ? sumDiff(enteredSum, invoiceTotal) : null;
  const colSpan = sites.length + 5;

  return (
    <div className="flex flex-col gap-2" data-sites-matrix>
      {node}
      <div className="flex flex-wrap items-center gap-1">
        <Button type="button" size="sm" variant="outline" className="max-md:h-11" disabled={pending} onClick={() => setAdding((v) => !v)}>+ Площадка</Button>
        <Button type="button" size="sm" variant="outline" className="max-md:h-11" disabled={pending} onClick={() => void fill()}>Как в накладных</Button>
        <Button type="button" size="sm" variant="ghost" className="max-md:h-11" disabled={pending || (!state && !dirty)} onClick={() => void clear()}>Очистить</Button>
        <Button type="button" size="sm" className="ml-auto max-md:h-11" disabled={pending || !dirty} onClick={save}>{pending ? "Сохраняем…" : "Сохранить"}</Button>
      </div>
      {adding && (
        <div className="flex flex-wrap items-center gap-1 rounded border border-neutral-200 bg-neutral-50 p-2">
          <Select className="h-8 w-44 max-md:h-11" aria-label="Площадка из справочника" value="" onChange={(e) => { if (e.target.value) addSite(e.target.value); }}>
            <option value="">Из справочника…</option>
            {free.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Input className="h-8 w-44 max-md:h-11" maxLength={60} value={newSite} placeholder="Другая площадка…" aria-label="Другая площадка" onChange={(e) => setNewSite(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addSite(newSite); }} />
          <Button type="button" size="sm" variant="outline" className="max-md:h-11" onClick={() => addSite(newSite)}>Добавить</Button>
        </div>
      )}
      {error && <p role="alert" className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
      <div className="table-keep scroll-hint max-w-full overflow-x-auto rounded-lg border border-neutral-200 bg-white" title="Таблица прокручивается вбок, первая колонка закреплена">
        <table className="w-full text-xs">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr>
              <th className={STICKY + " min-w-40 px-2 py-1.5 text-left font-medium"}>Позиция</th>
              {sites.map((s) => (
                <th key={s} className="min-w-20 px-1 py-1.5 text-center font-medium">
                  {renaming?.site === s ? (
                    <Input className="h-8 w-28 max-md:h-11" autoFocus maxLength={60} value={renaming.value} aria-label="Новое название площадки" onChange={(e) => setRenaming({ site: s, value: e.target.value })} onBlur={rename} onKeyDown={(e) => { if (e.key === "Enter") rename(); if (e.key === "Escape") setRenaming(null); }} />
                  ) : (
                    <span className="inline-flex items-center gap-0.5">
                      <span className="break-words">{s}</span>
                      <button type="button" className="inline-flex min-h-6 min-w-6 items-center justify-center rounded text-neutral-400 hover:text-neutral-800 max-md:min-h-11 max-md:min-w-8" aria-label={`Переименовать ${s}`} title="Переименовать" onClick={() => setRenaming({ site: s, value: s })}>✎</button>
                      <button type="button" className="inline-flex min-h-6 min-w-6 items-center justify-center rounded text-neutral-400 hover:text-red-700 disabled:opacity-30 max-md:min-h-11 max-md:min-w-8" aria-label={`Убрать ${s}`} title={siteUsed(s) ? "Нельзя убрать: в столбце есть данные" : "Убрать столбец"} disabled={siteUsed(s)} onClick={() => { touch(); setSites((p) => p.filter((x) => x !== s)); }}>✕</button>
                    </span>
                  )}
                </th>
              ))}
              <th className="min-w-16 px-1 py-1.5 text-center font-medium">Не принято</th>
              <th className="px-1 py-1.5 text-right font-medium">Σ</th>
              <th className="px-1 py-1.5 text-right font-medium">Коптево</th>
              <th className="px-1 py-1.5 text-center font-medium">Остаток</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => {
              const dist = distributed(r);
              const d = lineDiff(r.accepted, dist);
              return (
                <Fragment key={r.id}>
                  <tr>
                    <td className={STICKY + " px-2 py-1.5"}><div className="font-medium">{r.article} · {r.color}</div><div className="text-[11px] text-neutral-500">р. {r.size || "—"} · {r.order}</div></td>
                    {sites.map((s) => (
                      <td key={s} className="px-1 py-1 text-center">
                        <Input className="mx-auto h-8 w-14 px-1 text-center tabular-nums max-md:h-11" inputMode="numeric" value={cells[r.id]?.[s] ?? ""} placeholder={(r.ziSites.find((z) => norm(z.site) === norm(s))?.qty ?? "") + ""} aria-label={`${r.label}: ${s}, шт.`} onChange={(e) => setCell(r.id, s, e.target.value)} />
                      </td>
                    ))}
                    <td className="px-1 py-1 text-center">
                      <Button type="button" size="sm" variant={rejQty(r.id) ? "outline" : "ghost"} className={"h-8 min-w-10 px-2 tabular-nums max-md:h-11 " + (rejQty(r.id) ? "border-red-300 text-red-700" : "")} aria-expanded={openRej === r.id} aria-label={`Не принято: ${r.label}`} onClick={() => setOpenRej(openRej === r.id ? null : r.id)}>{rejQty(r.id) || "—"}</Button>
                    </td>
                    <td className="px-1 py-1.5 text-right tabular-nums">{dist}</td>
                    <td className="px-1 py-1.5 text-right tabular-nums">{r.accepted}/{r.quantity}</td>
                    <td className="px-1 py-1.5 text-center">{d.ok ? <span className="text-emerald-700" title="Разложено столько, сколько принято в Коптево">✓</span> : <span className="font-medium text-red-700" title={`Принято в Коптево ${r.accepted}, разложено ${dist}`}>{fmtDelta(d.delta)}</span>}</td>
                  </tr>
                  {openRej === r.id && (
                    <tr>
                      <td colSpan={colSpan} className="bg-red-50/40 px-2 py-2">
                        <div className="flex flex-col gap-1">
                          <p className="text-[11px] text-neutral-600">Не принято на площадке: {r.label}. Ввод идёт в «Σ» и не может превысить принятое в Коптево ({r.accepted}).</p>
                          {rejOf(r.id).map((x) => (
                            <div key={x.id} className="grid grid-cols-2 gap-1 sm:grid-cols-[9rem_4rem_4rem_1fr_2rem]" data-rej-row>
                              <Input className="h-8 max-md:h-11" maxLength={60} value={x.site} placeholder="Площадка" aria-label="Площадка" onChange={(e) => { touch(); setRej((p) => ({ ...p, [r.id]: rejOf(r.id).map((y) => (y.id === x.id ? { ...y, site: e.target.value } : y)) })); }} />
                              <Input className="h-8 max-md:h-11" maxLength={10} value={x.size} placeholder="Размер" aria-label="Размер" onChange={(e) => { touch(); setRej((p) => ({ ...p, [r.id]: rejOf(r.id).map((y) => (y.id === x.id ? { ...y, size: e.target.value } : y)) })); }} />
                              <Input className="h-8 max-md:h-11" inputMode="numeric" value={x.qty} placeholder="шт." aria-label="Количество" onChange={(e) => { touch(); setRej((p) => ({ ...p, [r.id]: rejOf(r.id).map((y) => (y.id === x.id ? { ...y, qty: e.target.value.replace(/[^\d]/g, "") } : y)) })); }} />
                              <Input className="col-span-2 h-8 max-md:h-11 sm:col-span-1" maxLength={300} value={x.reason} placeholder="Причина (обязательно)" aria-label="Причина" onChange={(e) => { touch(); setRej((p) => ({ ...p, [r.id]: rejOf(r.id).map((y) => (y.id === x.id ? { ...y, reason: e.target.value } : y)) })); }} />
                              <Button type="button" variant="ghost" size="sm" className="max-md:h-11" aria-label="Убрать" onClick={() => { touch(); setRej((p) => ({ ...p, [r.id]: rejOf(r.id).filter((y) => y.id !== x.id) })); }}>✕</Button>
                            </div>
                          ))}
                          <div><Button type="button" size="sm" variant="outline" className="max-md:h-11" disabled={rejOf(r.id).length >= 10} onClick={() => { touch(); setRej((p) => ({ ...p, [r.id]: [...rejOf(r.id), { id: uid(), site: "", size: r.size, qty: "1", reason: "" }] })); }}>+ не принято</Button></div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot className="border-t border-neutral-300 bg-neutral-50">
            <tr>
              <td className={STICKY + " bg-neutral-50 px-2 py-1.5 font-medium"}>Итого, шт.</td>
              {sites.map((s) => <td key={s} className="px-1 py-1.5 text-center tabular-nums" title={`по накладной: ${zi(s).q} шт.`}>{siteTotal(s)}</td>)}
              <td className="px-1 py-1.5 text-center tabular-nums">{totRej}</td>
              <td className="px-1 py-1.5 text-right tabular-nums">{totAll}</td>
              <td className="px-1 py-1.5 text-right tabular-nums">{totAcc}</td>
              <td className="px-1 py-1.5 text-center">{totAll === totAcc ? <span className="text-emerald-700">✓</span> : <span className="font-medium text-red-700">{fmtDelta(totAcc - totAll)}</span>}</td>
            </tr>
            <tr>
              <td className={STICKY + " bg-neutral-50 px-2 py-1.5 font-medium"}>Сумма с НДС, ₽</td>
              {sites.map((s) => {
                const z = zi(s);
                const v = Number((sums[s] ?? "").replace(/\s/g, "").replace(",", "."));
                const d = sums[s] ? sumDiff(v || 0, z.sum) : null;
                return (
                  <td key={s} className="px-1 py-1 text-center">
                    <Input className="mx-auto h-8 w-24 px-1 text-right tabular-nums max-md:h-11" inputMode="decimal" value={sums[s] ?? ""} placeholder={z.sum ? money(z.sum) : "₽"} title={z.sum ? `по накладной: ${money(z.sum)} ₽` : undefined} aria-label={`Сумма с НДС по площадке ${s}`} onChange={(e) => { touch(); setSums((p) => ({ ...p, [s]: e.target.value })); }} />
                    {d && <span className={"block text-[11px] " + (d.ok ? "text-emerald-700" : "text-red-700")} title={`Введено ${money(v)} ₽, по накладной ${money(z.sum)} ₽`}>{d.ok ? "✓" : `${d.diff > 0 ? "+" : "−"}${Math.round(Math.abs(d.diff)).toLocaleString("ru-RU")}`}</span>}
                  </td>
                );
              })}
              <td colSpan={4} className="px-2 py-1.5 text-right text-[11px] text-neutral-600">
                {enteredSum > 0 && sd ? (
                  <span title={`Введено ${money(enteredSum)} ₽ · накладные ${money(invoiceTotal)} ₽${tzTotal != null ? ` · ТЗ ${money(tzTotal)} ₽` : ""}`}>
                    <span className={sd.ok ? "text-emerald-700" : "text-red-700"}>{sd.ok ? "✓ = накладным" : `≠ накладным ${sd.diff > 0 ? "+" : "−"}${Math.round(Math.abs(sd.diff)).toLocaleString("ru-RU")}`}</span>
                    {tzTotal != null && (() => { const t = sumDiff(enteredSum, tzTotal); return <span className={" " + (t.ok ? "text-emerald-700" : "text-red-700")}> · {t.ok ? "✓ = ТЗ" : `≠ ТЗ ${t.diff > 0 ? "+" : "−"}${Math.round(Math.abs(t.diff)).toLocaleString("ru-RU")}`}</span>; })()}
                  </span>
                ) : `накладные: ${money(invoiceTotal)} ₽`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[11px] text-neutral-500">Пусто = 0. Серая цифра в ячейке — «по накладным ЗИ». Остаток = принято в Коптево − разложено (с «не принято»).</p>
    </div>
  );
}
