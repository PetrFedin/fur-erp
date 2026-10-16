/**
 * Очистка БД от внешних ссылок на Google Диск и от «MVST» (решения владельца от 16.10.2026).
 *
 *   А. «MVST» → «THE FUR» в названиях документов, именах файлов, заметках, описаниях, комментариях и подписи журнала;
 *   Б. DriveDocument.viewUrl / drivePath → пусто (строки и привязки к закупкам/ТЗ/оплатам сохраняются), driveFileId (был
 *      идентификатором файла на Диске) → устойчивый внутренний ключ «doc-…» (один старый id → один новый, группировка
 *      «один файл — несколько привязок» не меняется); упоминания «… в Drive» в заметках вырезаются/переписываются;
 *   В. фразы про внешние реестры/файлы вырезаются целиком (см. scripts/lib/scrub-text.ts).
 * НЕ трогаем: AuditLog.changes (исторический журнал), SystemState.value, User.email (логин), имена миграций,
 * каталог UPLOAD_DIR/drive-docs (внутренний путь хранения).
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/scrub-drive-and-mvst-2026-10-16.ts                  # пробный прогон (по умолчанию)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/scrub-drive-and-mvst-2026-10-16.ts --apply --live  # боевая база: сам делает bash scripts/backup.sh
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/scrub-drive-and-mvst-2026-10-16.ts --rollback --apply [--live] [--force]   # --force: вернуть и поля, изменённые после очистки
 *   (на копии базы: DATABASE_URL на копию, --apply без --live; бэкап не делается)
 *
 * Журнал отката (полная копия затираемых значений): docs-inventory/scrub-drive-and-mvst-2026-10-16.journal.json
 * и дубль вне репозитория: ~/Backups/fur-erp/drive-links-removed-2026-10-16.json. Запись — через createAuditedClient
 * («script:scrub-external-refs»); поля driveFileId/drivePath/viewUrl в журнал изменений не попадают (audit-core IGNORED_FIELDS).
 */
import "./stubs/server-only-shim";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { internalFileKey, residual, scrubJson, scrubNote, scrubTitle } from "./lib/scrub-text";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const ALLOW_RESIDUAL = process.argv.includes("--allow-residual");
const FORCE = process.argv.includes("--force");
const SANITIZE_ONLY = process.argv.includes("--sanitize-audit");
const ACTOR_SOURCE = "script:scrub-external-refs";
const PLACEHOLDER = "(прежний текст убран при очистке 16.10.2026)";
const SCRIPT = "scrub-drive-and-mvst-2026-10-16";
const ROOT = join(__dirname, "..");
const JOURNAL = join(ROOT, "docs-inventory", `${SCRIPT}.journal.json`);
const OUTSIDE = join(homedir(), "Backups", "fur-erp", "drive-links-removed-2026-10-16.json");
const REPORT = join(ROOT, "docs-inventory", `${SCRIPT}.dry-run.txt`);

type Kind = "note" | "title" | "json" | "link" | "key";
/** Модель Prisma (delegate), таблица (для счётчиков), поле, вид очистки. */
const TARGETS: { model: string; table: string; field: string; kind: Kind }[] = [
  { model: "driveDocument", table: "DriveDocument", field: "title", kind: "title" },
  { model: "driveDocument", table: "DriveDocument", field: "notes", kind: "note" },
  { model: "driveDocument", table: "DriveDocument", field: "drivePath", kind: "link" },
  { model: "driveDocument", table: "DriveDocument", field: "viewUrl", kind: "link" },
  { model: "driveDocument", table: "DriveDocument", field: "driveFileId", kind: "key" },
  { model: "supplierInboxFile", table: "SupplierInboxFile", field: "originalName", kind: "title" },
  { model: "payment", table: "Payment", field: "notes", kind: "note" },
  { model: "productionPayment", table: "ProductionPayment", field: "notes", kind: "note" },
  { model: "stockMovement", table: "StockMovement", field: "notes", kind: "note" },
  { model: "productionOrder", table: "ProductionOrder", field: "notes", kind: "note" },
  { model: "productionBatch", table: "ProductionBatch", field: "notes", kind: "note" },
  { model: "purchase", table: "Purchase", field: "notes", kind: "note" },
  { model: "purchaseItem", table: "PurchaseItem", field: "costPlan", kind: "json" },
  { model: "auction", table: "Auction", field: "note", kind: "note" },
  { model: "productModel", table: "ProductModel", field: "description", kind: "note" },
  { model: "categoryRef", table: "CategoryRef", field: "note", kind: "note" },
  { model: "colorRef", table: "ColorRef", field: "note", kind: "note" },
  { model: "supplyPlanEntry", table: "SupplyPlanEntry", field: "notes", kind: "note" },
];

type Op = { table: string; model: string; id: string; field: string; before: unknown; after: unknown };
type Journal = { script: string; status: "applied" | "rolled-back"; db: string; at: string; ops: Op[]; keyMap: Record<string, string> };

const readJson = <T,>(p: string, d: T): T => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : d);
const writeJson = (p: string, v: unknown) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 1) + "\n"); };
const short = (v: unknown) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s == null ? "∅" : s.length > 90 ? s.slice(0, 90) + "…" : s; };
/** Окно вокруг первого отличия — чтобы в пробном прогоне было видно «было → стало», а не целую заметку. */
function windowDiff(a: string, b: string): [string, string] {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let ea = a.length, eb = b.length;
  while (ea > i && eb > i && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const from = Math.max(0, i - 30);
  const cut = (s: string, e: number) => s.slice(from, Math.min(s.length, e + 30)).replace(/\s+/g, " ");
  return [cut(a, ea), cut(b, eb)];
}

/**
 * Записи журнала изменений, которые написала сама очистка (source = «script:scrub-external-refs»), хранят в «было» старый текст
 * с упоминаниями Диска и MVST — а он как раз затирается. Поэтому «было» в этих записях заменяется пометкой; полная копия старых
 * значений лежит в журнале отката (docs-inventory) и в дубле вне репозитория. Идемпотентно.
 */
async function sanitizeAudit(raw: Record<string, any>): Promise<number> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const rows: { id: string; changes: unknown; label: string | null; action: string }[] = await raw.auditLog.findMany({ where: { source: ACTOR_SOURCE }, select: { id: true, changes: true, label: true, action: true } });
  let n = 0;
  for (const r of rows) {
    let changed = false;
    let changes = r.changes;
    if (r.action === "update" && changes && typeof changes === "object" && !Array.isArray(changes)) {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(changes as Record<string, unknown>)) {
        if (Array.isArray(v) && v.length === 2 && v[0] !== PLACEHOLDER && v[0] != null) { o[k] = [PLACEHOLDER, v[1]]; changed = true; } else o[k] = v;
      }
      changes = o;
    }
    const label = r.label == null ? null : scrubTitle(r.label);
    if (label !== r.label) changed = true;
    if (changed) { await raw.auditLog.update({ where: { id: r.id }, data: { changes: changes as object, label } }); n++; }
  }
  return n;
}

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient(ACTOR_SOURCE);
  const url = process.env.DATABASE_URL ?? "";
  const isLive = /\/fur_erp(\?|$)/.test(url);
  const dbName = /\/([^/?]+)(\?|$)/.exec(url)?.[1] ?? "?";
  console.log(`База: ${dbName}${isLive ? " (БОЕВАЯ)" : ""}; режим: ${ROLLBACK ? "откат" : "очистка"}${APPLY ? " — ПРИМЕНЕНИЕ" : " — пробный прогон"}`);
  if (APPLY && isLive && !LIVE) { console.log("Это боевая база: для записи нужен флаг --live (он сам сделает бэкап). Ничего не изменено."); process.exitCode = 1; await prisma.$disconnect(); return; }
  const db = prisma as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const rawBase = (prisma as unknown as { $rawBase: Record<string, any> }).$rawBase; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (SANITIZE_ONLY) {
    if (!APPLY) { console.log("Только с --apply."); await prisma.$disconnect(); return; }
    console.log(`Журнал изменений: «было» заменено в записях: ${await sanitizeAudit(rawBase)}`);
    await prisma.$disconnect();
    return;
  }

  // ---------- откат ----------
  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    const byRow = new Map<string, { model: string; id: string; data: Record<string, unknown>; ops: Op[] }>();
    for (const o of j.ops.filter((x) => x.table !== "AuditLog")) {
      const k = `${o.model}:${o.id}`;
      const e = byRow.get(k) ?? { model: o.model, id: o.id, data: {}, ops: [] };
      e.data[o.field] = o.before; e.ops.push(o); byRow.set(k, e);
    }
    console.log(`Откат: полей ${j.ops.length}, строк ${byRow.size}${APPLY ? "" : " (пробный — добавьте --apply)"}`);
    let conflicts = 0;
    for (const e of byRow.values()) {
      const cur = await db[e.model].findUnique({ where: { id: e.id } });
      if (!cur) { console.log(`  строка ${e.model} ${e.id} удалена после очистки — пропуск`); continue; }
      for (const o of e.ops) {
        const now = JSON.stringify(cur[o.field] ?? null);
        if (now !== JSON.stringify(o.after ?? null)) { conflicts++; console.log(`  ! ${o.table}.${o.field} ${o.id}: значение менялось после очистки (или не было записано) — ${FORCE ? "будет возвращено значение из журнала (--force)" : "не трогаем (добавьте --force, чтобы вернуть)"}`); }
      }
    }
    if (!APPLY) { console.log(`Пробный откат: конфликтов ${conflicts}. Для записи — --rollback --apply.`); await prisma.$disconnect(); return; }
    if (isLive) { console.log("Копия базы перед откатом: bash scripts/backup.sh …"); execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: ROOT }); }
    const rows = [...byRow.values()];
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      await prisma.$transaction(async (tx) => {
        for (const e of chunk) {
          const t = tx as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
          const cur = await t[e.model].findUnique({ where: { id: e.id } });
          if (!cur) continue;
          const data: Record<string, unknown> = {};
          for (const o of e.ops) if (FORCE || JSON.stringify(cur[o.field] ?? null) === JSON.stringify(o.after ?? null)) data[o.field] = o.before;
          if (Object.keys(data).length) await t[e.model].update({ where: { id: e.id }, data });
        }
      }, { timeout: 120000, maxWait: 30000 });
    }
    // AuditLog.label (подпись журнала) — вне журнала изменений
    for (const o of j.ops.filter((x) => x.table === "AuditLog")) await (prisma as unknown as { $rawBase: { auditLog: { update: (a: unknown) => Promise<unknown> } } }).$rawBase.auditLog.update({ where: { id: o.id }, data: { label: o.before } });
    writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
    console.log("Откат выполнен.");
    await prisma.$disconnect();
    return;
  }

  // ---------- план очистки ----------
  const prev = readJson<Journal | null>(JOURNAL, null);
  const problems: string[] = [];
  if (prev && prev.status === "applied" && prev.db === dbName) problems.push("журнал уже содержит применённую очистку этой базы — сначала --rollback --apply");
  const ops: Op[] = [];
  const keyMap: Record<string, string> = {};
  const lines: string[] = [];
  const stats: Record<string, { rows: number; before: Record<string, number>; after: Record<string, number> }> = {};
  const count = (re: RegExp, s: string) => (re.test(s) ? 1 : 0);
  const PATS: Record<string, RegExp> = { MVST: /mvst/i, "Drive/Google": /drive|google/i, "ссылка Google": /(drive|docs)\.google/i, "единый реестр": /едины[йм] реестр|ЕДИНЫЙ_РЕЕСТР/i };

  for (const t of TARGETS) {
    const rows: { id: string; v: unknown }[] = (await db[t.model].findMany({ select: { id: true, [t.field]: true } })).map((r: Record<string, unknown>) => ({ id: r.id as string, v: r[t.field] }));
    const key = `${t.table}.${t.field}`;
    const st: (typeof stats)[string] = (stats[key] = { rows: rows.length, before: { MVST: 0, "Drive/Google": 0, "ссылка Google": 0, "единый реестр": 0, "непусто": 0 }, after: { MVST: 0, "Drive/Google": 0, "ссылка Google": 0, "единый реестр": 0, "непусто": 0 } });
    for (const r of rows) {
      const bs = r.v == null ? "" : typeof r.v === "string" ? r.v : JSON.stringify(r.v);
      if (bs) st.before["непусто"]++;
      for (const [n, re] of Object.entries(PATS)) st.before[n] += count(re, bs);
      let after: unknown = r.v;
      if (r.v != null) {
        if (t.kind === "title") after = scrubTitle(r.v as string);
        else if (t.kind === "note") after = scrubNote(r.v as string);
        else if (t.kind === "json") after = scrubJson(r.v);
        else if (t.kind === "link") after = null;
        else if (t.kind === "key") {
          const old = r.v as string;
          after = /^local-/.test(old) || /^doc-[0-9a-f]{24}$/.test(old) ? old : (keyMap[old] ??= internalFileKey(old));
        }
      }
      const as = after == null ? "" : typeof after === "string" ? after : JSON.stringify(after);
      if (as) st.after["непусто"]++;
      for (const [n, re] of Object.entries(PATS)) st.after[n] += count(re, as);
      if (JSON.stringify(after ?? null) === JSON.stringify(r.v ?? null)) continue;
      ops.push({ table: t.table, model: t.model, id: r.id, field: t.field, before: r.v ?? null, after: after ?? null });
      let a = typeof r.v === "string" ? r.v : JSON.stringify(r.v), b = as;
      if (t.kind === "link") { a = short(a); b = "∅"; } else if (t.kind === "key") { a = a.slice(0, 8) + "…"; b = as; } else [a, b] = windowDiff(a, b);
      lines.push(`${key} ${r.id}: «${a}» → «${b}»`);
      if (t.kind !== "link" && t.kind !== "key") { const res = residual(as); if (res) problems.push(`остаток после очистки ${key} ${r.id}: …${res}…`); }
    }
  }
  // Подпись журнала изменений (AuditLog.label) — только подпись, содержимое changes не трогаем.
  const raw = (prisma as unknown as { $rawBase: Record<string, any> }).$rawBase; // eslint-disable-line @typescript-eslint/no-explicit-any
  const logs: { id: string; label: string | null }[] = await raw.auditLog.findMany({ where: { label: { contains: "MVST", mode: "insensitive" } }, select: { id: true, label: true } });
  stats["AuditLog.label"] = { rows: logs.length, before: { MVST: logs.length, "Drive/Google": 0, "ссылка Google": 0, "единый реестр": 0, "непусто": logs.length }, after: { MVST: 0, "Drive/Google": 0, "ссылка Google": 0, "единый реестр": 0, "непусто": logs.length } };
  for (const l of logs) {
    const after = scrubTitle(l.label ?? "");
    ops.push({ table: "AuditLog", model: "auditLog", id: l.id, field: "label", before: l.label, after });
    lines.push(`AuditLog.label ${l.id}: «${l.label}» → «${after}»`);
  }

  const out = [`База: ${dbName}`, `Изменений полей: ${ops.length}`, "", ...lines, "", "Счётчики (строк с вхождением) до → после:",
    ...Object.entries(stats).map(([k, s]) => `  ${k.padEnd(32)} строк ${String(s.rows).padStart(5)} · непусто ${s.before["непусто"]}→${s.after["непусто"]} · MVST ${s.before.MVST}→${s.after.MVST} · Drive/Google ${s.before["Drive/Google"]}→${s.after["Drive/Google"]} · ссылки Google ${s.before["ссылка Google"]}→${s.after["ссылка Google"]} · «единый реестр» ${s.before["единый реестр"]}→${s.after["единый реестр"]}`),
    "", `Ключей driveFileId перенесено: ${Object.keys(keyMap).length} (строк DriveDocument с заменой: ${ops.filter((o) => o.field === "driveFileId").length})`,
    ...(problems.length ? ["", "ПРОБЛЕМЫ:", ...problems.map((p) => "  - " + p)] : [])];
  writeFileSync(REPORT, out.join("\n") + "\n");
  console.log(out.filter((l, i) => i < 2 || i > lines.length + 3).join("\n"));
  console.log(`\nПолный перечень «таблица.поле id: было → стало»: ${REPORT}`);

  // Защита от потери ссылок: ключи не должны слипаться (разные старые id → разные новые)
  const seen = new Map<string, string>();
  for (const [o, n] of Object.entries(keyMap)) { if (seen.has(n)) problems.push(`слипание ключей ${o} и ${seen.get(n)} → ${n}`); seen.set(n, o); }

  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Для записи — --apply (на боевой ещё --live)." + (problems.length ? ` Проблем: ${problems.length} (см. отчёт).` : "")); await prisma.$disconnect(); return; }
  const blocking = problems.filter((p) => !(ALLOW_RESIDUAL && p.startsWith("остаток")));
  if (blocking.length) { console.log("\nЗапись отменена из-за проблем:"); for (const p of blocking.slice(0, 20)) console.log("  - " + p); process.exitCode = 1; await prisma.$disconnect(); return; }

  if (isLive) { console.log("\nКопия базы перед записью: bash scripts/backup.sh …"); execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: ROOT }); }
  // Журнал пишем ДО записи в БД: если запись оборвётся, откат всё равно будет возможен (откат пропускает неизменённое).
  const journal: Journal = { script: SCRIPT, status: "applied", db: dbName, at: new Date().toISOString(), ops, keyMap };
  writeJson(JOURNAL, journal);
  writeJson(OUTSIDE, journal);
  console.log(`Журнал отката: ${JOURNAL}\nДубль вне репозитория: ${OUTSIDE}`);

  const byRow = new Map<string, { model: string; id: string; data: Record<string, unknown>; before: Record<string, unknown> }>();
  for (const o of ops.filter((x) => x.table !== "AuditLog")) {
    const k = `${o.model}:${o.id}`;
    const e = byRow.get(k) ?? { model: o.model, id: o.id, data: {}, before: {} };
    e.data[o.field] = o.after === null ? null : o.after; e.before[o.field] = o.before; byRow.set(k, e);
  }
  const rows = [...byRow.values()];
  let skipped = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await prisma.$transaction(async (tx) => {
      const t = tx as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      for (const e of chunk) {
        // сравнить-и-записать: если строку успели изменить после чтения, это поле не трогаем (его увидит следующий прогон)
        const cur = await t[e.model].findUnique({ where: { id: e.id } });
        if (!cur) { skipped++; continue; }
        const data: Record<string, unknown> = {};
        for (const [f, v] of Object.entries(e.data)) {
          if (JSON.stringify(cur[f] ?? null) === JSON.stringify(e.before[f] ?? null)) data[f] = v;
          else { skipped++; console.log(`\n  пропуск ${e.model}.${f} ${e.id}: значение изменилось после чтения`); }
        }
        if (Object.keys(data).length) await t[e.model].update({ where: { id: e.id }, data });
      }
    }, { timeout: 120000, maxWait: 30000 });
    process.stdout.write(`\r  записано строк: ${Math.min(i + 100, rows.length)} из ${rows.length}`);
  }
  console.log();
  for (const o of ops.filter((x) => x.table === "AuditLog")) await raw.auditLog.update({ where: { id: o.id }, data: { label: o.after as string } });
  console.log(`Журнал изменений: «было» заменено пометкой в записях самой очистки: ${await sanitizeAudit(raw)}`);
  console.log(`Готово: изменено полей ${ops.length}, строк ${rows.length}${skipped ? `, пропущено (изменились при записи) ${skipped} — запустите ещё раз` : ""}. Откат: --rollback --apply${isLive ? " --live" : ""}.`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
