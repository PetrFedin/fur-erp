/**
 * Проверка раздела «Отгрузки» — НА КОПИИ БД (адрес должен содержать shipment_test). Нужны применённые миграции
 * 20261014180000_shipments_events и 20261014220000_shipments_accept и `prisma generate`.
 *
 *   docker exec fur-erp-db-1 createdb -U fur_erp fur_erp_shipment_test
 *   docker exec fur-erp-db-1 pg_dump -U fur_erp --no-owner fur_erp | docker exec -i fur-erp-db-1 psql -U fur_erp -d fur_erp_shipment_test -q
 *   docker exec -i fur-erp-db-1 psql -U fur_erp -d fur_erp_shipment_test -q < prisma/migrations/20261014220000_shipments_accept/migration.sql   # новая миграция на копию
 *   SHIPMENT_TEST_URL=postgresql://…/fur_erp_shipment_test node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-shipments.ts
 *   docker exec fur-erp-db-1 dropdb -U fur_erp fur_erp_shipment_test                       # потом удалить копию
 *
 * Проверяет: создание отгрузки (название по умолчанию), добавление строк из ТЗ (с суммированием и мягким превышением),
 * приёмку по строкам (принято 45 из 50, возврат 5: сохранение пачкой, валидация с номером строки), этапы («на ком», ответственный текстом),
 * ожидаемый → выполненный, кнопку «Принято» → итог поставки и отмену приёмки, запрет удаления строки с приёмкой,
 * файл этапа, интервалы, журнал изменений, права ролей.
 */
import Module from "module";
import { join } from "path";

const url = process.env.SHIPMENT_TEST_URL ?? "";
if (!url.includes("shipment_test")) {
  console.error("Задайте SHIPMENT_TEST_URL на scratch-базу (имя содержит shipment_test).");
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
let fails = 0;
const ok = (c: unknown, m: string) => { console.log(`${c ? "ok  " : "FAIL"} ${m}`); if (!c) fails++; };
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const raw = new PrismaClient({ datasources: { db: { url } } });
  const A = await import("../src/app/(app)/shipments/actions");
  const C = await import("../src/lib/shipment-calc");
  const org = await raw.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const user = await raw.user.findFirstOrThrow({ where: { organizationId: org.id, role: "OWNER", isActive: true } });
  const supplier = await raw.supplier.findFirstOrThrow({ where: { organizationId: org.id, name: { contains: "Веллмех", mode: "insensitive" } } });
  const batch = await raw.productionBatch.findFirstOrThrow({ where: { organizationId: org.id, number: 22 } });
  const setSession = (role: string) => { (globalThis as { __TEST_SESSION?: unknown }).__TEST_SESSION = { user: { id: user.id, role, organizationId: org.id, name: user.name } }; };
  setSession("OWNER");
  const auditBefore = await raw.auditLog.count();

  /** createShipment завершается redirect (заглушка бросает «REDIRECT:/shipments/<id>»). */
  const create = async (o: Record<string, string>): Promise<string> => {
    try {
      const r = await A.createShipment({}, fd(o));
      throw new Error("ожидали redirect, получили " + JSON.stringify(r));
    } catch (e) {
      const m = /REDIRECT:\/shipments\/(\S+)/.exec(String((e as Error).message));
      if (!m) throw e;
      return m[1];
    }
  };

  // 1. Создание
  console.log("1. Создание отгрузки");
  const id = await create({ name: "", plannedDate: "2026-10-15", supplierId: supplier.id, batchId: batch.id });
  const sh = await raw.shipment.findUniqueOrThrow({ where: { id } });
  ok(/^Отгрузка октябрь 2026 · \d+$/.test(sh.name ?? ""), `название по умолчанию: «${sh.name}»`);
  ok(sh.supplierId === supplier.id && sh.batchId === batch.id && sh.plannedDate.toISOString().startsWith("2026-10-15"), "поставщик, партия, плановая дата записаны");
  const id2 = await create({ name: "", plannedDate: "2026-10-20" });
  const sh2 = await raw.shipment.findUniqueOrThrow({ where: { id: id2 } });
  const n1 = Number(/(\d+)$/.exec(sh.name!)![1]);
  ok(sh2.name === `Отгрузка октябрь 2026 · ${n1 + 1}`, `второе название — следующий номер месяца: «${sh2.name}»`);
  ok((await A.updateShipmentHeader(id2, fd({ name: "Тест 2", plannedDate: "2026-10-21", notes: "примечание" }))).ok === true, "правка шапки");
  ok((await A.updateShipmentHeader(id2, fd({ name: "Тест 2", plannedDate: "не дата" }))).error != null, "неверная дата отклонена");
  ok((await A.deleteShipment(id2)).error == null && !(await raw.shipment.findUnique({ where: { id: id2 } })), "пустую отгрузку без этапов удалить можно");

  // 2. Строки из ТЗ
  console.log("2. Добавление строк из ТЗ");
  const cands = await A.listShipmentCandidates(id);
  ok(cands.length > 0, `кандидатов из ТЗ: ${cands.length}`);
  const c182 = cands.find((c) => c.workOrder === "182" && c.color) ?? cands[0];
  const cOther = cands.filter((c) => c.key !== c182.key && c.qtyTz > 0).slice(0, 1);
  const r1 = await A.addShipmentLines(id, [{ key: c182.key, qty: 50 }, ...cOther.map((c) => ({ key: c.key, qty: c.qtyTz }))]);
  ok(!r1.error && r1.added === 1 + cOther.length, `добавлено строк: ${r1.added} ${r1.error ?? ""}`);
  ok(50 > c182.qtyTz, `мягкое превышение количества в ТЗ (50 > ${c182.qtyTz}) не блокируется`);
  const again = await A.addShipmentLines(id, [{ key: c182.key, qty: 3 }]);
  const lines = await raw.shipmentLine.findMany({ where: { shipmentId: id }, orderBy: { id: "asc" } });
  const L = lines.find((l) => l.productionOrderId === c182.orderId && (l.color ?? null) === c182.color && (l.size ?? null) === c182.size)!;
  ok(!again.error && L.quantity === 53 && lines.length === 1 + cOther.length, "повторное добавление той же позиции суммируется со строкой");
  ok(L.color === c182.color && L.size === c182.size && (L.furKind ?? "") === c182.furKind, "цвет, размер и вид меха скопированы из ТЗ");
  ok((await A.updateShipmentLine(L.id, fd({ quantity: "50", size: L.size ?? "", comment: "проверка" }))).ok === true && (await raw.shipmentLine.findUniqueOrThrow({ where: { id: L.id } })).quantity === 50, "правка строки: количество 50");
  ok((await A.updateShipmentLine(L.id, fd({ quantity: "0" }))).error != null, "нулевое количество отклонено");
  ok((await A.addShipmentLines(id, [{ key: "нет|такой|позиции", qty: 1 }])).error != null, "несуществующая позиция отклонена");
  const cands2 = await A.listShipmentCandidates(id);
  const back = cands2.find((c) => c.key === c182.key)!;
  ok(back.inHere === 50, `в кандидатах видно «уже в этой»: ${back.inHere} (в других отгрузках: ${back.inOthers}; на копии с примером может быть > 0)`);

  // 3. Приёмка по строкам: принято 45 из 50, возврат 5
  console.log("3. Приёмка по строкам");
  const other = lines.find((l) => l.id !== L.id)!;
  const calc = async () => C.shipmentTotals(await raw.shipmentLine.findMany({ where: { shipmentId: id } }));
  let t = await calc();
  ok(t.accepted === 0 && t.returned === 0 && t.filledLines === 0, "до приёмки: принято 0, возврат 0, строк не отмечено");
  const badSum = await A.saveLineAcceptance(id, [{ id: L.id, n: 1, accepted: 40, returned: 11, comment: null }]);
  ok(!!badSum.error && /Строка 1/.test(badSum.error) && (await raw.shipmentLine.findUniqueOrThrow({ where: { id: L.id } })).acceptedQty === null, `принято + возврат больше «в отгрузке» отклонено: ${badSum.error}`);
  ok(!!(await A.saveLineAcceptance(id, [{ id: L.id, n: 2, accepted: -1, returned: null, comment: null }])).error, "отрицательное количество отклонено");
  ok(!!(await A.saveLineAcceptance(id, [{ id: L.id, n: 2, accepted: 1.5, returned: null, comment: null }])).error, "нецелое количество отклонено");
  const mixed = await A.saveLineAcceptance(id, [{ id: other.id, n: 1, accepted: other.quantity, returned: 0, comment: null }, { id: L.id, n: 2, accepted: 45, returned: 99, comment: "x" }]);
  ok(!!mixed.error && /Строка 2/.test(mixed.error) && (await raw.shipmentLine.findUniqueOrThrow({ where: { id: other.id } })).acceptedQty === null, "пачка с одной ошибочной строкой не записывается вовсе");
  ok(!!(await A.saveLineAcceptance(id, [{ id: "нет-такой-строки", n: 3, accepted: 1, returned: null, comment: null }])).error, "чужая / несуществующая строка отклонена");
  const saved = await A.saveLineAcceptance(id, [
    { id: L.id, n: 1, accepted: 45, returned: 5, comment: "брак швов" },
    { id: other.id, n: 2, accepted: other.quantity, returned: 0, comment: null },
  ]);
  ok(saved.saved === 2 && !saved.error, "сохранение пачкой: 2 строки");
  const L2 = await raw.shipmentLine.findUniqueOrThrow({ where: { id: L.id } });
  ok(L2.acceptedQty === 45 && L2.returnedQty === 5 && L2.comment === "брак швов", "по строке: принято 45, возврат 5, причина в комментарии");
  t = await calc();
  const total = lines.reduce((s2, l) => s2 + (l.id === L.id ? 50 : l.quantity), 0);
  ok(t.inShipment === total && t.accepted === 45 + other.quantity && t.returned === 5 && t.remaining === 0, `итоги по строкам: к отгрузке ${t.inShipment}, принято ${t.accepted}, не принято ${t.returned}, ждёт ${t.remaining}`);
  const partial = await A.saveLineAcceptance(id, [{ id: L.id, n: 1, accepted: 40, returned: 5, comment: "брак швов" }]);
  t = await calc();
  ok(!partial.error && t.remaining === 5, `допускается меньше: ещё ждёт приёмки ${t.remaining}`);
  await A.saveLineAcceptance(id, [{ id: L.id, n: 1, accepted: 45, returned: 5, comment: "брак швов" }]);
  const ed = await A.updateShipmentLine(L.id, fd({ quantity: "50", size: L.size ?? "", comment: "правка", acceptedQty: "46", returnedQty: "4" }));
  const L3 = await raw.shipmentLine.findUniqueOrThrow({ where: { id: L.id } });
  ok(ed.ok === true && L3.acceptedQty === 46 && L3.returnedQty === 4 && L3.comment === "правка", "окно «Изменить»: принято, возврат и комментарий");
  ok((await A.updateShipmentLine(L.id, fd({ quantity: "50", acceptedQty: "47", returnedQty: "4" }))).error != null, "в окне «Изменить»: принято + возврат больше количества отклонено");
  ok((await A.updateShipmentLine(L.id, fd({ quantity: "40", acceptedQty: "46", returnedQty: "4" }))).error != null, "количество меньше принятого + возврата отклонено");
  await A.saveLineAcceptance(id, [{ id: L.id, n: 1, accepted: 45, returned: 5, comment: "брак швов" }]);
  const aa = await A.acceptAllLines(id);
  const allRows = await raw.shipmentLine.findMany({ where: { shipmentId: id } });
  ok(!aa.error && allRows.every((l) => l.acceptedQty === l.quantity && l.returnedQty === 0), "«Принять всё»: принято = в отгрузке, возврат 0");
  await A.saveLineAcceptance(id, [{ id: L.id, n: 1, accepted: 45, returned: 5, comment: "брак швов" }]);

  // 4. Этапы: «на ком», ответственный текстом
  console.log("4. Этапы");
  const e0 = await A.createEvent(id, {}, fd({ title: "Примерка", date: "2026-10-05", time: "", responsible: "Василий (Веллмех)", side: "WELLMEKH", place: "Санкт-Петербург", details: "Поездка", nextTitle: "Принято в Коптево", nextDate: "2026-10-15" }));
  ok(e0.ok === true, "этап без времени создан " + (e0.error ?? ""));
  let evs = await raw.shipmentEvent.findMany({ where: { shipmentId: id }, orderBy: { createdAt: "asc" } });
  const prim = evs.find((e) => e.title === "Примерка")!;
  const exp = evs.find((e) => e.title === "Принято в Коптево")!;
  ok(prim.timeKnown === false && prim.responsibleName === "Василий (Веллмех)" && prim.responsibleUserId === null && prim.place === "Санкт-Петербург", "время не указано → timeKnown=false; имя вписано текстом (нет такого пользователя → userId пуст)");
  ok(prim.side === "WELLMEKH", "«на ком» = Веллмех записано");
  ok(exp.expected === true && exp.timeKnown === false && exp.occurredAt.toISOString().startsWith("2026-10-15"), "«Следующий этап» создал ожидаемый этап в той же транзакции");
  ok(prim.createdById === user.id, "кто внёс записан");
  ok((await A.createEvent(id, {}, fd({ title: "x", date: "2026-10-15", side: "ЧУЖОЙ" }))).error != null, "неизвестное «на ком» отклонено");

  const rAnna = await A.createEvent(id, {}, fd({ title: "Подтверждение исправлений", date: "2026-10-09", time: "19:07", responsible: user.name.toUpperCase(), side: "CUM" }));
  const rOlga = await A.createEvent(id, {}, fd({ title: "Ольга отправила УПД", date: "2026-10-12", time: "13:06", responsible: "Ольга", side: "WELLMEKH" }));
  ok(rAnna.ok === true && rOlga.ok === true, "этапы Анны и Ольги созданы");
  evs = await raw.shipmentEvent.findMany({ where: { shipmentId: id }, orderBy: { createdAt: "asc" } });
  const ea = evs.find((e) => e.title === "Подтверждение исправлений")!;
  const eo = evs.find((e) => e.title === "Ольга отправила УПД")!;
  ok(ea.responsibleUserId === user.id, "имя точно совпало с пользователем приложения (без учёта регистра) → responsibleUserId заполнен");
  ok(eo.responsibleUserId === null && eo.responsibleName === "Ольга" && eo.side === "WELLMEKH", "вписанное имя без совпадения → userId пуст");
  ok(C.formatInterval(ea, eo) === "2 дн. 17 ч 59 мин", `интервал Анна 09.10 19:07 → Ольга 12.10 13:06 = ${C.formatInterval(ea, eo)}`);
  const notes = C.intervalNotes([...evs].sort(C.compareEvents));
  ok(notes.some((n) => n?.text === "2 дн. 17 ч 59 мин" || n?.exact === "2 дн. 17 ч 59 мин"), "интервал Анна → Ольга виден на ленте");
  ok((await A.createEvent(id, {}, fd({ title: "", date: "2026-10-15" }))).error != null, "пустое название отклонено");
  ok((await A.createEvent(id, {}, fd({ title: "x", date: "2026-10-15", time: "25:99" }))).error != null, "неверное время отклонено");

  const upd = await A.updateEvent(eo.id, fd({ title: "Ольга отправила УПД (правка)", date: "2026-10-12", time: "13:10", responsible: "Приёмщик", side: "", place: "офис" }));
  const eo2 = await raw.shipmentEvent.findUniqueOrThrow({ where: { id: eo.id } });
  ok(upd.ok === true && eo2.title === "Ольга отправила УПД (правка)" && eo2.responsibleName === "Приёмщик" && eo2.side === null && eo2.updatedById === user.id, "правка этапа: поля, «на ком» очищено, «изменил» записан");

  console.log("   файл этапа");
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
  const withFile = new FormData();
  for (const [k, v] of Object.entries({ title: "Документы от поставщика", date: "2026-10-12", time: "17:00", responsible: "Василий", side: "WELLMEKH" })) withFile.set(k, v);
  withFile.set("file", new File([pdf], "упд-143.pdf", { type: "application/pdf" }));
  const rFile = await A.createEvent(id, {}, withFile);
  ok(rFile.ok === true && !!rFile.id, "этап с файлом создан в одной отправке " + (rFile.error ?? ""));
  const docs = await raw.driveDocument.findMany({ where: { shipmentEventId: rFile.id } });
  ok(docs.length === 1 && docs[0].storedMime === "application/pdf" && !!docs[0].storagePath && docs[0].title === "упд-143", "файл сохранён и привязан к этапу (DriveDocument.shipmentEventId)");
  const more = new FormData();
  more.set("file", new File([pdf], "второй.pdf", { type: "application/pdf" }));
  ok((await A.uploadEventDocument(rFile.id!, more)).ok === true && (await raw.driveDocument.count({ where: { shipmentEventId: rFile.id } })) === 2, "«+ Документ» прикрепил второй файл");
  const bad = new FormData();
  for (const [k, v] of Object.entries({ title: "Плохой файл", date: "2026-10-12" })) bad.set(k, v);
  bad.set("file", new File([Buffer.from("это не документ")], "фейк.pdf", { type: "application/pdf" }));
  const rBad = await A.createEvent(id, {}, bad);
  ok(!!rBad.error && (await raw.shipmentEvent.count({ where: { shipmentId: id, title: "Плохой файл" } })) === 0, "неподходящий файл отклонён до создания этапа (этап не создаётся)");
  ok(!(await A.removeEventDocument(docs[0].id)).error && !(await raw.driveDocument.findUnique({ where: { id: docs[0].id } })), "документ этапа убран");
  ok(!(await A.deleteEvent(rFile.id!)).error && (await raw.driveDocument.count({ where: { shipmentEventId: rFile.id } })) === 0, "удаление этапа убрало его документы");

  // 5. Ожидаемый → выполненный
  console.log("5. Ожидаемый этап");
  const extra = await A.createEvent(id, {}, fd({ title: "Ждём курьера", date: "2026-10-16", expected: "on" }));
  const done = await A.markEventDone(extra.id!);
  const ex2 = await raw.shipmentEvent.findUniqueOrThrow({ where: { id: extra.id! } });
  ok(!done.error && ex2.expected === false && ex2.timeKnown === true, "«Выполнено»: expected=false, время известно");
  ok(Math.abs(ex2.occurredAt.getTime() - C.wallNow().getTime()) < 5 * 60_000, "дата-время = сейчас (настенное время Москвы)");
  ok((await A.markEventDone(extra.id!)).error != null, "повторно отметить нельзя");
  await A.deleteEvent(extra.id!);

  // 6. Кнопка «Принято» → итог → отмена
  console.log("6. Приёмка в Коптево");
  ok(C.isAcceptanceEvent(exp) && !C.isAcceptanceEvent({ ...exp, expected: false }) && C.isAcceptanceEvent({ expected: true, title: "Что-то", place: "КОПТЕВО" }), "ожидаемый этап приёмки определяется по названию / месту");
  const accForm = (o: Record<string, string> = {}) => fd({ date: "2026-10-15", time: "16:00", acceptedBy: "Анна", side: "CUM", comment: "в целом хорошо", ...o });
  ok((await A.confirmAcceptance(id, exp.id, accForm({ date: "не дата" }))).error != null, "неверная дата приёмки отклонена");
  ok((await A.confirmAcceptance(id, "нет-этапа", accForm())).error != null, "несуществующий этап приёмки отклонён");
  const rOk = await A.confirmAcceptance(id, exp.id, accForm());
  ok(rOk.ok === true, "приёмка подтверждена " + (rOk.error ?? ""));
  const shA = await raw.shipment.findUniqueOrThrow({ where: { id } });
  const evA = await raw.shipmentEvent.findUniqueOrThrow({ where: { id: exp.id } });
  ok(shA.status === "ACCEPTED" && shA.acceptedBy === "Анна" && shA.acceptEventId === exp.id && !!shA.acceptedAt?.toISOString().startsWith("2026-10-15T16:00"), "отгрузка: статус «Принята», acceptedAt, кто принял, этап");
  ok(evA.expected === false && evA.timeKnown === true && evA.side === "CUM" && evA.occurredAt.toISOString().startsWith("2026-10-15T16:00"), "этап приёмки выполнен, «на ком» = ЦУМ, дата-время из окна");
  const tt = await calc();
  ok(evA.details === `${C.acceptSummaryText(tt)}\nв целом хорошо` && /^Принято \d+ из \d+, возврат 5/.test(evA.details ?? ""), `автосводка в этапе: «${(evA.details ?? "").split("\n")[0]}»`);
  ok((await A.confirmAcceptance(id, exp.id, accForm())).error != null, "повторно подтвердить нельзя");
  const full = await raw.shipment.findUniqueOrThrow({ where: { id }, include: { lines: true, events: true } });
  const sum = C.deliverySummary({ plannedDate: full.plannedDate, acceptedAt: full.acceptedAt!, acceptEventId: full.acceptEventId, events: full.events });
  ok(sum.plan.days === 0 && sum.plan.text === "в срок" && sum.first?.title === "Примерка" && !!sum.firstToAccept, `итог по срокам: ${sum.plan.text}; первая запись «${sum.first?.title}» → приёмка ${sum.firstToAccept}`);
  ok(sum.chain.length >= 1 && sum.chain[sum.chain.length - 1].to === "Принято в Коптево", "цепочка интервалов заканчивается приёмкой");
  const grp = C.groupByOrder(full.lines.map((l) => ({ orderKey: l.productionOrderId, label: l.productionOrderId, article: "a", quantity: l.quantity, acceptedQty: l.acceptedQty, returnedQty: l.returnedQty, comment: l.comment })));
  ok(grp.reduce((s2, g) => s2 + g.returned, 0) === 5 && grp.some((g) => g.reasons.includes("брак швов")), "таблица по ТЗ: возврат 5 с причиной «брак швов»");
  const delBad = await A.deleteShipmentLine(L.id);
  ok(!!delBad.error && !!(await raw.shipmentLine.findUnique({ where: { id: L.id } })), "строку с приёмкой удалить нельзя");
  const rc = await A.cancelAcceptance(id);
  const shC = await raw.shipment.findUniqueOrThrow({ where: { id } });
  const evC = await raw.shipmentEvent.findUniqueOrThrow({ where: { id: exp.id } });
  ok(!rc.error && shC.acceptedAt === null && shC.acceptEventId === null && shC.acceptedBy === null && shC.status === "PLANNED" && evC.expected === true, "отмена приёмки: этап снова ожидаемый, acceptedAt снят, статус «Запланирована»");
  ok((await raw.shipmentLine.findUniqueOrThrow({ where: { id: L.id } })).acceptedQty === 45, "отметки в составе после отмены остались");
  ok((await A.cancelAcceptance(id)).error != null, "отменить неподтверждённую приёмку нельзя");
  await A.saveLineAcceptance(id, allRows.map((l, i) => ({ id: l.id, n: i + 1, accepted: null, returned: null, comment: l.comment })));
  ok((await A.confirmAcceptance(id, exp.id, accForm())).error != null, "приёмка без отмеченных строк не подтверждается");
  await A.deleteEvent(exp.id);
  const mk = await A.createAcceptanceEvent(id);
  const created = await raw.shipmentEvent.findFirst({ where: { shipmentId: id, title: "Принято в Коптево" } });
  ok(!mk.error && created?.expected === true && created.place === "Коптево" && created.occurredAt.toISOString().startsWith("2026-10-15"), "«+ Приёмка в Коптево»: ожидаемый этап на плановую дату");
  await A.saveLineAcceptance(id, [{ id: L.id, n: 1, accepted: 45, returned: 5, comment: "брак швов" }]);
  ok((await A.confirmAcceptance(id, created!.id, accForm())).ok === true, "приёмка подтверждена повторно");
  await A.deleteEvent(created!.id);
  const shD = await raw.shipment.findUniqueOrThrow({ where: { id } });
  ok(shD.acceptedAt === null && shD.status === "PLANNED", "удаление этапа приёмки снимает acceptedAt");

  // 7. Удаление строк и отгрузки
  console.log("7. Удаление строк и отгрузки");
  ok(!!(await A.deleteShipment(id)).error, "отгрузку с этапами удалить нельзя");
  await A.saveLineAcceptance(id, [{ id: L.id, n: 1, accepted: 0, returned: 0, comment: null }]);
  const delOk = await A.deleteShipmentLine(L.id);
  ok(!delOk.error && !(await raw.shipmentLine.findUnique({ where: { id: L.id } })), "строку без приёмки (0 / 0) удалить можно");

  // 8. Журнал изменений и права
  console.log("8. Журнал и права");
  ok((await raw.auditLog.count()) > auditBefore, "изменения попали в журнал (AuditLog)");
  const aud = await raw.auditLog.findMany({ where: { model: { in: ["ShipmentEvent", "Shipment"] } }, take: 5 });
  ok(aud.length > 0, "в журнале есть записи по Shipment/ShipmentEvent");
  setSession("VIEWER");
  let denied = false;
  try { await A.createEvent(id, {}, fd({ title: "x", date: "2026-10-15" })); } catch (e) { denied = String((e as Error).message).startsWith("FORBIDDEN"); }
  ok(denied, "роль VIEWER не может добавлять этапы");
  let denied2 = false;
  try { await A.saveLineAcceptance(id, [{ id: L.id, n: 1, accepted: 1, returned: null, comment: null }]); } catch (e) { denied2 = String((e as Error).message).startsWith("FORBIDDEN"); }
  ok(denied2, "роль VIEWER не может сохранять приёмку по строкам");
  setSession("OWNER");

  // уборка: пробную отгрузку удаляем (на копии это не обязательно)
  for (const e of await raw.shipmentEvent.findMany({ where: { shipmentId: id }, select: { id: true } })) await A.deleteEvent(e.id);
  await A.deleteShipment(id);

  console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : "\nВсе проверки пройдены");
  await raw.$disconnect();
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
