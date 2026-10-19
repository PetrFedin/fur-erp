/**
 * ТЗ № 182 («ПРИЛОЖЕНИЕ 182», 26.08.2026) — заводит в кабинете Веллмеха как черновик, чтобы Word получался таким же, как прислал Веллмех.
 * Данные берутся из разбора присланного docx (JSON блоков, ). Без флагов: собирает docx в --out и печатает данные (БД не трогает).
 * --apply: бэкап + запись черновика SupplierInbox (kind TZ, автор — пользователь Веллмеха) + журнал; --rollback --apply — удалить.
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/create-wellmekh-tz182-2026-10-15.ts <присланный.docx> <out.docx> [--apply|--rollback]
 */
import "./stubs/server-only-shim";
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { docxBlocks, layoutDiff, payloadFromDocx, textDiff } from "./lib/tz-docx-import";
import { buildTzDocx } from "../src/lib/tz-docx-vendor";

const APPLY = process.argv.includes("--apply"), ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(__dirname, "..", "docs-inventory", "corrections-journal-wellmekh-tz182-2026-10-15.json");
async function main() {
  const [origPath, outPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const origBuf = readFileSync(origPath); // присланный Word (.docx)
  const p = await payloadFromDocx(origBuf);
  const gen = await buildTzDocx(p);
  writeFileSync(outPath, gen);
  const td = textDiff(await docxBlocks(origBuf), await docxBlocks(gen)), ld = await layoutDiff(origBuf, gen);
  console.log(`текст: расхождений ${td.length}; вёрстка: расхождений ${ld.length}`, [...td, ...ld].slice(0, 20));
  if (td.length || ld.length) throw new Error("Word не совпал с оригиналом — запись отменена");
  writeFileSync(outPath.replace(/\.docx$/, ".payload.json"), JSON.stringify(p, null, 1));
  console.log(`ТЗ ${p.number} от ${p.date}: изделий ${p.items.length}, материалов ${p.materials.length}, срок ${p.terms.deadline}`);
  if (!APPLY && !ROLLBACK) return console.log("пробный прогон: docx собран в", outPath, "(БД не тронута; --apply запишет черновик)");
  const { createAuditedClient } = await import("../src/lib/prisma");
  const prisma = createAuditedClient("script:wellmekh-tz182");
  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as { id: string };
    if (APPLY) await prisma.supplierInbox.delete({ where: { id: j.id } });
    return console.log(APPLY ? "откат выполнен" : "пробный откат");
  }
  const user = await prisma.user.findFirstOrThrow({ where: { email: "wellmekh@demo.local", role: "SUPPLIER" }, select: { id: true, organizationId: true, supplierId: true, name: true } });
  if (!user.supplierId) throw new Error("у пользователя нет поставщика");
  const exists = await prisma.supplierInbox.findFirst({ where: { organizationId: user.organizationId, supplierId: user.supplierId, kind: "TZ", title: { contains: `№ ${p.number}` } } });
  if (exists) return console.log("уже заведено:", exists.id);
  execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
  const row = await prisma.supplierInbox.create({ data: { organizationId: user.organizationId, supplierId: user.supplierId, createdById: user.id, kind: "TZ", status: "DRAFT", title: `ТЗ № ${p.number} от ${p.date.split("-").reverse().join(".")}`, payload: p as never } });
  writeFileSync(JOURNAL, JSON.stringify({ id: row.id }, null, 1));
  console.log("создан черновик", row.id);
}
main().then(() => process.exit(0));
