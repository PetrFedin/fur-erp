"use client";

import { Breadcrumbs } from "@/components/breadcrumbs";
import { useClientSort } from "@/lib/use-client-sort";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";

/**
 * Справочники «Аукционы» и «Мех» для внешнего поставщика: только названия и написания.
 * Закупки, суммы, количества лотов и примечания (в них бывают цены) сюда не попадают — поэтому это отдельные виды,
 * а не обычные таблицы с выключенной правкой.
 */
const KIND: Record<string, string> = { FUR: "Мех", LINING: "Подкладка", MATERIALS: "Материалы", OTHER: "Прочее" };

type AuctionRef = { id: string; name: string; fullName: string | null; house: string | null; kind: string; year: number | null; month: number | null; aliases: string[]; confirmed: boolean };

export function SupplierAuctionsRef({ rows }: { rows: AuctionRef[] }) {
  const s = useClientSort<AuctionRef>({ name: (r) => r.name, full: (r) => r.fullName, house: (r) => r.house, kind: (r) => (r.year ? r.year * 100 + (r.month ?? 0) : null) });
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Справочники", href: "/settings" }, { label: "Аукционы" }]} />
      <h1 className="text-xl font-semibold">Справочник аукционов</h1>
      <Table stickyHeader className="min-w-[640px]">
        <Thead><Tr><Th {...s.th("name")}>Короткое имя</Th><Th {...s.th("full")}>Полное название</Th><Th {...s.th("house")}>Дом</Th><Th {...s.th("kind")}>Вид · год/мес.</Th></Tr></Thead>
        <Tbody>
          {s.sort(rows).map((r) => (
            <Tr key={r.id}>
              <Td className="align-top font-medium">{r.name}{r.aliases.length > 0 && <div className="mt-1 max-w-[12rem] text-xs font-normal text-neutral-500">раньше: {r.aliases.join("; ")}</div>}</Td>
              <Td className="max-w-[16rem] align-top text-xs text-neutral-600">{r.fullName ?? "—"}</Td>
              <Td className="align-top text-sm">{r.house ?? "—"}</Td>
              <Td className="align-top text-sm">{KIND[r.kind] ?? r.kind}<div className="text-xs tabular-nums text-neutral-500">{r.year ? `${r.year}${r.month ? `/${String(r.month).padStart(2, "0")}` : ""}` : "—"}</div></Td>
            </Tr>
          ))}
          {rows.length === 0 && <Tr><Td colSpan={4} className="py-8 text-center text-neutral-500">Справочник пуст</Td></Tr>}
        </Tbody>
      </Table>
    </div>
  );
}

type FurRef = { id: string; name: string; nameEn: string | null; aliases: string[] };

export function SupplierFursRef({ rows }: { rows: FurRef[] }) {
  const s = useClientSort<FurRef>({ name: (r) => r.name, en: (r) => r.nameEn, aliases: (r) => r.aliases.join(", ") });
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Справочники", href: "/settings" }, { label: "Мех" }]} />
      <h1 className="text-xl font-semibold">Справочник меха</h1>
      <Table stickyHeader className="min-w-[560px]">
        <Thead><Tr><Th {...s.th("name")}>Название</Th><Th {...s.th("en")}>По-английски</Th><Th {...s.th("aliases")}>Другие написания</Th></Tr></Thead>
        <Tbody>
          {s.sort(rows).map((r) => (
            <Tr key={r.id}>
              <Td className="font-medium">{r.name}</Td>
              <Td>{r.nameEn ?? "—"}</Td>
              <Td className="text-sm text-neutral-600">{r.aliases.join(", ") || "—"}</Td>
            </Tr>
          ))}
          {rows.length === 0 && <Tr><Td colSpan={3} className="py-8 text-center text-neutral-500">Справочник пуст</Td></Tr>}
        </Tbody>
      </Table>
    </div>
  );
}

/** Общий вид справочника для поставщика: название, группа и другие написания. Без счётчиков, ТЗ, закупок и примечаний. */
type SimpleRef = { id: string; name: string; group?: string | null; sub?: string | null; aliases: string[] };

export function SupplierSimpleRef({ title, rows }: { title: string; rows: SimpleRef[] }) {
  const s = useClientSort<SimpleRef>({ name: (r) => r.name, group: (r) => r.group, sub: (r) => r.sub, aliases: (r) => r.aliases.join(", ") });
  const hasGroup = rows.some((r) => r.group);
  const hasSub = rows.some((r) => r.sub);
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Справочники", href: "/settings" }, { label: title }]} />
      <h1 className="text-xl font-semibold">{title}</h1>
      <Table stickyHeader className="min-w-[520px]">
        <Thead><Tr><Th {...s.th("name")}>Название</Th>{hasGroup && <Th {...s.th("group")}>Группа</Th>}{hasSub && <Th {...s.th("sub")}>Вид меха</Th>}<Th {...s.th("aliases")}>Другие написания</Th></Tr></Thead>
        <Tbody>
          {s.sort(rows).map((r) => (
            <Tr key={r.id}>
              <Td className="font-medium">{r.name}</Td>
              {hasGroup && <Td className="text-sm">{r.group ?? "—"}</Td>}
              {hasSub && <Td className="text-sm">{r.sub ?? "—"}</Td>}
              <Td className="text-sm text-neutral-600">{r.aliases.join(", ") || "—"}</Td>
            </Tr>
          ))}
          {rows.length === 0 && <Tr><Td colSpan={4} className="py-8 text-center text-neutral-500">Справочник пуст</Td></Tr>}
        </Tbody>
      </Table>
    </div>
  );
}
