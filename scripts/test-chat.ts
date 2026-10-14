/**
 * Чистая логика чата и моста мессенджеров (без базы):
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-chat.ts
 */
import {
  bindCodeValid, canSeeThread, entityHrefFor, externalMsgId, formatForMessenger, isUnread, awaitsMyAnswer, makeBindCode, nextStatus,
  parseCommand, pickRecipients, routeIncoming, safeEntityLabel, stripMoney, type LinkLite,
} from "../src/lib/chat-core";

let fails = 0;
const ok = (c: unknown, m: string) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) fails++; };

// Видимость
const org = "o1";
const sup = { role: "SUPPLIER", organizationId: org, supplierId: "wm" };
ok(canSeeThread(sup, { organizationId: org, supplierId: "wm" }), "поставщик видит свой тред");
ok(!canSeeThread(sup, { organizationId: org, supplierId: "other" }), "поставщик не видит чужой тред");
ok(!canSeeThread(sup, { organizationId: org, supplierId: null }), "поставщик не видит внутренний тред");
ok(!canSeeThread({ ...sup, supplierId: null }, { organizationId: org, supplierId: null }), "поставщик без привязки ничего не видит");
ok(!canSeeThread(sup, { organizationId: "o2", supplierId: "wm" }), "чужая организация закрыта");
for (const r of ["OWNER", "ADMIN", "TECHNOLOGIST", "PURCHASER", "ACCOUNTANT"]) ok(canSeeThread({ role: r, organizationId: org }, { organizationId: org, supplierId: "wm" }), `${r} видит все треды организации`);
ok(!canSeeThread({ role: "WAREHOUSE", organizationId: org }, { organizationId: org, supplierId: "wm" }) && !canSeeThread({ role: "VIEWER", organizationId: org }, { organizationId: org, supplierId: "wm" }), "кладовщик и наблюдатель без чата");

// Статусы запроса
const req = { kind: "REQUEST" as const, status: "OPEN" as const, createdBySide: "INTERNAL" as const };
ok(nextStatus(req, "SUPPLIER") === "ANSWERED", "открыт → ответила другая сторона → «Ответ получен»");
ok(nextStatus(req, "INTERNAL") === "OPEN", "автор дописал — остаётся открыт");
ok(nextStatus({ ...req, status: "ANSWERED" }, "INTERNAL") === "OPEN", "ответ получен → автор пишет снова → открыт");
ok(nextStatus({ ...req, status: "ANSWERED" }, "SUPPLIER") === "ANSWERED", "ответ получен остаётся при втором ответе");
ok(nextStatus({ ...req, status: "CLOSED" }, "SUPPLIER") === "OPEN", "сообщение в закрытый запрос открывает его");
ok(nextStatus({ kind: "GENERAL", status: "OPEN", createdBySide: "INTERNAL" }, "SUPPLIER") === "OPEN", "обычное обсуждение статус не меняет");

// Непрочитанное и «ждёт ответа»
const t0 = new Date("2026-10-15T10:00:00Z");
ok(isUnread({ lastMessageAt: t0, lastMessageSide: "SUPPLIER" }, null, "INTERNAL"), "нет отметки прочтения — непрочитано");
ok(!isUnread({ lastMessageAt: t0, lastMessageSide: "SUPPLIER" }, new Date(t0.getTime() + 1), "INTERNAL"), "прочитано после последнего");
ok(!isUnread({ lastMessageAt: t0, lastMessageSide: "INTERNAL" }, null, "INTERNAL"), "своё сообщение не «новое»");
ok(awaitsMyAnswer({ kind: "REQUEST", status: "OPEN", lastMessageSide: "SUPPLIER" }, "INTERNAL") && !awaitsMyAnswer({ kind: "REQUEST", status: "CLOSED", lastMessageSide: "SUPPLIER" }, "INTERNAL") && !awaitsMyAnswer({ kind: "GENERAL", status: "OPEN", lastMessageSide: "SUPPLIER" }, "INTERNAL"), "ждут моего ответа: только открытые запросы с последним словом другой стороны");

// Безопасные подписи
ok(safeEntityLabel("ProductionOrder", { number: "160" }) === "ТЗ 160", "ТЗ 160");
ok(safeEntityLabel("Purchase", { auctionSession: "СП 09-26", number: "P-1" }) === "Аукцион СП 09-26", "Аукцион СП 09-26");
ok(safeEntityLabel("Shipment", { name: "Отгрузка октябрь 2026 · 1" }).startsWith("Отгрузка"), "Отгрузка …");
ok(!/[₽$€]/.test(safeEntityLabel("SupplierInbox", { title: "Расчёт СП 09-26 на 1 200 000 ₽" })) && !/\d\s*руб/i.test(stripMoney("Итого 15 000 руб. по лоту")), "деньги вырезаются из подписей");
ok(stripMoney("ТЗ 160") === "ТЗ 160" && stripMoney("Лот 12/34") === "Лот 12/34", "номера без валюты остаются");
ok(entityHrefFor("ProductionOrder", "x", "SUPPLIER") === null && entityHrefFor("Payment", "x", "SUPPLIER") === null && entityHrefFor("RawMaterialLot", "x", "SUPPLIER") === null, "закрытые для поставщика записи без ссылки");
ok(entityHrefFor("ProductionOrder", "x", "INTERNAL") === "/production/x" && entityHrefFor("Purchase", "x", "SUPPLIER") === "/supplier/raw/x" && entityHrefFor("SupplierInbox", "x", "SUPPLIER", { inboxKind: "AUCTION_CALC" }) === "/supplier/auction-calcs/x", "ссылки на записи по сторонам");

// Команды
ok(parseCommand("/start ABCD2345")?.cmd === "start" && (parseCommand("/start@fur_bot ABCD2345") as { arg: string }).arg === "ABCD2345", "/start КОД (в т.ч. с @ботом)");
ok(parseCommand("/bind K1")?.cmd === "bind", "/bind КОД");
const t5 = parseCommand("/t 12 привет всем") as { threadNo: string; text: string };
ok(t5.threadNo === "12" && t5.text === "привет всем", "/t 12 текст");
ok(parseCommand("обычный текст") === null, "обычный текст — не команда");

// Маршрутизация входящих
const resolve = (no: string) => (no === "12" ? "T12" : null);
ok(routeIncoming({ text: "hi", linked: false, resolveThreadNo: resolve }).type === "unbound", "не привязан → просим привязать");
const r1 = routeIncoming({ text: "ответ", linked: true, replyThreadId: "TR", lastActiveThreadId: "TL", resolveThreadNo: resolve });
ok(r1.type === "post" && r1.threadId === "TR" && r1.how === "reply", "reply на сообщение бота → тот же тред");
const r2 = routeIncoming({ text: "/t 12 текст", linked: true, replyThreadId: "TR", resolveThreadNo: resolve });
ok(r2.type === "post" && r2.threadId === "T12" && r2.text === "текст", "/t N важнее reply");
ok(routeIncoming({ text: "/t 99 текст", linked: true, resolveThreadNo: resolve }).type === "notfound", "/t с неизвестным номером");
const r3 = routeIncoming({ text: "/new Нужна платёжка", linked: true, lastActiveThreadId: "TL", resolveThreadNo: resolve });
ok(r3.type === "new" && r3.subject === "Нужна платёжка", "/new тема → новый запрос");
const r4 = routeIncoming({ text: "просто текст", linked: true, lastActiveThreadId: "TL", resolveThreadNo: resolve });
ok(r4.type === "post" && r4.threadId === "TL" && r4.how === "last", "без reply → последний активный тред");
ok(routeIncoming({ text: "просто текст", linked: true, resolveThreadNo: resolve }).type === "new", "нет активного треда → новый");

// Получатели и петли
const links: LinkLite[] = [
  { id: "l1", channel: "TELEGRAM", externalChatId: "g-wm", userId: null, supplierId: "wm", kind: "GROUP" },
  { id: "l2", channel: "TELEGRAM", externalChatId: "p-wm", userId: "uw", supplierId: null, kind: "PRIVATE" },
  { id: "l3", channel: "TELEGRAM", externalChatId: "p-own", userId: "uo", supplierId: null, kind: "PRIVATE" },
  { id: "l4", channel: "TELEGRAM", externalChatId: "p-buh", userId: "ub", supplierId: null, kind: "PRIVATE" },
  { id: "l5", channel: "TELEGRAM", externalChatId: "g-int", userId: null, supplierId: null, kind: "GROUP" },
  { id: "l6", channel: "TELEGRAM", externalChatId: "g-other", userId: null, supplierId: "other", kind: "GROUP" },
];
const roles: Record<string, string> = { uw: "SUPPLIER", uo: "OWNER", ub: "ACCOUNTANT" };
const base = { threadSupplierId: "wm", links, roleOf: (u: string) => roles[u] ?? null, supplierOfUser: (u: string) => (u === "uw" ? "wm" : null) };
const ids = (xs: LinkLite[]) => xs.map((x) => x.id).sort().join(",");
ok(ids(pickRecipients({ ...base, authorSide: "INTERNAL", authorId: "uo", originChatId: null })) === "l1,l2", "пишет наш: группа Веллмеха + его личный, но не чужая группа и не наши личные");
ok(ids(pickRecipients({ ...base, authorSide: "SUPPLIER", authorId: "uw", originChatId: null })) === "l3,l4,l5", "пишет Веллмех: наши личные и внутренняя группа; его группа и он сам — нет");
ok(ids(pickRecipients({ ...base, authorSide: "SUPPLIER", authorId: null, originChatId: "g-wm" })) === "l3,l4,l5", "из группы Веллмеха: назад в неё не отправляем (петля)");
ok(ids(pickRecipients({ ...base, authorSide: "INTERNAL", authorId: "uo", originChatId: "p-wm" })) === "l1", "из личного чата: туда же не отвечаем, остальным — да");
ok(ids(pickRecipients({ ...base, threadSupplierId: null, authorSide: "INTERNAL", authorId: "uo", originChatId: null })) === "", "внутренний тред без поставщика наружу не уходит");

// Формат и коды
const msg = formatForMessenger({ supplierName: "Веллмех", entityLabel: "ТЗ 160", subject: "Срок", authorName: "Пётр", body: "Когда готово?", threadId: "abc", appUrl: "http://localhost:3200/" });
ok(msg.startsWith("💬 Веллмех · ТЗ 160 · Срок\nПётр: Когда готово?") && msg.endsWith("http://localhost:3200/chat?thread=abc"), "формат сообщения для мессенджера");
const code = makeBindCode((n) => Uint8Array.from({ length: n }, (_, i) => i * 37));
ok(/^[A-HJ-NP-Z2-9]{8}$/.test(code), `код привязки: 8 знаков без похожих (${code.length})`);
const now = new Date("2026-10-15T10:00:00Z");
ok(bindCodeValid({ expiresAt: new Date(now.getTime() + 60_000), usedAt: null }, now) && !bindCodeValid({ expiresAt: new Date(now.getTime() - 1), usedAt: null }, now) && !bindCodeValid({ expiresAt: new Date(now.getTime() + 60_000), usedAt: now }, now), "код: срок 15 минут и одноразовость");
ok(externalMsgId(-100123, 77) === "-100123:77", "идентификатор внешнего сообщения");

console.log(fails ? `\nПРОВАЛОВ: ${fails}` : "\nвсё хорошо");
process.exit(fails ? 1 : 0);
