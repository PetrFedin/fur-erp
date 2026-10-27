import "server-only";
import { prisma } from "@/lib/prisma";
import { FW27_STATE, type Fw27Data } from "@/lib/fw27-presentation";

/** Презентация FW27 из SystemState (ключ fw27-presentation); нет данных — null. */
export async function loadFw27(orgId: string): Promise<Fw27Data | null> {
  try {
    const r = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: FW27_STATE } }, select: { value: true } });
    const v = r?.value as Fw27Data | null | undefined;
    return v && Array.isArray(v.slides) && v.slides.length ? v : null;
  } catch { return null; }
}
