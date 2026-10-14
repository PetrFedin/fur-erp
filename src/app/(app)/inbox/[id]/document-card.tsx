import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ControlTabs } from "@/components/control-tabs";
import { buttonVariants } from "@/components/ui/button";
import { INBOX_FILE_KINDS, INBOX_STATUS_LABEL } from "@/lib/supplier-inbox-consts";
import { SUPPLIER_DOC_TYPES, type DocumentPayload } from "@/lib/supplier-docs";
import { cn, formatDate } from "@/lib/utils";
import { DecideButtons } from "./decide";

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

type Row = {
  id: string; title: string; status: string; sentAt: Date | null; decidedAt: Date | null; reviewNote: string | null; payload: unknown;
  createdEntityId: string | null; supplier: { name: string };
  files: { id: string; originalName: string; kind: string; sizeBytes: number }[];
};

/** Карточка входящего-документа от поставщика: что приложено и к чему, вложения, «Принять» (файл уходит в документы закупки) и «Отклонить». */
export function DocumentCard({ row }: { row: Row }) {
  const p = row.payload as DocumentPayload;
  const sent = row.status === "SENT";
  const typeLabel = SUPPLIER_DOC_TYPES.find((t) => t.key === p.docType)?.label ?? p.docType;
  const kindLabel = (k: string) => INBOX_FILE_KINDS.find((x) => x.key === k)?.label ?? k;
  const info: [string, string][] = [
    ["Тип", typeLabel], ["Номер", p.number || "—"], ["Дата", p.date ? p.date.split("-").reverse().join(".") : "—"],
    ["Закупка", p.purchaseNumber], ["Лот", p.lotNumber || "весь счёт / закупка"], ["Комментарий", p.comment || "—"],
  ];
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Контроль", href: "/attention" }, { label: "Входящие", href: "/inbox" }, { label: row.title }]} />
      <ControlTabs active="inbox" />
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">{row.title}</h1>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs", sent ? "bg-amber-100 text-amber-900" : row.status === "ACCEPTED" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700")}>{INBOX_STATUS_LABEL[row.status]}</span>
      </div>
      <p className="text-sm text-neutral-600">От поставщика: {row.supplier.name}{row.sentAt ? `, отправлено ${formatDate(row.sentAt)}` : ""}.</p>
      {row.status === "REJECTED" && row.reviewNote && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm">Комментарий при отклонении: {row.reviewNote}</div>}
      {row.status === "ACCEPTED" && row.createdEntityId && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-green-300 bg-green-50 p-3 text-sm">
          Принято, файлы прикреплены к закупке: <Link href={`/purchases/${row.createdEntityId}`} className={buttonVariants({ size: "sm", variant: "outline" })}>Открыть закупку</Link>
        </div>
      )}
      {sent && <DecideButtons id={row.id} blocked={false} />}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {info.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="shrink-0 text-neutral-500">{k}:</dt><dd className="min-w-0 break-words">{v}</dd></div>)}
      </dl>
      <div>
        <h3 className="mb-1 text-sm font-semibold">Вложения</h3>
        <ul className="flex flex-col gap-1 text-sm">
          {row.files.map((f) => <li key={f.id}><a className="underline" href={`/api/supplier/inbox-files/${f.id}`}>{f.originalName}</a> <span className="text-neutral-500">· {kindLabel(f.kind)} · {kb(f.sizeBytes)}</span></li>)}
          {row.files.length === 0 && <li className="text-neutral-500">Файлов нет</li>}
        </ul>
      </div>
    </div>
  );
}
