import { Breadcrumbs } from "@/components/breadcrumbs";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";

/**
 * Справочники «Аукционы» и «Мех» для внешнего поставщика: только названия и написания.
 * Закупки, суммы, количества лотов и примечания (в них бывают цены) сюда не попадают — поэтому это отдельные виды,
 * а не обычные таблицы с выключенной правкой.
 */
const KIND: Record<string, string> = { FUR: "Мех", LINING: "Подкладка", MATERIALS: "Материалы", OTHER: "Прочее" };

export function SupplierAuctionsRef({ rows }: { rows: { id: string; name: string; fullName: string | null; house: string | null; kind: string; year: number | null; month: number | null; aliases: string[]; confirmed: boolean }[] }) {
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Справочники", href: "/settings" }, { label: "Аукционы" }]} />
      <h1 className="text-xl font-semibold">Справочник аукционов</h1>
      <Table stickyHeader className="min-w-[640px]">
        <Thead><Tr><Th>Короткое имя</Th><Th>Полное название</Th><Th>Дом</Th><Th>Вид · год/мес.</Th></Tr></Thead>
        <Tbody>
          {rows.map((r) => (
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

export function SupplierFursRef({ rows }: { rows: { id: string; name: string; nameEn: string | null; aliases: string[] }[] }) {
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Справочники", href: "/settings" }, { label: "Мех" }]} />
      <h1 className="text-xl font-semibold">Справочник меха</h1>
      <Table stickyHeader className="min-w-[560px]">
        <Thead><Tr><Th>Название</Th><Th>По-английски</Th><Th>Другие написания</Th></Tr></Thead>
        <Tbody>
          {rows.map((r) => (
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
export function SupplierSimpleRef({ title, rows }: { title: string; rows: { id: string; name: string; group?: string | null; sub?: string | null; aliases: string[] }[] }) {
  const hasGroup = rows.some((r) => r.group);
  const hasSub = rows.some((r) => r.sub);
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Справочники", href: "/settings" }, { label: title }]} />
      <h1 className="text-xl font-semibold">{title}</h1>
      <Table stickyHeader className="min-w-[520px]">
        <Thead><Tr><Th>Название</Th>{hasGroup && <Th>Группа</Th>}{hasSub && <Th>Вид меха</Th>}<Th>Другие написания</Th></Tr></Thead>
        <Tbody>
          {rows.map((r) => (
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
