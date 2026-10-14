import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { telegramAdapter, telegramToken, TELEGRAM_NO_TOKEN } from "@/lib/channels/telegram";
import { whatsappAdapter } from "@/lib/channels/whatsapp";
import { GroupCodeForm, RevokeButton } from "../../chat/telegram-connect";

export const metadata = { title: "Каналы" };

export default async function ChannelsPage() {
  const s = await requireRole(...ACCESS.channels);
  const org = s.user.organizationId;
  const [tg, wa, links, suppliers] = await Promise.all([
    telegramAdapter.status(),
    whatsappAdapter.status(),
    prisma.channelLink.findMany({ where: { organizationId: org }, orderBy: { createdAt: "desc" } }),
    prisma.supplier.findMany({ where: { organizationId: org, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const userIds = links.map((l) => l.userId).filter((x): x is string => !!x);
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, role: true } }) : [];
  const uName = new Map(users.map((u) => [u.id, `${u.name}${u.role === "SUPPLIER" ? " (поставщик)" : ""}`]));
  const sName = new Map(suppliers.map((x) => [x.id, x.name]));
  const who = (l: (typeof links)[number]) => (l.userId ? (uName.get(l.userId) ?? "пользователь") : l.supplierId ? `Группа поставщика ${sName.get(l.supplierId) ?? ""}` : "Внутренняя группа");

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Каналы" }]} />
      <h1 className="text-xl font-semibold">Каналы: Telegram и WhatsApp</h1>
      <p className="max-w-3xl text-sm text-neutral-600">Сообщения чата сохраняются в платформе и дублируются в подключённые мессенджеры; ответы из Telegram попадают обратно в обсуждение.</p>

      <section className="flex max-w-3xl flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4" aria-label="Telegram">
        <h2 className="text-base font-semibold">Telegram</h2>
        <p className="text-sm">
          Токен бота: <b>{telegramToken() ? "есть" : "нет"}</b>
          {tg.connected ? <> · бот <b>{tg.botName}</b> отвечает</> : null}
        </p>
        {!tg.connected && <p className="text-sm text-amber-800">{telegramToken() ? tg.detail : TELEGRAM_NO_TOKEN}</p>}
        <p className="text-xs text-neutral-500">Токен хранится только в .env (TELEGRAM_BOT_TOKEN) и нигде не показывается. Мост запускается командой <code>npm run telegram</code> (см. docs/DEPLOY.md).</p>
        {tg.connected && (
          <>
            <h3 className="mt-2 text-sm font-semibold">Привязать группу</h3>
            <GroupCodeForm suppliers={suppliers} />
          </>
        )}
      </section>

      <section className="max-w-3xl rounded-lg border border-neutral-200 bg-white p-4" aria-label="Привязки">
        <h2 className="mb-2 text-base font-semibold">Привязки Telegram</h2>
        {links.length === 0 ? <p className="text-sm text-neutral-500">Пока никто не привязан. Личный Telegram привязывается на странице «Чат» (блок «Подключить Telegram»).</p> : (
          <ul className="divide-y divide-neutral-200">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span><b>{who(l)}</b> · {l.kind === "GROUP" ? "группа" : "личный чат"}{l.externalUsername ? ` · @${l.externalUsername}` : ""} · {l.verifiedAt.toLocaleDateString("ru-RU")}</span>
                <RevokeButton id={l.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="max-w-3xl rounded-lg border border-neutral-200 bg-white p-4" aria-label="WhatsApp">
        <h2 className="text-base font-semibold">WhatsApp</h2>
        <p className="text-sm text-amber-800">{wa.detail}</p>
        <p className="text-xs text-neutral-500">Интерфейс канала в платформе готов (src/lib/channels), адаптер пока пустой.</p>
      </section>
    </div>
  );
}
