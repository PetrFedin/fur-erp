import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ControlTabs } from "@/components/control-tabs";
import { Clamp } from "@/components/clamp";
import { InfoHint } from "@/components/info-hint";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";
import { INBOX_FILE_KINDS, INBOX_STATUS_LABEL, shortInboxTitle } from "@/lib/supplier-inbox-consts";
import { previewInbox } from "@/lib/inbox-accept";
import { FORMAT_LABEL, STAGE_LABEL, calcAll, calcVatPct, columnsFor, headerRate, rateCols, resolveRow, rowFilled, ensureRowIds, type CalcPayload } from "@/lib/supplier-calc";
import { TZ_KIND_LABEL, itemFilled, materialFilled, plainNum, ruDate, spacedNum, tzTotals, type TzPayload } from "@/lib/tz-vendor";
import { cn, formatDate, formatNum, formatRate, formatFileSize } from "@/lib/utils";
import { DecideButtons } from "./decide";
import { FinalFigures } from "../../supplier/auction-calcs/final-figures";
import { finalFigures } from "@/lib/supplier-calc-simple";
import { CompareBlock } from "../../supplier/auction-calcs/compare-block";
import { CalcSheetReadonly } from "@/components/calc-sheet-readonly";
import { ChatLink } from "@/components/chat-link";
import { DocumentCard } from "./document-card";

export const metadata = { title: "Входящее" };

const money = (n: number) => (Number.isFinite(n) ? formatNum(n, 1) : "–");
const rateFmt = (n: number) => (Number.isFinite(n) && n > 0 ? formatRate(n) : "–");
const dash = (s: string | undefined) => (s && s.trim() ? s : "–");
const kb = formatFileSize;

function Dl({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="flex gap-2"><dt className="shrink-0 text-neutral-500">{k}:</dt><dd className="min-w-0 break-words">{v}</dd></div>
      ))}
    </dl>
  );
}

async function CalcView({ p, s }: { p: CalcPayload; s: Awaited<ReturnType<typeof requireRole>> }) {
  const h = p.header;
  const t = calcAll(p);
  const cols = columnsFor(p.format);
  const used = p.rows.map((r, i) => ({ r, i })).filter(({ r }) => rowFilled(r)).map(({ r, i }) => ({ r: resolveRow(p.format, p.header, r), i }));
  const costCols = cols.filter((c) => !["invoice", "fur", "size", "lot", "qty", "operation", "dest", "price", "upd"].includes(c.key));
  const ff = finalFigures(p, t);
  return (
    <div className="flex flex-col gap-4">
      <FinalFigures {...ff} />
      <p className="text-sm text-neutral-700">Аукцион <b>{dash(h.auction)}</b> · счёт <Clamp className="inline-block max-w-[16rem] align-bottom">{dash(h.invoice)}</Clamp>{h.invoiceDate ? ` от ${h.invoiceDate}` : ""}{t.rate > 0 ? ` · курс ${rateFmt(t.rate)}` : ""} · {p.stage ? STAGE_LABEL[p.stage] : "окончательный"}</p>
      {p.format === "SHEET" ? <CalcSheetReadonly p={p} t={t} maxHeight="70vh" /> : (
      <div className="overflow-x-auto">
        <Table className="min-w-[640px]">
          <Thead><Tr><Th>Лот</Th><Th>Мех</Th><Th>Цвет / размер</Th><Th className="text-right">Кол-во</Th><Th className="text-right">Цена, {h.currency === "EUR" ? "€" : "$"}</Th><Th className="text-right">Себестоимость за шкуру, ₽</Th><Th className="text-right">За лот, ₽</Th></Tr></Thead>
          <Tbody>
            {used.map(({ r, i }) => (
              <Tr key={i}>
                <Td>{dash(r.lot)}</Td><Td>{dash(r.fur)}</Td><Td className="max-w-[14rem]"><Clamp>{dash(r.size)}</Clamp></Td><Td className="text-right tabular-nums">{dash(r.qty)}</Td><Td className="text-right tabular-nums">{dash(r.price)}</Td>
                <Td className="text-right tabular-nums font-medium">{t.calcs[i].ok ? money(t.calcs[i].unitRub) : <span className="text-red-700">{t.calcs[i].problems.join(", ")}</span>}</Td>
                <Td className="text-right tabular-nums">{money(t.calcs[i].totalRub)}</Td>
              </Tr>
            ))}
            {used.length === 0 && <Tr><Td colSpan={7} className="py-4 text-center text-neutral-500">В расчёте нет лотов</Td></Tr>}
          </Tbody>
        </Table>
      </div>)}
      <CompareBlock s={s} payload={p} />
      <details className="rounded-md border border-neutral-200 p-3">
        <summary className="cursor-pointer select-none text-sm font-medium">Подробности: ставки, столбцы, формулы</summary>
        <div className="mt-3 flex flex-col gap-4">
      <Dl items={[
        ["Формат", FORMAT_LABEL[p.format]], ["Аукцион", dash(h.auction)], ["Счёт №", dash(h.invoice)], ["Дата счёта", dash(h.invoiceDate)], ["Продавец", dash(h.seller)],
        ["Валюта", h.currency], ["Курс ЦБ", dash(h.cbRate)], ["Надбавка агента, %", dash(h.agentPct)], ["Курс для расчёта", rateFmt(t.rate)], ["НДС, %", calcVatPct(p) != null ? String(calcVatPct(p)) : "–"],
        ["Покупатель", dash(h.buyer)], ["Куда", dash(h.dest)], ["Брокер", dash(h.broker)], ["Срок оплаты", dash(h.dueDate)],
        ["Аванс", h.advance ? `${h.advance}${h.advanceDate ? ` от ${h.advanceDate}` : ""}` : "–"], ["Промежуточный платёж", dash(h.interim)],
      ]} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-neutral-500">Стадия:</span>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs", p.stage === "PRELIM" ? "bg-blue-50 text-blue-800" : "bg-green-50 text-green-800")}>{p.stage ? STAGE_LABEL[p.stage] : "не указана (считается окончательным)"}</span>
      </div>
      <div>
        <h3 className="mb-1 text-sm font-semibold">Ставки подрядчика</h3>
        <Dl items={rateCols(p.format).map((c): [string, string] => [c.rate!.label, headerRate(h, c.key) || (p.rows.some((r) => (r[c.key] ?? "").trim() !== "") ? "в строках таблицы" : "не указана (0)")])} />
      </div>
      {(p.customColumns?.length ?? 0) > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Свои столбцы и формулы</h3>
          <Table className="min-w-[560px]">
            <Thead><Tr><Th>Буква</Th><Th>Столбец</Th><Th>Формула</Th><Th>Примечание</Th></Tr></Thead>
            <Tbody>
              {t.sheet.cols.filter((c) => c.kind === "custom").map((c) => (
                <Tr key={c.id}>
                  <Td className="font-mono">{c.letter}</Td><Td>{c.title}{c.unit && !c.title.includes(c.unit) ? `, ${c.unit}` : ""}</Td><Td className="font-mono text-xs">{c.formula}</Td>
                  <Td className="text-xs">{[t.sheet.unitCol === c.id ? "идёт в закупку как себестоимость шкуры" : "", t.sheet.qtyCol === c.id ? "количество" : "", t.sheet.colErrors[c.id] ?? "", Object.values(p.overrides ?? {}).filter((o) => o[c.id] !== undefined).length ? `ручных значений: ${Object.values(p.overrides ?? {}).filter((o) => o[c.id] !== undefined).length}` : ""].filter(Boolean).join("; ") || "–"}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          {(p.params?.length ?? 0) > 0 && <p className="mt-1 text-sm text-neutral-700">Свои параметры: {p.params!.length}<InfoHint label="Свои параметры">{p.params!.map((q) => `${q.name} = ${q.value}`).join("; ")}</InfoHint></p>}
        </div>
      )}
      {h.extras.length > 0 && <p className="text-sm text-neutral-700">Прочие расходы: {h.extras.length}<InfoHint label="Прочие расходы">{h.extras.map((e) => `${e.name || "без названия"} — ${e.amount} (${e.mode === "total" ? "на весь счёт" : "на шкуру"})`).join("; ")}</InfoHint></p>}
      {p.format !== "SHEET" && <CalcSheetReadonly p={p} t={t} maxHeight="70vh" />}
      <p className="text-sm text-neutral-700">Итого по счёту <b>{money(t.totalRub)} ₽</b>
        {t.advance > 0 && <> · аванс {money(t.advance)} ₽</>}{t.interim > 0 && <> · промежуточный {money(t.interim)} ₽</>}{(t.advance > 0 || t.interim > 0) && <> · остаток <b>{money(t.rest)} ₽</b></>}
      </p>
        </div>
      </details>
    </div>
  );
}

function TzView({ p }: { p: TzPayload }) {
  const t = tzTotals(p);
  const items = p.items.map((it, i) => ({ it, i })).filter(({ it }) => itemFilled(it));
  const mats = p.materials.map((m, i) => ({ m, i })).filter(({ m }) => materialFilled(m));
  const tm = p.terms;
  return (
    <div className="flex flex-col gap-4">
      {p.reopenedAt && <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm">ТЗ изменено после отправки: {formatDate(new Date(p.reopenedAt))}</p>}
      <Dl items={[
        ["Вид", TZ_KIND_LABEL[p.kind]], ["Номер ТЗ", p.number], ["Дата", ruDate(p.date)], ["Город", dash(p.city)], ["Договор", dash(p.contract)], ["Заказчик", dash(p.customer)],
        ["Партия", dash(p.batch)], ["НДС, %", dash(p.vatPct)],
      ]} />
      <div className="overflow-x-auto">
        <Table className="min-w-[900px]">
          <Thead><Tr><Th>№</Th><Th>Наименование</Th><Th>Цвет</Th><Th>Модель</Th><Th>Материал</Th><Th>Размер</Th><Th>Подкладка</Th><Th>Кол-во</Th><Th>Работа за ед., ₽</Th><Th>Стоимость за ед., ₽</Th><Th>Итого, ₽</Th></Tr></Thead>
          <Tbody>
            {items.map(({ it, i }, k) => (
              <Tr key={i}>
                <Td>{k + 1}</Td><Td className="max-w-[14rem]"><Clamp>{dash(it.name)}</Clamp></Td><Td className="max-w-[9rem]"><Clamp>{dash(it.color)}</Clamp></Td><Td>{dash(it.model)}</Td><Td className="max-w-[12rem]"><Clamp>{dash(it.material)}</Clamp></Td><Td>{dash(it.size)}</Td><Td className="max-w-[12rem]"><Clamp>{dash(it.lining)}</Clamp></Td>
                <Td className="tabular-nums">{it.qty}</Td><Td className="tabular-nums">{dash(it.work)}</Td><Td className="tabular-nums">{dash(it.price)}</Td><Td className="tabular-nums">{plainNum(t.itemTotals[i] ?? 0)}</Td>
              </Tr>
            ))}
            <Tr className="font-semibold"><Td colSpan={7}>Итого</Td><Td className="tabular-nums">{plainNum(t.qty)}</Td><Td className="tabular-nums">{plainNum(t.work)}</Td><Td /><Td className="tabular-nums">{plainNum(t.total)}</Td></Tr>
          </Tbody>
        </Table>
      </div>
      <div>
        <h3 className="mb-1 text-sm font-semibold">Заказчик передал</h3>
        {mats.length === 0 ? <p className="text-sm text-neutral-500">Нет</p> : (
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <Thead><Tr><Th>Материал</Th><Th>Лот</Th><Th>Ед.</Th><Th>Кол-во</Th><Th>Цена без НДС</Th><Th>НДС, %</Th><Th>Всего, ₽</Th></Tr></Thead>
              <Tbody>
                {mats.map(({ m, i }) => (
                  <Tr key={i}><Td>{dash(m.name)}</Td><Td>{dash(m.lot)}</Td><Td>{dash(m.unit)}</Td><Td className="tabular-nums">{dash(m.qty)}</Td><Td className="tabular-nums">{dash(m.priceNet)}</Td><Td className="tabular-nums">{dash(m.vatPct)}</Td><Td className="tabular-nums">{spacedNum(t.matTotals[i] ?? 0)}</Td></Tr>
                ))}
                <Tr className="font-semibold"><Td colSpan={6}>Итого</Td><Td className="tabular-nums">{spacedNum(t.materials)}</Td></Tr>
              </Tbody>
            </Table>
          </div>
        )}
      </div>
      <div>
        <h3 className="mb-1 text-sm font-semibold">Условия</h3>
        <Dl items={[["Порядок оплаты", dash(tm.payment)], ["Срок завершения работ", tm.deadline ? ruDate(tm.deadline) : "–"], ["Срок поставки", dash(tm.delivery)], ["Место поставки", dash(tm.place)], ["Способ поставки", dash(tm.method)], ["Иные характеристики", dash(tm.other)]]} />
      </div>
    </div>
  );
}

export default async function InboxCardPage({ params }: PageProps<"/inbox/[id]">) {
  const { id } = await params;
  const s = await requireRole(...ACCESS.inbox);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) notFound();
  const row = await prisma.supplierInbox.findFirst({
    where: { id, organizationId: s.user.organizationId, status: { not: "DRAFT" } },
    include: { files: { orderBy: { createdAt: "asc" } }, supplier: { select: { name: true } } },
  });
  if (!row) notFound();
  if (row.kind === "DOCUMENT") return <DocumentCard row={row} />;
  const sent = row.status === "SENT";
  const preview = sent ? await previewInbox(s.user.organizationId, row) : null;
  const author = await prisma.user.findFirst({ where: { id: row.createdById, organizationId: s.user.organizationId }, select: { name: true } });
  const decider = row.decidedById ? await prisma.user.findFirst({ where: { id: row.decidedById }, select: { name: true } }) : null;
  const created = (row.createdEntityId ?? "").split(",").filter(Boolean);
  const purchaseNums = row.createdEntityType === "Purchase" && created.length ? new Map((await prisma.purchase.findMany({ where: { id: { in: created }, organizationId: s.user.organizationId }, select: { id: true, number: true } })).map((x) => [x.id, x.number])) : new Map<string, string>();
  const createdLinks = row.createdEntityType === "Purchase" ? created.map((x) => ({ href: `/purchases/${x}`, label: `Закупка ${purchaseNums.get(x) ?? ""}`.trim() })) : created.map((x, k) => ({ href: `/production/${x}`, label: `ТЗ ${k + 1}` }));
  const kindLabel = (k: string) => INBOX_FILE_KINDS.find((x) => x.key === k)?.label ?? k;

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Контроль", href: "/attention" }, { label: "Входящие", href: "/inbox" }, { label: shortInboxTitle(row.title) }]} />
      <ControlTabs active="inbox" />
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold" title={row.title}>{shortInboxTitle(row.title)}</h1>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs", sent ? "bg-amber-100 text-amber-900" : row.status === "ACCEPTED" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700")}>{row.status === "ACCEPTED" ? "Принято" : INBOX_STATUS_LABEL[row.status]}</span>
      </div>
      <p className="text-sm text-neutral-600">
        Подрядчик: {row.supplier.name}{author?.name ? ` · внёс ${author.name}` : ""}{row.sentAt ? ` · отправлено ${formatDate(row.sentAt)}` : ""}
        {row.decidedAt && <> · {row.status === "ACCEPTED" ? "принято" : "отклонено"} {formatDate(row.decidedAt)}{decider?.name ? ` (${decider.name})` : ""}</>}
      </p>

      {row.note && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{row.note}</div>}
      {row.status === "REJECTED" && row.reviewNote && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm">Комментарий при отклонении: {row.reviewNote}</div>}
      {row.status === "ACCEPTED" && createdLinks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-green-300 bg-green-50 p-3 text-sm">
          Принято, создано:
          {createdLinks.map((l) => <Link key={l.href} href={l.href} className={buttonVariants({ size: "sm", variant: "outline" })}>{l.label}</Link>)}
        </div>
      )}

      {preview && (
        <div className={cn("rounded-md border p-3 text-sm", preview.problems.length ? "border-red-300 bg-red-50" : "border-neutral-300 bg-neutral-50")}>
          {preview.problems.length > 0 && <p className="font-medium text-red-800">Принять пока нельзя:</p>}
          {preview.problems.map((x) => <p key={x} className="text-red-800">{x}</p>)}
          {preview.lines.map((x) => <p key={x}>{x}</p>)}
          {preview.links?.map((l) => <div key={l.href} className="mt-2"><Link href={l.href} className={buttonVariants({ size: "sm", variant: "outline" })}>{l.label}</Link></div>)}
        </div>
      )}

      <div><ChatLink type="SupplierInbox" id={row.id} role={s.user.role} label="Уточнить у Веллмеха" /></div>
      {sent && <DecideButtons id={row.id} blocked={!!preview && preview.problems.length > 0} orderDate={preview?.orderDate} />}

      {row.kind === "AUCTION_CALC" ? <CalcView p={ensureRowIds(row.payload as unknown as CalcPayload)} s={s} /> : <TzView p={row.payload as unknown as TzPayload} />}

      {row.kind === "AUCTION_CALC" && (
        <div><a href={`/api/supplier/auction-calcs/${row.id}/xlsx`} className={buttonVariants({ variant: "outline" })}>Скачать Excel</a></div>
      )}

      {row.kind === "TZ" && (
        <div><a href={`/api/supplier/tz/${row.id}/docx`} className={buttonVariants({ variant: "outline" })}>Скачать Word</a></div>
      )}

      <div>
        <h3 className="mb-1 text-sm font-semibold">Вложения</h3>
        {row.files.length === 0 ? <p className="text-sm text-neutral-500">Нет файлов</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {row.files.map((f) => (
              <li key={f.id}><a className="underline" href={`/api/supplier/inbox-files/${f.id}`}>{f.originalName}</a> <span className="text-neutral-500">· {kindLabel(f.kind)} · {kb(f.sizeBytes)}</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
