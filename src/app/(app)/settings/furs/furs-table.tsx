"use client";

import { Fragment, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ClampText } from "@/components/clamp-text";
import { Input } from "@/components/ui/input";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { deleteFur, mergeFurs, saveFur, type FurInput } from "./actions";
import { IconPencil, IconTrash } from "@/components/icons";

export type FurRow = {
  id: string;
  name: string;
  nameEn: string | null;
  aliases: string[];
  note: string | null;
  lots: number;
  items: number;
  orders: number;
  seen: string[];
};

const EMPTY: FurInput = { name: "", nameEn: "", aliases: "", note: "" };

function Form({ id, initial, onClose }: { id: string | null; initial: FurInput; onClose: () => void }) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const f = (label: string, k: keyof FurInput, ph = "", cls = "") => (
    <label className={`flex flex-col gap-1 text-xs text-neutral-600 ${cls}`}>
      {label}
      <Input value={v[k]} placeholder={ph} onChange={(e) => setV((p) => ({ ...p, [k]: e.target.value }))} />
    </label>
  );
  return (
    <div className="flex flex-col gap-3 bg-neutral-50 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {f("Русское название *", "name", "Соболь")}
        {f("Английское название", "nameEn", "Sable")}
        {f("Синонимы (через запятую)", "aliases", "соболя, sable, выделанный соболь", "lg:col-span-2")}
        {f("Примечание", "note", "", "lg:col-span-4")}
      </div>
      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await saveFur(id, v); if (r.error) setErr(r.error); else onClose(); })}>
          {pending ? "Сохраняю…" : "Сохранить"}
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>Отмена</Button>
      </div>
    </div>
  );
}

function Merge({ src, rows, onClose }: { src: FurRow; rows: FurRow[]; onClose: () => void }) {
  const [target, setTarget] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2 bg-amber-50 p-3 text-sm">
      <p>Объединить «{src.name}» с другим видом: название, английское название и синонимы перейдут в выбранный, запись «{src.name}» будет удалена.</p>
      <select className="h-9 max-w-xs rounded-md border border-neutral-300 px-2" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">— какой вид оставить —</option>
        {rows.filter((r) => r.id !== src.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{err}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={!target || pending} onClick={() => start(async () => { const r = await mergeFurs(src.id, target); if (r.error) setErr(r.error); else onClose(); })}>Объединить</Button>
        <Button size="sm" variant="outline" onClick={onClose}>Отмена</Button>
      </div>
    </div>
  );
}

/** rows — показанные строки (после фильтров панели), allRows — весь справочник (для «Объединить»). */
export function FursTable({ rows, allRows = rows, canEdit }: { rows: FurRow[]; allRows?: FurRow[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");
  const [, start] = useTransition();
  const cols = canEdit ? 7 : 6;
  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <div><Button size="sm" onClick={() => { setAdding(true); setEditing(null); setMerging(null); }}>+ Новый вид меха</Button></div>
      )}
      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      {adding && <div className="overflow-hidden rounded-lg border border-neutral-200"><Form id={null} initial={EMPTY} onClose={() => setAdding(false)} /></div>}
      <Table>
        <Thead>
          <Tr>
            <Th>Русское название</Th><Th>Английское</Th><Th>Синонимы</Th>
            <Th className="text-right">Лотов</Th><Th className="text-right">Позиций закупок</Th><Th className="text-right">ТЗ</Th>
            {canEdit && <Th />}
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((r) => (
            <Fragment key={r.id}>
              <Tr>
                <Td className="font-medium">{r.name}{r.note && <div className="text-xs font-normal text-neutral-500"><ClampText text={r.note} /></div>}</Td>
                <Td>{r.nameEn ?? <span className="text-amber-700">не указано</span>}</Td>
                <Td className="max-w-md text-xs text-neutral-600">{r.aliases.length ? r.aliases.join(", ") : "—"}</Td>
                <Td className="text-right">{r.lots}</Td>
                <Td className="text-right">{r.items}</Td>
                <Td className="text-right">{r.orders}</Td>
                {canEdit && (
                  <Td className="whitespace-nowrap">
                    <button type="button" className="text-blue-700 hover:underline" onClick={() => { setEditing(editing === r.id ? null : r.id); setMerging(null); setAdding(false); }} title="Изменить" aria-label="Изменить"><IconPencil /></button>
                    <button type="button" className="ml-3 text-neutral-500 hover:underline" onClick={() => { setMerging(merging === r.id ? null : r.id); setEditing(null); }}>Объединить…</button>
                    {r.lots + r.items + r.orders === 0 && (
                      <button type="button" className="ml-3 text-red-700 hover:underline" onClick={() => { if (confirm(`Удалить пустой вид «${r.name}»?`)) start(async () => { const x = await deleteFur(r.id); setErr(x.error ?? ""); }); }} title="Удалить" aria-label="Удалить"><IconTrash /></button>
                    )}
                  </Td>
                )}
              </Tr>
              {editing === r.id && <Tr><Td colSpan={cols} className="p-0"><Form id={r.id} initial={{ name: r.name, nameEn: r.nameEn ?? "", aliases: r.aliases.join(", "), note: r.note ?? "" }} onClose={() => setEditing(null)} /></Td></Tr>}
              {merging === r.id && <Tr><Td colSpan={cols} className="p-0"><Merge src={r} rows={allRows} onClose={() => setMerging(null)} /></Td></Tr>}
            </Fragment>
          ))}
          {rows.length === 0 && <Tr><Td colSpan={cols} className="py-8 text-center text-neutral-500">{allRows.length > 0 ? "Ничего не найдено" : "Справочник пуст — добавьте вид меха (или попросите разработчика заполнить стандартный список)"}</Td></Tr>}
        </Tbody>
      </Table>
    </div>
  );
}
