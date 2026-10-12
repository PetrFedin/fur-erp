/**
 * «Контроль»: закрытие того, что подтверждено документами и письмами (12.10.2026). По умолчанию — пробный прогон.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-control-cleanup.ts [--apply|--rollback --apply]
 * Для пробы на копии: DATABASE_URL=…/fur_erp_scratch_control UPLOAD_DIR=/tmp/ctl/uploads-scratch (без --env-file).
 * Перед записью в живую БД — scripts/backup.sh. Журнал: docs-inventory/corrections-journal-control-cleanup-2026-10-12.json.
 * Шаги: (1) признак «сырьё подрядчика» у З-2026-0012/0013 (решение владельца К8/К9 от 08.10.2026);
 *       (2) счета, уже лежащие в Drive, привязываются к оплатам шкур подрядчика (№235, №239, №1, №7) и к партии 8 (доплата вошла в счёт №7, Г1);
 *       (3) файлы из писем (docs-inventory/mail-attachments): инвойсы SAGA 03-25 (письмо №382), счёт №37 (№383), Invoice 1-2026 (№101), ТЗ 116 (№138);
 *       (4) подтверждение строк, у которых проверка приложения (computeReadiness) не нашла ни одного замечания.
 */
import "./stubs/server-only-shim";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const INV = path.join(__dirname, "..", "docs-inventory");
const JOURNAL = path.join(INV, "corrections-journal-control-cleanup-2026-10-12.json");
const UPLOAD = path.resolve(process.env.UPLOAD_DIR?.trim() || "./uploads");
const BASIS = "auto:control-cleanup-2026-10-12";
type J = { time: string; step: string; kind: string; id: string; label: string; before?: unknown; after?: unknown; source: string; file?: string; rolledBack?: string };
const readJ = (): J[] => (existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : []);
const writeJ = (j: J[]) => writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
const prisma = new PrismaClient();
const log = (...a: unknown[]) => console.log(...a);

async function rollback() {
  const j = readJ();
  for (const e of j.slice().reverse()) {
    if (e.rolledBack) continue;
    log(APPLY ? "откат" : "будет откачено", e.step, e.label);
    if (!APPLY) continue;
    if (e.kind === "doc") { await prisma.driveDocument.deleteMany({ where: { id: e.id } }); if (e.file && existsSync(path.join(UPLOAD, e.file))) { const still = await prisma.driveDocument.count({ where: { storagePath: e.file } }); if (!still) unlinkSync(path.join(UPLOAD, e.file)); } }
    else if (e.kind === "contractorRaw") await prisma.purchase.update({ where: { id: e.id }, data: { isContractorRaw: (e.before as boolean | null) } });
    else if (e.kind === "verify") {
      const b = e.before as { verifiedAt: string | null; verifiedBy: string | null; verifyNote: string | null; entity: string };
      const data = { verifiedAt: null, verifiedBy: null, verifyNote: null };
      if (b.entity === "order") await prisma.productionOrder.updateMany({ where: { id: e.id, verifiedBy: BASIS }, data });
      else if (b.entity === "purchase") await prisma.purchase.updateMany({ where: { id: e.id, verifiedBy: BASIS }, data });
      else if (b.entity === "batch") await prisma.productionBatch.updateMany({ where: { id: e.id, verifiedBy: BASIS }, data });
      else if (b.entity === "payment") await prisma.payment.updateMany({ where: { id: e.id, confirmedBy: BASIS }, data: { confirmed: false, confirmedAt: null, confirmedBy: null } });
      else await prisma.productionPayment.updateMany({ where: { id: e.id, confirmedBy: BASIS }, data: { confirmed: false, confirmedAt: null, confirmedBy: null } });
    }
    e.rolledBack = new Date().toISOString();
  }
  if (APPLY) writeJ(j);
}

async function main() {
  if (ROLLBACK) return rollback();
  const org = (await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;
  const journal = readJ();
  const push = (e: Omit<J, "time">) => { if (APPLY) { journal.push({ time: new Date().toISOString(), ...e }); writeJ(journal); } };
  log(APPLY ? "ПРИМЕНЕНИЕ" : "ПРОБНЫЙ ПРОГОН", "| загрузки:", UPLOAD);

  // (1) сырьё подрядчика
  for (const num of ["З-2026-0012", "З-2026-0013"]) {
    const p = await prisma.purchase.findFirst({ where: { organizationId: org, number: num }, select: { id: true, isContractorRaw: true } });
    if (!p || p.isContractorRaw === true) continue;
    log("1) isContractorRaw=true", num);
    if (APPLY) await prisma.purchase.update({ where: { id: p.id }, data: { isContractorRaw: true } });
    push({ step: "1", kind: "contractorRaw", id: p.id, label: num, before: p.isContractorRaw, after: true, source: "OPEN-QUESTIONS К8/К9, решение владельца 08.10.2026: шкуры подрядчика (счета №1, №7)" });
  }

  // (2) существующие счета Drive → оплаты шкур подрядчика и партия 8
  const copyDoc = async (srcWhere: object, link: { paymentId?: string; productionBatchId?: string }, label: string, source: string) => {
    const src = await prisma.driveDocument.findFirst({ where: { organizationId: org, ...srcWhere }, orderBy: { createdAt: "asc" } });
    if (!src) { log("  ! не найден источник", label); return; }
    const exist = await prisma.driveDocument.findFirst({ where: { organizationId: org, driveFileId: src.driveFileId, ...link } });
    if (exist) return;
    log("2) привязать", src.title.slice(0, 50), "→", label);
    if (!APPLY) return;
    const { id: _i, createdAt: _c, purchaseId: _p, lotId: _l, productionOrderId: _o, productionBatchId: _b, paymentId: _pa, productionPaymentId: _pp, clientId: _cl, supplierId: _s, ...rest } = src;
    void _i; void _c; void _p; void _l; void _o; void _b; void _pa; void _pp; void _cl; void _s;
    const d = await prisma.driveDocument.create({ data: { ...rest, ...link } });
    push({ step: "2", kind: "doc", id: d.id, label: `${src.title} → ${label}`, source });
  };
  const hides: [string, string][] = [["З-2026-0010", "235"], ["З-2026-0011", "239"], ["З-2026-0012", "1"], ["З-2026-0013", "7"]];
  for (const [num, inv] of hides) {
    const pays = await prisma.payment.findMany({ where: { organizationId: org, purchase: { number: num }, docRef: { contains: `счёт №${inv} ` } }, select: { id: true, docRef: true } });
    const pays2 = num === "З-2026-0013" ? await prisma.payment.findMany({ where: { organizationId: org, purchase: { number: num } }, select: { id: true, docRef: true } }) : pays;
    for (const p of pays2) await copyDoc({ docNumber: inv, docType: "PAYMENT_INVOICE", productionBatchId: { not: null } }, { paymentId: p.id }, `оплата ${num}`, `К8: ${p.docRef?.slice(0, 80)}`);
  }
  const b8 = await prisma.productionBatch.findFirst({ where: { organizationId: org, number: 8 }, select: { id: true } });
  if (b8) await copyDoc({ docNumber: "7", docType: "PAYMENT_INVOICE", productionBatchId: { not: null } }, { productionBatchId: b8.id }, "партия 8", "OPEN-QUESTIONS Г1/В4: доплата партии 8 (400 625,59) вошла в счёт №7, п/п №26829");

  // (3) файлы из писем
  const mailDoc = async (rel: string, ext: string, mime: string, title: string, docType: string, docNumber: string, docDate: string, link: Record<string, string>, label: string, source: string) => {
    const dup = await prisma.driveDocument.findFirst({ where: { organizationId: org, title, ...link } });
    if (dup) return;
    log("3) файл из письма:", title, "→", label);
    if (!APPLY) return;
    const buf = readFileSync(path.join(INV, "mail-attachments", rel));
    const dirRel = path.join("drive-docs", org);
    mkdirSync(path.join(UPLOAD, dirRel), { recursive: true });
    const stored = path.join(dirRel, `${randomUUID()}.${ext}`);
    writeFileSync(path.join(UPLOAD, stored), buf, { flag: "wx" });
    const dt = new Date(`${docDate}T00:00:00.000Z`);
    const d = await prisma.driveDocument.create({ data: { organizationId: org, driveFileId: `local-${randomUUID()}`, title, docType: docType as never, mimeType: mime, sizeBytes: buf.length, docNumber, docDate: dt, year: dt.getUTCFullYear(), storagePath: stored, storedName: title, storedMime: mime, storedSize: buf.length, storedAt: new Date(), ...link } });
    push({ step: "3", kind: "doc", id: d.id, label: `${title} → ${label}`, source, file: stored });
  };
  const p2 = await prisma.purchase.findFirst({ where: { organizationId: org, number: "З-2026-0002" }, select: { id: true } });
  const p63 = await prisma.purchase.findFirst({ where: { organizationId: org, number: "З-2026-0063" }, select: { id: true } });
  const tz116 = await prisma.productionOrder.findFirst({ where: { organizationId: org, number: "П-2026-0183" }, select: { id: true } });
  const pay37 = await prisma.payment.findFirst({ where: { organizationId: org, amount: "79898902", docRef: { contains: "№37" } }, select: { id: true } });
  const pdf = "application/pdf";
  const SAGA: [string, string, string][] = [["0254", "0254-002", "2025-03-12"], ["1470", "1470-001", "2025-03-13"], ["1015", "1015-002", "2025-03-12"], ["0258", "0258-002", "2025-03-12"], ["1019", "1019-002", "2025-03-12"]];
  if (p2) for (const [f, no, dt] of SAGA) await mailDoc(`382/${f}.pdf`, "pdf", pdf, `Инвойс SAGA ${no} (аукцион март 2025).pdf`, "AUCTION_INVOICE", no, dt, { purchaseId: p2.id }, "З-2026-0002", "письмо №382 (12.09.2025, «Закупка SAGA 03-25»), вложение " + f + ".pdf");
  if (pay37) await mailDoc("383/schet-37.pdf", "pdf", pdf, "Счет на оплату № 37 от 05 марта 2025 г.pdf", "PAYMENT_INVOICE", "37", "2025-03-05", { paymentId: pay37.id }, "оплата 79 898 902 (п/п 33980)", "письмо №383 (12.09.2025, «Закупка соболя»), вложение; основание оплаты — счёт №37 по реестру");
  if (p63) await mailDoc("101/invoice-01-2026.docx", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Invoice Nr 1-2026 от 06.08.2026 (WELLFUR → YUSUFOGULLARI).docx", "AUCTION_INVOICE", "1-2026", "2026-08-06", { purchaseId: p63.id }, "З-2026-0063", "письмо №101 (07.08.2026), вложение invoice 01-2026.docx");
  if (tz116) await mailDoc("138/prilozhenie-116.docx", "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "ПРИЛОЖЕНИЕ 116.docx", "TZ_APPENDIX", "116", "2026-05-07", { productionOrderId: tz116.id }, "ТЗ 116 (П-2026-0183)", "письмо №138 (06.07.2026, Василий), вложение «ПРИЛОЖЕНИЕ 116»");

  // (4) подтверждение строк без замечаний
  const { loadVerifyModel } = await import("../src/lib/verification");
  const m = await loadVerifyModel(prisma as never, org, { c4Mode: "off" });
  const OWNER_TZ = new Set(["97", "104", "116", "117", "118"]); // решения владельца: бобр, дата ТЗ 118, ТЗ вне партий
  const note = `Подтверждено по результатам проверки приложения (${new Date().toISOString().slice(0, 10)}): замечаний нет — документы, суммы, количества и даты сошлись.`;
  let n = 0;
  for (const r of m.rows) {
    if (r.verified || !r.ready) continue;
    if (r.kind === "order" && OWNER_TZ.has(r.title.replace(/^ТЗ\s+/, ""))) { log("  пропуск (решение владельца):", r.title); continue; }
    if (r.kind === "payment" && r.title.includes("927 500")) { log("  пропуск (сумма п/п в акте 2 081 387,54 против 2 075 122,54, К2):", r.title); continue; }
    n++;
    log("4) подтвердить", r.kind, r.title, "|", r.sub?.slice(0, 60));
    if (!APPLY) continue;
    const stamp = { verifiedAt: new Date(), verifiedBy: BASIS, verifyNote: note };
    if (r.kind === "order") await prisma.productionOrder.update({ where: { id: r.id }, data: stamp });
    else if (r.kind === "purchase") await prisma.purchase.update({ where: { id: r.id }, data: stamp });
    else if (r.kind === "batch") await prisma.productionBatch.update({ where: { id: r.id }, data: stamp });
    else if (r.kind === "payment") await prisma.payment.update({ where: { id: r.id }, data: { confirmed: true, confirmedAt: stamp.verifiedAt, confirmedBy: BASIS } });
    else await prisma.productionPayment.update({ where: { id: r.id }, data: { confirmed: true, confirmedAt: stamp.verifiedAt, confirmedBy: BASIS } });
    push({ step: "4", kind: "verify", id: r.id, label: `${r.kind} ${r.title}`, before: { entity: r.kind, verifiedAt: null, verifiedBy: null, verifyNote: null }, after: stamp, source: "computeReadiness без замечаний" });
  }
  log(`подтверждено: ${n}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
