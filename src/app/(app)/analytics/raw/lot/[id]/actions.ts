"use server";

// Правка карточки лота по месту: описание лота (через существующий updateLotMeta), признаки меха и заметки к расчётному листу.
// Цена, количество, НДС, поставщик, накладные лота здесь НЕ правятся: после приёмки в приложении нет безопасного пересчёта
// (updatePurchaseItem запрещает менять их у лота со списаниями и у позиций с расчётным листом) — они правятся в закупке.
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { revalidateAll } from "@/lib/revalidate-all";
import { rowVersion, LOT_V, VERSION_FIELD } from "@/lib/concurrency";
import { updateLotMeta } from "@/app/(app)/purchases/actions";
import { isCompCat } from "@/lib/lot-sheet";

const ROLES = ["OWNER", "ADMIN", "PURCHASER", "WAREHOUSE"] as const;
type Res = { error?: string };

export type LotPatch = {
  lotNumber?: string;
  grade?: string;
  sizeGrade?: string;
  notes?: string;
  color?: { text: string; refId: string };
};

/** Меняет одно или несколько описательных полей лота; остальные берутся из базы как есть. */
export async function saveLotFields(lotId: string, patch: LotPatch): Promise<Res> {
  const session = await requireRole(...ROLES);
  const lot = await prisma.rawMaterialLot.findFirst({
    where: { id: lotId, organizationId: session.user.organizationId },
    select: { lotNumber: true, grade: true, sizeGrade: true, color: true, colorRefId: true, notes: true },
  });
  if (!lot) return { error: "Лот не найден" };
  const fd = new FormData();
  fd.set("lotNumber", patch.lotNumber ?? lot.lotNumber ?? "");
  fd.set("grade", patch.grade ?? lot.grade ?? "");
  fd.set("sizeGrade", patch.sizeGrade ?? lot.sizeGrade ?? "");
  fd.set("notes", patch.notes ?? lot.notes ?? "");
  fd.set("color", patch.color ? patch.color.text : lot.color ?? "");
  fd.set("colorRefId", patch.color ? patch.color.refId : lot.colorRefId ?? "");
  fd.set(VERSION_FIELD, rowVersion(lot, LOT_V));
  const r = await updateLotMeta(lotId, fd);
  return r.error ? { error: r.error } : {};
}

const idsSchema = z.array(z.string().min(1).max(40)).max(30);

/** Признаки меха лота (седина, происхождение…): заменяет набор ссылок на справочник «Признаки меха». */
export async function saveLotAttrs(lotId: string, attrIds: string[]): Promise<Res> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const p = idsSchema.safeParse(attrIds);
  if (!p.success) return { error: "Некорректный список признаков" };
  const ids = Array.from(new Set(p.data));
  const lot = await prisma.rawMaterialLot.findFirst({ where: { id: lotId, organizationId: orgId }, select: { id: true } });
  if (!lot) return { error: "Лот не найден" };
  const refs = await prisma.furAttrRef.findMany({ where: { organizationId: orgId, id: { in: ids } }, select: { id: true } });
  if (refs.length !== ids.length) return { error: "Признак не найден в справочнике" };
  const cur = await prisma.rawMaterialLotAttr.findMany({ where: { lotId }, select: { attrId: true } });
  const have = new Set(cur.map((c) => c.attrId));
  const add = ids.filter((i) => !have.has(i));
  const del = cur.map((c) => c.attrId).filter((i) => !ids.includes(i));
  await prisma.$transaction([
    ...(del.length ? [prisma.rawMaterialLotAttr.deleteMany({ where: { lotId, attrId: { in: del } } })] : []),
    ...(add.length ? [prisma.rawMaterialLotAttr.createMany({ data: add.map((attrId) => ({ lotId, attrId, source: "manual" })) })] : []),
  ]);
  revalidateAll(orgId);
  return {};
}

const noteSchema = z.object({
  idx: z.number().int().min(0).max(500),
  title: z.string().trim().max(200),
  cat: z.string().max(20),
  src: z.string().trim().max(200),
});

/**
 * Заметки к строкам расчётного листа лота: название для показа, категория сектора, источник.
 * Подпись (label) и значение строки НЕ меняются: по ним считаются состав цены, молоток и $; цена лота не затрагивается.
 */
export async function saveLotSheetNotes(lotId: string, notes: { idx: number; title: string; cat: string; src: string }[]): Promise<Res> {
  const session = await requireRole(...ROLES);
  const orgId = session.user.organizationId;
  const p = z.array(noteSchema).max(500).safeParse(notes);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Проверьте поля расчёта" };
  const lot = await prisma.rawMaterialLot.findFirst({ where: { id: lotId, organizationId: orgId }, select: { costBreakdown: true } });
  if (!lot) return { error: "Лот не найден" };
  const bd = lot.costBreakdown as { items?: Record<string, unknown>[] } | null;
  if (!bd || !Array.isArray(bd.items)) return { error: "У лота нет собственного расчётного листа (расчёт взят из позиции закупки)" };
  const items = bd.items.map((x) => ({ ...x }));
  for (const n of p.data) {
    const it = items[n.idx];
    if (!it) return { error: "Строка расчёта не найдена — обновите страницу" };
    if (n.cat !== "" && !isCompCat(n.cat)) return { error: "Неизвестная категория сектора" };
    for (const k of ["title", "cat", "src"] as const) {
      const v = n[k];
      if (v === "" || (k === "title" && v === String(it.label ?? "").trim())) delete it[k];
      else it[k] = v;
    }
  }
  await prisma.rawMaterialLot.update({ where: { id: lotId }, data: { costBreakdown: { ...bd, items } as never } });
  revalidateAll(orgId);
  return {};
}
