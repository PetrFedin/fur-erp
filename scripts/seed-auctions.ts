/**
 * Справочник аукционов: предложения коротких имён и привязка Purchase.auctionId.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed-auctions.ts            # пробный прогон (в базу ничего не пишет)
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed-auctions.ts --apply    # применить (после scripts/backup.sh)
 *   node --env-file=.env node_modules/.bin/tsx scripts/seed-auctions.ts --rollback # откат по журналу
 *
 * Создаёт Auction (confirmed=false) из scripts/auction-seed-data.ts и ставит Purchase.auctionId по прежнему написанию
 * (aliases) либо по номерам закупок. Purchase.auctionSession, оплаты и документы НЕ меняются: показываемые имена меняются
 * только после подтверждения владельцем (переименование на /settings/auctions обновляет все тексты в одной транзакции).
 * Идемпотентен: существующий аукцион с тем же именем пропускается, закупки с уже заданным auctionId не трогаются.
 * Журнал: docs-inventory/corrections-journal-auctions.json
 */
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { INV, readJson, writeJson } from "./detail-common";
import { SEED_AUCTIONS } from "./auction-seed-data";
import { auctionKey, firstLine } from "../src/lib/auction-key";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const JOURNAL = join(INV, "corrections-journal-auctions.json");

type Change = { kind: "create-auction"; id: string; name: string } | { kind: "set-aliases"; id: string; name: string; old: string[]; new: string[] } | { kind: "set-auction"; purchaseId: string; number: string; old: string | null; new: string };

async function rollback() {
  const j = readJson<{ changes: Change[] }>(JOURNAL, { changes: [] });
  let done = 0;
  let skipped = 0;
  for (const c of [...j.changes].reverse()) {
    if (c.kind === "set-aliases") {
      const cur = await prisma.auction.findUnique({ where: { id: c.id }, select: { aliases: true } });
      if (!cur || cur.aliases.join("\u0001") !== c.new.join("\u0001")) { skipped++; continue; }
      await prisma.auction.update({ where: { id: c.id }, data: { aliases: c.old } });
      done++;
    } else if (c.kind === "set-auction") {
      const cur = await prisma.purchase.findUnique({ where: { id: c.purchaseId }, select: { auctionId: true } });
      if (!cur || cur.auctionId !== c.new) { skipped++; continue; }
      await prisma.purchase.update({ where: { id: c.purchaseId }, data: { auctionId: c.old } });
      done++;
    } else {
      const a = await prisma.auction.findUnique({ where: { id: c.id }, include: { _count: { select: { purchases: true } } } });
      if (!a) continue;
      if (a._count.purchases > 0) { skipped++; console.log(`  «${a.name}» оставлен: на него ссылаются ${a._count.purchases} закупок`); continue; }
      await prisma.auction.delete({ where: { id: c.id } });
      done++;
    }
  }
  console.log(`Откат: ${done} шагов, пропущено ${skipped}`);
  writeJson(JOURNAL, { script: "seed-auctions.ts", rolledBackAt: new Date().toISOString(), changes: [] });
}

async function main() {
  if (ROLLBACK) return rollback();
  const orgs = await prisma.organization.findMany();
  const plannedCreates: Array<{ organizationId: string; data: Parameters<typeof prisma.auction.create>[0]["data"] }> = [];
  const aliasFixes: Array<{ id: string; name: string; old: string[]; new: string[] }> = [];
  const links: Array<{ org: string; auctionName: string; purchaseId: string; number: string; text: string | null }> = [];
  const summary: string[] = [];
  for (const org of orgs) {
    const existing = await prisma.auction.findMany({ where: { organizationId: org.id } });
    const purchases = await prisma.purchase.findMany({
      where: { organizationId: org.id },
      select: { id: true, number: true, auctionSession: true, auctionId: true, currency: true },
    });
    const claimed = new Set<string>();
    let order = 0;
    for (const s of SEED_AUCTIONS) {
      order++;
      const mineKeys = new Set(s.aliases.map(auctionKey));
      const mine = purchases.filter((p) => (s.purchaseNumbers ? s.purchaseNumbers.includes(p.number) : mineKeys.has(auctionKey(p.auctionSession))));
      const have = existing.find((a) => auctionKey(a.name) === auctionKey(s.name));
      const currencies = [...new Set(mine.map((p) => p.currency))];
      if (!have) {
        plannedCreates.push({
          organizationId: org.id,
          data: {
            organizationId: org.id, name: s.name, fullName: s.fullName, house: s.house, kind: s.kind, year: s.year, month: s.month,
            auctionDate: s.auctionDate ? new Date(`${s.auctionDate}T00:00:00.000Z`) : null,
            currency: currencies.length === 1 ? currencies[0] : currencies.length > 1 ? currencies.join("/") : null,
            aliases: s.aliases.filter((a) => a !== s.name), isService: !!s.isService, confirmed: false, sortOrder: order, note: s.note,
          },
        });
      }
      if (have) {
        const missing = s.aliases.filter((a) => a !== have.name && !have.aliases.includes(a));
        if (missing.length) aliasFixes.push({ id: have.id, name: have.name, old: have.aliases, new: [...have.aliases, ...missing] });
      }
      for (const p of mine) {
        if (claimed.has(p.id)) continue;
        claimed.add(p.id);
        if (p.auctionId && have && p.auctionId === have.id) continue;
        if (p.auctionId) continue; // уже привязана руками — не трогаем
        links.push({ org: org.id, auctionName: s.name, purchaseId: p.id, number: p.number, text: p.auctionSession });
      }
      summary.push(`${(s.aliases.join(" + ") || "(по номерам: " + (s.purchaseNumbers ?? []).join(", ") + ")").padEnd(34)} → ${s.name.padEnd(30)} закупок: ${mine.length}${have ? " (аукцион уже есть)" : ""}`);
    }
    const left = purchases.filter((p) => firstLine(p.auctionSession) && !claimed.has(p.id) && !p.auctionId);
    if (left.length) console.log(`Без аукциона в справочнике (${left.length}):`, [...new Set(left.map((p) => p.auctionSession))].join("; "));
  }
  console.log(APPLY ? "== APPLY ==" : "== DRY-RUN (в базу ничего не записано) ==");
  console.log(summary.join("\n"));
  console.log(`Будет создано аукционов: ${plannedCreates.length}, привязок закупок: ${links.length}, дописано прежних написаний: ${aliasFixes.length}`);
  if (!APPLY) return;

  const prev = readJson<{ changes: Change[] }>(JOURNAL, { changes: [] });
  const applied: Change[] = [];
  const flush = () => writeJson(JOURNAL, { script: "seed-auctions.ts", appliedAt: new Date().toISOString(), changes: [...prev.changes, ...applied] });
  for (const c of plannedCreates) {
    const row = await prisma.auction.create({ data: c.data });
    applied.push({ kind: "create-auction", id: row.id, name: row.name });
    flush();
  }
  for (const f of aliasFixes) {
    await prisma.auction.update({ where: { id: f.id }, data: { aliases: f.new } });
    applied.push({ kind: "set-aliases", ...f });
  }
  for (const l of links) {
    const a = await prisma.auction.findFirst({ where: { organizationId: l.org, name: l.auctionName } });
    if (!a) continue;
    await prisma.purchase.update({ where: { id: l.purchaseId }, data: { auctionId: a.id } });
    applied.push({ kind: "set-auction", purchaseId: l.purchaseId, number: l.number, old: null, new: a.id });
  }
  flush();
  console.log(`Применено: создано ${plannedCreates.length}, привязок ${links.length}. Журнал: ${JOURNAL}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
