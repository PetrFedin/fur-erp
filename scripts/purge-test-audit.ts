/**
 * Чистка журнала изменений (AuditLog) от строк ТЕСТОВЫХ записей, которых уже нет в базе.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/purge-test-audit.ts                      — СУХОЙ ПРОГОН (ничего не меняет, печатает перечень)
 *   node --env-file=.env node_modules/.bin/tsx scripts/purge-test-audit.ts --apply              — удалить (после scripts/backup.sh, свежая копия не старше 30 минут)
 *   node --env-file=.env node_modules/.bin/tsx scripts/purge-test-audit.ts --rollback <файл>    — вставить удалённые строки обратно из docs-inventory/purged-audit-<дата>.json
 *
 * Параметры: --probe-ids <файл.json> (по умолчанию docs-inventory/test-probe-ids-20261008.json: { "ids": ["…"] } — id тестовых записей),
 *            --marker <текст> (по умолчанию «ТЕСТ-УДАЛИТЬ»), --skip-backup-check (не рекомендуется).
 *
 * Строка журнала удаляется ТОЛЬКО если выполнены оба условия:
 *  А) записи, к которой она относится, НЕТ в базе (recordId; для «пачек» batch:… — ни одного из changes.ids; BatchIntake — это ключ мастера, записи нет);
 *  Б) в названии или diff встречается маркер «ТЕСТ-УДАЛИТЬ», либо recordId/ids входят в список проб, либо diff ссылается на id из списка проб.
 * Почему это безопасно: журнал читают только /history (показ), «История изменений» в карточках (по существующим записям)
 * и проверка «Подтверждённое не менялось после подтверждения» (src/lib/integrity/data.ts → auditAfter): она сопоставляет recordId с id
 * СУЩЕСТВУЮЩИХ закупок, позиций, оплат, лотов, ТЗ, списаний, партий — строки несуществующих записей в сопоставление не попадают.
 * Скрипт дополнительно проверяет, что ни один id удаляемых строк не совпал с id существующей записи в любой таблице из этого списка.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};

const ROOT = path.resolve(__dirname, "..");
const MARKER = opt("--marker") ?? "ТЕСТ-УДАЛИТЬ";
const PROBE_FILE = path.resolve(ROOT, opt("--probe-ids") ?? "docs-inventory/test-probe-ids-20261008.json");
/** Модели, по которым проверка «подтверждённое не менялось» ищет правки (src/lib/integrity/data.ts). */
const READ_MODELS = ["Purchase", "PurchaseItem", "PurchaseExpense", "Payment", "RawMaterialLot", "ProductionOrder", "ProductionMaterialUsage", "ProductionExpense", "ProductionPayment", "ProductionPaymentOrder", "ProductionBatch"];

const lower = (s: string) => s[0].toLowerCase() + s.slice(1);

type Row = Prisma.AuditLogGetPayload<object>;

function idsOf(r: Row): string[] {
  if (r.recordId.startsWith("batch:")) {
    const ch = r.changes as { ids?: unknown } | null;
    return Array.isArray(ch?.ids) ? (ch!.ids as unknown[]).map(String) : [];
  }
  return [r.recordId];
}

async function main() {
  const db = new PrismaClient();
  try {
    if (flag("--rollback")) return await rollback(db, opt("--rollback"));

    const probe = new Set<string>(fs.existsSync(PROBE_FILE) ? (JSON.parse(fs.readFileSync(PROBE_FILE, "utf8")).ids as string[]) : []);
    console.log(`Маркер: «${MARKER}»; список проб: ${probe.size} id (${fs.existsSync(PROBE_FILE) ? PROBE_FILE : "файла нет"})`);

    const rows = await db.auditLog.findMany({ orderBy: { at: "asc" } });
    const delegates = db as unknown as Record<string, { findMany: (a: unknown) => Promise<{ id: string }[]> } | undefined>;
    const existsCache = new Map<string, Set<string>>();
    async function existing(model: string, ids: string[]): Promise<Set<string>> {
      const key = model;
      const have = existsCache.get(key) ?? new Set<string>();
      const need = ids.filter((i) => !existsCache.get(key + "|checked")?.has(i));
      if (need.length) {
        const d = delegates[lower(model)];
        if (d?.findMany) for (const x of await d.findMany({ where: { id: { in: need } }, select: { id: true } })) have.add(x.id);
        const checked = existsCache.get(key + "|checked") ?? new Set<string>();
        need.forEach((i) => checked.add(i));
        existsCache.set(key + "|checked", checked);
      }
      existsCache.set(key, have);
      return have;
    }

    const picked: Row[] = [];
    const absentOther: Row[] = [];
    let present = 0;
    for (const r of rows) {
      const ids = idsOf(r);
      const hasDelegate = !!delegates[lower(r.model)]?.findMany;
      const have = hasDelegate ? await existing(r.model, ids) : new Set<string>();
      const absent = ids.length > 0 && ids.every((i) => !have.has(i)); // А
      if (!absent) {
        present++;
        continue;
      }
      const text = `${r.label ?? ""} ${JSON.stringify(r.changes)}`;
      const byMarker = text.includes(MARKER);
      const byProbe = ids.some((i) => probe.has(i)) || [...probe].some((p) => text.includes(p)); // Б
      if (byMarker || byProbe) picked.push(r);
      else absentOther.push(r);
    }

    // страховка: id удаляемых строк не должны совпасть с id существующих записей читаемых моделей
    const clash: string[] = [];
    const allIds = [...new Set(picked.flatMap(idsOf))];
    for (const m of READ_MODELS) {
      const d = delegates[lower(m)];
      if (!d?.findMany || allIds.length === 0) continue;
      for (const x of await d.findMany({ where: { id: { in: allIds } }, select: { id: true } })) clash.push(`${m}:${x.id}`);
    }

    console.log(`\nВсего строк журнала: ${rows.length}; относятся к существующим записям (не трогаем): ${present}; записи нет, но не тестовые (не трогаем): ${absentOther.length}; К УДАЛЕНИЮ: ${picked.length}`);
    for (const r of picked) console.log(`  - ${r.at.toISOString().replace("T", " ").slice(0, 19)} ${r.model.padEnd(24)} ${r.action.padEnd(6)} ${r.recordId.slice(0, 28).padEnd(28)} ${(r.label ?? "").slice(0, 60)}`);
    if (absentOther.length) {
      console.log("\nЗаписи нет, но маркера и id проб нет — ОСТАВЛЕНЫ:");
      for (const r of absentOther) console.log(`  ~ ${r.at.toISOString().slice(0, 19)} ${r.model} ${r.action} ${r.recordId.slice(0, 28)} ${(r.label ?? "").slice(0, 60)}`);
    }
    if (clash.length) {
      console.error(`\nСТОП: id удаляемых строк совпали с существующими записями: ${clash.join(", ")}`);
      process.exitCode = 1;
      return;
    }
    if (!flag("--apply")) {
      console.log("\nСухой прогон: ничего не удалено. Для удаления: сначала scripts/backup.sh, затем те же команды с --apply.");
      return;
    }
    if (picked.length === 0) return console.log("Удалять нечего.");

    if (!flag("--skip-backup-check")) {
      const dir = path.join(os.homedir(), "Backups", "fur-erp");
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^fur_erp_.*\.sql\.gz$/.test(f)) : [];
      const newest = files.map((f) => fs.statSync(path.join(dir, f)).mtimeMs).sort((a, b) => b - a)[0] ?? 0;
      if (Date.now() - newest > 30 * 60_000) {
        console.error("СТОП: нет свежей копии базы (не старше 30 минут в ~/Backups/fur-erp). Сначала запустите scripts/backup.sh.");
        process.exitCode = 1;
        return;
      }
    }

    const day = new Date().toISOString().slice(0, 10);
    let out = path.join(ROOT, "docs-inventory", `purged-audit-${day}.json`);
    for (let n = 2; fs.existsSync(out); n++) out = path.join(ROOT, "docs-inventory", `purged-audit-${day}-${n}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ purgedAt: new Date().toISOString(), marker: MARKER, count: picked.length, rows: picked }, null, 1));
    const res = await db.auditLog.deleteMany({ where: { id: { in: picked.map((r) => r.id) } } });
    console.log(`\nУдалено строк журнала: ${res.count}. Сохранено: ${out}\nОткат: node --env-file=.env node_modules/.bin/tsx scripts/purge-test-audit.ts --rollback ${path.relative(ROOT, out)}`);
  } finally {
    await db.$disconnect();
  }
}

async function rollback(db: PrismaClient, file?: string) {
  if (!file) throw new Error("Укажите файл: --rollback docs-inventory/purged-audit-<дата>.json");
  const data = JSON.parse(fs.readFileSync(path.resolve(ROOT, file), "utf8")) as { rows: (Omit<Row, "at"> & { at: string })[] };
  const rows = data.rows.map((r) => ({ ...r, at: new Date(r.at), changes: r.changes as Prisma.InputJsonValue }));
  const res = await db.auditLog.createMany({ data: rows, skipDuplicates: true });
  console.log(`Возвращено строк журнала: ${res.count} из ${rows.length} (остальные уже были на месте).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
