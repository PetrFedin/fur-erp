import "server-only";
import { prisma } from "@/lib/prisma";

/** Прогнозы сырья на остаток заказа: хранятся в SystemState (ключ raw-forecast:<id>) вместе с введёнными вручную полями. */
export type ForecastEdits = Record<string, Partial<Record<"hp" | "hidePrice" | "mp" | "meterPrice" | "wp" | "extra", string>>>;
export type ForecastDoc = { id: string; name: string; season: string; edits: ForecastEdits; off: string[]; createdAt: string; updatedAt: string; updatedBy: string | null };

const PREFIX = "raw-forecast:";
const SEEDED = "raw-forecast-seeded";

const parse = (key: string, v: unknown, updatedAt: Date): ForecastDoc => {
  const o = (v ?? {}) as Partial<ForecastDoc>;
  return { id: key.slice(PREFIX.length), name: o.name ?? "Прогноз", season: o.season ?? "", edits: o.edits ?? {}, off: o.off ?? [], createdAt: o.createdAt ?? updatedAt.toISOString(), updatedAt: updatedAt.toISOString(), updatedBy: o.updatedBy ?? null };
};

export async function listForecasts(orgId: string): Promise<ForecastDoc[]> {
  // Первый раз создаём прогноз по умолчанию: «Сырьё на остаток FW26».
  const seeded = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: SEEDED } }, select: { id: true } });
  if (!seeded) {
    // upsert: параллельные запросы страницы не должны падать на уникальном ключе
    await prisma.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key: SEEDED } }, update: {}, create: { organizationId: orgId, key: SEEDED, value: true } });
    const id = "fw26";
    await prisma.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key: PREFIX + id } }, update: {}, create: { organizationId: orgId, key: PREFIX + id, value: { name: "Сырьё на остаток FW26", season: "FW26", edits: {}, off: [], createdAt: new Date().toISOString() } } });
  }
  const rows = await prisma.systemState.findMany({ where: { organizationId: orgId, key: { startsWith: PREFIX } }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => parse(r.key, r.value, r.updatedAt));
}

export async function getForecast(orgId: string, id: string): Promise<ForecastDoc | null> {
  const r = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: PREFIX + id } } });
  return r ? parse(r.key, r.value, r.updatedAt) : null;
}

export async function putForecast(orgId: string, id: string, d: Omit<ForecastDoc, "id" | "updatedAt">): Promise<void> {
  const value = { name: d.name, season: d.season, edits: d.edits, off: d.off, createdAt: d.createdAt, updatedBy: d.updatedBy };
  await prisma.systemState.upsert({ where: { organizationId_key: { organizationId: orgId, key: PREFIX + id } }, update: { value }, create: { organizationId: orgId, key: PREFIX + id, value } });
}

export async function deleteForecast(orgId: string, id: string): Promise<void> {
  await prisma.systemState.deleteMany({ where: { organizationId: orgId, key: PREFIX + id } });
}
