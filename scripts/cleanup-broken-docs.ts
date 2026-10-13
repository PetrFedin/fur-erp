/**
 * «Битые» документы (13.10.2026): записи PurchaseDocument / DriveDocument без реального файла, тестовые записи,
 * дубли и «осиротевшие» файлы на диске. По умолчанию — ПРОБНЫЙ ПРОГОН (ничего не пишет, печатает доказательный список).
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/cleanup-broken-docs.ts [--apply] [--restore-files]
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/cleanup-broken-docs.ts --rollback [--apply]
 * Для пробы на копии: DATABASE_URL=…/fur_erp_scratch_pay UPLOAD_DIR=/путь/к/копии (без --env-file).
 *
 * Что считается «битым» (запись или файл):
 *   • файл из storagePath отсутствует / нулевого размера / не читается в UPLOAD_DIR;
 *   • имя записи/файла похоже на тестовое (broken*, test*, ТЕСТ*, «тест»);
 *   • дубль: тот же driveFileId на тех же привязках (остаётся самая ранняя запись);
 *   • файл на диске, на который не ссылается ни одна запись БД (осиротевший).
 *
 * Что делает --apply (перед записью сам вызывает scripts/backup.sh: дамп БД + архив загрузок):
 *   • УДАЛЯЕТ запись только если одновременно: файла нет нигде (ни в UPLOAD_DIR, ни в CLEANUP_FALLBACK_DIRS),
 *     нет ссылки на Drive (viewUrl), нет заметок (notes), нет привязки к платежу/оплате, на запись не ссылается
 *     ни один платёж (Payment.documentId) и родитель (закупка/ТЗ/партия/платёж) не подтверждён;
 *   • запись со ссылкой на Drive, но с потерянным файлом — НЕ удаляет, а чистит поля storedName, storedMime, storedSize, storagePath
 *     (остаётся «ссылка на Drive», файл помечается «не загружен»);
 *   • запись с потерянным файлом, который лежит в другой копии приложения (CLEANUP_FALLBACK_DIRS, по умолчанию
 *     ../fur-erp-live/uploads) — оставляет; с --restore-files копирует файл в UPLOAD_DIR (cp без перезаписи);
 *   • запись со смыслом (заметки/привязки/подтверждения), но без файла и без ссылки — только в отчёт «нужно решение»;
 *   • дубли удаляет (самая ранняя остаётся), если дубль не используется платежом и не хранит свой файл;
 *   • осиротевшие файлы-заглушки (≤ 64 байт, без ссылок в БД) ПЕРЕНОСИТ в docs-inventory/broken-docs-files-2026-10-13/
 *     (не стирает); более крупные осиротевшие файлы только в отчёт.
 * Флаг --no-backup — только для проб на копии. Журнал: docs-inventory/corrections-journal-broken-docs-2026-10-13.json (старые значения целиком).
 * --rollback --apply: возвращает удалённые записи, очищенные поля и перенесённые файлы.
 */
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const RESTORE = args.includes("--restore-files");
const NO_BACKUP = args.includes("--no-backup"); // только для проб на копии БД: backup.sh читает DATABASE_URL из .env (живая база)
const ROOT = path.join(__dirname, "..");
const INV = path.join(ROOT, "docs-inventory");
const JOURNAL = path.join(INV, "corrections-journal-broken-docs-2026-10-13.json");
const MOVED = path.join(INV, "broken-docs-files-2026-10-13");
const UPLOAD = path.resolve(process.env.UPLOAD_DIR?.trim() || "./uploads");
const FALLBACKS = (process.env.CLEANUP_FALLBACK_DIRS ?? path.join(ROOT, "..", "fur-erp-live", "uploads"))
  .split(path.delimiter).filter(Boolean).map((p) => path.resolve(p)).filter((p) => p !== UPLOAD);
const STUB_MAX = 64;
const TEST_RE = /(^|[^a-zа-яё])(broken|test|тест)|^(broken|test|тест)/i;

type J = { time: string; action: "delete" | "clearFile" | "moveFile" | "restoreFile"; model?: "PurchaseDocument" | "DriveDocument"; id?: string; label: string; reason: string; before?: unknown; file?: string; movedTo?: string; rolledBack?: string };
const readJ = (): J[] => (existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : []);
const writeJ = (j: J[]) => writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
const prisma = new PrismaClient();
const log = (...a: unknown[]) => console.log(...a);
const DATE_FIELDS = ["createdAt", "docDate", "storedAt"];
const revive = (row: Record<string, unknown>) => { for (const k of DATE_FIELDS) if (typeof row[k] === "string") row[k] = new Date(row[k] as string); return row; };

type FileState = "ok" | "missing" | "empty" | "unreadable";
function fileState(abs: string): FileState {
  try {
    const st = statSync(abs);
    if (!st.isFile()) return "missing";
    if (st.size === 0) return "empty";
    readFileSync(abs, { flag: "r" }).subarray(0, 1);
    return "ok";
  } catch (e) { return (e as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable"; }
}
const inFallback = (rel: string) => FALLBACKS.find((d) => fileState(path.join(d, rel)) === "ok");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.isFile()) out.push(p);
  }
  return out;
}

async function rollback() {
  const j = readJ();
  for (const e of j.slice().reverse()) {
    if (e.rolledBack) continue;
    log(APPLY ? "откат" : "будет откачено", e.action, e.label);
    if (!APPLY) continue;
    if (e.action === "delete") {
      const row = revive(e.before as Record<string, unknown>);
      if (e.model === "PurchaseDocument") await prisma.purchaseDocument.create({ data: row as never });
      else await prisma.driveDocument.create({ data: row as never });
    } else if (e.action === "clearFile") {
      const b = e.before as Record<string, unknown>;
      await prisma.driveDocument.update({ where: { id: e.id! }, data: revive({ ...b }) as never });
    } else if (e.action === "restoreFile" && e.movedTo) {
      if (existsSync(e.movedTo)) unlinkSync(e.movedTo);
    } else if (e.action === "moveFile" && e.movedTo && e.file) {
      mkdirSync(path.dirname(path.join(UPLOAD, e.file)), { recursive: true });
      if (existsSync(e.movedTo)) renameSync(e.movedTo, path.join(UPLOAD, e.file));
    }
    e.rolledBack = new Date().toISOString();
    writeJ(j);
  }
}

async function main() {
  if (ROLLBACK) return rollback();
  const journal = readJ();
  const push = (e: Omit<J, "time">) => { if (APPLY) { journal.push({ time: new Date().toISOString(), ...e }); writeJ(journal); } };
  log(APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН", "| загрузки:", UPLOAD, "| запасные каталоги:", FALLBACKS.join(", ") || "—");
  if (APPLY && !NO_BACKUP) {
    log("резервная копия (scripts/backup.sh)…");
    log(execFileSync("bash", [path.join(ROOT, "scripts", "backup.sh")], { env: { ...process.env, UPLOAD_DIR: UPLOAD }, encoding: "utf-8" }).trim());
  }

  const [pdocs, ddocs] = await Promise.all([
    prisma.purchaseDocument.findMany({ include: { payments: { select: { id: true, amount: true, paidAt: true, confirmed: true } }, purchase: { select: { number: true, verifiedAt: true } } } }),
    prisma.driveDocument.findMany({ include: { payment: { select: { id: true, confirmed: true } }, productionPayment: { select: { id: true, confirmed: true } }, purchase: { select: { number: true, verifiedAt: true } }, productionOrder: { select: { number: true, verifiedAt: true } }, productionBatch: { select: { number: true, verifiedAt: true } } } }),
  ]);

  const report: string[][] = [];
  const stats = { delete: 0, clear: 0, keepFallback: 0, decision: 0, ok: 0 };
  const referenced = new Set<string>();

  // ---------- PurchaseDocument ----------
  for (const d of pdocs) {
    referenced.add(d.storagePath);
    const st = fileState(path.join(UPLOAD, d.storagePath));
    const test = TEST_RE.test(d.title) || TEST_RE.test(d.originalName);
    if (st === "ok" && !test) { stats.ok++; continue; }
    const fb = st === "ok" ? undefined : inFallback(d.storagePath);
    const usedBy = d.payments.map((p) => `Payment ${p.id} (${p.amount}, ${p.confirmed ? "подтв." : "не подтв."})`);
    const confirmed = d.purchase?.verifiedAt ? `закупка ${d.purchase.number} подтверждена` : "";
    const why = [st !== "ok" ? `файл: ${st}` : "", test ? "тестовое имя" : ""].filter(Boolean).join("; ");
    const row = { ...d, payments: undefined, purchase: undefined };
    let decision: string;
    if (fb) { decision = `оставить: файл есть в ${fb} (--restore-files скопирует)`; stats.keepFallback++; if (APPLY && RESTORE) { const dst = path.join(UPLOAD, d.storagePath); mkdirSync(path.dirname(dst), { recursive: true }); if (!existsSync(dst)) { copyFileSync(path.join(fb, d.storagePath), dst); push({ action: "restoreFile", model: "PurchaseDocument", id: d.id, label: d.title, reason: "файл из запасного каталога", file: d.storagePath, movedTo: dst }); } } }
    else if (st === "ok") { decision = "оставить: файл на месте (только тестовое имя — решить вручную)"; stats.decision++; }
    else if (usedBy.length || confirmed) { decision = "НУЖНО РЕШЕНИЕ: на запись ссылаются платёж/подтверждение, файла нет"; stats.decision++; }
    else { decision = "УДАЛИТЬ: файла нет нигде, ссылок нет"; stats.delete++; if (APPLY) { await prisma.purchaseDocument.delete({ where: { id: d.id } }); push({ action: "delete", model: "PurchaseDocument", id: d.id, label: d.title, reason: why, before: row }); } }
    report.push(["PurchaseDocument", d.id, d.title.slice(0, 50), d.kind, d.purchase?.number ?? d.batch ?? "—", why, [...usedBy, confirmed].filter(Boolean).join("; ") || "ссылок нет", decision]);
  }

  // ---------- DriveDocument ----------
  const seen = new Map<string, string>();
  const sorted = [...ddocs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const d of sorted) {
    if (d.storagePath) referenced.add(d.storagePath);
    const links = [d.purchaseId, d.lotId, d.productionOrderId, d.productionBatchId, d.paymentId, d.productionPaymentId, d.clientId, d.supplierId].map((x) => x ?? "").join("|");
    const key = `${d.driveFileId}#${links}`;
    const first = seen.get(key);
    if (!first) seen.set(key, d.id);
    const dup = !!first;
    const st: FileState | "none" = d.storagePath ? fileState(path.join(UPLOAD, d.storagePath)) : "none";
    const test = TEST_RE.test(d.title) || TEST_RE.test(d.storedName ?? "");
    if (!dup && !test && (st === "ok" || st === "none")) { stats.ok++; continue; }
    const fb = d.storagePath && st !== "ok" && st !== "none" ? inFallback(d.storagePath) : undefined;
    const parents = [d.purchase && `закупка ${d.purchase.number}`, d.productionOrder && `ТЗ ${d.productionOrder.number}`, d.productionBatch && `партия ${d.productionBatch.number}`, d.payment && "платёж", d.productionPayment && "оплата пошива"].filter(Boolean).join(", ") || "—";
    const confirmed = [d.purchase?.verifiedAt && "закупка подтверждена", d.productionOrder?.verifiedAt && "ТЗ подтверждено", d.productionBatch?.verifiedAt && "партия подтверждена", d.payment?.confirmed && "платёж подтверждён", d.productionPayment?.confirmed && "оплата подтверждена"].filter(Boolean).join(", ");
    const why = [st !== "ok" && st !== "none" ? `файл: ${st}` : "", test ? "тестовое имя" : "", dup ? `дубль записи ${first}` : ""].filter(Boolean).join("; ");
    const row = { ...d, payment: undefined, productionPayment: undefined, purchase: undefined, productionOrder: undefined, productionBatch: undefined };
    let decision: string;
    if (dup && st !== "missing" && st !== "empty" && st !== "unreadable" && !d.paymentId) {
      decision = `УДАЛИТЬ дубль (оставить ${first})`; stats.delete++;
      if (APPLY) { await prisma.driveDocument.delete({ where: { id: d.id } }); push({ action: "delete", model: "DriveDocument", id: d.id, label: d.title, reason: why, before: row }); }
    } else if (fb) {
      decision = `оставить: файл есть в ${fb} (--restore-files скопирует)`; stats.keepFallback++;
      if (APPLY && RESTORE) { const dst = path.join(UPLOAD, d.storagePath!); mkdirSync(path.dirname(dst), { recursive: true }); if (!existsSync(dst)) { copyFileSync(path.join(fb, d.storagePath!), dst); push({ action: "restoreFile", model: "DriveDocument", id: d.id, label: d.title, reason: "файл из запасного каталога", file: d.storagePath!, movedTo: dst }); } }
    } else if (st === "none" || st === "ok") { decision = "НУЖНО РЕШЕНИЕ: тестовое имя / дубль, но запись со смыслом"; stats.decision++; }
    else if (d.viewUrl) {
      decision = "оставить как «ссылка на Drive»: очистить поля загруженного файла"; stats.clear++;
      if (APPLY) { const before = { storagePath: d.storagePath, storedName: d.storedName, storedMime: d.storedMime, storedSize: d.storedSize, storedAt: d.storedAt }; await prisma.driveDocument.update({ where: { id: d.id }, data: { storagePath: null, storedName: null, storedMime: null, storedSize: null, storedAt: null } }); push({ action: "clearFile", model: "DriveDocument", id: d.id, label: d.title, reason: why, before }); }
    } else if (d.notes || d.paymentId || d.productionPaymentId || confirmed) {
      decision = "НУЖНО РЕШЕНИЕ: нет файла и ссылки на Drive, но есть заметки/привязка/подтверждение"; stats.decision++;
    } else {
      decision = "УДАЛИТЬ: файла нет нигде, ссылки на Drive нет, смысла нет"; stats.delete++;
      if (APPLY) { await prisma.driveDocument.delete({ where: { id: d.id } }); push({ action: "delete", model: "DriveDocument", id: d.id, label: d.title, reason: why, before: row }); }
    }
    report.push(["DriveDocument", d.id, d.title.slice(0, 50), d.docType, parents, why, confirmed || "подтверждений нет", decision + (d.notes ? ` | заметка: ${d.notes.slice(0, 60)}` : "")]);
  }

  // ---------- осиротевшие файлы ----------
  const orphans: string[] = [];
  for (const sub of ["drive-docs", "purchase-docs"]) {
    for (const abs of walk(path.join(UPLOAD, sub))) {
      const rel = path.relative(UPLOAD, abs).split(path.sep).join("/");
      if (referenced.has(rel)) continue;
      orphans.push(rel);
      const size = statSync(abs).size;
      const stub = size <= STUB_MAX;
      report.push(["файл на диске", rel.split("/").pop()!, rel, `${size} байт`, "—", "на файл не ссылается ни одна запись БД", "ссылок нет", stub ? "ПЕРЕНЕСТИ в docs-inventory/broken-docs-files-2026-10-13 (заглушка)" : "НУЖНО РЕШЕНИЕ: крупный осиротевший файл"]);
      if (!stub) { stats.decision++; continue; }
      stats.delete++;
      if (APPLY) { const dst = path.join(MOVED, rel); mkdirSync(path.dirname(dst), { recursive: true }); renameSync(abs, dst); push({ action: "moveFile", label: rel, reason: `осиротевшая заглушка ${size} байт`, file: rel, movedTo: dst }); }
    }
  }

  log("\nтип | id | название | вид | привязка | почему «битый» | кто ссылается | решение");
  for (const r of report) log(r.join(" | "));
  log(`\nитого: удалить/перенести ${stats.delete}; очистить поля файла (ссылка на Drive) ${stats.clear}; оставить, файл есть в другой копии ${stats.keepFallback}; нужно решение ${stats.decision}; исправных записей ${stats.ok}`);
  log(`осиротевших файлов на диске: ${orphans.length}`);
  if (!APPLY) log("\nПробный прогон: ничего не изменено. Для применения добавьте --apply.");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
