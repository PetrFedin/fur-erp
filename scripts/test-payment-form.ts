/**
 * Проверка ЕДИНОЙ формы оплаты (savePayment / quotePaymentTarget / getPaymentTargets) на КОПИИ БД.
 * Отказывается работать, если в адресе нет «wiz_test». Запуск — как у scripts/test-tz-import.ts (WIZ_TEST_URL).
 */
import Module from "module";
import { join } from "path";

const url = process.env.WIZ_TEST_URL ?? "";
if (!url.includes("wiz_test")) {
  console.error("Задайте WIZ_TEST_URL на scratch-базу (имя содержит wiz_test).");
  process.exit(2);
}
process.env.DATABASE_URL = url;
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
const stub = (n: string) => join(__dirname, "stubs", n);
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return stub("empty.js");
  if (req === "next/cache") return stub("next-cache.js");
  if (req === "next/navigation") return stub("next-navigation.js");
  if (req === "@/lib/session") return stub("session-stub.js");
  return orig.call(this, req, ...rest);
};
type G = { __TEST_SESSION?: unknown };
const as = (role: string, organizationId: string, id = "u-test") => {
  (globalThis as G).__TEST_SESSION = { user: { id, role, organizationId, name: "Тест" } };
};
let fails = 0;
const ok = (c: unknown, m: string) => {
  console.log(`${c ? "ok  " : "FAIL"} ${m}`);
  if (!c) fails++;
};
const PDF = () => new File([new Uint8Array(Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF", "latin1"))], "п-п 43831.pdf");
const PDF2 = (name: string) => new File([new Uint8Array(Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF", "latin1"))], name);
const fd = (o: Record<string, string | string[]>, files: [File, string][] = []) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  for (const [file, role] of files) {
    f.append("files", file);
    f.append("fileRoles", role);
  }
  return f;
};

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const raw = new PrismaClient({ datasources: { db: { url } } });
  const P = await import("../src/app/(app)/payments/pay-actions");
  const core = await import("../src/lib/payment-form-core");
  const { loadAuctionSummaries } = await import("../src/lib/auction-payments");
  const { loadSupplierDebt } = await import("../src/lib/supplier-debt");

  // ---- чистые правила
  ok(core.percentAmount(1000, 30) === 300 && core.percentAmount(333.33, 50) === 166.67, "кнопки %: 30% от 1000 = 300");
  ok(core.guessDocRole("п-п 43831.pdf") === "PAYMENT_PROOF" && core.guessDocRole("Счёт на оплату 12.pdf") === "PAYMENT_INVOICE" && core.guessDocRole("Письмо согласование.docx") === "APPROVAL_EMAIL", "тип документа по имени файла");
  ok(!core.canConfirm({ hasProofFile: false, ppNo: "", paidAt: "2026-10-01", amount: 5 }) && core.canConfirm({ hasProofFile: false, ppNo: "123", paidAt: "2026-10-01", amount: 5 }) && core.canConfirm({ hasProofFile: true, ppNo: "", paidAt: "", amount: 0 }), "правило «подтверждено»");
  ok(core.docRefOf("43831", "2026-10-01") === "п/п № 43831 от 01.10.2026", "строка основания п/п");

  const org = (await raw.organization.findFirstOrThrow()).id;
  const user = await raw.user.findFirstOrThrow({ where: { organizationId: org, role: "OWNER" } });
  as("OWNER", org, user.id);

  const targets = await P.getPaymentTargets();
  ok(targets.auctions.length > 0 && targets.batches.length > 0 && targets.orders.length > 0, `цели загружены: аукционов ${targets.auctions.length}, партий ${targets.batches.length}, ТЗ ${targets.orders.length}`);
  const auc = targets.auctions.find((a) => a.remaining > 1000)!;
  const q = await P.quotePaymentTarget({ side: "supplier", auction: auc.name });
  const [sum] = await loadAuctionSummaries(raw, org, [auc.name]);
  ok(q.total === Number(sum.total.toFixed(2)) && q.remaining === Number(sum.remaining.toFixed(2)), "сумма/оплачено/остаток аукциона = loadAuctionSummaries");

  const debt0 = Number((await loadSupplierDebt(raw, org)).debt.toFixed(2));
  const payCount0 = await raw.payment.count();
  const base = { side: "supplier", auction: auc.name, kind: "INVOICE", mode: "amount", amount: "1000", paidAt: "2026-10-01", method: "BANK_TRANSFER", note: "тест" };

  // 1) % от суммы + платёжка + счёт + письмо
  const r1 = await P.savePayment(fd({ ...base, kind: "PERCENT", mode: "percent", percent: "30", ppNo: "43831" }, [[PDF(), "PAYMENT_PROOF"], [PDF2("Счёт на оплату 5.pdf"), "PAYMENT_INVOICE"], [PDF2("письмо.pdf"), "APPROVAL_EMAIL"]]));
  ok(!!r1.ok, `оплата 30% записана: ${r1.error ?? ""}`);
  const p1 = await raw.payment.findUniqueOrThrow({ where: { id: r1.paymentId! }, include: { driveDocuments: true } });
  ok(Math.abs(Number(p1.amount) - Math.round(Number(sum.total) * 30) / 100) < 0.011 && Number(p1.percent) === 30, "сумма = 30% от стоимости аукциона");
  ok(!!p1.documentId && p1.confirmed && p1.docRef === "п/п № 43831 от 01.10.2026", "платёжка привязана, п/п записан");
  ok(p1.driveDocuments.map((d) => d.docType).sort().join() === "APPROVAL_EMAIL,PAYMENT_INVOICE", "счёт и письмо сохранены как документы оплаты");
  ok(!p1.confirmedAt && /Вид: процент от суммы/.test(p1.notes ?? ""), "без отметки — не подтверждено человеком; вид сохранён в пометке");
  ok(r1.recalc!.remainingAfter === Number((Number(sum.remaining) - Number(p1.amount)).toFixed(2)) && r1.recalc!.debtAfter != null && r1.recalc!.debtAfter < debt0, "«что пересчиталось»: остаток аукциона и долг уменьшились");

  // 2) дубль -> подтверждение
  const dupFd = () => fd({ ...base, kind: "PERCENT", mode: "percent", percent: "30", ppNo: "43831" });
  const rd = await P.savePayment(dupFd());
  ok(!!rd.confirm && /двойная отправка/.test(rd.confirm), "повтор той же оплаты за 2 минуты -> запрос подтверждения");
  ok((await raw.payment.count()) === payCount0 + 1, "дубль не записан");

  // 3) подтверждено: без основания нельзя, с п/п — можно
  const r3a = await P.savePayment(fd({ ...base, amount: "777", markConfirmed: "1" }));
  ok(!!r3a.error && /подтверждено/i.test(r3a.error), "«подтверждено» без платёжки/п/п отклонено");
  const r3b = await P.savePayment(fd({ ...base, amount: "778", markConfirmed: "1", ppNo: "555" }));
  const p3 = r3b.paymentId ? await raw.payment.findUniqueOrThrow({ where: { id: r3b.paymentId } }) : null;
  ok(!!p3?.confirmedAt && p3.confirmedBy === user.id && p3.confirmed, "с п/п + датой + суммой: подтверждено, кто и когда");
  const r3c = await P.savePayment(fd({ ...base, amount: "779" }, [[PDF2("письмо согласование.pdf"), "APPROVAL_EMAIL"]]));
  const p3c = await raw.payment.findUniqueOrThrow({ where: { id: r3c.paymentId! } });
  ok(!p3c.confirmed && !p3c.documentId && r3c.recalc!.tasks.some((t) => /согласовано/.test(t)), "письмо-согласование не подтверждает оплату");

  // 4) переплата -> подтверждение, возврат, «Другое»
  const rOver = await P.savePayment(fd({ ...base, amount: String(Number(sum.total) * 3) }));
  ok(!!rOver.confirm && /переплата/.test(rOver.confirm), "переплата запрашивает подтверждение");
  const rOther = await P.savePayment(fd({ ...base, kind: "OTHER", note: "" }));
  ok(!!rOther.error && /пометку/.test(rOther.error), "«Другое» без пометки отклонено");
  const remBefore = (await P.quotePaymentTarget({ side: "supplier", auction: auc.name })).remaining!;
  const rRef = await P.savePayment(fd({ ...base, kind: "REFUND", amount: "500", note: "возврат излишка" }));
  const pRef = await raw.payment.findUniqueOrThrow({ where: { id: rRef.paymentId! } });
  ok(Number(pRef.amount) === -500 && (await P.quotePaymentTarget({ side: "supplier", auction: auc.name })).remaining === Number((remBefore + 500).toFixed(2)), "возврат: запись с минусом, остаток вырос на 500");

  // 5) аванс без привязки
  const sup = targets.suppliers[0];
  const rAdv = await P.savePayment(fd({ side: "supplier", supplierId: sup.id, kind: "ADVANCE", mode: "amount", amount: "10000", paidAt: "2026-10-01", method: "BANK_TRANSFER", note: "", allocateLater: "1" }));
  const pAdv = await raw.payment.findUniqueOrThrow({ where: { id: rAdv.paymentId! } });
  ok(!pAdv.auctionSession && !pAdv.purchaseId && /разнести позже/.test(pAdv.notes ?? "") && pAdv.kind === "ADVANCE", "аванс без привязки с пометкой «разнести позже»");
  const rAdv2 = await P.savePayment(fd({ side: "supplier", supplierId: sup.id, kind: "INVOICE", mode: "amount", amount: "1", paidAt: "2026-10-01", method: "BANK_TRANSFER", note: "" }));
  ok(!!rAdv2.error, "без аукциона/закупки — только аванс");

  // 6) закупка вне аукциона
  const pur = targets.purchases.find((p) => p.remaining > 100);
  if (pur) {
    const rp = await P.savePayment(fd({ side: "supplier", purchaseId: pur.id, kind: "FINAL", mode: "rest", paidAt: "2026-10-01", method: "BANK_TRANSFER", note: "", ppNo: "9001" }));
    const pp = await raw.payment.findUniqueOrThrow({ where: { id: rp.paymentId! } });
    ok(!!rp.ok && pp.purchaseId === pur.id && Math.abs(Number(pp.amount) - pur.remaining) < 0.011 && rp.recalc!.remainingAfter === 0, "закупка: «остаток» закрывает остаток до нуля");
  }

  // 7) по работе: партия 50% и ТЗ
  const bt = targets.batches.find((b) => b.orders >= 1)!;
  const qw = await P.quotePaymentTarget({ side: "work", batchId: bt.id });
  ok(!qw.error && qw.total != null, `партия: работа ${qw.total}, оплачено ${qw.paid}, остаток ${qw.remaining}`);
  if (qw.total && qw.total > 0) {
    const w1 = await P.savePayment(fd({ side: "work", batchId: bt.id, kind: "PERCENT", mode: "percent", percent: "50", paidAt: "2026-10-01", method: "BANK_TRANSFER", note: "", ppNo: "7001" }, [[PDF(), "PAYMENT_PROOF"]]));
    const pw = w1.paymentId ? await raw.productionPayment.findUniqueOrThrow({ where: { id: w1.paymentId }, include: { orders: true, driveDocuments: true } }) : null;
    const live = await raw.productionOrder.count({ where: { batchId: bt.id, status: { not: "CANCELLED" } } });
    ok(!!w1.ok && pw!.orders.length === live && pw!.confirmed && pw!.driveDocuments.length === 1, `оплата работы по партии: ${live} ТЗ, платёжка приложена (${w1.error ?? ""})`);
    ok(Math.abs(Number(pw!.amount) - Math.round(qw.total * 50) / 100) < 0.011 && w1.recalc!.remainingAfter === Number((qw.remaining! - Number(pw!.amount)).toFixed(2)), "50% от работы партии; остаток пересчитан");
  }
  const noOrder = await P.savePayment(fd({ side: "work", kind: "ADVANCE", mode: "amount", amount: "10", paidAt: "2026-10-01", method: "BANK_TRANSFER", note: "" }));
  ok(!!noOrder.error, "работа без выбранных ТЗ/партии отклонена");
  const rf = await P.savePayment(fd({ side: "work", batchId: bt.id, kind: "REFUND", mode: "amount", amount: "10", paidAt: "2026-10-01", note: "x" }));
  ok(!!rf.error, "возврат в оплатах по работе не поддерживается");

  // 8) права и организация
  as("PURCHASER", org, user.id);
  const wDenied = await P.savePayment(fd({ side: "work", batchId: bt.id, kind: "ADVANCE", mode: "amount", amount: "10", paidAt: "2026-10-01" }));
  ok(!!wDenied.error, "закупщик не вносит оплаты по работе");
  as("TECHNOLOGIST", org, user.id);
  const sDenied = await P.savePayment(fd({ ...base, amount: "11" }));
  ok(!!sDenied.error, "технолог не вносит оплаты поставщику");
  const tl = await P.getPaymentTargets();
  ok(!tl.canSupplier && tl.auctions.length === 0, "технолог не получает список аукционов");
  as("OWNER", "org_other", user.id);
  const foreign = await P.savePayment(fd({ ...base, amount: "12" }));
  ok(!!foreign.error, "чужая организация: аукцион не найден");

  console.log(`долг до ${debt0} → после ${(await loadSupplierDebt(raw, org)).debt.toFixed(2)} (на копии)`);
  console.log(fails ? `\nПРОВАЛЕНО проверок: ${fails}` : "\nВсе проверки пройдены");
  await raw.$disconnect();
  process.exit(fails ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
