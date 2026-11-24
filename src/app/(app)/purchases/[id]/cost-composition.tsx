import Link from "next/link";
import { Decimal } from "@prisma/client/runtime/library";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/info-hint";
import { TotalLabel } from "@/components/total-label";
import { StatementBlock } from "@/components/auction-statement";
import { buildStatement } from "@/lib/auction-statement";
import { calcAll, type CalcPayload } from "@/lib/supplier-calc";
import { formatMoney, formatQty, formatNum } from "@/lib/utils";
import { CostPlanRateForm } from "./cost-plan-editor";
import { UNIT_LABELS } from "./labels";
import type { PurchaseItemFull } from "./item-row-render";

/**
 * Карточка «Состав стоимости»: расчёт Веллмеха, из которого создана закупка, и по лотам — из чего сложилась цена единицы
 * (с блоком «Как считается»). Ничего не показывает, если показать нечего.
 */
export function CostCompositionCard({ id, purchase, calcRow, calcPayload, statusEditable, canEditRole, canEditPlan, editable, batchName }: {
  id: string;
  purchase: { items: PurchaseItemFull[]; status: string; exchangeRate: Decimal; currency: string; orderDate: Date; invoiceNumber: string | null };
  calcRow: { id: string } | null;
  calcPayload: CalcPayload | null;
  statusEditable: boolean;
  canEditRole: boolean;
  canEditPlan: boolean;
  editable: boolean;
  batchName: string | null;
}) {
  const planItems = purchase.items.filter((i) => i.costPlan != null);
  // «Как считается» — расчёт себестоимости внутри блока «Из чего сложилась цена единицы» (свёрнуто).
  const calcHow = planItems.length > 0 ? (
    <details className="rounded-md border border-neutral-200">
      <summary className="cursor-pointer px-2 py-1.5 text-sm text-neutral-700">Как считается <span className="text-xs text-neutral-500">· {planItems.length} поз. · справочно</span></summary>
      <div className="border-t border-neutral-100 p-2">
          <div className="flex flex-col gap-2">
            <InfoHint label="О расчёте себестоимости" wide>
                Себестоимость единицы в таблице позиций — предварительный расчёт из расчётного листа. При приёме на склад она
                переходит в лот, а расходы закупки (блок «Расходы») добавляются сверху пропорционально стоимости лотов. 4 % сюда не входит: оно добавляется только при списании в ТЗ.
              </InfoHint>
            
            <div className="flex items-center gap-1 text-xs text-neutral-600">
              {statusEditable ? "Править: «Править расчёт» в строке позиции" : "Расчёт закрыт для правок"}
              <InfoHint wide label="Кто и как правит расчёт">
                <p>
              {statusEditable ? (
                canEditRole ? (
                  <>Цена, количество и расходы лота правятся кнопкой «Править расчёт» в строке позиции.</>
                ) : (
                  <>Расчёт могут менять только владелец, администратор и закупщик.</>
                )
              ) : (
                <>
                  Закупка уже {purchase.status === "RECEIVED" ? "принята на склад" : "закрыта"} — расчёт менять нельзя;
                  обратитесь к администратору.
                  {batchName && canEditRole && (
                    <>
                      {" "}
                      Документы можно заменить или переименовать в режиме «Аукцион»:{" "}
                      <Link href={`/lots?auction=${encodeURIComponent(batchName)}`} className="underline">
                        открыть аукцион {batchName}
                      </Link>
                      .
                    </>
                  )}
                </>
              )}
                </p>
              </InfoHint>
            </div>
            {canEditPlan && (
              <CostPlanRateForm
                key={purchase.exchangeRate.toString()}
                purchaseId={id}
                currency={purchase.currency}
                exchangeRate={purchase.exchangeRate.toString()}
                orderDate={purchase.orderDate.toISOString().slice(0, 10)}
              />
            )}
          </div>
      </div>
    </details>
  ) : null;

  const statementEl = (() => {
        if (!calcPayload || !calcRow) return null;
        const inv = (purchase.invoiceNumber ?? "").trim();
        const st = buildStatement(calcPayload, calcAll(calcPayload), inv ? (r) => (r.invoice ?? "").trim() === inv : undefined);
        if (st.lots.length === 0) return null;
        return (
          <StatementBlock
            bare
            st={st}
            source=""
            action={<span className="flex flex-wrap items-center gap-3 text-sm"><Link href={`/supplier/auction-calcs/${calcRow.id}`} className="inline-flex min-h-11 items-center text-blue-700 underline md:min-h-0">Открыть расчёт</Link>{editable && <a href="#items" className="inline-flex min-h-11 items-center text-blue-700 underline md:min-h-0">Править расчёт лотов</a>}</span>}
          />
        );
      })();
  const perLotEl = (() => {
        // Как образовалась цена единицы: расчётный лист лота (цена, курс, сборы, выделка, перевозка, комиссия, НДС) и итог в рублях.
        type BItem = { label: string; value: number };
        const breakdownOf = (item: (typeof purchase.items)[number]): BItem[] => {
          const raw = (item.lot?.costBreakdown ?? (item.costPlan as { costBreakdown?: unknown } | null)?.costBreakdown) as { items?: BItem[] } | null | undefined;
          return Array.isArray(raw?.items) ? raw!.items! : [];
        };
        const rows = purchase.items
          .map((item) => {
            const plan = item.costPlan as { unitCostInclVat?: string } | null;
            const unit = item.lot ? item.lot.unitCost : plan?.unitCostInclVat != null ? new Decimal(plan.unitCostInclVat) : null;
            return { item, unit, qty: item.lot ? item.lot.quantityReceived : item.quantity, items: breakdownOf(item) };
          })
          .filter((r) => r.unit != null);
        if (rows.length === 0) return calcHow;
        const num = (v: number) => formatNum(v, 1);
        const totalAll = rows.reduce((a, r) => a.add(r.unit!.mul(r.qty)), new Decimal(0));
        return (
          <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">По лотам: из чего сложилась цена единицы</h3>
              <div className="hidden grid-cols-[1fr_6rem_9rem_9rem] gap-2 px-2 pb-1 text-xs text-neutral-500 sm:grid">
                <span>Лот</span><span className="text-right">Кол-во</span><span className="text-right">Цена за ед., ₽ с НДС</span><span className="text-right">Всего, ₽</span>
              </div>
              {rows.map(({ item, unit, qty, items }) => (
                <details key={item.id} id={`item-${item.id}`} className="scroll-mt-4 rounded-md border border-neutral-200">
                  <summary className="grid cursor-pointer grid-cols-2 gap-x-2 gap-y-0.5 px-2 py-1.5 text-sm sm:grid-cols-[1fr_6rem_9rem_9rem]">
                    <span className="col-span-2 sm:col-span-1">
                      <span className="font-medium">{item.rawMaterial.name}</span>{" "}
                      <span className="ml-1 text-xs text-neutral-500">{item.lotNumber ? `лот ${item.lotNumber}` : "лот без номера"}</span>
                    </span>
                    <span className="text-right tabular-nums">{formatQty(qty.toString())} {UNIT_LABELS[item.rawMaterial.unit] ?? ""}</span>
                    <span className="text-right font-medium tabular-nums">{formatMoney(unit!.toFixed(2))}</span>
                    <span className="col-span-2 text-right tabular-nums sm:col-span-1">{formatMoney(unit!.mul(qty).toFixed(2))}</span>
                  </summary>
                  <div className="border-t border-neutral-100 px-2 py-2 text-sm">
                    {items.length === 0 ? (
                      <p className="text-neutral-500">Расчётного листа по лоту нет: цена внесена как есть — {formatMoney(item.unitPrice.toFixed(2))} за ед. без НДС, НДС {item.vatRate.toString()} %.</p>
                    ) : (
                      <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-0.5 sm:max-w-xl">
                        {items.map((b, i) => (
                          <div key={i} className="contents">
                            <dt className="text-neutral-600">{b.label}</dt>
                            <dd className="text-right tabular-nums">{num(b.value)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                </details>
              ))}
              <div className="row-total mt-1 flex justify-between px-2 py-2 text-sm">
                <span><TotalLabel extra="по лотам" /></span>
                <span className="tabular-nums">{formatMoney(totalAll.toFixed(2))}</span>
              </div>
              {calcHow}
          </div>
        );
      })();
  if (!statementEl && !perLotEl) return null;
  return (
        <Card>
          <CardHeader>
            <CardTitle>Состав стоимости</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {statementEl}
            {perLotEl}
          </CardContent>
        </Card>
  );
}
