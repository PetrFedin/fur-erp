"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { passwordProblem } from "@/lib/password-policy";
import { randomBytes } from "crypto";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { revalidateAll } from "@/lib/revalidate-all";

export type ContractorFormState = { error?: string; ok?: boolean; id?: string };

const schema = z.object({
  name: z.string().trim().min(2, "Укажите название подрядчика").max(200),
  inn: z.string().trim().max(20).optional(),
  contactName: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(100).optional(),
  email: z.string().trim().email("Некорректный email").optional().or(z.literal("")),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(5000).optional(),
});

function parse(fd: FormData) {
  const g = (k: string) => (fd.get(k) as string | null)?.toString() || undefined;
  return schema.safeParse({ name: g("name"), inn: g("inn"), contactName: g("contactName"), phone: g("phone"), email: g("email"), address: g("address"), notes: g("notes") });
}

/** Новый подрядчик: контрагент с договором подряда. По умолчанию сырьё не поставляет (кабинет без «Аукционов» и «Сырья»). */
export async function createContractor(_p: ContractorFormState, fd: FormData): Promise<ContractorFormState> {
  const s = await requireRole(...ACCESS.suppliers);
  const parsed = parse(fd);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  const dup = await prisma.supplier.findFirst({ where: { organizationId: s.user.organizationId, name: { equals: parsed.data.name, mode: "insensitive" } }, select: { id: true } });
  if (dup) return { error: "Такой контрагент уже есть. Выберите его в блоке «Сделать подрядчиком» ниже или измените название" };
  const row = await prisma.supplier.create({
    data: { organizationId: s.user.organizationId, ...parsed.data, isContractor: true, suppliesRaw: fd.get("suppliesRaw") === "on" },
    select: { id: true },
  });
  revalidateAll(s.user.organizationId);
  return { ok: true, id: row.id };
}

export async function updateContractor(id: string, _p: ContractorFormState, fd: FormData): Promise<ContractorFormState> {
  const s = await requireRole(...ACCESS.suppliers);
  const parsed = parse(fd);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  const r = await prisma.supplier.updateMany({ where: { id, organizationId: s.user.organizationId, isContractor: true }, data: { ...parsed.data, suppliesRaw: fd.get("suppliesRaw") === "on" } });
  if (r.count === 0) return { error: "Подрядчик не найден" };
  revalidateAll(s.user.organizationId);
  redirect(`/settings/contractors/${id}`);
}

/** Существующий поставщик (например, поставщик сырья) становится ещё и подрядчиком. */
export async function makeContractor(fd: FormData): Promise<void> {
  const s = await requireRole(...ACCESS.suppliers);
  const id = String(fd.get("supplierId") ?? "");
  if (!id) return;
  await prisma.supplier.updateMany({ where: { id, organizationId: s.user.organizationId }, data: { isContractor: true } });
  revalidateAll(s.user.organizationId);
}

/** Архив подрядчика: в выборе ТЗ его больше нет, старые ТЗ, оплаты и договоры остаются. */
export async function toggleContractorActive(id: string): Promise<void> {
  const s = await requireRole(...ACCESS.suppliers);
  const cur = await prisma.supplier.findFirst({ where: { id, organizationId: s.user.organizationId, isContractor: true }, select: { isActive: true } });
  if (!cur) return;
  await prisma.supplier.update({ where: { id }, data: { isActive: !cur.isActive } });
  revalidateAll(s.user.organizationId);
}

const contractSchema = z.object({
  number: z.string().trim().min(1, "Укажите номер договора").max(100),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату договора").or(z.literal("")),
  kind: z.enum(["WORK", "SUPPLY"]),
  note: z.string().trim().max(500).optional(),
});

export async function addContract(supplierId: string, _p: ContractorFormState, fd: FormData): Promise<ContractorFormState> {
  const s = await requireRole(...ACCESS.suppliers);
  const parsed = contractSchema.safeParse({ number: fd.get("number"), date: fd.get("date") ?? "", kind: fd.get("kind") ?? "WORK", note: (fd.get("note") as string) || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля договора" };
  const sup = await prisma.supplier.findFirst({ where: { id: supplierId, organizationId: s.user.organizationId }, select: { id: true } });
  if (!sup) return { error: "Подрядчик не найден" };
  const dup = await prisma.supplierContract.findFirst({ where: { organizationId: s.user.organizationId, supplierId, number: parsed.data.number }, select: { id: true } });
  if (dup) return { error: "Договор с таким номером у этого подрядчика уже есть" };
  await prisma.supplierContract.create({
    data: { organizationId: s.user.organizationId, supplierId, number: parsed.data.number, date: parsed.data.date ? new Date(parsed.data.date) : null, kind: parsed.data.kind, note: parsed.data.note },
  });
  revalidateAll(s.user.organizationId);
  return { ok: true };
}

export async function toggleContract(id: string): Promise<void> {
  const s = await requireRole(...ACCESS.suppliers);
  const c = await prisma.supplierContract.findFirst({ where: { id, organizationId: s.user.organizationId }, select: { isActive: true } });
  if (!c) return;
  await prisma.supplierContract.update({ where: { id }, data: { isActive: !c.isActive } });
  revalidateAll(s.user.organizationId);
}

/**
 * «Создать доступ в кабинет»: пользователь роли SUPPLIER, привязанный к подрядчику. Пароль — временный: введённый владельцем
 * или случайный (тогда показывается один раз на экране; в журналы и чат не попадает).
 */
export async function createCabinetAccess(supplierId: string, _p: ContractorFormState & { password?: string }, fd: FormData): Promise<ContractorFormState & { password?: string }> {
  const s = await requireRole("OWNER", "ADMIN");
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const name = String(fd.get("name") ?? "").trim();
  const typed = String(fd.get("password") ?? "");
  if (!z.string().email().safeParse(email).success) return { error: "Некорректный email" };
  if (name.length < 2) return { error: "Укажите имя пользователя кабинета" };
  const weak = typed ? passwordProblem(typed, email) : null;
  if (weak) return { error: weak };
  const sup = await prisma.supplier.findFirst({ where: { id: supplierId, organizationId: s.user.organizationId, isActive: true }, select: { id: true } });
  if (!sup) return { error: "Подрядчик не найден или в архиве" };
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) return { error: "Пользователь с таким email уже существует" };
  const password = typed || randomBytes(9).toString("base64url");
  await prisma.user.create({
    data: { organizationId: s.user.organizationId, name, email, role: "SUPPLIER", supplierId: sup.id, passwordHash: await bcrypt.hash(password, 12) },
  });
  revalidateAll(s.user.organizationId);
  return { ok: true, password: typed ? undefined : password };
}
