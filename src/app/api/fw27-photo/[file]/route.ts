import { readFile } from "node:fs/promises";
import path from "node:path";
import { getFreshSession } from "@/lib/session";

/** Фото из презентации FW27 (вырезаны из PDF): /api/fw27-photo/<NN-k.jpg>. Только вошедшим сотрудникам; имя файла — строго по шаблону. */
export async function GET(_req: Request, ctx: RouteContext<"/api/fw27-photo/[file]">) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { file } = await ctx.params;
  if (!/^(\d{2}-\d{1,2}|c-[a-z0-9]{6,12})\.jpg$/.test(file)) return new Response("Not found", { status: 404 });
  try {
    const buf = await readFile(path.join(process.cwd(), "uploads", "fw27", file));
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg", "Content-Length": String(buf.length), "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response("Not found", { status: 404 }); }
}
