/**
 * Удаление нулевой оплаты производства c6e48ce6c8fed42392d9f0033 («Счёт №7 … целиком вынесен в оплату закупки З-2026-0013»).
 * Решение владельца 19.10.2026: удалить, «если он не нужен». Правило: удалять только доказав, что от неё ничего не зависит,
 * и восстановить полностью при поломке.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/delete-zero-payment-2026-10-19.ts                       # пробный прогон: только чтение, доказательства
 *   ... delete-zero-payment-2026-10-19.ts --apply [--with-links]                                                                         # на копии базы (DATABASE_URL = копия)
 *   ... delete-zero-payment-2026-10-19.ts --apply --live [--with-links]                                                                  # на боевой базе: сначала scripts/backup.sh
 *   ... delete-zero-payment-2026-10-19.ts --rollback [--live]                                                                           # вернуть строку и связи из журнала, сверить хеш
 *
 * --with-links: у платежа есть привязки к ТЗ (ProductionPaymentOrder, только подпись «эта оплата относится к ТЗ…», без сумм).
 * Без флага при наличии привязок скрипт НЕ удаляет. С флагом привязки пишутся в журнал и возвращаются откатом.
 * Журнал: ~/Backups/fur-erp/delete-zero-payment-2026-10-19.journal.json (полная строка, все связи, md5).
 */
import Module from "module";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { execSync } from "child_process";
import { createHash } from "crypto";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};
import { PrismaClient } from "@prisma/client";

const ID = "c6e48ce6c8fed42392d9f0033";
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const WITH_LINKS = process.argv.includes("--with-links");
const NO_BACKUP = process.argv.includes("--no-backup");
const JOURNAL = join(homedir(), "Backups", "fur-erp", "delete-zero-payment-2026-10-19.journal.json");
const prisma = new PrismaClient();
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

type Row = Record<string, unknown>;
const q = <T = Row>(sql: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...p);
const out = (ok: boolean | null, s: string) => console.log(`${ok === null ? "INFO" : ok ? "OK  " : "FAIL"} ${s}`);

(async () => {
  const [{ db }] = await q<{ db: string }>("select current_database() db");
  console.log(`База: ${db}${db === "fur_erp" ? " (БОЕВАЯ)" : ""} · режим: ${ROLLBACK ? "ОТКАТ" : APPLY ? "ПРИМЕНЕНИЕ" : "пробный прогон"}`);
  if (db === "fur_erp" && (APPLY || ROLLBACK) && !LIVE) throw new Error("Боевая база: нужен явный --live (сначала репетиция на копии)");
  if (db !== "fur_erp" && LIVE) throw new Error("--live указан, но DATABASE_URL не боевая база");

  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as { row: Row; links: Row[]; md5: string };
    if ((await q("select 1 from \"ProductionPayment\" where id=$1", ID)).length) throw new Error("Платёж уже на месте — откатывать нечего");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`insert into "ProductionPayment" select * from jsonb_populate_record(null::"ProductionPayment", $1::jsonb)`, JSON.stringify(j.row));
      for (const l of j.links) await tx.$executeRawUnsafe(`insert into "ProductionPaymentOrder" select * from jsonb_populate_record(null::"ProductionPaymentOrder", $1::jsonb)`, JSON.stringify(l));
      const [r] = await tx.$queryRawUnsafe<{ t: string }[]>(`select to_jsonb(p)::text t from "ProductionPayment" p where id=$1`, ID);
      const lk = await tx.$queryRawUnsafe<{ t: string }[]>(`select to_jsonb(l)::text t from "ProductionPaymentOrder" l where "productionPaymentId"=$1 order by id`, ID);
      const h = md5(r.t + "|" + lk.map((x) => x.t).join("|"));
      if (h !== j.md5) throw new Error(`Хеш после отката ${h} ≠ журнал ${j.md5} — откат отменён`);
      console.log(`Восстановлено: платёж + ${lk.length} привязок к ТЗ; md5 совпал (${h})`);
    });
    return;
  }

  // ---------- доказательства
  const [pay] = await q<Row>(`select * from "ProductionPayment" where id=$1`, ID);
  if (!pay) { console.log("Платежа нет (уже удалён?)."); return; }
  let blockers = 0;
  const need = (ok: boolean, s: string) => { out(ok, s); if (!ok) blockers++; };
  need(Number(pay.amount) === 0, `сумма = ${pay.amount} (нужен 0)`);
  need(pay.status === "COMPLETED", `статус ${pay.status}`);
  const one = async (sql: string) => Number((await q<{ n: bigint }>(sql, ID))[0].n);
  need((await one(`select count(*) n from "PaymentAllocation" where "productionPaymentId"=$1`)) === 0, "разнесений по ТЗ (PaymentAllocation): 0");
  need((await one(`select count(*) n from "DriveDocument" where "productionPaymentId"=$1`)) === 0, "приложенных документов (DriveDocument): 0");
  const links = await q<Row>(`select * from "ProductionPaymentOrder" where "productionPaymentId"=$1 order by id`, ID);
  out(links.length === 0 ? true : null, `привязок к ТЗ (ProductionPaymentOrder): ${links.length}${links.length ? " — только подпись «оплата относится к ТЗ», сумм нет; нужен --with-links" : ""}`);
  if (links.length && !WITH_LINKS) { blockers++; out(false, "привязки есть, а --with-links не указан: удаление не выполняется"); }
  const audit = await q<Row>(`select id, action from "AuditLog" where "recordId"=$1`, ID);
  out(null, `записей истории (AuditLog): ${audit.length} — остаются как история, на расчёты не влияют`);
  // текстовые ссылки на id где-либо в базе (кроме журнала и самой строки)
  const refs = await q<{ t: string; c: string; n: string }>(`select table_name t, column_name c, (xpath('/row/c/text()', query_to_xml(format('select count(*) c from %I where %I::text like %L', table_name, column_name, '%'||$1||'%'), false, true, '')))[1]::text n
    from information_schema.columns where table_schema='public' and data_type in ('text','character varying','jsonb','json') and table_name in (select table_name from information_schema.tables where table_type='BASE TABLE')`, ID);
  const other = refs.filter((r) => Number(r.n) > 0 && !(r.t === "ProductionPayment" && r.c === "id") && !(r.t === "ProductionPaymentOrder") && r.t !== "AuditLog");
  need(other.length === 0, `ссылок на id в других таблицах (SystemState, комментарии, JSON…): ${other.length ? other.map((r) => r.t + "." + r.c).join(", ") : "0"}`);

  // что изменится
  const tot = async () => (await q<{ n: bigint; s: string; w: string; adv: string }>(`select count(*) n, coalesce(sum(amount),0)::text s, count(*) filter (where amount<>0) w, '' adv from "ProductionPayment" where status='COMPLETED'`))[0];
  const before = await tot();
  console.log(`Сейчас: оплат производства ${before.n}, сумма ${before.s}; после удаления: ${Number(before.n) - 1}, сумма ${before.s} (платёж нулевой — суммы не меняются).`);
  const cnt = await q<{ n: bigint }>(`select count(*) n from "ProductionPayment" where "docRef" like '%Счёт №7 %' or "invoiceNo"='7'`);
  out(null, `оплат по счёту №7 в оплатах производства: ${cnt[0].n}; деньги по нему лежат в Payment закупки З-2026-0013 (427 227,39), «Сверка» читает их оттуда`);

  if (blockers) { console.log(`\nУдаление НЕ выполнено: препятствий ${blockers}.`); process.exitCode = 1; return; }
  if (!APPLY) { console.log("\nПробный прогон: БД не менялась. Применить: --apply (копия) / --apply --live (боевая)."); return; }

  if (LIVE && !NO_BACKUP) { console.log("Резервная копия…"); execSync("bash scripts/backup.sh", { stdio: "inherit" }); }
  const lk = await q<{ t: string }>(`select to_jsonb(l)::text t from "ProductionPaymentOrder" l where "productionPaymentId"=$1 order by id`, ID);
  const [{ t }] = await q<{ t: string }>(`select to_jsonb(p)::text t from "ProductionPayment" p where id=$1`, ID);
  const hash = md5(t + "|" + lk.map((x) => x.t).join("|"));
  mkdirSync(join(homedir(), "Backups", "fur-erp"), { recursive: true });
  writeFileSync(JOURNAL, JSON.stringify({ id: ID, at: new Date().toISOString(), db, row: JSON.parse(t), links: lk.map((x) => JSON.parse(x.t)), md5: hash }, null, 1));
  console.log(`Журнал: ${JOURNAL} (md5 ${hash})`);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`delete from "ProductionPaymentOrder" where "productionPaymentId"=$1`, ID);
    const n = await tx.$executeRawUnsafe(`delete from "ProductionPayment" where id=$1 and amount=0`, ID);
    if (n !== 1) throw new Error("удалено не 1 строка — отмена");
  });
  const after = await tot();
  console.log(`Готово: оплат производства ${after.n}, сумма ${after.s}. Откат: --rollback${LIVE ? " --live" : ""}.`);
  if (!existsSync(JOURNAL)) throw new Error("журнал не найден");
})().catch((e) => { console.error("ОШИБКА:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
