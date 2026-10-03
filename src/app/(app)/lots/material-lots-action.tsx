"use server";

import { requireSession } from "@/lib/session";
import { cleanSearch } from "@/lib/input";
import { MaterialLots } from "./material-lots";

/** Лоты одного материала для раскрытия строки на странице «Сырьё» (организация — из сессии, не от клиента). */
export async function loadMaterialLots(materialId: string, q: string) {
  const session = await requireSession();
  return <MaterialLots organizationId={session.user.organizationId} materialId={cleanSearch(materialId)} q={cleanSearch(q)} />;
}
