"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { revalidateAll } from "@/lib/revalidate-all";
import { MAX_IMPORT_BYTES, type ImportKind } from "@/lib/import-core";
import { ImportFormatError, applyImport, buildPreview, rollbackImport, type ApplyResult, type ImportPreview } from "@/lib/import-server";

export type PreviewRes = { error?: string; preview?: ImportPreview };
export type ApplyRes = { error?: string; result?: ApplyResult };
export type RollbackRes = { error?: string; lines?: string[] };

const KINDS: ImportKind[] = ["sales", "prices", "photos"];

async function readForm(fd: FormData): Promise<{ kind: ImportKind; name: string; buf: Buffer; removeMissing: boolean; sha: string }> {
  const kind = String(fd.get("kind") ?? "") as ImportKind;
  if (!KINDS.includes(kind)) throw new ImportFormatError("Неизвестный вид загрузки");
  const f = fd.get("file");
  if (!(f instanceof File)) throw new ImportFormatError("Выберите файл");
  if (f.size > MAX_IMPORT_BYTES) throw new ImportFormatError("Файл больше 20 МБ");
  const name = f.name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 200);
  return { kind, name, buf: Buffer.from(await f.arrayBuffer()), removeMissing: fd.get("removeMissing") === "1", sha: String(fd.get("sha") ?? "") };
}

const fail = (e: unknown): { error: string } => {
  if (e instanceof ImportFormatError) return { error: e.message };
  console.error("[import]", e);
  return { error: "Не удалось выполнить загрузку. Данные не изменены." };
};

/** Проверка файла: разбор и сравнение с базой, БД не меняется. */
export async function previewImport(fd: FormData): Promise<PreviewRes> {
  const session = await requireRole(...ACCESS.dataImport);
  try {
    const { kind, name, buf, removeMissing } = await readForm(fd);
    return { preview: await buildPreview(prisma, session.user.organizationId, kind, name, buf, removeMissing) };
  } catch (e) {
    return fail(e);
  }
}

/** Загрузка: заново разбирает файл, пишет журнал и данные одной транзакцией, затем сбрасывает кэши. */
export async function applyImportAction(fd: FormData): Promise<ApplyRes> {
  const session = await requireRole(...ACCESS.dataImport);
  const orgId = session.user.organizationId;
  try {
    const { kind, name, buf, removeMissing, sha } = await readForm(fd);
    const result = await applyImport(prisma, orgId, { id: session.user.id, name: session.user.name ?? null }, kind, name, buf, { removeMissing, expectSha: sha || undefined });
    if (result.journalId) refresh(orgId);
    return { result };
  } catch (e) {
    return fail(e);
  }
}

export async function rollbackImportAction(journalId: string): Promise<RollbackRes> {
  const session = await requireRole(...ACCESS.dataImport);
  const orgId = session.user.organizationId;
  try {
    const lines = await rollbackImport(prisma, orgId, { id: session.user.id, name: session.user.name ?? null }, String(journalId));
    refresh(orgId);
    return { lines };
  } catch (e) {
    return fail(e);
  }
}

function refresh(orgId: string) {
  for (const p of ["/cashflow", "/sales", "/analytics/margin", "/dashboard", "/articles", "/settings/import"]) revalidatePath(p);
  revalidateAll(orgId);
}
