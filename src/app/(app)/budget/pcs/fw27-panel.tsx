"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { compareWithPlan, KIND_LABEL, photoCount, photoSrc, slidePcs, slidesFor, type Crit, type Fw27Data, type Fw27Slide } from "@/lib/fw27-presentation";
import { replaceFw27Photo } from "./actions";
import type { PcsRow } from "@/lib/budget-pcs";
import { formatInt } from "@/lib/utils";

const dash = (v: number) => (v ? formatInt(Math.round(v)) : "–");
const signed = (v: number) => (v === 0 ? "–" : (v > 0 ? "+" : "−") + formatInt(Math.abs(Math.round(v))));

/** Окно с фото из презентации FW27 для выбранной строки плана: по слайдам (CO / новые модели), штуки на каждом фото; клик по фото — крупно. */
export function Fw27Dialog({ data, crit, title, onClose, canReplace = false }: { data: Fw27Data; crit: Crit; title: string; onClose: () => void; /** «Детально» + права: у каждого фото кнопка «Заменить фото». */ canReplace?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [big, setBig] = useState<{ src: string; cap: string } | null>(null);
  const [ver, setVer] = useState<Record<string, number>>({}); // версии заменённых фото: сразу видно новое, без перезагрузки
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const srcOf = (it: { file: string; v?: number }) => photoSrc({ file: it.file, v: ver[it.file] ?? it.v });
  const replace = async (file: string, f: File | undefined) => {
    if (!f) return;
    setBusy(file); setErr("");
    const fd = new FormData(); fd.set("file_name", file); fd.set("file", f);
    try { const r = await replaceFw27Photo(fd); if (r.ok) setVer((p) => ({ ...p, [file]: r.v })); else setErr(r.error); } catch { setErr("Не удалось загрузить фото"); } finally { setBusy(null); }
  };
  useEffect(() => { ref.current?.showModal(); }, []);
  const slides = useMemo(() => slidesFor(data, crit), [data, crit]);
  const total = slides.reduce((t, s) => t + slidePcs(s), 0);
  const pagesLabel = (s: Fw27Slide) => `слайд ${s.page}`;
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }} className="m-auto w-[calc(100vw-2rem)] max-w-5xl rounded-xl border border-neutral-200 bg-white p-0 text-left shadow-xl backdrop:bg-black/40">
      <div className="max-h-[90vh] overflow-y-auto p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Презентация FW27/28 · что хотят</div>
            <div className="text-lg font-semibold">{title}</div>
            {err ? <p role="alert" className="mt-1 text-sm text-[#b4310b]">{err}</p> : null}
            <div className="text-sm text-neutral-600">{photoCount(slides)} фото · {total ? `${formatInt(total)} шт. по подписям` : "штуки не указаны"}</div>
          </div>
          <button type="button" onClick={() => ref.current?.close()} className="min-h-11 rounded-lg border border-neutral-300 px-3 text-sm hover:bg-neutral-50">✕ Закрыть</button>
        </div>
        {slides.length === 0 ? <p className="py-6 text-center text-sm text-neutral-500">В презентации для этой строки фото нет.</p> : slides.map((s) => (
          <section key={s.page} className="mb-4">
            <h3 className="mb-1.5 flex flex-wrap items-center gap-2 text-sm font-semibold">
              <span className={"rounded px-1.5 py-0.5 text-xs " + (s.kind === "NEW" ? "bg-emerald-100 text-emerald-900" : "bg-neutral-200 text-neutral-800")}>{s.kind ? KIND_LABEL[s.kind] : "Модели"}</span>
              <span>{s.title.replace(/^(CO|СО|Новые модели|Новые короткие модели):?\s*/i, "") || s.title}</span>
              <span className="text-xs font-normal text-neutral-500">{pagesLabel(s)}{s.len ? ` · ${s.len}` : ""}{s.lenInherited ? " (длина по предыдущему слайду)" : ""}</span>
            </h3>
            <div className="flex flex-wrap gap-3">
              {s.items.map((it) => (
                <figure key={it.id} className="w-36 sm:w-44">
                  <button type="button" onClick={() => setBig({ src: srcOf(it), cap: [it.pcsText, it.caption].filter(Boolean).join(" · ") })} className="block w-full overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 hover:border-neutral-500" aria-label={`Открыть фото крупно: ${it.caption ?? s.title}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={srcOf(it)} alt={it.caption ?? s.title} loading="lazy" className="aspect-[3/4] w-full object-cover" />
                  </button>
                  <figcaption className="mt-1 text-xs leading-4 text-neutral-700"><b>{it.pcsText ?? "—"}</b>{it.caption ? <span className="block text-neutral-500">{it.caption}</span> : null}</figcaption>
                  {canReplace ? (
                    <label className="mt-1 inline-flex min-h-9 cursor-pointer items-center rounded-md border border-neutral-300 px-2 text-xs hover:border-neutral-500">
                      {busy === it.file ? "Загружаю…" : "Заменить фото"}
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy !== null} onChange={(e) => { void replace(it.file, e.target.files?.[0]); e.target.value = ""; }} />
                    </label>
                  ) : null}
                </figure>
              ))}
            </div>
          </section>
        ))}
      </div>
      {big ? (
        <div role="dialog" aria-label="Фото крупно" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setBig(null)}>
          <figure className="max-h-full max-w-3xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={big.src} alt={big.cap} className="max-h-[85vh] w-auto rounded-lg object-contain" />
            <figcaption className="mt-2 text-center text-sm text-white">{big.cap || " "} · нажмите, чтобы закрыть</figcaption>
          </figure>
        </div>
      ) : null}
    </dialog>
  );
}

/** Сверка плана (Одежда) с презентацией FW27: по мех × категория, раскрывается по длинам; у каждой строки — кнопка с фото. */
export function Fw27Compare({ data, rows, onOpen }: { data: Fw27Data; rows: PcsRow[]; onOpen: (c: Crit, title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [exp, setExp] = useState<Set<string>>(new Set());
  const cmp = useMemo(() => compareWithPlan(data, rows.map((r) => ({ block: r.block, fur: r.fur, cat: r.cat, len: r.len ?? "", pcs: r.pcs ?? 0 }))), [data, rows]);
  const tot = cmp.reduce((t, r) => ({ plan: t.plan + r.plan, file: t.file + r.file, ph: t.ph + r.photos }), { plan: 0, file: 0, ph: 0 });
  const toggle = (k: string) => setExp((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const tone = (d: number) => (d === 0 ? "text-neutral-500" : "text-[#b4310b]");
  const label = (r: { fur: string; cat: string; len: string | null }) => (r.len === null && r.cat ? `${r.fur} · ${r.cat}` : `${r.len ?? "длина не указана"}`);
  return (
    <section className="rounded-lg border border-neutral-300 bg-white" aria-label="Сверка с презентацией FW27">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-11 w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm font-semibold">
        <span aria-hidden>{open ? "▾" : "▸"}</span>Сверка с презентацией FW27/28 (Одежда)
        <span className="text-xs font-normal text-neutral-600">план {formatInt(tot.plan)} шт. · презентация {formatInt(tot.file)} шт. · разница {signed(tot.file - tot.plan)} · {tot.ph} фото</span>
      </button>
      {open ? (
        <div className="overflow-x-auto border-t border-neutral-200" tabIndex={0} data-keep-scroll>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-xs text-neutral-500">
                <th className="px-3 py-1.5 text-left font-medium">Мех · категория / длина</th>
                <th className="px-2 py-1.5 text-right font-medium">План, шт.</th>
                <th className="px-2 py-1.5 text-right font-medium">Презентация, шт.</th>
                <th className="px-2 py-1.5 text-right font-medium">Разница</th>
                <th className="px-2 py-1.5 text-right font-medium">Фото</th>
              </tr>
            </thead>
            <tbody>
              {cmp.map((r) => (
                <Fragment key={r.key}>
                  <tr className="border-b border-neutral-100 bg-neutral-50 font-medium">
                    <td className="px-3 py-1.5"><button type="button" aria-expanded={exp.has(r.key)} onClick={() => toggle(r.key)} className="mr-1 inline-flex min-h-8 min-w-6 items-center justify-center text-neutral-500">{r.sub.length ? (exp.has(r.key) ? "▾" : "▸") : ""}</button>{r.fur} · {r.cat}{r.noNumber ? <span className="ml-1 text-xs font-normal text-neutral-500">({r.noNumber} фото без числа)</span> : null}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{dash(r.plan)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{dash(r.file)}</td>
                    <td className={"px-2 py-1.5 text-right tabular-nums " + tone(r.file - r.plan)}>{signed(r.file - r.plan)}</td>
                    <td className="px-2 py-1.5 text-right">{r.photos ? <button type="button" onClick={() => onOpen(r.crit, `${r.fur} · ${r.cat}`)} className="min-h-9 rounded-md border border-neutral-300 px-2 text-xs hover:border-neutral-500">Фото {r.photos}</button> : "–"}</td>
                  </tr>
                  {exp.has(r.key) ? r.sub.map((x) => (
                    <tr key={x.key} className="border-b border-neutral-100 text-neutral-700">
                      <td className="py-1.5 pl-10 pr-3">{label(x)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{x.len === null ? "–" : dash(x.plan)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{dash(x.file)}</td>
                      <td className={"px-2 py-1.5 text-right tabular-nums " + (x.len === null ? "text-neutral-400" : tone(x.file - x.plan))}>{x.len === null ? "–" : signed(x.file - x.plan)}</td>
                      <td className="px-2 py-1.5 text-right">{x.photos ? <button type="button" onClick={() => onOpen(x.crit, `${x.fur} · ${x.cat}${x.len ? ` · ${x.len}` : ""}`)} className="min-h-9 rounded-md border border-neutral-300 px-2 text-xs hover:border-neutral-500">Фото {x.photos}</button> : "–"}</td>
                    </tr>
                  )) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-neutral-600">«Презентация» — сумма «N pcs» под фото слайдов (CO и новые модели). Слайды без длины считаются на всю категорию; «без числа» — подпись «по статистике» или без количества. Аксессуаров в презентации нет.</p>
        </div>
      ) : null}
    </section>
  );
}
