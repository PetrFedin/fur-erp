/**
 * Перенос файлов из локальной папки загрузок в S3 (Yandex Object Storage и др.) — один раз перед включением STORAGE=s3,
 * и повторно, если что-то докладывали в папку. Ничего не удаляет ни в папке, ни в бакете; файл, который уже лежит в бакете
 * с тем же размером, пропускается — запуск можно повторять.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/storage-sync.ts [--dry-run] [--from ./uploads]
 *
 * Бакет и ключ — те же переменные, что у приложения (src/lib/storage.ts): S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 * S3_ENDPOINT, S3_REGION, S3_PREFIX, S3_FORCE_PATH_STYLE. Переносятся каталоги, на которые ссылается база:
 * drive-docs, purchase-docs, article-photos, fittings, chat, inbox (что есть в папке). fw27 (фото презентации) — не через хранилище, не переносится.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { S3Client, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const fromIdx = args.indexOf("--from");
const ROOT = resolve(fromIdx >= 0 ? args[fromIdx + 1] : process.env.UPLOAD_DIR?.trim() || "./uploads");
const DIRS = ["drive-docs", "purchase-docs", "article-photos", "fittings", "chat", "inbox"];

const need = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !(process.env[k] ?? "").trim());
if (need.length) { console.error(`Не заданы: ${need.join(", ")} (см. docs/STORAGE.md)`); process.exit(2); }
const bucket = process.env.S3_BUCKET!.trim();
let prefix = (process.env.S3_PREFIX ?? "").trim().replace(/^\/+/, "");
if (prefix && !prefix.endsWith("/")) prefix += "/";
const endpoint = (process.env.S3_ENDPOINT ?? "").trim() || "https://storage.yandexcloud.net";
const client = new S3Client({
  endpoint, region: (process.env.S3_REGION ?? "").trim() || "ru-central1", forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "") === "true",
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!.trim(), secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!.trim() },
});

const MIME: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", doc: "application/msword", txt: "text/plain" };

function walk(d: string, out: string[]) {
  for (const n of readdirSync(d)) { const p = join(d, n); const st = statSync(p); if (st.isDirectory()) walk(p, out); else if (st.isFile()) out.push(p); }
}

(async () => {
  const files: string[] = [];
  for (const d of DIRS) if (existsSync(join(ROOT, d))) walk(join(ROOT, d), files);
  const have = new Map<string, number>();
  let token: string | undefined;
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, ContinuationToken: token }));
    for (const o of r.Contents ?? []) if (o.Key) have.set(o.Key, o.Size ?? 0);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  console.log(`Папка: ${ROOT}, файлов: ${files.length}. Бакет: ${bucket}${prefix ? ` (префикс ${prefix})` : ""} на ${endpoint}, уже объектов: ${have.size}${dry ? ". ПРОБНЫЙ ПРОГОН — ничего не пишется." : ""}`);
  let put = 0, skip = 0, bytes = 0, failed = 0;
  for (const f of files) {
    const key = prefix + relative(ROOT, f).split("\\").join("/");
    const size = statSync(f).size;
    if (have.get(key) === size) { skip++; continue; }
    if (dry) { put++; bytes += size; continue; }
    try {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: readFileSync(f), ContentType: MIME[f.split(".").pop()?.toLowerCase() ?? ""] }));
      put++; bytes += size;
      if (put % 100 === 0) console.log(`  … ${put} файлов`);
    } catch (e) { failed++; console.error(`  не записан ${key}: ${e instanceof Error ? e.message : e}`); }
  }
  console.log(`${dry ? "Будет записано" : "Записано"}: ${put} (${(bytes / 1024 / 1024).toFixed(1)} МБ), уже были: ${skip}, ошибок: ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
