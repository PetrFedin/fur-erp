"use server";

import { revalidatePath } from "next/cache";
import type { AuctionKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { invalidateFilterOptions } from "@/lib/filter-options";
import { AUCTION_V, rowVersion } from "@/lib/concurrency";
import {
  AuctionError, confirmAuctions, createAuction, deleteAuction, mergeAuctions, renameAuction, updateAuctionFields,
} from "@/lib/auction-ref";

export type AuctionResult = { ok?: string; error?: string };

const KINDS: AuctionKind[] = ["FUR", "LINING", "MATERIALS", "OTHER"];

function touch() {
  // Имя аукциона показывается в закупках, лотах, оплатах, документах и сверке — сбрасываем кэш всех страниц.
  revalidatePath("/", "layout");
  invalidateFilterOptions(); // варианты фильтра «Партия закупки» кэшируются на 30 с
}

function fail(e: unknown): AuctionResult {
  if (e instanceof AuctionError) return { error: e.message };
  console.error("[auctions]", e);
  return { error: "Не удалось сохранить: произошла ошибка на сервере. Данные не изменены — попробуйте ещё раз." };
}

const STALE = "Запись изменил другой пользователь — ваши правки не сохранены. Обновите страницу (F5) и внесите правки заново.";

async function stale(orgId: string, id: string, version: string | null | undefined): Promise<boolean> {
  if (!version) return false;
  const cur = await prisma.auction.findFirst({ where: { id, organizationId: orgId } });
  return !!cur && rowVersion(cur, AUCTION_V) !== version;
}

/** Переименование прямо в строке: имя обновится во всех местах одной транзакцией. */
export async function renameAuctionAction(id: string, name: string, version?: string): Promise<AuctionResult> {
  const session = await requireRole(...ACCESS.auctions);
  const orgId = session.user.organizationId;
  try {
    if (await stale(orgId, id, version)) return { error: STALE };
    const r = await renameAuction(orgId, id, name);
    touch();
    const n = r.synced.purchases + r.synced.payments + r.synced.documents;
    return { ok: `Имя «${r.auction.name}» сохранено${n ? `, обновлено записей: ${n}` : ""}` };
  } catch (e) {
    return fail(e);
  }
}

export async function confirmAuctionAction(id: string): Promise<AuctionResult> {
  const session = await requireRole(...ACCESS.auctions);
  try {
    const n = await confirmAuctions(session.user.organizationId, [id]);
    touch();
    return { ok: n ? "Имя подтверждено" : "Уже подтверждено" };
  } catch (e) {
    return fail(e);
  }
}

export async function confirmManyAction(ids: string[]): Promise<AuctionResult> {
  const session = await requireRole(...ACCESS.auctions);
  try {
    const n = await confirmAuctions(session.user.organizationId, ids.slice(0, 500));
    touch();
    return { ok: `Подтверждено имён: ${n}` };
  } catch (e) {
    return fail(e);
  }
}

export async function mergeAuctionAction(fromId: string, intoId: string): Promise<AuctionResult> {
  const session = await requireRole(...ACCESS.auctions);
  try {
    const r = await mergeAuctions(session.user.organizationId, fromId, intoId);
    touch();
    return { ok: `«${r.from.name}» объединён с «${r.into.name}»: перенесено закупок ${r.moved}` };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAuctionAction(id: string): Promise<AuctionResult> {
  const session = await requireRole(...ACCESS.auctions);
  try {
    const a = await deleteAuction(session.user.organizationId, id);
    touch();
    return { ok: `Аукцион «${a.name}» удалён` };
  } catch (e) {
    return fail(e);
  }
}

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
function intOrNull(v: FormDataEntryValue | null, lo: number, hi: number, what: string): number | null {
  const s = str(v);
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new AuctionError(`${what}: число от ${lo} до ${hi}`);
  return n;
}
function dateOrNull(v: FormDataEntryValue | null): Date | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new AuctionError("Дата аукциона указана неверно");
  return d;
}
function kindOf(v: FormDataEntryValue | null): AuctionKind {
  const s = str(v) as AuctionKind;
  return KINDS.includes(s) ? s : "FUR";
}
const aliasList = (raw: string) => raw.split(/[\n;]+/).map((x) => x.trim()).filter(Boolean);

/** «Добавить аукцион» (useActionState). */
export async function createAuctionAction(_prev: AuctionResult | null, fd: FormData): Promise<AuctionResult> {
  const session = await requireRole(...ACCESS.auctions);
  try {
    const a = await createAuction(session.user.organizationId, {
      name: str(fd.get("name")),
      fullName: str(fd.get("fullName")),
      house: str(fd.get("house")),
      kind: kindOf(fd.get("kind")),
      year: intOrNull(fd.get("year"), 2000, 2100, "Год"),
      month: intOrNull(fd.get("month"), 1, 12, "Месяц"),
      currency: str(fd.get("currency")).toUpperCase(),
      auctionDate: dateOrNull(fd.get("auctionDate")),
    });
    touch();
    return { ok: `Аукцион «${a.name}» добавлен` };
  } catch (e) {
    return fail(e);
  }
}

/** «+ Добавить аукцион» прямо из формы закупки: создаёт запись справочника (подтверждённую) и возвращает её. */
export async function createAuctionInline(name: string): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const session = await requireRole(...ACCESS.auctions);
  try {
    const a = await createAuction(session.user.organizationId, { name });
    touch();
    return { ok: true, id: a.id, name: a.name };
  } catch (e) {
    return { ok: false, error: fail(e).error ?? "Не удалось добавить аукцион" };
  }
}

/** Правка остальных полей в раскрытой строке (useActionState). */
export async function updateAuctionAction(_prev: AuctionResult | null, fd: FormData): Promise<AuctionResult> {
  const session = await requireRole(...ACCESS.auctions);
  const orgId = session.user.organizationId;
  const id = str(fd.get("id"));
  try {
    if (await stale(orgId, id, str(fd.get("_v")))) return { error: STALE };
    await updateAuctionFields(orgId, id, {
      fullName: str(fd.get("fullName")),
      house: str(fd.get("house")),
      kind: kindOf(fd.get("kind")),
      year: intOrNull(fd.get("year"), 2000, 2100, "Год"),
      month: intOrNull(fd.get("month"), 1, 12, "Месяц"),
      currency: str(fd.get("currency")).toUpperCase(),
      auctionDate: dateOrNull(fd.get("auctionDate")),
      note: str(fd.get("note")),
      isService: fd.get("isService") === "on",
      aliases: aliasList(str(fd.get("aliases"))),
    });
    touch();
    return { ok: "Сохранено" };
  } catch (e) {
    return fail(e);
  }
}
