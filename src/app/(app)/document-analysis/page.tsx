import Link from "next/link";
import { WidgetRow } from "@/components/widget-row";
import { ControlTabs } from "@/components/control-tabs";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { InfoHint } from "@/components/info-hint";
import { Card } from "@/components/ui/card";
import { TILE_BOX, TileCaption, TileHead, TileValue } from "@/app/(app)/dashboard/tile";
import { computeDocCoverage } from "@/lib/doc-coverage";
import { buildAttentionBlocks, computeAttention, countAttentionBlocks } from "@/lib/attention";
import { loadVerifyFlags } from "@/lib/verification";
import { getYearFilter, yearLabel } from "@/lib/year-filter";
import reconciliationData from "@/data/reconciliation.json";
import driveSyncSnapshot from "@/data/drive-sync-snapshot.json";

export const metadata = { title: "Анализ документов" };

export default async function DocumentAnalysisPage() {
  const session = await requireSession();
  const organizationId = session.user.organizationId;
  const year = await getYearFilter();
  const [coverage, attentionRows, vf] = await Promise.all([
    computeDocCoverage(prisma, organizationId),
    computeAttention(prisma, organizationId, year),
    loadVerifyFlags(prisma, organizationId, year),
  ]);
  const attention = countAttentionBlocks(buildAttentionBlocks(attentionRows));
  const verification = Object.values(vf.counts).reduce(
    (a, c) => ({ total: a.total + c.total, verified: a.verified + c.verified }),
    { total: 0, verified: 0 },
  );
  const groups = reconciliationData.groups.filter((g) => year === "all" || g.year === Number(year));
  const conflicts = groups.filter((g) => g.status === "conflict").length;
  const reviews = groups.filter((g) => g.status === "review").length;
  const section = new Map(coverage.sections.map((s) => [s.key, s]));
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

  const tiles = [
    ["purchases", "Закупки сырья", "/documents?section=purchases&gaps=1"],
    ["payments", "Оплаты сырья", "/documents?section=payments&gaps=1"],
    ["tz", "ТЗ", "/documents?section=tz&gaps=1"],
    ["batches", "Партии производства", "/documents?section=batches&gaps=1"],
    ["prodPayments", "Оплаты производства", "/documents?section=prodPayments&gaps=1"],
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <ControlTabs active="analysis" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Анализ документов</h1><span className="ml-2 align-middle text-sm font-normal">
              <InfoHint wide label="О странице">
                <p>Отдельный контур доказательств: Google Drive «Мех» → первичные документы → оплаты → ТЗ/партии → ERP. Здесь находятся пробелы, расхождения и ручные проверки; управленческая «Главная» этим не перегружена. Очередь дел — вкладка «Задачи».</p>
              </InfoHint>
            </span></div>
        </div>
        <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-neutral-600">{yearLabel(year)}</span>
      </div>

      <WidgetRow id="docs-summary" title="Анализ документов — итоги">
      <section className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
          <TileHead>Google Drive · «Мех»</TileHead>
          <TileValue>{driveSyncSnapshot.meaningfulCoveragePct}%</TileValue>
          <TileCaption>файлов с привязкой<InfoHint label="Подробности"><p>{driveSyncSnapshot.dbUniqueDriveFiles} канонических файлов · {driveSyncSnapshot.recognizedDuplicateCopies} дублей распознано.</p></InfoHint></TileCaption>
          <div className={"mt-2 text-xs " + (driveSyncSnapshot.meaningfulUnlinkedFiles ? "text-red-700" : "text-emerald-700")}>Значимых непривязанных: {driveSyncSnapshot.meaningfulUnlinkedFiles}</div>
        </div>
        <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
          <TileHead>Документы на месте</TileHead>
          <TileValue>{coverage.total.percent == null ? "—" : `${coverage.total.percent}%`}</TileValue>
          <TileCaption>документы есть<InfoHint label="Подробности"><p>Есть {coverage.total.have} из {coverage.total.required} обязательных доказательств.</p></InfoHint></TileCaption>
          <div className="mt-2 text-xs text-amber-700">Записей с пробелами: {coverage.total.rowsWithGaps}</div>
        </div>
        <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
          <TileHead>Расхождения цифр</TileHead>
          <TileValue>{conflicts + reviews}</TileValue>
          <TileCaption>конфликты: {conflicts} · ручное решение: {reviews}</TileCaption>
          <Link href="/reconciliation" className="mt-2 inline-block text-xs text-blue-700 hover:underline">Открыть сверку →</Link>
        </div>
        <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
          <TileHead>Задачи</TileHead>
          <TileValue>{attention.main}</TileValue>
          <TileCaption>срочных: {attention.red}<InfoHint label="Подробности"><p>Срочных блоков {attention.red} · справочно {attention.info}.</p></InfoHint></TileCaption>
          <Link href="/attention" className="mt-2 inline-block text-xs text-blue-700 hover:underline">Открыть задачи →</Link>
          <Link href="/verify" className="mt-1 inline-block text-xs text-blue-700 hover:underline">ждёт подтверждения строк: {verification.total - verification.verified} →</Link>
        </div>
      </section>
      </WidgetRow>

      <section className="space-y-2">
        <div>
          <h2 className="text-base font-semibold">Где именно не хватает документа</h2>
        </div>
        <WidgetRow id="docs-gaps" title="Где не хватает документа">
        <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {tiles.map(([key, label, href]) => {
            const s = section.get(key);
            const gaps = s?.rowsWithGaps ?? 0;
            return (
              <Link key={key} href={href} className={TILE_BOX + " shadow-sm transition hover:border-neutral-400 hover:shadow-md print:shadow-none"}>
                <TileHead>{label}</TileHead>
                <TileValue>{s?.percent == null ? "—" : `${s.percent}%`}</TileValue>
                <div className={"text-xs " + (gaps ? "text-amber-700" : "text-emerald-700")}>{gaps ? `Пробелы: ${gaps}` : "Пробелов нет"}</div>
              </Link>
            );
          })}
        </div>
        </WidgetRow>
      </section>

      <section className="space-y-2">
        <div>
          <h2 className="text-base font-semibold">Почему отдельные партии выглядят неоплаченными</h2>
        </div>
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
    </div>
  );
}
