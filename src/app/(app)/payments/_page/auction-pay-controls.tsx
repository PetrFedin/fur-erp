import { CLOSING_NOTE, type AuctionPay } from "@/lib/auction-payments";
import { rowVersion, PAYMENT_V } from "@/lib/concurrency";
import { PaymentRowControls } from "../auction-payment-form";
import type { PaymentRow } from "./load";

// Кнопки «Править / Удалить» оплаты партии (общей на все закупки партии) — одни и те же в списке партии и в разделе «Все».
export const auctionPayControls = (p: PaymentRow, a: AuctionPay) => (
  <PaymentRowControls
    auction={a.name}
    total={Number(a.total.toString())}
    paid={Number(a.paid.sub(p.status === "COMPLETED" ? p.amount : 0).toString())}
    planned={Number(a.planned.sub(p.status === "PENDING" ? p.amount : 0).toString())}
    suppliers={a.suppliers}
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
      closing: p.notes === CLOSING_NOTE,
      version: rowVersion(p, PAYMENT_V),
    }}
  />
);
