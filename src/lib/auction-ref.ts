import "server-only";
import { prisma } from "@/lib/prisma";
import {
  confirmAuctionsIn, createAuctionIn, deleteAuctionIn, displayAuctionNameIn, loadAuctionOptionsIn, mergeAuctionsIn, renameAuctionIn,
  resolveAuctionIn, updateAuctionFieldsIn, type AuctionInput,
} from "@/lib/auction-ref-core";

export * from "@/lib/auction-ref-core";
export { auctionKey } from "@/lib/auction-key";

/** Найти аукцион организации по имени или прежнему написанию. */
export const resolveAuction = (text: string | null | undefined, orgId: string) => resolveAuctionIn(prisma, text, orgId);

/** Аукционы для фильтров и форм: id, имя, дом, год, подтверждён, число закупок, сумма. */
export const loadAuctionOptions = (orgId: string) => loadAuctionOptionsIn(prisma, orgId);

/** Короткое имя по тексту из старых полей (для подписей страниц, Фаза 2). По умолчанию — только подтверждённые имена. */
export async function displayAuctionName(text: string | null | undefined, orgId: string, opts: { onlyConfirmed?: boolean } = { onlyConfirmed: true }) {
  const list = await prisma.auction.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, aliases: true, isService: true, confirmed: true } });
  return displayAuctionNameIn(text, list, opts);
}

export const createAuction = (orgId: string, input: AuctionInput) => createAuctionIn(prisma, orgId, input);
export const renameAuction = (orgId: string, id: string, newName: string) => renameAuctionIn(prisma, orgId, id, newName);
export const mergeAuctions = (orgId: string, fromId: string, intoId: string) => mergeAuctionsIn(prisma, orgId, fromId, intoId);
export const confirmAuctions = (orgId: string, ids: string[]) => confirmAuctionsIn(prisma, orgId, ids);
export const updateAuctionFields = (orgId: string, id: string, data: Parameters<typeof updateAuctionFieldsIn>[3]) => updateAuctionFieldsIn(prisma, orgId, id, data);
export const deleteAuction = (orgId: string, id: string) => deleteAuctionIn(prisma, orgId, id);
