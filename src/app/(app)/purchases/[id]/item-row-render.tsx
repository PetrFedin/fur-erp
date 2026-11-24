import type { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import Link from "next/link";
import { Td } from "@/components/ui/table";
import { Money } from "@/components/money";
import { VatLabel } from "@/components/vat-label";
import { formatCurrency, formatDate, formatQty, formatDec1 } from "@/lib/utils";
import { vatPeriodLabel, vatRateForDate } from "@/lib/vat-by-date";
import { canonicalFur, ruGradeLabel } from "@/lib/fur-ref";
import type { getFurIndex } from "@/lib/fur-ref-server";
import { deriveCostPlanInputs } from "@/lib/cost-plan";
import { formatExtra, readExtra, type CustomFieldType } from "@/lib/custom-fields";
import { rowVersion, PURCHASE_ITEM_V } from "@/lib/concurrency";
import { removePurchaseItem, updatePurchaseItem, type OrderRef } from "../actions";
import { PurchaseItemRow } from "./item-row";
import { CostPlanItemEditor } from "./cost-plan-editor";
import { UNIT_LABELS } from "./labels";

/** Позиция закупки с материалом и лотом (как её загружает карточка закупки). */
export type PurchaseItemFull = Prisma.PurchaseItemGetPayload<{ include: { rawMaterial: true; lot: true } }>;

/** Всё, что строке позиции нужно от карточки закупки: права, режимы таблицы, ТЗ по лотам. */
export type ItemRowCtx = {
  id: string;
  purchase: { currency: string; exchangeRate: Decimal; orderDate: Date };
  furIdx: Awaited<ReturnType<typeof getFurIndex>>;
  canEditRole: boolean;
  editable: boolean;
  canEditPlan: boolean;
  itemsMutable: boolean;
  hasPlan: boolean;
  showGradeColor: boolean;
  isForeignCurrency: boolean;
  currencySym: string;
  itemColSpan: number;
  customFields: { id: string; name: string; type: CustomFieldType }[];
  ordersByLot: Map<string, OrderRef[]>;
};

/** Строка таблицы (row) или карточка (card) позиции закупки: правка, удаление, расчёт лота, блокировка после списания в ТЗ. */
export function renderPurchaseItemRow(ctx: ItemRowCtx, item: PurchaseItemFull, variant: "row" | "card") {
  const { id, purchase, furIdx, canEditRole, editable, canEditPlan, itemsMutable, hasPlan, showGradeColor, isForeignCurrency, currencySym, itemColSpan, customFields, ordersByLot } = ctx;
  const grossUp = (base: Decimal, vatRate: Decimal) => base.add(base.mul(vatRate).div(100));
  const boundRemoveItem = removePurchaseItem.bind(null, id);
  const boundUpdateItem = updatePurchaseItem.bind(null, id);
                  const furKind = canonicalFur(item.rawMaterial.name, furIdx)?.name ?? null;
                  const subtotalExclVatRub = item.subtotal.mul(purchase.exchangeRate);
                  const subtotalInclVatRub = grossUp(subtotalExclVatRub, item.vatRate);
                  const consumed = item.lot ? !item.lot.quantityRemaining.equals(item.lot.quantityReceived) : false;
                  // Позиция с расчётом из расчётного листа: цена/кол-во/НДС не правятся никогда.
                  const itemPlan = item.costPlan != null;
                  const canEditFinancials = canEditRole && !itemPlan && (editable || (!!item.lot && !consumed));
                  const orders = item.lot ? ordersByLot.get(item.lot.id) : undefined;
                  const planInfo = itemPlan
                    ? (() => {
                        const plan = item.costPlan as unknown as {
                          manualEditedAt?: string;
                          unitCostInclVat: string;
                          materialExclVat: string;
                          expenseExclVat: string;
                          costBreakdown: never;
                        };
                        return {
                          plan,
                          excl: new Decimal(plan.materialExclVat).add(plan.expenseExclVat),
                          total: new Decimal(plan.unitCostInclVat).mul(item.quantity),
                        };
                      })()
                    : null;
                  const lotName = item.lotNumber ? `Лот ${item.lotNumber}` : "Лот без номера";
                  const unitNode = planInfo ? (
                    <Money key="unit" incl={planInfo.plan.unitCostInclVat} excl={planInfo.excl.toString()} />
                  ) : null;
                  const totalNode = planInfo ? (
                    <Money key="total" incl={planInfo.total.toString()} excl={planInfo.excl.mul(item.quantity).toString()} />
                  ) : (
                    <Money key="total" incl={subtotalInclVatRub} excl={subtotalExclVatRub} />
                  );
                  const card = {
                    title: item.rawMaterial.name,
                    subtitle: [item.lotNumber ? `Лот ${item.lotNumber}` : "Лот без номера", [ruGradeLabel(item.grade), item.color].filter(Boolean).join(" / ")].filter(Boolean).join(" · "),
                    fields: [
                      { label: "Кол-во", value: `${formatQty(item.quantity.toString())} ${UNIT_LABELS[item.rawMaterial.unit]}` },
                      { label: hasPlan ? `Цена лота, ${currencySym}` : "Цена без НДС", value: formatCurrency(item.unitPrice.toString(), purchase.currency) },
                      { label: "НДС", value: `${item.vatRate.toString()} % · ${vatPeriodLabel(purchase.orderDate)}` },
                      ...(hasPlan ? [{ label: <VatLabel key="unit-label" base="Себестоимость ед." />, value: unitNode ?? "–" }] : []),
                      { label: <VatLabel key="total-label" base={hasPlan ? "Всего, ₽" : `Сумма${isForeignCurrency ? ", RUB" : ""}`} />, value: totalNode, strong: true },
                    ],
                    details: customFields.map((f) => ({ label: f.name, value: formatExtra(f.type, readExtra(item.extra)[f.id]) || "–" })),
                    // То же, что в ячейках десктопной строки: пометка о ручной правке, «Править расчёт».
                    extra: planInfo ? (
                      <div key="extra" className="flex flex-col items-start gap-1.5">
                        {planInfo.plan.manualEditedAt && !Number.isNaN(Date.parse(planInfo.plan.manualEditedAt)) && (
                          <div className="text-xs text-amber-700">
                            изменён вручную {formatDate(new Date(planInfo.plan.manualEditedAt))}
                          </div>
                        )}
                        {canEditPlan && (
                          <CostPlanItemEditor
                            purchaseId={id}
                            currencySymbol={currencySym}
                            item={{
                              id: item.id,
                              lotNumber: item.lotNumber,
                              ...deriveCostPlanInputs(item.costPlan, {
                                quantity: Number(item.quantity.toString()),
                                price: Number(item.unitPrice.toString()),
                                rate: Number(purchase.exchangeRate.toString()),
                                vat: Number(item.vatRate.toString()),
                              }),
                            }}
                          />
                        )}
                      </div>
                    ) : undefined,
                  };
                  return (
                    <PurchaseItemRow
                      key={item.id}
                      variant={variant}
                      card={variant === "card" ? card : undefined}
                      colSpan={itemColSpan}
                      removeAction={
                        editable
                          ? async () => {
                              "use server";
                              await boundRemoveItem(item.id);
                            }
                          : undefined
                      }
                      updateAction={itemsMutable ? boundUpdateItem.bind(null, item.id) : undefined}
                      canEditFinancials={canEditFinancials}
                      lockedNote={
                        itemPlan
                          ? "Цена и количество взяты из расчётного листа — меняйте их кнопкой «Править расчёт» в строке позиции. Здесь доступны только лот, сорт и цвет."
                          : item.lot && consumed
                          ? orders && orders.length > 0
                            ? `${lotName} уже списан в ТЗ (${orders
                                .map((o) => `${o.number}: ${formatQty(o.quantity)} ${UNIT_LABELS[item.rawMaterial.unit]}`)
                                .join(", ")}). Сначала удалите там списание. Доступны только лот, сорт и цвет:`
                            : `${lotName} уже частично израсходован (${formatDec1(item.lot.quantityReceived.sub(item.lot.quantityRemaining).toString())} ${UNIT_LABELS[item.rawMaterial.unit]}) — доступны только лот, сорт и цвет`
                          : undefined
                      }
                      lockedOrders={orders}
                      canEditMaterial={editable}
                      defaults={{
                        rawMaterialId: item.rawMaterialId,
                        rawMaterialName: item.rawMaterial.name,
                        quantity: item.quantity.toString(),
                        unitPrice: item.unitPrice.toString(),
                        vatRate: item.vatRate.toString(),
                        lotNumber: item.lotNumber ?? "",
                        grade: item.grade ?? "",
                        color: item.color ?? "",
                        colorRefId: item.colorRefId ?? "",
                        lotId: item.lotId ?? undefined,
                        version: rowVersion(item, PURCHASE_ITEM_V),
                      }}
                    >
                      <Td>{furKind ? <Link href={`/lots/fur/${encodeURIComponent(furKind)}`} className="text-blue-700 hover:underline" title="Вид меха: все лоты и аукционы">{item.rawMaterial.name}</Link> : item.rawMaterial.name}</Td>
                      <Td>{item.lotId && item.lotNumber ? <Link href={`/analytics/raw/lot/${item.lotId}`} className="text-blue-700 hover:underline" title="Карточка лота: куплено, использовано, остаток, ТЗ">{item.lotNumber}</Link> : (item.lotNumber ?? "–")}</Td>
                      {showGradeColor && <Td>{[ruGradeLabel(item.grade), item.color].filter(Boolean).join(" / ") || "–"}</Td>}
                      <Td>
                        {formatQty(item.quantity.toString())} {UNIT_LABELS[item.rawMaterial.unit]}
                      </Td>
                      <Td>{formatCurrency(item.unitPrice.toString(), purchase.currency)}</Td>
                      <Td>
                        {item.vatRate.toString()} %
                        <span className={`block text-[11px] ${Number(item.vatRate) === vatRateForDate(purchase.orderDate) ? "text-neutral-600" : "text-amber-700"}`} title={Number(item.vatRate) === vatRateForDate(purchase.orderDate) ? undefined : `По дате закупки ${formatDate(purchase.orderDate)} должна быть ${vatRateForDate(purchase.orderDate)} %`}>{vatPeriodLabel(purchase.orderDate)}</span>
                      </Td>
                      {planInfo ? (
                        <>
                          <Td className="whitespace-nowrap">
                            <Money incl={planInfo.plan.unitCostInclVat} excl={planInfo.excl.toString()} />
                            {planInfo.plan.manualEditedAt && !Number.isNaN(Date.parse(planInfo.plan.manualEditedAt)) && (
                              <div className="text-xs font-normal text-amber-700">
                                изменён вручную {formatDate(new Date(planInfo.plan.manualEditedAt))}
                              </div>
                            )}
                          </Td>
                          <Td className="whitespace-nowrap">
                            <Money incl={planInfo.total.toString()} excl={planInfo.excl.mul(item.quantity).toString()} />
                            {canEditPlan && (
                              <div className="mt-1">
                                <CostPlanItemEditor
                                  purchaseId={id}
                                  currencySymbol={currencySym}
                                  item={{
                                    id: item.id,
                                    lotNumber: item.lotNumber,
                                    ...deriveCostPlanInputs(item.costPlan, {
                                      quantity: Number(item.quantity.toString()),
                                      price: Number(item.unitPrice.toString()),
                                      rate: Number(purchase.exchangeRate.toString()),
                                      vat: Number(item.vatRate.toString()),
                                    }),
                                  }}
                                />
                              </div>
                            )}
                          </Td>
                        </>
                      ) : hasPlan ? (
                        <>
                          <Td className="text-neutral-500">–</Td>
                          <Td className="whitespace-nowrap">
                            <Money incl={subtotalInclVatRub} excl={subtotalExclVatRub} />
                          </Td>
                        </>
                      ) : (
                        <Td>
                          <Money incl={subtotalInclVatRub} excl={subtotalExclVatRub} />
                          {isForeignCurrency && (
                            <span className="ml-1 text-xs text-neutral-500">
                              ({formatCurrency(item.subtotal.toString(), purchase.currency)} без НДС)
                            </span>
                          )}
                        </Td>
                      )}
                      {customFields.map((f) => (
                        <Td key={f.id}>{formatExtra(f.type, readExtra(item.extra)[f.id]) || "–"}</Td>
                      ))}
                    </PurchaseItemRow>
                  );
}
