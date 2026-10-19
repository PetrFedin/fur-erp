/**
 * Накладные ЦУМ (ЗИ) по поставкам 21М, 22М, 23М → отгрузка «Отгрузка октябрь 2026 · 1».
 * Источник: три Excel-файла накладных (сохранены 14.10.2026), разобранные в docs-inventory/zi-2026-10-19/ (zi-lines.json,
 * zi-price-diffs.json, zi-supplies.json). Решение владельца: что есть в накладных — принято к отгрузке в ЦУМ, чего нет — не принято.
 *   • приёмка по строкам: acceptedQty = штук нашлось в накладных, returnedQty = остальное (не принято); строка «не принято» получает
 *     пометку «нет в накладных ЗИ …» (причина по документам не названа);
 *   • строки «на доработке» (MH-06, MH-07, М038 р.44), которые целиком вошли в накладные, переводятся в «Готов к отгрузке»,
 *     их авто-пункт «Не вошло в список…» закрывается с пометкой «вошло в накладную ЗИ …»;
 *   • в SystemState «shipment-zi:<id>» кладутся строки накладных (бутик, размер, цвет, сумма) и расхождения «заказ ЦУМ ↔ накладная»;
 *   • этап хронологии «Накладные ЦУМ (ЗИ) по поставкам 21М, 22М, 23М» (сторона ЦУМ, 14.10.2026, время не указано).
 * Приёмка финализируется как кнопкой «ПРИНЯТО»: ожидаемый этап «Приёмка в Коптево» становится выполненным (дата — плановая 15.10.2026
 * самого этапа, время не указано; details — автосводка), у отгрузки acceptedAt/acceptedBy/acceptEventId, статус «Принята».
 *
 *   node --conditions=react-server --env-file=.env node_modules/.bin/tsx scripts/apply-zi-acceptance-2026-10-19.ts            # пробный прогон
 *   ... --apply            # записать (на боевой базе нужен ещё --live: скрипт сам делает bash scripts/backup.sh)
 *   ... --rollback --apply # откат по журналу
 * Журнал: docs-inventory/corrections-journal-zi-acceptance-2026-10-19[-<база>].json (до записи в БД).
 */
import Module from "module";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const M = Module as unknown as { _resolveFilename: (...a: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (this: unknown, req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return join(__dirname, "stubs", "empty.js");
  return orig.call(this, req, ...rest);
};

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");
const LIVE = process.argv.includes("--live");
const dbName = /\/([^/?]+)(\?|$)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "?";
const INVDIR = join(__dirname, "..", "docs-inventory");
const SRC = join(INVDIR, "zi-2026-10-19");
const JOURNAL = join(INVDIR, `corrections-journal-zi-acceptance-2026-10-19${dbName === "fur_erp" ? "" : `-${dbName}`}.json`);
const SHIPMENT_NAME = "Отгрузка октябрь 2026 · 1";
const EVENT_TITLE = "Накладные ЦУМ (ЗИ) по поставкам 21М, 22М, 23М";
const STAGE_BY = "накладные ЗИ 14.10 (по документам)";
const MISSING_NOTE = "Нет в накладных ЗИ 21М/22М/23М (файлы от 14.10.2026); причина по документам не названа";
const REWORK_DONE_NOTE = "Закрыто по накладным ЗИ (файлы от 14.10.2026): изделие включено в накладную ЦУМ";
const STAGE_AT = new Date("2026-10-14T00:00:00.000Z");

type Journal = {
  at: string; db: string; shipmentId: string;
  lines: { id: string; stage: string; stageChangedAt: string | null; stageChangedBy: string | null; acceptedQty: number | null; returnedQty: number | null; comment: string | null }[];
  reworks: { id: string; state: string; note: string | null }[];
  eventId: string | null;
  zi: { existed: boolean; value: unknown };
  accept: { eventId: string; expected: boolean; details: string | null; updatedById: string | null } | null;
  shipment: { status: string; acceptedAt: string | null; acceptedBy: string | null; acceptEventId: string | null };
};
const rj = <T,>(f: string): T => JSON.parse(readFileSync(join(SRC, f), "utf8")) as T;
const money = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const { createAuditedClient } = await import("../src/lib/prisma");
  const { matchZi, ziKey, ziStatus, ZI_STATUS_LABEL } = await import("../src/lib/shipment-zi");
  type ZiLine = import("../src/lib/shipment-zi").ZiLine;
  const prisma = createAuditedClient("script:apply-zi-acceptance");
  console.log(`База: ${dbName}${dbName === "fur_erp" ? " (БОЕВАЯ)" : ""}; режим: ${ROLLBACK ? "откат" : "внесение"}${APPLY ? " — ПРИМЕНЕНИЕ" : " — пробный прогон"}`);
  if (APPLY && dbName === "fur_erp" && !LIVE) { console.log("Боевая база: нужен --live. Ничего не изменено."); process.exitCode = 1; return; }
  const org = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const sh = await prisma.shipment.findFirstOrThrow({ where: { organizationId: org.id, name: SHIPMENT_NAME }, select: { id: true } });
  const KEY = ziKey(sh.id);

  if (ROLLBACK) {
    const j = JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal;
    console.log(`Откат: строк ${j.lines.length}, пунктов доработки ${j.reworks.length}${j.eventId ? ", этап хронологии" : ""}, накладные ЗИ ${j.zi.existed ? "вернуть прежние" : "убрать"}`);
    if (!APPLY) return console.log("пробный откат — добавьте --apply");
    if (dbName === "fur_erp") execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
    await prisma.$transaction(async (tx) => {
      for (const l of j.lines) await tx.shipmentLine.update({ where: { id: l.id }, data: { stage: l.stage as "REVIEW" | "REWORK" | "READY", stageChangedAt: l.stageChangedAt ? new Date(l.stageChangedAt) : null, stageChangedBy: l.stageChangedBy, acceptedQty: l.acceptedQty, returnedQty: l.returnedQty, comment: l.comment } });
      for (const r of j.reworks) await tx.shipmentLineRework.update({ where: { id: r.id }, data: { state: r.state as "OPEN" | "DONE" | "MORE", note: r.note } });
      await tx.shipment.update({ where: { id: j.shipmentId }, data: { status: j.shipment.status as "PLANNED", acceptedAt: j.shipment.acceptedAt ? new Date(j.shipment.acceptedAt) : null, acceptedBy: j.shipment.acceptedBy, acceptEventId: j.shipment.acceptEventId } });
      if (j.accept) await tx.shipmentEvent.update({ where: { id: j.accept.eventId }, data: { expected: j.accept.expected, details: j.accept.details, updatedById: j.accept.updatedById } });
      if (j.eventId) await tx.shipmentEvent.deleteMany({ where: { id: j.eventId } });
      if (j.zi.existed) await tx.systemState.update({ where: { organizationId_key: { organizationId: org.id, key: KEY } }, data: { value: j.zi.value as never } });
      else await tx.systemState.deleteMany({ where: { organizationId: org.id, key: KEY } });
    });
    return console.log("откат выполнен");
  }

  const prev = existsSync(JOURNAL) ? (JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal & { done?: boolean }) : null;
  if (prev && (await prisma.shipmentEvent.findFirst({ where: { shipmentId: sh.id, title: EVENT_TITLE }, select: { id: true } }))) {
    console.log("Накладные уже внесены (этап есть). Для повторного внесения сначала --rollback --apply."); return;
  }

  const rawLines = rj<Record<string, (Omit<ZiLine, "supply" | "boutique" | "article" | "size" | "colorRu"> & { b: string; art: string; size: string; colorRu: string; sheet: string; qty: number; sum: number; vat: number })[]>>("zi-lines.json");
  const zi: ZiLine[] = [];
  for (const [supply, arr] of Object.entries(rawLines)) for (const r of arr) if (r.sheet === "MVST") zi.push({ supply, boutique: r.b, article: r.art, size: r.size, colorRu: r.colorRu, sum: r.sum, vat: r.vat });
  const supplies = rj<{ code: string; ziNumbers: string[]; savedOn: string }[]>("zi-supplies.json");
  const priceDiffs = rj<{ article: string; orderPrice: number; invoicePrice: number; diff: number }[]>("zi-price-diffs.json");

  const lines = await prisma.shipmentLine.findMany({
    where: { shipmentId: sh.id },
    include: { reworks: true, productionOrder: { select: { number: true, workOrderNumber: true, productModel: { select: { name: true, salesCode: true } } } } },
    orderBy: [{ itemNo: "asc" }],
  });
  const m = matchZi(zi, lines.map((l) => ({ id: l.id, code: l.productionOrder?.productModel.salesCode ?? l.customArticle ?? "", size: l.size, color: l.color, quantity: l.quantity })));
  console.log(`\nНакладных строк: ${zi.length} шт. (${supplies.map((s) => `${s.code}: ${zi.filter((z) => z.supply === s.code).length}`).join(", ")}); не нашли пары в отгрузке: ${m.unmatched.length}`);
  for (const u of m.unmatched) console.log(`  без пары: ${u.supply} ${u.boutique} ${u.article} р.${u.size}`);
  const planQty = lines.reduce((t, l) => t + l.quantity, 0);
  console.log(`Отгрузка: строк ${lines.length}, ${planQty} шт.\n`);
  console.log("ТЗ · артикул · цвет · размер × план → в накладных · итог · поставка · бутик · стадия до → после");
  let acc = 0, rej = 0; const csv = ["тз;артикул;цвет;размер;план;в_накладных;итог;поставки;бутики;сумма_без_ндс;стадия_до;стадия_после"];
  const toWrite: { l: (typeof lines)[number]; qty: number; toReady: boolean }[] = [];
  for (const l of lines) {
    const f = m.byLine.get(l.id);
    const qty = f?.qty ?? 0;
    const st = ziStatus(l.quantity, qty);
    const full = qty >= l.quantity;
    const toReady = l.stage === "REWORK" && full; // вошло целиком — снимаем «на доработке»
    const stageAfter = toReady ? "READY" : l.stage;
    acc += qty; rej += l.quantity - qty;
    const tz = `${l.productionOrder?.workOrderNumber ?? "—"}/${l.productionOrder?.number ?? "—"}`;
    console.log(`${tz} · ${l.productionOrder?.productModel.salesCode ?? l.customArticle} · ${l.color ?? "—"} · ${l.size ?? "—"} × ${l.quantity} → ${qty} · ${ZI_STATUS_LABEL[st]} · ${f?.supplies.join(",") ?? "—"} · ${f?.boutiques.join(",") ?? "—"} · ${l.stage} → ${stageAfter}${l.stage !== "READY" && !toReady ? "  [ВНИМАНИЕ: не READY и не целиком — не пишется]" : ""}`);
    csv.push([tz, l.productionOrder?.productModel.salesCode ?? l.customArticle, l.color, l.size, l.quantity, qty, ZI_STATUS_LABEL[st], f?.supplies.join(","), f?.boutiques.join(","), f ? f.sum.toFixed(2) : "", l.stage, stageAfter].join(";"));
    if (l.stage === "READY" || toReady) toWrite.push({ l, qty, toReady });
  }
  const sumNoVat = zi.reduce((t, z) => t + z.sum, 0), sumVat = zi.reduce((t, z) => t + z.vat, 0);
  console.log(`\nИтог: принято (в накладных) ${acc} из ${planQty} шт., не принято ${rej} шт.; сумма накладных без НДС ${money(sumNoVat)} ₽, НДС ${money(sumVat)} ₽.`);
  writeFileSync(join(SRC, "plan-vs-fact.csv"), csv.join("\n") + "\n");
  const before = { rows: lines.length, ready: lines.filter((l) => l.stage === "READY").length, readyQty: lines.filter((l) => l.stage === "READY").reduce((t, l) => t + l.quantity, 0), accepted: lines.reduce((t, l) => t + (l.acceptedQty ?? 0), 0), returned: lines.reduce((t, l) => t + (l.returnedQty ?? 0), 0) };
  const afterReadyQty = toWrite.reduce((t, w) => t + w.l.quantity, 0);
  console.log(`До: строк ${before.rows}, к отгрузке ${before.readyQty} шт. (${before.ready} строк), принято ${before.accepted}, не принято ${before.returned}.`);
  console.log(`После: строк ${before.rows}, к отгрузке ${afterReadyQty} шт. (${toWrite.length} строк), принято ${acc}, не принято ${rej}.`);
  if (m.unmatched.length) { console.log("Есть накладные строки без пары — запись отменена, разберите вручную."); process.exitCode = 1; return; }
  if (!APPLY) return console.log("\nпробный прогон: БД не тронута (--apply запишет; на боевой нужен ещё --live)");

  if (dbName === "fur_erp") execSync("bash scripts/backup.sh", { stdio: "inherit", cwd: join(__dirname, "..") });
  const owner = await prisma.user.findFirstOrThrow({ where: { organizationId: org.id, role: "OWNER", isActive: true }, select: { id: true } });
  const shRow = await prisma.shipment.findFirstOrThrow({ where: { id: sh.id }, select: { status: true, acceptedAt: true, acceptedBy: true, acceptEventId: true } });
  if (shRow.acceptedAt) { console.log("Приёмка уже подтверждена — ничего не меняю."); return; }
  const accEv = await prisma.shipmentEvent.findFirst({ where: { shipmentId: sh.id, expected: true, title: "Приёмка в Коптево" } });
  if (!accEv) throw new Error("нет ожидаемого этапа «Приёмка в Коптево»");
  const existing = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: org.id, key: KEY } }, select: { value: true } });
  const journal: Journal = {
    at: new Date().toISOString(), db: dbName, shipmentId: sh.id,
    lines: toWrite.map(({ l }) => ({ id: l.id, stage: l.stage, stageChangedAt: l.stageChangedAt ? l.stageChangedAt.toISOString() : null, stageChangedBy: l.stageChangedBy, acceptedQty: l.acceptedQty, returnedQty: l.returnedQty, comment: l.comment })),
    reworks: toWrite.filter((w) => w.toReady).flatMap((w) => w.l.reworks.map((r) => ({ id: r.id, state: r.state, note: r.note }))),
    eventId: null, zi: { existed: !!existing, value: existing?.value ?? null },
    accept: accEv ? { eventId: accEv.id, expected: accEv.expected, details: accEv.details, updatedById: accEv.updatedById } : null,
    shipment: { status: shRow.status, acceptedAt: null, acceptedBy: shRow.acceptedBy, acceptEventId: shRow.acceptEventId },
  };
  mkdirSync(INVDIR, { recursive: true });
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 1)); // журнал — до записи в БД
  const details = [
    ...supplies.map((s) => `${s.code}: ЗИ ${s.ziNumbers.join(", ")} — ${zi.filter((z) => z.supply === s.code).length} шт.`),
    `Всего в накладных ${acc} из ${planQty} шт. отгрузки; не вошло ${rej} шт. (${[...new Set(toWrite.filter((w) => w.qty < w.l.quantity).map((w) => w.l.productionOrder?.productModel.salesCode))].join(", ") || "—"}).`,
    "Файлы накладных сохранены 14.10.2026.",
  ].join("\n");
  const ev = await prisma.$transaction(async (tx) => {
    for (const { l, qty, toReady } of toWrite) {
      const notIn = l.quantity - qty;
      const comment = notIn > 0 ? [l.comment, MISSING_NOTE].filter(Boolean).join(" · ") : l.comment;
      await tx.shipmentLine.update({ where: { id: l.id }, data: { acceptedQty: qty, returnedQty: notIn, comment, ...(toReady ? { stage: "READY", stageChangedAt: STAGE_AT, stageChangedBy: STAGE_BY } : {}) } });
      if (toReady) for (const r of l.reworks) await tx.shipmentLineRework.update({ where: { id: r.id }, data: { state: "DONE", note: REWORK_DONE_NOTE, updatedById: owner.id } });
    }
    const data = { version: 1, sourceNote: "Накладные ЦУМ ЗИ по поставкам 21М, 22М, 23М (Excel, сохранены 14.10.2026)", supplies, lines: zi, priceDiffs };
    await tx.systemState.upsert({ where: { organizationId_key: { organizationId: org.id, key: KEY } }, create: { organizationId: org.id, key: KEY, value: data as never }, update: { value: data as never } });
    await tx.shipmentEvent.update({ where: { id: accEv.id }, data: { expected: false, details: [`Принято ${acc} из ${planQty}, возврат ${rej}`, "По накладным ЦУМ (ЗИ 21М, 22М, 23М): не принято — нет в накладных (M018, 6 шт.); причина по документам не названа."].join("\n"), updatedById: owner.id } });
    await tx.shipment.update({ where: { id: sh.id }, data: { acceptedAt: accEv.occurredAt, acceptedBy: "по накладным ЦУМ (ЗИ)", acceptEventId: accEv.id, status: "ACCEPTED" } });
    return tx.shipmentEvent.create({ data: { shipmentId: sh.id, title: EVENT_TITLE, occurredAt: new Date("2026-10-14T00:00:00.000Z"), timeKnown: false, side: "CUM", place: "ЦУМ", details, expected: false, createdById: owner.id }, select: { id: true } });
  });
  journal.eventId = ev.id;
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 1));
  console.log(`\nзаписано. Журнал: ${JOURNAL}`);
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(1); });
