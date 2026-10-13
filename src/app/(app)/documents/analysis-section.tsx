import Link from "next/link";
import { WidgetRow } from "@/components/widget-row";
import { InfoHint } from "@/components/info-hint";
import { Card } from "@/components/ui/card";
import { TILE_BOX, TileCaption, TileHead, TileValue } from "@/app/(app)/dashboard/tile";
import { formatPercent } from "@/lib/utils";
import { RELIABILITY_NOTE } from "@/lib/reliability-note";
import { loadControlCounts } from "@/lib/control-counts";
import type { YearFilter } from "@/lib/year-filter";
import reconciliationData from "@/data/reconciliation.json";
import driveSyncSnapshot from "@/data/drive-sync-snapshot.json";

/**
 * Раздел «Расхождения / документы для поиска» — бывшая страница «Анализ документов», перенесённая без новых плиток:
 * те же блоки (документы папки «Мех», расхождения цифр, документы для поиска, почему партии выглядят неоплаченными).
 * Плитки «документы привязаны» и «где не хватает документа» не повторяются: это «Покрытие документами» выше.
 */
export async function AnalysisSection({ organizationId, year }: { organizationId: string; year: YearFilter }) {
  const counts = await loadControlCounts(organizationId, year);
  const groups = reconciliationData.groups.filter((g) => year === "all" || g.year === Number(year));
  const conflicts = groups.filter((g) => g.status === "conflict").length;
  const reviews = groups.filter((g) => g.status === "review").length;
  const urgentDocs = counts.blocks?.urgentDocs ?? 0;
  const debtCases = [
    {
      key: "P:СП 05.25",
      title: "СП 05.25",
      conclusion: "Документы аванса есть; проблема — не отсутствие оплаты, а неразнесённый аванс между СП 05.25 и РП 05.25.",
    },
    {
      key: "P:РП 04-26",
      title: "РП 04.26",
      conclusion: "Счёт и согласование найдены; открытый остаток сохраняется, потому что банковское подтверждение финальной доплаты не найдено.",
    },
    {
      key: "P:«Доп закупка сырья партия 5/6/7/9» (З-2026-0010…0013)",
      title: "Ранее «Нет информации»",
      conclusion: "Это не аукцион, а шкуры подрядчика (6,40679 млн ₽): по решению владельца 08.10.2026 закупки сохранены, а их оплата выделена из доплат производства (счета №235, №239, №1, №7) отдельными оплатами закупок; остаток шкур партии 7 (189 966,22 ₽) — проверить.",
    },
  ].map((c) => ({ ...c, group: reconciliationData.groups.find((g) => g.id === c.key) }));

  return (
    <section id="analysis" aria-label="Расхождения и документы для поиска" className="flex scroll-mt-4 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="block-title">Расхождения / документы для поиска</h2>
        <InfoHint wide label="О разделе">
          <p>Контур доказательств: папка документов «Мех» → первичные документы → оплаты → ТЗ/партии → ERP. Здесь находятся пробелы, расхождения и ручные проверки. Очередь дел — вкладка «Задачи».</p>
        </InfoHint>
      </div>

      <WidgetRow id="docs-summary" title="Расхождения и документы для поиска — итоги">
        <section className="grid items-stretch gap-3 sm:grid-cols-3">
          <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
            <TileHead>Документы папки «Мех»</TileHead>
            <TileValue>{formatPercent(driveSyncSnapshot.meaningfulCoveragePct)}</TileValue>
            <TileCaption>
              документы привязаны (файлов)
              <InfoHint label="Подробности">
                <p>{driveSyncSnapshot.dbUniqueDriveFiles} канонических файлов · {driveSyncSnapshot.recognizedDuplicateCopies} дублей распознано.</p>
                <p className="mt-1">{RELIABILITY_NOTE}</p>
              </InfoHint>
            </TileCaption>
            <div className={"mt-2 text-xs " + (driveSyncSnapshot.meaningfulUnlinkedFiles ? "text-red-700" : "text-emerald-700")}>Значимых непривязанных: {driveSyncSnapshot.meaningfulUnlinkedFiles}</div>
          </div>
          <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
            <TileHead>Расхождения цифр</TileHead>
            <TileValue>{conflicts + reviews}</TileValue>
            <TileCaption>конфликты: {conflicts} · ручное решение: {reviews}</TileCaption>
            <Link href="/reconciliation" className="mt-2 inline-block text-xs text-blue-700 hover:underline">Открыть сверку →</Link>
          </div>
          <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
            <TileHead>Документов для поиска</TileHead>
            <TileValue>{counts.docTasks}</TileValue>
            <TileCaption>
              срочных: {urgentDocs}
              <InfoHint label="Подробности"><p>Документы, которых нет в Drive «мех» и которые надо запросить у бухгалтерии или Веллмех. Тот же счёт, что «Документы для поиска и загрузки» во вкладке «Задачи».</p></InfoHint>
            </TileCaption>
            <Link href="/attention#doc-tasks" className="mt-2 inline-block text-xs text-blue-700 hover:underline">Открыть в «Задачах» →</Link>
          </div>
        </section>
      </WidgetRow>

      <h3 className="text-sm font-medium text-neutral-800">Почему отдельные партии выглядят неоплаченными</h3>
      <div className="grid gap-3 lg:grid-cols-3">
        {debtCases.map((c) => {
          const first = c.group?.diffs?.[0];
          const next = c.group?.manualReview?.[0] ?? c.group?.diffs?.[1]?.why;
          return (
            <Card key={c.key} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium">{c.title}</div>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">ручная проверка</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-neutral-700">{c.conclusion}</p>
              {(first || next) && (
                <div className="mt-2 text-xs">
                  <InfoHint wide label={`Подробности: ${c.title}`}>
                    {first ? (
                      <>
                        <p className="font-medium text-neutral-900">{first.what}</p>
                        {first.doc ? <p className="mt-1">Документ: {first.doc}</p> : null}
                        {first.db ? <p>ERP: {first.db}</p> : null}
                      </>
                    ) : null}
                    {next ? <p className="mt-2 font-medium text-amber-800">Следующее действие: {next}</p> : null}
                  </InfoHint>
                  <span className="ml-1 text-neutral-500">расхождение и следующий шаг</span>
                </div>
              )}
              <Link href="/reconciliation" className="mt-3 inline-block text-xs underline">Открыть сверку →</Link>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
