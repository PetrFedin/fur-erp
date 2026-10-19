// Нет внешних ссылок на Google Диск и «MVST» (решения владельца от 16.10.2026). Только чтение.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-no-external-refs.ts
// Проверяет: (1) правила очистки текстов (scripts/lib/scrub-text.ts); (2) в src/data/*.json и calc-presets.json нет Диска/MVST;
// (3) в БД (DATABASE_URL) viewUrl/drivePath пусты, driveFileId — внутренний ключ (doc-… / local-…), а в текстовых полях нет
// ссылок Google и «MVST» (журнал изменений AuditLog.changes — исторический, не проверяется); (4) в исходниках интерфейса
// (src/**/*.tsx) нет «Диск/Google/MVST» в видимых строках; (5) статус документа — «прикреплён / не прикреплён».
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { internalFileKey, residual, scrubNote, scrubTitle } from "./lib/scrub-text";

let fails = 0;
const ok = (c: unknown, m: string) => { console.log(`${c ? "OK  " : "FAIL"} ${m}`); if (!c) fails++; };
const ROOT = join(__dirname, "..");

// (1) правила
ok(scrubTitle("Копия расчеты LYNX MVST FW26.xlsx") === "Копия расчеты LYNX THE FUR FW26.xlsx", "название: MVST → THE FUR");
ok(scrubNote("Счёт №271 (оплаты в Drive нет).") === "Счёт №271 (платёжка не прикреплена).", "заметка: «оплаты в Drive нет» → «платёжка не прикреплена»");
ok(scrubNote("принят «Коричневый»: единый реестр «21-08 ЕДИНЫЙ_РЕЕСТР_ПО_МЕХУ_MVST», лист «Реестр (единый)», строка 536 (ТЗ 118, MSC05): «Коричневый».") === "принят «Коричневый»: «Коричневый».", "заметка: фраза про внешний реестр вырезана целиком");
ok(scrubNote("ТЗ №165: создано по документу Drive «ПРИЛОЖЕНИЕ 165 (М046).docx».") === "ТЗ №165: создано по приложению к ТЗ «ПРИЛОЖЕНИЕ 165 (М046).docx».", "заметка: «по документу Drive» → «по приложению к ТЗ»");
ok(scrubNote("см. https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp12345/view здесь") === "см. здесь", "ссылка Google вырезана");
ok(!residual(scrubNote("Спецификация (Google Drive); комиссия не включена")), "после очистки нет остатков Drive/Google");
ok(internalFileKey("1AbCdEfGhIjKlMnOp12345") === internalFileKey("1AbCdEfGhIjKlMnOp12345") && internalFileKey("a") !== internalFileKey("b") && /^doc-[0-9a-f]{24}$/.test(internalFileKey("a")), "внутренний ключ файла: устойчивый и различимый");

// (2) данные репозитория
const BAD = /drive\.google|docs\.google|Google Drive|Google Диск|\bDrive\b|MVST|mvst/;
for (const f of ["src/data/lot-usd-sources.json", "src/data/raw-audit-2026-02-09.json", "src/data/reconciliation.json", "src/data/registry-coverage.json", "src/lib/calc-presets.json"]) {
  const t = readFileSync(join(ROOT, f), "utf8");
  ok(!BAD.test(t), `${f}: нет Диска и MVST`);
}

// (4) видимые строки интерфейса
const UI_BAD = /Google|MVST|Диск[аеу]?\b|(?<![A-Za-z])Drive(?![A-Za-z])/;
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out); else if (/\.tsx$/.test(n)) out.push(p);
  }
  return out;
}
const offenders: string[] = [];
for (const f of walk(join(ROOT, "src"))) {
  readFileSync(f, "utf8").split("\n").forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*")) return;
    if (UI_BAD.test(t)) offenders.push(`${f.slice(ROOT.length + 1)}:${i + 1}: ${t.slice(0, 100)}`);
  });
}
ok(offenders.length === 0, `в .tsx нет «Диск/Google/MVST/Drive»${offenders.length ? ":\n   " + offenders.slice(0, 12).join("\n   ") : ""}`);

// (5) статусы документов
const dd = readFileSync(join(ROOT, "src/components/drive-documents.tsx"), "utf8");
ok(dd.includes("Прикреплён") && dd.includes("Не прикреплён") && !/Файл не загружен|Файл в приложении/.test(dd), "статус документа: «Прикреплён» / «Не прикреплён»");

// (3) БД
async function main() {
  const db = new PrismaClient();
  try {
    const org = await db.organization.findFirst();
    if (!org) { console.log("     (в БД нет данных — проверка БД пропущена)"); return; }
    const total = await db.driveDocument.count();
    ok((await db.driveDocument.count({ where: { viewUrl: { not: null } } })) === 0, `DriveDocument.viewUrl пуст (записей ${total})`);
    ok((await db.driveDocument.count({ where: { drivePath: { not: null } } })) === 0, "DriveDocument.drivePath пуст");
    const keys = await db.driveDocument.findMany({ select: { driveFileId: true }, distinct: ["driveFileId"] });
    ok(keys.every((k) => /^(doc-[0-9a-f]{24}|local-.+|zi-source-.+)$/.test(k.driveFileId) || /^[A-Za-z0-9_-]{1,40}$/.test(k.driveFileId) && !/^1[A-Za-z0-9_-]{32}$/.test(k.driveFileId)), `driveFileId — внутренние ключи (разных: ${keys.length})`);
    const rows = await db.$queryRawUnsafe<{ t: string; c: string; n: bigint }[]>(`
      select c.table_name t, c.column_name c, 0::bigint n from information_schema.columns c
      join information_schema.tables tb on tb.table_name = c.table_name and tb.table_schema = 'public' and tb.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.data_type in ('text','character varying','jsonb','json')
        and c.table_name not in ('AuditLog','_prisma_migrations','SystemState','User')
        and c.column_name not in ('id','storagePath','driveFileId')`); // storagePath — внутренний путь хранения («drive-docs/…»)
    const dirty: string[] = [];
    for (const r of rows) {
      const n = Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`select count(*) n from "${r.t}" where "${r.c}"::text ~* '(drive\\.google|docs\\.google|google drive|mvst|\\mdrive\\M)'`))[0].n);
      if (n > 0) dirty.push(`${r.t}.${r.c}: ${n}`);
    }
    ok(dirty.length === 0, `в текстовых полях БД нет ссылок Google / Drive / MVST${dirty.length ? ": " + dirty.join(", ") : ""}`);
    const unattached = await db.driveDocument.count({ where: { storagePath: null } });
    console.log(`     (документов без файла — «не прикреплён»: ${unattached} из ${total})`);
  } finally {
    await db.$disconnect();
  }
}
main().then(() => { console.log(fails ? `\nПровалов: ${fails}` : "\nВсё в порядке"); process.exit(fails ? 1 : 0); }).catch((e) => { console.error(e); process.exit(1); });
