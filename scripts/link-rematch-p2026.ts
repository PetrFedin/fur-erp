/**
 * Привязка аукционных счетов к ЛОТАМ закупок 2026 (rematch p2026, 07.10.2026).
 * Файлы уже привязаны к закупкам; здесь добавляется привязка к лоту (DriveDocument.lotId), когда в самом счёте лот назван тем же номером
 * и тем же количеством, что RawMaterialLot закупки (exact: номер счёта + номер лота + количество + закупка). Кандидаты —
 * docs-inventory/rematch-p2026-candidates.json (получены чтением «ММ счета.pdf», 2019/2020 ВеллМех (ММ).pdf, 4014 ООО ВеллМех.pdf).
 * Лот 2148 из счёта 4085 (в УПД и БД — 2146) НЕ привязывается: номер не совпал (очередь ручной проверки).
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-rematch-p2026.ts            # dry-run (по умолчанию)
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-rematch-p2026.ts --apply    # перед этим: scripts/backup.sh
 *   node --env-file=.env node_modules/.bin/tsx scripts/link-rematch-p2026.ts --rollback docs-inventory/corrections-journal-p2026.json
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const INV = join(resolve(__dirname, ".."), "docs-inventory");
const JOURNAL = join(INV, "corrections-journal-p2026.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const rb = args.indexOf("--rollback");
const newId = () => "c" + Date.now().toString(36) + randomBytes(9).toString("hex");

type Cand = { fileId: string; docNumber: string; docDate: string; purchase: string; lot: string; qty: number };

async function main() {
  if (rb >= 0) {
    const e = JSON.parse(readFileSync(resolve(args[rb + 1]), "utf-8")) as { id: string; field: string }[];
    const r = await prisma.driveDocument.deleteMany({ where: { id: { in: e.filter((x) => x.field === "__create__").map((x) => x.id) } } });
    console.log("откат: удалено", r.count);
    return;
  }
  const cands: Cand[] = JSON.parse(readFileSync(join(INV, "rematch-p2026-candidates.json"), "utf-8"));
  const files: any[] = readdirSync(INV).filter((f) => /^drive-live-batch-\d+\.json$/.test(f)).flatMap((f) => JSON.parse(readFileSync(join(INV, f), "utf-8")));
  const org = await prisma.organization.findFirstOrThrow();
  const journal: any[] = existsSync(JOURNAL) ? JSON.parse(readFileSync(JOURNAL, "utf-8")) : [];
  let create = 0, exists = 0, skip = 0;
  for (const c of cands) {
    const f = files.find((x) => x.id === c.fileId);
    if (!f) { console.log("нет файла в манифесте", c.fileId); skip++; continue; }
    const lots = await prisma.rawMaterialLot.findMany({ where: { organizationId: org.id, purchase: { number: c.purchase } }, select: { id: true, lotNumber: true, quantityReceived: true } });
    const hit = lots.filter((l) => (l.lotNumber === c.lot || l.lotNumber === "FW26-" + c.lot) && Number(l.quantityReceived) === c.qty);
    if (hit.length !== 1) { console.log(`ПРОПУСК ${c.purchase} лот ${c.lot}: найдено ${hit.length}`); skip++; continue; }
    const lot = hit[0];
    const ex = await prisma.driveDocument.findFirst({ where: { organizationId: org.id, driveFileId: c.fileId, lotId: lot.id } });
    if (ex) { exists++; continue; }
    create++;
    if (!APPLY) continue;
    const id = newId();
    const data = { id, organizationId: org.id, driveFileId: f.id, title: f.title, docType: "AUCTION_INVOICE" as never, mimeType: f.mime_type, sizeBytes: Number(f.size) || null, drivePath: f.path, viewUrl: f.url, docNumber: c.docNumber, docDate: new Date(c.docDate), year: Number(c.docDate.slice(0, 4)), notes: `Счёт аукциона №${c.docNumber}: лот ${c.lot}, ${c.qty} шт (совпали номер лота и количество). Привязка скриптом link-rematch-p2026`, lotId: lot.id };
    await prisma.driveDocument.create({ data });
    journal.push({ time: new Date().toISOString(), entity: "DriveDocument", id, field: "__create__", before: null, after: data, source: `link-rematch-p2026; ${c.purchase}; лот ${c.lot}` });
    writeFileSync(JOURNAL, JSON.stringify(journal, null, 2));
  }
  console.log(`${APPLY ? "ПРИМЕНЕНО" : "DRY-RUN"}: кандидатов ${cands.length}, к созданию/создано ${create}, уже есть ${exists}, пропущено ${skip}`);
}
main().finally(() => prisma.$disconnect());
