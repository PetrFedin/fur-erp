import "server-only";
import path from "node:path";
import { mkdir, readFile, readdir, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";

/**
 * Хранилище файлов (этап 7). Все загруженные файлы (документы, фото, вложения чата) читаются, пишутся и удаляются только здесь.
 * В БД лежит относительный путь («ключ»): drive-docs/<организация>/<uuid>.pdf и т. п. — одинаковый для обоих вариантов.
 *
 *  • STORAGE не задан / «local» — папка UPLOAD_DIR (по умолчанию ./uploads), как было до этапа 7.
 *  • STORAGE=s3 — S3-совместимое хранилище (Yandex Object Storage, Selectel, MinIO…):
 *      S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY — обязательны;
 *      S3_ENDPOINT (по умолчанию https://storage.yandexcloud.net), S3_REGION (ru-central1),
 *      S3_PREFIX — общий префикс ключей (например «demo/»), S3_FORCE_PATH_STYLE=true — для MinIO.
 *
 * Проверка «файл есть» (storedFileExists) синхронная и вызывается десятками мест; для S3 она отвечает по индексу объектов в памяти:
 * индекс читается при старте (instrumentation → initStorage), обновляется при каждой записи/удалении и раз в минуту сверяется с бакетом.
 */

export type StoredStat = { size: number; mtimeMs: number };
export type StoredEntry = StoredStat & { name: string };

export const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR?.trim() || "./uploads");

/** Ключ без выхода из хранилища: нормализованный, с «/», без «..», без \0 и без ведущего «/». null — путь недопустим. */
export function storageKey(rel: string): string | null {
  if (!rel || rel.includes("\0")) return null;
  const k = path.posix.normalize(rel.replace(/\\/g, "/"));
  if (k.startsWith("/") || k === "." || k === ".." || k.startsWith("../") || k.includes("/../")) return null;
  return k;
}

/** Путь внутри UPLOAD_ROOT или null, если он оттуда выходит (локальный вариант). */
export function resolveInside(storagePath: string): string | null {
  if (!storagePath || storagePath.includes("\0")) return null;
  const abs = path.resolve(UPLOAD_ROOT, storagePath);
  return abs.startsWith(UPLOAD_ROOT + path.sep) ? abs : null;
}

export const storageMode = (): "local" | "s3" => ((process.env.STORAGE ?? "").trim().toLowerCase() === "s3" ? "s3" : "local");

// ───────────────────────── локальная папка ─────────────────────────

const local = {
  async put(key: string, buf: Buffer, exclusive: boolean) {
    const abs = resolveInside(key);
    if (!abs) throw new Error("Некорректный путь файла");
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, buf, exclusive ? { flag: "wx" } : undefined);
  },
  async get(key: string): Promise<Buffer | null> {
    const abs = resolveInside(key);
    if (!abs) return null;
    try { return await readFile(abs); } catch { return null; }
  },
  async del(key: string) {
    const abs = resolveInside(key);
    if (!abs) return;
    try { await unlink(abs); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.error("Не удалось удалить файл", key, e); }
  },
  async list(dirKey: string): Promise<StoredEntry[]> {
    const abs = resolveInside(dirKey);
    if (!abs) return [];
    let names: string[] = [];
    try { names = await readdir(abs); } catch { return []; }
    const out: StoredEntry[] = [];
    for (const n of names) {
      const st = await stat(path.join(abs, n)).catch(() => null);
      if (st?.isFile()) out.push({ name: n, size: st.size, mtimeMs: st.mtimeMs });
    }
    return out;
  },
  existsSync(key: string): boolean {
    const abs = resolveInside(key);
    if (!abs) return false;
    try { const st = statSync(abs); return st.isFile() && st.size > 0; } catch { return false; }
  },
  async removeDirIfEmpty(dirKey: string) {
    const abs = resolveInside(dirKey);
    if (abs) await rmdir(abs).catch(() => {}); // rmdir не трогает непустой каталог
  },
};

// ───────────────────────── S3 ─────────────────────────

type S3Mod = typeof import("@aws-sdk/client-s3");
let s3: { mod: S3Mod; client: InstanceType<S3Mod["S3Client"]>; bucket: string; prefix: string } | null = null;
const index = new Map<string, StoredStat>(); // ключ без префикса → размер и время
let indexReady = false;
let indexLoading: Promise<void> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function s3Config() {
  const bucket = (process.env.S3_BUCKET ?? "").trim();
  const accessKeyId = (process.env.S3_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = (process.env.S3_SECRET_ACCESS_KEY ?? "").trim();
  const missing = [!bucket && "S3_BUCKET", !accessKeyId && "S3_ACCESS_KEY_ID", !secretAccessKey && "S3_SECRET_ACCESS_KEY"].filter(Boolean);
  if (missing.length) throw new Error(`STORAGE=s3, но не заданы: ${missing.join(", ")}`);
  let prefix = (process.env.S3_PREFIX ?? "").trim().replace(/^\/+/, "");
  if (prefix && !prefix.endsWith("/")) prefix += "/";
  return {
    bucket, prefix, accessKeyId, secretAccessKey,
    endpoint: (process.env.S3_ENDPOINT ?? "").trim() || "https://storage.yandexcloud.net",
    region: (process.env.S3_REGION ?? "").trim() || "ru-central1",
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "").trim() === "true",
  };
}

async function s3c() {
  if (s3) return s3;
  const mod = await import("@aws-sdk/client-s3");
  const c = s3Config();
  const client = new mod.S3Client({ endpoint: c.endpoint, region: c.region, forcePathStyle: c.forcePathStyle, credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey } });
  s3 = { mod, client, bucket: c.bucket, prefix: c.prefix };
  return s3;
}

/** Полный список объектов бакета (под префиксом) → индекс. */
async function loadIndex(): Promise<void> {
  const { mod, client, bucket, prefix } = await s3c();
  const next = new Map<string, StoredStat>();
  let token: string | undefined;
  do {
    const r = await client.send(new mod.ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, ContinuationToken: token }));
    for (const o of r.Contents ?? []) if (o.Key) next.set(o.Key.slice(prefix.length), { size: o.Size ?? 0, mtimeMs: o.LastModified?.getTime() ?? 0 });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  index.clear();
  for (const [k, v] of next) index.set(k, v);
  indexReady = true;
}

function ensureIndex(): Promise<void> {
  if (indexReady) return Promise.resolve();
  indexLoading ??= loadIndex().finally(() => { indexLoading = null; });
  return indexLoading;
}

const isMissing = (e: unknown) => { const x = e as { name?: string; $metadata?: { httpStatusCode?: number } }; return x?.name === "NoSuchKey" || x?.name === "NotFound" || x?.$metadata?.httpStatusCode === 404; };

const remote = {
  async put(key: string, buf: Buffer, contentType?: string) {
    const { mod, client, bucket, prefix } = await s3c();
    await client.send(new mod.PutObjectCommand({ Bucket: bucket, Key: prefix + key, Body: buf, ContentType: contentType }));
    index.set(key, { size: buf.length, mtimeMs: Date.now() });
  },
  async get(key: string): Promise<Buffer | null> {
    const { mod, client, bucket, prefix } = await s3c();
    try {
      const r = await client.send(new mod.GetObjectCommand({ Bucket: bucket, Key: prefix + key }));
      if (!r.Body) return null;
      return Buffer.from(await r.Body.transformToByteArray());
    } catch (e) {
      if (isMissing(e)) { index.delete(key); return null; }
      console.error("[storage] чтение не удалось", key, e instanceof Error ? e.message : e);
      return null;
    }
  },
  async del(key: string) {
    const { mod, client, bucket, prefix } = await s3c();
    try { await client.send(new mod.DeleteObjectCommand({ Bucket: bucket, Key: prefix + key })); }
    catch (e) { if (!isMissing(e)) console.error("[storage] удаление не удалось", key, e instanceof Error ? e.message : e); }
    index.delete(key);
  },
  async list(dirKey: string): Promise<StoredEntry[]> {
    await ensureIndex();
    const p = dirKey.replace(/\/?$/, "/");
    const out: StoredEntry[] = [];
    for (const [k, v] of index) if (k.startsWith(p) && !k.slice(p.length).includes("/")) out.push({ name: k.slice(p.length), ...v });
    return out;
  },
  existsSync(key: string): boolean {
    if (!indexReady) void ensureIndex().catch((e) => console.error("[storage] индекс объектов не загружен:", e instanceof Error ? e.message : e));
    const st = index.get(key);
    return !!st && st.size > 0;
  },
};

// ───────────────────────── общий интерфейс ─────────────────────────

/** Записать файл. exclusive — не перезаписывать существующий (локально flag wx; ключи с uuid не повторяются и в S3). */
export async function putStoredFile(rel: string, buf: Buffer, opts: { contentType?: string; exclusive?: boolean } = {}): Promise<string> {
  const key = storageKey(rel);
  if (!key || !resolveInside(key)) throw new Error("Некорректный путь файла");
  if (storageMode() === "s3") await remote.put(key, buf, opts.contentType);
  else await local.put(key, buf, opts.exclusive ?? true);
  return key;
}

export async function getStoredFile(rel: string): Promise<Buffer | null> {
  const key = storageKey(rel);
  if (!key || !resolveInside(key)) return null;
  return storageMode() === "s3" ? remote.get(key) : local.get(key);
}

/** Удалить файлы; отсутствующий файл — не ошибка; недопустимые пути пропускаются. */
export async function deleteStoredFiles(rels: string[]): Promise<void> {
  for (const rel of rels) {
    const key = storageKey(rel);
    if (!key || !resolveInside(key)) continue;
    if (storageMode() === "s3") await remote.del(key);
    else await local.del(key);
  }
}

/** Файлы непосредственно в «каталоге» (без вложенных): имя, размер, время изменения. */
export async function listStoredFiles(dirRel: string): Promise<StoredEntry[]> {
  const key = storageKey(dirRel);
  if (!key || !resolveInside(key)) return [];
  return storageMode() === "s3" ? remote.list(key) : local.list(key);
}

/** Файл есть и не пустой. Синхронно: локально — stat, в S3 — индекс объектов. */
export function storedObjectExists(rel: string): boolean {
  const key = storageKey(rel);
  if (!key || !resolveInside(key)) return false;
  return storageMode() === "s3" ? remote.existsSync(key) : local.existsSync(key);
}

/** Убрать пустой каталог (локально); в S3 каталогов нет — ничего не делает. */
export async function removeStoredDirIfEmpty(dirRel: string): Promise<void> {
  const key = storageKey(dirRel);
  if (!key || storageMode() === "s3") return;
  await local.removeDirIfEmpty(key);
}

/**
 * Старт сервера (instrumentation): для S3 — проверка настроек, загрузка индекса объектов и сверка раз в минуту.
 * Ошибка доступа к бакету не роняет сервер: файлы будут «не прикреплены», в логе — [storage].
 */
export async function initStorage(): Promise<void> {
  if (storageMode() !== "s3") return;
  try {
    await ensureIndex();
    console.log(`[storage] S3: бакет ${(await s3c()).bucket}, объектов ${index.size}`);
  } catch (e) {
    console.error("[storage] S3 недоступен при старте:", e instanceof Error ? e.message : e);
  }
  if (!refreshTimer) {
    refreshTimer = setInterval(() => { void loadIndex().catch((e) => console.error("[storage] сверка индекса не удалась:", e instanceof Error ? e.message : e)); }, 60_000);
    refreshTimer.unref?.();
  }
}

/** Для тестов: сбросить клиент и индекс (после смены переменных окружения). */
export function resetStorageForTests(): void {
  s3 = null; index.clear(); indexReady = false; indexLoading = null;
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}
