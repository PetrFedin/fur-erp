"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { InfoHint } from "@/components/info-hint";
import { MARK_LABEL, markConfirmed, type MarkKind } from "@/lib/shipment-marks";
import { confirmSupplierMark, saveSupplierMarks } from "../marks-actions";

export type MarkLine = { id: string; n: number; text: string; quantity: number; stage: "REVIEW" | "REWORK" | "READY"; mark: { kind: MarkKind; note: string } | null };
const STAGE: Record<MarkLine["stage"], string> = { REVIEW: "на просмотре", REWORK: "на доработке", READY: "готов к отгрузке" };
const BADGE: Record<MarkKind, string> = { ok: "bg-emerald-100 text-emerald-900", no: "bg-red-100 text-red-900", remark: "bg-amber-100 text-amber-900" };

/** Отметки Веллмеха по строкам примерки. Веллмех их ставит; ЦУМ видит и подтверждает — только после подтверждения меняется наш учёт. */
export function SupplierMarks({ shipmentId, lines, supplier, canConfirm, stamp }: { shipmentId: string; lines: MarkLine[]; supplier: boolean; canConfirm: boolean; stamp: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, { kind: MarkKind | ""; note: string }>>(() => Object.fromEntries(lines.map((l) => [l.id, { kind: (l.mark?.kind ?? "") as MarkKind | "", note: l.mark?.note ?? "" }])));
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const set = (id: string, patch: Partial<{ kind: MarkKind | ""; note: string }>) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const anyMark = lines.some((l) => l.mark);
  const dirty = lines.some((l) => (draft[l.id]?.kind ?? "") !== (l.mark?.kind ?? "") || (draft[l.id]?.note ?? "") !== (l.mark?.note ?? ""));
  if (!supplier && !anyMark) return null;
  const save = () => start(async () => {
    const r = await saveSupplierMarks(shipmentId, lines.map((l) => ({ lineId: l.id, kind: draft[l.id].kind, note: draft[l.id].note })));
    if (r.error) setMsg({ text: r.error, bad: true }); else { setMsg({ text: `Сохранено отметок: ${r.saved}. Мы увидим их и подтвердим.` }); router.refresh(); }
  });
  const confirm = (id: string) => start(async () => {
    const r = await confirmSupplierMark(shipmentId, id);
    if (r.error) setMsg({ text: r.error, bad: true }); else { setMsg(null); router.refresh(); }
  });
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4" aria-label="Отметки Веллмеха по примерке">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="block-title">Отметки Веллмеха по примерке</h2>
        <InfoHint label="Как работают отметки" wide>
          <p>Веллмех отмечает строки примерки: «принято», «не принято» или «замечание» (с пояснением). Отметка подписана «Веллмех» и сама ничего не меняет в нашем учёте: строка остаётся на просмотре, пока наша сторона не подтвердит отметку или не поставит свою.</p>
          <p className="mt-1">«Подтвердить»: «принято» переводит строку в «Готов к отгрузке», «не принято» и «замечание» — на доработку с текстом Веллмеха.</p>
        </InfoHint>
        {stamp && <span className="text-xs text-neutral-500">последняя отметка: {stamp}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-neutral-500"><tr><th className="px-2 py-1">Строка</th><th className="px-2 py-1 text-right">Шт.</th><th className="px-2 py-1">У нас</th><th className="px-2 py-1">Отметка Веллмеха</th><th className="px-2 py-1">Пояснение</th>{supplier && <th className="px-2 py-1">Наш учёт отметки</th>}{canConfirm && <th className="px-2 py-1" />}</tr></thead>
          <tbody className="divide-y divide-neutral-100">
            {lines.map((l) => {
              const d = draft[l.id];
              return (
                <tr key={l.id} className="align-top">
                  <td className="px-2 py-1.5">{l.text}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.quantity}</td>
                  <td className="px-2 py-1.5 text-neutral-600">{STAGE[l.stage]}</td>
                  {supplier ? (
                    <>
                      <td className="px-2 py-1"><Select aria-label={`Отметка: ${l.text}`} value={d.kind} onChange={(e) => set(l.id, { kind: e.target.value as MarkKind | "" })}><option value="">— не отмечено</option>{(Object.keys(MARK_LABEL) as MarkKind[]).map((k) => <option key={k} value={k}>{MARK_LABEL[k]}</option>)}</Select></td>
                      <td className="px-2 py-1"><input aria-label={`Пояснение: ${l.text}`} className="h-9 w-full rounded-md border border-neutral-300 px-2 text-sm" value={d.note} maxLength={500} placeholder={d.kind && d.kind !== "ok" ? "что не так (обязательно)" : "по желанию"} onChange={(e) => set(l.id, { note: e.target.value })} /></td>
                      <td className="px-2 py-1.5 text-xs">{l.mark ? (markConfirmed(l.mark.kind, l.stage) ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900">учтено нами</span> : <span className="text-neutral-500">ждёт нас</span>) : <span className="text-neutral-400">—</span>}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-1.5">{l.mark ? <span className={`rounded px-1.5 py-0.5 text-xs ${BADGE[l.mark.kind]}`}>Веллмех: {MARK_LABEL[l.mark.kind]}</span> : <span className="text-neutral-400">—</span>}</td>
                      <td className="px-2 py-1.5 text-neutral-700">{l.mark?.note}</td>
                    </>
                  )}
                  {canConfirm && <td className="px-2 py-1.5 text-right">{l.mark && (markConfirmed(l.mark.kind, l.stage) ? <span className="text-xs text-emerald-700">учтено</span> : <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => confirm(l.id)}>Подтвердить</Button>)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {supplier && (
        // Строк бывает десятки: панель прилипает к низу экрана, пока есть несохранённые отметки.
        <div className={`flex flex-wrap items-center gap-2 ${dirty ? "sticky bottom-2 z-10 rounded-lg border border-amber-300 bg-amber-50 p-2 shadow" : ""}`}>
          <Button type="button" disabled={pending} onClick={save}>Сохранить отметки</Button>
          <span className={`text-xs ${dirty ? "font-medium text-amber-900" : "text-neutral-500"}`}>{dirty ? "Есть несохранённые отметки — нажмите «Сохранить отметки»." : "Сохраняются все строки сразу; наш учёт отметки не меняют."}</span>
        </div>
      )}
      {msg && <p role="status" className={msg.bad ? "text-sm text-red-600" : "text-sm text-green-700"}>{msg.text}</p>}
    </section>
  );
}
