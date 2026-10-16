/**
 * Проверка справочника аукционов на КОПИИ базы:
 *   createdb fur_scratch_auc; pg_dump fur_erp | psql fur_scratch_auc
 *   SCRATCH_URL=postgresql://…/fur_scratch_auc node --env-file=.env node_modules/.bin/tsx scripts/test-auction-ref.ts
 * Отказывается работать с основной базой.
 * Не зависит от того, применён ли apply-auction-names.ts: число закупок/оплат/документов берётся по текущему состоянию
 * копии (связь auctionId и текущее имя), «неподтверждённость» имени проверяется на копии списка в памяти.
 */
import { PrismaClient } from "@prisma/client";
import {
  AuctionError, createAuctionIn, findAuctionIn, mergeAuctionsIn, renameAuctionIn, loadAuctionOptionsIn, displayAuctionNameIn,
} from "../src/lib/auction-ref-core";
import { auctionKey } from "../src/lib/auction-key";

const url = process.env.SCRATCH_URL;
if (!url || !/scratch/.test(url)) throw new Error("Задайте SCRATCH_URL на scratch-базу (в имени должно быть «scratch»)");
const prisma = new PrismaClient({ datasourceUrl: url });
let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "OK  " : "FAIL"} ${m}`); if (!c) fails++; };
const throwsAuction = async (f: () => Promise<unknown>) => { try { await f(); return false; } catch (e) { return e instanceof AuctionError; } };

async function main() {
  const org = (await prisma.organization.findFirstOrThrow()).id;
  const list0 = await prisma.auction.findMany({ where: { organizationId: org } });
  ok(list0.length >= 20, `в копии ${list0.length} аукционов`);
  ok(findAuctionIn("сп 03-25", list0)?.name === "СП 03.25", "поиск по имени без учёта регистра и разделителя");
  ok(findAuctionIn("Закупка меха 04-26", list0)?.name === "РП 04.26", "поиск по алиасу");
  ok(findAuctionIn("Нет информации", list0)?.name === "Без аукциона", "заглушка → служебный аукцион");
  const unconfirmed0 = list0.map((a) => (a.name === "РП 04.26" ? { ...a, confirmed: false } : a));
  ok(displayAuctionNameIn("Закупка меха 04-26", unconfirmed0, { onlyConfirmed: true }) === "Закупка меха 04-26", "неподтверждённое имя не подменяет текст (onlyConfirmed)");
  ok(displayAuctionNameIn("Закупка меха 04-26", list0, { onlyConfirmed: false }) === "РП 04.26", "displayAuctionName без фильтра подтверждения");

  // --- rename: РП 04.26 (6 закупок, 2 оплаты, текст «Закупка меха 04-26»)
  const rp = list0.find((a) => a.name === "РП 04.26")!;
  const before = {
    p: await prisma.purchase.count({ where: { auctionId: rp.id } }),
    pay: await prisma.payment.count({ where: { auctionSession: { in: [rp.name, ...rp.aliases] } } }),
  };
  const r = await renameAuctionIn(prisma, org, rp.id, "РП Апрель 26");
  ok(r.synced.purchases === before.p && before.p > 0, `rename: закупок обновлено ${r.synced.purchases}`);
  ok(r.synced.payments === before.pay, `rename: оплат обновлено ${r.synced.payments} из ${before.pay}`);
  ok((await prisma.purchase.count({ where: { auctionSession: "РП Апрель 26", auctionId: rp.id } })) === before.p, "у закупок кэш-текст = новое имя");
  ok((await prisma.payment.count({ where: { auctionSession: "РП Апрель 26" } })) === before.pay, "у оплат кэш-текст = новое имя");
  const after = await prisma.auction.findUniqueOrThrow({ where: { id: rp.id } });
  ok(after.aliases.includes("РП 04.26") && after.aliases.includes("Закупка меха 04-26") && after.confirmed, "старые имена в aliases, имя подтверждено");
  const listR = await prisma.auction.findMany({ where: { organizationId: org } });
  ok(findAuctionIn("Закупка меха 04-26", listR)?.id === rp.id, "реестр сверки/поиск находит аукцион по старому написанию после переименования");
  const sp = await prisma.auction.findFirstOrThrow({ where: { name: "СП 03.25" } });
  const spPay = await prisma.payment.count({ where: { auctionSession: "СП 03.25" } });
  // документы партии
  const sp09 = await prisma.auction.findFirstOrThrow({ where: { name: "СП 09.26" } });
  const spDocs = await prisma.purchaseDocument.count({ where: { batch: { in: [sp09.name, ...sp09.aliases] } } });
  const r2 = await renameAuctionIn(prisma, org, sp09.id, "СП Сентябрь 26");
  ok(r2.synced.documents === spDocs && spDocs > 0, `rename: документов партии обновлено ${r2.synced.documents} из ${spDocs}`);
  ok(spPay >= 0, "контрольная оплата СП 03.25 не затронута: " + (await prisma.payment.count({ where: { auctionSession: "СП 03.25" } })));
  ok(await throwsAuction(() => renameAuctionIn(prisma, org, sp.id, "РП Апрель 26")), "rename: имя занято другим аукционом → ошибка");
  ok(await throwsAuction(() => renameAuctionIn(prisma, org, sp.id, "СП 03-26 ".replace("26", "05").replace("05", "25") && "сп 05.25")), "rename: имя совпадает с другим по ключу (регистр/разделитель) → ошибка");
  // возврат имени
  await renameAuctionIn(prisma, org, rp.id, "РП 04.26");
  ok((await prisma.purchase.count({ where: { auctionSession: "РП 04.26", auctionId: rp.id } })) === before.p, "возврат имени работает");

  // --- откат транзакции: ошибка внутри — ничего не изменилось
  const snap = await prisma.purchase.count({ where: { auctionSession: "СП 05.25" } });
  try {
    await prisma.$transaction(async (tx) => {
      await renameAuctionIn(prisma, org, sp.id, "Временное имя"); // отдельная транзакция — не откатится, поэтому проверим отдельно ниже
      throw new Error("boom");
    });
  } catch {}
  await renameAuctionIn(prisma, org, sp.id, "СП 03.25");
  ok((await prisma.purchase.count({ where: { auctionSession: "СП 05.25" } })) === snap, "соседний аукцион не задет");
  const failing = await prisma.$transaction(async (tx) => {
    await tx.auction.update({ where: { id: sp.id }, data: { name: "ОТКАТ-ТЕСТ" } });
    await tx.purchase.updateMany({ where: { auctionId: sp.id }, data: { auctionSession: "ОТКАТ-ТЕСТ" } });
    throw new Error("rollback");
  }).catch(() => "rolled");
  ok(failing === "rolled" && (await prisma.auction.findUniqueOrThrow({ where: { id: sp.id } })).name === "СП 03.25" && (await prisma.purchase.count({ where: { auctionSession: "ОТКАТ-ТЕСТ" } })) === 0, "откат транзакции: имя и тексты не изменились");

  // --- create
  const c = await createAuctionIn(prisma, org, { name: "СП 11.26", house: "Союзпушнина", kind: "FUR", year: 2026, month: 11 });
  ok(c.confirmed && c.name === "СП 11.26", "create: аукцион создан");
  ok(await throwsAuction(() => createAuctionIn(prisma, org, { name: "сп 11.26" })), "create: дубль имени → ошибка");
  ok(await throwsAuction(() => createAuctionIn(prisma, org, { name: "Закупка меха 04-26" })), "create: имя = чужой алиас → ошибка");
  ok(await throwsAuction(() => createAuctionIn(prisma, org, { name: " " })), "create: пустое имя → ошибка");

  // --- merge: СП 11.26 (пустой) ← FH 06.26 (1 закупка) ; затем merge обратно нельзя проверять
  const fh = await prisma.auction.findFirstOrThrow({ where: { name: "FH 06.26" } });
  const m = await mergeAuctionsIn(prisma, org, fh.id, c.id);
  ok(m.moved === 1, `merge: перенесено закупок ${m.moved}`);
  const into = await prisma.auction.findUniqueOrThrow({ where: { id: c.id } });
  ok(into.aliases.includes("FH 06.26") && into.aliases.includes("FH 06-26"), "merge: имя и алиасы from → алиасы into: " + into.aliases.join("; "));
  ok((await prisma.auction.count({ where: { id: fh.id } })) === 0, "merge: from удалён");
  ok((await prisma.purchase.count({ where: { auctionId: c.id, auctionSession: "СП 11.26" } })) === 1, "merge: кэш-текст закупки = имя into");
  ok(await throwsAuction(() => mergeAuctionsIn(prisma, org, c.id, c.id)), "merge с самим собой → ошибка");
  const opts = await loadAuctionOptionsIn(prisma, org);
  const o = opts.find((x) => x.id === c.id)!;
  ok(o.purchaseCount === 1 && o.total >= 0, `options: у «${o.name}» закупок ${o.purchaseCount}, сумма ${o.total}`);
  ok(auctionKey("СП  03.25") === auctionKey("сп 03-25"), "ключ: разделители и регистр");
}

main()
  .catch((e) => { console.error(e); fails++; })
  .finally(async () => { await prisma.$disconnect(); console.log(fails ? `ПРОВАЛЕНО: ${fails}` : "ВСЁ ПРОШЛО"); process.exitCode = fails ? 1 : 0; });
