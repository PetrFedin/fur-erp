"use client";

import { useState } from "react";
import { BTN, BTN_PRIMARY, FIELD, Modal } from "../ui";

export function EditCardDialog({ name, season, onClose, onSave }: { name: string; season: string; onClose: () => void; onSave: (name: string, season: string) => Promise<string | null> }) {
  const [n, setN] = useState(name);
  const [se, setSe] = useState(season);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Карточка бюджета" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">Название<input autoFocus value={n} onChange={(e) => setN(e.target.value)} className={FIELD} maxLength={80} /></label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">Сезон<input value={se} onChange={(e) => setSe(e.target.value)} className={FIELD} maxLength={20} /></label>
        {err ? <p role="alert" className="text-xs text-red-700">{err}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN} onClick={onClose}>Отмена</button>
          <button type="button" className={BTN_PRIMARY} disabled={busy || !n.trim()} onClick={async () => { setBusy(true); setErr(await onSave(n, se)); setBusy(false); }}>Сохранить</button>
        </div>
      </div>
    </Modal>
  );
}
