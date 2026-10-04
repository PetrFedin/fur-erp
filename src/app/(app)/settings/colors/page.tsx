import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { isProposed, PROPOSED_MARK, suggestColorRef } from "@/lib/color-ref";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { bindColorText, confirmColor, createColor, deleteColor, mergeColors, updateColor } from "./actions";

export const metadata = { title: "Справочник цветов" };

const MAX_LINKS = 6;

type Usage = { orders: Array<{ id: string; number: string }>; purchases: Map<string, string>; lots: number; items: number };

export default async function ColorsPage({ searchParams }: PageProps<"/settings/colors">) {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const canEdit = hasRole(session.user.role, ACCESS.colors);
  const sp = await searchParams;
  const flashError = typeof sp.error === "string" ? sp.error.slice(0, 300) : "";
  const flashOk = typeof sp.ok === "string" ? sp.ok.slice(0, 300) : "";

  const [refs, orders, items, lots] = await Promise.all([
    prisma.colorRef.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      include: { _count: { select: { orders: true, lots: true, purchaseItems: true } } },
    }),
    prisma.productionOrder.findMany({ where: { organizationId: orgId, colorRefId: null, color: { not: null } }, select: { id: true, number: true, color: true } }),
    prisma.purchaseItem.findMany({ where: { purchase: { organizationId: orgId }, colorRefId: null, color: { not: null } }, select: { color: true, purchase: { select: { id: true, number: true } } } }),
    prisma.rawMaterialLot.findMany({ where: { organizationId: orgId, colorRefId: null, color: { not: null } }, select: { color: true, purchase: { select: { id: true, number: true } } } }),
  ]);

  const unmatched = new Map<string, Usage>();
  const slot = (c: string | null) => {
    const k = (c ?? "").trim();
    if (!k) return null;
    let u = unmatched.get(k);
    if (!u) unmatched.set(k, (u = { orders: [], purchases: new Map(), lots: 0, items: 0 }));
    return u;
  };
  for (const o of orders) slot(o.color)?.orders.push({ id: o.id, number: o.number });
  for (const i of items) {
    const u = slot(i.color);
    if (u) {
      u.items++;
      u.purchases.set(i.purchase.id, i.purchase.number);
    }
  }
  for (const l of lots) {
    const u = slot(l.color);
    if (u) {
      u.lots++;
      if (l.purchase) u.purchases.set(l.purchase.id, l.purchase.number);
    }
  }
  const queue = [...unmatched.entries()].sort((a, b) => b[1].orders.length + b[1].items + b[1].lots - (a[1].orders.length + a[1].items + a[1].lots));
  const lite = refs.map((r) => ({ id: r.id, name: r.name, aliases: r.aliases, note: r.note }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1 text-sm"><Link href="/settings" className="text-neutral-500 hover:underline">← Настройки</Link></div>
        <h1 className="text-xl font-semibold">Справочник цветов</h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-600">
          Один цвет — одно название на русском. В ТЗ, закупках и лотах цвет выбирается отсюда; переименование здесь сразу меняет название везде.
          В «Синонимах» — как этот цвет пишут в реестре и документах (латиница, опечатки).
        </p>
      </div>
      {flashError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{flashError}</p>}
      {flashOk && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{flashOk}</p>}

      {queue.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Не сопоставлено ({queue.length})</CardTitle>
            <CardDescription>
              Эти написания цвета ещё не привязаны к справочнику, их текст не менялся. Проверьте предложение и нажмите «Привязать» — все такие строки получат
              название цвета из справочника. Привязка к цвету с пометкой «ждёт подтверждения» подтверждает его.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <Thead>
                <Tr>
                  <Th>Значение</Th>
                  <Th>Где используется</Th>
                  <Th>Предложение</Th>
                  <Th>{canEdit ? "Действие" : ""}</Th>
                </Tr>
              </Thead>
              <Tbody>
                {queue.map(([text, u]) => {
                  const sug = suggestColorRef(text, lite);
                  const purchases = [...u.purchases.entries()];
                  return (
                    <Tr key={text}>
                      <Td className="font-medium">{text}</Td>
                      <Td className="text-xs">
                        <div className="flex flex-wrap gap-x-2 gap-y-1">
                          {u.orders.length > 0 && <span className="text-neutral-500">ТЗ {u.orders.length}:</span>}
                          {u.orders.slice(0, MAX_LINKS).map((o) => (
                            <Link key={o.id} href={`/production/${o.id}`} className="text-blue-600 hover:underline">
                              {o.number}
                            </Link>
                          ))}
                          {u.orders.length > MAX_LINKS && <span className="text-neutral-400">…ещё {u.orders.length - MAX_LINKS}</span>}
                        </div>
                        {(u.items > 0 || u.lots > 0) && (
                          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                            <span className="text-neutral-500">
                              закупок {u.items}, лотов {u.lots}:
                            </span>
                            {purchases.slice(0, MAX_LINKS).map(([id, num]) => (
                              <Link key={id} href={`/purchases/${id}`} className="text-blue-600 hover:underline">
                                {num}
                              </Link>
                            ))}
                            {purchases.length > MAX_LINKS && <span className="text-neutral-400">…ещё {purchases.length - MAX_LINKS}</span>}
                          </div>
                        )}
                      </Td>
                      <Td className="text-sm">
                        {sug ? (
                          <>
                            {sug.ref.name} {isProposed(sug.ref.note) && <Badge variant="warning">ждёт подтверждения</Badge>}
                            <div className="text-xs text-neutral-500">{sug.reason}</div>
                          </>
                        ) : (
                          <span className="text-neutral-400">нет похожего цвета</span>
                        )}
                      </Td>
                      <Td>
                        {canEdit && (
                          <div className="flex flex-col gap-1">
                            <form action={bindColorText} className="flex items-center gap-1">
                              <input type="hidden" name="text" value={text} />
                              <Select name="refId" defaultValue={sug?.ref.id ?? ""} className="h-8 w-44 text-xs" aria-label="Цвет справочника">
                                <option value="">— выбрать цвет —</option>
                                {refs.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.name}
                                  </option>
                                ))}
                              </Select>
                              <Button type="submit" size="sm">
                                Привязать
                              </Button>
                            </form>
                            {!/[×;]|(?:^|\s)x\d/.test(text) && (
                              <form action={bindColorText}>
                                <input type="hidden" name="text" value={text} />
                                <input type="hidden" name="createNew" value="1" />
                                <Button type="submit" variant="ghost" size="sm" className="h-6 px-1 text-xs">
                                  Создать новый цвет из значения
                                </Button>
                              </form>
                            )}
                          </div>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </CardContent>
        </Card>
      )}

      {canEdit && (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>Добавить цвет</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createColor} className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1">
                <Label htmlFor="new-name">Название (по-русски)</Label>
                <Input id="new-name" name="name" required placeholder="Например, «Графит»" />
              </div>
              <div className="min-w-48 flex-1">
                <Label htmlFor="new-aliases">Синонимы (через запятую)</Label>
                <Input id="new-aliases" name="aliases" placeholder="GRAPHITE, графитовый" />
              </div>
              <Button type="submit">Добавить</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Table>
        <Thead>
          <Tr>
            <Th>Цвет</Th>
            <Th>Синонимы</Th>
            <Th className="text-right">ТЗ</Th>
            <Th className="text-right">Лотов</Th>
            <Th className="text-right">Закупок (поз.)</Th>
            <Th>{canEdit ? "Действия" : ""}</Th>
          </Tr>
        </Thead>
        <Tbody>
          {refs.map((r) => {
            const used = r._count.orders + r._count.lots + r._count.purchaseItems;
            const proposed = isProposed(r.note);
            const note = (r.note ?? "").replace(new RegExp(`^${PROPOSED_MARK}\\.?\\s*`), "");
            return (
              <Tr key={r.id}>
                <Td className="align-top font-medium">
                  {r.name} {proposed && <Badge variant="warning">ждёт подтверждения</Badge>}
                  {note && <div className="mt-0.5 max-w-md text-xs font-normal text-neutral-500">{note}</div>}
                </Td>
                <Td className="align-top text-sm">{r.aliases.join(", ") || <span className="text-neutral-400">—</span>}</Td>
                <Td className="text-right align-top">{r._count.orders}</Td>
                <Td className="text-right align-top">{r._count.lots}</Td>
                <Td className="text-right align-top">{r._count.purchaseItems}</Td>
                <Td className="align-top">
                  {canEdit && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-blue-600">Изменить</summary>
                      <div className="mt-2 flex w-80 max-w-full flex-col gap-3 rounded-md border border-neutral-200 bg-white p-3">
                        {proposed && (
                          <form action={confirmColor}>
                            <input type="hidden" name="id" value={r.id} />
                            <Button type="submit" size="sm" variant="secondary">
                              Подтвердить название и синонимы
                            </Button>
                          </form>
                        )}
                        <form action={updateColor} className="flex flex-col gap-2">
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
                            <Label htmlFor={`t-${r.id}`}>Примечание</Label>
                            <Textarea id={`t-${r.id}`} name="note" defaultValue={r.note ?? ""} rows={2} />
                          </div>
                          <p className="text-xs text-neutral-500">Новое название сразу заменит старое в {used} строках (ТЗ, закупки, лоты).</p>
                          <Button type="submit" size="sm">
                            Сохранить
                          </Button>
                        </form>
                        <form action={mergeColors} className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
                          <input type="hidden" name="fromId" value={r.id} />
                          <Label htmlFor={`m-${r.id}`}>Объединить с цветом</Label>
                          <Select id={`m-${r.id}`} name="intoId" defaultValue="">
                            <option value="">— выбрать —</option>
                            {refs
                              .filter((x) => x.id !== r.id)
                              .map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name}
                                </option>
                              ))}
                          </Select>
                          <p className="text-xs text-neutral-500">«{r.name}» исчезнет, все его строки получат выбранный цвет, а название станет синонимом.</p>
                          <Button type="submit" size="sm" variant="outline">
                            Объединить
                          </Button>
                        </form>
                        {used === 0 && (
                          <form action={deleteColor} className="border-t border-neutral-200 pt-3">
                            <input type="hidden" name="id" value={r.id} />
                            <Button type="submit" size="sm" variant="destructive">
                              Удалить пустой цвет
                            </Button>
                          </form>
                        )}
                      </div>
                    </details>
                  )}
                </Td>
              </Tr>
            );
          })}
          {refs.length === 0 && (
            <Tr>
              <Td colSpan={6} className="py-8 text-center text-neutral-400">
                Цветов пока нет
              </Td>
            </Tr>
          )}
        </Tbody>
      </Table>
    </div>
  );
}
