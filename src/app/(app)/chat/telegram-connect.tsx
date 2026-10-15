"use client";

import { InfoHint } from "@/components/info-hint";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createGroupBindCode, createMyBindCode, revokeLink, unlinkMyTelegram, type CodeState } from "./channel-actions";

function CodeBox({ s, how }: { s: CodeState; how: string }) {
  if (s.error) return <p role="alert" className="text-xs text-red-700">{s.error}</p>;
  if (!s.code) return null;
  return (
    <div className="rounded-md bg-neutral-100 p-2 text-sm">
      <div>{how} Код действует {s.minutes} минут и подходит один раз.</div>
      <code className="mt-1 inline-block rounded bg-white px-2 py-1 font-mono text-base">{s.hint}</code>
    </div>
  );
}

/** «Подключить Telegram» для любого пользователя: код → боту /start КОД. */
export function TelegramConnect({ linked, hasToken }: { linked: boolean; hasToken: boolean }) {
  const router = useRouter();
  const [st, setSt] = useState<CodeState>({});
  const [pending, start] = useTransition();
  if (!hasToken) return <p className="flex items-center gap-1.5 text-sm text-neutral-600">Telegram не подключён<InfoHint label="Как подключить">Добавьте токен бота (@BotFather) в .env.</InfoHint></p>;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="flex items-center gap-1.5 text-neutral-600">{linked ? "Telegram привязан" : "Telegram не привязан"}<InfoHint label="Про Telegram">{linked ? "Сообщения чата приходят в Telegram, а ответы «reply» попадают обратно в платформу." : "Привяжите Telegram, чтобы получать сообщения чата и отвечать из мессенджера."}</InfoHint></p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => start(async () => setSt(await createMyBindCode()))}>{linked ? "Привязать заново" : "Получить код"}</Button>
        {linked && <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await unlinkMyTelegram(); setSt({}); router.refresh(); })}>Отвязать</Button>}
      </div>
      <CodeBox s={st} how="Откройте бота в Telegram и отправьте ему:" />
    </div>
  );
}

export function GroupCodeForm({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const [sel, setSel] = useState("");
  const [st, setSt] = useState<CodeState>({});
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Какая группа" value={sel} onChange={(e) => setSel(e.target.value)} className="h-9 rounded-md border border-neutral-300 bg-white px-2">
          <option value="">Внутренняя группа (наша команда)</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>Группа поставщика: {s.name}</option>)}
        </select>
        <Button type="button" size="sm" disabled={pending} onClick={() => start(async () => setSt(await createGroupBindCode(sel)))}>Получить код группы</Button>
      </div>
      <CodeBox s={st} how="Добавьте бота в группу и напишите в ней:" />
    </div>
  );
}

export function RevokeButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { await revokeLink(id); router.refresh(); })}>Отозвать</Button>;
}
