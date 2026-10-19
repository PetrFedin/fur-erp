// Цепочка готовой продукции: Произведено → ГП на складе ателье → Отгружено/Принято → Приход в рознице → Продано → Остаток в рознице (src/lib/finished-chain.ts).
// Часть 1 — чистые функции (без БД); часть 2 — реальные данные (только чтение), если база доступна.
//   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-finished-chain.ts
import "./stubs/server-only-shim";
import { closeByAcceptance, finishedChain } from "../src/lib/finished-chain";

let fails = 0, checks = 0;
const ok = (what: string, c: boolean) => { checks++; if (!c) { fails++; console.log(`  ✗ ${what}`); } };

(async () => {
  const c = finishedChain({ produced: 100, shipped: 70, accepted: 60, storeReceived: 60, sold: 20 });
  ok("ГП на складе ателье = произведено − отгружено", c.atAtelier === 30);
  ok("в пути = отгружено − принято", c.inTransit === 10);
  ok("остаток в рознице = приход − продано", c.storeStock === 40);
  ok("без расхождений — без замечаний", c.notes.length === 0 && c.receivedVsAccepted === 0);
  const d = finishedChain({ produced: 50, shipped: 71, accepted: 71, storeReceived: 60, sold: 70 });
  ok("отгружено > произведено: ГП = 0 и замечание", d.atAtelier === 0 && d.notes.some((n) => n.code === "shipped-gt-produced"));
  ok("приход ≠ принято: замечание с разницей", d.notes.some((n) => n.code === "store-ne-accepted") && d.receivedVsAccepted === -11);
  ok("продано > прихода: замечание", d.notes.some((n) => n.code === "sold-gt-received") && d.storeStock === -10);
  ok("принято > отгружено: замечание", finishedChain({ produced: 5, shipped: 3, accepted: 4, storeReceived: 4, sold: 0 }).notes.some((n) => n.code === "accepted-gt-shipped"));
  // закрытие ТЗ по приёмке
  const base = { number: "16", status: "IN_PROGRESS", planned: 71, accepted: 71, returned: 0, shippedNotAccepted: 0 };
  ok("принято = плану → закрыть, выпуск = принято", closeByAcceptance(base).verdict === "close" && closeByAcceptance(base).produced === 71);
  ok("принято < плана → ждать", closeByAcceptance({ ...base, accepted: 50 }).verdict === "wait");
  ok("есть возвраты → решение владельца", closeByAcceptance({ ...base, returned: 2 }).verdict === "wait");
  ok("уже завершено → пропуск", closeByAcceptance({ ...base, status: "COMPLETED" }).verdict === "skip");
  ok("нет приёмки → пропуск", closeByAcceptance({ ...base, accepted: 0 }).verdict === "skip");

  if (process.env.DATABASE_URL) {
    try {
      const { prisma } = await import("../src/lib/prisma");
      const org = (await prisma.organization.findFirst({ select: { id: true } }))?.id;
      if (org) {
        const { loadFinishedChain } = await import("../src/lib/finished-chain-server");
        const { chain, inWork, closeCandidates } = await loadFinishedChain(org);
        ok("реальные данные: ГП = max(0, произведено − отгружено)", chain.atAtelier === Math.max(0, chain.produced - chain.shipped));
        ok("реальные данные: остаток в рознице = приход − продано", chain.storeStock === chain.storeReceived - chain.sold);
        console.log(`Произведено ${chain.produced} (+ в работе ${inWork}) → ГП на складе ${chain.atAtelier} → отгружено ${chain.shipped}, принято ${chain.accepted}, в пути ${chain.inTransit} → приход в рознице ${chain.storeReceived} → продано ${chain.sold} → остаток ${chain.storeStock}`);
        for (const n of chain.notes) console.log("  замечание:", n.text);
        for (const v of closeCandidates) console.log(`  ТЗ ${v.number}: ${v.verdict === "close" ? "ЗАКРЫТЬ" : "ждать"} — ${v.reason}`);
        await prisma.$disconnect();
      }
    } catch (e) { console.log("(часть 2 пропущена: база недоступна)", String(e).slice(0, 120)); }
  }
  console.log(`\nЦепочка ГП: проверок ${checks}, расхождений ${fails}`);
  process.exit(fails ? 1 : 0);
})();
