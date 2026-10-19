import "server-only";
// «Загрузка данных»: предпросмотр, применение, журнал и откат. Работает с любым клиентом Prisma (в приложении — расширенный prisma с аудитом,
// в тестах — createAuditedClient на копии базы). Ничего не знает про Next (revalidate — в actions.ts).
import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  ImportFormatError, asPriceRows, asSizeRows, diffPrices, diffSales, diffSizes, openWorkbook, parsePhotosWorkbook, parsePricesWorkbook, parseSalesWorkbook, parseSizesWorkbook, previewPhotos, sha256,
  type Counts, type ImportKind, type PartPreview, type PartType, type SalesRowDb,
} from "@/lib/import-core";
import { JOURNAL_PREFIX, RETAIL_PREFIX, SIZES_PREFIX, pointerKey, resolveVersioned, versionKey } from "@/lib/import-keys";
import { PHOTOS_KEY, readPhotos } from "@/lib/article-photos";
import type { ParsedLine } from "@/lib/sales-receipts-core";

export { ImportFormatError };
export type Actor = { id: string; name: string | null };
export type ImportPreview = {
  kind: ImportKind; fileName: string; size: number; sha256: string; asOf: string;
  parts: PartPreview[]; blocked: boolean; nothing: boolean; canApply: boolean;
};
export type ApplyResult = { journalId: string | null; summary: string[]; parts: { type: PartType; counts: Counts }[] };

type VersionOp = { type: "prices" | "sizes"; prefix: string; key: string; value: unknown };
type Plan = {
  preview: ImportPreview;
  sales?: { added: ParsedLine[]; changed: { line: ParsedLine; row: SalesRowDb; fields: string[] }[]; removed: SalesRowDb[] };
  versions: VersionOp[];
};

export type Journal = {
  id: string; kind: ImportKind; at: string; byId: string; byName: string | null;
  file: { name: string; size: number; sha256: string };
  status: "applied" | "rolled-back"; removeMissing: boolean; asOf: string;
  parts: { type: PartType; counts: Counts }[]; summary: string[];
  sales?: { created: string[]; updated: { id: string; before: Record<string, unknown> }[]; deleted: Record<string, unknown>[] };
  versions?: { type: "prices" | "sizes"; key: string; pointer: string; hadBefore: boolean; before: unknown; pointerBefore: unknown | null }[];
  rolledBackAt?: string; rolledBackById?: string; rolledBackByName?: string | null;
};

type Db = PrismaClient;
const cid = () => "c" + randomBytes(12).toString("hex");
export const moscowDay = (d = new Date()) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
const num = (d: { toNumber(): number } | null | undefined) => (d == null ? null : d.toNumber());

async function loadSalesDb(db: Db | Prisma.TransactionClient, orgId: string): Promise<{ rows: SalesRowDb[]; raw: Map<string, Record<string, unknown>> }> {
  const full = await db.salesReceiptLine.findMany({ where: { organizationId: orgId } });
  const raw = new Map<string, Record<string, unknown>>();
  const rows = full.map((r) => {
    raw.set(r.id, JSON.parse(JSON.stringify(r)) as Record<string, unknown>);
    return {
      id: r.id, sourceKey: r.sourceKey, kind: r.kind, orderNo: r.orderNo, season: r.season, article: r.article, fabric: r.fabric, colorId: r.colorId, modelCode: r.modelCode,
      level2: r.level2, level3: r.level3, level4: r.level4, level5: r.level5, date: r.date, pcs: r.pcs,
      retailEur: num(r.retailEur), retailEurExVat: num(r.retailEurExVat), retailRub: num(r.retailRub), retailRubExVat: num(r.retailRubExVat),
      discountEur: num(r.discountEur), discountEurExVat: num(r.discountEurExVat), discountRub: num(r.discountRub), discountRubExVat: num(r.discountRubExVat),
    } satisfies SalesRowDb;
  });
  return { rows, raw };
}

async function buildPlan(db: Db, orgId: string, kind: ImportKind, fileName: string, buf: Buffer, removeMissing: boolean, asOf: string): Promise<Plan> {
  const wb = await openWorkbook(buf, fileName);
  const models = await db.productModel.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, salesCode: true } });
  const parts: PartPreview[] = [];
  const plan: Plan = { preview: { kind, fileName, size: buf.length, sha256: sha256(buf), asOf, parts, blocked: false, nothing: true, canApply: false }, versions: [] };
  let wantChange = false;

  if (kind === "sales") {
    const parsed = parseSalesWorkbook(wb);
    const { rows } = await loadSalesDb(db, orgId);
    const d = diffSales(parsed, rows, models, removeMissing);
    parts.push(d.part);
    plan.sales = { added: d.added, changed: d.changed, removed: d.removed };
    wantChange = d.added.length + d.changed.length > 0 || (removeMissing && d.removed.length > 0);
  } else if (kind === "prices") {
    const pricesFile = parsePricesWorkbook(wb, models);
    const sizesFile = parseSizesWorkbook(wb);
    const curP = await resolveVersioned(db, orgId, RETAIL_PREFIX);
    const curS = await resolveVersioned(db, orgId, SIZES_PREFIX);
    const dp = diffPrices(pricesFile, asPriceRows(curP?.value), removeMissing);
    const ds = diffSizes(sizesFile, asSizeRows(curS?.value), removeMissing);
    parts.push(dp.part, ds.part);
    const pv = (curP?.value ?? {}) as { vatIncluded?: boolean; vatRatePct?: number };
    if (dp.changedAny) {
      plan.versions.push({ type: "prices", prefix: RETAIL_PREFIX, key: versionKey(RETAIL_PREFIX, asOf), value: { asOf, vatIncluded: pv.vatIncluded ?? true, vatRatePct: pv.vatRatePct ?? 22, source: `${fileName}, лист «Current Price»`, rows: dp.merged } });
      wantChange = true;
    }
    if (ds.changedAny) {
      plan.versions.push({ type: "sizes", prefix: SIZES_PREFIX, key: versionKey(SIZES_PREFIX, asOf), value: { asOf, source: `${fileName}, лист Report`, total: ds.total, rows: ds.merged } });
      wantChange = true;
    }
  } else {
    const cands = parsePhotosWorkbook(wb);
    const states = await db.systemState.findMany({ where: { organizationId: orgId, key: { startsWith: PHOTOS_KEY } }, select: { key: true, value: true } });
    const have = new Map(states.map((s) => [s.key.slice(PHOTOS_KEY.length), readPhotos(s.value)]));
    parts.push(previewPhotos(cands, models, have));
  }
  const p = plan.preview;
  p.blocked = parts.some((x) => x.errors.length > 0);
  p.nothing = !wantChange;
  p.canApply = kind !== "photos" && !p.blocked && wantChange;
  return plan;
}

/** Пробный прогон: БД не меняется. */
export async function buildPreview(db: Db, orgId: string, kind: ImportKind, fileName: string, buf: Buffer, removeMissing = false, asOf = moscowDay()): Promise<ImportPreview> {
  return (await buildPlan(db, orgId, kind, fileName, buf, removeMissing, asOf)).preview;
}

const lineData = (l: ParsedLine) => ({
  orderNo: l.orderNo, season: l.season, article: l.article, fabric: l.fabric, colorId: l.colorId, modelCode: l.modelCode, level2: l.level2, level3: l.level3, level4: l.level4, level5: l.level5,
  date: new Date(l.iso + "T00:00:00.000Z"), pcs: l.pcs, retailEur: l.retailEur, retailEurExVat: l.retailEurExVat, retailRub: l.retailRub, retailRubExVat: l.retailRubExVat,
  discountEur: l.discountEur, discountEurExVat: l.discountEurExVat, discountRub: l.discountRub, discountRubExVat: l.discountRubExVat,
});

const newJournalId = () => new Date().toISOString().replace(/\D/g, "").slice(0, 14) + "-" + randomBytes(2).toString("hex");

/** Применение: пересчитывает различия заново (файл от клиента не доверенный), пишет журнал и данные одной транзакцией. */
export async function applyImport(db: Db, orgId: string, actor: Actor, kind: ImportKind, fileName: string, buf: Buffer, opts: { removeMissing?: boolean; expectSha?: string; asOf?: string } = {}): Promise<ApplyResult> {
  if (kind === "photos") throw new ImportFormatError("Фото только для просмотра: запись спорных пар не делается автоматически");
  const removeMissing = !!opts.removeMissing;
  const asOf = opts.asOf ?? moscowDay();
  const plan = await buildPlan(db, orgId, kind, fileName, buf, removeMissing, asOf);
  const pv = plan.preview;
  if (opts.expectSha && opts.expectSha !== pv.sha256) throw new ImportFormatError("Файл изменился после проверки — проверьте его заново");
  if (pv.blocked) throw new ImportFormatError("В файле есть ошибки — загрузка не выполнена, база не изменена");
  const counts = pv.parts.map((p) => ({ type: p.type, counts: p.counts }));
  if (pv.nothing) return { journalId: null, summary: ["Изменений нет — загружать нечего"], parts: counts };

  const id = newJournalId();
  const summary: string[] = [];
  const journal: Journal = {
    id, kind, at: new Date().toISOString(), byId: actor.id, byName: actor.name, file: { name: fileName, size: buf.length, sha256: pv.sha256 },
    status: "applied", removeMissing, asOf, parts: counts, summary,
  };

  await db.$transaction(async (tx) => {
    if (plan.sales) {
      const { raw } = await loadSalesDb(tx, orgId);
      const s = plan.sales;
      const created = s.added.map(() => cid());
      journal.sales = { created, updated: s.changed.map((c) => ({ id: c.row.id, before: raw.get(c.row.id)! })), deleted: removeMissing ? s.removed.map((r) => raw.get(r.id)!) : [] };
      if (s.added.length) {
        await tx.salesReceiptLine.createMany({
          data: s.added.map((l, i) => ({ id: created[i], organizationId: orgId, sourceKey: l.sourceKey, kind: l.kind, ...lineData(l), importTag: `sales-import:${id}` })),
        });
      }
      for (const c of s.changed) await tx.salesReceiptLine.update({ where: { id: c.row.id }, data: lineData(c.line) });
      if (removeMissing && s.removed.length) await tx.salesReceiptLine.deleteMany({ where: { organizationId: orgId, id: { in: s.removed.map((r) => r.id) } } });
      // Контроль после записи: заново сравниваем файл с базой — должно быть 0 новых и 0 изменённых.
      const wb = await openWorkbook(buf, fileName);
      const models = await tx.productModel.findMany({ where: { organizationId: orgId }, select: { name: true, salesCode: true } });
      const after = diffSales(parseSalesWorkbook(wb), (await loadSalesDb(tx, orgId)).rows, models, removeMissing);
      if (after.added.length || after.changed.length || (removeMissing && after.removed.length)) throw new Error("После записи база не совпала с файлом — откат транзакции.");
      const c = pv.parts[0].counts;
      summary.push(`Поступления и продажи: ${c.added} новых, ${c.changed} изменено${removeMissing ? `, ${c.removed} удалено` : ""}`);
    }
    if (plan.versions.length) {
      journal.versions = [];
      for (const v of plan.versions) {
        const ex = await tx.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: v.key } }, select: { value: true } });
        const ptr = await tx.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: pointerKey(v.prefix) } }, select: { value: true } });
        journal.versions.push({ type: v.type, key: v.key, pointer: pointerKey(v.prefix), hadBefore: !!ex, before: (ex?.value as unknown) ?? null, pointerBefore: (ptr?.value as unknown) ?? null });
        const value = v.value as Prisma.InputJsonValue;
        await tx.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key: v.key } }, create: { organizationId: orgId, key: v.key, value }, update: { value } });
        const pointer = { key: v.key, asOf, at: journal.at } as Prisma.InputJsonValue;
        await tx.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key: pointerKey(v.prefix) } }, create: { organizationId: orgId, key: pointerKey(v.prefix), value: pointer }, update: { value: pointer } });
        const c = pv.parts.find((p) => p.type === v.type)!.counts;
        summary.push(`${v.type === "prices" ? "Прайс розницы" : "Размеры из отчёта"} на ${asOf.split("-").reverse().join(".")}: ${c.added} новых, ${c.changed} изменено${removeMissing ? `, ${c.removed} удалено` : ""}`);
      }
    }
    // Журнал — в той же транзакции: нет записи данных без журнала и журнала без данных.
    await tx.systemState.create({ data: { organizationId: orgId, key: JOURNAL_PREFIX + id, value: journal as unknown as Prisma.InputJsonValue } });
  }, { timeout: 120000, maxWait: 30000 });
  return { journalId: id, summary, parts: counts };
}

async function readJournal(db: Db, orgId: string, id: string): Promise<Journal | null> {
  const st = await db.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: JOURNAL_PREFIX + id } }, select: { value: true } });
  return (st?.value as unknown as Journal | null) ?? null;
}

export type HistoryItem = {
  id: string; kind: ImportKind; at: string; byName: string | null; fileName: string; asOf: string; status: "applied" | "rolled-back";
  parts: { type: PartType; counts: Counts }[]; summary: string[]; canRollback: boolean; rolledBackAt?: string;
};

export async function listHistory(db: Db, orgId: string, limit = 30): Promise<HistoryItem[]> {
  const st = await db.systemState.findMany({ where: { organizationId: orgId, key: { startsWith: JOURNAL_PREFIX } }, select: { value: true }, orderBy: { key: "desc" }, take: limit });
  const js = st.map((s) => s.value as unknown as Journal);
  const latest = new Map<ImportKind, string>();
  for (const j of js) if (j.status === "applied" && !latest.has(j.kind)) latest.set(j.kind, j.id);
  return js.map((j) => ({
    id: j.id, kind: j.kind, at: j.at, byName: j.byName, fileName: j.file.name, asOf: j.asOf, status: j.status, parts: j.parts, summary: j.summary,
    canRollback: j.status === "applied" && latest.get(j.kind) === j.id, rolledBackAt: j.rolledBackAt,
  }));
}

const DATE_FIELDS = new Set(["date", "createdAt"]);
function rowForDb(r: Record<string, unknown>, withKeys: boolean) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (!withKeys && (k === "id" || k === "organizationId" || k === "createdAt")) continue;
    out[k] = DATE_FIELDS.has(k) && typeof v === "string" ? new Date(v) : v;
  }
  return out;
}

/** Откат загрузки по журналу: возвращает прежние значения изменённых строк, удаляет добавленные, восстанавливает удалённые и версии прайса/размеров. */
export async function rollbackImport(db: Db, orgId: string, actor: Actor, journalId: string): Promise<string[]> {
  const j = await readJournal(db, orgId, journalId);
  if (!j) throw new ImportFormatError("Запись о загрузке не найдена");
  if (j.status !== "applied") throw new ImportFormatError("Эта загрузка уже откачена");
  const hist = await listHistory(db, orgId, 200);
  if (!hist.find((h) => h.id === journalId)?.canRollback) throw new ImportFormatError("Сначала откатите более позднюю загрузку этого раздела");
  const out: string[] = [];
  await db.$transaction(async (tx) => {
    if (j.sales) {
      const del = await tx.salesReceiptLine.deleteMany({ where: { organizationId: orgId, id: { in: j.sales.created } } });
      for (const u of j.sales.updated) {
        await tx.salesReceiptLine.update({ where: { id: u.id }, data: rowForDb(u.before, false) as Prisma.SalesReceiptLineUncheckedUpdateInput });
      }
      if (j.sales.deleted.length) await tx.salesReceiptLine.createMany({ data: j.sales.deleted.map((r) => rowForDb(r, true) as Prisma.SalesReceiptLineCreateManyInput) });
      out.push(`Поступления и продажи: удалено добавленных ${del.count}, возвращено изменённых ${j.sales.updated.length}, восстановлено удалённых ${j.sales.deleted.length}`);
    }
    for (const v of j.versions ?? []) {
      if (v.hadBefore) {
        const value = v.before as Prisma.InputJsonValue;
        await tx.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key: v.key } }, create: { organizationId: orgId, key: v.key, value }, update: { value } });
      } else await tx.systemState.deleteMany({ where: { organizationId: orgId, key: v.key } });
      if (v.pointerBefore == null) await tx.systemState.deleteMany({ where: { organizationId: orgId, key: v.pointer } });
      else {
        const value = v.pointerBefore as Prisma.InputJsonValue;
        await tx.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key: v.pointer } }, create: { organizationId: orgId, key: v.pointer, value }, update: { value } });
      }
      out.push(`${v.type === "prices" ? "Прайс розницы" : "Размеры из отчёта"}: возвращена прежняя версия`);
    }
    const done = { ...j, status: "rolled-back", rolledBackAt: new Date().toISOString(), rolledBackById: actor.id, rolledBackByName: actor.name } as Journal;
    await tx.systemState.update({ where: { organizationId_key: { organizationId: orgId, key: JOURNAL_PREFIX + journalId } }, data: { value: done as unknown as Prisma.InputJsonValue } });
  }, { timeout: 120000, maxWait: 30000 });
  return out;
}
