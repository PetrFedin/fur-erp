"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { createAdvancePayment, updateAdvancePayment, deleteAdvancePayment } from "./actions";

const METHODS: [string, string][] = [
  ["BANK_TRANSFER", "Банк. перевод"],
  ["CASH", "Наличные"],
  ["CARD", "Карта"],
  ["OTHER", "Другое"],
];

export type AdvanceInitial = {
  id: string;
  supplierId: string;
  amount: string;
  method: string;
  paidAt: string;
  notes: string;
};

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Форма аванса поставщику без привязки к аукциону/закупке (добавление или правка). */
export function AdvanceForm({
  suppliers,
  initial,
  onDone,
}: {
  suppliers: { id: string; name: string }[];
  initial?: AdvanceInitial;
  onDone?: () => void;
}) {
  const uid = useId();
  const fid = (n: string) => `${uid}-${n}`;
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const paidAt = String(fd.get("paidAt") ?? "");
    if (paidAt > localToday() && !window.confirm(`Дата оплаты (${paidAt}) в будущем. Всё равно записать как оплаченный аванс?`)) return;
    setError("");
    setOkMsg("");
    startTransition(async () => {
      try {
        const res = initial ? await updateAdvancePayment(initial.id, fd) : await createAdvancePayment(fd);
        if (res.error) {
          setError(res.error);
          return;
        }
        if (!initial) {
          form.reset();
          setOkMsg("Аванс записан.");
        }
        onDone?.();
      } catch {
        setError("Не удалось сохранить: сервер отклонил запрос или пропала связь. Попробуйте ещё раз.");
      }
    });
  }

  const lab = "mb-1 block text-xs text-neutral-500";
  return (
    <form onSubmit={submit} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label htmlFor={fid("supplierId")} className={lab}>
          Поставщик
        </label>
        <Select id={fid("supplierId")} name="supplierId" required defaultValue={initial?.supplierId ?? ""}>
          <option value="" disabled>
            Выберите
          </option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor={fid("amount")} className={lab}>
          Сумма, ₽
        </label>
        <Input id={fid("amount")} name="amount" inputMode="decimal" autoComplete="off" required defaultValue={initial?.amount.replace(".", ",") ?? ""} placeholder="напр. 100 000,50" />
      </div>
      <div>
        <label htmlFor={fid("method")} className={lab}>
          Способ
        </label>
        <Select id={fid("method")} name="method" defaultValue={initial?.method ?? "BANK_TRANSFER"}>
          {METHODS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor={fid("paidAt")} className={lab}>
          Дата
        </label>
        <Input id={fid("paidAt")} name="paidAt" type="date" defaultValue={initial?.paidAt ?? localToday()} required />
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <label htmlFor={fid("notes")} className={lab}>
          Заметка
        </label>
        <Input id={fid("notes")} name="notes" maxLength={1000} autoComplete="off" defaultValue={initial?.notes ?? ""} />
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2 lg:col-span-4">
          {error}
        </p>
      )}
      {okMsg && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 sm:col-span-2 lg:col-span-4">
          {okMsg}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Сохраняем…" : initial ? "Сохранить" : "Добавить платёж"}
        </Button>
        {initial && onDone && (
          <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
            Отмена
          </Button>
        )}
      </div>
    </form>
  );
}

/** Кнопки строки аванса: «Править» и «Удалить» (с подтверждением). */
export function AdvanceRowControls({ suppliers, initial }: { suppliers: { id: string; name: string }[]; initial: AdvanceInitial }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function remove() {
    if (!window.confirm("Удалить этот аванс? Долг поставщику вырастет на его сумму. Действие нельзя отменить.")) return;
    setError("");
    startTransition(async () => {
      try {
        const res = await deleteAdvancePayment(initial.id);
        if (res.error) setError(res.error);
      } catch {
        setError("Не удалось удалить. Попробуйте ещё раз.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing((v) => !v)} disabled={pending}>
          {editing ? "Закрыть" : "Править"}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="text-red-600" onClick={remove} disabled={pending}>
          Удалить
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {editing && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-left">
          <AdvanceForm suppliers={suppliers} initial={initial} onDone={() => setEditing(false)} />
        </div>
      )}
    </div>
  );
}
