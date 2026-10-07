import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { categoryKey, oneLine, suggestCategoryRef } from "@/lib/category-ref";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { FilterBar } from "@/components/filters/filter-bar";
import { defineFilters, parseFilters, pick } from "@/lib/filters";
import { ConfirmSubmitButton } from "../../purchases/[id]/documents-form";
import { bindCategoryModels, confirmCategory, createCategory, deleteCategory, mergeCategories, updateCategory } from "./actions";

export const metadata = { title: "Справочник категорий" };

const MAX_LINKS = 8;

const CATEGORY_FILTERS = defineFilters({ ...pick(["q", "status"], { q: { label: "Поиск" }, status: { allowed: ["proposed", "confirmed"] } }) });

export default async function CategoriesPage({ searchParams }: PageProps<"/settings/categories">) {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const canEdit = hasRole(session.user.role, ACCESS.categories);
  const sp = await searchParams;
  const flashError = typeof sp.error === "string" ? sp.error.slice(0, 300) : "";
  const flashOk = typeof sp.ok === "string" ? sp.ok.slice(0, 300) : "";
  const cf = parseFilters(CATEGORY_FILTERS, sp);

  const [refs, models] = await Promise.all([
    prisma.categoryRef.findMany({ where: { organizationId: orgId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.productModel.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, category: true, categoryRefId: true, productionOrders: { select: { materialDescription: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  const stat = new Map<string, { models: number; orders: number }>();
  for (const m of models) {
    if (!m.categoryRefId) continue;
    const s = stat.get(m.categoryRefId) ?? { models: 0, orders: 0 };
    s.models++;
    s.orders += m.productionOrders.length;
    stat.set(m.categoryRefId, s);
  }

  // «Не сопоставлено»: одинаковый текст — одна строка; модели без текста — по одной (предложение по названию модели и описанию в ТЗ).
  type Row = { key: string; text: string; ids: string[]; names: Array<{ id: string; name: string }>; orders: number; suggestSource: string; sug: ReturnType<typeof suggestCategoryRef<(typeof refs)[number]>> };
  const rowsMap = new Map<string, Row>();
  for (const m of models) {
    if (m.categoryRefId) continue;
    const text = oneLine(m.category);
    const key = text ? `t:${categoryKey(text)}` : `m:${m.id}`;
    let row = rowsMap.get(key);
    if (!row) {
      let sug = suggestCategoryRef(text, refs);
      let source = text ? "по тексту категории" : "";
      if (!sug) {
        sug = suggestCategoryRef(m.name, refs);
        if (sug) source = "по названию модели";
      }
      if (!sug) {
        for (const o of m.productionOrders) {
          sug = suggestCategoryRef(o.materialDescription, refs);
          if (sug) {
            source = "по описанию материала в ТЗ";
            break;
          }
        }
      }
      row = { key, text, ids: [], names: [], orders: 0, suggestSource: source, sug };
      rowsMap.set(key, row);
    }
    row.ids.push(m.id);
    row.names.push({ id: m.id, name: m.name });
    row.orders += m.productionOrders.length;
  }
  const queue = [...rowsMap.values()].sort((a, b) => b.ids.length - a.ids.length || a.text.localeCompare(b.text, "ru"));

  const needle = cf.q.trim().toLowerCase();
  const shown = refs.filter(
    (r) =>
      (cf.status.length === 0 || cf.status.includes(r.confirmed ? "confirmed" : "proposed")) &&
      (!needle || [r.name, ...r.aliases, r.note ?? ""].some((x) => x.toLowerCase().includes(needle))),
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1 text-sm"><Link href="/settings" className="text-neutral-500 hover:underline">← Настройки</Link></div>
        <h1 className="text-xl font-semibold">Справочник категорий</h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-600">
          Одна категория изделия — одно название на русском («Пальто», «Полупальто», «Жакет»…). В моделях и артикулах категория выбирается отсюда;
          аналитика («Что произведено», цены) группирует по этому названию. В «Синонимах» — как категорию записывали раньше («Пальто женское из соболя»).
        </p>
      </div>
      {flashError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{flashError}</p>}
      {flashOk && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{flashOk}</p>}

      {queue.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Не сопоставлено ({queue.reduce((s, r) => s + r.ids.length, 0)} моделей)</CardTitle>
            <CardDescription>
              У этих моделей категория пустая или записана так, что однозначно определить её нельзя. Текст не менялся. Проверьте предложение и нажмите «Привязать» —
              модели получат категорию из справочника, прежний текст станет синонимом. Привязка к категории с пометкой «ждёт подтверждения» подтверждает её.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <Thead>
                <Tr>
                  <Th>Значение</Th>
                  <Th>Модели</Th>
                  <Th>Предложение</Th>
                  <Th>{canEdit ? "Действие" : ""}</Th>
                </Tr>
              </Thead>
              <Tbody>
                {queue.map((r) => (
                  <Tr key={r.key}>
                    <Td className="font-medium">{r.text || <span className="font-normal text-neutral-400">(категория не указана)</span>}</Td>
                    <Td className="text-xs">
                      <div className="flex flex-wrap gap-x-2 gap-y-1">
                        <span className="text-neutral-500">{r.ids.length} мод., ТЗ {r.orders}:</span>
                        {r.names.slice(0, MAX_LINKS).map((m) => (
                          <Link key={m.id} href={`/models/${m.id}`} className="text-blue-600 hover:underline">{m.name}</Link>
                        ))}
                        {r.names.length > MAX_LINKS && <span className="text-neutral-400">…ещё {r.names.length - MAX_LINKS}</span>}
                      </div>
                    </Td>
                    <Td className="text-sm">
                      {r.sug ? (
                        <>
                          {r.sug.ref.name} {r.sug.disputed && <Badge variant="warning">спорно</Badge>} {!r.sug.ref.confirmed && <Badge variant="warning">ждёт подтверждения</Badge>}
                          <div className="text-xs text-neutral-500">{r.sug.reason}{r.suggestSource ? ` (${r.suggestSource})` : ""}</div>
                        </>
                      ) : (
                        <span className="text-neutral-400">нет подсказки — выберите вручную</span>
                      )}
                    </Td>
                    <Td>
                      {canEdit && (
                        <div className="flex flex-col gap-1">
                          <form action={bindCategoryModels} className="flex items-center gap-1">
                            <input type="hidden" name="ids" value={r.ids.join(",")} />
                            <Select name="refId" defaultValue={r.sug?.ref.id ?? ""} className="h-8 w-44 text-xs" aria-label="Категория справочника">
                              <option value="">— выбрать категорию —</option>
                              {refs.map((x) => (
                                <option key={x.id} value={x.id}>{x.name}</option>
                              ))}
                            </Select>
                            <Button type="submit" size="sm">Привязать</Button>
                          </form>
                          {r.text && (
                            <form action={bindCategoryModels}>
                              <input type="hidden" name="ids" value={r.ids.join(",")} />
                              <input type="hidden" name="createNew" value="1" />
                              <input type="hidden" name="text" value={r.text} />
                              <Button type="submit" variant="ghost" size="sm" className="h-6 px-1 text-xs">Создать новую категорию из значения</Button>
                            </form>
                          )}
                        </div>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </CardContent>
        </Card>
      )}

      {canEdit && (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>Добавить категорию</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createCategory} className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1">
                <Label htmlFor="new-name">Название (по-русски)</Label>
                <Input id="new-name" name="name" required placeholder="Например, «Манишка»" />
              </div>
              <div className="min-w-48 flex-1">
                <Label htmlFor="new-aliases">Синонимы (через запятую)</Label>
                <Input id="new-aliases" name="aliases" placeholder="манишки, воротник" />
              </div>
              <Button type="submit">Добавить</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <FilterBar
        title="Фильтры категорий"
        dropOnChange={["ok", "error"]}
        controls={[
          { type: "text", name: "q", label: "Поиск", placeholder: "Название, синоним, примечание" },
          { type: "multi", name: "status", label: "Статус", options: [{ value: "proposed", label: "Предложено, ждёт подтверждения" }, { value: "confirmed", label: "Подтверждено" }], allLabel: "Все" },
        ]}
      />

      <Table>
        <Thead>
          <Tr>
            <Th>Категория</Th>
            <Th>Синонимы</Th>
            <Th className="text-right">Моделей</Th>
            <Th className="text-right">ТЗ</Th>
            <Th>{canEdit ? "Действия" : ""}</Th>
          </Tr>
        </Thead>
        <Tbody>
          {shown.map((r) => {
            const s = stat.get(r.id) ?? { models: 0, orders: 0 };
            const note = (r.note ?? "").replace(/^Предложено, ждёт подтверждения\.?\s*/, "");
            return (
              <Tr key={r.id}>
                <Td className="align-top font-medium">
                  {r.name} {!r.confirmed && <Badge variant="warning">ждёт подтверждения</Badge>}
                  {note && <div className="mt-0.5 max-w-md text-xs font-normal text-neutral-500">{note}</div>}
                </Td>
                <Td className="max-w-md align-top text-sm">{r.aliases.join("; ") || <span className="text-neutral-400">—</span>}</Td>
                <Td className="text-right align-top">{s.models}</Td>
                <Td className="text-right align-top">{s.orders}</Td>
                <Td className="align-top">
                  {canEdit && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-blue-600">Изменить</summary>
                      <div className="mt-2 flex w-80 max-w-full flex-col gap-3 rounded-md border border-neutral-200 bg-white p-3">
                        {!r.confirmed && (
                          <form action={confirmCategory}>
                            <input type="hidden" name="id" value={r.id} />
                            <Button type="submit" size="sm" variant="secondary">Подтвердить название и синонимы</Button>
                          </form>
                        )}
                        <form action={updateCategory} className="flex flex-col gap-2">
                          <input type="hidden" name="id" value={r.id} />
                          <div>
                            <Label htmlFor={`n-${r.id}`}>Название</Label>
                            <Input id={`n-${r.id}`} name="name" defaultValue={r.name} required />
                          </div>
                          <div>
                            <Label htmlFor={`a-${r.id}`}>Синонимы (через запятую или с новой строки)</Label>
                            <Textarea id={`a-${r.id}`} name="aliases" defaultValue={r.aliases.join("\n")} rows={3} />
                          </div>
                          <div>
                            <Label htmlFor={`t-${r.id}`}>Примечание</Label>
                            <Textarea id={`t-${r.id}`} name="note" defaultValue={r.note ?? ""} rows={2} />
                          </div>
                          <p className="text-xs text-neutral-500">Новое название сразу заменит старое у {s.models} моделей.</p>
                          <Button type="submit" size="sm">Сохранить</Button>
                        </form>
                        <form action={mergeCategories} className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
                          <input type="hidden" name="fromId" value={r.id} />
                          <Label htmlFor={`m-${r.id}`}>Объединить с категорией</Label>
                          <Select id={`m-${r.id}`} name="intoId" defaultValue="">
                            <option value="">— выбрать —</option>
                            {refs.filter((x) => x.id !== r.id).map((x) => (
                              <option key={x.id} value={x.id}>{x.name}</option>
                            ))}
                          </Select>
                          <p className="text-xs text-neutral-500">«{r.name}» исчезнет, её модели получат выбранную категорию, а название станет синонимом.</p>
                          <ConfirmSubmitButton variant="outline" label="Объединить" message={`Объединить «${r.name}» с выбранной категорией? Запись «${r.name}» будет удалена, её модели перейдут к выбранной категории. Отменить нельзя.`} />
                        </form>
                        {s.models === 0 && (
                          <form action={deleteCategory} className="border-t border-neutral-200 pt-3">
                            <input type="hidden" name="id" value={r.id} />
                            <ConfirmSubmitButton variant="destructive" label="Удалить пустую категорию" message={`Удалить категорию «${r.name}»? Она нигде не используется.`} />
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
              <Td colSpan={5} className="py-8 text-center text-neutral-400">
                {refs.length > 0 ? "Ничего не найдено" : "Категорий пока нет"}
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
