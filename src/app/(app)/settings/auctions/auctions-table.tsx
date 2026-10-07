"use client";

import Link from "next/link";
import { Fragment, useActionState, useMemo, useState, useTransition } from "react";
import { MultiFilter } from "@/components/multi-filter";
import { InfoHint } from "@/components/info-hint";
import { RowCard, ResponsiveRows } from "@/components/responsive-rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { useKeepingForm } from "@/lib/use-keeping-form";
import { formatMoney } from "@/lib/utils";
import {
  confirmAuctionAction, confirmManyAction, createAuctionAction, deleteAuctionAction, mergeAuctionAction, renameAuctionAction,
  updateAuctionAction, type AuctionResult,
} from "./actions";

export type AuctionRowData = {
  id: string; name: string; fullName: string | null; house: string | null; kind: "FUR" | "LINING" | "MATERIALS" | "OTHER";
  year: number | null; month: number | null; currency: string | null; auctionDate: string | null; aliases: string[];
  isService: boolean; confirmed: boolean; note: string | null; purchaseCount: number; total: number; version: string;
  purchases: { id: string; number: string; status: string }[];
};

const KIND_LABELS = { FUR: "Мех", LINING: "Подкладка", MATERIALS: "Материалы", OTHER: "Прочее" } as const;
type SortKey = "default" | "name" | "period" | "count" | "total";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "default", label: "Как в справочнике" },
  { value: "name", label: "По имени" },
  { value: "period", label: "По дате (новые сверху)" },
  { value: "count", label: "По числу закупок" },
  { value: "total", label: "По сумме" },
];

const period = (r: AuctionRowData) => (r.year ?? 0) * 100 + (r.month ?? 0);

function Hint() {
  return (
    <InfoHint label="Как называть аукционы" wide>
      <div className="space-y-2 text-xs">
        <p><b>Как называть.</b> Коротко и единообразно: «&lt;дом&gt; &lt;мм.гг&gt;», например «СП 05.26» (Союзпушнина), «РП 04.26» (Русьпушнина), «SAGA 03.26», «AME 05.26». Не-аукционные группы — понятным именем: «КФХ Дуденко 07.25», «Подкладка 05.26».</p>
        <p><b>Что будет при переименовании.</b> Новое имя автоматически заменит старое везде: в закупках, лотах, оплатах аукциона, документах партии, фильтрах и реестре сверки. Прежнее имя сохранится в «раньше: …» и по-прежнему находит этот аукцион. Вернуть имя можно тем же способом.</p>
        <p><b>Предложено, ждёт подтверждения.</b> Имена, которые система предложила сама. Исправьте имя или нажмите «Подтвердить».</p>
        <p><b>Объединить.</b> Если один аукцион заведён дважды: закупки, оплаты и документы переедут в выбранный, а имя станет «раньше».</p>
      </div>
    </InfoHint>
  );
}

export function AuctionsTable({ rows, canEdit }: { rows: AuctionRowData[]; canEdit: boolean }) {
  const [flash, setFlash] = useState<AuctionResult | null>(null);
  const [houses, setHouses] = useState<string[]>([]);
  const [years, setYears] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [conf, setConf] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("default");
  const [open, setOpen] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const [adding, setAdding] = useState(false);

  const houseOpts = useMemo(() => [...new Set(rows.map((r) => r.house ?? "—"))].sort((a, b) => a.localeCompare(b, "ru")).map((h) => ({ value: h, label: h, count: rows.filter((r) => (r.house ?? "—") === h).length })), [rows]);
  const yearOpts = useMemo(() => [...new Set(rows.map((r) => String(r.year ?? "—")))].sort().reverse().map((y) => ({ value: y, label: y, count: rows.filter((r) => String(r.year ?? "—") === y).length })), [rows]);
  const kindOpts = (Object.keys(KIND_LABELS) as (keyof typeof KIND_LABELS)[]).map((k) => ({ value: k, label: KIND_LABELS[k], count: rows.filter((r) => r.kind === k).length }));
  const confOpts = [
    { value: "yes", label: "Подтверждено", count: rows.filter((r) => r.confirmed).length },
    { value: "no", label: "Ждёт подтверждения", count: rows.filter((r) => !r.confirmed).length },
  ];

  const shown = useMemo(() => {
    const list = rows.filter(
      (r) =>
        (!houses.length || houses.includes(r.house ?? "—")) &&
        (!years.length || years.includes(String(r.year ?? "—"))) &&
        (!kinds.length || kinds.includes(r.kind)) &&
        (!conf.length || conf.includes(r.confirmed ? "yes" : "no")),
    );
    const by: Record<SortKey, (a: AuctionRowData, b: AuctionRowData) => number> = {
      default: () => 0,
      name: (a, b) => a.name.localeCompare(b.name, "ru"),
      period: (a, b) => period(b) - period(a),
      count: (a, b) => b.purchaseCount - a.purchaseCount,
      total: (a, b) => b.total - a.total,
    };
    return [...list].sort(by[sort]);
  }, [rows, houses, years, kinds, conf, sort]);

  const pending = rows.filter((r) => !r.confirmed);
  const report = (r: AuctionResult) => setFlash(r);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Справочник аукционов</h1>
        <Hint />
      </div>
      <p className="max-w-3xl text-sm text-neutral-600">
        Короткое имя аукциона так и будет фигурировать на платформе. Правьте имя прямо в строке (Enter или щелчок мимо поля) — оно обновится везде.
      </p>
      {flash?.error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{flash.error}</p>}
      {flash?.ok && <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{flash.ok}</p>}

      <div className="flex flex-wrap items-end gap-2">
        <MultiFilter label="Дом" options={houseOpts} selected={houses} onChange={setHouses} />
        <MultiFilter label="Год" options={yearOpts} selected={years} onChange={setYears} />
        <MultiFilter label="Вид" options={kindOpts} selected={kinds} onChange={setKinds} />
        <MultiFilter label="Статус" options={confOpts} selected={conf} onChange={setConf} />
        <div>
          <Label htmlFor="auc-sort">Сортировка</Label>
          <Select id="auc-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-11">
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </div>
        {canEdit && (
          <div className="ml-auto flex flex-wrap gap-2">
            {pending.length > 0 && <Button variant="secondary" onClick={() => setBulk((v) => !v)}>Подтвердить все предложения ({pending.length})</Button>}
            <Button onClick={() => setAdding((v) => !v)}>Добавить аукцион</Button>
          </div>
        )}
      </div>

      {bulk && canEdit && <BulkConfirm pending={pending} onDone={(r) => { report(r); setBulk(false); }} onCancel={() => setBulk(false)} />}
      {adding && canEdit && <AddForm onDone={(r) => { report(r); if (r.ok) setAdding(false); }} />}

      <ResponsiveRows
        table={
          <Table>
            <Thead>
              <Tr>
                <Th>Короткое имя</Th>
                <Th>Полное название</Th>
                <Th>Дом</Th>
                <Th>Вид</Th>
                <Th>Год/мес.</Th>
                <Th className="text-right">Закупок</Th>
                <Th className="text-right">Сумма</Th>
                <Th>Статус</Th>
                <Th>{canEdit ? "Действия" : ""}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {shown.map((r) => (
                <Fragment key={r.id}>
                  <Tr>
                    <Td className="align-top">
                      <NameEditor row={r} canEdit={canEdit} onResult={report} />
                      {r.aliases.length > 0 && <div className="mt-1 max-w-xs text-xs text-neutral-500">раньше: {r.aliases.join("; ")}</div>}
                    </Td>
                    <Td className="max-w-xs align-top text-xs text-neutral-600">{r.fullName ?? "—"}</Td>
                    <Td className="align-top text-sm">{r.house ?? "—"}</Td>
                    <Td className="align-top text-sm">{KIND_LABELS[r.kind]}{r.isService && <div><Badge>служебный</Badge></div>}</Td>
                    <Td className="align-top text-sm tabular-nums">{r.year ? `${r.year}${r.month ? `/${String(r.month).padStart(2, "0")}` : ""}` : "—"}</Td>
                    <Td className="text-right align-top tabular-nums">{r.purchaseCount}</Td>
                    <Td className="whitespace-nowrap text-right align-top tabular-nums">{r.total ? formatMoney(r.total) : "—"}</Td>
                    <Td className="align-top"><StatusCell row={r} canEdit={canEdit} onResult={report} /></Td>
                    <Td className="align-top">
                      <Button variant="ghost" size="sm" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                        {open === r.id ? "Свернуть" : "Подробнее"}
                      </Button>
                    </Td>
                  </Tr>
                  {open === r.id && (
                    <Tr>
                      <Td colSpan={9} className="bg-neutral-50"><Details row={r} all={rows} canEdit={canEdit} onResult={report} /></Td>
                    </Tr>
                  )}
                </Fragment>
              ))}
              {shown.length === 0 && (
                <Tr><Td colSpan={9} className="py-8 text-center text-neutral-400">{rows.length ? "Нет аукционов по выбранным фильтрам" : "Справочник пуст — добавьте первый аукцион"}</Td></Tr>
              )}
            </Tbody>
          </Table>
        }
      >
        {shown.map((r) => (
          <RowCard
            key={r.id}
            title={<NameEditor row={r} canEdit={canEdit} onResult={report} />}
            subtitle={r.aliases.length > 0 ? `раньше: ${r.aliases.join("; ")}` : r.fullName}
            badge={r.confirmed ? <Badge variant="success">подтверждено</Badge> : <Badge variant="warning">ждёт подтверждения</Badge>}
            fields={[
              { label: "Закупок", value: r.purchaseCount },
              { label: "Сумма", value: r.total ? formatMoney(r.total) : "—" },
              { label: "Дом", value: r.house ?? "—" },
              { label: "Вид", value: KIND_LABELS[r.kind] },
            ]}
            extra={
              <div className="flex flex-col gap-2">
                <StatusCell row={r} canEdit={canEdit} onResult={report} hideBadge />
                <details>
                  <summary className="cursor-pointer py-2 text-xs text-blue-600">Подробнее и правка</summary>
                  <Details row={r} all={rows} canEdit={canEdit} onResult={report} />
                </details>
              </div>
            }
          />
        ))}
        {shown.length === 0 && <p className="py-6 text-center text-sm text-neutral-400">{rows.length ? "Нет аукционов по выбранным фильтрам" : "Справочник пуст — добавьте первый аукцион"}</p>}
      </ResponsiveRows>
    </div>
  );
}

function NameEditor({ row, canEdit, onResult }: { row: AuctionRowData; canEdit: boolean; onResult: (r: AuctionResult) => void }) {
  const [value, setValue] = useState(row.name);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  if (!canEdit) return <span className="font-medium">{row.name}</span>;
  const save = () => {
    const v = value.replace(/\s+/g, " ").trim();
    if (v === row.name) { setValue(row.name); return; }
    start(async () => {
      const r = await renameAuctionAction(row.id, v, row.version);
      setErr(r.error ?? null);
      onResult(r);
      if (r.error) setValue(v); // ввод не стираем: человек поправит и сохранит снова
    });
  };
  return (
    <div className="min-w-44">
      <Input
        key={row.name}
        value={value}
        disabled={pending}
        aria-label={`Короткое имя аукциона «${row.name}»`}
        aria-invalid={!!err}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") { setValue(row.name); setErr(null); } }}
        className={err ? "border-red-400" : ""}
      />
      {err && <div className="mt-1 text-xs text-red-600">{err}</div>}
    </div>
  );
}

function StatusCell({ row, canEdit, onResult, hideBadge }: { row: AuctionRowData; canEdit: boolean; onResult: (r: AuctionResult) => void; hideBadge?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col items-start gap-1">
      {!hideBadge && (row.confirmed ? <Badge variant="success">подтверждено</Badge> : <Badge variant="warning">предложено, ждёт подтверждения</Badge>)}
      {canEdit && !row.confirmed && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => onResult(await confirmAuctionAction(row.id)))}>
          Подтвердить имя
        </Button>
      )}
    </div>
  );
}

function Details({ row, all, canEdit, onResult }: { row: AuctionRowData; all: AuctionRowData[]; canEdit: boolean; onResult: (r: AuctionResult) => void }) {
  const [state, action, pending] = useActionState(async (p: AuctionResult | null, fd: FormData) => { const r = await updateAuctionAction(p, fd); onResult(r); return r; }, null);
  const { setForm: keepRef, onSubmit: keepSubmit } = useKeepingForm(action, state, pending);
  const [target, setTarget] = useState("");
  const [busy, start] = useTransition();
  return (
    <div className="grid gap-4 p-2 md:grid-cols-2">
      <div>
        <div className="mb-1 text-xs font-medium text-neutral-500">Закупки аукциона ({row.purchaseCount})</div>
        {row.purchases.length === 0 ? <p className="text-sm text-neutral-400">Закупок нет</p> : (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {row.purchases.map((p) => <Link key={p.id} href={`/purchases/${p.id}`} className="text-blue-600 hover:underline">{p.number}{p.status === "CANCELLED" ? " (отм.)" : ""}</Link>)}
          </div>
        )}
        {row.note && <p className="mt-2 text-xs text-neutral-500">{row.note}</p>}
        {canEdit && (
          <div className="mt-4 flex flex-col gap-2 border-t border-neutral-200 pt-3">
            <Label htmlFor={`m-${row.id}`}>Объединить с…</Label>
            <Select id={`m-${row.id}`} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">— выбрать аукцион —</option>
              {all.filter((x) => x.id !== row.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
            <p className="text-xs text-neutral-500">«{row.name}» исчезнет, его закупки, оплаты и документы перейдут к выбранному аукциону, а имя станет «раньше».</p>
            <Button
              variant="outline" size="sm" disabled={!target || busy} className="self-start"
              onClick={() => {
                const t = all.find((x) => x.id === target);
                if (!t || !window.confirm(`Объединить «${row.name}» с «${t.name}»? Запись «${row.name}» будет удалена, её закупки (${row.purchaseCount}) перейдут к «${t.name}».`)) return;
                start(async () => onResult(await mergeAuctionAction(row.id, target)));
              }}
            >
              Объединить
            </Button>
            {row.purchaseCount === 0 && (
              <Button
                variant="destructive" size="sm" disabled={busy} className="self-start"
                onClick={() => { if (window.confirm(`Удалить пустой аукцион «${row.name}»?`)) start(async () => onResult(await deleteAuctionAction(row.id))); }}
              >
                Удалить пустой аукцион
              </Button>
            )}
          </div>
        )}
      </div>
      {canEdit ? (
        <form ref={keepRef} onSubmit={keepSubmit} className="grid grid-cols-2 gap-2">
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="_v" value={row.version} />
          <Field label="Полное название" name="fullName" defaultValue={row.fullName ?? ""} wide />
          <Field label="Дом / источник" name="house" defaultValue={row.house ?? ""} />
          <div>
            <Label htmlFor={`k-${row.id}`}>Вид</Label>
            <Select id={`k-${row.id}`} name="kind" defaultValue={row.kind}>
              {Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </div>
          <Field label="Год" name="year" type="number" defaultValue={row.year ?? ""} />
          <Field label="Месяц" name="month" type="number" defaultValue={row.month ?? ""} />
          <Field label="Валюта" name="currency" defaultValue={row.currency ?? ""} />
          <Field label="Дата аукциона" name="auctionDate" type="date" defaultValue={row.auctionDate ?? ""} />
          <div className="col-span-2">
            <Label htmlFor={`al-${row.id}`}>Прежние написания (через «;»)</Label>
            <Textarea id={`al-${row.id}`} name="aliases" rows={2} defaultValue={row.aliases.join("; ")} />
          </div>
          <div className="col-span-2">
            <Label htmlFor={`nt-${row.id}`}>Примечание</Label>
            <Textarea id={`nt-${row.id}`} name="note" rows={2} defaultValue={row.note ?? ""} />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="isService" defaultChecked={row.isService} className="size-4" /> Служебный (заглушка «Без аукциона»)
          </label>
          {state?.error && <p className="col-span-2 text-sm text-red-600">{state.error}</p>}
          <Button type="submit" size="sm" disabled={pending} className="col-span-2 self-start">{pending ? "Сохраняю…" : "Сохранить"}</Button>
        </form>
      ) : (
        <dl className="text-sm text-neutral-600">
          <dt className="text-xs text-neutral-500">Полное название</dt><dd>{row.fullName ?? "—"}</dd>
          <dt className="mt-2 text-xs text-neutral-500">Валюта</dt><dd>{row.currency ?? "—"}</dd>
          <dt className="mt-2 text-xs text-neutral-500">Дата аукциона</dt><dd>{row.auctionDate ?? "—"}</dd>
        </dl>
      )}
    </div>
  );
}

function Field({ label, name, wide, ...rest }: { label: string; name: string; wide?: boolean; type?: string; defaultValue?: string | number }) {
  const id = `${name}-${String(rest.defaultValue ?? "")}-${label}`;
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} {...rest} />
    </div>
  );
}

function AddForm({ onDone }: { onDone: (r: AuctionResult) => void }) {
  const [state, action, pending] = useActionState(async (p: AuctionResult | null, fd: FormData) => { const r = await createAuctionAction(p, fd); onDone(r); return r; }, null);
  const { setForm: keepRef, onSubmit: keepSubmit } = useKeepingForm(action, state, pending, true);
  return (
    <form ref={keepRef} onSubmit={keepSubmit} className="grid max-w-3xl grid-cols-2 gap-2 rounded-lg border border-neutral-200 bg-white p-3 md:grid-cols-4">
      <div className="col-span-2"><Label htmlFor="add-name">Короткое имя *</Label><Input id="add-name" name="name" required placeholder="Например, СП 11.26" /></div>
      <div className="col-span-2"><Label htmlFor="add-house">Дом / источник</Label><Input id="add-house" name="house" placeholder="Союзпушнина, SAGA, ферма…" /></div>
      <div>
        <Label htmlFor="add-kind">Вид</Label>
        <Select id="add-kind" name="kind" defaultValue="FUR">{Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
      </div>
      <div><Label htmlFor="add-year">Год</Label><Input id="add-year" name="year" type="number" /></div>
      <div><Label htmlFor="add-month">Месяц</Label><Input id="add-month" name="month" type="number" /></div>
      <div><Label htmlFor="add-cur">Валюта</Label><Input id="add-cur" name="currency" placeholder="USD" /></div>
      <div className="col-span-2"><Label htmlFor="add-date">Дата аукциона</Label><Input id="add-date" name="auctionDate" type="date" /></div>
      <div className="col-span-2 md:col-span-4"><Label htmlFor="add-full">Полное название (как в документах)</Label><Input id="add-full" name="fullName" /></div>
      {state?.error && <p className="col-span-2 text-sm text-red-600 md:col-span-4">{state.error}</p>}
      <Button type="submit" disabled={pending} className="col-span-2 self-end md:col-span-1">{pending ? "Добавляю…" : "Добавить"}</Button>
    </form>
  );
}

function BulkConfirm({ pending, onDone, onCancel }: { pending: AuctionRowData[]; onDone: (r: AuctionResult) => void; onCancel: () => void }) {
  const [busy, start] = useTransition();
  return (
    <div className="max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
      <div className="mb-2 font-medium">Будут подтверждены имена ({pending.length}):</div>
      <ul className="mb-3 max-h-64 space-y-1 overflow-auto">
        {pending.map((r) => (
          <li key={r.id}><b>{r.name}</b>{r.aliases.length > 0 && <span className="text-neutral-600"> ← {r.aliases.join("; ")}</span>}<span className="text-neutral-500"> · закупок {r.purchaseCount}</span></li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => start(async () => onDone(await confirmManyAction(pending.map((p) => p.id))))}>Подтвердить все</Button>
        <Button variant="ghost" onClick={onCancel}>Отмена</Button>
      </div>
    </div>
  );
}
