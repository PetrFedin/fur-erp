import { prisma } from "@/lib/prisma";
import { getFreshSession } from "@/lib/session";
import { cleanSearch, escapeLike } from "@/lib/input";
import { loadArticleList } from "@/lib/article-ref";
import { searchArticleList } from "@/lib/article-key";
import { paymentCode } from "@/lib/payments-registry";
import { loadAllArticleParams } from "@/lib/article-params";
import { pluMatchIds } from "@/lib/article-photo-match";
import { formatMoney } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Простой глобальный поиск по номерам: GET /api/search?q=… (минимум 2 символа).
 * Только чтение, организация — из сессии, до 5 результатов на группу. Видимость — как у самих разделов (страницы читают все роли).
 */
type Item = { href: string; title: string; sub?: string };
type Group = { key: string; label: string; all: string; items: Item[] };

const LIMIT = 5;
const ruDate = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join(".");
const money = (v: { toString(): string }) => formatMoney(Number(v.toString()));

export async function GET(request: Request) {
  const session = await getFreshSession();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const orgId = session.user.organizationId;
  const q = cleanSearch(new URL(request.url).searchParams.get("q"), 60);
  const headers = { "Cache-Control": "no-store" };
  if (q.length < 2) return Response.json({ q, groups: [] }, { headers });
  const like = () => ({ contains: escapeLike(q), mode: "insensitive" as const });
  const enc = encodeURIComponent(q);

  const [orders, lots, purchases, pays, prodPays, articleList, suppliers, clients, shipments] = await Promise.all([
    prisma.productionOrder.findMany({
      where: { organizationId: orgId, OR: [{ workOrderNumber: like() }, { number: like() }] },
      select: { id: true, number: true, workOrderNumber: true, productModel: { select: { name: true } }, client: { select: { name: true } } },
      orderBy: { createdAt: "desc" }, take: LIMIT,
    }),
    prisma.rawMaterialLot.findMany({
      where: { organizationId: orgId, lotNumber: like() },
      select: { id: true, lotNumber: true, grade: true, rawMaterial: { select: { name: true } } },
      orderBy: { createdAt: "desc" }, take: LIMIT,
    }),
    prisma.purchase.findMany({
      where: { organizationId: orgId, OR: [{ number: like() }, { invoiceNumber: like() }, { transferDocument: like() }, { invoice: { number: like() } }, { supplier: { name: like() } }] },
      select: { id: true, number: true, invoiceNumber: true, transferDocument: true, orderDate: true, supplier: { select: { name: true } } },
      orderBy: { orderDate: "desc" }, take: LIMIT,
    }),
    prisma.payment.findMany({
      where: { organizationId: orgId, status: "COMPLETED", OR: [{ ppNo: like() }, { invoiceNo: like() }, { docRef: like() }] },
      select: { id: true, amount: true, paidAt: true, ppNo: true, invoiceNo: true, supplier: { select: { name: true } } },
      orderBy: { paidAt: "desc" }, take: LIMIT,
    }),
    prisma.productionPayment.findMany({
      where: { organizationId: orgId, status: "COMPLETED", OR: [{ ppNo: like() }, { invoiceNo: like() }, { docRef: like() }] },
      select: { id: true, amount: true, paidAt: true, ppNo: true, invoiceNo: true, client: { select: { name: true } } },
      orderBy: { paidAt: "desc" }, take: LIMIT,
    }),
    loadArticleList(orgId),
    prisma.supplier.findMany({ where: { organizationId: orgId, name: like() }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: LIMIT }),
    prisma.client.findMany({ where: { organizationId: orgId, name: like() }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: LIMIT }),
    prisma.shipment.findMany({ where: { organizationId: orgId, name: like() }, select: { id: true, name: true, plannedDate: true, supplier: { select: { name: true } } }, orderBy: { plannedDate: "desc" }, take: LIMIT }),
  ]);

  // PLU артикула (внутренний код заказчика, свойство «PLU»): находим и по нему.
  const pluIds = pluMatchIds(await loadAllArticleParams(prisma, orgId), q);
  const pluModels = pluIds.length ? await prisma.productModel.findMany({ where: { organizationId: orgId, id: { in: pluIds.slice(0, LIMIT) } }, select: { id: true, name: true, category: true } }) : [];
  const articleHits = searchArticleList(articleList, q, LIMIT).map((h) => ({ href: `/models/${h.article.id}`, title: h.article.name, sub: [h.article.salesCode && `в продажах ${h.article.salesCode}`, h.article.category].filter(Boolean).join(" · ") }));
  for (const m of pluModels) if (!articleHits.some((x) => x.href === `/models/${m.id}`)) articleHits.push({ href: `/models/${m.id}`, title: m.name, sub: ["PLU", m.category].filter(Boolean).join(" · ") });

  const payItems = [
    ...pays.map((p) => ({ at: p.paidAt, item: { href: `/payments/${paymentCode("raw", p.id)}`, title: `${ruDate(p.paidAt)} · ${money(p.amount)}`, sub: [p.supplier.name, p.ppNo && `п/п ${p.ppNo}`, p.invoiceNo && `счёт ${p.invoiceNo}`].filter(Boolean).join(" · ") } })),
    ...prodPays.map((p) => ({ at: p.paidAt, item: { href: `/payments/${paymentCode("prod", p.id)}`, title: `${ruDate(p.paidAt)} · ${money(p.amount)}`, sub: [p.client?.name, p.ppNo && `п/п ${p.ppNo}`, p.invoiceNo && `счёт ${p.invoiceNo}`].filter(Boolean).join(" · ") } })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, LIMIT).map((x) => x.item);

  const groups: Group[] = [
    {
      key: "tz", label: "ТЗ", all: `/production?q=${enc}`,
      items: orders.map((o) => ({ href: `/production/${o.id}`, title: o.workOrderNumber ? `ТЗ ${o.workOrderNumber}` : `Заказ ${o.number}`, sub: [o.workOrderNumber && `заказ ${o.number}`, o.productModel.name, o.client?.name].filter(Boolean).join(" · ") })),
    },
    {
      key: "lots", label: "Лоты", all: `/analytics/raw?q=${enc}`,
      items: lots.map((l) => ({ href: `/analytics/raw/lot/${l.id}`, title: `Лот ${l.lotNumber}`, sub: [l.rawMaterial.name, l.grade].filter(Boolean).join(" · ") })),
    },
    {
      key: "purchases", label: "Закупки", all: `/purchases?q=${enc}`,
      items: purchases.map((p) => ({ href: `/purchases/${p.id}`, title: `Закупка ${p.number}`, sub: [ruDate(p.orderDate), p.supplier.name, p.invoiceNumber && `счёт ${p.invoiceNumber}`, p.transferDocument && `УПД ${p.transferDocument}`].filter(Boolean).join(" · ") })),
    },
    { key: "payments", label: "Оплаты", all: `/payments?rq=${enc}`, items: payItems },
    {
      key: "articles", label: "Артикулы", all: `/articles?q=${enc}`,
      items: articleHits.slice(0, LIMIT),
    },
    {
      key: "shipments", label: "Отгрузки", all: `/shipments?q=${enc}`,
      items: shipments.map((s) => ({ href: `/shipments/${s.id}`, title: s.name ?? `Отгрузка на ${ruDate(s.plannedDate)}`, sub: [ruDate(s.plannedDate), s.supplier?.name].filter(Boolean).join(" · ") })),
    },
    {
      key: "counterparties", label: "Контрагенты", all: `/suppliers?q=${enc}`,
      items: [
        ...suppliers.map((s) => ({ href: `/suppliers/${s.id}`, title: s.name, sub: "поставщик" })),
        ...clients.map((c) => ({ href: `/clients/${c.id}`, title: c.name, sub: "заказчик" })),
      ].slice(0, LIMIT),
    },
  ];
  return Response.json({ q, groups: groups.filter((g) => g.items.length > 0) }, { headers });
}
