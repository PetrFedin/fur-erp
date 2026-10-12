import Link from "next/link";
import { Decimal } from "@prisma/client/runtime/library";
import { requireSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { InfoHint } from "@/components/info-hint";
import { YearNote } from "@/components/year-note";
import { Money } from "@/components/money";
import { Ref4, Mode4Badge } from "@/components/c4-note";
import { formatQty } from "@/lib/utils";
import { ageText, buildRecon, loadRawData, lotBalances, type RawLot } from "@/lib/raw-analytics";
import rawAudit from "@/data/raw-audit-2026-02-09.json";

export const metadata = { title: "Сверка лотов" };

const q2 = (d: Decimal) => d.toFixed(2);
const unitOf = (l: RawLot) => (l.unit === "M" ? "м" : "шт.");
const qty = (d: Decimal, l: RawLot) => `${formatQty(d.toString())} ${unitOf(l)}`;
const name = (l: RawLot) => (l.unit === "M" ? `${l.materialName}${l.lotNumber === "Без номера" ? "" : ` · ${l.lotNumber}`}` : l.lotNumber);

function LotLink({ l }: { l: RawLot }) {
  return (
    <Link href={`/analytics/raw/lot/${l.id}`} className="underline">
      {name(l)}
    </Link>
  );
}

export default async function ReconPage() {
  const session = await requireSession();
  const year = await getYearFilter();
  const c4 = await getCommission4Mode();
  const data = await loadRawData(session.user.organizationId, year);
  const { mismatch, dormant, over } = buildRecon(data.lots);
  const lotByNumber = new Map(data.lots.map((l) => [l.lotNumber, l]));
  const auditRows = rawAudit.rows.map((r) => ({ ...r, lotRecord: lotByNumber.get(r.lot) ?? null }));
  const auditOpen = auditRows.filter((r) => r.delta !== 0).length;
  const dormantIncl = dormant.reduce((s, x) => s.add(x.remIncl), new Decimal(0));
  const dormantExcl = dormant.reduce((s, x) => s.add(x.remExcl), new Decimal(0));
  const exp = (part: string) => `/analytics/raw/recon/export?part=${part}`;
  const csv = (part: string) => (
    <a href={exp(part)} className={buttonVariants({ variant: "outline", size: "sm" })}>CSV</a>
  );
  const badge = (n: number) => (
    <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + (n === 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>{n === 0 ? "всё в порядке" : n}</span>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm"><Link href="/analytics/raw" className="text-neutral-500 hover:underline">← Аналитика сырья</Link></div>
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Сверка лотов</h1><YearNote year={year} />
        <Mode4Badge mode={c4} />
        <InfoHint label="О сверке" wide>
          <p>Проверка качества учёта по всем лотам выбранного года (мех и подкладка): сходятся ли журнал движений, сам лот и списания в ТЗ; какие лоты купили, но не использовали; где использовано больше, чем куплено.</p>
          <p className="mt-1">Год — общий, из шапки (по дате закупки лота). Всего лотов в проверке: {data.lots.length}.</p>
        </InfoHint></div>

      {/* Расхождения */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Учёт ≠ лот ≠ Σ ТЗ {badge(mismatch.length)}
            <InfoHint label="Расхождения" wide>
              <p>У лота три остатка: по журналу движений, по самому лоту и «получено − списано в ТЗ». Лот попадает сюда, если они не равны, или не равны приход/списания по журналу и по лоту, или количество в закупке.</p>
            </InfoHint>
            <span className="ml-auto">{csv("mismatch")}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mismatch.length === 0 ? (
            <p className="text-sm text-emerald-700">Расхождений нет: у всех {data.lots.length} лотов журнал движений, лот и списания ТЗ сходятся.</p>
          ) : (
            <ResponsiveRows
              table={
                <Table>
                  <Thead>
                    <Tr><Th>Лот</Th><Th className="text-right">В учёте (журнал)</Th><Th className="text-right">По лоту</Th><Th className="text-right">Получено − ТЗ</Th><Th>Что не сходится</Th></Tr>
                  </Thead>
                  <Tbody>
                    {mismatch.map(({ lot: l, issues }) => {
                      const b = lotBalances(l);
                      return (
                        <Tr key={l.id}>
                          <Td><LotLink l={l} /><span className="block text-xs text-neutral-500">{l.auctionLabel} · {l.year}</span></Td>
                          <Td className="text-right tabular-nums">{qty(b.journal, l)}</Td>
                          <Td className="text-right tabular-nums">{qty(b.lot, l)}</Td>
                          <Td className="text-right tabular-nums">{qty(b.calc, l)}</Td>
                          <Td className="text-red-700">{issues.join("; ")}</Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              }
            >
              {mismatch.map(({ lot: l, issues }) => {
                const b = lotBalances(l);
                return (
                  <RowCard key={l.id} title={name(l)} href={`/analytics/raw/lot/${l.id}`} subtitle={`${l.auctionLabel} · ${l.year}`}
                    fields={[
                      { label: "В учёте", value: qty(b.journal, l) },
                      { label: "По лоту", value: qty(b.lot, l) },
                      { label: "Получено − ТЗ", value: qty(b.calc, l) },
                    ]}
                    extra={<p className="mt-2 text-xs text-red-700">{issues.join("; ")}</p>}
                  />
                );
              })}
            </ResponsiveRows>
          )}
        </CardContent>
      </Card>

      {/* Историческая сверка из Drive */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Контроль по «Анализ остатков сырья.xlsx» {badge(auditOpen)}
            <InfoHint label="Что это" wide>
              <p>Исторический контрольный файл из папки «Мех», изменён 09.02.2026. Он сопоставляет закупленное количество, расход по перечисленным ТЗ и остаток в производственном файле.</p>
              <p className="mt-1">Δ = остаток в производственном файле − остаток по ТЗ. Ненулевой Δ не исправляется автоматически: нужно найти недостающий ТЗ/списание либо подтвердить, что производственный файл был неполным.</p>
              <p className="mt-1 text-neutral-500">Текущий остаток ERP показан отдельно, потому что после 09.02.2026 были новые списания.</p>
            </InfoHint>
            <a
              href="https://docs.google.com/spreadsheets/d/1l3sj71hz5gWEdTWiNgReifzovmfJBDhb/edit"
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-xs font-medium text-blue-700 underline"
            >
              Открыть исходный файл ↗
            </a>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveRows
            table={
              <Table>
                <Thead>
                  <Tr>
                    <Th>Лот</Th>
                    <Th className="text-right">Закуплено</Th>
                    <Th className="text-right">Расход по ТЗ</Th>
                    <Th className="text-right">Остаток по ТЗ</Th>
                    <Th className="text-right">Остаток в файле</Th>
                    <Th className="text-right">Δ</Th>
                    <Th className="text-right">Сейчас ERP</Th>
                    <Th>Контроль</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {auditRows.map((r) => (
                    <Tr key={r.lot}>
                      <Td className="font-medium">{r.lotRecord ? <LotLink l={r.lotRecord} /> : r.lot}</Td>
                      <Td className="text-right tabular-nums">{formatQty(String(r.purchased))} шт.</Td>
                      <Td className="text-right tabular-nums">{formatQty(String(r.usedByTz))} шт.</Td>
                      <Td className="text-right tabular-nums">{formatQty(String(r.expectedByTz))} шт.</Td>
                      <Td className="text-right tabular-nums">{formatQty(String(r.productionFileRemaining))} шт.</Td>
                      <Td className={"text-right font-semibold tabular-nums " + (r.delta === 0 ? "text-emerald-700" : "text-red-700")}>
                        {r.delta > 0 ? "+" : ""}{formatQty(String(r.delta))} шт.
                      </Td>
                      <Td className="text-right tabular-nums">{r.lotRecord ? qty(r.lotRecord.rem, r.lotRecord) : <span className="text-red-700">лот не найден</span>}</Td>
                      <Td className="max-w-[22rem] text-xs text-neutral-600">
                        {r.delta < 0
                          ? `В производственном файле списано на ${formatQty(String(Math.abs(r.delta)))} шт. больше, чем объясняют перечисленные ТЗ — нужен источник списания.`
                          : r.delta > 0
                            ? `По ТЗ должно быть на ${formatQty(String(r.delta))} шт. меньше остатка — нужно проверить, почему расход не отражён в производственном файле.`
                            : "Историческая строка сходится."}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            }
          >
            {auditRows.map((r) => (
              <RowCard
                key={r.lot}
                title={r.lot}
                href={r.lotRecord ? `/analytics/raw/lot/${r.lotRecord.id}` : undefined}
                subtitle={r.delta === 0 ? "Сходится" : `Исторический разрыв ${r.delta > 0 ? "+" : ""}${formatQty(String(r.delta))} шт.`}
                fields={[
                  { label: "Закуплено", value: `${formatQty(String(r.purchased))} шт.` },
                  { label: "Остаток по ТЗ", value: `${formatQty(String(r.expectedByTz))} шт.` },
                  { label: "В файле", value: `${formatQty(String(r.productionFileRemaining))} шт.` },
                  { label: "Сейчас ERP", value: r.lotRecord ? qty(r.lotRecord.rem, r.lotRecord) : "лот не найден" },
                ]}
                extra={
                  r.delta !== 0 ? (
                    <p className="mt-2 text-xs text-red-700">
                      {r.delta < 0
                        ? `Не объяснено ТЗ: дополнительное списание ${formatQty(String(Math.abs(r.delta)))} шт.`
                        : `Не отражено в производственном файле: ${formatQty(String(r.delta))} шт.`}
                    </p>
                  ) : null
                }
              />
            ))}
          </ResponsiveRows>
        </CardContent>
      </Card>

      {/* Не использованы */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Куплены, но ни разу не использованы {badge(dormant.length)}
            <InfoHint label="Лежат без движения" wide>
              <p>Лоты с остатком, по которым нет ни одного списания в ТЗ. «Лежит» — со дня закупки (дата заказа закупки; если её нет — дата прихода). Сверху самые давние.</p>
              {dormant.length > 0 && <p className="mt-1">Сейчас: {dormant.length} лотов на {formatQty(dormantIncl.toFixed(2))} ₽ с НДС ({formatQty(dormantExcl.toFixed(2))} ₽ без НДС).</p>}
            </InfoHint>
            <span className="ml-auto">{csv("dormant")}</span>
          </CardTitle>
          {dormant.length > 0 && (
            <div className="text-sm text-neutral-600">Всего: <b>{dormant.length}</b> лотов, стоимость остатка <Money incl={q2(dormantIncl)} excl={q2(dormantExcl)} /><Ref4 mode={c4} incl={q2(dormantIncl)} excl={q2(dormantExcl)} /></div>
          )}
        </CardHeader>
        <CardContent>
          {dormant.length === 0 ? (
            <p className="text-sm text-emerald-700">Все купленные лоты хоть раз использованы.</p>
          ) : (
            <ResponsiveRows
              table={
                <Table>
                  <Thead>
                    <Tr><Th>Лот</Th><Th>Что</Th><Th>Аукцион</Th><Th>Лежит</Th><Th className="text-right">Остаток</Th><Th className="text-right">Стоимость остатка</Th></Tr>
                  </Thead>
                  <Tbody>
                    {dormant.map(({ lot: l, days, remIncl, remExcl }) => (
                      <Tr key={l.id}>
                        <Td><LotLink l={l} /></Td>
                        <Td className="text-xs">{l.unit === "M" ? "Подкладка" : l.kind} · {l.cat}</Td>
                        <Td className="text-xs">{l.auctionLabel} · {l.year}</Td>
                        <Td className="whitespace-nowrap">{ageText(days)}</Td>
                        <Td className="text-right tabular-nums">{qty(l.rem, l)}</Td>
                        <Td className="text-right tabular-nums"><Money incl={q2(remIncl)} excl={q2(remExcl)} /><Ref4 mode={c4} incl={q2(remIncl)} excl={q2(remExcl)} /></Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              }
            >
              {dormant.map(({ lot: l, days, remIncl, remExcl }) => (
                <RowCard key={l.id} title={name(l)} href={`/analytics/raw/lot/${l.id}`} subtitle={`${l.unit === "M" ? "Подкладка" : l.kind} · ${l.cat} · ${l.auctionLabel} · ${l.year}`}
                  fields={[
                    { label: "Лежит", value: ageText(days) },
                    { label: "Остаток", value: qty(l.rem, l) },
                    { label: "Стоимость", value: <><Money incl={q2(remIncl)} excl={q2(remExcl)} /><Ref4 mode={c4} incl={q2(remIncl)} excl={q2(remExcl)} /></> },
                  ]}
                />
              ))}
            </ResponsiveRows>
          )}
        </CardContent>
      </Card>

      {/* Использовано больше */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Использовано больше, чем куплено {badge(over.length)}
            <InfoHint label="Перерасход" wide>
              <p>Лоты, у которых сумма списаний в ТЗ больше полученного количества. Так быть не должно: значит, лот или списание записаны с ошибкой.</p>
            </InfoHint>
            <span className="ml-auto">{csv("over")}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {over.length === 0 ? (
            <p className="text-sm text-emerald-700">Перерасхода нет: ни один лот не использован больше, чем получен.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {over.map(({ lot: l, excess }) => (
                <li key={l.id}>
                  <LotLink l={l} /> — получено {qty(l.recv, l)}, использовано {qty(l.used, l)}, превышение <b className="text-red-700">{qty(excess, l)}</b>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
