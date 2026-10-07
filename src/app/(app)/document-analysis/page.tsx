import Link from "next/link";
import { ControlTabs } from "@/components/control-tabs";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card } from "@/components/ui/card";
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
      conclusion: "Это не аукцион: четыре закупки на 6,40679 млн ₽ без счёта/УПД/платёжки выглядят как возможный двойной учёт шкур подрядчика и оставлены на ручную проверку.",
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
          <h1 className="text-xl font-semibold">Анализ документов</h1>
          <p className="mt-1 max-w-3xl text-sm text-neutral-500">
            Отдельный контур доказательств: Google Drive «Мех» → первичные документы → оплаты → ТЗ/партии → ERP. Здесь находятся пробелы, расхождения и ручные проверки; управленческая «Сводка» этим не перегружена. Очередь дел — вкладка «Задачи».
          </p>
        </div>
        <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-neutral-600">{yearLabel(year)}</span>
      </div>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Google Drive · «Мех»</div>
          <div className="mt-2 text-2xl font-semibold">{driveSyncSnapshot.meaningfulCoveragePct}%</div>
          <div className="mt-1 text-xs text-neutral-500">{driveSyncSnapshot.dbUniqueDriveFiles} канонических файлов · {driveSyncSnapshot.recognizedDuplicateCopies} дублей распознано</div>
          <div className={"mt-2 text-xs font-medium " + (driveSyncSnapshot.meaningfulUnlinkedFiles ? "text-red-700" : "text-emerald-700")}>Значимых непривязанных: {driveSyncSnapshot.meaningfulUnlinkedFiles}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Покрытие обязательной первичкой</div>
          <div className="mt-2 text-2xl font-semibold">{coverage.total.percent == null ? "—" : `${coverage.total.percent}%`}</div>
          <div className="mt-1 text-xs text-neutral-500">есть {coverage.total.have} из {coverage.total.required} обязательных доказательств</div>
          <div className="mt-2 text-xs font-medium text-amber-700">Записей с пробелами: {coverage.total.rowsWithGaps}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Расхождения цифр</div>
          <div className="mt-2 text-2xl font-semibold">{conflicts + reviews}</div>
          <div className="mt-1 text-xs text-neutral-500">конфликты: {conflicts} · ручное решение: {reviews}</div>
          <Link href="/reconciliation" className="mt-2 inline-block text-xs underline">Открыть сверку →</Link>
        </Card>
        <Card className="p-4">
          <Link href="/attention" className="text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:underline">Задачи →</Link>
          <div className="mt-2 text-2xl font-semibold">{attention.main}</div>
          <div className="mt-1 text-xs text-neutral-500">срочных блоков: {attention.red} · справочно: {attention.info}</div>
          <Link href="/verify" className="mt-2 inline-block text-xs underline">ждёт подтверждения строк: {verification.total - verification.verified} →</Link>
        </Card>
      </section>

      <section className="space-y-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Покрытие по процессам</div>
          <h2 className="mt-1 text-base font-semibold">Где именно не хватает документа</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {tiles.map(([key, label, href]) => {
            const s = section.get(key);
            const gaps = s?.rowsWithGaps ?? 0;
            return (
              <Link key={key} href={href} className="rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-400 hover:shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</div>
                <div className="mt-2 text-xl font-semibold">{s?.percent == null ? "—" : `${s.percent}%`}</div>
                <div className={"mt-1 text-xs font-medium " + (gaps ? "text-amber-700" : "text-emerald-700")}>{gaps ? `Пробелы: ${gaps}` : "Пробелов нет"}</div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Проверка спорного долга</div>
          <h2 className="mt-1 text-base font-semibold">Почему отдельные партии выглядят неоплаченными</h2>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {debtCases.map((c) => {
            const first = c.group?.diffs?.[0];
            const next = c.group?.manualReview?.[0] ?? c.group?.diffs?.[1]?.why;
            return (
              <Card key={c.key} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold">{c.title}</div>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">ручная проверка</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-neutral-700">{c.conclusion}</p>
                {first ? (
                  <div className="mt-3 rounded-lg bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-600">
                    <div className="font-medium text-neutral-900">{first.what}</div>
                    {first.doc ? <div className="mt-1">Документ: {first.doc}</div> : null}
                    {first.db ? <div>ERP: {first.db}</div> : null}
                  </div>
                ) : null}
                {next ? <div className="mt-2 text-xs font-medium text-amber-800">Следующее действие: {next}</div> : null}
                <Link href="/reconciliation" className="mt-3 inline-block text-xs underline">Открыть сверку →</Link>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
