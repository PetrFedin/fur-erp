import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { formatMoney, formatDate } from "@/lib/utils";
import { createAdvancePayment } from "./actions";
import { hasRole } from "@/lib/access";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cleanSearch } from "@/lib/input";
import { auctionName, loadAuctionSummaries, AUCTION_PAY_STATUS_LABELS, type AuctionPay, type AuctionPayStatus } from "@/lib/auction-payments";
import { AuctionPaymentForm, PaymentRowControls } from "./auction-payment-form";

const METHOD_LABELS: Record<string, string> = {
  CASH: "Наличные",
  BANK_TRANSFER: "Банк. перевод",
  CARD: "Карта",
  OTHER: "Другое",
};

const KIND_LABELS: Record<string, string> = {
  ADVANCE: "Аванс",
  PARTIAL: "Доплата",
  FINAL: "Окончательный расчёт",
  OTHER: "Другое",
};

const STATUS_VARIANT: Record<AuctionPayStatus, "danger" | "warning" | "success" | "info"> = {
  UNPAID: "danger",
  PARTIAL: "warning",
  PAID: "success",
  OVERPAID: "info",
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  ADVANCE: "Аванс",
  PARTIAL: "Доплата",
  FINAL: "Оплата",
};

export default async function PaymentsPage({
  searchParams,
}: PageProps<"/payments">) {
  const session = await requireSession();
  const sp = await searchParams;
  const canPay = hasRole(session.user.role, ["OWNER", "ADMIN", "PURCHASER", "ACCOUNTANT"]);
  const flashError = typeof sp.error === "string" ? sp.error.slice(0, 300) : "";
  const tab: "suppliers" | "clients" =
    sp.tab === "clients" ? "clients" : "suppliers";
  const orgId = session.user.organizationId;
  const auctionQ = tab === "suppliers" ? cleanSearch(sp.auction, 200) : "";
  const [payments, suppliers, clientPayments, summaries, auctionPurchases] = await Promise.all([
    prisma.payment.findMany({
      where: { organizationId: orgId },
      include: {
        supplier: true,
        purchase: { select: { id: true, number: true, auctionSession: true, invoiceNumber: true } },
        document: { select: { id: true, originalName: true, mimeType: true, storagePath: true, sizeBytes: true } },
      },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    }),
    prisma.supplier.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
      orderBy: { name: "asc" },
    }),
    tab === "clients"
      ? prisma.productionPayment.findMany({
          where: { organizationId: session.user.organizationId },
          include: {
            client: true,
            orders: { include: { productionOrder: true } },
          },
          orderBy: { paidAt: "desc" },
        })
      : Promise.resolve([]),
    tab === "suppliers" ? loadAuctionSummaries(prisma, orgId) : Promise.resolve([] as AuctionPay[]),
    tab === "suppliers"
      ? prisma.purchase.findMany({
          where: { organizationId: orgId, auctionSession: { not: null } },
          select: { id: true, number: true, invoiceNumber: true, auctionSession: true },
        })
      : Promise.resolve([]),
  ]);

  // Какой аукцион к оплате: по порядку — самые большие остатки сверху, оплаченные внизу.
  const auctions = [...summaries].sort(
    (a, b) =>
      Number(a.status === "PAID") - Number(b.status === "PAID") ||
      b.remaining.comparedTo(a.remaining) ||
      a.name.localeCompare(b.name, "ru"),
  );
  const selected = auctionQ ? auctions.find((a) => a.name === auctionQ) ?? null : null;
  const auctionPurchaseMap = new Map(auctionPurchases.map((p) => [p.id, p]));
  const inAuction = (p: (typeof payments)[number]) =>
    Boolean(p.auctionSession) || (p.purchase ? Boolean(auctionName(p.purchase.auctionSession)) : false);
  const outside = payments.filter((p) => !inAuction(p));
  const sum = (f: (a: AuctionPay) => { toString(): string }) => auctions.reduce((acc, a) => acc + Number(f(a).toString()), 0);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Оплаты</h1>
      {flashError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{flashError}</p>
      )}

      <div className="flex gap-1 border-b border-neutral-200 pb-2">
        <Link
          href="/payments"
          className={
            "rounded-md px-3 py-1.5 text-sm " +
            (tab === "suppliers"
              ? "bg-neutral-900 text-white"
              : "text-neutral-700 hover:bg-neutral-100")
          }
        >
          Поставщикам
        </Link>
        <Link
          href="/payments?tab=clients"
          className={
            "rounded-md px-3 py-1.5 text-sm " +
            (tab === "clients"
              ? "bg-neutral-900 text-white"
              : "text-neutral-700 hover:bg-neutral-100")
          }
        >
          От заказчиков
        </Link>
      </div>

      {tab === "clients" ? (
        <>
        <p className="text-sm text-neutral-600">
          Ввести оплату — на карточке ТЗ: откройте нужное ТЗ в разделе{" "}
          <Link href="/production" className="underline hover:no-underline">
            ТЗ
          </Link>
          . Здесь оплаты заказчиков только собраны списком.
        </p>
        <Table>
          <Thead>
            <Tr>
              <Th>Дата</Th>
              <Th>Заказчик</Th>
              <Th>ТЗ</Th>
              <Th>Тип</Th>
              <Th>Сумма</Th>
              <Th></Th>
            </Tr>
          </Thead>
          <Tbody>
            {clientPayments.map((p) => (
              <Tr key={p.id}>
                <Td>{formatDate(p.paidAt)}</Td>
                <Td>{p.client?.name ?? "—"}</Td>
                <Td>
                  {p.orders.length === 0
                    ? "—"
                    : p.orders.map((o, i) => (
                        <span key={o.id}>
                          {i > 0 && ", "}
                          <Link
                            href={`/production/${o.productionOrderId}`}
                            className="hover:underline"
                          >
                            {o.productionOrder.number}
                          </Link>
                        </span>
                      ))}
                </Td>
                <Td>{PAYMENT_TYPE_LABELS[p.paymentType]}</Td>
                <Td>{formatMoney(p.amount.toString())}</Td>
                <Td>
                  {p.orders[0] ? (
                    <Link href={`/production/${p.orders[0].productionOrderId}`} className="text-sm hover:underline">
                      К ТЗ
                    </Link>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </Td>
              </Tr>
            ))}
            {clientPayments.length === 0 && (
              <Tr>
                <Td colSpan={6} className="py-8 text-center text-neutral-400">
                  Оплат от заказчиков пока нет
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
        </>
      ) : (
        <>
          <p className="text-sm text-neutral-600">
            Мы платим не аукциону, а посреднику — ООО «Веллмех». Аукцион (партия закупок, например «СП 09-26») нужен,
            чтобы разнести оплаты и видеть остаток к оплате по каждому. Стоимость, оплачено и остаток — всегда с НДС и не
            зависят от переключателя «С НДС / Без НДС»: это то, что мы должны Веллмех.
          </p>

          {auctions.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Стоимость аукционов, с НДС" value={formatMoney(sum((a) => a.total))} />
              <Stat label="Оплачено" value={formatMoney(sum((a) => a.paid))} />
              <Stat label="Запланировано" value={formatMoney(sum((a) => a.planned))} />
              <Stat label="Остаток к оплате" value={formatMoney(sum((a) => a.remaining.greaterThan(0) ? a.remaining : 0))} warn />
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {auctions.map((a) => {
              const active = selected?.name === a.name;
              return (
                <Link
                  key={a.name}
                  href={`/payments?auction=${encodeURIComponent(a.name)}#auction-block`}
                  scroll
                  className={
                    "flex flex-col gap-2 rounded-lg border bg-white p-3 transition-colors hover:border-neutral-400 " +
                    (active ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200")
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-neutral-500">закупок: {a.purchases}</div>
                    </div>
                    <Badge variant={STATUS_VARIANT[a.status]}>{AUCTION_PAY_STATUS_LABELS[a.status]}</Badge>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt className="text-neutral-500">Стоимость</dt>
                    <dd className="text-right">{formatMoney(a.total.toString())}</dd>
                    <dt className="text-neutral-500">Оплачено</dt>
                    <dd className="text-right">{formatMoney(a.paid.toString())}</dd>
                    <dt className="text-neutral-500">Запланировано</dt>
                    <dd className="text-right">{formatMoney(a.planned.toString())}</dd>
                    <dt className="font-medium">Остаток</dt>
                    <dd className={"text-right font-semibold " + (a.remaining.greaterThan(0.005) ? "text-amber-600" : a.remaining.lessThan(-0.005) ? "text-blue-600" : "")}>
                      {formatMoney(a.remaining.toString())}
                    </dd>
                  </dl>
                  <ProgressBar percent={a.percentPaid} status={a.status} />
                </Link>
              );
            })}
          </div>
          {auctions.length === 0 && (
            <p className="rounded-md bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-500">
              Аукционов пока нет: укажите «Аукцион / сессию» в карточке закупки, и партия появится здесь.
            </p>
          )}

          <div id="auction-block" className="scroll-mt-4" />
          {auctionQ && !selected && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Аукцион «{auctionQ}» не найден. Выберите его из списка выше.
            </p>
          )}
          {selected && (() => {
            const ids = new Set(auctionPurchases.filter((p) => auctionName(p.auctionSession) === selected.name).map((p) => p.id));
            const rows = payments.filter((p) => (p.auctionSession === selected.name && !p.purchaseId) || (p.purchaseId && ids.has(p.purchaseId)));
            const total = Number(selected.total.toString());
            return (
              <Card>
                <CardHeader>
                  <CardTitle>Аукцион: {selected.name}</CardTitle>
                  <CardDescription className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      Закупок: {selected.purchases}
                      {selected.purchasesAll > selected.purchases ? ` (+${selected.purchasesAll - selected.purchases} отменено)` : ""}
                    </span>
                    <Link href={`/lots?auction=${encodeURIComponent(selected.name)}`} className="hover:underline">
                      Лоты и себестоимость аукциона →
                    </Link>
                    {selected.perPurchase.map((pp) => {
                      const pu = auctionPurchaseMap.get(pp.id);
                      return pu ? (
                        <Link key={pp.id} href={`/purchases/${pp.id}`} className="hover:underline">
                          {pu.invoiceNumber ? `Счёт ${pu.invoiceNumber}` : pu.number}
                        </Link>
                      ) : null;
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="Полная стоимость, с НДС" value={formatMoney(selected.total.toString())} />
                    <Stat label="Оплачено" value={formatMoney(selected.paid.toString())} note={`${selected.percentPaid.toLocaleString("ru-RU")} %`} />
                    <Stat label="Запланировано" value={formatMoney(selected.planned.toString())} />
                    <Stat label="ОСТАТОК" value={formatMoney(selected.remaining.toString())} warn={selected.remaining.greaterThan(0.005)} />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <ProgressBar percent={selected.percentPaid} status={selected.status} />
                    </div>
                    <Badge variant={STATUS_VARIANT[selected.status]}>{AUCTION_PAY_STATUS_LABELS[selected.status]}</Badge>
                  </div>
                  {selected.status === "OVERPAID" && (
                    <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
                      Оплачено больше полной стоимости на {formatMoney(selected.remaining.neg().toString())}. Проверьте оплаты ниже.
                    </p>
                  )}
                  {selected.purchases > 0 && selected.paidByPurchases.greaterThan(0) && (
                    <p className="text-xs text-neutral-500">
                      В «Оплачено» входят и оплаты, внесённые прямо в закупки аукциона: {formatMoney(selected.paidByPurchases.toString())}.
                    </p>
                  )}

                  <div>
                    <h3 className="mb-2 text-sm font-semibold">История оплат ({rows.length})</h3>
                    <div className="flex flex-col gap-2">
                      {rows.map((p) => {
                        const amountN = Number(p.amount.toString());
                        const own = Boolean(p.auctionSession) && !p.purchaseId;
                        const overdue = p.status === "PENDING" && p.paidAt.toISOString().slice(0, 10) < today;
                        const pu = p.purchaseId ? auctionPurchaseMap.get(p.purchaseId) : null;
                        return (
                          <div
                            key={p.id}
                            className={"rounded-lg border bg-white p-3 " + (p.status === "PENDING" ? "border-dashed border-amber-300" : "border-neutral-200")}
                          >
                            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-6">
                              <Cell label="Дата">{formatDate(p.paidAt)}</Cell>
                              <Cell label="Тип">
                                {own ? KIND_LABELS[p.kind] ?? p.kind : <span className="text-neutral-500">Оплата закупки</span>}
                                {pu && (
                                  <Link href={`/purchases/${pu.id}`} className="block text-xs hover:underline">
                                    {pu.invoiceNumber ? `Счёт ${pu.invoiceNumber}` : pu.number}
                                  </Link>
                                )}
                              </Cell>
                              <Cell label="Сумма">
                                <span className="font-semibold">{formatMoney(p.amount.toString())}</span>
                                <span className="block text-xs text-neutral-500">
                                  {total > 0 ? `${((amountN / total) * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} % от стоимости` : "—"}
                                </span>
                              </Cell>
                              <Cell label="Способ">{METHOD_LABELS[p.method] ?? p.method}</Cell>
                              <Cell label="Статус">
                                {p.status === "COMPLETED" ? (
                                  <Badge variant="success">Оплачено</Badge>
                                ) : p.status === "PENDING" ? (
                                  <Badge variant={overdue ? "danger" : "warning"}>{overdue ? "Запланирована, просрочена" : "Запланирована"}</Badge>
                                ) : (
                                  <Badge>Отменена</Badge>
                                )}
                              </Cell>
                              <Cell label="Платёжный документ">
                                {p.document ? (
                                  <span className="flex flex-col gap-1">
                                    <span className="break-all text-xs text-neutral-500">{p.document.originalName}</span>
                                    <span className="flex gap-1">
                                      <a
                                        href={`/api/purchase-docs/${p.document.id}?download=1&v=${encodeURIComponent(p.document.storagePath.split(/[\\/]/).pop() ?? "")}`}
                                        className={buttonVariants({ variant: "outline", size: "sm" })}
                                      >
                                        Скачать
                                      </a>
                                      <a
                                        href={`/api/purchase-docs/${p.document.id}?v=${encodeURIComponent(p.document.storagePath.split(/[\\/]/).pop() ?? "")}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                                      >
                                        Открыть
                                      </a>
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-neutral-400">нет</span>
                                )}
                              </Cell>
                            </div>
                            {p.notes && <p className="mt-2 text-xs text-neutral-600">Заметка: {p.notes}</p>}
                            {own && canPay && (
                              <div className="mt-2 border-t border-neutral-100 pt-2">
                                <PaymentRowControls
                                  auction={selected.name}
                                  total={total}
                                  paid={Number(selected.paid.sub(p.status === "COMPLETED" ? p.amount : 0).toString())}
                                  planned={Number(selected.planned.sub(p.status === "PENDING" ? p.amount : 0).toString())}
                                  suppliers={selected.suppliers}
                                  initial={{
                                    id: p.id,
                                    kind: p.kind,
                                    status: p.status === "PENDING" ? "PENDING" : "COMPLETED",
                                    paidAt: p.paidAt.toISOString().slice(0, 10),
                                    amount: p.amount.toString(),
                                    percent: p.percent ? p.percent.toString() : null,
                                    method: p.method,
                                    notes: p.notes ?? "",
                                    docName: p.document ? p.document.originalName : null,
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {rows.length === 0 && (
                        <p className="rounded-md bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-400">По этому аукциону оплат Веллмех пока нет</p>
                      )}
                    </div>
                  </div>

                  {canPay && selected.purchases > 0 ? (
                    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <h3 className="mb-2 text-sm font-semibold">Добавить оплату</h3>
                      <AuctionPaymentForm
                        auction={selected.name}
                        total={total}
                        paid={Number(selected.paid.toString())}
                        planned={Number(selected.planned.toString())}
                        suppliers={selected.suppliers}
                      />
                    </div>
                  ) : !canPay ? (
                    <p className="text-xs text-neutral-500">Добавлять оплаты могут владелец, администратор, закупщик и бухгалтер.</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })()}

          <h2 className="mt-2 text-base font-semibold">Без аукциона</h2>
          {canPay && (
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Аванс / предоплата поставщику</CardTitle>
              <CardDescription>
                Аванс без привязки к аукциону и закупке — гасит общий долг поставщика. Оплату Веллмех по конкретному аукциону вносите в блоке этого аукциона выше.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                action={createAdvancePayment}
                className="grid grid-cols-1 items-end gap-2 sm:grid-cols-2 lg:grid-cols-4"
              >
                <div>
                  <Label htmlFor="supplierId">Поставщик</Label>
                  <Select
                    id="supplierId"
                    name="supplierId"
                    required
                    defaultValue=""
                  >
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
                  <Label htmlFor="amount">Сумма, ₽</Label>
                  <Input
                    id="amount"
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="method">Способ</Label>
                  <Select
                    id="method"
                    name="method"
                    defaultValue="BANK_TRANSFER"
                  >
                    {Object.entries(METHOD_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="paidAt">Дата</Label>
                  <Input
                    id="paidAt"
                    name="paidAt"
                    type="date"
                    defaultValue={today}
                    required
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-4">
                  <Button type="submit">Добавить платёж</Button>
                </div>
              </form>
            </CardContent>
          </Card>
          )}

          <div className="flex flex-col gap-2">
            {outside.map((p) => (
              <div key={p.id} className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-neutral-200 bg-white p-3 text-sm md:grid-cols-5">
                <Cell label="Дата">{formatDate(p.paidAt)}</Cell>
                <Cell label="Поставщик">{p.supplier.name}</Cell>
                <Cell label="Закупка">
                  {p.purchase ? (
                    <Link href={`/purchases/${p.purchase.id}`} className="hover:underline">
                      {p.purchase.number}
                    </Link>
                  ) : (
                    <span className="text-neutral-400">Аванс</span>
                  )}
                </Cell>
                <Cell label="Способ">{METHOD_LABELS[p.method]}</Cell>
                <Cell label="Сумма">
                  {formatMoney(p.amount.toString())}
                  {p.status === "PENDING" && <span className="block text-xs text-amber-600">запланирована</span>}
                </Cell>
              </div>
            ))}
            {outside.length === 0 && (
              <p className="rounded-md bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-400">Оплат вне аукционов нет</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, note, warn }: { label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 break-words text-base font-semibold sm:text-lg ${warn ? "text-amber-600" : ""}`}>{value}</div>
      {note && <div className="text-xs text-neutral-500">{note}</div>}
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-neutral-400">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function ProgressBar({ percent, status }: { percent: number; status: AuctionPayStatus }) {
  const color = status === "PAID" ? "bg-emerald-500" : status === "OVERPAID" ? "bg-blue-500" : status === "PARTIAL" ? "bg-amber-500" : "bg-neutral-300";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100" role="progressbar" aria-valuenow={Math.min(percent, 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </div>
      <span className="w-14 text-right text-xs text-neutral-500">{percent.toLocaleString("ru-RU")} %</span>
    </div>
  );
}
