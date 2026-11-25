import type { PurchaseDocument } from "@prisma/client";
import { formatDate } from "@/lib/utils";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { DOC_KIND_LABELS } from "@/lib/purchase-files";
import { DocFileButtons } from "@/components/doc-preview";
import { copiesLabel } from "@/lib/drive-docs-group";
import { DocEditControls } from "../auction-controls";
import { docVersion, fmtSize } from "./helpers";

type DocRow = { d: PurchaseDocument; batch: boolean; purchaseId: string; purchaseLabel: string };

// Таблица файлов аукциона: один файл — одна строка, повторные привязки того же файла — внутри строки.
export function DocFilesTable({ fileGroups, canEdit, editPurchaseId }: { fileGroups: DocRow[][]; canEdit: boolean; editPurchaseId: string }) {
  return (
    <Table className="max-md:block">
      <Thead className="max-md:hidden">
        <Tr>
          <Th>Документ</Th>
          <Th>Тип</Th>
          <Th>Относится к</Th>
          <Th>Дата</Th>
          <Th>Размер</Th>
          <Th>Файл</Th>
          {canEdit && <Th>Корректировка</Th>}
        </Tr>
      </Thead>
      <Tbody className="max-md:block">
        {fileGroups.map((g) => {
          const { d } = g[0];
          const v = docVersion(d.storagePath);
          const where = (r: (typeof g)[number]) => (r.batch ? `вся партия ${r.d.batch ?? ""}` : `закупка ${r.purchaseLabel}`);
          const controls = (r: (typeof g)[number]) => (
            <DocEditControls
              documentId={r.d.id}
              purchaseId={r.purchaseId || editPurchaseId}
              title={r.d.title}
              kind={r.d.kind}
              isBatch={r.batch}
              batchName={r.d.batch}
            />
          );
          return (
            <Tr key={d.id} className="align-top max-md:block max-md:space-y-1 max-md:p-3">
              <Td className="min-w-40 font-medium max-md:block max-md:px-0 max-md:py-0">
                {d.title}
                {g.length > 1 && (
                  <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-normal text-neutral-600" title="Один и тот же файл привязан несколько раз">
                    {copiesLabel(g.length)}
                  </span>
                )}
                <div className="text-xs font-normal text-neutral-500">{d.originalName}</div>
              </Td>
              <Td className="whitespace-nowrap max-md:block max-md:px-0 max-md:py-0">{DOC_KIND_LABELS[d.kind]}</Td>
              <Td className="text-xs max-md:block max-md:px-0 max-md:py-0">
                {g.length === 1 ? (
                  where(g[0])
                ) : (
                  <details>
                    <summary className="cursor-pointer">{g.length} привязок</summary>
                    <ul className="mt-1 list-disc pl-4">
                      {g.map((r) => (
                        <li key={r.d.id}>{where(r)}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </Td>
              <Td className="whitespace-nowrap max-md:inline-block max-md:px-0 max-md:py-0 max-md:pr-3">{formatDate(d.createdAt)}</Td>
              <Td className="whitespace-nowrap max-md:inline-block max-md:px-0 max-md:py-0">{fmtSize(d.sizeBytes)}</Td>
              <Td className="max-md:block max-md:px-0 max-md:py-1">
                <div className="flex flex-wrap gap-1">
                  <DocFileButtons href={`/api/purchase-docs/${d.id}?v=${v}`} mime={d.mimeType} title={d.title} />
                </div>
              </Td>
              {canEdit && (
                <Td className="min-w-56 max-md:block max-md:min-w-0 max-md:px-0 max-md:py-1">
                  {g.length === 1 ? (
                    controls(g[0])
                  ) : (
                    <details>
                      <summary className="cursor-pointer text-xs text-neutral-500">Правки по привязкам ({g.length})</summary>
                      <div className="mt-2 flex flex-col gap-3">
                        {g.map((r) => (
                          <div key={r.d.id}>
                            <div className="mb-1 text-xs text-neutral-500">{where(r)}</div>
                            {controls(r)}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </Td>
              )}
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
}
