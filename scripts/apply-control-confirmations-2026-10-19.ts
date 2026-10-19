/**
 * «Контроль»: подтверждения, привязка документов и закрытие задач по документам владельца — ПРЕДЛОЖЕНИЕ от 19.10.2026, НЕ ПРИМЕНЕНО.
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-control-confirmations-2026-10-19.ts                  # пробный прогон (БД и файлы не меняются), таблица «пункт / что меняется / основание»
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-control-confirmations-2026-10-19.ts --apply          # применить на НЕ боевой базе (копия; UPLOAD_DIR — на копию!)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-control-confirmations-2026-10-19.ts --apply --live   # применить на боевой базе fur_erp (сам делает scripts/backup.sh; --no-backup — без копии)
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-control-confirmations-2026-10-19.ts --rollback [--apply [--live]]
 *   ... --hash   печатает контрольную сумму затронутых таблиц (до записи и после отката должны совпасть)
 *   ... --register=/путь/Оплаты.xls   (по умолчанию ~/Downloads/Оплаты.xls)   --skip-restamp   не переподтверждать
 *
 * ИСТОЧНИКИ (всё лежит у владельца): «Оплаты.xls» (реестр списаний, 67 п/п), письма архива Outlook (docs-inventory/backup-mail: Word-приложения ТЗ, письмо Веллмеха 09.09.2026),
 * сводка аудита ТЗ с Word (docs-inventory/tz-audit-2026-10-19), журналы применённых скриптов. Манифест отобранных вложений — docs-inventory/control-review-2026-10-19/mail-docs/manifest-tz.json.
 *
 * ЧТО ДЕЛАЕТ (только пункты с уверенностью ≥95%; всё остальное печатает в разделе «НЕ ТРОГАЮ» с причиной):
 *   1) прикрепляет реестр списаний «Оплаты.xls» как документ-подтверждение (тип «платёжка») к каждой оплате поставщику, чей п/п, сумма и дата совпали с реестром, —
 *      как делает кнопка «Прикрепить платёжку» в карточке оплаты; для оплат, привязанных к аукциону, документ ещё привязывается к закупке из задачи («Задачи» → документы для поиска) —
 *      так закрываются задачи «платёжка по счёту №143/241/197/253/173/271/157/181»;
 *   2) прикрепляет письмо Веллмеха от 09.09.2026 («переплаты по SAGA и подкладке учтены») к записи «Зачёт переплат…» и привязывает её к закупке З-2026-0058 — закрывает задачу «Подтверждение зачётов»;
 *   3) у закупок З-2026-0008/0009 (белая норка, счета №80 и №96) приводит текст аукциона в соответствие с аукционом из справочника («Нет информации» → «Белая норка №80/№96»);
 *   4) прикрепляет Word-приложения ТЗ из писем (кол-во и работа совпали с ТЗ в базе, итог документа совпал с итогом аудита) и подтверждает ТЗ, у которых после этого у приложения нет замечаний
 *      и аудит Word-ТЗ сошёлся (или расхождение уже исправлено скриптом сведения 19.10.2026);
 *   5) переподтверждает закупки и ТЗ, у которых «подтверждённое менялось после подтверждения», если менялись только служебные поля скриптами из журнала (номер счёта, п/п, текст примечания, остаток лота).
 * НЕ ДЕЛАЕТ: не пишет оплаты и суммы, не трогает долг поставщику и работу по ТЗ (проверяется до/после), не закрывает решения владельца, не подтверждает партии и закупки с замечаниями.
 * Идемпотентно (метка CTL_TAG в примечании документов и в основании подтверждения). Журнал: docs-inventory/corrections-journal-control-confirmations-2026-10-19.json (для копии — с суффиксом имени базы).
 */
import Module from "module";
import { join } from "path";
import { execSync } from "child_process";
import { createHash, randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "fs";

const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const arg = (name: string) => argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
const APPLY = has("--apply");
const LIVE = has("--live");
const ROLLBACK = has("--rollback");
const NO_BACKUP = has("--no-backup");
const HASH = has("--hash");
const SKIP_RESTAMP = has("--skip-restamp");
const REGISTER = arg("--register") ?? join(process.env.HOME ?? "", "Downloads", "Оплаты.xls");

// Пробный прогон кладёт файлы в настоящую папку загрузок (иначе проверка «файл прикреплён» не увидит уже лежащие файлы) и в конце удаляет их; записи БД откатываются.
const DRY_FILES: string[] = [];
let simulating = true; // первый проход всегда пробный (в транзакции с откатом); файлы, записанные на нём, удаляются

const ROOT = join(__dirname, "..");
const INV = join(ROOT, "docs-inventory");
const REVIEW = join(INV, "control-review-2026-10-19");
const MAIL_DIR = join(INV, "backup-mail", "Файл данных Outlook", "Входящие", "мех");
const CTL_TAG = "[ctl:2026-10-19]";
const BASIS = "auto:control-confirmations-2026-10-19";
const dmy = (iso: string) => iso.split("-").reverse().join(".");
const rub = (v: number | string) => Number(v).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ");
const num = (v: unknown) => Number(String(v));
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
class DryRun extends Error {}

/** Реестр списаний «Оплаты.xls»: [строка листа, п/п, дата, сумма, договор, номер счёта из назначения]. */
const REG: [number, string, string, number, string, string][] = [
  [2, '440', '2025-02-28', 34825000.00, '2502', '31'],
  [3, '33979', '2025-03-14', 24556500.00, '2502', '40'],
  [4, '33980', '2025-03-14', 79898902.00, '2502', '37'],
  [5, '36343', '2025-03-26', 11950000.00, '2502', '46'],
  [6, '45675', '2025-05-16', 10924000.00, '2502', '76'],
  [7, '45637', '2025-05-16', 11146950.00, '2502', '75'],
  [8, '48466', '2025-05-30', 1632000.00, '2502', '81'],
  [9, '49288', '2025-06-04', 1718400.00, '2502', '80'],
  [10, '51723', '2025-06-19', 1210000.00, '2502', '92'],
  [11, '53423', '2025-06-27', 30666300.00, '2502', '83'],
  [12, '54214', '2025-07-03', 1455842.00, '2502', '100'],
  [13, '54215', '2025-07-03', 1537404.00, '2502', '95'],
  [14, '56327', '2025-07-15', 2000000.00, '2502', '96'],
  [15, '60611', '2025-08-04', 1695778.00, '2502', '103'],
  [16, '60610', '2025-08-04', 21627900.00, '2502', '1605'],
  [17, '64015', '2025-08-22', 195404.00, '2502', '117'],
  [18, '64014', '2025-08-22', 1061306.00, '2502', '127'],
  [19, '64499', '2025-08-26', 123836.00, '2502', '122'],
  [20, '70941', '2025-10-01', 2533779.20, '2502', '143'],
  [21, '71143', '2025-10-02', 1866490.00, '1605', '147'],
  [22, '73674', '2025-10-15', 1208570.00, '1605', '170'],
  [23, '74972', '2025-10-22', 2081360.00, '1605', '181'],
  [24, '80511', '2025-11-20', 1759800.00, '1605', '203'],
  [25, '81455', '2025-11-25', 27960.00, '2502', '201'],
  [26, '82173', '2025-11-27', 1766870.00, '1605', '209'],
  [27, '83556', '2025-12-04', 24500.00, '2502', '217'],
  [28, '87386', '2025-12-22', 5669120.00, '1605', '235'],
  [29, '88105', '2025-12-24', 4836327.52, '2502', '241'],
  [30, '88911', '2025-12-26', 946870.00, '1605', '239'],
  [31, '22618', '2026-01-21', 2081387.54, '1605', '1'],
  [32, '26829', '2026-02-11', 427227.39, '1605', '7'],
  [33, '29370', '2026-02-25', 303372.00, '1605', '41'],
  [34, '30413', '2026-03-02', 19600.00, '2502', '237'],
  [35, '30903', '2026-03-04', 347895.00, '1605', '51'],
  [36, '32580', '2026-03-12', 1183135.00, '1605', '65'],
  [37, '36054', '2026-03-30', 24200000.00, '2502', '93'],
  [38, '38692', '2026-04-13', 22891800.00, '2502', '105'],
  [39, '40308', '2026-04-21', 183400.00, '1605', '71'],
  [40, '40307', '2026-04-21', 217350.00, '1605', '63'],
  [41, '40593', '2026-04-22', 27912500.00, '2502', '117'],
  [42, '43831', '2026-05-12', 60271506.34, '2502', '131'],
  [43, '46540', '2026-05-28', 19628147.54, '2502', '149'],
  [44, '46538', '2026-05-28', 30660000.00, '2502', '155'],
  [45, '46539', '2026-05-28', 761250.00, '2502', '153'],
  [46, '46523', '2026-05-28', 218860.00, '1605', '135'],
  [47, '46537', '2026-05-28', 248000.00, '1605', '45'],
  [48, '46963', '2026-06-01', 5400000.00, '2502', '157'],
  [49, '47668', '2026-06-04', 2466573.00, '2502', '167'],
  [50, '48642', '2026-06-11', 85063078.00, '2502', '173'],
  [51, '48847', '2026-06-15', 416570.10, '2502', '171'],
  [52, '51258', '2026-07-01', 19870.00, '2502', '181'],
  [53, '51835', '2026-07-06', 3230780.00, '1605', '143'],
  [54, '51834', '2026-07-06', 11860870.00, '1605', '141'],
  [55, '53718', '2026-07-20', 2380500.00, '2502', '195'],
  [56, '53717', '2026-07-20', 7236812.03, '2502', '197'],
  [57, '58172', '2026-08-14', 158600.00, '1605', '121'],
  [58, '58171', '2026-08-14', 71400.00, '1605', '207'],
  [59, '61001', '2026-09-02', 3397795.00, '1605', '237'],
  [60, '61929', '2026-09-08', 8290940.00, '1605', '251'],
  [61, '61785', '2026-09-08', 2272060.00, '1605', '247'],
  [62, '63545', '2026-09-17', 214522.92, '2502', '253'],
  [63, '63603', '2026-09-18', 805000.00, '1605', '261'],
  [64, '63604', '2026-09-18', 1008000.00, '1605', '259'],
  [65, '64286', '2026-09-23', 2126255.00, '1605', '257'],
  [66, '65109', '2026-09-29', 1892430.00, '1605', '265'],
  [67, '65361', '2026-10-01', 60831100.00, '2502', '271'],
  [68, '65857', '2026-10-05', 442980.00, '1605', '275'],
];
const REG_BY_PP = new Map(REG.map((r) => [r[1], r]));
type ReconInv = { id: string; no: string | null; date: string | null; amountRub: number; paid: { ppNo: string | null; evidence: string }[]; superseded?: boolean };
type ReconGroup = { id: string; invoiceIds: string[]; dbLink: { batch?: number } };
const RECON = JSON.parse(readFileSync(join(__dirname, "..", "src", "data", "reconciliation.json"), "utf-8")) as { invoices: ReconInv[]; groups: ReconGroup[] };
const REG_SIZE = 52224;

/** Задачи «платёжка по счёту…»: п/п → закупка, к которой привязывается документ, если оплата заведена на аукцион (задача ищет документ по закупке). */
const TASK_ANCHOR: Record<string, { purchase: string; task: string }> = {
  "70941": { purchase: "З-2026-0019", task: "upd143-final" },
  "88105": { purchase: "З-2026-0004", task: "inv241-proof" },
  "53717": { purchase: "З-2026-0041", task: "inv197-proof" },
  "63545": { purchase: "З-2026-0058", task: "ame-253-final" },
  "48642": { purchase: "З-2026-0049", task: "fh-173" },
  "65361": { purchase: "З-2026-0050", task: "sp0926-271" },
  "46963": { purchase: "З-2026-0061", task: "podk13-157" },
  "51258": { purchase: "З-2026-0062", task: "dop16-181" },
};

/** ТЗ, расчёт которых уже сведён с Word-ТЗ: «сошлось» в аудите либо ярус A исправлен скриптом сведения 19.10.2026 (журнал corrections-journal-tz-document-match-2026-10-19.json). Ярус C (46, 52, 79, 116, 121, 146, 158) — решения владельца. */
const OWNER_TZ = new Set(["97", "104", "113", "114", "115", "116", "117", "118", "121", "146", "158"]); // решения владельца: бобр (97, 104), шаблонная дата 12.01.2026 при поставке 06.07.2026 (113–115), дата ТЗ 118, ТЗ вне партий (116, 117), ярус C аудита (121, 146, 158)

type Upd = { id: string; before: Record<string, unknown>; after?: Record<string, unknown> };
type Verif = { kind: "order" | "purchase" | "batch"; id: string; label: string; step: "confirm" | "restamp"; before: { verifiedAt: string | null; verifiedBy: string | null; verifyNote: string | null }; after: { verifiedBy: string } };
type Journal = {
  script: string; status: "applied" | "rolled-back"; at: string; db: string; uploadDir: string; registerSha256: string | null;
  docsCreated: { id: string; file: string }[]; docsUpdated: Upd[]; purchasesUpdated: Upd[]; verifies: Verif[];
};
const readJson = <T,>(p: string, def: T): T => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf-8")) as T) : def);
const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 1));

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { loadVerifyModel, applyVerify } = await import("../src/lib/verification");
  const { loadSupplierDebt } = await import("../src/lib/supplier-debt");
  const { loadClientDebt } = await import("../src/lib/payment-alloc");
  const { loadTaskBlocks } = await import("../src/lib/task-docs");
  const { computeDocCoverage } = await import("../src/lib/doc-coverage");
  const { UPLOAD_ROOT } = await import("../src/lib/fitting-files");
  const url = process.env.DATABASE_URL ?? "";
  const dbName = url.split("?")[0].split("/").pop() ?? "";
  const isLive = dbName === "fur_erp";
  if (APPLY && isLive && !LIVE) throw new Error(`База «${dbName}» боевая: для записи нужен --live (для репетиции укажите копию через DATABASE_URL и UPLOAD_DIR).`);
  if (APPLY && !isLive && LIVE) throw new Error(`--live указан, но DATABASE_URL смотрит на «${dbName}», а не на fur_erp.`);
  if (APPLY && !isLive && !process.env.UPLOAD_DIR) throw new Error("Репетиция на копии: задайте UPLOAD_DIR на отдельную папку (иначе файлы попадут в боевые загрузки).");
  const prisma = createAuditedClient("script:apply-control-confirmations-2026-10-19");
  const JOURNAL = join(INV, `corrections-journal-control-confirmations-2026-10-19${isLive ? "" : `-${dbName}`}.json`);
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const dirRel = join("drive-docs", org);

  // ───────── контрольная сумма затронутых таблиц
  const stateHash = async () => {
    const docs = await prisma.driveDocument.findMany({ orderBy: { id: "asc" }, select: { id: true, title: true, docType: true, purchaseId: true, paymentId: true, productionOrderId: true, storagePath: true, storedAt: true, notes: true, docNumber: true } });
    const pur = await prisma.purchase.findMany({ orderBy: { id: "asc" }, select: { id: true, auctionSession: true, verifiedAt: true, verifiedBy: true, verifyNote: true } });
    const ord = [
      ...(await prisma.productionOrder.findMany({ orderBy: { id: "asc" }, select: { id: true, verifiedAt: true, verifiedBy: true, verifyNote: true } })),
      ...(await prisma.productionBatch.findMany({ orderBy: { id: "asc" }, select: { id: true, verifiedAt: true, verifiedBy: true, verifyNote: true } })),
    ];
    const files = existsSync(join(UPLOAD_ROOT, dirRel)) ? readdirSync(join(UPLOAD_ROOT, dirRel)).sort() : [];
    return { docs: sha256(Buffer.from(JSON.stringify(docs))), purchases: sha256(Buffer.from(JSON.stringify(pur))), orders: sha256(Buffer.from(JSON.stringify(ord))), counts: { docs: docs.length, files: files.length }, files: sha256(Buffer.from(files.join("\n"))) };
  };
  if (HASH) { console.log(JSON.stringify(await stateHash(), null, 1)); await prisma.$disconnect(); return; }

  const saveFile = (buf: Buffer, ext: string): string => {
    const rel = join(dirRel, `${randomUUID()}.${ext}`);
    mkdirSync(join(UPLOAD_ROOT, dirRel), { recursive: true });
    writeFileSync(join(UPLOAD_ROOT, rel), buf, { flag: "wx" });
    if (simulating) DRY_FILES.push(join(UPLOAD_ROOT, rel));
    return rel;
  };
  const removeFileIfFree = async (rel: string) => {
    const still = await prisma.driveDocument.count({ where: { storagePath: rel } });
    if (!still) { try { unlinkSync(join(UPLOAD_ROOT, rel)); } catch { /* уже нет */ } }
  };

  // ───────── откат
  if (ROLLBACK) {
    const j = readJson<Journal | null>(JOURNAL, null);
    if (!j || j.status !== "applied") { console.log("Журнал пуст или уже откачен — откатывать нечего."); await prisma.$disconnect(); return; }
    console.log(`Откат (${dbName}): документов создано ${j.docsCreated.length}, документов обновлено ${j.docsUpdated.length}, закупок ${j.purchasesUpdated.length}, подтверждений ${j.verifies.length}`);
    if (APPLY) {
      const files: string[] = [];
      await prisma.$transaction(async (tx) => {
        for (const v of j.verifies) {
          const where = { id: v.id, verifiedBy: v.after.verifiedBy };
          const data = { verifiedAt: v.before.verifiedAt ? new Date(v.before.verifiedAt) : null, verifiedBy: v.before.verifiedBy, verifyNote: v.before.verifyNote };
          if (v.kind === "order") await tx.productionOrder.updateMany({ where, data }); else if (v.kind === "batch") await tx.productionBatch.updateMany({ where, data }); else await tx.purchase.updateMany({ where, data });
        }
        for (const u of j.purchasesUpdated) await tx.purchase.updateMany({ where: { id: u.id, auctionSession: String((u.after as { auctionSession: string }).auctionSession) }, data: { auctionSession: u.before.auctionSession as string | null } });
        for (const u of j.docsUpdated) {
          const b = u.before as { storedAt: string | null } & Record<string, unknown>;
          await tx.driveDocument.updateMany({ where: { id: u.id }, data: { ...b, storedAt: b.storedAt ? new Date(b.storedAt) : null } as never });
        }
        for (const d of j.docsCreated) { await tx.driveDocument.deleteMany({ where: { id: d.id } }); files.push(d.file); }
      }, { timeout: 300000, maxWait: 30000 });
      for (const f of files) await removeFileIfFree(f);
      for (const u of j.docsUpdated) { const f = (u.after as { storagePath?: string } | undefined)?.storagePath; if (f) await removeFileIfFree(f); }
      writeJson(JOURNAL, { ...j, status: "rolled-back", at: new Date().toISOString() });
      console.log("Откат выполнен.");
    }
    await prisma.$disconnect();
    return;
  }

  // ───────── подготовка файлов
  const fileProblems: string[] = [];
  const problems: string[] = [];
  const registerBuf = existsSync(REGISTER) ? readFileSync(REGISTER) : null;
  if (!registerBuf) fileProblems.push(`файл реестра списаний не найден: ${REGISTER} (--register=…)`);
  else if (registerBuf.length !== REG_SIZE) fileProblems.push(`размер «Оплаты.xls» ${registerBuf.length} ≠ ожидаемых ${REG_SIZE}: это не тот файл`);
  const registerSha = registerBuf ? sha256(registerBuf) : null;
  const tzManifest = readJson<{ kind: string; tz: string; file: string; sha256: string; name: string; mail: string; mailDate: string; tzDate: string | null; docQty: number; docWork: number; docTotal: number | null; audit: { verdict: string; tier: string; doc: number | null } | null }[]>(join(REVIEW, "mail-docs", "manifest-tz.json"), []);
  if (!tzManifest.length) fileProblems.push("манифест Word-приложений ТЗ (mail-docs/manifest-tz.json) не найден");
  type PhM = { docId: string; docType: string; title: string; sha256: string; size: number; mail: string; mailDate: string; name: string; mime: string; file: string };
  const phManifest = readJson<PhM[]>(join(REVIEW, "mail-docs", "manifest-ph.json"), []);
  if (!phManifest.length) fileProblems.push("манифест файлов из писем (mail-docs/manifest-ph.json) не найден");
  const ameEml = join(MAIL_DIR, "42.eml");
  const ameBuf = existsSync(ameEml) ? readFileSync(ameEml) : null;
  if (!ameBuf) fileProblems.push("письмо №42 (09.09.2026) не найдено в архиве почты");
  else if (!ameBuf.toString("utf8").includes("переплаты по SAGA и подкладке учтены")) fileProblems.push("в письме №42 нет фразы «переплаты по SAGA и подкладке учтены»");

  const table: string[][] = [];
  const skipped: string[][] = [];
  const created: { id: string; file: string }[] = [];
  const docsUpdated: Upd[] = [];
  const purchasesUpdated: Upd[] = [];
  const verifies: Verif[] = [];
  const stamp = new Date();
  let phKinds: [string, number][] = [];

  const run = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    created.length = 0; docsUpdated.length = 0; purchasesUpdated.length = 0; verifies.length = 0; table.length = 0; skipped.length = 0; problems.length = 0; problems.push(...fileProblems);
    const snap = async () => {
      const sd = await loadSupplierDebt(tx as never, org, "all");
      const cd = await loadClientDebt(tx, org, { year: "all" });
      const tb = await loadTaskBlocks(tx as never, org);
      const cov = await computeDocCoverage(tx as never, org);
      const vm = await loadVerifyModel(tx as never, org, { userId: "script", c4Mode: "off", canUpload: false, canMark: false });
      const waiting = (k: string) => vm.rows.filter((r) => r.kind === k && !r.verified && !r.zero).length;
      return {
        supplierDebt: sd.debt.toNumber(), work: cd.work, workBalance: cd.balance,
        sumP: num((await tx.payment.aggregate({ where: { organizationId: org }, _sum: { amount: true } }))._sum.amount ?? 0),
        sumPP: num((await tx.productionPayment.aggregate({ where: { organizationId: org }, _sum: { amount: true } }))._sum.amount ?? 0),
        openDocTasks: tb.docTasks.filter((d) => d.open && d.counts).map((d) => d.task.id),
        gapRows: cov.total.rowsWithGaps, gaps: cov.total.required - cov.total.have,
        waiting: { purchase: waiting("purchase"), order: waiting("order"), batch: waiting("batch") },
        verifiedOrders: vm.rows.filter((r) => r.kind === "order" && r.verified).length,
      };
    };
    const before = await snap();

    // ───── 1) реестр списаний → оплаты поставщику
    const pays = await tx.payment.findMany({ where: { organizationId: org, status: "COMPLETED", ppNo: { not: null } }, select: { id: true, amount: true, paidAt: true, ppNo: true, purchaseId: true, auctionSession: true, purchase: { select: { number: true } } }, orderBy: { paidAt: "asc" } });
    const prodPays = await tx.productionPayment.findMany({ where: { organizationId: org, status: "COMPLETED", ppNo: { not: null } }, select: { ppNo: true, amount: true, paidAt: true } });
    const purByNumber = new Map((await tx.purchase.findMany({ where: { organizationId: org }, select: { id: true, number: true, auctionSession: true, auctionId: true, orderDate: true, items: { select: { subtotal: true } } } })).map((p) => [p.number, p]));
    const existingProof = new Set((await tx.driveDocument.findMany({ where: { organizationId: org, docType: "PAYMENT_PROOF", driveFileId: { startsWith: "local-ctl19-pay-" } }, select: { driveFileId: true } })).map((d) => d.driveFileId));
    let payDocs = 0;
    for (const p of pays) {
      const pp = p.ppNo!;
      const r = REG_BY_PP.get(pp);
      if (!r) { skipped.push([`оплата п/п ${pp}`, "платёж есть в базе, но п/п нет в реестре списаний", "—"]); continue; }
      const dbSum = [...pays.filter((x) => x.ppNo === pp), ...prodPays.filter((x) => x.ppNo === pp)].reduce((s, x) => s + num(x.amount), 0);
      const dates = new Set([...pays.filter((x) => x.ppNo === pp), ...prodPays.filter((x) => x.ppNo === pp)].map((x) => x.paidAt.toISOString().slice(0, 10)));
      if (Math.abs(dbSum - r[3]) > 0.005 || dates.size !== 1 || ![...dates][0].startsWith(r[2])) { skipped.push([`оплата п/п ${pp}`, `сумма/дата в базе (${rub(dbSum)}, ${[...dates].map(dmy).join("/")}) не совпали с реестром (${rub(r[3])}, ${dmy(r[2])})`, `Оплаты.xls, стр. ${r[0]}`]); continue; }
      const key = `local-ctl19-pay-${pp}-${p.id}`;
      if (existingProof.has(key)) continue;
      if (p.purchase?.number === "З-2026-0059") { skipped.push([`оплата п/п ${pp} · ${rub(num(p.amount))} ₽ (закупка З-2026-0059, красная лиса)`, `п/п есть в реестре, но назначение платежа — счёт на пошив, а не УПД №209; отнесение ${rub(num(p.amount))} ₽ к лисе — решение владельца (задача fox-209-proof остаётся)`, `Оплаты.xls, стр. ${r[0]}`]); continue; }
      const anchor = TASK_ANCHOR[pp];
      let purchaseId: string | null = null;
      if (anchor && !p.purchaseId) {
        const ap = purByNumber.get(anchor.purchase);
        if (!ap) { problems.push(`закупка ${anchor.purchase} для задачи ${anchor.task} не найдена`); continue; }
        const an = (x: string | null) => (x ?? "").split(/\r?\n/)[0].trim();
        if (an(ap.auctionSession) !== an(p.auctionSession)) { if (!pays.some((x) => x.ppNo === pp && an(x.auctionSession) === an(ap.auctionSession))) problems.push(`п/п ${pp}: аукцион оплаты «${an(p.auctionSession)}» не совпал с аукционом закупки ${anchor.purchase} «${an(ap.auctionSession)}»`); }
        else purchaseId = ap.id;
      }
      const part = p.purchase?.number ? ` (закупка ${p.purchase.number})` : p.auctionSession ? ` (${p.auctionSession.split(/\r?\n/)[0]})` : "";
      const title = `Реестр списаний «Оплаты.xls» — п/п №${pp} от ${dmy(r[2])}, ${rub(r[3])} ₽, договор №${r[4]}`;
      const notes = `${CTL_TAG} Банковский реестр списаний с расчётного счёта Меркури Мода (лист «Лист_1», строка ${r[0]}): дата ${dmy(r[2])}, списание ${rub(r[3])}, вх. номер ${pp}, контрагент ВЕЛЛМЕХ ООО. Часть, заведённая в эту оплату: ${rub(num(p.amount))} ₽${part}.${anchor ? ` Закрывает задачу «${anchor.task}».` : ""}`;
      let file = "";
      if (registerBuf) { file = saveFile(registerBuf, "xls"); }
      const d = await tx.driveDocument.create({
        data: {
          organizationId: org, driveFileId: key, title, docType: "PAYMENT_PROOF", mimeType: "application/vnd.ms-excel", sizeBytes: REG_SIZE, docNumber: pp,
          docDate: new Date(`${r[2]}T12:00:00.000Z`), year: Number(r[2].slice(0, 4)), notes, paymentId: p.id, purchaseId,
          storagePath: file || null, storedAt: file ? stamp : null, storedMime: file ? "application/vnd.ms-excel" : null, storedName: file ? "Оплаты.xls" : null, storedSize: file ? REG_SIZE : null,
        },
      });
      if (file) created.push({ id: d.id, file });
      payDocs++;
      table.push([`оплата п/п ${pp} · ${dmy(r[2])} · ${rub(num(p.amount))} ₽${part}`, `+ документ «платёжка» (реестр списаний, стр. ${r[0]})${purchaseId ? ` → привязан к закупке ${anchor!.purchase}` : ""}`, `п/п, дата и сумма совпали с «Оплаты.xls», стр. ${r[0]}${anchor ? `; закрывает задачу ${anchor.task}` : ""}`]);
    }

    // ───── 2) письмо Веллмеха 09.09.2026 → зачёт переплат (закупка З-2026-0058)
    {
      const ame = purByNumber.get("З-2026-0058");
      const letter = await tx.driveDocument.findFirst({ where: { organizationId: org, docType: "APPROVAL_EMAIL", title: { startsWith: "Зачёт переплат SAGA и подкладки — письмо Веллмех 09.09.2026" } } });
      if (!ame || !letter) problems.push("не найдена закупка З-2026-0058 или запись «Зачёт переплат…»");
      else if (letter.storagePath && letter.purchaseId === ame.id) { /* уже сделано */ }
      else if (ameBuf) {
        const calc = await tx.driveDocument.findFirst({ where: { organizationId: org, docType: "CALC_SHEET", title: { startsWith: "расчет себестоимости fin.xlsx (зачёты" } } });
        const note = calc?.notes ?? "";
        if (!/353 992,79 − 139 469,87 = 214 522,92/.test(note)) problems.push("в расчёте Веллмеха нет арифметики зачётов 353 992,79 − 139 469,87 = 214 522,92");
        const file = saveFile(ameBuf, "eml");
        const before = { storagePath: letter.storagePath, storedAt: letter.storedAt?.toISOString() ?? null, storedMime: letter.storedMime, storedName: letter.storedName, storedSize: letter.storedSize, mimeType: letter.mimeType, sizeBytes: letter.sizeBytes, purchaseId: letter.purchaseId, notes: letter.notes };
        const after = { storagePath: file, storedAt: stamp, storedMime: "message/rfc822", storedName: "Спецификация 11 норка махагон 371 шт. (376 шт.).eml", storedSize: ameBuf.length, mimeType: "message/rfc822", sizeBytes: ameBuf.length, purchaseId: ame.id, notes: `${letter.notes ?? ""}\n${CTL_TAG} Файл письма №42 из архива почты (09.09.2026 13:46, Василий, Веллмех: «переплаты по SAGA и подкладке учтены»; во вложении УПД, счёт №253, расчёт). Арифметика: счёт 353 992,79 − зачёты 139 469,87 (83 875,37 + 55 594,50) = 214 522,92 = п/п 63545 (Оплаты.xls, стр. 62).`.trim() };
        await tx.driveDocument.update({ where: { id: letter.id }, data: after });
        docsUpdated.push({ id: letter.id, before, after: { ...after, storedAt: stamp.toISOString() } });
        table.push(["закупка З-2026-0058 · зачёты 139 469,87 ₽ (задача ame-offsets)", "письмо Веллмеха 09.09.2026 прикреплено файлом и привязано к закупке", "письмо №42: «переплаты по SAGA и подкладке учтены»; 353 992,79 − 139 469,87 = 214 522,92 = п/п 63545"]);
      }
    }

    // ───── 3) аукцион у З-2026-0008 / 0009
    for (const [number, invNo, regRow] of [["З-2026-0008", "80", 9], ["З-2026-0009", "96", 14]] as const) {
      const p = purByNumber.get(number);
      const r = REG.find((x) => x[0] === regRow)!;
      if (!p) { problems.push(`закупка ${number} не найдена`); continue; }
      const cur = p.auctionSession?.split(/\r?\n/)[0].trim() ?? "";
      if (cur !== "Нет информации") continue;
      const a = p.auctionId ? await tx.auction.findFirst({ where: { id: p.auctionId, organizationId: org }, select: { name: true, isService: true } }) : null;
      const total = p.items.reduce((s, i) => s + num(i.subtotal), 0);
      if (!a || a.isService || !a.name.includes(`№${invNo}`)) { skipped.push([`закупка ${number}`, "аукцион в справочнике не «Белая норка №" + invNo + "»", "—"]); continue; }
      if (r[5] !== invNo || p.orderDate.toISOString().slice(0, 10) !== r[2]) { skipped.push([`закупка ${number}`, `дата закупки ${p.orderDate.toISOString().slice(0, 10)} не совпала с реестром ${r[2]}`, `Оплаты.xls, стр. ${regRow}`]); continue; }
      void total;
      await tx.purchase.update({ where: { id: p.id }, data: { auctionSession: a.name } });
      purchasesUpdated.push({ id: p.id, before: { auctionSession: p.auctionSession }, after: { auctionSession: a.name } });
      table.push([`закупка ${number} (счёт №${invNo})`, `аукцион «Нет информации» → «${a.name}»`, `аукцион в справочнике уже «${a.name}»; п/п ${r[1]} от ${dmy(r[2])} на ${rub(r[3])} ₽ = счёт №${invNo} (Оплаты.xls, стр. ${regRow}); закупка без аукциона торгов`]);
    }

    // ───── 4) Word-приложения ТЗ из писем
    const orders = await tx.productionOrder.findMany({ where: { organizationId: org, status: { not: "CANCELLED" }, workOrderNumber: { not: null } }, select: { id: true, number: true, workOrderNumber: true, workOrderDate: true, plannedQuantity: true, clientWorkPricePerUnit: true } });
    const appxByOrder = new Map<string, Awaited<ReturnType<typeof tx.driveDocument.findMany>>>();
    for (const d of await tx.driveDocument.findMany({ where: { organizationId: org, docType: "TZ_APPENDIX", productionOrderId: { not: null } }, orderBy: { createdAt: "asc" } })) appxByOrder.set(d.productionOrderId!, [...(appxByOrder.get(d.productionOrderId!) ?? []), d]);
    let tzDocs = 0, tzAttached = 0;
    for (const m of tzManifest) {
      const os = orders.filter((o) => o.workOrderNumber === m.tz);
      if (!os.length) { skipped.push([`ТЗ ${m.tz}`, "в базе нет ТЗ с таким номером", "—"]); continue; }
      const q = os.reduce((s, o) => s + num(o.plannedQuantity), 0);
      const w = Math.round(os.reduce((s, o) => s + num(o.plannedQuantity) * num(o.clientWorkPricePerUnit ?? 0), 0) * 100) / 100;
      if (Math.abs(q - m.docQty) > 0.001 || Math.abs(w - m.docWork) > 1) { skipped.push([`ТЗ ${m.tz}`, `кол-во/работа в базе (${q} · ${rub(w)}) не совпали с документом (${m.docQty} · ${rub(m.docWork)})`, `письмо №${m.mail.split(".")[0]}`]); continue; }
      const path = join(REVIEW, m.file);
      if (!existsSync(path)) { problems.push(`ТЗ ${m.tz}: файл ${m.file} не найден`); continue; }
      const buf = readFileSync(path);
      if (sha256(buf) !== m.sha256) { problems.push(`ТЗ ${m.tz}: контрольная сумма файла ${m.file} не совпала`); continue; }
      const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const dt = m.tzDate ? new Date(`${m.tzDate.split(".").reverse().join("-")}T12:00:00.000Z`) : null;
      const evidence = `${CTL_TAG} Файл из письма №${m.mail.split(".")[0]} архива почты (${m.mailDate}). Количество ${m.docQty} и работа ${rub(m.docWork)} ₽ совпали с ТЗ в базе; итог по документу ${m.docTotal != null ? rub(m.docTotal) : "—"} ₽${m.audit ? ` = аудит Word-ТЗ 19.10.2026 (${m.audit.verdict}${m.audit.tier ? `, ярус ${m.audit.tier}` : ""})` : ""}.`;
      for (const o of os) {
        const docs = appxByOrder.get(o.id) ?? [];
        if (docs.some((d) => d.storagePath)) continue; // файл приложения уже есть
        const ph = docs.find((d) => d.docNumber === m.tz) ?? docs[0];
        const file = saveFile(buf, "docx");
        if (ph) {
          const before = { storagePath: ph.storagePath, storedAt: ph.storedAt?.toISOString() ?? null, storedMime: ph.storedMime, storedName: ph.storedName, storedSize: ph.storedSize, mimeType: ph.mimeType, sizeBytes: ph.sizeBytes, notes: ph.notes, docDate: ph.docDate?.toISOString() ?? null };
          const after = { storagePath: file, storedAt: stamp, storedMime: mime, storedName: m.name, storedSize: buf.length, mimeType: mime, sizeBytes: buf.length, notes: `${ph.notes ?? ""}\n${evidence}`.trim() };
          await tx.driveDocument.update({ where: { id: ph.id }, data: after });
          docsUpdated.push({ id: ph.id, before, after: { ...after, storedAt: stamp.toISOString() } });
          tzAttached++;
        } else {
          const d = await tx.driveDocument.create({
            data: { organizationId: org, driveFileId: `local-ctl19-tz-${o.id}`, title: m.name, docType: "TZ_APPENDIX", mimeType: mime, sizeBytes: buf.length, docNumber: m.tz, docDate: dt, year: dt ? dt.getUTCFullYear() : null, productionOrderId: o.id, notes: evidence, storagePath: file, storedAt: stamp, storedMime: mime, storedName: m.name, storedSize: buf.length },
          });
          created.push({ id: d.id, file });
          tzDocs++;
        }
        table.push([`ТЗ ${m.tz} (${o.number})`, `${ph ? "файл прикреплён к записи приложения" : "+ приложение к ТЗ"} «${m.name}»`, `письмо №${m.mail.split(".")[0]}: кол-во ${m.docQty}, работа ${rub(m.docWork)} совпали с базой; итог ${m.docTotal != null ? rub(m.docTotal) : "—"}`]);
      }
    }


    // ───── 4б) файлы из писем → существующие записи документов без файла («не прикреплён»)
    // Запись документа уже привязана к закупке / лоту / партии / оплате (по структуре архива); в письмах лежит файл с тем же именем, и во всех письмах это одно и то же содержимое.
    // Прикрепляю только если: запись без файла, название записи = имя вложения, у вложения одна версия (одинаковый хеш), тип документа не противоречит названию. Версий несколько — не трогаю.
    {
      const ids = phManifest.map((m) => m.docId);
      const rowsPh = await tx.driveDocument.findMany({ where: { id: { in: ids } } });
      const byId = new Map(rowsPh.map((d) => [d.id, d]));
      const shaFile = new Map<string, string>();
      const kinds = new Map<string, number>();
      for (const m of phManifest) {
        const d = byId.get(m.docId);
        if (!d) { skipped.push([`запись «${m.title}»`, "записи нет в базе (это манифест от другой базы)", m.docId]); continue; }
        if (d.storagePath) continue; // уже прикреплён
        if (d.title !== m.title || d.docType !== m.docType) { skipped.push([`запись «${m.title}»`, "название или тип записи изменились", m.docId]); continue; }
        const path = join(REVIEW, m.file);
        if (!existsSync(path)) { problems.push(`файл ${m.file} не найден`); continue; }
        let rel = shaFile.get(m.sha256);
        const buf = rel ? null : readFileSync(path);
        if (buf && sha256(buf) !== m.sha256) { problems.push(`контрольная сумма файла ${m.file} не совпала`); continue; }
        if (!rel && buf) { rel = saveFile(buf, m.file.split(".").pop() ?? "bin"); shaFile.set(m.sha256, rel); }
        const evidence = `${CTL_TAG} Файл из письма №${m.mail.split(".")[0]} архива почты (${m.mailDate}): имя вложения «${m.name}» совпало с названием записи; во всех письмах архива это одно и то же содержимое (хеш ${m.sha256.slice(0, 12)}).`;
        const before = { storagePath: d.storagePath, storedAt: d.storedAt?.toISOString() ?? null, storedMime: d.storedMime, storedName: d.storedName, storedSize: d.storedSize, mimeType: d.mimeType, sizeBytes: d.sizeBytes, notes: d.notes };
        const after = { storagePath: rel!, storedAt: stamp, storedMime: m.mime, storedName: m.name.includes(".") ? m.name : `${m.name}.${m.file.split(".").pop()}`, storedSize: m.size, mimeType: d.mimeType ?? m.mime, sizeBytes: d.sizeBytes ?? m.size, notes: `${d.notes ?? ""}\n${evidence}`.trim() };
        await tx.driveDocument.update({ where: { id: d.id }, data: after });
        docsUpdated.push({ id: d.id, before, after: { ...after, storedAt: stamp.toISOString() } });
        const ent = d.purchaseId ? "закупка" : d.lotId ? "лот" : d.productionBatchId ? "партия" : d.paymentId ? "оплата" : d.productionPaymentId ? "оплата работы" : d.productionOrderId ? "ТЗ" : d.supplierId ? "поставщик" : d.clientId ? "заказчик" : "без привязки";
        kinds.set(`${m.docType}|${ent}`, (kinds.get(`${m.docType}|${ent}`) ?? 0) + 1);
        table.push([`${ent}: «${m.title}»`, "файл прикреплён к записи документа", `письмо №${m.mail.split(".")[0]}: то же имя, одно содержимое во всех письмах`]);
      }
      phKinds = [...kinds.entries()];
    }

    // ───── подтверждение ТЗ: после прикрепления приложений
    // Расчёт сведён с Word-ТЗ: «сошлось» в аудите, либо ярус A исправлен скриптом сведения 19.10.2026, либо приложения 169–183 (сошлись до копейки).
    const auditOk = (tz: string): string | null => {
      if (OWNER_TZ.has(tz)) return null;
      if (Number(tz) >= 169 && Number(tz) <= 183) return "приложение 169–183 загружено владельцем; расчёт = Word-ТЗ (аудит 19.10.2026, 61 «сошлось» и 5 исправлены скриптом сведения)";
      const m = tzManifest.find((x) => x.tz === tz);
      if (!m || !m.audit || m.audit.tier === "C") return null;
      const dbDates = new Set(orders.filter((o) => o.workOrderNumber === tz).map((o) => o.workOrderDate?.toISOString().slice(0, 10) ?? ""));
      if (!m.tzDate || dbDates.size !== 1 || [...dbDates][0] !== m.tzDate.split(".").reverse().join("-")) return null; // дата ТЗ в приложении должна совпасть с датой в базе
      if (m.audit.verdict === "сошлось") return "аудит Word-ТЗ 19.10.2026: сошлось (Δ ≤ 1 ₽)";
      if (AUDIT_FIXED.has(tz)) return "аудит Word-ТЗ 19.10.2026: расхождение НДС исправлено скриптом сведения (журнал tz-document-match), теперь Δ ≤ 1 ₽";
      return null;
    };
    const model = await loadVerifyModel(tx as never, org, { userId: "script", c4Mode: "off", canUpload: false, canMark: false });
    const notReady = new Map<string, number>();
    for (const r of model.rows) {
      if (r.kind !== "order" || r.verified) continue;
      const tz = r.title.replace(/^ТЗ\s+/, "");
      const why = auditOk(tz);
      if (!why) { if (r.ready && (OWNER_TZ.has(tz) || tzManifest.some((x) => x.tz === tz))) skipped.push([`${r.title} · ${r.sub?.split(" · ")[0] ?? ""}`, OWNER_TZ.has(tz) ? "проверка приложения без замечаний, но ТЗ ждёт решения владельца (бобр / шаблонная дата / дата ТЗ 118 / ТЗ вне партий / расхождение яруса C аудита)" : "проверка приложения без замечаний, но дата ТЗ в приложении не совпала с датой в базе или аудит не подтверждает расчёт", "OWNER-TODO, tz-audit-2026-10-19 п. 5"]); continue; }
      if (!r.ready) { for (const b of r.blockers) notReady.set(b.text, (notReady.get(b.text) ?? 0) + 1); continue; }
      const note = `Подтверждено по документам (${dmy(stamp.toISOString().slice(0, 10))}): приложение к ТЗ №${tz} в системе, количество и работа совпали, дата ТЗ указана; ${why}. ${CTL_TAG}`;
      const err = await applyVerify(tx as never, org, "order", r.id, "script", { ready: true, blockers: [] }, note, BASIS);
      if (err) { problems.push(`ТЗ ${tz}: ${err}`); continue; }
      verifies.push({ kind: "order", id: r.id, label: r.title, step: "confirm", before: { verifiedAt: null, verifiedBy: null, verifyNote: null }, after: { verifiedBy: BASIS } });
      table.push([`${r.title} · ${r.sub ?? ""}`, "ПОДТВЕРДИТЬ (проверка приложения без замечаний)", `приложение к ТЗ + ${why}`]);
    }
    for (const [text, n] of notReady) skipped.push([`${n} ТЗ с приложением, согласованным с аудитом`, `остаются на подтверждение: ${text}`, "проверка приложения (Подтвердить)"]);

    // ───── закупки и партии, у которых после прикрепления файлов не осталось замечаний (тот же шлюз, что у кнопки «Подтвердить все готовые»)
    {
      const model3 = await loadVerifyModel(tx as never, org, { userId: "script", c4Mode: "off", canUpload: false, canMark: false });
      for (const r of model3.rows) {
        if ((r.kind !== "purchase" && r.kind !== "batch") || r.verified || !r.ready) continue;
        const note = r.kind === "purchase"
          ? `Подтверждено по документам (${dmy(stamp.toISOString().slice(0, 10))}): документы закупки приложены (файлы из писем архива), сумма сверена с реестром сверки (группа «сходится»), оплаты подтверждены банком по реестру списаний «Оплаты.xls»; замечаний нет. ${CTL_TAG}`
          : `Подтверждено по документам (${dmy(stamp.toISOString().slice(0, 10))}): все ТЗ партии подтверждены, счёт и расчёт доплаты приложены (файлы из писем архива), оплата подтверждена банком по реестру списаний «Оплаты.xls»; замечаний нет. ${CTL_TAG}`;
        const err = await applyVerify(tx as never, org, r.kind, r.id, "script", { ready: true, blockers: [] }, note, BASIS);
        if (err) { problems.push(`${r.title}: ${err}`); continue; }
        verifies.push({ kind: r.kind as "purchase" | "batch", id: r.id, label: r.title, step: "confirm", before: { verifiedAt: null, verifiedBy: null, verifyNote: null }, after: { verifiedBy: BASIS } });
        table.push([`${r.title} · ${r.sub ?? ""}`, "ПОДТВЕРДИТЬ (замечаний нет)", "документы приложены, сверка и оплаты по банку сошлись"]);
      }
    }

    // ───── 5) переподтверждение: «подтверждённое менялось после подтверждения» — только служебные поля скриптами
    if (!SKIP_RESTAMP) {
      const model2 = await loadVerifyModel(tx as never, org, { userId: "script", c4Mode: "off", canUpload: false, canMark: false });
      const rowOf = new Map(model2.rows.map((r) => [r.key, r]));
      const purchases = await tx.purchase.findMany({ where: { organizationId: org, verifiedAt: { not: null }, verifiedBy: { not: BASIS } }, select: { id: true, number: true, verifiedAt: true, items: { select: { id: true } }, payments: { select: { id: true } }, rawMaterialLots: { select: { id: true } } } });
      const ords = await tx.productionOrder.findMany({ where: { organizationId: org, verifiedAt: { not: null }, verifiedBy: { not: BASIS } }, select: { id: true, number: true, workOrderNumber: true, verifiedAt: true, materialUsages: { select: { id: true } }, paymentAllocations: { select: { productionPaymentId: true } } } });
      const since = new Date(Math.min(...[...purchases.map((p) => p.verifiedAt!.getTime()), ...ords.map((o) => o.verifiedAt!.getTime())]) - 60_000);
      const audit = await tx.auditLog.findMany({ where: { organizationId: org, at: { gt: since } }, select: { recordId: true, at: true, source: true, model: true, action: true, changes: true } });
      const byRec = new Map<string, typeof audit>();
      for (const a of audit) byRec.set(a.recordId, [...(byRec.get(a.recordId) ?? []), a]);
      const SAFE: Record<string, Set<string>> = {
        Purchase: new Set(["invoiceId", "updatedAt"]), Payment: new Set(["ppNo", "invoiceNo", "notes", "docRef", "confirmedAt", "confirmedBy", "updatedAt"]), ProductionPayment: new Set(["ppNo", "invoiceNo", "notes", "docRef", "confirmedAt", "confirmedBy", "updatedAt"]),
        RawMaterialLot: new Set(["quantityRemaining", "updatedAt"]), ProductionOrder: new Set(["notes", "updatedAt"]),
      };
      const judge = (ids: string[], since0: Date): { safe: boolean; why: string[] } => {
        const why: string[] = [];
        let safe = true;
        let any = false;
        for (const id of ids) for (const a of byRec.get(id) ?? []) {
          if (a.at.getTime() <= since0.getTime() + 60_000) continue;
          any = true;
          const keys = Object.keys((a.changes ?? {}) as Record<string, unknown>);
          const scriptOk = a.source.startsWith("script:");
          if (a.source === "script:apply-control-confirmations-2026-10-19" && keys.every((k) => ["verifiedAt", "verifiedBy", "verifyNote", "auctionSession", "updatedAt"].includes(k))) continue; // собственные записи этого скрипта (в т. ч. откат)
          const createOk = a.action === "create" && a.model === "ProductionPayment" && a.source === "script:apply-payments-match-2026-10-19";
          const updOk = a.action === "update" && !!SAFE[a.model] && keys.every((k) => SAFE[a.model].has(k));
          if (!scriptOk || !(createOk || updOk)) { safe = false; why.push(`${a.model} ${a.action} ${a.source} [${keys.slice(0, 4).join(",")}]`); }
        }
        return { safe: safe && any, why: [...new Set(why)].slice(0, 3) };
      };
      for (const p of purchases) {
        const j = judge([p.id, ...p.items.map((i) => i.id), ...p.payments.map((x) => x.id), ...p.rawMaterialLots.map((l) => l.id)], p.verifiedAt!);
        const touched = [p.id, ...p.items.map((i) => i.id), ...p.payments.map((x) => x.id), ...p.rawMaterialLots.map((l) => l.id)].some((id) => (byRec.get(id) ?? []).some((a) => a.at.getTime() > p.verifiedAt!.getTime() + 60_000));
        if (!touched) continue;
        const row = rowOf.get(`purchase:${p.id}`);
        if (!j.safe) { skipped.push([`переподтверждение: закупка ${p.number}`, `после подтверждения менялось не только служебное: ${j.why.join("; ")}`, "журнал изменений"]); continue; }
        if (!row || !row.ready) { skipped.push([`переподтверждение: закупка ${p.number}`, `сейчас есть замечания: ${(row?.blockers ?? []).map((b) => b.text).slice(0, 3).join("; ")}`, "проверка приложения"]); continue; }
        const note = `Переподтверждено (${dmy(stamp.toISOString().slice(0, 10))}): после подтверждения менялись только служебные поля скриптами (номер счёта, п/п, примечание, остаток лота); замечаний нет. ${CTL_TAG}`;
        const cur = await tx.purchase.findUniqueOrThrow({ where: { id: p.id }, select: { verifiedAt: true, verifiedBy: true, verifyNote: true } });
        await tx.purchase.update({ where: { id: p.id }, data: { verifiedAt: stamp, verifiedBy: BASIS, verifyNote: note } });
        verifies.push({ kind: "purchase", id: p.id, label: `Закупка ${p.number}`, step: "restamp", before: { verifiedAt: cur.verifiedAt?.toISOString() ?? null, verifiedBy: cur.verifiedBy, verifyNote: cur.verifyNote }, after: { verifiedBy: BASIS } });
        table.push([`закупка ${p.number}`, "ПЕРЕПОДТВЕРДИТЬ (служебные правки после подтверждения)", "журнал изменений: только номер счёта/п/п/примечание/остаток лота"]);
      }
      for (const o of ords) {
        const ids = [o.id, ...o.materialUsages.map((u) => u.id), ...o.paymentAllocations.map((a) => a.productionPaymentId)];
        const touched = ids.some((id) => (byRec.get(id) ?? []).some((a) => a.at.getTime() > o.verifiedAt!.getTime() + 60_000));
        if (!touched) continue;
        const j = judge(ids, o.verifiedAt!);
        const row = rowOf.get(`order:${o.id}`);
        const label = `ТЗ ${o.workOrderNumber ?? o.number}`;
        if (!j.safe) { skipped.push([`переподтверждение: ${label}`, `после подтверждения менялось не только служебное: ${j.why.join("; ")}`, "журнал изменений"]); continue; }
        if (!row || !row.ready) { skipped.push([`переподтверждение: ${label}`, `сейчас есть замечания: ${(row?.blockers ?? []).map((b) => b.text).slice(0, 3).join("; ")}`, "проверка приложения"]); continue; }
        const note = `Переподтверждено (${dmy(stamp.toISOString().slice(0, 10))}): после подтверждения менялись только служебные поля скриптами (п/п и номер счёта оплат, примечание, новые оплаты работы по реестру списаний); замечаний нет. ${CTL_TAG}`;
        const before = await tx.productionOrder.findUniqueOrThrow({ where: { id: o.id }, select: { verifiedAt: true, verifiedBy: true, verifyNote: true } });
        await tx.productionOrder.update({ where: { id: o.id }, data: { verifiedAt: stamp, verifiedBy: BASIS, verifyNote: note } });
        verifies.push({ kind: "order", id: o.id, label, step: "restamp", before: { verifiedAt: before.verifiedAt?.toISOString() ?? null, verifiedBy: before.verifiedBy, verifyNote: before.verifyNote }, after: { verifiedBy: BASIS } });
        table.push([label, "ПЕРЕПОДТВЕРДИТЬ (служебные правки после подтверждения)", "журнал изменений: п/п, номера счетов, примечания, новые оплаты работы"]);
      }
    }

    const after = await snap();
    // ───── инварианты
    if (Math.abs(after.supplierDebt - before.supplierDebt) > 0.005) problems.push(`долг поставщику изменился: ${rub(before.supplierDebt)} → ${rub(after.supplierDebt)}`);
    if (Math.abs(after.work - before.work) > 0.005 || Math.abs(after.workBalance - before.workBalance) > 0.005) problems.push("работа по ТЗ или долг по работе изменились");
    if (Math.abs(after.sumP - before.sumP) > 0.005 || Math.abs(after.sumPP - before.sumPP) > 0.005) problems.push("суммы оплат изменились");
    for (const c of created) if (!existsSync(join(UPLOAD_ROOT, c.file)) || statSync(join(UPLOAD_ROOT, c.file)).size === 0) problems.push(`файл ${c.file} не записан`);
    return { before, after, payDocs, tzDocs: tzDocs + tzAttached };
  };

  type Res = Awaited<ReturnType<typeof run>>;
  let res: Res | null = null;
  const prev = readJson<Journal | null>(JOURNAL, null);
  try {
    await prisma.$transaction(async (tx) => { res = await run(tx); throw new DryRun(); }, { timeout: 600000, maxWait: 30000 });
  } catch (e) { if (!(e instanceof DryRun)) throw e; }
  const r = res as unknown as Res;
  const simCreated = [...created], simUpdated = [...docsUpdated], simPurchases = [...purchasesUpdated], simVerifies = [...verifies];
  for (const f of DRY_FILES.splice(0)) { try { unlinkSync(f); } catch { /* */ } }
  simulating = false;
  const out: string[] = [`# «Контроль»: подтверждения по документам — ${APPLY ? "ПРИМЕНЕНИЕ" : "пробный прогон"} (${new Date().toISOString()}), база «${dbName}»`, "", "| Пункт | Что меняется | Основание |", "|---|---|---|"];
  for (const t of table) out.push(`| ${t.map((c) => c.replace(/\|/g, "/")).join(" | ")} |`);
  out.push("", "## НЕ ТРОГАЮ (уверенность ниже 95% или решение владельца)", "", "| Пункт | Почему | Источник |", "|---|---|---|");
  for (const t of skipped) out.push(`| ${t.map((c) => c.replace(/\|/g, "/")).join(" | ")} |`);
  out.push("", "## ДО → ПОСЛЕ", "");
  out.push(`- Долг поставщику: ${rub(r.before.supplierDebt)} → ${rub(r.after.supplierDebt)} (не должен меняться); работа по ТЗ ${rub(r.before.work)} → ${rub(r.after.work)}; долг по работе ${rub(r.before.workBalance)} → ${rub(r.after.workBalance)}; Σ оплат ${rub(r.before.sumP + r.before.sumPP)} → ${rub(r.after.sumP + r.after.sumPP)}`);
  out.push(`- Открытые задачи на документы (в счётчике): ${r.before.openDocTasks.length} → ${r.after.openDocTasks.length}; закрываются: ${r.before.openDocTasks.filter((x) => !r.after.openDocTasks.includes(x)).join(", ") || "—"}`);
  out.push(`- Документы: записей с пробелами ${r.before.gapRows} → ${r.after.gapRows}; всего пробелов ${r.before.gaps} → ${r.after.gaps}`);
  out.push(`- «Подтвердить» (ждут): закупки ${r.before.waiting.purchase} → ${r.after.waiting.purchase}; ТЗ ${r.before.waiting.order} → ${r.after.waiting.order}; партии ${r.before.waiting.batch} → ${r.after.waiting.batch}; подтверждённых ТЗ ${r.before.verifiedOrders} → ${r.after.verifiedOrders}`);
  if (phKinds.length) out.push(`- Файлы из писем к существующим записям (по типу и привязке): ${phKinds.sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} — ${n}`).join("; ")}`);
  out.push(`- Файлов прикрепляется: ${simCreated.length + simUpdated.length} (новых записей документов ${simCreated.length}: платёжки ${r.payDocs}; файл к существующей записи документа: ${simUpdated.length}); закупок: ${simPurchases.length}; подтверждений: ${simVerifies.filter((v) => v.step === "confirm").length}, переподтверждений: ${simVerifies.filter((v) => v.step === "restamp").length}`);
  if (problems.length) out.push("", "## ПРОБЛЕМЫ — применять нельзя", ...problems.map((p) => `- ${p}`));
  const md = out.join("\n");
  console.log(md);
  if (!APPLY) writeFileSync(join(REVIEW, "dry-run-control-confirmations.md"), md);
  if (problems.length) { console.log("\nПРОБЛЕМЫ — запись отменена."); await prisma.$disconnect(); process.exit(1); }
  if (!APPLY) { console.log("\nПробный прогон: БД и файлы не менялись. Для записи — --apply (копия) или --apply --live (боевая)."); await prisma.$disconnect(); return; }

  if (prev && prev.status === "applied") { console.log("Журнал уже содержит применённое — повторно не применяю (сначала --rollback --apply)."); await prisma.$disconnect(); return; }
  if (!simCreated.length && !simUpdated.length && !simPurchases.length && !simVerifies.length) { console.log("Нечего применять (идемпотентно)."); await prisma.$disconnect(); return; }
  if (isLive && !NO_BACKUP) { console.log("Копия базы перед применением: scripts/backup.sh …"); execSync("sh scripts/backup.sh", { stdio: "inherit" }); }
  const live: Journal = { script: "apply-control-confirmations-2026-10-19.ts", status: "applied", at: new Date().toISOString(), db: dbName, uploadDir: UPLOAD_ROOT, registerSha256: registerSha, docsCreated: [], docsUpdated: [], purchasesUpdated: [], verifies: [] };
  try {
    await prisma.$transaction(async (tx) => {
      const r2 = await run(tx);
      if (problems.length) throw new Error(problems.join("; "));
      live.docsCreated = [...created]; live.docsUpdated = [...docsUpdated]; live.purchasesUpdated = [...purchasesUpdated]; live.verifies = [...verifies];
      writeJson(JOURNAL, live);
      void r2;
    }, { timeout: 600000, maxWait: 30000 });
  } catch (e) {
    for (const c of created) { try { unlinkSync(join(UPLOAD_ROOT, c.file)); } catch { /* */ } }
    for (const u of docsUpdated) { const f = (u.after as { storagePath?: string } | undefined)?.storagePath; if (f) { try { unlinkSync(join(UPLOAD_ROOT, f)); } catch { /* */ } } }
    throw e;
  }
  console.log(`Применено на «${dbName}»: документов ${live.docsCreated.length}, обновлено документов ${live.docsUpdated.length}, закупок ${live.purchasesUpdated.length}, подтверждений ${live.verifies.length}. Журнал: ${JOURNAL}`);
  await prisma.$disconnect();
}

/** ТЗ, у которых расхождение с Word-ТЗ (ярус A) исправлено скриптом сведения 19.10.2026 (journal corrections-journal-tz-document-match-2026-10-19.json, поле orders[].tz). */
const AUDIT_FIXED = new Set(["70", "71", "72", "73", "74", "76", "77", "78", "80", "81", "82", "83", "84", "85", "86", "87", "88", "89", "98", "99", "100", "101", "102", "103", "105", "106", "107", "108", "109", "110", "113", "114", "115", "117", "118", "119", "120", "122", "123", "124", "125", "126", "127", "128", "129", "131", "132", "133", "134", "135", "137", "138", "140", "141", "143", "145", "148", "149", "150", "152", "153", "160", "161", "164", "166", "169", "171", "172", "174", "182", "183"]);
main().catch((e) => { console.error(e); for (const f of DRY_FILES) { try { unlinkSync(f); } catch { /* */ } } process.exit(1); });
