"use client";

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { formatMb } from "@/lib/format-mb";
import { Input, Select } from "@/components/ui/input";
import { createAuctionPayment, updateAuctionPayment, deleteAuctionPayment, closeAuctionRemainder, type PayState } from "./actions";

export type PaymentInitial = {
  id: string;
  kind: string;
  status: string;
  paidAt: string;
  amount: string;
  percent: string | null;
  method: string;
  notes: string;
  docName: string | null;
  /** Оплата «закрытие остатка» (откат — удаление). */
  closing?: boolean;
  /** Версия записи на момент открытия формы (защита от тихой перезаписи чужой правки). */
  version?: string;
};

const KINDS: [string, string][] = [
  ["ADVANCE", "Аванс"],
  ["PARTIAL", "Доплата"],
  ["FINAL", "Окончательный расчёт"],
  ["OTHER", "Другое"],
];
const METHODS: [string, string][] = [
  ["BANK_TRANSFER", "Банк. перевод"],
  ["CASH", "Наличные"],
  ["CARD", "Карта"],
  ["OTHER", "Другое"],
];
const MAX_FILE = 25 * 1024 * 1024;

/** Число из поля ввода: пробелы убираем, запятая -> точка; пусто/мусор -> NaN. */
function num(s: string): number {
  const t = s.replace(/[\s  ]/g, "").replace(",", ".");
  return t === "" || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? NaN : Number(t);
}
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => round2(n).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
const toInput2 = (n: number) => round2(n).toFixed(2).replace(".", ",");
const toInputPct = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Форма оплаты аукциона (добавление или правка). total — полная стоимость аукциона (с НДС),
 * paid/planned — уже оплачено/запланировано БЕЗ правимой оплаты. Поля «%» и «сумма» связаны.
 */
export function AuctionPaymentForm({
  auction,
  total,
  paid,
  planned,
  suppliers,
  initial,
  onDone,
}: {
  auction: string;
  total: number;
  paid: number;
  planned: number;
  suppliers: { id: string; name: string }[];
  initial?: PaymentInitial;
  onDone?: () => void;
}) {
  const [kind, setKind] = useState(initial?.kind ?? "ADVANCE");
  const [status, setStatus] = useState(initial?.status ?? "COMPLETED");
  const [amount, setAmount] = useState(initial ? toInput2(Number(initial.amount)) : "");
  // Процент в правке — справочный: сохранённый (если вводили %) или доля суммы от текущей стоимости.
  const [percent, setPercent] = useState(
    initial ? (initial.percent ? initial.percent.replace(".", ",") : total > 0 ? toInputPct((Number(initial.amount) / total) * 100) : "") : "",
  );
  // При правке сохранённая сумма — источник истины: режим "keep", пока пользователь сам не тронул «%» или «сумму».
  const [mode, setMode] = useState<"keep" | "amount" | "percent">(initial ? "keep" : "amount");
  const uid = useId();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const { ask, node: confirmNode } = useConfirm();

  const amountNum = num(amount);
  const validAmount = Number.isFinite(amountNum) && amountNum > 0;
  const afterPaid = total - paid - (status === "COMPLETED" && validAmount ? amountNum : 0);
  const afterPlan = total - paid - planned - (validAmount ? amountNum : 0);
  const rest = Math.max(0, round2(total - paid - planned));

  function onPercent(v: string) {
    setPercent(v);
    setMode("percent");
    const p = num(v);
    setAmount(Number.isFinite(p) && total > 0 ? toInput2((total * p) / 100) : "");
  }
  function onAmount(v: string) {
    setAmount(v);
    setMode("amount");
    const a = num(v);
    setPercent(Number.isFinite(a) && total > 0 ? toInputPct((a / total) * 100) : "");
  }
  function fillRest() {
    setAmount(toInput2(rest));
    setMode("amount");
    setPercent(total > 0 ? toInputPct((rest / total) * 100) : "");
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("mode", mode);
    const file = fd.get("file");
    if (file instanceof File && file.name === "" && file.size === 0) fd.delete("file"); // файл не выбран — не отправляем пустышку
    if (typeof file !== "string" && file && file.name !== "" && file.size === 0) {
      setError(`Файл «${file.name}» пустой (0 байт) — выберите другой файл`);
      return;
    }
    if (typeof file !== "string" && file && file.size > MAX_FILE) {
      setError(`Файл «${file.name}» (${formatMb(file.size)} МБ) больше лимита 25 МБ`);
      return;
    }
    const paidAt = String(fd.get("paidAt") ?? "");
    if (!(paidAt && !Number.isNaN(Date.parse(paidAt)))) { setError("Укажите дату оплаты"); return; }
    if (status === "COMPLETED" && paidAt > localToday() && !(await ask(`Дата оплаты (${paidAt}) в будущем. Всё равно записать как «Оплачено»?`, { ok: "Записать" }))) return;
    setError("");
    startTransition(async () => {
      try {
        let res: PayState = initial ? await updateAuctionPayment(initial.id, fd) : await createAuctionPayment(auction, fd);
        if (res.confirm) {
          if (!(await ask(res.confirm, { ok: "Всё равно записать" }))) return;
          fd.set("confirmOverpay", "1");
          res = initial ? await updateAuctionPayment(initial.id, fd) : await createAuctionPayment(auction, fd);
        }
        if (res.error) {
          setError(res.error);
          return;
        }
        if (!initial) {
          form.reset();
          setKind("ADVANCE");
          setStatus("COMPLETED");
          setAmount("");
          setPercent("");
          setMode("amount");
        }
        onDone?.();
      } catch {
        setError("Не удалось сохранить: сервер отклонил запрос (возможно, файл слишком большой) или пропала связь. Попробуйте ещё раз.");
      }
    });
  }

  const lab = "mb-1 block text-xs text-neutral-500";
  const fid = (n: string) => `${uid}-${n}`;
  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {confirmNode}
      <div>
        <label htmlFor={fid("kind")} className={lab}>Тип оплаты</label>
        <Select id={fid("kind")} name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label htmlFor={fid("status")} className={lab}>Статус</label>
        <Select id={fid("status")} name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="COMPLETED">Оплачено</option>
          <option value="PENDING">Запланировано</option>
        </Select>
      </div>
      <div>
        <label htmlFor={fid("paidAt")} className={lab}>{status === "PENDING" ? "Плановая дата" : "Дата оплаты"}</label>
        <Input id={fid("paidAt")} name="paidAt" type="date" defaultValue={initial?.paidAt ?? localToday()} required />
      </div>
      <div>
        <label htmlFor={fid("method")} className={lab}>Способ</label>
        <Select id={fid("method")} name="method" defaultValue={initial?.method ?? "BANK_TRANSFER"}>
          {METHODS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label htmlFor={fid("percent")} className={lab}>% от стоимости аукциона</label>
        <Input
          id={fid("percent")}
          name="percent"
          inputMode="decimal"
          value={percent}
          onChange={(e) => onPercent(e.target.value)}
          placeholder="напр. 94"
          disabled={total <= 0}
          autoComplete="off"
        />
      </div>
      <div>
        <label htmlFor={fid("amount")} className={lab}>или сумма, ₽</label>
        <Input
          id={fid("amount")}
          name="amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
          placeholder="напр. 60 831 100"
          autoComplete="off"
        />
      </div>
      <div className="flex items-end">
        {kind === "FINAL" && (
          <Button type="button" variant="outline" size="sm" onClick={fillRest} disabled={rest <= 0} title="Подставить всё, что ещё не оплачено и не запланировано">
            Остаток: {money(rest)}
          </Button>
        )}
      </div>
      <div className="flex items-end">
        <p className={`text-sm ${afterPaid < -0.005 ? "font-medium text-red-600" : "text-neutral-700"}`}>
          {status === "COMPLETED" ? (
            <>
              Остаток после этой оплаты: <span className="font-semibold">{money(afterPaid)}</span>
              {afterPaid < -0.005 && " (переплата)"}
            </>
          ) : (
            <>
              Не покрыто платежами и планом: <span className="font-semibold">{money(afterPlan)}</span>
              {afterPlan < -0.005 && " (больше стоимости)"}
            </>
          )}
        </p>
      </div>

      {suppliers.length > 1 && (
        <div>
          <label htmlFor={fid("supplierId")} className={lab}>Кому платим (посредник)</label>
          <Select id={fid("supplierId")} name="supplierId" defaultValue={suppliers[0].id} disabled={Boolean(initial)}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="sm:col-span-2">
        <label htmlFor={fid("notes")} className={lab}>Заметка</label>
        <Input id={fid("notes")} name="notes" defaultValue={initial?.notes ?? ""} maxLength={1000} autoComplete="off" />
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2 lg:col-span-4">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Сохраняем…" : initial ? "Сохранить" : "Добавить оплату"}
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

/** Кнопки строки истории: «Править» (разворачивает форму) и «Удалить» (с подтверждением). */
export function PaymentRowControls({
  auction,
  total,
  paid,
  planned,
  suppliers,
  initial,
}: {
  auction: string;
  total: number;
  /** Без этой оплаты. */
  paid: number;
  planned: number;
  suppliers: { id: string; name: string }[];
  initial: PaymentInitial;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const { ask, node: confirmNode } = useConfirm();

  async function remove() {
    const text = initial.closing
      ? "Удалить закрытие остатка? Остаток аукциона снова станет долгом. Действие нельзя отменить (закрыть остаток можно заново)."
      : "Удалить эту оплату? Платёжный документ, прикреплённый к ней, тоже будет удалён. Действие нельзя отменить.";
    if (!(await ask(text, { ok: "Удалить", danger: true }))) return;
    setError("");
    startTransition(async () => {
      try {
        const res = await deleteAuctionPayment(initial.id);
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
          <AuctionPaymentForm
            auction={auction}
            total={total}
            paid={paid}
            planned={planned}
            suppliers={suppliers}
            initial={initial}
            onDone={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * «Закрыть остаток: оплачено до начала учёта» — явное действие пользователя.
 * В окне подтверждения можно выбрать дату; откат — удаление созданной оплаты в списке.
 */
export function CloseRemainderButton({ auction, remaining }: { auction: string; remaining: string }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(localToday());
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const uid = useId();
  const { ask, node: confirmNode } = useConfirm();

  function confirmClose() {
    setError("");
    startTransition(async () => {
      try {
        let res = await closeAuctionRemainder(auction, date);
        if (res.confirm) {
          if (!(await ask(res.confirm, { ok: "Закрыть остаток" }))) return;
          res = await closeAuctionRemainder(auction, date, true);
        }
        if (res.error) {
          setError(res.error);
          return;
        }
        setOpen(false);
      } catch {
        setError("Не удалось закрыть остаток. Попробуйте ещё раз.");
      }
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Закрыть остаток: оплачено до начала учёта
      </Button>
    );
  }
  return (
    <div role="dialog" aria-label="Подтверждение закрытия остатка" className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      {confirmNode}
      <p>
        Будет создана оплата «Оплачено» на весь текущий остаток аукциона «{auction}» — <span className="font-semibold">{remaining}</span>, с пометкой «закрытие
        остатка». Используйте только если аукцион реально оплачен до начала учёта в системе. Отменить можно удалением этой оплаты в списке.
      </p>
      <div className="max-w-xs">
        <label htmlFor={`${uid}-date`} className="mb-1 block text-xs text-neutral-600">
          Дата оплаты
        </label>
        <Input id={`${uid}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </div>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={confirmClose} disabled={pending || !date}>
          {pending ? "Закрываем…" : "Подтвердить закрытие"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
