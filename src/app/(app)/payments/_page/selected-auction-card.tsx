import { storedFileExists } from "@/lib/stored-file-check";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { auctionName, CLOSING_NOTE, type AuctionPay } from "@/lib/auction-payments";
import { type loadPaymentsSourceDocs } from "@/lib/source-docs-server";
import { PaymentLinesTable, type PayLine } from "../payment-lines";
import { KIND_LABELS, payComment, payInvoice } from "./helpers";
import { auctionPayControls } from "./auction-pay-controls";
import type { AuctionPurchaseRow, PaymentRow } from "./load";

/** Карточка выбранной партии закупки: все её оплаты (своей партии и закупок в ней). */
export function SelectedAuctionCard({
  selected,
  auctionPurchases,
  auctionPurchaseMap,
  payments,
  srcDocs,
  canPay,
  today,
}: {
  selected: AuctionPay;
  auctionPurchases: AuctionPurchaseRow[];
  auctionPurchaseMap: Map<string, AuctionPurchaseRow>;
  payments: PaymentRow[];
  srcDocs: Awaited<ReturnType<typeof loadPaymentsSourceDocs>>;
  canPay: boolean;
  today: string;
}) {
            const ids = new Set(auctionPurchases.filter((p) => auctionName(p.auctionSession) === selected.name).map((p) => p.id));
            const rows = payments.filter((p) => (p.auctionSession === selected.name && !p.purchaseId) || (p.purchaseId && ids.has(p.purchaseId)));
            const lines: PayLine[] = rows.map((p) => {
              const own = Boolean(p.auctionSession) && !p.purchaseId;
              const closing = own && p.notes === CLOSING_NOTE;
              const pu = p.purchaseId ? auctionPurchaseMap.get(p.purchaseId) : null;
              return {
                id: p.id,
                date: formatDate(p.paidAt),
                amount: p.amount.toString(),
                what: closing ? "Закрытие остатка" : own ? KIND_LABELS[p.kind] ?? p.kind : "Оплата закупки",
                invoice: payInvoice(p.docRef, pu),
                comment: payComment(p.docRef, formatDate(p.paidAt)) || undefined,
                ppNo: /п\/п\s*№?\s*(\d+)/.exec(p.docRef ?? "")?.[1] ?? null,
                confirmed: p.confirmedAt != null,
                status: p.status === "PENDING" ? "PENDING" : p.status === "COMPLETED" ? "COMPLETED" : "CANCELLED",
                overdue: p.status === "PENDING" && p.paidAt.toISOString().slice(0, 10) < today,
                docCount: new Set(p.driveDocuments.filter((d) => storedFileExists(d.storagePath)).map((d) => d.driveFileId)).size + (p.document ? 1 : 0),
                sourceDocs: srcDocs[p.id],
                controls: own ? (canPay ? auctionPayControls(p, selected) : undefined) : p.purchaseId ? <Link href={`/purchases/${p.purchaseId}`} className="text-sm text-blue-700 hover:underline">Править в карточке закупки →</Link> : undefined,
              };
            });
            return (
              <Card>
                <CardHeader>
                  <CardTitle>{selected.name}</CardTitle>
                  <CardDescription className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>Закупок: {selected.purchases}{selected.purchasesAll > selected.purchases ? ` (+${selected.purchasesAll - selected.purchases} отменено)` : ""}</span>
                    <Link href={`/lots?auction=${encodeURIComponent(selected.name)}`} className="hover:underline">Лоты и себестоимость →</Link>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <section>
                    <h3 className="mb-2 block-title">Оплаты ({lines.length})</h3>
                    <PaymentLinesTable lines={lines} emptyText={`По этой партии оплат пока нет`} />
                  </section>

                </CardContent>
              </Card>
            );
}
