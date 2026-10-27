"use client";

import { useState, useTransition } from "react";
import { EditDialog, Field } from "@/components/edit-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import {
  createFromPurchases, deleteGroup, deleteInvoice, deletePaidRow, linkDocument, linkPayment, markReconChecked, saveGroup, saveInvoice, savePaidRow, unlinkPayment,
} from "./actions";

/** Формы ввода реестра сверки. Права проверяет сервер (actions.ts); кнопки показываются только тем, кто может писать. */

const STATUS_OPTIONS: [string, string][] = [
  ["empty", "Нет данных"],
  ["unpaid", "Нет подтверждения оплаты"],
  ["review", "Ручная проверка"],
  ["conflict", "Не сходится"],
  ["docs", "По документам сходится"],
  ["ok", "Сходится на 100 %"],
];
const BASIS_OPTIONS: [string, string][] = [
  ["pp", "платёжка (п/п)"], ["balance", "баланс"], ["upd", "УПД"], ["registry", "единый реестр"], ["calc", "расчёт"], ["letter", "письмо «оплачено»"], ["credit", "зачёт"],
];

const BTN = "max-md:h-10";

export type GroupFormValues = {
  dbId: string; section: string; title: string; counterparty: string | null; contract: string | null; year: number | null; period: string | null;
  status: string; note: string | null; dbPurchases: string[]; dbBatch: number | null;
};

export function GroupFormButton({ group, label }: { group?: GroupFormValues; label?: string }) {
  const [section, setSection] = useState(group?.section ?? "purchase");
  return (
    <EditDialog
      title={group ? "Изменить группу сверки" : "Добавить группу сверки"}
      label={label ?? (group ? "Изменить группу" : "Добавить группу")}
      variant="outline"
      className={BTN}
      saveLabel="Сохранить"
      action={saveGroup}
      hint="Группа — аукцион / закупка (раздел «закупки») или партия / аванс подрядчика (раздел «производство»). Счета добавляются внутри группы."
    >
      {group && <input type="hidden" name="id" value={group.dbId} />}
      <Field label="Раздел">
        {group ? (
          <><input type="hidden" name="section" value={group.section} /><Input value={group.section === "purchase" ? "Закупки" : "Производство"} readOnly /></>
        ) : (
          <Select name="section" value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="purchase">Закупки</option>
            <option value="production">Производство</option>
          </Select>
        )}
      </Field>
      <Field label="Название группы">
        <Input name="title" defaultValue={group?.title ?? ""} required maxLength={200} placeholder={section === "purchase" ? "СП 05.25" : "Партия 12"} />
      </Field>
      <Field label="Контрагент"><Input name="counterparty" defaultValue={group?.counterparty ?? ""} placeholder="Союзпушнина, Веллмех…" /></Field>
      <Field label="Договор / акт"><Input name="contract" defaultValue={group?.contract ?? ""} placeholder="Спецификация №1, акт сверки…" /></Field>
      <Field label="Год"><Input name="year" inputMode="numeric" defaultValue={group?.year ?? ""} placeholder="2026" /></Field>
      <Field label="Период"><Input name="period" defaultValue={group?.period ?? ""} placeholder="март–май 2025" /></Field>
      {section === "purchase" ? (
        <Field label="Закупки базы (через запятую)" wide hint="Номера из «Закупок», например З-2026-0020, З-2026-0021: по ним считается «в базе».">
          <Input name="dbPurchases" defaultValue={group?.dbPurchases.join(", ") ?? ""} />
        </Field>
      ) : (
        <Field label="Номер партии в базе" hint="Если группа — партия: по её ТЗ считается «в базе».">
          <Input name="dbBatch" inputMode="numeric" defaultValue={group?.dbBatch ?? ""} />
        </Field>
      )}
      <Field label="Статус сверки"><Select name="status" defaultValue={group?.status ?? "empty"}>{STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <Field label="Примечание" wide><Textarea name="note" rows={2} defaultValue={group?.note ?? ""} /></Field>
    </EditDialog>
  );
}

export type InvoiceFormValues = {
  dbId: string; no: string | null; date: string | null; amountRub: number; vatRate: number | null; vatRub: number | null; purpose: string;
  updNo: string | null; updDate: string | null; refPurchase: string | null; refBatch: number | null; refTz: string | null; note: string | null;
};

const fmtDate = (iso: string | null | undefined) => (iso ? iso : "");

export function InvoiceFormButton({ groupDbId, groupTitle, invoice, label, prefill }: {
  groupDbId?: string; groupTitle?: string; invoice?: InvoiceFormValues; label?: string; prefill?: Partial<{ no: string; date: string; amount: string; updNo: string; refPurchase: string }>;
}) {
  return (
    <EditDialog
      title={invoice ? `Изменить счёт №${invoice.no ?? "–"}` : `Добавить счёт в «${groupTitle}»`}
      label={label ?? (invoice ? "Изменить" : "Добавить счёт")}
      variant="outline"
      className={BTN}
      wide
      action={saveInvoice}
      hint="Сумма счёта — с НДС. Ставка НДС проверяется по дате счёта: 20 % до 2026 года, 22 % с 2026-го. Одинаковый номер и дата в одной группе дважды не вносятся."
    >
      {invoice ? <input type="hidden" name="id" value={invoice.dbId} /> : <input type="hidden" name="groupId" value={groupDbId} />}
      <Field label="Номер счёта"><Input name="no" defaultValue={invoice?.no ?? prefill?.no ?? ""} required maxLength={60} /></Field>
      <Field label="Дата счёта"><Input name="date" type="date" defaultValue={fmtDate(invoice?.date ?? prefill?.date)} /></Field>
      <Field label="Сумма счёта, ₽ (с НДС)"><Input name="amount" inputMode="decimal" defaultValue={invoice ? String(invoice.amountRub).replace(".", ",") : prefill?.amount ?? ""} required /></Field>
      <Field label="Ставка НДС, %">
        <Select name="vatRate" defaultValue={invoice?.vatRate != null ? String(invoice.vatRate) : ""}>
          <option value="">не указана</option><option value="22">22 (с 2026)</option><option value="20">20 (до 2026)</option><option value="0">0 (без НДС)</option>
        </Select>
      </Field>
      <Field label="НДС, ₽ (если указан в счёте)"><Input name="vatRub" inputMode="decimal" defaultValue={invoice?.vatRub != null ? String(invoice.vatRub).replace(".", ",") : ""} /></Field>
      <Field label="Документ-основание: УПД / акт №"><Input name="updNo" defaultValue={invoice?.updNo ?? prefill?.updNo ?? ""} /></Field>
      <Field label="Дата УПД / акта"><Input name="updDate" type="date" defaultValue={fmtDate(invoice?.updDate)} /></Field>
      <Field label="За что" wide><Input name="purpose" defaultValue={invoice?.purpose ?? ""} maxLength={500} placeholder="аванс 35 % по спецификации №1" /></Field>
      <Field label="Закупка в базе"><Input name="refPurchase" defaultValue={invoice?.refPurchase ?? prefill?.refPurchase ?? ""} placeholder="З-2026-0020" /></Field>
      <Field label="Партия"><Input name="refBatch" inputMode="numeric" defaultValue={invoice?.refBatch ?? ""} /></Field>
      <Field label="ТЗ"><Input name="refTz" defaultValue={invoice?.refTz ?? ""} placeholder="ТЗ 91" /></Field>
      <Field label="Примечание" wide><Textarea name="note" rows={2} defaultValue={invoice?.note ?? ""} /></Field>
    </EditDialog>
  );
}

export type PaidRowValues = { id: string; date: string | null; amountRub: number; ppNo: string | null; basis: string | null; evidence: string; source: string; dateApprox: boolean };

/** Оплата счёта по документам: банковский факт (п/п, дата, сумма). */
export function PaidRowButton({ invoiceId, row, label }: { invoiceId: string; row?: PaidRowValues; label?: string }) {
  return (
    <EditDialog
      title={row ? "Изменить оплату по документу" : "Добавить оплату по документу"}
      label={label ?? (row ? "Изменить" : "Оплата по документу")}
      variant="outline"
      className={BTN}
      action={savePaidRow}
      hint="Банковский факт из платёжки, выписки или баланса. Платёж из базы к счёту привязывается отдельно кнопкой «Привязать платёж»."
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      {row && <input type="hidden" name="rowId" value={row.id} />}
      <Field label="Сумма оплаты, ₽"><Input name="amount" inputMode="decimal" required defaultValue={row ? String(row.amountRub).replace(".", ",") : ""} /></Field>
      <Field label="Дата оплаты"><Input name="date" type="date" defaultValue={row?.date ?? ""} /></Field>
      <Field label="Номер п/п"><Input name="ppNo" defaultValue={row?.ppNo ?? ""} /></Field>
      <Field label="Основание">
        <Select name="basis" defaultValue={row?.basis ?? "pp"}>{BASIS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      </Field>
      <Field label="Статус оплаты">
        <Select name="evidence" defaultValue={row?.evidence ?? "fact"}>
          <option value="fact">оплачено (подтверждено)</option><option value="approved">согласовано, не оплата</option><option value="planned">ожидается</option>
        </Select>
      </Field>
      <Field label="Дата неточная">
        <Select name="dateApprox" defaultValue={row?.dateApprox ? "1" : ""}><option value="">нет</option><option value="1">да, вероятная</option></Select>
      </Field>
      <Field label="Источник (документ)" wide><Input name="source" defaultValue={row?.source ?? ""} placeholder="выписка, п/п №440 от 28.02.2025" /></Field>
    </EditDialog>
  );
}

export type PayCandidateView = { value: string; label: string };

/** «Привязать платёж к счёту»: выбор из существующих Payment / ProductionPayment с подсказкой по сумме и дате. */
export function LinkPaymentButton({ invoiceId, candidates, hint }: { invoiceId: string; candidates: PayCandidateView[]; hint: string }) {
  return (
    <EditDialog title="Привязать платёж к счёту" label="Привязать платёж" variant="outline" className={BTN} action={linkPayment} saveLabel="Привязать" hint={hint}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Field label="Платёж из базы (самые подходящие по сумме и дате — сверху)" wide>
        <Select name="pay" required defaultValue="">
          <option value="" disabled>выберите платёж…</option>
          {candidates.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      </Field>
      {candidates.length === 0 ? <p className="col-span-full text-xs text-neutral-500">Свободных платежей нет: все платежи базы уже учтены в счетах.</p> : null}
    </EditDialog>
  );
}

export function LinkDocButton({ invoiceId, candidates, currentTitle }: { invoiceId: string; candidates: { id: string; title: string }[]; currentTitle: string | null }) {
  return (
    <EditDialog
      title="Привязать документ к счёту"
      label="Привязать документ"
      variant="outline"
      className={BTN}
      action={linkDocument}
      saveLabel="Сохранить"
      hint={currentTitle ? `Сейчас привязан: ${currentTitle}` : "Показаны документы, в названии которых есть номер счёта."}
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Field label="Документ" wide>
        <Select name="documentId" defaultValue="">
          <option value="">без документа (снять привязку)</option>
          {candidates.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </Select>
      </Field>
    </EditDialog>
  );
}

/** Удаление с подтверждением и причиной. Мягкое: запись остаётся в базе и в журнале изменений. */
export function DeleteButton({ kind, id, label, what }: { kind: "group" | "invoice" | "paid" | "link"; id: string; label?: string; what: string }) {
  const action = kind === "group" ? deleteGroup : kind === "invoice" ? deleteInvoice : kind === "paid" ? deletePaidRow : unlinkPayment;
  const idName = kind === "paid" ? "rowId" : kind === "link" ? "linkId" : "id";
  const needReason = kind === "group" || kind === "invoice";
  return (
    <EditDialog
      title={kind === "link" ? "Отвязать платёж" : "Удалить"}
      label={label ?? (kind === "link" ? "Отвязать" : "Удалить")}
      variant="ghost"
      className={`${BTN} text-red-700 hover:bg-red-50`}
      action={action}
      saveLabel={kind === "link" ? "Отвязать" : "Удалить"}
      hint={needReason ? "Запись не пропадает навсегда: она помечается удалённой, остаётся в журнале изменений, итоги пересчитываются." : undefined}
    >
      <input type="hidden" name={idName} value={id} />
      <p className="col-span-full text-sm text-neutral-800">{what}</p>
      {needReason ? <Field label="Причина удаления" wide><Textarea name="reason" rows={2} required minLength={5} placeholder="например: дубль счёта, внесён по ошибке" /></Field> : null}
      <label className="col-span-full flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" value="1" required className="mt-1 size-4" /> Да, я понимаю последствия
      </label>
    </EditDialog>
  );
}

/** «Отметить сверку выполненной»: ставит сегодняшнюю дату последней проверки реестра (её читает /api/ready). */
export function MarkCheckedButton({ lastLabel }: { lastLabel: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const { ask, node } = useConfirm();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={BTN}
        disabled={pending}
        onClick={async () => {
          if (!(await ask(`Отметить, что сверка по документам выполнена сегодня? Прежняя дата: ${lastLabel}.`, { ok: "Отметить" }))) return;
          start(async () => {
            const r = await markReconChecked(new FormData());
            setMsg(r.error ?? "Отмечено");
          });
        }}
      >
        {pending ? "Отмечаем…" : "Отметить сверку выполненной"}
      </Button>
      {msg ? <span className="text-xs text-neutral-600" role="status">{msg}</span> : null}
      {node}
    </span>
  );
}

export type OutsideView = { key: string; title: string; numbers: string[]; counterparty: string; total: number; invoiceNo: string; invoiceDate: string; updNo: string; suggestGroupId: string | null };

/** «Создать группу / счёт из закупки»: подставляет контрагента, номер, дату, сумму и привязку. */
export function FromPurchaseButton({ b, groups }: { b: OutsideView; groups: { dbId: string; title: string }[] }) {
  const [target, setTarget] = useState(b.suggestGroupId ?? "new");
  return (
    <EditDialog
      title={`Внести в сверку: ${b.title}`}
      label="Создать группу / счёт"
      variant="outline"
      className={BTN}
      wide
      action={createFromPurchases}
      saveLabel="Внести"
      hint={`Закупки: ${b.numbers.join(", ")}. Сумма закупок с НДС подставлена как сумма счёта; поправьте её по первичному счёту.`}
    >
      <input type="hidden" name="numbers" value={b.numbers.join(",")} />
      <Field label="Куда внести" wide>
        <Select name="target" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="new">Новая группа</option>
          {groups.map((g) => <option key={g.dbId} value={g.dbId}>Добавить в группу «{g.title}»</option>)}
        </Select>
      </Field>
      {target === "new" ? (
        <>
          <Field label="Название группы"><Input name="title" defaultValue={b.title} required /></Field>
          <Field label="Контрагент"><Input name="counterparty" defaultValue={b.counterparty} /></Field>
        </>
      ) : null}
      <Field label="Номер счёта (пусто — счёт позже)"><Input name="invoiceNo" defaultValue={b.invoiceNo} /></Field>
      <Field label="Дата счёта"><Input name="date" type="date" defaultValue={b.invoiceDate} /></Field>
      <Field label="Сумма счёта, ₽ (с НДС)"><Input name="amount" inputMode="decimal" defaultValue={String(b.total).replace(".", ",")} /></Field>
      <Field label="УПД №"><Input name="updNo" defaultValue={b.updNo} /></Field>
      <Field label="За что" wide><Input name="purpose" defaultValue={`закупка ${b.numbers.join(", ")}`} /></Field>
    </EditDialog>
  );
}
