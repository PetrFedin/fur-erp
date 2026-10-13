import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { InfoHint } from "@/components/info-hint";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { loadAuctionPanels } from "@/lib/auction-doc-checklist";
import { loadBatchPanels } from "@/lib/production-doc-checklist";
import { TONE_DOT, overallTone, type Panel, type Tone } from "@/lib/doc-panel";
import { type YearFilter } from "@/lib/year-filter";
import { isServiceAuction } from "@/lib/auction-names";
import { cn } from "@/lib/utils";

type Row = { key: string; kind: "Аукцион" | "Партия"; title: string; href: string; year: number | null; tone: Tone; panel: Panel; unmatched: boolean };

const TONE_ORDER: Record<Tone, number> = { bad: 0, warn: 1, muted: 2, ok: 3 };

/** «Что осталось подгрузить и отметить»: по аукционам и партиям — какой документ нужен, где упомянут, отмечена ли оплата. */
export async function TodoSummary({ organizationId, year }: { organizationId: string; year: YearFilter }) {
  const c4Mode = await getCommission4Mode();
  const [auctions, batches] = await Promise.all([
    loadAuctionPanels(prisma, organizationId, { canUpload: false, canMark: false }),
    loadBatchPanels(prisma, organizationId, { c4Mode, canUpload: false, canMark: false }),
  ]);
  const y = year === "all" ? null : Number(year);
  const all: Row[] = [
    ...auctions
      .filter((a) => a.kind === "auction" && !isServiceAuction(a.key))
      .filter((a) => y === null || a.years.includes(y))
      .map((a) => ({ key: a.panel.id, kind: "Аукцион" as const, title: a.panel.title, href: `/lots?auction=${encodeURIComponent(a.key)}`, year: a.years.length ? Math.max(...a.years) : null, tone: overallTone(a.panel.missingCount, a.panel.pay, a.panel.proofMissing), panel: a.panel, unmatched: !!a.panel.alert })),
    ...batches
      .filter((b) => y === null || b.year === y || new Date(b.lastAt).getUTCFullYear() === y)
      .map((b) => ({ key: b.panel.id, kind: "Партия" as const, title: b.panel.title, href: `/production/batches/${b.number}`, year: b.year, tone: b.tone, panel: b.panel, unmatched: b.unmatched })),
  ];
  const todo = all.filter((r) => r.tone !== "ok" && r.tone !== "muted").sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || a.title.localeCompare(b.title, "ru", { numeric: true }));
  const done = all.length - todo.length;
  const missingDocs = todo.reduce((s, r) => s + r.panel.missingCount, 0);
  const unpaid = todo.filter((r) => r.panel.pay.state === "UNPAID" || r.panel.pay.state === "PARTIAL").length;

  const missingText = (p: Panel) => p.items.filter((i) => i.need === "required" && !i.ok).map((i) => i.label);
  const mentionText = (p: Panel): string => {
    const parts: string[] = [];
    for (const it of p.items) if (it.need === "required" && !it.ok && it.mentions[0]) parts.push(`${it.label}: ${it.mentions[0].text}`);
    if (p.mentionedPayments[0] && p.pay.state !== "PAID") parts.push(p.mentionedPayments[0]);
    return parts.join(" · ");
  };

  return (
    <section id="todo" aria-label="Что осталось подгрузить и отметить" className="flex scroll-mt-4 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="block-title">Что осталось подгрузить и отметить</h2>
        <InfoHint wide label="Как читать сводку">
          <div className="flex flex-col gap-1.5">
            <p>Аукционы (закупки сырья) и партии производства, где не хватает обязательных документов, оплата не отмечена полностью или по оплате нет платёжки. Те же статусы и формулировки, что в карточках и в «Реестре сверки».</p>
            <p><b>Какой документ нужен</b> — обязательные по правилам «Покрытия документами», которых ещё нет. <b>Где упомянут</b> — что названо в папке Drive «мех» (docs-inventory): документ можно привязать в карточке одним кликом. <b>Оплата</b> — полностью / частично N% / не оплачено; если оплата названа в документе, а в учёте её нет — так и написано.</p>
            <p>Строка закрывается сама, как только документ загружен/привязан и оплата отмечена. Год — из шапки. Служебные группы без реального аукциона («Нет информации» и т. п.) здесь не считаются — их закупки смотрите в матрице ниже.</p>
          </div>
        </InfoHint>
        <span className="text-xs text-neutral-500">
          требуют внимания: <b className={todo.length ? "text-red-700" : "text-emerald-700"}>{todo.length}</b> из {all.length}
          <InfoHint label="Из чего складывается">
            <p>Не хватает документов: {missingDocs} · оплата не закрыта: {unpaid} · в порядке: {done}</p>
          </InfoHint>
        </span>
      </div>
      {todo.length === 0 ? (
        <p className="text-sm text-neutral-500">Все аукционы и партии за выбранный год сопоставлены: документы есть, оплата отмечена.</p>
      ) : (
        <ResponsiveRows
          table={
            <div className="flex flex-col gap-2">
              <TodoTable rows={todo.slice(0, TOP)} missingText={missingText} mentionText={mentionText} />
              {todo.length > TOP && (
                <details>
                  <summary className="cursor-pointer list-none px-1 py-1 text-sm text-blue-700 hover:underline">Ещё {todo.length - TOP}</summary>
                  <div className="mt-2"><TodoTable rows={todo.slice(TOP)} missingText={missingText} mentionText={mentionText} /></div>
                </details>
              )}
            </div>
          }
        >
          {todo.map((r) => (
            <RowCard
              key={r.key}
              title={r.title}
              href={r.href}
              subtitle={`${r.kind}${r.year ? ` · ${r.year}` : ""}`}
              badge={<span aria-hidden className={cn("inline-block size-3 rounded-full", TONE_DOT[r.tone])} />}
              fields={[
                { label: "Нужен документ", value: missingText(r.panel).length ? <span className="font-medium text-red-700">{missingText(r.panel).join(", ")}</span> : "всё есть", strong: true },
                { label: "Оплата", value: r.panel.pay.label },
              ]}
              details={[
                { label: "Где упомянут", value: mentionText(r.panel) || "в документах не названо" },
                { label: "Платёжек нет", value: r.panel.proofMissing || null },
              ]}
            />
          ))}
        </ResponsiveRows>
      )}
    </section>
  );
}

const TOP = 10;

function TodoTable({ rows, missingText, mentionText }: { rows: Row[]; missingText: (p: Panel) => string[]; mentionText: (p: Panel) => string }) {
  return (
            <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Что</th>
                    <th className="px-3 py-2 font-medium">Какой документ нужен</th>
                    <th className="px-3 py-2 font-medium">Оплата отмечена?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {rows.map((r) => (
                    <tr key={r.key} className="align-top">
                      <td className="px-3 py-2">
                        <Link href={r.href} className="flex items-start gap-2 font-medium hover:underline">
                          <span aria-hidden className={cn("mt-1.5 inline-block size-2.5 shrink-0 rounded-full", TONE_DOT[r.tone])} />
                          <span>
                            {r.title}
                            {mentionText(r.panel) && (
                              <span className="ml-1.5 align-middle font-normal">
                                <InfoHint wide label="Где упомянут документ"><p>{mentionText(r.panel)}</p></InfoHint>
                              </span>
                            )}
                            <span className="block text-xs font-normal text-neutral-500">
                              {r.kind}
                              {r.year ? ` · ${r.year}` : ""}
                              {r.unmatched ? " · нет сопоставимых документов" : ""}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {missingText(r.panel).length > 0 ? <span className="font-medium text-red-700">{missingText(r.panel).join(", ")}</span> : <span className="text-neutral-500">всё есть</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Link href={r.href} className="hover:underline">
                          <span className={cn("font-medium", r.panel.pay.tone === "bad" ? "text-red-700" : r.panel.pay.tone === "warn" ? "text-amber-700" : "text-emerald-700")}>{r.panel.pay.label}</span>
                          {r.panel.pay.state !== "PAID" && r.panel.pay.state !== "NOBASE" && <span className="block text-xs text-neutral-500">остаток {r.panel.pay.remainingText}</span>}
                          {r.panel.proofMissing > 0 && <span className="block text-xs text-amber-700">платёжек нет: {r.panel.proofMissing}</span>}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
  );
}
