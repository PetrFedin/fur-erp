"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { revalidateAll } from "@/lib/revalidate-all";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { staleError } from "@/lib/concurrency";

const MANAGE_ROLES = ["OWNER", "ADMIN"] as const;
const ROLE_VALUES = [
  "OWNER",
  "ADMIN",
  "PURCHASER",
  "WAREHOUSE",
  "TECHNOLOGIST",
  "ACCOUNTANT",
  "VIEWER",
] as const;

const createSchema = z.object({
  name: z.string().trim().min(2, "Укажите имя").max(200, "Имя слишком длинное"),
  email: z.string().trim().toLowerCase().email("Некорректный email"),
  password: z.string().min(8, "Минимум 8 символов").max(200, "Пароль слишком длинный"),
  role: z.enum(ROLE_VALUES),
});

export type UserFormState = { error?: string; ok?: boolean };

export async function createUser(
  _prev: UserFormState,
  formData: FormData
): Promise<UserFormState> {
  const session = await requireRole(...MANAGE_ROLES);
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (parsed.data.role === "OWNER" && session.user.role !== "OWNER") {
    return { error: "Только владелец может создавать пользователей с ролью «Владелец»" };
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) return { error: "Пользователь с таким email уже существует" };

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.user.create({
    data: {
      organizationId: session.user.organizationId,
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
      passwordHash,
    },
  });

  revalidateAll(session.user.organizationId);
  return { ok: true };
}

const OWNER_ONLY = "Только владелец может менять владельца и назначать роль «Владелец»";
const LAST_OWNER = "Нельзя понизить или деактивировать последнего активного владельца организации";

async function otherActiveOwners(organizationId: string, exceptId: string) {
  return prisma.user.count({
    where: { organizationId, role: "OWNER", isActive: true, id: { not: exceptId } },
  });
}

export async function updateUserRole(id: string, role: string): Promise<UserFormState> {
  const session = await requireRole(...MANAGE_ROLES);
  if (id === session.user.id) return { error: "Нельзя изменить собственную роль" };
  if (!ROLE_VALUES.includes(role as (typeof ROLE_VALUES)[number])) return { error: "Некорректная роль" };
  const newRole = role as (typeof ROLE_VALUES)[number];
  const orgId = session.user.organizationId;

  const target = await prisma.user.findFirst({ where: { id, organizationId: orgId } });
  if (!target) return { error: "Пользователь не найден" };
  if (session.user.role !== "OWNER" && (target.role === "OWNER" || newRole === "OWNER")) {
    return { error: OWNER_ONLY };
  }
  if (target.role === "OWNER" && newRole !== "OWNER" && target.isActive) {
    if ((await otherActiveOwners(orgId, target.id)) === 0) return { error: LAST_OWNER };
  }

  await prisma.user.updateMany({ where: { id, organizationId: orgId }, data: { role: newRole } });
  revalidateAll(session.user.organizationId);
  return {};
}

export async function toggleUserActive(id: string): Promise<UserFormState> {
  const session = await requireRole(...MANAGE_ROLES);
  if (id === session.user.id) return { error: "Нельзя деактивировать самого себя" };
  const orgId = session.user.organizationId;

  const user = await prisma.user.findFirst({ where: { id, organizationId: orgId } });
  if (!user) return { error: "Пользователь не найден" };
  if (user.role === "OWNER") {
    if (session.user.role !== "OWNER") return { error: OWNER_ONLY };
    if (user.isActive && (await otherActiveOwners(orgId, user.id)) === 0) return { error: LAST_OWNER };
  }

  await prisma.user.updateMany({ where: { id, organizationId: orgId }, data: { isActive: !user.isActive } });
  revalidateAll(session.user.organizationId);
  return {};
}

/** Имя пользователя (отображается в журнале и подтверждениях). Роль и активность — отдельными действиями; e-mail и пароль здесь не меняются. */
export async function updateUserName(id: string, formData: FormData): Promise<UserFormState> {
  const session = await requireRole(...MANAGE_ROLES);
  const orgId = session.user.organizationId;
  const target = await prisma.user.findFirst({ where: { id, organizationId: orgId } });
  if (!target) return { error: "Пользователь не найден" };
  if (target.role === "OWNER" && session.user.role !== "OWNER") return { error: OWNER_ONLY };
  const stale = staleError(formData, target, ["name"], target.updatedAt);
  if (stale) return { error: stale };
  const name = String(formData.get("name") ?? "").replace(/[\u0000-\u001f]/g, " ").trim();
  if (name.length < 2 || name.length > 100) return { error: "Имя — от 2 до 100 символов" };
  await prisma.user.updateMany({ where: { id, organizationId: orgId }, data: { name } });
  revalidateAll(session.user.organizationId);
  return {};
}
