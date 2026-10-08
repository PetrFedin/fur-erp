"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getFreshSession } from "@/lib/session";
import { parseVatModeCookie } from "@/lib/vat-mode";
import { COMMISSION4_COOKIE, parseCommission4Cookie } from "@/lib/commission4-mode";
import { YEAR_COOKIE, parseYearCookie } from "@/lib/year-filter";
import { addReply, createComment, deleteComment, setStatus, updateComment, type CommentActor } from "@/lib/comments-service";

export type ActionState = { ok?: boolean; error?: string; id?: string; at?: number } | null;

async function actor(): Promise<CommentActor | null> {
  const s = await getFreshSession();
  if (!s) return null;
  return { id: s.user.id, name: s.user.name ?? "—", role: s.user.role, organizationId: s.user.organizationId };
}
const NO_SESSION = { ok: false as const, error: "Нужно войти в систему заново." };
const NO_DB = { ok: false as const, error: "Комментарии ещё не подключены к работающему серверу: после обновления схемы сервер нужно перезапустить." };
const dbReady = () => "comment" in prisma;
const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");

/** Создать комментарий. Любой вошедший пользователь (в том числе «Наблюдатель»). */
export async function createCommentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  if (!a) return NO_SESSION;
  if (!dbReady()) return NO_DB;
  let context: unknown = null;
  try {
    context = JSON.parse(str(fd, "context") || "null");
  } catch {
    context = null;
  }
  const jar = await cookies();
  const r = await createComment(
    prisma,
    a,
    {
      text: str(fd, "text"),
      kind: str(fd, "kind"),
      priority: str(fd, "priority"),
      pagePath: str(fd, "pagePath"),
      pageTitle: str(fd, "pageTitle"),
      entityType: str(fd, "entityType") || undefined,
      entityKey: str(fd, "entityKey") || undefined,
      anchor: str(fd, "anchor") || undefined,
      context,
    },
    {
      year: parseYearCookie(jar.get(YEAR_COOKIE)?.value),
      vat: parseVatModeCookie(jar.get("vatDisplay")?.value),
      commission4: parseCommission4Cookie(jar.get(COMMISSION4_COOKIE)?.value),
    },
  );
  if (r.ok) revalidatePath("/comments");
  return r.ok ? { ok: true, id: r.id, at: Date.now() } : { error: r.error };
}

type Plain = { ok: boolean; error?: string; changed?: number };

export async function updateCommentAction(id: string, text: string, kind: string, priority: string): Promise<Plain> {
  const a = await actor();
  if (!a) return NO_SESSION;
  if (!dbReady()) return NO_DB;
  const r = await updateComment(prisma, a, id, { text, kind, priority });
  if (r.ok) revalidatePath("/comments");
  return r;
}

export async function setStatusAction(ids: string[], status: string, note?: string): Promise<Plain> {
  const a = await actor();
  if (!a) return NO_SESSION;
  if (!dbReady()) return NO_DB;
  const r = await setStatus(prisma, a, ids, status, note);
  if (r.ok) revalidatePath("/comments");
  return r;
}

export async function deleteCommentAction(id: string): Promise<Plain> {
  const a = await actor();
  if (!a) return NO_SESSION;
  if (!dbReady()) return NO_DB;
  const r = await deleteComment(prisma, a, id);
  if (r.ok) revalidatePath("/comments");
  return r;
}

export async function addReplyAction(id: string, text: string): Promise<Plain> {
  const a = await actor();
  if (!a) return NO_SESSION;
  if (!dbReady()) return NO_DB;
  const r = await addReply(prisma, a, id, text);
  if (r.ok) revalidatePath("/comments");
  return r;
}
