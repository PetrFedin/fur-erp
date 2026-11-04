"use server";

// Ручная правка прогноза прихода FW 26/27 по месяцам (вкладка «Приход по месяцам», 05.11.2026).
// Хранится в SystemState одним документом: правки по артикулу+цвету и признак «показывать январь 27».
// Расчёт (ноябрь = ждём по ТЗ + половина остатка без ТЗ, декабрь = вторая половина) остаётся основой; правка владельца его заменяет только в тех ячейках, где она есть.
import { prisma } from "@/lib/prisma";
import { requireRole, requireSession } from "@/lib/session";

const KEY = "sales-fw26-forecast";
const EDIT = ["OWNER", "ADMIN", "TECHNOLOGIST"] as const;
const FORECAST_MONTHS = ["2026-11", "2026-12", "2027-01"] as const;

export type Fw26Forecast = { cells: Record<string, Record<string, number>>; janOn: boolean; canEdit: boolean };
type Res = { ok: true } | { ok: false; error: string };

export async function loadFw26Forecast(): Promise<Fw26Forecast> {
  const session = await requireSession();
  const row = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: session.user.organizationId, key: KEY } } });
  const v = (row?.value ?? {}) as { cells?: Record<string, Record<string, number>>; janOn?: boolean };
  return { cells: v.cells ?? {}, janOn: !!v.janOn, canEdit: (EDIT as readonly string[]).includes(session.user.role) };
}

export async function saveFw26Forecast(input: { cells: Record<string, Record<string, number>>; janOn: boolean }): Promise<Res> {
  const session = await requireRole(...EDIT);
  const cells: Record<string, Record<string, number>> = {};
  let n = 0;
  for (const [k, months] of Object.entries(input?.cells ?? {})) {
    if (typeof k !== "string" || k.length > 300 || !months || typeof months !== "object") continue;
    const row: Record<string, number> = {};
    for (const m of FORECAST_MONTHS) {
      const x = (months as Record<string, unknown>)[m];
      if (typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 100000) row[m] = Math.round(x);
    }
    if (Object.keys(row).length) { cells[k] = row; n += 1; }
    if (n > 3000) return { ok: false, error: "Слишком много правок" };
  }
  const value = { cells, janOn: !!input?.janOn, savedAt: new Date().toISOString(), savedBy: session.user.id ?? null } as object;
  await prisma.systemState.upsert({
    where: { organizationId_key: { organizationId: session.user.organizationId, key: KEY } },
    create: { organizationId: session.user.organizationId, key: KEY, value },
    update: { value },
  });
  return { ok: true };
}
