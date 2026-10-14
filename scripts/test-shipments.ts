/**
 * Проверка раздела «Отгрузки» — НА КОПИИ БД (адрес должен содержать shipment_test). Нужны применённая миграция
 * 20261014180000_shipments_events и `prisma generate`.
 *
 *   docker exec fur-erp-db-1 createdb -U fur_erp fur_erp_shipment_test
 *   docker exec fur-erp-db-1 pg_dump -U fur_erp --no-owner fur_erp | docker exec -i fur-erp-db-1 psql -U fur_erp -d fur_erp_shipment_test -q
 *   DATABASE_URL=<боевой адрес с именем fur_erp_shipment_test> npx prisma migrate deploy   # миграция на копию
 *   SHIPMENT_TEST_URL=postgresql://…/fur_erp_shipment_test node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/test-shipments.ts
 *   docker exec fur-erp-db-1 dropdb -U fur_erp fur_erp_shipment_test                       # потом удалить копию
 *
 * Проверяет: создание отгрузки (название по умолчанию), добавление строк из ТЗ (с суммированием и мягким превышением),
 * этапы (с приёмкой по строкам: принято 45 из 50, возврат 5), правку этапа, ожидаемый → выполненный, удаление этапа,
 * запрет удаления строки с приёмкой, итоги и интервалы, журнал изменений, права ролей.
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
  ok(back.inHere === 50 && back.inOthers === 0, `в кандидатах видно «уже в этой»: ${back.inHere}`);

  // 3. Этапы
  console.log("3. Этапы");
  const e0 = await A.createEvent(id, {}, fd({ title: "Примерка", date: "2026-10-05", time: "", responsible: "__other", responsibleName: "Василий (Веллмех)", place: "Санкт-Петербург", details: "Поездка", mode: "all", nextTitle: "Принято в Коптево", nextDate: "2026-10-15" }));
  ok(e0.ok === true, "этап без времени создан " + (e0.error ?? ""));
  let evs = await raw.shipmentEvent.findMany({ where: { shipmentId: id }, orderBy: { createdAt: "asc" } });
  const prim = evs.find((e) => e.title === "Примерка")!;
  const exp = evs.find((e) => e.title === "Принято в Коптево")!;
  ok(prim.timeKnown === false && prim.responsibleName === "Василий (Веллмех)" && prim.place === "Санкт-Петербург", "время не указано → timeKnown=false; внешний ответственный и место записаны");
  ok(exp.expected === true && exp.timeKnown === false && exp.occurredAt.toISOString().startsWith("2026-10-15"), "«Следующий этап» создал ожидаемый этап в той же транзакции");
  ok(prim.createdById === user.id, "кто внёс записан");

  const rAnna = await A.createEvent(id, {}, fd({ title: "Подтверждение исправлений", date: "2026-10-09", time: "19:07", responsible: user.id }));
  const rOlga = await A.createEvent(id, {}, fd({ title: "Ольга отправила УПД", date: "2026-10-12", time: "13:06", responsible: "__other", responsibleName: "Ольга" }));
  ok(rAnna.ok === true && rOlga.ok === true, "этапы Анны и Ольги созданы");
  evs = await raw.shipmentEvent.findMany({ where: { shipmentId: id }, orderBy: { createdAt: "asc" } });
  const ea = evs.find((e) => e.title === "Подтверждение исправлений")!;
  const eo = evs.find((e) => e.title === "Ольга отправила УПД")!;
  ok(ea.responsibleUserId === user.id, "ответственный — пользователь приложения");
  ok(C.formatInterval(ea, eo) === "2 дн. 17 ч 59 мин", `интервал Анна 09.10 19:07 → Ольга 12.10 13:06 = ${C.formatInterval(ea, eo)}`);
  const notes = C.intervalNotes([...evs].sort(C.compareEvents));
  ok(notes.some((n) => n?.text === "2 дн. 17 ч 59 мин" || n?.exact === "2 дн. 17 ч 59 мин"), "интервал Анна → Ольга виден на ленте (соседние этапы с известным временем)");

  // приёмка: принято 45 из 50, возврат 5
  const other = lines.find((l) => l.id !== L.id)!;
  const rAcc = await A.createEvent(id, {}, fd({
    title: "Принято в Коптево", date: "2026-10-15", time: "15:30", responsible: user.id, place: "Коптево", mode: "lines",
    [`l_${L.id}_qty`]: "50", [`l_${L.id}_accepted`]: "45", [`l_${L.id}_returned`]: "5", [`l_${L.id}_comment`]: "брак швов",
    [`l_${other.id}_accepted`]: String(other.quantity),
  }));
  ok(rAcc.ok === true, "этап приёмки по строкам создан " + (rAcc.error ?? ""));
  const accEv = (await raw.shipmentEvent.findMany({ where: { shipmentId: id, title: "Принято в Коптево", expected: false }, include: { lines: true } }))[0];
  const ln = accEv.lines.find((l) => l.shipmentLineId === L.id)!;
  ok(ln.qty === 50 && ln.accepted === 45 && ln.returned === 5 && ln.rejected === null && ln.comment === "брак швов", "по строке: 50 шт., принято 45, возвращено 5, причина записана");
  const calc = async () => {
    const full = await raw.shipment.findUniqueOrThrow({ where: { id }, include: { lines: true, events: { include: { lines: true } } } });
    return C.shipmentTotals(full.lines, C.acceptanceByLine(full.events));
  };
  let t = await calc();
  const total = lines.reduce((s, l) => s + (l.id === L.id ? 50 : l.quantity), 0);
  ok(t.inShipment === total && t.accepted === 45 + other.quantity && t.returned === 5 && t.notAccepted === 5, `итоги: в отгрузке ${t.inShipment}, принято ${t.accepted}, возвращено ${t.returned}`);
  ok(t.remaining === 5, `ещё не принято = 5 (получили ${t.remaining}); ожидаемый этап в приёмку не входит`);
  ok((await A.createEvent(id, {}, fd({ title: "", date: "2026-10-15" }))).error != null, "пустое название отклонено");
  ok((await A.createEvent(id, {}, fd({ title: "x", date: "2026-10-15", time: "25:99" }))).error != null, "неверное время отклонено");
  ok((await A.createEvent(id, {}, fd({ title: "x", date: "2026-10-15", mode: "lines", [`l_${L.id}_accepted`]: "abc" }))).error != null, "нечисловое количество отклонено");
  const soft = await A.createEvent(id, {}, fd({ title: "Мягкое превышение", date: "2026-10-16", mode: "lines", [`l_${L.id}_accepted`]: "40", [`l_${L.id}_rejected`]: "40" }));
  ok(soft.ok === true, "accepted+rejected больше количества строки — только предупреждение в форме, сервер не блокирует");
  if (soft.id) await A.deleteEvent(soft.id);

  // 4. Правка этапа
  console.log("4. Правка этапа");
  const upd = await A.updateEvent(accEv.id, fd({
    title: "Принято в Коптево (повторно)", date: "2026-10-15", time: "16:00", responsible: "__other", responsibleName: "Приёмщик", mode: "lines",
    [`l_${L.id}_accepted`]: "47", [`l_${L.id}_returned`]: "3",
  }));
  ok(upd.ok === true, "этап изменён " + (upd.error ?? ""));
  const accEv2 = await raw.shipmentEvent.findUniqueOrThrow({ where: { id: accEv.id }, include: { lines: true } });
  ok(accEv2.title === "Принято в Коптево (повторно)" && accEv2.responsibleUserId === null && accEv2.responsibleName === "Приёмщик" && accEv2.updatedById === user.id, "поля этапа и «изменил» обновлены");
  ok(accEv2.lines.length === 1 && accEv2.lines[0].accepted === 47, "строки этапа заменены");
  t = await calc();
  ok(t.accepted === 47 && t.returned === 3, `итоги пересчитаны: принято ${t.accepted}, возвращено ${t.returned}`);

  // 5. Ожидаемый → выполненный
  console.log("5. Ожидаемый этап");
  const done = await A.markEventDone(exp.id);
  const exp2 = await raw.shipmentEvent.findUniqueOrThrow({ where: { id: exp.id } });
  ok(!done.error && exp2.expected === false && exp2.timeKnown === true, "«Отметить выполненным»: expected=false, время известно");
  const nowWall = C.wallNow().getTime();
  ok(Math.abs(exp2.occurredAt.getTime() - nowWall) < 5 * 60_000, "дата-время = сейчас (настенное время Москвы)");
  ok((await A.markEventDone(exp.id)).error != null, "повторно отметить нельзя");

  // 6. Запрет удаления строки с приёмкой
  console.log("6. Удаление строк и этапов");
  const delBad = await A.deleteShipmentLine(L.id);
  ok(!!delBad.error && !!(await raw.shipmentLine.findUnique({ where: { id: L.id } })), "строку с приёмкой удалить нельзя");
  ok(!!(await A.deleteShipment(id)).error, "отгрузку с этапами удалить нельзя");
  const del1 = await A.deleteEvent(accEv.id);
  ok(!del1.error && !(await raw.shipmentEvent.findUnique({ where: { id: accEv.id } })) && (await raw.shipmentEventLine.count({ where: { eventId: accEv.id } })) === 0, "этап удалён вместе со строками");
  t = await calc();
  ok(t.accepted === 0 && t.returned === 0, "итоги после удаления этапа приёмки: принято 0");
  ok(!(await A.deleteShipmentLine(L.id)).error && !(await raw.shipmentLine.findUnique({ where: { id: L.id } })), "после удаления этапа строку удалить можно");

  // 7. Журнал изменений и права
  console.log("7. Журнал и права");
  ok((await raw.auditLog.count()) > auditBefore, "изменения попали в журнал (AuditLog)");
  const aud = await raw.auditLog.findMany({ where: { model: { in: ["ShipmentEvent", "Shipment"] } }, take: 5 });
  ok(aud.length > 0, "в журнале есть записи по Shipment/ShipmentEvent");
  setSession("VIEWER");
  let denied = false;
  try { await A.createEvent(id, {}, fd({ title: "x", date: "2026-10-15" })); } catch (e) { denied = String((e as Error).message).startsWith("FORBIDDEN"); }
  ok(denied, "роль VIEWER не может добавлять этапы");
  setSession("OWNER");

  // уборка: пробную отгрузку удаляем (на копии это не обязательно)
  for (const e of await raw.shipmentEvent.findMany({ where: { shipmentId: id }, select: { id: true } })) await A.deleteEvent(e.id);
  await A.deleteShipment(id);

  console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : "\nВсе проверки пройдены");
  await raw.$disconnect();
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
