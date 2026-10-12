/**
 * Чистка справочника поставщиков: «поставщик у нас один — ООО «Веллмех»» (владелец, 12.10.2026).
 * Аудит: docs-inventory/suppliers-audit-2026-10-12.md. Закупки/платежи без поставщика невозможны (Purchase.supplierId и
 * Payment.supplierId обязательны), лоты без закупки в БД отсутствуют — скрипт делает только то, что однозначно:
 *   (а) сливает дубли написаний «Веллмех/ВеллМех/Wellmech/ООО Веллмех» в одну запись (закупки, платежи, документы переезжают,
 *       дубль удаляется); любой ДРУГОЙ поставщик (не Веллмех) не трогается, а только перечисляется;
 *   (б) закупки/платежи, привязанные к НЕ-Веллмех поставщику, — только перечисляются (нужно решение владельца);
 *   (в) лоты без закупки — только перечисляются (сейчас их нет);
 *   (г) НЕОБЯЗАТЕЛЬНО (--with-docs): документы Drive без поставщика, у которых «Веллмех/Wellmech» в названии файла
 *       (договор, спецификация, счёт) — проставить supplierId = Веллмех. Влияет на «Документы → покрытие» (раздел документов
 *       поставщика), на цифры Главной/долга/сверки НЕ влияет. По умолчанию (г) только показывается.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/fix-suppliers.ts                 # пробный прогон
 *   node --env-file=.env node_modules/.bin/tsx scripts/fix-suppliers.ts --apply [--with-docs]
 *   node --env-file=.env node_modules/.bin/tsx scripts/fix-suppliers.ts --rollback --apply   # по журналу
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-suppliers.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const WITH_DOCS = args.includes("--with-docs");
const WM_RE = /ве[лl]{1,2}[мm]е?[хx]|we[l]{1,2}[mn]e?[ck]h/i;
const CANON = "ООО «Веллмех»";

type SupRow = Record<string, unknown> & { id: string; name: string };
type Journal = {
  time: string;
  canonicalId: string;
  merged: { supplier: SupRow; purchaseIds: string[]; paymentIds: string[]; docIds: string[] }[];
  docIds: string[];
  rolledBack?: string;
};

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    if (ROLLBACK) {
      if (!existsSync(JOURNAL)) { console.log("Нечего откатывать (журнала нет)"); return; }
      const j = JSON.parse(readFileSync(JOURNAL, "utf-8")) as Journal;
      if (j.rolledBack) { console.log("Уже откачено"); return; }
      console.log(`Откат: вернуть ${j.merged.length} удалённых поставщиков, документов с проставленным поставщиком: ${j.docIds.length}`);
      if (!APPLY) { console.log("Пробный прогон отката (добавьте --apply)"); return; }
      await prisma.$transaction(async (tx) => {
        await tx.driveDocument.updateMany({ where: { id: { in: j.docIds } }, data: { supplierId: null } });
        for (const m of j.merged) {
          await tx.supplier.create({ data: m.supplier as never });
          await tx.purchase.updateMany({ where: { id: { in: m.purchaseIds } }, data: { supplierId: m.supplier.id } });
          await tx.payment.updateMany({ where: { id: { in: m.paymentIds } }, data: { supplierId: m.supplier.id } });
          await tx.driveDocument.updateMany({ where: { id: { in: m.docIds } }, data: { supplierId: m.supplier.id } });
        }
      });
      j.rolledBack = new Date().toISOString();
      writeFileSync(JOURNAL, JSON.stringify(j, null, 1));
      console.log("Откачено");
      return;
    }

    const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!org) throw new Error("нет организации");
    if (existsSync(JOURNAL) && !(JSON.parse(readFileSync(JOURNAL, "utf-8")) as Journal).rolledBack) {
      console.log("Журнал уже есть и не откачен — повторное применение запрещено (сначала --rollback --apply)"); return;
    }
    const sups = await prisma.supplier.findMany({
      where: { organizationId: org.id },
      include: { _count: { select: { purchases: true, payments: true, driveDocuments: true } } },
    });
    console.log("Справочник поставщиков:");
    for (const s of sups) console.log(`  ${s.id}  «${s.name}»  закупок ${s._count.purchases}, платежей ${s._count.payments}, документов ${s._count.driveDocuments}`);

    const wm = sups.filter((s) => WM_RE.test(s.name));
    const other = sups.filter((s) => !WM_RE.test(s.name));
    if (!wm.length) throw new Error("нет поставщика Веллмех — нечего сливать");
    const canon = wm.find((s) => s.name === CANON) ?? [...wm].sort((a, b) => b._count.purchases - a._count.purchases)[0];
    const dups = wm.filter((s) => s.id !== canon.id);
    console.log(`\nОсновная запись: «${canon.name}» (${canon.id})`);

    // (а) дубли написаний
    console.log(`(а) дублей написания Веллмех: ${dups.length}`);
    for (const d of dups) console.log(`    «${d.name}»: закупок ${d._count.purchases}, платежей ${d._count.payments}, документов ${d._count.driveDocuments} -> в «${canon.name}»`);

    // (б) прочие поставщики
    const otherUse = other.filter((s) => s._count.purchases + s._count.payments + s._count.driveDocuments > 0);
    console.log(`(б) поставщиков НЕ Веллмех с записями (не трогаю, нужно решение владельца): ${otherUse.length}`);
    for (const s of otherUse) console.log(`    «${s.name}»: закупок ${s._count.purchases}, платежей ${s._count.payments}, документов ${s._count.driveDocuments}`);
    const unused = other.filter((s) => !otherUse.includes(s));
    if (unused.length) console.log(`    без записей (в фильтре не видны): ${unused.map((s) => `«${s.name}»`).join(", ")}`);

    // (в) лоты без закупки
    const orphanLots = await prisma.rawMaterialLot.findMany({ where: { organizationId: org.id, purchaseId: null }, select: { id: true, lotNumber: true, totalCost: true } });
    console.log(`(в) лотов без закупки: ${orphanLots.length}${orphanLots.length ? " — только список, поставщик по лоту однозначно не определяется:" : ""}`);
    for (const l of orphanLots) console.log(`    ${l.id} №${l.lotNumber ?? "—"} ${l.totalCost}`);

    // (г) документы Drive без поставщика с «Веллмех» в названии
    const noSup = await prisma.driveDocument.findMany({ where: { organizationId: org.id, supplierId: null }, select: { id: true, title: true, docType: true } });
    const docs = noSup.filter((d) => WM_RE.test(d.title));
    const byType = new Map<string, number>();
    for (const d of docs) byType.set(d.docType, (byType.get(d.docType) ?? 0) + 1);
    console.log(`(г) документов Drive без поставщика с «Веллмех» в названии: ${docs.length} (${[...byType].map(([k, v]) => `${k} ${v}`).join(", ")})${WITH_DOCS ? "" : " — будут проставлены только с флагом --with-docs"}`);

    const willDocs = WITH_DOCS ? docs : [];
    const nothing = !dups.length && !willDocs.length;
    console.log("\nВлияние на цифры: суммы закупок/платежей/лотов не меняются (меняется только ссылка supplierId); Главная, долг и сверка не затрагиваются.");
    if (nothing) { console.log(APPLY ? "Менять нечего." : "Пробный прогон: менять нечего (дублей нет" + (docs.length ? "; документы (г) — с --with-docs" : "") + ")."); return; }
    if (!APPLY) { console.log("Пробный прогон: ничего не записано."); return; }

    const journal: Journal = { time: new Date().toISOString(), canonicalId: canon.id, merged: [], docIds: willDocs.map((d) => d.id) };
    for (const d of dups) {
      const [pu, pa, dd] = await Promise.all([
        prisma.purchase.findMany({ where: { supplierId: d.id }, select: { id: true } }),
        prisma.payment.findMany({ where: { supplierId: d.id }, select: { id: true } }),
        prisma.driveDocument.findMany({ where: { supplierId: d.id }, select: { id: true } }),
      ]);
      const { _count, ...row } = d; void _count;
      journal.merged.push({ supplier: JSON.parse(JSON.stringify(row)) as SupRow, purchaseIds: pu.map((x) => x.id), paymentIds: pa.map((x) => x.id), docIds: dd.map((x) => x.id) });
    }
    writeFileSync(JOURNAL, JSON.stringify(journal, null, 1)); // журнал — до изменений
    await prisma.$transaction(async (tx) => {
      for (const m of journal.merged) {
        await tx.purchase.updateMany({ where: { id: { in: m.purchaseIds } }, data: { supplierId: canon.id } });
        await tx.payment.updateMany({ where: { id: { in: m.paymentIds } }, data: { supplierId: canon.id } });
        await tx.driveDocument.updateMany({ where: { id: { in: m.docIds } }, data: { supplierId: canon.id } });
        await tx.supplier.delete({ where: { id: m.supplier.id } });
      }
      await tx.driveDocument.updateMany({ where: { id: { in: journal.docIds } }, data: { supplierId: canon.id } });
    });
    console.log("Готово");
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
