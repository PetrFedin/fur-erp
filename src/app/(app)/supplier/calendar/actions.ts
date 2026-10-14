"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSupplierSession } from "@/lib/supplier-inbox";
import { parseDateInput } from "@/lib/input";
import { modelCodeVariants } from "@/lib/model-code";
import { isFinalSupStage, isSupStage, nextSupStage, supStage } from "@/lib/supplier-calendar";
import { parseLaunchTable, type ImportRow } from "@/lib/supplier-calendar-import";
import { invalidateControlCounts } from "@/lib/control-counts";

export type CalState = { error?: string; ok?: boolean };
export type PreviewState = { error?: string; rows?: (ImportRow & { problem?: string })[]; skipped?: number; done?: string };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const today = () => new Date().toISOString().slice(0, 10);

function done() {
  revalidatePath("/supplier/calendar");
  revalidatePath("/calendar");
}

type S = Awaited<ReturnType<typeof requireSupplierSession>>;
/** Только записи этого поставщика в этой организации. */
const mine = (s: S, id: string) => ({ id, organizationId: s.user.organizationId, supplierId: s.user.supplierId });

async function findModel(orgId: string, code: string) {
  // «М001Е» кириллицей и «M001E» латиницей — один и тот же артикул.
  return prisma.productModel.findFirst({ where: { organizationId: orgId, isActive: true, OR: modelCodeVariants(code).map((v) => ({ name: { equals: v, mode: "insensitive" as const } })) }, select: { name: true, salesName: true } });
}

type Fields = { articleCode: string; color: string; size: string; quantity: number; status: string; planDate: string; factDate: string; notes: string; docNote: string };

/** Проверка полей одной записи; возвращает данные для базы или текст ошибки. */
async function check(s: S, f: Fields) {
  if (!f.articleCode) return { error: "Выберите артикул" } as const;
  const model = await findModel(s.user.organizationId, f.articleCode);
  if (!model) return { error: `Артикула «${f.articleCode}» нет в справочнике` } as const;
  if (!Number.isInteger(f.quantity) || f.quantity < 1 || f.quantity > 100000) return { error: "Количество — целое число от 1" } as const;
  if (!isSupStage(f.status)) return { error: "Выберите этап" } as const;
  const date = parseDateInput(f.planDate);
  if (!date) return { error: "Укажите плановую дату" } as const;
  const fact = f.factDate ? parseDateInput(f.factDate) : null;
  if (f.factDate && !fact) return { error: "Фактическая дата указана неверно" } as const;
  return {
    data: {
      date, factDate: fact, articleCode: model.name, articleName: model.salesName ?? null, quantity: f.quantity,
      color: f.color || null, size: f.size || null, status: f.status, action: supStage(f.status).label,
      notes: f.notes || null, docNote: f.docNote || null,
      doneAt: isFinalSupStage(f.status) ? (fact ?? new Date()) : null,
    },
  } as const;
}

const read = (fd: FormData): Fields => ({
  articleCode: clip(fd.get("articleCode"), 100), color: clip(fd.get("color"), 100), size: clip(fd.get("size"), 20),
  quantity: Number(String(fd.get("quantity") ?? "").replace(",", ".")), status: clip(fd.get("status"), 20),
  planDate: clip(fd.get("planDate"), 10), factDate: clip(fd.get("factDate"), 10), notes: clip(fd.get("notes"), 1000), docNote: clip(fd.get("docNote"), 60),
});

/** Добавить запись (без id) или исправить свою (с id). Сразу видна у нас в «Календаре». */
export async function saveEntry(_prev: CalState, fd: FormData): Promise<CalState> {
  const s = await requireSupplierSession();
  const id = clip(fd.get("id"), 64);
  const r = await check(s, read(fd));
  if ("error" in r) return { error: r.error };
  if (id) {
    if (!ID.test(id)) return { error: "Запись не найдена" };
    const u = await prisma.calendarEvent.updateMany({ where: mine(s, id), data: r.data });
    if (u.count !== 1) return { error: "Запись не найдена или принадлежит не вам" };
  } else {
    await prisma.calendarEvent.create({ data: { ...r.data, organizationId: s.user.organizationId, supplierId: s.user.supplierId, createdById: s.user.id } });
  }
  invalidateControlCounts(s.user.organizationId);
  done();
  return { ok: true };
}

/** «→ следующий этап»: этап сдвигается на шаг, фактическая дата = сегодня. */
export async function advanceEntry(id: string): Promise<CalState> {
  const s = await requireSupplierSession();
  if (!ID.test(id)) return { error: "Запись не найдена" };
  const cur = await prisma.calendarEvent.findFirst({ where: mine(s, id), select: { status: true } });
  if (!cur) return { error: "Запись не найдена" };
  const next = nextSupStage(cur.status);
  if (!next) return { error: "Это последний этап" };
  const now = new Date(`${today()}T00:00:00.000Z`);
  await prisma.calendarEvent.updateMany({
    where: { ...mine(s, id), status: cur.status },
    data: { status: next.key, action: next.label, factDate: now, doneAt: isFinalSupStage(next.key) ? new Date() : null },
  });
  done();
  return { ok: true };
}

export async function deleteEntry(id: string): Promise<CalState> {
  const s = await requireSupplierSession();
  if (!ID.test(id)) return { error: "Запись не найдена" };
  const r = await prisma.calendarEvent.deleteMany({ where: mine(s, id) });
  if (r.count !== 1) return { error: "Запись уже удалена" };
  done();
  return { ok: true };
}

/** Загрузка Excel: только разбор и проверка, в базу ничего не пишется. */
export async function previewImport(_prev: PreviewState, fd: FormData): Promise<PreviewState> {
  const s = await requireSupplierSession();
  const f = fd.get("file");
  if (typeof f === "string" || !f || f.size === 0) return { error: "Выберите файл Excel" };
  if (f.size > 10 * 1024 * 1024) return { error: "Файл больше 10 МБ" };
  const p = await parseLaunchTable(Buffer.from(await f.arrayBuffer()));
  if (p.error) return { error: p.error };
  const known = new Map<string, boolean>();
  const rows: (ImportRow & { problem?: string })[] = [];
  for (const r of p.rows.slice(0, 1000)) {
    const key = r.articleCode.toLowerCase();
    if (!known.has(key)) known.set(key, !!(await findModel(s.user.organizationId, r.articleCode)));
    rows.push(known.get(key) ? r : { ...r, problem: "артикула нет в справочнике" });
  }
  if (rows.length === 0) return { error: "В файле не нашли строк с датой и этапом" };
  return { rows, skipped: p.skipped };
}

/** Подтверждение импорта: строки проверяются заново на сервере, записываются только годные. */
export async function confirmImport(rowsJson: string): Promise<PreviewState> {
  const s = await requireSupplierSession();
  let rows: ImportRow[];
  try { rows = JSON.parse(rowsJson); } catch { return { error: "Не удалось прочитать данные" }; }
  if (!Array.isArray(rows) || rows.length > 1000) return { error: "Слишком много строк" };
  const data = [];
  let bad = 0;
  for (const r of rows) {
    const c = await check(s, { articleCode: clip(r.articleCode, 100), color: clip(r.color, 100), size: clip(r.size, 20), quantity: Number(r.quantity) || 1, status: clip(r.status, 20), planDate: clip(r.planDate, 10), factDate: clip(r.factDate, 10), notes: clip(r.notes, 1000), docNote: "" });
    if ("error" in c) { bad++; continue; }
    data.push({ ...c.data, organizationId: s.user.organizationId, supplierId: s.user.supplierId, createdById: s.user.id });
  }
  if (data.length) await prisma.calendarEvent.createMany({ data });
  done();
  return { done: `Загружено записей: ${data.length}${bad ? `, пропущено: ${bad}` : ""}` };
}

