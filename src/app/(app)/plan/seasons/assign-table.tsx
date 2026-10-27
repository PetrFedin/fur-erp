"use client";

import { useState } from "react";
import { TH as Head } from "@/components/table-head";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { assignSeason } from "../actions";

export type AssignOrder = { id: string; label: string; model: string; date: string | null; status: string; season: string | null; qty: string };

/** Список ТЗ с галочками и массовым действием «Присвоить сезон выбранным». */
export function AssignTable({ orders, seasons, canEdit }: { orders: AssignOrder[]; seasons: { id: string; code: string }[]; canEdit: boolean }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const all = orders.length > 0 && sel.size === orders.length;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <form action={assignSeason} className="flex flex-col gap-3">
      {canEdit && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 bg-white p-2 shadow-sm">
          <span className="text-sm">Выбрано: <b>{sel.size}</b></span>
          <Select name="seasonId" className="h-9 w-48" aria-label="Сезон" defaultValue={seasons[0]?.id ?? ""}>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
            <option value="">Снять сезон (без сезона)</option>
          </Select>
          <Button type="submit" disabled={sel.size === 0}>Присвоить сезон выбранным ТЗ</Button>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium text-neutral-500">
            <tr>
              {canEdit && <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Выбрать все" checked={all} onChange={() => setSel(all ? new Set() : new Set(orders.map((o) => o.id)))} className="size-4" /></th>}
              <th className="px-3 py-2">ТЗ</th><th className="px-3 py-2">Модель</th><th className="px-3 py-2">Дата ТЗ</th><Head label="Кол-во" unit="шт." align="left" className="px-3" /><th className="px-3 py-2">Сезон</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-neutral-50/60">
                {canEdit && <td className="px-3 py-2"><input type="checkbox" name="orderId" value={o.id} checked={sel.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Выбрать ${o.label}`} className="size-4" /></td>}
                <td className="px-3 py-2 font-medium"><Link href={`/production/${o.id}`} className="hover:underline">{o.label}</Link></td>
                <td className="px-3 py-2">{o.model}</td>
                <td className="px-3 py-2 tabular-nums">{o.date ?? <span className="text-neutral-500">нет даты</span>}</td>
                <td className="px-3 py-2 tabular-nums">{o.qty}</td>
                <td className="px-3 py-2">{o.season ?? <span className="text-neutral-500">–</span>}</td>
              </tr>
            ))}
            {orders.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-neutral-500">ТЗ по фильтру не найдено</td></tr>}
          </tbody>
        </table>
      </div>
    </form>
  );
}
