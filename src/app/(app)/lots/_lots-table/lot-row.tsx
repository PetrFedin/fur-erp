"use client";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Tr, Td } from "@/components/ui/table";
import { Money } from "@/components/money";
import { RowCard } from "@/components/responsive-rows";
import { formatCurrency, formatQtyTrim } from "@/lib/utils";
import { useCommission4Display } from "@/lib/commission4-display";
import { COMMISSION_RATE, COMMISSION4_HINT } from "@/lib/commission4-const";
import { type CustomFieldDef } from "@/lib/custom-fields";
import { type LotRow } from "@/lib/lot-table";
import { CostBreakdownToggle } from "../cost-breakdown-toggle";
import { CostPlanItemEditor } from "../../purchases/[id]/cost-plan-editor";
import type { CostPlanEditorItem } from "../../purchases/[id]/cost-plan-editor";
import { CustomCell } from "../custom-field-controls";
import { InfoHint } from "@/components/info-hint";
import { useLots } from "../lots-state";
import { rateFmt, symbol } from "./shared";

export function LotRowView({
  row: r,
  fields,
  hasEditCol,
  currency,
  invoice,
}: {
  row: LotRow;
  fields: CustomFieldDef[];
  hasEditCol: boolean;
  currency: string;
  /** Плоский список: колонка «Счёт» со ссылкой на закупку */
  invoice?: { label: string; number: string };
}) {
  const { selected, setSelected } = useLots();
  const checked = selected.has(r.id);
  return (
    <Tr className={checked ? "bg-[var(--ui-soft)]" : undefined} data-lot-row={r.id}>
      <Td className="w-10 sm:w-8">
        <label className="flex h-8 w-8 cursor-pointer items-center justify-center sm:h-auto sm:w-auto">
          <input type="checkbox" className="h-5 w-5 sm:h-4 sm:w-4" aria-label={`Выбрать лот ${r.lotNumber || r.material}`} checked={checked} onChange={() => setSelected([r.id], !checked)} />
        </label>
      </Td>
      <Td className="font-medium">{r.material}</Td>
      {invoice && (
        <Td className="whitespace-nowrap">
          <Link href={`/purchases/${r.purchaseId}`} className="text-blue-600 hover:underline" title={`Закупка ${invoice.number}`}>
            {invoice.label}
          </Link>
        </Td>
      )}
      <Td className="whitespace-nowrap">
        {r.lotNumber ? (
          <Link href={`/analytics/raw/lot/${r.lotId ?? r.id}`} className="text-blue-700 hover:underline" title="Карточка лота: из чего сложилась цена">{r.lotNumber}</Link>
        ) : "–"}
      </Td>
      <Td className="min-w-48">
        {r.size || "–"}
        {(r.attrs?.length ?? 0) > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1" data-lot-attrs>
            {r.attrs!.map((a) => <span key={a} title="Признак меха" className="rounded-full bg-amber-50 px-1.5 text-[11px] leading-4 text-amber-800 ring-1 ring-amber-200">{a}</span>)}
          </div>
        )}
      </Td>
      <Td className="min-w-32 text-xs text-neutral-600">{r.op || "–"}</Td>
      <Td className="whitespace-nowrap">
        {formatQtyTrim(r.qty)} {r.unit}
      </Td>
      <Td className="whitespace-nowrap">{formatCurrency(r.price, currency)}</Td>
      <Td className="whitespace-nowrap">{rateFmt(r.rate)}</Td>
      <Td className="whitespace-nowrap">
        <span className="inline-flex items-center gap-1">
          <Money incl={r.unitIncl} excl={r.unitExcl} />
          <Unit4Note incl={r.unitIncl} excl={r.unitExcl} source={r.source === "price"} />
        </span>
        {r.breakdown ? <CostBreakdownToggle breakdown={r.breakdown as never} unitCostExcl={String(r.unitExcl)} unitCostIncl={String(r.unitIncl)} qty={r.qty} unit={r.unit} /> : null}
      </Td>
      <Td className="whitespace-nowrap font-medium">
        <Money incl={r.totalIncl} excl={r.totalExcl} />
      </Td>
      <Td className="whitespace-nowrap">
        {r.onStock ? (
          r.remaining === 0 ? (
            <Badge>Израсходован</Badge>
          ) : (
            <>
              {formatQtyTrim(r.remaining)} {r.unit}
            </>
          )
        ) : (
          <span className="text-xs text-neutral-500">ещё не на складе</span>
        )}
      </Td>
      <Td>
        {r.usages.length === 0
          ? "–"
          : r.usages.map((u) => (
              <div key={u.id} className="whitespace-nowrap">
                <Link href={`/production/${u.orderId}`} className="hover:underline">
                  {u.label}
                </Link>
                {" — "}
                {formatQtyTrim(u.qty)} {r.unit}
              </div>
            ))}
      </Td>
      {fields.map((f) => (
        <Td key={f.id}>
          <CustomCell row={r} field={f} />
        </Td>
      ))}
      {hasEditCol && (
        <Td className="whitespace-nowrap">
          {r.editor ? <CostPlanItemEditor purchaseId={r.purchaseId} currencySymbol={symbol(currency)} item={r.editor as CostPlanEditorItem} /> : null}
        </Td>
      )}
      <Td />
    </Tr>
  );
}

/** Карточка лота для телефона (< md): ключевые поля сверху, остальное — в «Подробнее». Выбор лота тот же, что в таблице. */
export function LotCardView({
  row: r,
  fields,
  hasEditCol,
  currency,
  invoice,
}: {
  row: LotRow;
  fields: CustomFieldDef[];
  hasEditCol: boolean;
  currency: string;
  invoice?: { label: string; number: string };
}) {
  const { selected, setSelected } = useLots();
  const checked = selected.has(r.id);
  return (
    <RowCard
      className={checked ? "border-[var(--ui-accent)] bg-[var(--ui-soft)]" : undefined}
      title={
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-label={`Выбрать лот ${r.lotNumber || r.material}`}
            checked={checked}
            onChange={() => setSelected([r.id], !checked)}
          />
          <span>
            {r.material}
            {r.lotNumber ? ` · лот ${r.lotNumber}` : ""}
          </span>
        </label>
      }
      subtitle={
        invoice ? (
          <Link href={`/purchases/${r.purchaseId}`} className="inline-block py-2 text-blue-600 hover:underline">
            {invoice.label}
          </Link>
        ) : undefined
      }
      fields={[
        { label: "Кол-во", value: `${formatQtyTrim(r.qty)} ${r.unit}` },
        { label: "Себестоимость всего", value: <Money incl={r.totalIncl} excl={r.totalExcl} />, strong: true },
        { label: "Себестоимость ед.", value: <Money incl={r.unitIncl} excl={r.unitExcl} /> },
        // Лот ещё не принят на склад: «Остатка на складе» нет вовсе, вместо повтора в каждой карточке — бейдж «не принят».
        ...(r.onStock
          ? [{ label: "Остаток на складе", value: r.remaining === 0 ? <Badge>Израсходован</Badge> : `${formatQtyTrim(r.remaining)} ${r.unit}` }]
          : []),
      ]}
      details={[
        { label: "Сорт / размер", value: r.size },
        { label: "Операция", value: r.op },
        ...((r.attrs?.length ?? 0) > 0 ? [{ label: "Признаки меха", value: r.attrs!.join(", ") }] : []),
        { label: `Цена за шк., ${symbol(currency)}`, value: formatCurrency(r.price, currency) },
        { label: "Курс", value: rateFmt(r.rate) },
        {
          label: "Использован в ТЗ",
          value:
            r.usages.length === 0 ? null : (
              <>
                {r.usages.map((u) => (
                  <div key={u.id}>
                    <Link href={`/production/${u.orderId}`} className="underline">
                      {u.label}
                    </Link>
                    {" — "}
                    {formatQtyTrim(u.qty)} {r.unit}
                  </div>
                ))}
              </>
            ),
        },
        ...fields.map((f) => ({ label: f.name, value: <CustomCell row={r} field={f} card /> })),
        {
          label: "Расчёт",
          value: r.breakdown ? <CostBreakdownToggle breakdown={r.breakdown as never} unitCostExcl={String(r.unitExcl)} unitCostIncl={String(r.unitIncl)} qty={r.qty} unit={r.unit} /> : null,
        },
      ]}
      extra={
        hasEditCol && r.editor ? (
          <CostPlanItemEditor purchaseId={r.purchaseId} currencySymbol={symbol(currency)} item={r.editor as CostPlanEditorItem} />
        ) : undefined
      }
    />
  );
}

/**
 * Справочно, только в режиме «С 4%»: себестоимость единицы лота +4% («с 4%: X»).
 * Закупки, суммы лотов и долги остаются без 4% — 4% начисляется при списании в ТЗ.
 */
function Unit4Note({ incl, excl, source }: { incl: number; excl: number; source?: boolean }) {
  const { mode } = useCommission4Display();
  const k = 1 + COMMISSION_RATE;
  if (mode !== "on" && !source) return null;
  return (
    <InfoHint label="Пояснение к цене лота" align="right">
      {mode === "on" ? <p>С 4 %: <Money incl={incl * k} excl={excl * k} />. {COMMISSION4_HINT}</p> : null}
      {source ? <p className={mode === "on" ? "mt-1" : undefined}>Цена по цене лота, без расчёта.</p> : null}
    </InfoHint>
  );
}
