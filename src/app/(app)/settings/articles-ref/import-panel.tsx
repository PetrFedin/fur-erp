"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { applyArticleImport, previewArticleImport, type ImportRow } from "./actions";

const STATUS: Record<ImportRow["status"], { label: string; variant: "success" | "default" | "warning" | "danger" }> = {
  ok: { label: "Будет записано", variant: "success" },
  same: { label: "Уже так", variant: "default" },
  none: { label: "Артикул не найден", variant: "danger" },
  ambiguous: { label: "Неоднозначно", variant: "warning" },
  conflict: { label: "Конфликт кода", variant: "danger" },
};

export function ImportPanel() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [pick, setPick] = useState<Record<number, string>>({});
  const [skip, setSkip] = useState<Record<number, boolean>>({});
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const target = (r: ImportRow) => pick[r.line] ?? r.articleId;
  const willApply = (rows ?? []).filter((r) => !skip[r.line] && (r.status === "ok" || (r.status === "ambiguous" && pick[r.line])));

  return (
    <div className="rounded-lg border border-neutral-200 bg-white">
      <button type="button" className="w-full px-4 py-3 text-left text-sm font-medium hover:bg-neutral-50" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} Загрузить сопоставление из системы продаж (CSV / Excel)
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-neutral-200 p-4 text-sm">
          <p className="max-w-3xl text-neutral-600">
            Файл с первой строкой-заголовком. Колонки: <b>Наш код</b> (и/или Наше название), <b>Код в продажах</b>, <b>Название в продажах</b>,
            при желании <b>Прочие написания</b> и <b>Длина</b> (Short / Regular / Long; NS и пустое — без длины). Лучше всего взять файл «Скачать CSV», дополнить колонки продаж и загрузить обратно. Ничего не записывается,
            пока вы не нажмёте «Записать» после предпросмотра.
          </p>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              setErr(""); setMsg(""); setRows(null); setPick({}); setSkip({});
              start(async () => {
                const r = await previewArticleImport(fd);
                if (r.error) setErr(r.error);
                else setRows(r.rows ?? []);
              });
            }}
          >
            <input type="file" name="file" accept=".csv,.txt,.xlsx" className="text-sm" required />
            <Button type="submit" size="sm" disabled={pending}>{pending ? "Читаю…" : "Предпросмотр"}</Button>
          </form>
          {err && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{err}</p>}
          {msg && <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-700">{msg}</p>}
          {rows && (
            <>
              <p className="text-neutral-600">
                Строк: {rows.length}. К записи: <b>{willApply.length}</b>; неоднозначных: {rows.filter((r) => r.status === "ambiguous").length};
                не найдено: {rows.filter((r) => r.status === "none").length}; конфликтов: {rows.filter((r) => r.status === "conflict").length}.
              </p>
              <Table>
                <Thead>
                  <Tr><Th>Стр.</Th><Th>Наш код / название</Th><Th>Код в продажах</Th><Th>Название в продажах</Th><Th>Длина</Th><Th>Сопоставление</Th><Th>Записать</Th></Tr>
                </Thead>
                <Tbody>
                  {rows.map((r) => {
                    const st = STATUS[r.status];
                    const active = r.status === "ok" || (r.status === "ambiguous" && !!pick[r.line]);
                    return (
                      <Tr key={r.line} className={r.status === "ambiguous" ? "bg-amber-50" : r.status === "conflict" || r.status === "none" ? "bg-red-50/50" : ""}>
                        <Td>{r.line}</Td>
                        <Td><b>{r.ourCode}</b> <span className="text-neutral-500">{r.ourName}</span></Td>
                        <Td>{r.salesCode || "—"}</Td>
                        <Td className="max-w-xs text-xs">{r.salesName || "—"}</Td>
                        <Td>{r.length || "—"}</Td>
                        <Td>
                          <Badge variant={st.variant}>{st.label}</Badge>
                          {r.note && <div className="text-xs text-neutral-500">{r.note}</div>}
                          {r.status === "ambiguous" && (
                            <select className="mt-1 h-8 rounded-md border border-neutral-300 text-xs" value={pick[r.line] ?? ""} onChange={(e) => setPick((p) => ({ ...p, [r.line]: e.target.value }))}>
                              <option value="">— выберите артикул —</option>
                              {r.candidates.map((c) => <option key={c.id} value={c.id}>{c.name} {(c.category ?? "").replace(/\s+/g, " ").slice(0, 40)}</option>)}
                            </select>
                          )}
                        </Td>
                        <Td>{active ? <input type="checkbox" checked={!skip[r.line]} onChange={(e) => setSkip((s) => ({ ...s, [r.line]: !e.target.checked }))} /> : "—"}</Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
              <div>
                <Button
                  size="sm"
                  disabled={pending || willApply.length === 0}
                  onClick={() =>
                    start(async () => {
                      const r = await applyArticleImport(willApply.map((x) => ({ articleId: target(x)!, salesCode: x.salesCode, salesName: x.salesName, extra: x.extra, length: x.length })));
                      if (r.error) setErr(r.error);
                      else {
                        setMsg(`Записано артикулов: ${r.updated}${r.skipped?.length ? `. Пропущено: ${r.skipped.join("; ")}` : ""}`);
                        setRows(null);
                      }
                    })
                  }
                >
                  Записать {willApply.length} из предпросмотра
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
