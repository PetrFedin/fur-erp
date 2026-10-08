"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { uploadDriveDocument, uploadDriveDocumentFile } from "@/app/(app)/drive-actions";
import type { DocItem, DocEntity } from "@/lib/doc-links";

type Upload = { entity: string; id: string } | null;
type Content =
  | { kind: "text"; text: string }
  | { kind: "tables"; sheets: { name: string; rows: string[][]; truncated: boolean }[] }
  | { error: string };

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const btn =
  "inline-flex h-8 shrink-0 items-center rounded-md border border-neutral-300 bg-white px-2.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40";

function fmtSize(n: number | null): string {
  if (!n) return "";
  return n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return d ? `${d}.${m}.${y}` : iso;
}

/** Значок «📎 N» в строке: по клику открывает DocViewer со списком документов строки (список грузится по клику). */
export function DocBadge({ entity, id, count, title, className = "" }: { entity: DocEntity; id: string; count: number; title?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const none = count === 0;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        title={none ? "Документов нет — открыть и загрузить" : `Документы строки: ${count}`}
        aria-label={none ? "Нет документов" : `Документы: ${count}`}
        data-doc-badge={entity}
        className={`inline-flex h-6 items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 text-xs ${
          none ? "text-neutral-500 hover:bg-neutral-100" : "bg-neutral-100 font-medium text-neutral-700 hover:bg-neutral-200"
        } ${className}`}
      >
        {none ? "нет документов" : `📎 ${count}`}
      </button>
      {open && <DocViewer entity={entity} id={id} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

export function DocViewer({ entity, id, title, onClose }: { entity: DocEntity; id: string; title?: string; onClose: () => void }) {
  const [docs, setDocs] = useState<DocItem[] | null>(null);
  const [upload, setUpload] = useState<Upload>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [mounted, setMounted] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/doc-list?entity=${entity}&id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { docs: DocItem[]; upload: Upload };
      setDocs(j.docs);
      setUpload(j.upload);
      setErr(null);
    } catch {
      setErr("Не удалось загрузить список документов. Закройте окно и попробуйте ещё раз.");
    }
  }, [entity, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    void load();
  }, [load]);

  const count = docs?.length ?? 0;
  const go = useCallback((d: number) => setSel((s) => (count ? (s + d + count) % count : 0)), [count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (!typing && e.key === "ArrowRight") go(1);
      else if (!typing && e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
  }, [onClose, go]);

  const cur = docs?.[Math.min(sel, Math.max(0, count - 1))] ?? null;
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/60 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={title ?? "Документы"} onClick={onClose} data-doc-viewer>
      <div className="flex w-full max-w-6xl flex-col overflow-hidden bg-white shadow-xl sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2">
          <div className="min-w-0 flex-1 basis-40 truncate text-sm font-medium">
            {title ? `${title} · ` : ""}
            {cur ? cur.title : "Документы"}
          </div>
          {count > 1 && (
            <>
              <button type="button" className={btn} onClick={() => go(-1)} aria-label="Предыдущий документ">
                ←
              </button>
              <span className="text-xs text-neutral-500">
                {Math.min(sel, count - 1) + 1} из {count}
              </span>
              <button type="button" className={btn} onClick={() => go(1)} aria-label="Следующий документ">
                →
              </button>
            </>
          )}
          {cur?.fileUrl && (
            <>
              <a className={btn} href={cur.fileUrl} target="_blank" rel="noreferrer">
                В новой вкладке
              </a>
              <a className={btn} href={`${cur.fileUrl}?download=1`} download>
                Скачать
              </a>
            </>
          )}
          <button type="button" className={btn} onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {count > 1 && (
            <ul className="max-h-32 shrink-0 overflow-auto border-b border-neutral-200 md:max-h-none md:w-72 md:border-b-0 md:border-r">
              {docs!.map((d, i) => (
                <li key={d.key}>
                  <button
                    type="button"
                    onClick={() => setSel(i)}
                    className={`block w-full px-3 py-2 text-left text-xs hover:bg-neutral-50 ${i === sel ? "bg-neutral-100" : ""}`}
                  >
                    <span className="block truncate text-sm text-neutral-800">{d.title}</span>
                    <span className="block text-neutral-500">
                      {[d.typeLabel, d.number && `№ ${d.number}`, fmtDate(d.date), fmtSize(d.size)].filter(Boolean).join(" · ")}
                    </span>
                    <span className="block text-neutral-500">
                      {[d.scope, d.hasFile ? null : "файл не загружен"].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-neutral-100">
            {err ? (
              <Notice>{err}</Notice>
            ) : !docs ? (
              <Notice>Загрузка…</Notice>
            ) : !cur ? (
              <EmptyUpload upload={upload} onDone={load} />
            ) : (
              <Pane key={cur.key} doc={cur} onUploaded={load} />
            )}
          </div>
        </div>
        {cur && (
          <div className="border-t border-neutral-200 px-3 py-1.5 text-xs text-neutral-500">
            {[cur.typeLabel, cur.number && `№ ${cur.number}`, fmtDate(cur.date), fmtSize(cur.size), cur.scope].filter(Boolean).join(" · ")}
            {" · "}Esc — закрыть, ← → — другой документ
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-neutral-500">{children}</div>;
}

function EmptyUpload({ upload, onDone }: { upload: Upload; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Notice>
      <div className="flex flex-col items-center gap-3">
        <div>У этой строки нет документов.</div>
        {upload ? (
          <label className={`${btn} relative cursor-pointer overflow-hidden ${pending ? "opacity-50" : ""}`}>
            {pending ? "Загружаем…" : "Загрузить файл"}
            <input
              type="file"
              accept=".pdf,.xlsx,.docx,.jpg,.jpeg,.png"
              className="sr-only"
              disabled={pending}
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (!f) return;
                const fd = new FormData();
                fd.set("file", f);
                start(async () => {
                  try {
                    const r = await uploadDriveDocument(upload.entity as "purchase", upload.id, fd);
                    if (r?.error) setMsg(r.error);
                    else onDone();
                  } catch {
                    setMsg("Не удалось загрузить файл");
                  }
                });
              }}
            />
          </label>
        ) : (
          <div className="text-neutral-500">Загрузите документ в карточке закупки.</div>
        )}
        {msg && <div className="text-red-600">{msg}</div>}
      </div>
    </Notice>
  );
}

function Pane({ doc, onUploaded }: { doc: DocItem; onUploaded: () => void }) {
  if (!doc.hasFile || !doc.fileUrl) return <MissingFile doc={doc} onUploaded={onUploaded} />;
  const mime = doc.mime ?? "";
  if (mime === "application/pdf")
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <iframe src={doc.fileUrl} title={doc.title} className="min-h-0 w-full flex-1 border-0" />
        <div className="border-t border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-500">Поиск по тексту: щёлкните по документу и нажмите Ctrl+F (⌘F).</div>
      </div>
    );
  if (mime.startsWith("image/"))
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={doc.fileUrl} alt={doc.title} className="mx-auto h-auto max-h-full max-w-full object-contain" />
      </div>
    );
  if (mime === DOCX || mime === XLSX) return <TextPane doc={doc} />;
  return (
    <Notice>
      Этот тип файла нельзя показать в окне — используйте «Скачать».
    </Notice>
  );
}

function MissingFile({ doc, onUploaded }: { doc: DocItem; onUploaded: () => void }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Notice>
      <div className="flex max-w-md flex-col items-center gap-3">
        <div className="text-base font-medium text-neutral-700">Файл не загружен</div>
        <div>
          Запись о документе «{doc.title}» есть, но самого файла в приложении нет. Загрузите файл — и его можно будет читать и искать здесь.
        </div>
        {doc.src === "drive" && (
          <label className={`${btn} relative cursor-pointer overflow-hidden ${pending ? "opacity-50" : ""}`}>
            {pending ? "Загружаем…" : "Загрузить файл"}
            <input
              type="file"
              accept=".pdf,.xlsx,.docx,.jpg,.jpeg,.png"
              className="sr-only"
              disabled={pending}
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (!f) return;
                const fd = new FormData();
                fd.set("file", f);
                start(async () => {
                  try {
                    const r = await uploadDriveDocumentFile(doc.id, fd);
                    if (r?.error) setMsg(r.error);
                    else onUploaded();
                  } catch {
                    setMsg("Не удалось загрузить файл");
                  }
                });
              }}
            />
          </label>
        )}
        {msg && <div className="text-red-600">{msg}</div>}
      </div>
    </Notice>
  );
}

function escRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Hl({ text, re }: { text: string; re: RegExp | null }) {
  if (!re || !text) return <>{text}</>;
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <mark key={i} data-hit className="rounded-sm bg-yellow-300 px-0.5">{p}</mark> : p))}
    </>
  );
}

function TextPane({ doc }: { doc: DocItem }) {
  const [content, setContent] = useState<Content | null>(null);
  const [q, setQ] = useState("");
  const [hit, setHit] = useState(0);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dead = false;
    fetch(`/api/doc-text?src=${doc.src}&id=${encodeURIComponent(doc.id)}`)
      .then(async (r) => (await r.json()) as Content)
      .then((c) => !dead && setContent(c))
      .catch(() => !dead && setContent({ error: "Не удалось прочитать файл — скачайте его." }));
    return () => {
      dead = true;
    };
  }, [doc.src, doc.id]);

  const query = q.trim();
  const re = useMemo(() => (query.length >= 2 ? new RegExp(`(${escRe(query)})`, "gi") : null), [query]);
  const total = useMemo(() => {
    if (!re || !content || "error" in content) return 0;
    const all = content.kind === "text" ? content.text : content.sheets.flatMap((s) => s.rows.flat()).join("\n");
    return (all.match(re) ?? []).length;
  }, [re, content]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHit(0);
  }, [query]);
  useEffect(() => {
    const marks = body.current?.querySelectorAll("mark[data-hit]");
    marks?.forEach((m) => m.classList.remove("ring-2", "ring-orange-500"));
    const m = marks?.[hit] as HTMLElement | undefined;
    if (m) {
      m.classList.add("ring-2", "ring-orange-500");
      m.scrollIntoView({ block: "center", inline: "nearest" });
    }
  }, [hit, total, content, query]);

  if (!content) return <Notice>Читаем файл…</Notice>;
  if ("error" in content) return <Notice>{content.error}</Notice>;
  const empty = content.kind === "text" ? !content.text.trim() : content.sheets.length === 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-3 py-1.5">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && total) setHit((h) => (h + (e.shiftKey ? -1 : 1) + total) % total);
          }}
          placeholder="Найти в документе (номер, сумма, слово)"
          className="h-8 min-w-0 flex-1 rounded-md border border-neutral-300 px-2 text-sm"
          aria-label="Поиск в документе"
        />
        {query.length >= 2 && <span className="shrink-0 text-xs text-neutral-500">{total ? `${hit + 1} из ${total}` : "не найдено"}</span>}
        <button type="button" className={btn} disabled={!total} onClick={() => setHit((h) => (h + 1) % total)}>
          Далее
        </button>
      </div>
      <div ref={body} className="min-h-0 flex-1 overflow-auto bg-white p-3 text-sm">
        {empty ? (
          <div className="text-neutral-500">В файле не нашлось текста — скачайте его и откройте в Word/Excel.</div>
        ) : content.kind === "text" ? (
          <div className="whitespace-pre-wrap break-words leading-relaxed">
            <Hl text={content.text} re={re} />
          </div>
        ) : (
          content.sheets.map((s) => (
            <section key={s.name} className="mb-6">
              <h4 className="mb-1 font-semibold">{s.name}</h4>
              <div className="overflow-x-auto">
                <table className="border-collapse text-xs">
                  <tbody>
                    {s.rows.map((r, i) => (
                      <tr key={i}>
                        {r.map((c, j) => (
                          <td key={j} className="border border-neutral-200 px-1.5 py-0.5 align-top">
                            <Hl text={c} re={re} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {s.truncated && <p className="mt-1 text-xs text-neutral-500">Показаны первые строки листа — полный файл можно скачать.</p>}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
