"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { acceptInbox, rejectInbox } from "../actions";

/** Кнопки «Принять» / «Отклонить» (виден только при статусе «Отправлено»). */
export function DecideButtons({ id, blocked, orderDate }: { id: string; blocked: boolean; orderDate?: { value: string; source: string } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; bad?: boolean; href?: string } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [date, setDate] = useState(orderDate?.value ?? "");

  const accept = () =>
    start(async () => {
      setMsg(null);
      const r = await acceptInbox(id, orderDate ? date : undefined);
      if ("error" in r && r.error) return setMsg({ text: r.error, bad: true });
      if ("ok" in r && r.ok) {
        setMsg({ text: r.message, href: r.type === "Purchase" ? `/purchases/${r.ids[0]}` : r.ids.length === 1 ? `/production/${r.ids[0]}` : "/production" });
        router.refresh();
      }
    });
  const reject = () =>
    start(async () => {
      setMsg(null);
      const r = await rejectInbox(id, note);
      if (r.error) return setMsg({ text: r.error, bad: true });
      setRejecting(false);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3 rounded-md border border-neutral-300 p-3">
      {orderDate && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="order-date" className="font-medium">Дата закупки</label>
          <input id="order-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-md border border-neutral-300 px-2" />
          <span className="text-neutral-500">({date === orderDate.value ? orderDate.source : "вы поправили дату"}) — её можно исправить до приёма</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={accept} disabled={pending || blocked}>{pending && !rejecting ? "Принимаю…" : "Принять"}</Button>
        <Button type="button" variant="outline" onClick={() => setRejecting((x) => !x)} disabled={pending}>Отклонить</Button>
        {blocked && <span className="text-sm text-red-700">Принять пока нельзя — причина выше.</span>}
      </div>
      {rejecting && (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="rev-note">Что исправить (обязательно — поставщик увидит этот текст)</label>
          <textarea id="rev-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} className="rounded-md border border-neutral-300 p-2 text-sm" />
          <div className="flex gap-2">
            <Button type="button" variant="destructive" onClick={reject} disabled={pending || note.trim().length < 3}>Отклонить с комментарием</Button>
            <Button type="button" variant="outline" onClick={() => setRejecting(false)} disabled={pending}>Отмена</Button>
          </div>
        </div>
      )}
      {msg && (
        <p role="status" className={msg.bad ? "text-sm text-red-700" : "text-sm text-green-800"}>
          {msg.text} {msg.href && <Link href={msg.href} className="underline">Открыть</Link>}
        </p>
      )}
    </div>
  );
}
