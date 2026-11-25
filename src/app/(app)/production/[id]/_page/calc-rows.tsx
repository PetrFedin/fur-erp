import { Tr, Td } from "@/components/ui/table";

export const UNIT_LABELS: Record<string, string> = { PIECE: "шт.", KG: "кг", M2: "м²", M: "м", SET: "компл." };

export function SectionRow({ children }: { children: React.ReactNode }) {
  return (
    <Tr className="bg-neutral-50/80">
      <Td colSpan={8} className="py-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {children}
      </Td>
    </Tr>
  );
}

export function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <Tr>
      <Td colSpan={8} className="py-2 text-center text-neutral-500">
        {children}
      </Td>
    </Tr>
  );
}

export function TotalRow({ label, value, extra, strong }: { label: React.ReactNode; value: React.ReactNode; extra?: React.ReactNode; strong?: boolean }) {
  return (
    <Tr className="row-total" data-strong={strong ? "1" : undefined}>
      <Td colSpan={6} className="text-right max-xl:text-left">
        {label}
        {extra ? <span className="ml-1 tabular-nums">{extra}</span> : null}
      </Td>
      <Td className="whitespace-nowrap text-right tabular-nums">{value}</Td>
      <Td />
    </Tr>
  );
}
