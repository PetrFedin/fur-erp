"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signIn } from "@/auth";

const registerSchema = z.object({
  companyName: z.string().trim().min(2, "Укажите название компании"),
  name: z.string().trim().min(2, "Укажите ваше имя"),
  email: z.string().trim().toLowerCase().email("Некорректный email"),
  password: z.string().min(8, "Минимум 8 символов"),
});

function slugify(input: string) {
  const transliterated = input
    .toLowerCase()
    .replace(/[а-яё]/g, (ch) => {
      const map: Record<string, string> = {
        а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
        з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
        п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
        ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
      };
      return map[ch] ?? ch;
    })
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return transliterated || "org";
}

export type RegisterState = { error?: string };

export async function registerOrganization(
  _prev: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  if (process.env.ALLOW_REGISTRATION === "false") return { error: "Регистрация закрыта. Попросите администратора создать вам доступ." };
  const parsed = registerSchema.safeParse({
    companyName: formData.get("companyName"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };
  }

  const { companyName, name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "Пользователь с таким email уже зарегистрирован" };
  }

  const baseSlug = slugify(companyName);
  let slug = baseSlug;
  let attempt = 1;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: companyName, slug },
    });

    await tx.user.create({
      data: {
        organizationId: org.id,
        email,
        name,
        passwordHash,
        role: "OWNER",
      },
    });

    await tx.warehouse.create({
      data: { organizationId: org.id, name: "Основной склад", isDefault: true },
    });

    await tx.expenseCategory.createMany({
      data: [
        { organizationId: org.id, name: "Доставка", kind: "PURCHASE" },
        { organizationId: org.id, name: "Растаможка", kind: "PURCHASE" },
        { organizationId: org.id, name: "Страхование", kind: "PURCHASE" },
        { organizationId: org.id, name: "Комиссия посредника", kind: "PURCHASE" },
        { organizationId: org.id, name: "Входной контроль / брак", kind: "PURCHASE" },
        { organizationId: org.id, name: "Аукционный сбор", kind: "PURCHASE" },
        { organizationId: org.id, name: "Выделка", kind: "PURCHASE" },
        { organizationId: org.id, name: "Покраска / тонировка", kind: "PURCHASE" },
        { organizationId: org.id, name: "Упаковка", kind: "PURCHASE" },
        { organizationId: org.id, name: "Оплата труда", kind: "PRODUCTION" },
        { organizationId: org.id, name: "Фурнитура и материалы", kind: "PRODUCTION" },
        { organizationId: org.id, name: "Аренда цеха", kind: "PRODUCTION" },
        { organizationId: org.id, name: "Амортизация оборудования", kind: "PRODUCTION" },
        { organizationId: org.id, name: "Прочие расходы", kind: "PRODUCTION" },
      ],
    });
  });

  await signIn("credentials", { email, password, redirectTo: "/dashboard" });

  return {};
}
