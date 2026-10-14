"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Окно предпросмотра ТЗ как документа (HTML-копия Word). Кнопки действий задаёт вызывающий. */
export function TzPreviewModal({ html, onClose, children }: { html: string; onClose: () => void; children?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/50 p-3" role="dialog" aria-label="Предпросмотр ТЗ">
      <div className="mx-auto flex w-full max-w-[980px] flex-1 flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2">
          <span className="mr-auto text-sm font-semibold">Предпросмотр — так будет выглядеть Word</span>
          {children}
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>Закрыть</Button>
        </div>
        <iframe title="Предпросмотр ТЗ" srcDoc={html} sandbox="" className="w-full flex-1 border-0 bg-neutral-200" />
      </div>
    </div>
  );
}

async function downloadWord(id: string) {
  const res = await fetch(`/api/supplier/tz/${id}/docx`);
  if (!res.ok) return;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = "ПРИЛОЖЕНИЕ.docx";
  a.click();
  URL.revokeObjectURL(url);
}

/** Кнопки строки списка: «Предпросмотр» и «Скачать Word» для сохранённого ТЗ. */
export function TzRowButtons({ id }: { id: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="inline-flex gap-1">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await fetch(`/api/supplier/tz/${id}/preview`);
        setBusy(false);
        if (r.ok) setHtml(await r.text());
      }}>Предпросмотр</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => downloadWord(id)}>Скачать Word</Button>
      {html && <TzPreviewModal html={html} onClose={() => setHtml(null)}><Button type="button" size="sm" variant="outline" onClick={() => downloadWord(id)}>Скачать Word</Button></TzPreviewModal>}
    </span>
  );
}
