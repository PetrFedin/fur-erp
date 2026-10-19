"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoHint } from "@/components/info-hint";
import { useConfirm } from "@/components/confirm-dialog";
import { ICON_BTN, IconPencil } from "@/components/icons";
import { PHOTO_MAX_BYTES, PHOTOS_PER_ARTICLE_MAX } from "@/lib/article-shop-core";
import { discardArticlePhotos, loadArticleShop, saveArticleShop } from "@/app/(app)/models/shop-actions";

type Row = { key: string; label: string; plu: string; url: string };
type Ph = { id: string; variant: string; color?: string; staged?: boolean; progress?: number; failed?: string; name?: string };

const MB = 1024 * 1024;
const thumb = (modelId: string, id: string) => `/api/article-photos/${modelId}/${id}?size=thumb`;

/** Один файл на сервер с процентом выполнения (fetch процент не отдаёт). */
function uploadOne(modelId: string, file: File, onProgress: (p: number) => void): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/article-photos/${modelId}`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reject(new Error("нет связи"));
    xhr.onload = () => {
      const body = xhr.response as { photo?: { id: string }; error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && body?.photo) resolve(body.photo);
      else reject(new Error(body?.error ?? (xhr.status === 413 ? `файл больше ${PHOTO_MAX_BYTES / MB} МБ` : "ошибка сервера")));
    };
    const fd = new FormData();
    fd.set("file", file);
    xhr.send(fd);
  });
}

/**
 * Кнопка-карандаш «Изменить изделие» → окно «Магазин и фото»: по каждому цвету PLU, ссылка на товар и фото.
 * Данные подгружаются при открытии (подрядчику кнопка не рисуется, а сервер всё равно отклонит запрос).
 * Фото грузятся сразу и ждут «Сохранить»; PLU, ссылки и порядок фото сохраняются одной кнопкой.
 */
export function ArticleShopEditor({ modelId, title, defaultOpen = false, label = "Изменить изделие" }: { modelId: string; title: string; defaultOpen?: boolean; label?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={ICON_BTN + " max-xl:size-11 max-xl:h-11 max-xl:w-11"} title={label} aria-label={`${label} ${title}`} aria-haspopup="dialog">
        <IconPencil />
      </button>
      {open && <ShopDialog modelId={modelId} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShopDialog({ modelId, title, onClose }: { modelId: string; title: string; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const { ask, node: confirmNode } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [photos, setPhotos] = useState<Ph[]>([]);
  const [known, setKnown] = useState<string[]>([]);
  const [colors, setColors] = useState<{ article: string[]; all: string[] }>({ article: [], all: [] });
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState("");
  const [dupes, setDupes] = useState<{ plu: string; article: string }[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [addPick, setAddPick] = useState("");
  const seq = useRef(0);
  const photosRef = useRef<Ph[]>([]);
  useEffect(() => { photosRef.current = photos; }, [photos]);
  const uploading = photos.filter((p) => p.progress !== undefined && !p.failed);
  const alive = photos.filter((p) => !p.failed);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    let stop = false;
    loadArticleShop(modelId).then((r) => {
      if (stop) return;
      setLoading(false);
      if (!r.data) { setLoadErr(r.error ?? "Не удалось открыть"); return; }
      setRows(r.data.rows);
      setPhotos(r.data.photos.map((p) => ({ ...p })));
      setKnown(r.data.photos.map((p) => p.id));
      setColors({ article: r.data.colorsArticle, all: r.data.colorsAll });
    }).catch(() => { if (!stop) { setLoading(false); setLoadErr("Не удалось открыть: нет связи"); } });
    return () => { stop = true; };
  }, [modelId]);

  const touch = () => { setDirty(true); setErr(""); setDupes(null); };
  const stagedIds = () => photosRef.current.filter((p) => p.staged && p.progress === undefined && !p.failed).map((p) => p.id);

  const close = useCallback(async (force?: boolean) => {
    if (saving) return;
    if (!force && uploading.length) { setErr("Дождитесь окончания загрузки"); return; }
    if (!force && dirty && !(await ask("Закрыть без сохранения? Внесённое пропадёт.", { ok: "Закрыть", danger: true }))) return;
    const ids = stagedIds();
    if (!force && ids.length) void discardArticlePhotos(modelId, ids).catch(() => {});
    ref.current?.close();
  }, [saving, dirty, uploading.length, modelId, ask]);

  const patchRow = (key: string, patch: Partial<Row>) => { setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r))); touch(); };

  /** Добавить файлы в цвет: проверка размера и числа, затем по одному на сервер. */
  async function addFiles(key: string, list: FileList | File[]) {
    const files = Array.from(list).filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (!files.length) { setErr("Выберите фото: JPG, PNG, WebP или HEIC"); return; }
    const room = PHOTOS_PER_ARTICLE_MAX - photosRef.current.filter((p) => !p.failed).length;
    if (room <= 0) { setErr(`Не больше ${PHOTOS_PER_ARTICLE_MAX} фото на артикул`); return; }
    const use = files.slice(0, room);
    const problems: string[] = [];
    if (files.length > room) problems.push(`лишние фото (${files.length - room}) не взяты: максимум ${PHOTOS_PER_ARTICLE_MAX}`);
    const row = rows.find((r) => r.key === key);
    const items: { tmp: string; file: File }[] = [];
    for (const f of use) {
      if (f.size > PHOTO_MAX_BYTES) { problems.push(`${f.name} больше ${PHOTO_MAX_BYTES / MB} МБ`); continue; }
      items.push({ tmp: `tmp:${++seq.current}`, file: f });
    }
    setErr(""); setDirty(true); setDupes(null);
    // новые встают в конец группы своего цвета
    setPhotos((cur) => {
      const add = items.map((i): Ph => ({ id: i.tmp, variant: key, color: row?.label, staged: true, progress: 0, name: i.file.name }));
      let at = -1;
      cur.forEach((p, k) => { if (p.variant === key) at = k; });
      return at < 0 ? [...cur, ...add] : [...cur.slice(0, at + 1), ...add, ...cur.slice(at + 1)];
    });
    for (const it of items) {
      try {
        const r = await uploadOne(modelId, it.file, (p) => setPhotos((cur) => cur.map((x) => (x.id === it.tmp ? { ...x, progress: p } : x))));
        setPhotos((cur) => cur.map((x) => (x.id === it.tmp ? { id: r.id, variant: x.variant, color: x.color, staged: true } : x)));
      } catch (e) {
        problems.push(`${it.file.name}: ${(e as Error).message}`);
        setPhotos((cur) => cur.filter((x) => x.id !== it.tmp));
      }
    }
    if (problems.length) setErr(`Не загружено: ${problems[0]}${problems.length > 1 ? ` (и ещё ${problems.length - 1})` : ""}`);
  }

  async function removePhoto(p: Ph) {
    if (!(await ask("Убрать это фото? Оно исчезнет после «Сохранить».", { ok: "Убрать", danger: true }))) return;
    setPhotos((cur) => cur.filter((x) => x.id !== p.id));
    if (p.staged) void discardArticlePhotos(modelId, [p.id]).catch(() => {});
    touch();
  }

  function move(p: Ph, d: -1 | 1) {
    setPhotos((cur) => {
      const idx = cur.findIndex((x) => x.id === p.id);
      let j = idx + d;
      while (j >= 0 && j < cur.length && cur[j].variant !== p.variant) j += d;
      if (idx < 0 || j < 0 || j >= cur.length) return cur;
      const next = cur.slice();
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
    touch();
  }

  function recolor(p: Ph, key: string) {
    const row = rows.find((r) => r.key === key);
    setPhotos((cur) => {
      const rest = cur.filter((x) => x.id !== p.id);
      let at = -1;
      rest.forEach((x, k) => { if (x.variant === key) at = k; });
      const moved: Ph = { ...p, variant: key, color: row?.label };
      return at < 0 ? [...rest, moved] : [...rest.slice(0, at + 1), moved, ...rest.slice(at + 1)];
    });
    touch();
  }

  function addColor(value: string) {
    setAddPick("");
    if (!value) return;
    const name = value === "__none" ? "" : value;
    if (rows.some((r) => r.key.toLowerCase() === name.toLowerCase())) { setErr("Такой цвет уже есть в списке"); return; }
    setRows((rs) => [...rs, { key: name, label: name || "Цвет не определён", plu: "", url: "" }]);
    touch();
  }

  async function removeRow(r: Row) {
    if (photos.some((p) => p.variant === r.key)) return;
    if ((r.plu || r.url) && !(await ask(`Убрать цвет «${r.label}» вместе с его PLU и ссылкой?`, { ok: "Убрать", danger: true }))) return;
    setRows((rs) => rs.filter((x) => x.key !== r.key));
    touch();
  }

  async function save(allowDup?: boolean) {
    if (saving || uploading.length) return;
    setSaving(true); setErr(""); setDupes(null);
    try {
      const res = await saveArticleShop(modelId, {
        rows: rows.map((r) => ({ key: r.key, plu: r.plu, url: r.url, label: r.label })),
        photos: alive.map((p) => ({ id: p.id, variant: p.variant, color: p.color })),
        known,
        allowDup: allowDup === true,
      });
      if (!res.ok) {
        setErr(res.error);
        if (res.dupes) setDupes(res.dupes);
        return;
      }
      setDirty(false);
      router.refresh();
      ref.current?.close();
    } catch {
      setErr("Не удалось сохранить: нет связи. Введённое не потеряно — повторите.");
    } finally {
      setSaving(false);
    }
  }

  const free = (list: string[]) => list.filter((c) => !rows.some((r) => r.key.toLowerCase() === c.toLowerCase()));
  const optArticle = free(colors.article);
  const optAll = free(colors.all).filter((c) => !optArticle.includes(c));
  const hasNone = rows.some((r) => r.key === "");
  const busy = saving || uploading.length > 0;

  return (
    <dialog
      ref={ref}
      aria-label={`Изменить изделие ${title}`}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); void close(); }}
      onClick={(e) => { if (e.target === ref.current) void close(); }}
      className="m-auto h-dvh max-h-dvh w-screen max-w-none rounded-none border-0 bg-white p-0 text-left text-neutral-900 shadow-xl backdrop:bg-black/40 sm:h-auto sm:max-h-[90dvh] sm:w-[min(94vw,52rem)] sm:rounded-xl sm:border sm:border-neutral-200"
    >
      <form className="flex h-dvh max-h-dvh flex-col sm:h-auto sm:max-h-[90dvh]" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
          <h2 className="min-w-0 truncate text-base font-semibold">Изменить изделие · {title}</h2>
          <button type="button" onClick={() => void close()} aria-label="Закрыть" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-2xl text-neutral-600 hover:bg-neutral-100">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold">Магазин и фото</h3>
            <InfoHint label="О разделе «Магазин и фото»" wide>
              <p><b>PLU</b> — внутренний артикул магазина. Несколько — через запятую; кириллические Н и Е заменятся латинскими, пробелы уберутся.</p>
              <p className="mt-1"><b>Ссылка</b> — страница товара в магазине: только https:// или http://.</p>
              <p className="mt-1"><b>Фото:</b> JPG, PNG, WebP, HEIC до {PHOTO_MAX_BYTES / MB} МБ, не больше {PHOTOS_PER_ARTICLE_MAX} на артикул. Фото грузятся сразу, но попадают в артикул только после «Сохранить».</p>
            </InfoHint>
            <span className="ml-auto text-xs tabular-nums text-neutral-600">Фото {alive.length} из {PHOTOS_PER_ARTICLE_MAX}</span>
          </div>

          {loading && <p className="py-8 text-center text-sm text-neutral-600" role="status">Загружаю…</p>}
          {loadErr && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{loadErr}</p>}

          {!loading && !loadErr && (
            <div className="flex flex-col gap-4">
              {rows.length === 0 && <p className="text-sm text-neutral-600">Цветов пока нет. Нажмите «+ Цвет», чтобы добавить PLU, ссылку и фото.</p>}
              {rows.map((r) => {
                const mine = photos.filter((p) => p.variant === r.key);
                const idp = `row-${rows.indexOf(r)}`;
                return (
                  <section
                    key={r.key || "__none"}
                    aria-label={`Цвет ${r.label}`}
                    onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(r.key); } }}
                    onDragLeave={() => setDrag((d) => (d === r.key ? null : d))}
                    onDrop={(e) => { e.preventDefault(); setDrag(null); if (e.dataTransfer.files.length) void addFiles(r.key, e.dataTransfer.files); }}
                    className={"rounded-lg border p-3 " + (drag === r.key ? "border-blue-600 bg-blue-50" : "border-neutral-200")}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <h4 className="min-w-0 flex-1 truncate text-sm font-medium">{r.label}{r.key && r.key !== r.label ? <span className="font-normal text-neutral-600"> · {r.key}</span> : null}</h4>
                      <button type="button" onClick={() => void removeRow(r)} disabled={mine.length > 0} aria-label={`Убрать цвет ${r.label}`} title={mine.length ? "Сначала уберите фото цвета" : "Убрать цвет"} className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 disabled:opacity-40">×</button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[14rem_1fr]">
                      <label className="flex flex-col gap-1 text-xs text-neutral-700" htmlFor={`${idp}-plu`}>
                        PLU
                        <Input id={`${idp}-plu`} value={r.plu} maxLength={400} autoCapitalize="characters" autoComplete="off" onChange={(e) => patchRow(r.key, { plu: e.target.value })} placeholder="HE00924905" className="h-11" />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-neutral-700" htmlFor={`${idp}-url`}>
                        Ссылка на товар
                        <Input id={`${idp}-url`} type="url" inputMode="url" value={r.url} maxLength={600} autoComplete="off" onChange={(e) => patchRow(r.key, { url: e.target.value })} placeholder="https://" className="h-11" />
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap items-start gap-3">
                      {mine.map((p, k) => (
                        <div key={p.id} className="flex w-24 flex-col gap-1">
                          <div className="relative h-28 w-24 overflow-hidden rounded-md border border-neutral-200 bg-neutral-100">
                            {p.progress === undefined ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={thumb(modelId, p.id)} alt={`Фото ${k + 1}, ${r.label}`} className="size-full object-cover" />
                            ) : (
                              <div className="flex size-full flex-col items-center justify-center gap-1 px-1 text-center text-[11px] text-neutral-700" role="status">
                                <span className="tabular-nums">{p.progress} %</span>
                                <span className="h-1.5 w-full overflow-hidden rounded bg-neutral-300"><span className="block h-full bg-neutral-800 motion-reduce:transition-none" style={{ width: `${p.progress}%` }} /></span>
                              </div>
                            )}
                            {p.progress === undefined && (
                              <button type="button" onClick={() => void removePhoto(p)} aria-label={`Убрать фото ${k + 1}`} title="Убрать фото" className="absolute right-0 top-0 inline-flex size-11 items-center justify-center rounded-bl-md bg-black/60 text-xl text-white hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">×</button>
                            )}
                          </div>
                          {p.progress === undefined && (
                            <>
                              <div className="flex gap-1">
                                <button type="button" onClick={() => move(p, -1)} disabled={k === 0} aria-label={`Фото ${k + 1} влево`} className="inline-flex h-11 flex-1 items-center justify-center rounded-md border border-neutral-300 text-base hover:bg-neutral-50 disabled:opacity-40">←</button>
                                <button type="button" onClick={() => move(p, 1)} disabled={k === mine.length - 1} aria-label={`Фото ${k + 1} вправо`} className="inline-flex h-11 flex-1 items-center justify-center rounded-md border border-neutral-300 text-base hover:bg-neutral-50 disabled:opacity-40">→</button>
                              </div>
                              {rows.length > 1 && (
                                <select aria-label={`Цвет фото ${k + 1}`} value={p.variant} onChange={(e) => recolor(p, e.target.value)} className="h-11 w-full rounded-md border border-neutral-300 bg-white px-1 text-xs">
                                  {rows.map((x) => <option key={x.key || "__none"} value={x.key}>{x.label}</option>)}
                                </select>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                      <label className="inline-flex h-28 min-h-11 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-neutral-400 text-center text-xs text-neutral-700 hover:bg-neutral-50 focus-within:outline focus-within:outline-2 focus-within:outline-blue-700">
                        <span className="text-xl leading-none" aria-hidden="true">+</span>
                        <span>Фото</span>
                        <input type="file" multiple accept="image/*" className="sr-only" aria-label={`Добавить фото, ${r.label}`} onChange={(e) => { if (e.target.files?.length) void addFiles(r.key, e.target.files); e.target.value = ""; }} />
                      </label>
                    </div>
                    <p className="mt-2 hidden text-xs text-neutral-600 sm:block">Можно перетащить фото на этот блок.</p>
                  </section>
                );
              })}

              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor="add-color">Добавить цвет</label>
                <select id="add-color" value={addPick} onChange={(e) => addColor(e.target.value)} className="h-11 rounded-md border border-neutral-300 bg-white px-3 text-sm">
                  <option value="">+ Цвет</option>
                  {optArticle.length > 0 && <optgroup label="Цвета артикула">{optArticle.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>}
                  {optAll.length > 0 && <optgroup label="Другой цвет">{optAll.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>}
                  {!hasNone && <option value="__none">Цвет не определён</option>}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-neutral-200 px-4 py-3">
          {uploading.length > 0 && <p role="status" className="mb-2 text-sm text-neutral-700">Загружаю фото: осталось {uploading.length}…</p>}
          {err && <p role="alert" className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}
          {dupes && (
            <div role="alert" className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Такой PLU уже стоит у другого артикула: {dupes.map((d) => `${d.plu} — ${d.article}`).join("; ")}.
              <Button type="button" variant="outline" className="mt-2 min-h-11 w-full sm:w-auto" disabled={busy} onClick={() => void save(true)}>Сохранить всё равно</Button>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={() => void close()}>Отмена</Button>
            <Button type="submit" className="min-h-11 min-w-32" disabled={busy || loading || !!loadErr}>{saving ? "Сохраняю…" : "Сохранить"}</Button>
          </div>
        </div>
      </form>
      {confirmNode}
    </dialog>
  );
}
