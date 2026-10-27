import { readSort, sortRows, thSort } from "@/lib/table-sort";
import { prisma } from "@/lib/prisma";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { SupplierSimpleRef } from "../supplier-refs";
import Link from "next/link";
import { InfoHint } from "@/components/info-hint";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { loadFurAttrRows } from "@/lib/fur-attr-server";
import { formatQty } from "@/lib/utils";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, parseFilters, pick } from "@/lib/filters";
import { ConfirmSubmitButton } from "../../purchases/[id]/documents-form";
import { confirmFurAttr, createFurAttr, deleteFurAttr, mergeFurAttrs, updateFurAttr } from "./actions";
import { IconPencil, ICON_BTN } from "@/components/icons";

export const metadata = { title: "Признаки меха" };

// Фильтры справочника: поиск по названию, синонимам и описанию; «предложено / подтверждено»; группа. ok и error — разовые сообщения.
const ATTR_FILTERS = defineFilters({ ...pick(["q", "status"], { q: { label: "Поиск" }, status: { allowed: ["proposed", "confirmed"] } }), group: { kind: "multi", label: "Группа" } });

export default async function FurAttrsPage({ searchParams }: PageProps<"/settings/fur-attrs">) {
  const session = await requireSession({ allowSupplier: true });
  const orgId = session.user.organizationId;
  if (session.user.role === "SUPPLIER") {
    const refs = await prisma.furAttrRef.findMany({ where: { organizationId: orgId, confirmed: true }, orderBy: { name: "asc" }, select: { id: true, name: true, group: true, furKind: true, aliases: true } });
    return <SupplierSimpleRef title="Признаки меха" rows={refs.map((r) => ({ id: r.id, name: r.name, group: r.group, sub: r.furKind, aliases: r.aliases }))} />;
  }
  const canEdit = hasRole(session.user.role, ACCESS.furRefs);
  const sp = await searchParams;
  const flashError = typeof sp.error === "string" ? sp.error.slice(0, 300) : "";
  const flashOk = typeof sp.ok === "string" ? sp.ok.slice(0, 300) : "";
  const f = parseFilters(ATTR_FILTERS, sp);

  const rows = await loadFurAttrRows(orgId);
  const groups = Array.from(new Set(rows.map((r) => r.group).filter((g): g is string => !!g)));
  const needle = f.q.trim().toLowerCase();
  const shown0 = rows.filter(
    (r) =>
      (f.status.length === 0 || f.status.includes(r.confirmed ? "confirmed" : "proposed")) &&
      (f.group.length === 0 || f.group.includes(r.group ?? "")) &&
      (!needle || [r.name, ...r.aliases, r.description ?? "", r.furKind ?? ""].some((x) => x.toLowerCase().includes(needle))),
  );

  const sort = readSort(sp, ["name", "kind", "aliases", "lots", "qty", "orders"]);
  const shown = sortRows(shown0, sort, { name: (r) => r.name, kind: (r) => r.furKind, aliases: (r) => r.aliases.join(", ") || null, lots: (r) => r.lots, qty: (r) => Number(r.qty), orders: (r) => r.ordersOwn + r.ordersViaLots });
  const th = (k: string) => thSort("/settings/fur-attrs", sp, k, sort);

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Признаки меха" }]} />
      <div>
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Признаки меха</h1><InfoHint label="О справочнике" wide>
          Признак, подвид или обработка шкуры, которые пишут в описаниях лотов и ТЗ помимо вида и цвета: седина соболя (SIL.1…SIL.6, «серебристый», «без седины»),
          дикий / клеточный / баргузинский, тонированный, крашеный. Признаки ставятся лотам и ТЗ по тексту описаний, по названию и синонимам;
          по ним работает фильтр «Признак меха» на «Сырье», Главной, в «ТЗ» и аналитике. «Предложено» — признак заведён по найденным в данных написаниям и ждёт вашего подтверждения.
        </InfoHint></div>
      </div>
      {flashError && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{flashError}</p>}
      {flashOk && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{flashOk}</p>}

      {canEdit && (
        <details className="max-w-3xl rounded-xl border border-neutral-200 bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium max-md:py-3">+ Добавить признак</summary>
          <div className="mt-3">
            <form action={createFurAttr} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="new-name">Название</Label>
                <Input id="new-name" name="name" required placeholder="Например, «Седина 3»" />
              </div>
              <div>
                <Label htmlFor="new-aliases">Синонимы (через запятую)</Label>
                <Input id="new-aliases" name="aliases" placeholder="SIL.3, SIL 3, Silvery 3" />
              </div>
              <div>
                <Label htmlFor="new-group">Группа</Label>
                <Input id="new-group" name="group" list="attr-groups" placeholder="Седина, Происхождение…" />
              </div>
              <div>
                <Label htmlFor="new-kind">Вид меха</Label>
                <Input id="new-kind" name="furKind" placeholder="Соболь (пусто — любой)" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="new-desc">Описание</Label>
                <Input id="new-desc" name="description" placeholder="Что означает признак" />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="autoDetect" defaultChecked className="size-4" /> Ставить автоматически по тексту описаний
              </label>
              <div className="sm:col-span-2">
                <Button type="submit">Добавить</Button>
              </div>
            </form>
            <datalist id="attr-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
          </div>
        </details>
      )}

      <FilterBar
        title="Фильтры признаков"
        oneRow
        hideChips
        className="print:hidden"
        dropOnChange={["ok", "error"]}
        controls={[
          { type: "text", name: "q", label: "Поиск", placeholder: "Название, синоним, описание" },
          { type: "multi", name: "group", label: "Группа", options: groups.map((g) => ({ value: g, label: g })), allLabel: "Все группы" },
          { type: "multi", name: "status", label: "Статус", options: [{ value: "proposed", label: "Предложено, ждёт подтверждения" }, { value: "confirmed", label: "Подтверждено" }], allLabel: "Все" },
        ]}
      />

      <div className="overflow-x-auto">
        <Table>
          <Thead>
            <Tr>
              <Th {...th("name")}>Признак</Th>
              <Th {...th("kind")}>Вид меха</Th>
              <Th {...th("aliases")}>Синонимы</Th>
              <Th {...th("lots")} className="text-right">Лотов</Th>
              <Th {...th("qty")} className="text-right" unit="шт.">Шкур</Th>
              <Th {...th("orders")} className="text-right">ТЗ (в тексте / по лотам)</Th>
              <Th>{canEdit ? "Действия" : ""}</Th>
            </Tr>
          </Thead>
          <Tbody>
            {shown.map((r) => {
              const used = r.lots + r.ordersOwn;
              return (
                <Tr key={r.id} data-attr={r.name}>
                  <Td className="align-top font-medium">
                    {r.name}{" "}
                    {!r.confirmed && <Badge variant="warning">ждёт подтверждения</Badge>}
                    {!r.autoDetect && <Badge>только предложение</Badge>}
                    <div className="mt-0.5 text-xs font-normal text-neutral-500">{r.group ?? "Без группы"}</div>
                    {r.description && <InfoHint label="Что означает признак" wide>{r.description}</InfoHint>}
                  </Td>
                  <Td className="align-top text-sm">{r.furKind ?? <span className="text-neutral-500">любой</span>}</Td>
                  <Td className="align-top text-sm">{r.aliases.join(", ") || <span className="text-neutral-500">–</span>}</Td>
                  <Td className="text-right align-top">{r.lots}</Td>
                  <Td className="text-right align-top">{formatQty(r.qty)}</Td>
                  <Td className="text-right align-top">{r.ordersOwn} / {r.ordersViaLots}</Td>
                  <Td className="align-top">
                    {canEdit && (
                      <details className="text-sm">
                        <summary className={ICON_BTN + " cursor-pointer list-none"} title="Изменить" aria-label="Изменить"><IconPencil /></summary>
                        <div className="mt-2 flex w-80 max-w-full flex-col gap-3 rounded-md border border-neutral-200 bg-white p-3">
                          {!r.confirmed && (
                            <form action={confirmFurAttr}>
                              <input type="hidden" name="id" value={r.id} />
                              <Button type="submit" size="sm" variant="secondary">Подтвердить признак</Button>
                            </form>
                          )}
                          <form action={updateFurAttr} className="flex flex-col gap-2">
                            <input type="hidden" name="id" value={r.id} />
                            <div>
                              <Label htmlFor={`n-${r.id}`}>Название</Label>
                              <Input id={`n-${r.id}`} name="name" defaultValue={r.name} required />
                            </div>
                            <div>
                              <Label htmlFor={`a-${r.id}`}>Синонимы (через запятую)</Label>
                              <Textarea id={`a-${r.id}`} name="aliases" defaultValue={r.aliases.join(", ")} rows={2} />
                            </div>
                            <div>
                              <Label htmlFor={`g-${r.id}`}>Группа</Label>
                              <Input id={`g-${r.id}`} name="group" defaultValue={r.group ?? ""} list="attr-groups" />
                            </div>
                            <div>
                              <Label htmlFor={`k-${r.id}`}>Вид меха</Label>
                              <Input id={`k-${r.id}`} name="furKind" defaultValue={r.furKind ?? ""} placeholder="пусто — любой" />
                            </div>
                            <div>
                              <Label htmlFor={`d-${r.id}`}>Описание</Label>
                              <Textarea id={`d-${r.id}`} name="description" defaultValue={r.description ?? ""} rows={3} />
                            </div>
                            <label className="flex items-center gap-2 text-xs">
                              <input type="checkbox" name="autoDetect" defaultChecked={r.autoDetect} className="size-4" /> Ставить автоматически по тексту
                            </label>
                            <Button type="submit" size="sm">Сохранить</Button>
                          </form>
                          <form action={mergeFurAttrs} className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
                            <input type="hidden" name="fromId" value={r.id} />
                            <Label htmlFor={`m-${r.id}`}>Объединить с признаком</Label>
                            <Select id={`m-${r.id}`} name="intoId" defaultValue="">
                              <option value="">— выбрать —</option>
                              {rows.filter((x) => x.id !== r.id).map((x) => (
                                <option key={x.id} value={x.id}>{x.name}</option>
                              ))}
                            </Select>
                            <p className="text-xs text-neutral-500">«{r.name}» исчезнет, его лоты и ТЗ получат выбранный признак, а название станет синонимом.</p>
                            <ConfirmSubmitButton variant="outline" label="Объединить" message={`Объединить «${r.name}» с выбранным признаком? Запись «${r.name}» будет удалена, все её лоты и ТЗ перейдут к выбранному признаку. Отменить нельзя.`} />
                          </form>
                          {used === 0 && (
                            <form action={deleteFurAttr} className="border-t border-neutral-200 pt-3">
                              <input type="hidden" name="id" value={r.id} />
                              <ConfirmSubmitButton variant="destructive" label="Удалить пустой признак" message={`Удалить признак «${r.name}»? Он нигде не используется.`} />
                            </form>
                          )}
                        </div>
                      </details>
                    )}
                  </Td>
                </Tr>
              );
            })}
            {shown.length === 0 && (
              <Tr>
                <Td colSpan={7} className="py-8 text-center text-neutral-500">
                  {rows.length > 0 ? "Ничего не найдено" : "Признаков пока нет. Добавьте вручную (или попросите разработчика завести стандартные признаки)."}
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      </div>
    </div>
  );
}
