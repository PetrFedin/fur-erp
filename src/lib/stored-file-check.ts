import "server-only";
import { statSync } from "node:fs";
import { resolveInside } from "@/lib/fitting-files";
import { prisma } from "@/lib/prisma";

/**
 * «Прикреплён» — только если файл по пути из БД реально лежит в UPLOAD_DIR и не пустой.
 * Запись с storagePath, но без файла на диске (перенос каталога, потерянная загрузка) считается «не прикреплён»:
 * интерфейс не показывает «Открыть» и не ведёт на 404. Результат кэшируется на несколько секунд.
 */
const TTL_MS = 5000;
const cache = new Map<string, { ok: boolean; at: number }>();

export function storedFileExists(storagePath: string | null | undefined): boolean {
  if (!storagePath) return false;
  const now = Date.now();
  const hit = cache.get(storagePath);
  if (hit && now - hit.at < TTL_MS) return hit.ok;
  let ok = false;
  try {
    const abs = resolveInside(storagePath);
    if (abs) {
      const st = statSync(abs);
      ok = st.isFile() && st.size > 0;
    }
  } catch {
    ok = false;
  }
  if (cache.size > 5000) cache.clear();
  cache.set(storagePath, { ok, at: now });
  return ok;
}

/** Аккуратный ответ вместо падения: «не прикреплён» (404, читаемая страница, без ошибок в консоли). */
export function fileNotLoaded(reason = "Файл не прикреплён"): Response {
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${reason}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#404040"><h1 style="font-size:1.1rem">${reason}</h1><p style="font-size:.9rem">Запись о документе есть, но файл к ней не прикреплён. Прикрепите файл в карточке документа или закройте вкладку.</p></body></html>`;
  return new Response(html, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/** Все пути прикреплённых файлов (документы и документы закупок), которые реально есть на диске. */
export async function existingStoredPaths(): Promise<string[]> {
  const [d, p] = await Promise.all([
    prisma.driveDocument.findMany({ where: { storagePath: { not: null } }, select: { storagePath: true }, distinct: ["storagePath"] }),
    prisma.purchaseDocument.findMany({ select: { storagePath: true }, distinct: ["storagePath"] }),
  ]);
  const all = new Set<string>();
  for (const r of d) if (r.storagePath) all.add(r.storagePath);
  for (const r of p) all.add(r.storagePath);
  return [...all].filter(storedFileExists);
}
