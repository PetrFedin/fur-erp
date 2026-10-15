"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { Input, Select } from "@/components/ui/input";
import { createAdvancePayment, updateAdvancePayment, deleteAdvancePayment, allocateAdvance } from "./actions";
import { formatNum } from "@/lib/utils";

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
  /** Версия записи на момент открытия формы (защита от тихой перезаписи чужой правки). */
  version?: string;
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
  const { ask, node: confirmNode } = useConfirm();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const paidAt = String(fd.get("paidAt") ?? "");
    if (!(paidAt && !Number.isNaN(Date.parse(paidAt)))) { setError("Укажите дату оплаты"); return; }
    if (paidAt > localToday() && !(await ask(`Дата оплаты (${paidAt}) в будущем. Всё равно записать как оплаченный аванс?`, { ok: "Записать" }))) return;
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
      {confirmNode}
      {initial?.version && <input type="hidden" name="_v" value={initial.version} />}
      {suppliers.length === 1 ? <input type="hidden" name="supplierId" value={suppliers[0].id} /> : <div>
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
      </div>}
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
          {pending ? "Сохраняем…" : initial ? "Сохранить" : "Добавить аванс"}
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
  const { ask, node: confirmNode } = useConfirm();

  async function remove() {
    if (!(await ask("Удалить этот аванс? Долг поставщику вырастет на его сумму. Действие нельзя отменить.", { ok: "Удалить", danger: true }))) return;
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
      {confirmNode}
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

export type AllocTarget = { value: string; label: string; supplierIds: string[] };

/** «Привязать к аукциону»: одна или несколько строк «аукцион/закупка + сумма»; сумма частей не больше суммы аванса. */
export function AllocateAdvanceControls({
  paymentId,
  supplierId,
  amount,
  targets,
}: {
  paymentId: string;
  supplierId: string;
  amount: string;
  targets: AllocTarget[];
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ target: string; amount: string }[]>([{ target: "", amount: amount.replace(".", ",") }]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const { ask, node: confirmNode } = useConfirm();
  const mine = targets.filter((t) => t.supplierIds.includes(supplierId));
  const total = Number(amount);
  const num = (v: string) => Number(v.replace(/\s/g, "").replace(",", ".")) || 0;
  const sum = rows.reduce((a, r) => a + num(r.amount), 0);
  const rest = Math.round((total - sum) * 100) / 100;

  function send(confirmOverpay: boolean) {
    setError("");
    startTransition(async () => {
      try {
        const res = await allocateAdvance(paymentId, rows, confirmOverpay);
        if (res.confirm) {
          if (await ask(res.confirm, { ok: "Всё равно привязать" })) send(true);
          return;
        }
        if (res.error) setError(res.error);
        else setOpen(false);
      } catch {
        setError("Не удалось привязать: сервер отклонил запрос или пропала связь. Попробуйте ещё раз.");
      }
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Привязать к аукциону
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-left">
      {confirmNode}
      <p className="text-xs text-neutral-600">
        Аванс {amount.replace(".", ",")} ₽. Можно разнести на несколько аукционов: сумма частей не больше суммы аванса, остаток
        останется авансом без привязки. Исходный платёж станет первой строкой, в заметке будет «разнесён из п/п …».
      </p>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_10rem_auto]">
          <Select
            aria-label="Аукцион или закупка"
            value={r.target}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))}
          >
            <option value="" disabled>
              Аукцион / закупка…
            </option>
            {mine.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Input
            aria-label="Сумма части, ₽"
            inputMode="decimal"
            autoComplete="off"
            value={r.amount}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
          />
          {rows.length > 1 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              Убрать
            </Button>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRows([...rows, { target: "", amount: rest > 0 ? String(rest).replace(".", ",") : "" }])}
          disabled={rows.length >= 20}
        >
          + Разнести ещё на один аукцион
        </Button>
        <span>
          Разнесено: {formatNum(sum, 1)} ₽; остаток без привязки:{" "}
          {formatNum(rest, 1)} ₽
        </span>
      </div>
      {mine.length === 0 && <p className="text-xs text-amber-700">Нет аукционов и закупок этого поставщика, к которым можно привязать аванс.</p>}
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={pending || rows.some((r) => !r.target || num(r.amount) <= 0) || rest < -0.005} onClick={() => send(false)}>
          {pending ? "Привязываем…" : "Привязать"}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setOpen(false)}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
