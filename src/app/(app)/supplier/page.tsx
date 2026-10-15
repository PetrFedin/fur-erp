import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { requireInboxViewer, suppliesRawOf } from "@/lib/supplier-inbox";
import { supplierRawRows } from "@/lib/supplier-raw";
import { chatCounts, viewerOf } from "@/lib/chat";
import { summarizeStages, summaryLine } from "@/lib/raw-stage";
import { wallNow } from "@/lib/shipment-calc";
import { cookies } from "next/headers";
import { loadRecent } from "@/lib/supplier-recent";
import { RECENT_COOKIE } from "@/lib/supplier-recent-const";
import { RecentSeen } from "./recent-seen";

export const metadata = { title: "Контроль" };

type Item = { key: string; text: string; href: string; hint?: string };

/** Раздел «Контроль» кабинета Веллмеха: что от него ждут сегодня и что мы решили. Только его данные — без наших цен, продаж и остальных разделов. */
export default async function SupplierHomePage() {
  const s = await requireInboxViewer();
  const isSup = s.user.role === "SUPPLIER";
  let supplierId = s.user.supplierId ?? null;
  if (!isSup) {
    const sup = await prisma.supplier.findFirst({ where: { organizationId: s.user.organizationId, users: { some: { role: "SUPPLIER" } } }, select: { id: true } });
    supplierId = sup?.id ?? null;
  }
  const orgId = s.user.organizationId;
  const hasRaw = await suppliesRawOf(s);
  const sections: { title: string; empty: string; items: Item[] }[] = [];

  // 1. Не отправлено и возвращено нам на доработку
  const inbox = supplierId
    ? await prisma.supplierInbox.findMany({ where: { organizationId: orgId, supplierId, status: { in: ["DRAFT", "REJECTED"] } }, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, kind: true, status: true, title: true, reviewNote: true } })
    : [];
  const inboxHref = (r: (typeof inbox)[number]) => (r.kind === "TZ" ? `/supplier/tz/${r.id}` : r.kind === "AUCTION_CALC" ? `/supplier/auction-calcs/${r.id}` : "/supplier/raw");
  sections.push({
    title: "Не отправлено нам и возвращено на доработку",
    empty: "Нет.",
    items: inbox.map((r) => ({ key: r.id, href: inboxHref(r), text: `${r.kind === "TZ" ? "ТЗ" : r.kind === "AUCTION_CALC" ? "Расчёт" : "Документ"} «${r.title}» — ${r.status === "DRAFT" ? "черновик, ещё не отправлен" : `возвращено${r.reviewNote ? `: ${r.reviewNote}` : ""}`}` })),
  });

  // 2. Запросы от нас
  const awaiting = isSup ? (await chatCounts(viewerOf(s))).awaiting : 0;
  sections.push({ title: "Запросы от нас", empty: "Нет запросов.", items: awaiting > 0 ? [{ key: "chat", href: "/chat?f=await", text: `Ждут вашего ответа в чате: ${awaiting}` }] : [] });

  // 3. Сырьё: просроченные этапы и аукционы без отметки «где мех»
  const stageRows = supplierId && hasRaw ? await prisma.supplierRawStage.findMany({ where: { organizationId: orgId, supplierId }, select: { purchaseId: true, stage: true, status: true, place: true, plannedStart: true, plannedEnd: true, factStart: true, factEnd: true } }) : [];
  const raw = supplierId && hasRaw ? await supplierRawRows(orgId, supplierId) : [];
  const byPurchase = new Map<string, typeof raw>();
  for (const r of raw) (byPurchase.get(r.purchaseId) ?? byPurchase.set(r.purchaseId, []).get(r.purchaseId)!).push(r);
  const rawItems: Item[] = [];
  const noDoc: Item[] = [];
  const noStage = new Map<string, { n: number; pid: string }>();
  const missDoc = new Map<string, { lots: number; of: number }>();
  for (const [pid, rows] of byPurchase) {
    const h = rows[0];
    const name = h.auction || h.purchaseNumber;
    const sum = summarizeStages(stageRows.filter((x) => x.purchaseId === pid));
    if (sum?.overdue) rawItems.push({ key: "o" + pid, href: `/supplier/raw/${pid}`, text: `${name}${h.invoice ? ` (счёт ${h.invoice})` : ""}: этап просрочен — ${summaryLine(sum)}. Обновите даты или этап.` });
    else if (!sum && !h.received) { const c = noStage.get(name) ?? { n: 0, pid }; c.n++; noStage.set(name, c); }
    const miss = rows.filter((r) => !r.doc).length;
    if (miss > 0) { const c = missDoc.get(name) ?? { lots: 0, of: 0 }; c.lots += miss; c.of += rows.length; missDoc.set(name, c); }
  }
  for (const [name, c] of noStage) rawItems.push({ key: "n" + name, href: c.n > 1 ? `/supplier/raw?auction=${encodeURIComponent(name)}` : `/supplier/raw/${c.pid}`, text: `${name}${c.n > 1 ? ` (счетов: ${c.n})` : ""}: не отмечено, где сейчас мех — добавьте этап.` });
  for (const [name, c] of missDoc) noDoc.push({ key: "d" + name, href: `/supplier/raw?auction=${encodeURIComponent(name)}`, text: `${name}: у ${c.lots} из ${c.of} лотов нет УПД / спецификации — приложите документ.` });
  if (hasRaw) {
    sections.push({ title: "Сырьё по аукционам", empty: "По всем аукционам указано, где мех, и сроки не просрочены.", items: rawItems });
    sections.push({ title: "Документы к лотам", empty: "К лотам приложены УПД и спецификации.", items: noDoc.slice(0, 15) });
  }

  // 4. Отгрузки: ожидаемые этапы Веллмеха с прошедшей датой
  const late = supplierId
    ? await prisma.shipmentEvent.findMany({ where: { expected: true, side: "WELLMEKH", occurredAt: { lt: wallNow() }, shipment: { organizationId: orgId, supplierId } }, orderBy: { occurredAt: "asc" }, take: 10, select: { id: true, title: true, shipmentId: true, occurredAt: true, shipment: { select: { name: true } } } })
    : [];
  sections.push({ title: "Отгрузки", empty: "Нет просрочки.", items: late.map((e) => ({ key: e.id, href: `/shipments/${e.shipmentId}`, text: `${e.shipment.name ?? "Отгрузка"}: этап «${e.title}» ожидался ${e.occurredAt.toLocaleDateString("ru-RU", { timeZone: "UTC" })} — отметьте, когда прошёл.` })) });

  // «Недавнее»: что мы решили по их входящим и отметкам за 14 дней; новое с прошлого просмотра помечено.
  const recent = supplierId ? await loadRecent(orgId, supplierId) : [];
  const seenMs = Number((await cookies()).get(RECENT_COOKIE)?.value) || 0;
  const total = sections.reduce((a, x) => a + x.items.length, 0);
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Контроль" }]} />
      <h1 className="text-xl font-semibold">Контроль</h1>
      <p className="text-sm text-neutral-600">{total === 0 ? "Ничего не требуется." : `Требует внимания: ${total}.`}</p>
      <section aria-label="Недавнее" className="flex flex-col gap-1.5 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Недавнее <span className="font-normal text-neutral-500">· решения с нашей стороны за 14 дней</span></h2>
        {recent.length === 0 ? <p className="text-sm text-neutral-500">Нет решений.</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {recent.map((r) => (
              <li key={r.key} className="flex flex-wrap items-baseline gap-x-2">
                {r.at.getTime() > seenMs && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-900">новое</span>}
                <Link href={r.href} className={`inline-block underline decoration-dotted hover:decoration-solid max-md:py-2.5 ${r.tone === "back" ? "text-red-700" : "text-emerald-800"}`}>{r.text}</Link>
              </li>
            ))}
          </ul>
        )}
        {isSup && <RecentSeen />}
      </section>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {sections.map((sec) => (
          <section key={sec.title} className="flex flex-col gap-1.5 rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-semibold">{sec.title}{sec.items.length > 0 && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-normal text-amber-900">{sec.items.length}</span>}</h2>
            {sec.items.length === 0 ? <p className="text-sm text-neutral-500">{sec.empty}</p> : (
              <ul className="flex flex-col gap-1 text-sm">
                {sec.items.map((i) => <li key={i.key}><Link href={i.href} className="inline-block text-blue-700 underline decoration-dotted hover:decoration-solid max-md:py-2.5">{i.text}</Link></li>)}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
