// Хранилище файлов (src/lib/storage.ts): один договор для локальной папки и S3.
//   node --conditions=react-server node_modules/.bin/tsx scripts/test-storage.ts
// Часть S3 — если задан S3_TEST_ENDPOINT (MinIO: S3_TEST_ACCESS_KEY / S3_TEST_SECRET_KEY, бакет создаётся сам), иначе пропускается.
import "./stubs/server-only-shim";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fails = 0, checks = 0;
const ok = (what: string, cond: boolean, extra = "") => { checks++; if (!cond) { fails++; console.log(`FAIL ${what}${extra ? " " + extra : ""}`); } };

const dir = mkdtempSync(join(tmpdir(), "fur-storage-"));
process.env.UPLOAD_DIR = dir;

type St = typeof import("../src/lib/storage");

/** Общий договор хранилища: то, на что опирается приложение. */
async function contract(st: St, mode: string) {
  const org = "org-test", key = `drive-docs/${org}/a1.pdf`, key2 = `drive-docs/${org}/a2.pdf`;
  ok(`${mode}: до записи файла нет`, !st.storedObjectExists(key) && (await st.getStoredFile(key)) === null);
  await st.putStoredFile(key, Buffer.from("%PDF-1 hello"), { contentType: "application/pdf" });
  ok(`${mode}: записанный файл читается байт в байт`, (await st.getStoredFile(key))?.toString() === "%PDF-1 hello");
  ok(`${mode}: проверка «файл есть» — да`, st.storedObjectExists(key));
  await st.putStoredFile(key2, Buffer.alloc(0));
  ok(`${mode}: пустой файл считается «не прикреплён»`, !st.storedObjectExists(key2));
  await st.putStoredFile(`drive-docs/${org}/sub/x.pdf`, Buffer.from("x"));
  const ls = (await st.listStoredFiles(`drive-docs/${org}`)).map((f) => f.name).sort();
  ok(`${mode}: листинг — только файлы этого каталога, без вложенных`, JSON.stringify(ls) === JSON.stringify(["a1.pdf", "a2.pdf"]), JSON.stringify(ls));
  const one = (await st.listStoredFiles(`drive-docs/${org}`)).find((f) => f.name === "a1.pdf");
  ok(`${mode}: листинг даёт размер и время`, one?.size === 12 && Math.abs(Date.now() - (one?.mtimeMs ?? 0)) < 10 * 60_000, JSON.stringify(one));
  await st.deleteStoredFiles([key, key2, `drive-docs/${org}/sub/x.pdf`, `drive-docs/${org}/нет-такого.pdf`]);
  ok(`${mode}: после удаления файла нет, отсутствующий — не ошибка`, !st.storedObjectExists(key) && (await st.getStoredFile(key)) === null);
  // выход из хранилища
  for (const bad of ["../etc/passwd", "drive-docs/../../x", "/abs/path", "a\0b"]) {
    let threw = false;
    try { await st.putStoredFile(bad, Buffer.from("x")); } catch { threw = true; }
    ok(`${mode}: путь «${bad.replace("\0", "\\0")}» отклонён при записи, чтении и проверке`, threw && (await st.getStoredFile(bad)) === null && !st.storedObjectExists(bad));
  }
  await st.removeStoredDirIfEmpty(`drive-docs/${org}/sub`);
  await st.removeStoredDirIfEmpty(`drive-docs/${org}`);
}

(async () => {
  // ── локальная папка ──
  delete process.env.STORAGE;
  const st = await import("../src/lib/storage");
  ok("по умолчанию — локальная папка", st.storageMode() === "local");
  await contract(st, "папка");
  ok("папка: файлы лежат в UPLOAD_DIR", st.UPLOAD_ROOT === dir);
  ok("папка: пустой каталог убран", !existsSync(join(dir, "drive-docs", "org-test")));
  {
    const fx = await import("../src/lib/fitting-files");
    ok("прежние имена fitting-files ведут в хранилище", fx.resolveInside === st.resolveInside && fx.UPLOAD_ROOT === st.UPLOAD_ROOT);
    await st.putStoredFile("fittings/o/f/1.jpg", Buffer.from("jpg"));
    let dup = false;
    try { await st.putStoredFile("fittings/o/f/1.jpg", Buffer.from("other")); } catch { dup = true; }
    ok("папка: повторная запись того же ключа запрещена (как flag wx)", dup && (await fx.readStoredFile("fittings/o/f/1.jpg"))?.toString() === "jpg");
    await fx.removeStoredFiles(["fittings/o/f/1.jpg"]);
    await fx.removeFittingDirIfEmpty("o", "f");
    ok("папка: removeStoredFiles и removeFittingDirIfEmpty работают через хранилище", !existsSync(join(dir, "fittings", "o", "f")));
  }

  // ── S3 (MinIO) ──
  const ep = (process.env.S3_TEST_ENDPOINT ?? "").trim();
  if (!ep) console.log("S3_TEST_ENDPOINT не задан — часть S3 пропущена");
  else {
    const bucket = `fur-test-${Date.now()}`;
    Object.assign(process.env, {
      STORAGE: "s3", S3_ENDPOINT: ep, S3_REGION: "us-east-1", S3_BUCKET: bucket, S3_FORCE_PATH_STYLE: "true", S3_PREFIX: "t1",
      S3_ACCESS_KEY_ID: process.env.S3_TEST_ACCESS_KEY ?? "minioadmin", S3_SECRET_ACCESS_KEY: process.env.S3_TEST_SECRET_KEY ?? "minioadmin",
    });
    const { S3Client, CreateBucketCommand, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand, DeleteBucketCommand } = await import("@aws-sdk/client-s3");
    const raw = new S3Client({ endpoint: ep, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } });
    await raw.send(new CreateBucketCommand({ Bucket: bucket }));
    st.resetStorageForTests();
    ok("STORAGE=s3 — режим S3", st.storageMode() === "s3");
    // файл, положенный в бакет снаружи (перенос), виден после загрузки индекса
    await raw.send(new PutObjectCommand({ Bucket: bucket, Key: "t1/purchase-docs/o/p/old.pdf", Body: "old" }));
    await raw.send(new PutObjectCommand({ Bucket: bucket, Key: "other/purchase-docs/o/p/alien.pdf", Body: "x" }));
    await st.initStorage();
    ok("S3: при старте индекс знает файлы бакета под своим префиксом", st.storedObjectExists("purchase-docs/o/p/old.pdf"));
    ok("S3: чужой префикс не виден", !st.storedObjectExists("purchase-docs/o/p/alien.pdf") && (await st.getStoredFile("purchase-docs/o/p/alien.pdf")) === null);
    await contract(st, "S3");
    const keys = ((await raw.send(new ListObjectsV2Command({ Bucket: bucket }))).Contents ?? []).map((o) => o.Key).sort();
    ok("S3: ключи в бакете — с префиксом S3_PREFIX", JSON.stringify(keys) === JSON.stringify(["other/purchase-docs/o/p/alien.pdf", "t1/purchase-docs/o/p/old.pdf"]), JSON.stringify(keys));
    // удалён снаружи — чтение честно возвращает null и поправляет индекс
    await raw.send(new DeleteObjectCommand({ Bucket: bucket, Key: "t1/purchase-docs/o/p/old.pdf" }));
    ok("S3: удалённый снаружи файл читается как null и выпадает из индекса", (await st.getStoredFile("purchase-docs/o/p/old.pdf")) === null && !st.storedObjectExists("purchase-docs/o/p/old.pdf"));
    // неверный ключ доступа — сервер не падает, файлы «не прикреплены»
    process.env.S3_SECRET_ACCESS_KEY = "wrong-secret";
    st.resetStorageForTests();
    await st.initStorage();
    ok("S3: неверный ключ — старт не падает, файлов нет", !st.storedObjectExists("purchase-docs/o/p/old.pdf") && (await st.getStoredFile("x/y.pdf")) === null);
    st.resetStorageForTests();
    await raw.send(new DeleteObjectCommand({ Bucket: bucket, Key: "other/purchase-docs/o/p/alien.pdf" }));
    await raw.send(new DeleteBucketCommand({ Bucket: bucket }));
  }

  rmSync(dir, { recursive: true, force: true });
  console.log(fails ? `\nПровалов: ${fails} из ${checks}` : `\nВсё в порядке (${checks} проверок)`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
