"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { type BatchHeader, type BatchPreview, type BatchResult, type IntakeRow } from "@/lib/batch-intake";
import { formatMoney } from "@/lib/utils";
import { CompositionTable } from "../expenses-block";
import { compositionOf } from "@/lib/batch-expenses";
import type { WizardRefs } from "../shared";

const money = (n: number) => formatMoney(n);

const fmt = (n: number, d = 0) => n.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-neutral-100 py-1.5 text-sm last:border-0">
      <span className="text-neutral-600">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

export function ReviewStep({
  preview, previewErr, header, refs, ack, setAck, debtNow, rows, pct, rate, vatDefault, serviceVatPct,
}: {
  preview: BatchPreview | null; previewErr: string | null; header: BatchHeader; refs: WizardRefs; ack: boolean; setAck: (v: boolean) => void; debtNow: number;
  rows: IntakeRow[]; pct: Partial<Record<"fee" | "broker", boolean>>; rate: number; vatDefault: number; serviceVatPct: number;
}) {
  const comp = useMemo(() => compositionOf(rows, { rate, currency: header.currency || "RUB", vatDefault, pct, serviceVatPct }), [rows, rate, header.currency, vatDefault, pct, serviceVatPct]);
  if (previewErr) return <p className="text-sm text-red-700">{previewErr}</p>;
  if (!preview) return <p className="text-sm text-neutral-500">Считаем итоги…</p>;
  const t = preview.totals;
  const aName = header.newAuction ? `${header.newAuction.name.trim()} (новый)` : (refs.auctions.find((a) => a.id === header.auctionId)?.name ?? "–");
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <div>
          <Row label="Аукцион">{aName}</Row>
          <Row label="Валюта и курс">{header.currency}{header.currency !== "RUB" ? `, ${header.exchangeRate}` : ""}</Row>
          <Row label="Закупок будет создано">{preview.purchases.length}</Row>
          <Row label="Лотов">{fmt(t.lots)}</Row>
          <Row label="Шкур / единиц">{fmt(t.qty, 0)}</Row>
        </div>
        <div>
          <Row label="Сумма с НДС">{money(t.inclVat)}</Row>
          <Row label="Сумма без НДС">{money(t.exclVat)}</Row>
          <Row label="Средняя цена, ₽ за шкуру (с НДС)">{money(t.avgInclPerUnit)}</Row>
          <Row label="Средняя цена, ₽ за шкуру (без НДС)">{money(t.avgExclPerUnit)}</Row>
          {t.avgForeign !== null && <Row label={`Средний молоток, ${header.currency} за шкуру`}>{fmt(t.avgForeign, 0)}</Row>}
          <Row label="Приёмка на склад">{preview.receiving ? "сразу" : "нет, черновик"}</Row>
        </div>
      </div>
      <div className="rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
        Долг поставщику сейчас: <b>{money(debtNow)}</b>. После создания он вырастет на сумму закупок с НДС (≈ {money(t.inclVat)}) за вычетом оплат по этому аукциону, если они уже внесены.
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3" data-create-summary>
        <h2 className="text-sm font-semibold">Что будет создано</h2>
        <p className="text-sm text-neutral-700">Закупок: <b>{preview.purchases.length}</b>, лотов: <b>{fmt(t.lots)}</b>, шкур: <b>{fmt(t.qty)}</b>, на сумму <b>{money(t.inclVat)}</b> с НДС; {preview.receiving ? "мех будет принят на склад" : "закупки останутся черновиками"}.</p>
        <CompositionTable c={comp} serverTotal={t.inclVat} />
        <details className="text-xs">
          <summary className="cursor-pointer text-neutral-600">Лоты и себестоимость за шкуру ({comp.perLot.length})</summary>
          <div className="mt-1 max-h-72 overflow-auto">
            <table className="w-full min-w-[420px]">
              <thead className="text-left text-neutral-500"><tr><th className="py-1">Лот</th><th>Мех</th><th className="text-right">Шт.</th><th className="text-right">За шкуру, ₽</th><th className="text-right">Итого, ₽</th></tr></thead>
              <tbody>
                {comp.perLot.map((l) => (
                  <tr key={l.n} className="border-t border-neutral-100"><td className="py-0.5">{l.lot || "–"}</td><td>{l.material}</td><td className="text-right tabular-nums">{fmt(l.qty)}</td><td className="text-right tabular-nums">{fmt(l.unitIncl, 0)}</td><td className="text-right tabular-nums">{fmt(l.totalIncl, 0)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
      {preview.purchases.length > 1 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead className="text-left text-neutral-600"><tr><th className="py-1">Счёт аукциона</th><th>Лотов</th><th>Шт.</th><th className="text-right">С НДС</th><th className="text-right">Без НДС</th></tr></thead>
            <tbody>
              {preview.purchases.map((p) => (
                <tr key={p.key} className="border-t border-neutral-100"><td className="py-1">{p.invoice || "–"}</td><td>{p.lots}</td><td>{fmt(p.qty)}</td><td className="text-right">{money(p.inclVat)}</td><td className="text-right">{money(p.exclVat)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(preview.newMaterials.length > 0 || preview.newColors.length > 0 || header.newAuction) && (
        <div className="rounded-lg bg-[var(--ui-soft)] px-3 py-2 text-sm text-neutral-900">
          Вместе с партией будет добавлено в справочники:
          <ul className="list-disc pl-5">
            {header.newAuction && <li>аукцион «{header.newAuction.name.trim()}»</li>}
            {preview.newMaterials.length > 0 && <li>материалы: {preview.newMaterials.join(", ")}</li>}
            {preview.newColors.length > 0 && <li>цвета (на подтверждение): {preview.newColors.join(", ")}</li>}
          </ul>
        </div>
      )}
      {preview.planDiffRows > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Расчёт приложения отличается от «Себестоимости за единицу» из файла больше чем на 1 ₽ в строках: {preview.planDiffRows}. Причина обычно в округлении курса; сверьте итог с документом.</p>
      )}
      {preview.docs.some((d) => d.recon) && (
        <div className="flex flex-col gap-2">
          {preview.docs.filter((d) => d.recon).map((d) => (
            <div key={d.idx} className={"rounded-md px-3 py-2 text-sm " + (d.recon!.ok ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900")}>
              <b>{d.name}:</b> {d.recon!.message}
              {d.recon!.reasons.map((x, j) => <div key={j} className="mt-1 text-xs">Возможная причина — {x}</div>)}
            </div>
          ))}
        </div>
      )}
      {preview.mismatchDocs > 0 && (
        <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          Я вижу расхождение суммы документа с лотами и всё равно создаю партию (проверю документ позже)
        </label>
      )}
      {preview.dupInvoices.length > 0 && (
        <ul className="list-disc rounded-md bg-amber-50 px-8 py-2 text-sm text-amber-900" data-dup-invoice>
          {preview.dupInvoices.map((d) => (
            <li key={d.invoice}>Счёт № {d.invoice} уже на закупке <b>{d.purchaseNumber}</b> — это та же поставка? Если счёт законно делится на две закупки, продолжайте; при создании будет окно подтверждения.</li>
          ))}
        </ul>
      )}
      {preview.blocking.length > 0 && (
        <ul className="list-disc rounded-md bg-red-50 px-8 py-2 text-sm text-red-700">{preview.blocking.map((b, i) => <li key={i}>{b}</li>)}</ul>
      )}
    </div>
  );
}

export function ResultStep({ result, onRestart }: { result: BatchResult; onRestart: () => void }) {
  const delta = (a: number | null, b: number) => (a === null ? null : b - a);
  return (
    <div className="flex flex-col gap-4" data-batch-result>
      <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
        {result.duplicate ? "Эта партия уже была создана — повторное нажатие дубля не создало." : "Партия создана."} Аукцион «{result.auction.name}»{result.auction.created ? " (добавлен в справочник)" : ""}, закупок: {result.purchases.length}, лотов: {fmt(result.totals.lots)}, шт.: {fmt(result.totals.qty)}, на сумму {money(result.totals.inclVat)} с НДС{result.receiving ? ", мех принят на склад" : ", закупки — черновики"}.
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold">Что пересчиталось</h2>
        <Row label="Долг поставщику (с НДС)">
          {result.debt.before !== null ? `${money(result.debt.before)} → ` : ""}{money(result.debt.after)}
          {delta(result.debt.before, result.debt.after) !== null && <span className="ml-2 text-xs text-neutral-500">(+{money(delta(result.debt.before, result.debt.after)!)})</span>}
        </Row>
        <Row label="Закуплено (Главная, с НДС)">{result.purchased.before !== null ? `${money(result.purchased.before)} → ` : ""}{money(result.purchased.after)}</Row>
        {result.stock.map((s) => (
          <Row key={s.material} label={`Остаток: ${s.material}, шт.`}>{fmt(s.before, 0)} → {fmt(s.after, 0)}</Row>
        ))}
        {!result.receiving && <Row label="Остаток меха">не изменился: закупки не приняты</Row>}
        <p className="mt-1 text-xs text-neutral-500">Главная (Закуплено, Остаток, Долг поставщику) и страница «Сырьё» уже показывают новые цифры. <Link href="/dashboard" className="underline">Открыть Сводку →</Link></p>
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold">Созданные закупки</h2>
        <ul className="text-sm">
          {result.purchases.map((p) => (
            <li key={p.id} className="flex justify-between gap-2 border-b border-neutral-100 py-1">
              <Link href={`/purchases/${p.id}`} className="underline">{p.number}{p.invoice ? ` · счёт ${p.invoice}` : ""}</Link>
              <span>{p.lots} лот. · {money(p.inclVat)}</span>
            </li>
          ))}
        </ul>
        <Link href={`/lots?auction=${encodeURIComponent(result.auction.name)}`} className="mt-1 inline-block text-sm underline">Лоты на странице «Сырьё» →</Link>
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold">Что сделать дальше</h2>
        {result.tasks.length === 0 ? (
          <p className="text-sm text-neutral-500">Задач нет.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {result.tasks.map((t, i) => (
              <li key={i}><Link href={t.href} className="underline">{t.text}</Link></li>
            ))}
          </ul>
        )}
      </div>
      <div><Button type="button" variant="outline" onClick={onRestart}>Завести ещё одну партию</Button></div>
    </div>
  );
}
