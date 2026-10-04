import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { loadTzDoc, type TzLine } from "@/lib/tz-print";
import { parseCommission4Cookie } from "@/lib/commission4-mode";
import { parseVatModeCookie } from "@/lib/vat-mode";
import { PrintToolbar } from "../../../print-toolbar";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Печать ТЗ ${id.slice(-6)}` };
}

const th = "border border-neutral-700 px-2 py-1 text-left font-semibold bg-neutral-100";
const td = "border border-neutral-700 px-2 py-1 align-top";
const tdr = td + " text-right whitespace-nowrap";

function LotTable({ title, rows, total }: { title: string; rows: TzLine[]; total: string }) {
  return (
    <section className="keep-together mt-5">
      <h2 className="mb-1 text-sm font-semibold">{title}</h2>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className={th}>Лот</th>
            <th className={th}>Материал</th>
            <th className={th + " text-right"}>Кол-во</th>
            <th className={th + " text-right"}>Цена за ед.</th>
            <th className={th + " text-right"}>Сумма</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className={td}>{r.lot}</td>
              <td className={td}>{r.material}</td>
              <td className={tdr}>{r.qty}</td>
              <td className={tdr}>{r.unitPrice}</td>
              <td className={tdr}>{r.sum}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className={td + " text-center"} colSpan={5}>
                —
              </td>
            </tr>
          )}
          <tr>
            <td className={td + " font-semibold"} colSpan={4}>
              Итого
            </td>
            <td className={tdr + " font-semibold"}>{total}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

export default async function TzPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ c4?: string; vat?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await requireSession();
  const store = await cookies();
  const c4Mode = parseCommission4Cookie(sp.c4 ?? store.get("commission4Display")?.value);
  const vatMode = parseVatModeCookie(sp.vat ?? store.get("vatDisplay")?.value);
  const d = await loadTzDoc(id, session.user.organizationId, c4Mode, vatMode);
  if (!d) notFound();

  const q = (c4: string, vat: string) => `/production/${id}/print?c4=${c4}&vat=${vat}`;
  const vatNote = vatMode === "excl" ? "без НДС" : "с НДС";
  const c4Note = d.c4Applied ? ", с учётом 4%" : "";

  return (
    <>
      <PrintToolbar
        backHref={`/production/${id}`}
        docxHref={`/api/production/${id}/docx?c4=${c4Mode}&vat=${vatMode}`}
        switches={[
          { label: "Без 4%", href: q("off", vatMode), active: c4Mode === "off" },
          { label: "С 4%", href: q("on", vatMode), active: c4Mode === "on" },
          { label: "С НДС", href: q(c4Mode, "incl"), active: vatMode === "incl" },
          { label: "Без НДС", href: q(c4Mode, "excl"), active: vatMode === "excl" },
        ]}
      />
      <article className="print-sheet mx-auto my-4 w-[210mm] max-w-full bg-white p-[15mm] text-[13px] leading-snug text-black shadow">
        <h1 className="text-center text-base font-bold">{d.title}</h1>
        <p className="mt-1 text-center text-sm">к {d.contract}</p>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-neutral-600">Заказчик</dt>
          <dd className="font-medium">{d.customer || "—"}</dd>
          <dt className="text-neutral-600">Партия</dt>
          <dd>{d.batch || "—"}</dd>
          <dt className="text-neutral-600">Дата ТЗ</dt>
          <dd>{d.date || "—"}</dd>
          <dt className="text-neutral-600">Заказ (внутр.)</dt>
          <dd>{d.orderNumber}</dd>
          {d.material && (
            <>
              <dt className="text-neutral-600">Материал</dt>
              <dd>{d.material}</dd>
            </>
          )}
        </dl>

        <section className="keep-together mt-5">
          <h2 className="mb-1 text-sm font-semibold">Изделия</h2>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={th}>Модель</th>
                <th className={th}>Цвет</th>
                <th className={th}>Размеры</th>
                <th className={th + " text-right"}>Кол-во, шт.</th>
                <th className={th + " text-right"}>Работа за ед.</th>
                <th className={th + " text-right"}>Сумма работы</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={td}>{d.model}</td>
                <td className={td}>{d.color || "—"}</td>
                <td className={td}>{d.size || "—"}</td>
                <td className={tdr}>{d.qty}</td>
                <td className={tdr}>{d.workPerUnit}</td>
                <td className={tdr}>{d.workSum}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <LotTable title={`Сырьё по лотам (${vatNote}${c4Note})`} rows={d.fur} total={d.totals.fur} />

        {d.hasLining && (
          <>
            {d.liningText && <p className="mt-4 text-sm">Подкладка по ТЗ: {d.liningText}</p>}
            {d.lining.length > 0 && <LotTable title={`Подкладка (${vatNote}${c4Note})`} rows={d.lining} total={d.totals.lining} />}
          </>
        )}

        {d.expenses.length > 0 && (
          <section className="keep-together mt-5">
            <h2 className="mb-1 text-sm font-semibold">Расходы</h2>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className={th}>Статья</th>
                  <th className={th}>Описание</th>
                  <th className={th + " text-right"}>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {d.expenses.map((e, i) => (
                  <tr key={i}>
                    <td className={td}>{e.name}</td>
                    <td className={td}>{e.description || "—"}</td>
                    <td className={tdr}>{e.sum}</td>
                  </tr>
                ))}
                <tr>
                  <td className={td + " font-semibold"} colSpan={2}>
                    Итого
                  </td>
                  <td className={tdr + " font-semibold"}>{d.totals.expenses}</td>
                </tr>
              </tbody>
            </table>
          </section>
        )}

        <section className="keep-together mt-5">
          <h2 className="mb-1 text-sm font-semibold">Итоги</h2>
          <table className="ml-auto w-[60%] border-collapse text-xs">
            <tbody>
              <tr>
                <td className={td}>Сырьё</td>
                <td className={tdr}>{d.totals.fur}</td>
              </tr>
              {d.lining.length > 0 && (
                <tr>
                  <td className={td}>Подкладка</td>
                  <td className={tdr}>{d.totals.lining}</td>
                </tr>
              )}
              {d.expenses.length > 0 && (
                <tr>
                  <td className={td}>Расходы</td>
                  <td className={tdr}>{d.totals.expenses}</td>
                </tr>
              )}
              <tr>
                <td className={td}>Работа</td>
                <td className={tdr}>{d.totals.work}</td>
              </tr>
              <tr>
                <td className={td + " font-bold"}>Всего</td>
                <td className={tdr + " font-bold"}>{d.totals.total}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-right text-[11px] text-neutral-600">Суммы {vatNote}{c4Note}. {d.vatRatesNote}</p>
        </section>

        <section className="keep-together mt-10 grid grid-cols-2 gap-10 text-sm">
          <div>
            <p className="font-semibold">Заказчик</p>
            <p className="min-h-5">{d.customer}</p>
            <p className="mt-8 border-b border-black" />
            <p className="mt-1 text-[11px] text-neutral-600">подпись / М.П.</p>
          </div>
          <div>
            <p className="font-semibold">Исполнитель</p>
            <p className="min-h-5">&nbsp;</p>
            <p className="mt-8 border-b border-black" />
            <p className="mt-1 text-[11px] text-neutral-600">подпись / М.П.</p>
          </div>
        </section>
      </article>
    </>
  );
}
