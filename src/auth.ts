import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@prisma/client";
import { roleSwitchEnabled } from "@/lib/security-env";
import { clientIpFrom, loginKeys, lockedSeconds, recordFailure, recordSuccess } from "@/lib/rate-limit";

// Запись в журнал входов (AuditLog, model="Вход"): успех, неверный пароль, блокировка. Сбой журнала не мешает входу.
async function logAuth(user: { id: string; name: string; role: string; organizationId: string } | null, ip: string, email: string, what: string) {
  try {
    if (!user) {
      console.warn(`[auth] ${what}: ${email.slice(0, 80)} ip=${ip}`);
      return;
    }
    await prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        source: "auth",
        model: "Вход",
        recordId: user.id,
        action: "create",
        changes: { ip, событие: what },
        label: what,
      },
    });
  } catch (e) {
    console.error("[auth] журнал входа не записан", e instanceof Error ? e.message : e);
  }
}

// Хэш для выравнивания времени ответа, когда пользователя с такой почтой нет (не выдаём, какие почты существуют).
let dummyHash: string | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync("not-a-real-password", 12));

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      organizationId: string;
      organizationName: string;
      /** Режим «смотрю как поставщик»: id пользователя-поставщика (заявлено в подписанном JWT; проверяется в lib/session.ts). */
      actAsUserId?: string;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    organizationId: string;
    organizationName: string;
    /** Подписанный claim режима «смотрю как поставщик»; ставится только в jwt-колбэке после проверок. */
    actAsUserId?: string;
  }
}

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  // За обратным прокси (Caddy / туннель) адрес берётся из заголовков; без этого Auth.js отказывает на чужих хостах.
  trustHost: true,
  // Сессия живёт 7 дней с продлением раз в сутки; роль и активность всё равно перечитываются из БД на каждый запрос (lib/session.ts).
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  // Уникальные имена кук: на localhost куки общие для всех портов, и соседние проекты на Auth.js
  // (одинаковое имя authjs.session-token, другой секрет) иначе выкидывают из сессии.
  cookies: {
    sessionToken: {
      name: "furerp.session-token",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" },
    },
    callbackUrl: { name: "furerp.callback-url", options: { sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" } },
    csrfToken: { name: "furerp.csrf-token", options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" } },
  },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Пароль", type: "password" },
      },
      authorize: async (credentials, request) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }
        if (email.length > 254 || password.length > 200) return null;

        // Защита от перебора стоит здесь, а не только в форме входа: иначе её обходят прямым POST на /api/auth/callback/credentials.
        const ip = request?.headers ? clientIpFrom(request.headers) : "unknown";
        const keys = loginKeys(email, ip);
        const user = await prisma.user.findUnique({
          where: { email: email.trim().toLowerCase() },
          include: { organization: true },
        });
        if (lockedSeconds(keys) > 0) {
          await logAuth(user, ip, email, "Вход заблокирован: слишком много попыток");
          return null;
        }

        const active = Boolean(user && user.isActive && user.organization.isActive);
        // bcrypt выполняем всегда (даже для несуществующей почты) — одинаковое время ответа.
        const valid = await bcrypt.compare(password, user?.passwordHash ?? getDummyHash());
        if (!user || !active || !valid) {
          recordFailure(keys);
          await logAuth(user, ip, email, "Неудачная попытка входа");
          return null;
        }
        recordSuccess(keys);
        await logAuth(user, ip, email, user.role === "SUPPLIER" ? "Вход поставщика" : "Вход");

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organizationId: user.organizationId,
          organizationName: user.organization.name,
        };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user, trigger, session }) => {
      // Переключение «заказчик ⇄ поставщик» (демо). Данные update() приходят и от клиента, поэтому им не верим:
      // claim ставится только если настоящий пользователь (token.id) — активный OWNER/ADMIN, а цель — активный SUPPLIER той же организации.
      if (trigger === "update" && !user) {
        const want = (session as { actAs?: unknown } | null)?.actAs;
        if (want === null) {
          delete token.actAsUserId;
        } else if (typeof want === "string" && roleSwitchEnabled()) {
          const [real, target] = await Promise.all([
            prisma.user.findUnique({ where: { id: token.id }, include: { organization: true } }),
            prisma.user.findUnique({ where: { id: want }, include: { organization: true } }),
          ]);
          const allowed =
            !!real && real.isActive && real.organization.isActive && (real.role === "OWNER" || real.role === "ADMIN") &&
            !!target && target.isActive && target.role === "SUPPLIER" && target.organizationId === real.organizationId;
          if (allowed) token.actAsUserId = want;
          await logAuth(real ? { id: real.id, name: real.name, role: real.role, organizationId: real.organizationId } : null, "-", real?.email ?? "?",
            allowed ? `Переключение в режим поставщика: ${target!.name}` : "Отказ в переключении в режим поставщика");
        }
        return token;
      }
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role: UserRole }).role;
        token.organizationId = (user as { organizationId: string }).organizationId;
        token.organizationName = (user as { organizationName: string }).organizationName;
      }
      return token;
    },
    session: async ({ session, token }) => {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.organizationId = token.organizationId;
      session.user.organizationName = token.organizationName;
      session.user.actAsUserId = token.actAsUserId;
      return session;
    },
  },
});
