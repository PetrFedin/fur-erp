/**
 * Привязка локальной копии папки Google Drive «мех» к документам в приложении (DriveDocument).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/attach-local-drive-files.ts <папка «мех»>                 # DRY-RUN
 *   node --env-file=.env node_modules/.bin/tsx scripts/attach-local-drive-files.ts <папка «мех»> --apply         # запись
 *   node --env-file=.env node_modules/.bin/tsx scripts/attach-local-drive-files.ts --rollback docs-inventory/corrections-journal-local-files.json
 *
 * ПЕРЕД --apply СДЕЛАЙТЕ БЭКАП (scripts/backup.sh: база + uploads/).
 * Каталог загрузок — UPLOAD_DIR (как у приложения; по умолчанию ./uploads).
 *
 * Как сопоставляется:
 *   1. «путь»: относительный путь файла в папке = DriveDocument.drivePath (без первого сегмента «мех/»,
 *      либо drivePath оканчивается этим путём) — название файла и путь совпали;
 *   2. «название+размер»: имя файла = название документа/имя в drivePath, размер = sizeBytes.
 *   Сравнение без учёта регистра, повторных пробелов и формы Unicode (macOS хранит имена в NFD).
 *   Строки одного файла Drive (один driveFileId на нескольких закупках/оплатах) получают один и тот же файл.
 *   Если файлу подходит несколько разных файлов Drive или на один файл Drive претендуют несколько локальных —
 *   «неоднозначно», ничего не пишется.
 *   Если такой же файл (то же имя, размер и содержимое) уже загружен как документ закупки (PurchaseDocument),
 *   копия на диске не создаётся — используется тот же путь.
 *   Файлы, у которых в приложении уже есть оригинал, пропускаются (идемпотентно).
 *   Допустимы PDF, XLSX, DOCX, JPEG, PNG до 25 МБ (по содержимому); остальное (msg, xls, больше 25 МБ…) пропускается.
 *
 * --apply: копирует файл в UPLOAD_DIR/drive-docs/<организация>/<uuid>.<ext>, пишет storagePath, storedName,
 * storedMime, storedSize, storedAt. Журнал docs-inventory/corrections-journal-local-files.json дописывается
 * после каждого файла. --rollback <журнал> обнуляет эти поля (если они не менялись после) и удаляет файлы,
 * которые создал скрипт и на которые больше никто не ссылается.
 * Полный отчёт сопоставления — docs-inventory/local-files-report.txt.
 */
import "./lib/drive-links-disabled";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { copyFile, readdir, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { detectDocument } from "../src/lib/doc-sniff";

const prisma = new PrismaClient();
const ROOT = path.resolve(__dirname, "..");
const INV = path.join(ROOT, "docs-inventory");
const JOURNAL_PATH = path.join(INV, "corrections-journal-local-files.json");
const REPORT_PATH = path.join(INV, "local-files-report.txt");
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR?.trim() || "./uploads");
const MAX_BYTES = 25 * 1024 * 1024;

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const rbIdx = args.indexOf("--rollback");
const ROLLBACK = rbIdx >= 0 ? args[rbIdx + 1] : null;
const folder = args.find((a, i) => !a.startsWith("--") && !(rbIdx >= 0 && i === rbIdx + 1));

function resolveInside(rel: string): string | null {
  if (!rel || rel.includes("\0")) return null;
  const abs = path.resolve(UPLOAD_ROOT, rel);
  return abs.startsWith(UPLOAD_ROOT + path.sep) ? abs : null;
}

/** Нормализация для сравнения: NFC, нижний регистр, пробелы схлопнуты, слэши прямые. */
const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/\\/g, "/").replace(/\s+/g, " ").trim();

type JournalEntry = {
  time: string;
  entity: "DriveDocument";
  id: string;
  field: "__attach__";
  before: null;
  after: { storagePath: string; storedName: string; storedMime: string; storedSize: number };
  sha256?: string;
  createdFile: boolean; // файл скопирован скриптом (при откате его можно удалить)
  source: string;
};
const readJournal = (): JournalEntry[] => (existsSync(JOURNAL_PATH) ? JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) : []);
const appendJournal = (e: JournalEntry[]) => {
  mkdirSync(INV, { recursive: true });
  writeFileSync(JOURNAL_PATH, JSON.stringify([...readJournal(), ...e], null, 2));
};

async function removeIfUnused(storagePath: string) {
  const [a, b] = await Promise.all([
    prisma.driveDocument.count({ where: { storagePath } }),
    prisma.purchaseDocument.count({ where: { storagePath } }),
  ]);
  if (a + b > 0) return false;
  const abs = resolveInside(storagePath);
  if (!abs) return false;
  try {
    await unlink(abs);
    return true;
  } catch {
    return false;
  }
}

async function rollback(file: string) {
  const entries = (JSON.parse(readFileSync(path.resolve(file), "utf-8")) as JournalEntry[]).filter((e) => e.field === "__attach__");
  console.log(`Откат по журналу ${file}: ${entries.length} записей. UPLOAD_DIR: ${UPLOAD_ROOT}`);
  let cleared = 0;
  let skipped = 0;
  let removed = 0;
  for (const e of entries) {
    const r = await prisma.driveDocument.updateMany({
      where: { id: e.id, storagePath: e.after.storagePath },
      data: { storagePath: null, storedName: null, storedMime: null, storedSize: null, storedAt: null },
    });
    if (r.count === 0) skipped++;
    else cleared += r.count;
  }
  // Файлы — после того, как все строки обнулены: путь общий для нескольких строк.
  for (const p of new Set(entries.filter((e) => e.createdFile).map((e) => e.after.storagePath))) {
    if (await removeIfUnused(p)) removed++;
  }
  console.log(`Обнулено строк: ${cleared}, уже изменены/отсутствуют: ${skipped}, файлов удалено с диска: ${removed}.`);
}

type LocalFile = { abs: string; rel: string; base: string; size: number };
const SKIP_NAMES = /^(\.DS_Store|Thumbs\.db|desktop\.ini)$/i;

async function walk(dir: string, rootDir: string, out: LocalFile[], skipped: { reason: string; rel: string }[]) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(rootDir, abs).split(path.sep).join("/");
    if (ent.isSymbolicLink()) {
      skipped.push({ reason: "символическая ссылка", rel });
    } else if (ent.isDirectory()) {
      await walk(abs, rootDir, out, skipped);
    } else if (ent.isFile()) {
      if (SKIP_NAMES.test(ent.name) || ent.name.startsWith("~$") || ent.name.startsWith("._")) continue;
      out.push({ abs, rel, base: ent.name, size: (await stat(abs)).size });
    }
  }
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function main() {
  const url = (process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@");
  console.log(`${APPLY ? "ПРИМЕНЕНИЕ" : ROLLBACK ? "ОТКАТ" : "DRY-RUN (в БД не пишем)"}; БД: ${url}; UPLOAD_DIR: ${UPLOAD_ROOT}`);
  if (ROLLBACK) return rollback(ROLLBACK);
  if (!folder) {
    console.error("Укажите путь к локальной копии папки «мех»: … attach-local-drive-files.ts <папка> [--apply]");
    process.exit(1);
  }
  const rootDir = path.resolve(folder);
  if (!existsSync(rootDir) || !(await stat(rootDir)).isDirectory()) {
    console.error(`Папка не найдена: ${rootDir}`);
    process.exit(1);
  }

  const org = await prisma.organization.findFirstOrThrow();
  const docs = await prisma.driveDocument.findMany({ where: { organizationId: org.id } });
  const purchaseDocs = await prisma.purchaseDocument.findMany({ where: { organizationId: org.id } });

  const local: LocalFile[] = [];
  const skipped: { reason: string; rel: string }[] = [];
  await walk(rootDir, rootDir, local, skipped);

  // Группы строк БД по файлу Drive (одна и та же запись на нескольких объектах).
  type Group = { key: string; docs: typeof docs; path: string; names: Set<string>; size: number | null; hasFile: boolean };
  const groups = new Map<string, Group>();
  for (const d of docs) {
    const g = groups.get(d.driveFileId) ?? { key: d.driveFileId, docs: [], path: "", names: new Set<string>(), size: d.sizeBytes, hasFile: false };
    g.docs.push(d);
    if (d.drivePath && !g.path) g.path = norm(d.drivePath);
    g.names.add(norm(d.title));
    if (d.drivePath) g.names.add(norm(d.drivePath.split("/").pop() ?? ""));
    if (d.storagePath) g.hasFile = true;
    groups.set(d.driveFileId, g);
  }
  const groupList = [...groups.values()];

  const matched = new Map<string, { local: LocalFile; how: "путь" | "название+размер" | "fileId в имени" }[]>(); // group.key → кандидаты
  const unmatched: LocalFile[] = [];
  const ambiguous: { local: LocalFile; why: string }[] = [];
  const alreadyInApp: LocalFile[] = [];
  const inPurchaseDocsOnly: LocalFile[] = [];
  const unsupported: { local: LocalFile; reason: string }[] = [];
  const buffers = new Map<string, Buffer>();

  for (const f of local) {
    if (f.size === 0) {
      unsupported.push({ local: f, reason: "пустой файл" });
      continue;
    }
    if (f.size > MAX_BYTES) {
      unsupported.push({ local: f, reason: "больше 25 МБ" });
      continue;
    }
    const head = Buffer.alloc(16);
    const fh = await (await import("node:fs/promises")).open(f.abs, "r");
    try {
      await fh.read(head, 0, 16, 0);
    } finally {
      await fh.close();
    }
    const nameNorm = norm(f.base);
    const relNorm = norm(f.rel);
    const relWithRoot = norm(path.basename(rootDir) + "/" + f.rel);
    // 1) путь
    let cand = groupList.filter((g) => g.path && (g.path === relWithRoot || g.path === relNorm || g.path.endsWith("/" + relNorm)));
    let how: "путь" | "название+размер" | "fileId в имени" = "путь";
    // 1б) fileId Drive в имени файла (выгрузки вида «<fileId>.pdf» или «имя__<fileId>.pdf»)
    if (cand.length === 0) {
      const byId = groupList.filter((g) => g.key.length >= 20 && f.base.includes(g.key));
      if (byId.length) {
        cand = byId;
        how = "fileId в имени";
      }
    }
    // 2) название + размер
    if (cand.length === 0) {
      how = "название+размер";
      cand = groupList.filter((g) => g.size === f.size && g.names.has(nameNorm));
    }
    if (cand.length === 0) {
      const pd = purchaseDocs.find((p) => p.sizeBytes === f.size && (norm(p.originalName) === nameNorm || norm(p.title) === nameNorm));
      (pd ? inPurchaseDocsOnly : unmatched).push(f);
      continue;
    }
    if (cand.length > 1) {
      ambiguous.push({ local: f, why: `подходит ${cand.length} разных файлов Drive (${how})` });
      continue;
    }
    const g = cand[0];
    if (g.hasFile && g.docs.every((d) => d.storagePath)) {
      alreadyInApp.push(f);
      continue;
    }
    const list = matched.get(g.key) ?? [];
    list.push({ local: f, how });
    matched.set(g.key, list);
  }

  // Один файл Drive — несколько локальных кандидатов: берём единственного с совпавшим путём; иначе неоднозначно.
  type Plan = { group: Group; local: LocalFile; how: "путь" | "название+размер" | "fileId в имени"; kind: { mime: string; ext: string }; reuse: string | null };
  const plans: Plan[] = [];
  for (const [key, list] of matched) {
    const g = groups.get(key)!;
    const byPath = list.filter((x) => x.how === "путь");
    const pick = list.length === 1 ? list[0] : byPath.length === 1 ? byPath[0] : null;
    if (!pick) {
      for (const x of list) ambiguous.push({ local: x.local, why: `на один файл Drive претендуют ${list.length} локальных файла(ов)` });
      continue;
    }
    for (const x of list) if (x !== pick) ambiguous.push({ local: x.local, why: "дубль: тот же файл Drive уже сопоставлен с другим локальным" });
    const buf = await readFile(pick.local.abs);
    const kind = detectDocument(buf.subarray(0, 16), pick.local.base, buf);
    if (!kind) {
      unsupported.push({ local: pick.local, reason: "тип не поддерживается (нужны PDF, XLSX, DOCX, JPEG, PNG)" });
      continue;
    }
    buffers.set(pick.local.abs, buf);
    // Тот же файл уже есть как документ закупки — используем его путь, копию не делаем.
    let reuse: string | null = null;
    const h = sha(buf);
    for (const p of purchaseDocs.filter((p) => p.sizeBytes === buf.length)) {
      const abs = resolveInside(p.storagePath);
      if (!abs) continue;
      try {
        if (sha(await readFile(abs)) === h) {
          reuse = p.storagePath;
          break;
        }
      } catch {
        // файла нет на диске — не используем
      }
    }
    plans.push({ group: g, local: pick.local, how: pick.how, kind, reuse });
  }

  const supportedTotal = local.length - unsupported.length;
  const lines: string[] = [];
  const L = (s: string) => lines.push(s);
  L(`Папка: ${rootDir}`);
  L(`Файлов в папке: ${local.length}; пропущено (тип/размер/ссылки): ${unsupported.length + skipped.length}`);
  L(`Документов Drive в базе: ${docs.length} (файлов Drive: ${groupList.length}); уже с файлом в приложении: ${groupList.filter((g) => g.hasFile).length}`);
  L("");
  L(`СОПОСТАВЛЕНО: ${plans.length} из ${supportedTotal} подходящих файлов (по пути: ${plans.filter((p) => p.how === "путь").length}, по названию+размеру: ${plans.filter((p) => p.how !== "путь").length}); строк БД получат файл: ${plans.reduce((s, p) => s + p.group.docs.filter((d) => !d.storagePath).length, 0)}`);
  L(`Уже в приложении (пропущено): ${alreadyInApp.length}; уже есть как документ закупки (без Drive-записи): ${inPurchaseDocsOnly.length}`);
  L(`НЕ НАЙДЕНО в базе (лишние локальные файлы): ${unmatched.length}`);
  const matchedKeys = new Set(plans.map((p) => p.group.key));
  const noFile = groupList.filter((g) => !g.hasFile && !matchedKeys.has(g.key));
  L(`ФАЙЛ НЕ НАШЁЛСЯ для файлов Drive из базы: ${noFile.length} (строк ${noFile.reduce((s, g) => s + g.docs.length, 0)}) — в интерфейсе «файл не загружен»`);
  L(`НЕОДНОЗНАЧНО: ${ambiguous.length}`);
  L("");
  L("--- сопоставлено ---");
  for (const p of plans) L(`[${p.how}] ${p.local.rel}  ->  «${p.group.docs[0].title}» (строк ${p.group.docs.length})${p.reuse ? "  [файл уже есть у документа закупки, копия не нужна]" : ""}`);
  L("--- файлы Drive из базы без локального файла ---");
  for (const g of noFile) L(`${g.docs[0].drivePath ?? g.docs[0].title}  (${g.docs[0].docType}, строк ${g.docs.length})`);
  L("--- лишние локальные файлы (в базе нет такого документа) ---");
  for (const f of unmatched) L(f.rel);
  L("--- неоднозначно ---");
  for (const a of ambiguous) L(`${a.local.rel}  — ${a.why}`);
  L("--- пропущено ---");
  for (const u of unsupported) L(`${u.local.rel}  — ${u.reason}`);
  for (const s of skipped) L(`${s.rel}  — ${s.reason}`);
  mkdirSync(INV, { recursive: true });
  writeFileSync(REPORT_PATH, lines.join("\n") + "\n");

  console.log(lines.slice(0, 7).join("\n"));
  console.log(`\nНе найдено в базе (первые 15): ${unmatched.slice(0, 15).map((f) => f.rel).join(" | ") || "—"}`);
  console.log(`Неоднозначно (первые 15): ${ambiguous.slice(0, 15).map((a) => `${a.local.rel} — ${a.why}`).join(" | ") || "—"}`);
  console.log(`Полный отчёт: ${REPORT_PATH}`);

  if (!APPLY) {
    console.log("\nDRY-RUN: ничего не записано. Для записи добавьте --apply (после scripts/backup.sh).");
    return;
  }

  let written = 0;
  let copied = 0;
  for (const p of plans) {
    const targets = p.group.docs.filter((d) => !d.storagePath);
    if (targets.length === 0) continue;
    let rel = p.reuse;
    let created = false;
    if (!rel) {
      rel = path.join("drive-docs", org.id, `${randomUUID()}.${p.kind.ext}`);
      const abs = resolveInside(rel);
      if (!abs) throw new Error(`Некорректный путь ${rel}`);
      mkdirSync(path.dirname(abs), { recursive: true });
      await copyFile(p.local.abs, abs, 1 /* COPYFILE_EXCL */);
      created = true;
      copied++;
    }
    const buf = buffers.get(p.local.abs)!;
    const data = { storagePath: rel, storedName: p.local.base.slice(0, 200), storedMime: p.kind.mime, storedSize: buf.length };
    try {
      const r = await prisma.driveDocument.updateMany({
        where: { id: { in: targets.map((d) => d.id) }, storagePath: null },
        data: { ...data, storedAt: new Date() },
      });
      written += r.count;
    } catch (e) {
      if (created) await unlink(resolveInside(rel)!).catch(() => {});
      throw e;
    }
    // Журнал — после каждого файла.
    appendJournal(
      targets.map((d, i) => ({
        time: new Date().toISOString(),
        entity: "DriveDocument" as const,
        id: d.id,
        field: "__attach__" as const,
        before: null,
        after: data,
        sha256: sha(buf),
        createdFile: created && i === 0,
        source: p.local.rel,
      })),
    );
  }
  console.log(`\nГОТОВО: строк DriveDocument обновлено ${written}, файлов скопировано ${copied}. Журнал ${JOURNAL_PATH}. Откат: --rollback ${JOURNAL_PATH}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
