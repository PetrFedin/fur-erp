import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { InfoHint } from "@/components/info-hint";
import { RecordHistory } from "@/components/record-history";
import { SourceDocs } from "@/components/source-docs";
import { TotalLabel } from "@/components/total-label";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { tidyDocRef } from "@/lib/pay-ref";
import { cleanNote } from "@/lib/note-tags";
import { formatMoney } from "@/lib/utils";
import { loadPaymentsSourceDocs } from "@/lib/source-docs-server";
import { PAY_STATUS_LABEL, loadPaymentsRegistryFull, parsePaymentCode, type PayStatus } from "@/lib/payments-registry";

const money = (n: number) => formatMoney(n.toFixed(2));
const ruDate = (iso: string) => iso.split("-").reverse().join(".");
const TONE: Record<PayStatus, string> = { verified: "text-emerald-700", docs: "text-amber-700", check: "text-neutral-700", mismatch: "text-red-700" };

async function load(code: string, orgId: string) {
  const parsed = parsePaymentCode(code);
  if (!parsed) return null;
  const all = await loadPaymentsRegistryFull(orgId);
  return { parsed, item: all.find((x) => x.row.code === code) ?? null };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const parsed = parsePaymentCode(id);
  if (!parsed) return { title: "Оплата" };
  const p = parsed.kind === "raw"
    ? await prisma.payment.findFirst({ where: { id: parsed.id, organizationId: session.user.organizationId }, select: { amount: true, paidAt: true, supplier: { select: { name: true } } } })
    : await prisma.productionPayment.findFirst({ where: { id: parsed.id, organizationId: session.user.organizationId }, select: { amount: true, paidAt: true, client: { select: { name: true } } } });
  if (!p) return { title: "Оплата" };
  const who = "supplier" in p ? p.supplier.name : (p as { client: { name: string } | null }).client?.name ?? "";
  return { title: `Оплата ${ruDate(p.paidAt.toISOString().slice(0, 10))} · ${money(Number(p.amount))}${who ? ` · ${who}` : ""}` };
}

function Block({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 sm:p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold">{title}{hint ? <InfoHint wide label={`О блоке «${title}»`}>{hint}</InfoHint> : null}</h2>
      {children}
    </section>
  );
}

function Dl({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[minmax(9rem,14rem)_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-neutral-500">{k}</dt>
          <dd className="min-w-0 break-words font-medium text-neutral-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const PP_RX = /п\/п\s*№?\s*(\d+)(?:\s+от\s+(\d{2}\.\d{2}\.\d{4}))?/i;
const INV_RX = /сч[её]т[^№;·]*№\s*([^\s;·]+)(?:\s+от\s+(\d{2}\.\d{2}\.\d{4}))?/i;

/** Карточка оплаты (только чтение). Код в адресе: s-… — оплата поставщику, c-… — оплата от заказчика. Правка — в карточке закупки / ТЗ и мастером оплаты. */
export default async function PaymentCardPage({ params }: PageProps<"/payments/[id]">) {
  const { id } = await params;
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const loaded = await load(id, orgId);
  if (!loaded?.item) notFound();
  const { parsed, item } = loaded;
  const { row: r, ov, verify, registryFact, files } = item;
  const dateText = ruDate(r.iso);
  const pp = PP_RX.exec(ov.doc ?? "");
  const inv = INV_RX.exec(ov.doc ?? "");
  const basis = tidyDocRef(ov.doc, dateText);
  const note = ov.fields.find((f) => f[0] === "Заметка")?.[1];
  const method = ov.fields.find((f) => f[0] === "Способ")?.[1];
  const srcDocs = await loadPaymentsSourceDocs(
    { organizationId: orgId, role: session.user.role },
    parsed.kind === "raw" ? { payments: [parsed.id] } : { productionPayments: [parsed.id] },
  );
  const partsTotal = ov.parts.reduce((a, x) => a + x.amount, 0);
  const allocated = r.amount - r.unallocated;
  const linked = ov.links.length > 0;
  const checks: { ok: boolean; label: string; detail: string }[] = [
    { ok: r.fileOk, label: "Файл загружен", detail: r.fileOk ? files.filter((f) => f.ok).map((f) => f.name).join(", ") : files.length > 0 ? "запись о файле есть, но самого файла в приложении нет" : "платёжка или п/п не приложены" },
    { ok: !!registryFact, label: "Сумма и дата сошлись", detail: registryFact ?? "сверка с документами эту оплату по сумме и дате не подтверждает" },
    { ok: linked, label: "Привязка", detail: linked ? ov.links.map((l) => l.label).join(", ") : parsed.kind === "raw" ? "не привязана к закупке или аукциону" : "не привязана к ТЗ" },
    { ok: r.unallocated <= 0.5, label: "Разнесена на 100 %", detail: r.unallocated <= 0.5 ? `разнесено ${money(allocated)} из ${money(r.amount)}` : `не разнесено ${money(r.unallocated)} из ${money(r.amount)}` },
  ];
  const model = parsed.kind === "raw" ? "Payment" : "ProductionPayment";

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Оплаты", href: "/payments" }, { label: `Оплата ${dateText}` }]} />

      <section className="rounded-lg border border-neutral-200 bg-white p-3 sm:p-4" aria-label="Оплата">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold tabular-nums">{money(r.amount)}</h1>
          <span className="text-sm text-neutral-600">{r.direction === "out" ? "Мы платим" : "Нам платят"} · {r.counterparty}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span>{r.what} · {dateText}</span>
          <span className={"font-medium " + TONE[r.status]}>{PAY_STATUS_LABEL[r.status]}</span>
          <span className="text-neutral-600">
            {verify?.verified ? `Подтверждение: ${verify.stampText ?? "есть"}` : "Подтверждения пока нет"}
            <InfoHint wide label="Что значит «подтверждена»">
              <p>Оплата подтверждена, если есть документ-основание (файл платёжки либо п/п с номером или письмо «оплачено» с датой), она привязана и сумма с датой заданы. Любая правка суммы, документа или даты снимает подтверждение.</p>
              <p className="mt-1">Здесь подтверждение только показывается. Поставить его можно в «Контроль → Не подтверждено».</p>
            </InfoHint>
          </span>
        </div>
      </section>

      <Block title="Основное">
        <Dl items={[
          ["Дата оплаты", dateText],
          ["Сумма", money(r.amount)],
          [r.direction === "out" ? "Получатель" : "Плательщик", r.counterparty],
          ["Тип", r.what],
          ["Счёт", inv ? `№${inv[1]}${inv[2] ? ` от ${inv[2]}` : ""}` : r.invoice || "—"],
          ["П/п", pp ? `№ ${pp[1]}${pp[2] ? ` от ${pp[2]}` : ""}` : r.pp || "—"],
          ...(method ? [["Способ", method] as [string, ReactNode]] : []),
          ...(basis ? [["Основание", basis] as [string, ReactNode]] : []),
          ...(note ? [["Заметка", cleanNote(note) ?? note] as [string, ReactNode]] : []),
          ...(ov.fields.find((f) => f[0] === "Внесена") ? [["Внесена", ov.fields.find((f) => f[0] === "Внесена")![1]] as [string, ReactNode]] : []),
        ]} />
        <p className="text-xs text-neutral-500">Править оплату — в карточке {parsed.kind === "raw" ? "закупки или партии" : "ТЗ"} либо мастером «+ Внести оплату».</p>
      </Block>

      <Block title="Куда отнесено" hint={<p>Разнесение оплаты: {parsed.kind === "raw" ? "по закупкам партии (доля в сумме партии)" : "по ТЗ, как записано в разнесении"}. Остаток «не разнесено» — аванс, который ещё не отнесён к закупкам или ТЗ.</p>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="py-1.5 pr-2 font-medium">Куда</th>
                <th className="px-2 py-1.5 text-right font-medium">Сумма<span className="block text-[10px] font-normal opacity-80">₽</span></th>
                <th className="px-2 py-1.5 font-medium">Примечание</th>
              </tr>
            </thead>
            <tbody>
              {ov.parts.map((x, i) => (
                <tr key={i} className="border-b border-neutral-100">
                  <td className="py-1.5 pr-2">{x.href ? <Link href={x.href} className="text-blue-700 hover:underline">{x.label} ›</Link> : x.label}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{money(x.amount)}</td>
                  <td className="px-2 py-1.5 text-neutral-600">{x.note ?? ""}</td>
                </tr>
              ))}
              {ov.links.filter((l) => !ov.parts.some((x) => x.href === l.href)).map((l) => (
                <tr key={l.href} className="border-b border-neutral-100">
                  <td className="py-1.5 pr-2" colSpan={3}><Link href={l.href} className="text-blue-700 hover:underline">{l.label} ›</Link></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="row-total">
                <td className="py-1.5 pr-2"><TotalLabel /></td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{money(partsTotal)}</td>
                <td className={"px-2 py-1.5 " + (r.unallocated > 0.5 ? "text-amber-700" : "")}>
                  {r.unallocated > 0.5 ? `в т. ч. не разнесено ${money(r.unallocated)}` : "разнесено полностью"}
                  {parsed.kind === "prod" && r.unallocated > 1 ? <Link href="/payments?tab=clients#unallocated" className="ml-2 text-blue-700 hover:underline print:hidden">Разнести остаток →</Link> : null}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Block>

      <Block title="Подтверждение" hint={<p>Чек-лист только показывает, чего не хватает. Кнопок подтверждения здесь нет: файл загружают в блоке «Документы-основания», подтверждение ставят в «Контроль → Не подтверждено».</p>}>
        <ul className="flex flex-col gap-1.5 text-sm">
          {checks.map((c) => (
            <li key={c.label} className="flex flex-wrap items-baseline gap-x-2">
              <span aria-hidden className={c.ok ? "text-emerald-700" : "text-amber-700"}>{c.ok ? "✓" : "○"}</span>
              <span className="font-medium">{c.label}</span>
              <span className="min-w-0 break-words text-neutral-600">{c.detail}</span>
            </li>
          ))}
        </ul>
        {verify && verify.blockers.length > 0 && !verify.verified ? (
          <div className="mt-1 text-xs text-neutral-600">
            <div className="font-medium text-neutral-700">Что мешает подтвердить</div>
            <ul className="list-disc pl-4">{verify.blockers.map((b, i) => <li key={i}>{b.text}</li>)}</ul>
          </div>
        ) : null}
      </Block>

      <div id="docs" className="flex flex-col gap-2">
        {srcDocs[parsed.id] ? <SourceDocs data={srcDocs[parsed.id]} /> : null}
        <RecordHistory model={model} recordId={parsed.id} />
      </div>
    </div>
  );
}
