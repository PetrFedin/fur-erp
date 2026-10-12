import Link from "next/link";
import { InfoHint } from "@/components/info-hint";
import { STAGE_ORDER, STAGE_STYLES, type Stage } from "@/lib/calendar-actions";
import { fmtRu } from "@/lib/calendar-grid";
import { pipeTitle, type PipeItem } from "@/lib/calendar-pipeline";
import { NO_DATE, buildMonthGrid, gridCellItems, inScope, monthText, sumOf, unitsFor, type StageSums, type TableFilters } from "@/lib/calendar-table";
import { formatQty } from "@/lib/utils";
import { PipeRow } from "./pipe-views";

type HrefFn = (patch: Record<string, string | string[]>) => string;

const COL_W = 88;
const GANTT_AUTO_LIMIT = 180;
const GANTT_PAGE = 60;

const pill = (on: boolean) =>
  `inline-flex min-h-10 items-center rounded-md border px-4 text-sm font-medium ${on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"}`;

const stageTitle = (s: StageSums) => STAGE_ORDER.filter((k) => s[k] > 0).map((k) => `${STAGE_STYLES[k].label}: ${s[k]} шт.`).join("\n");

function Legend({ grand }: { grand: StageSums }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Стадии">
      {STAGE_ORDER.map((k) => (
        <span key={k} title={STAGE_STYLES[k].hint} className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm ${STAGE_STYLES[k].chip}`}>
          <i className={`size-2.5 rounded-full ${STAGE_STYLES[k].dot}`} />{STAGE_STYLES[k].label} <b className="tabular-nums">{formatQty(grand[k])}</b>
        </span>
      ))}
    </div>
  );
}

/**
 * «По месяцам»: выбор года и вида (Таблица / График) внутри режима, итоги и легенда один раз, затем таблица «мех × месяцы» или лента Ганта.
 * Выбор — в адресе: my=2025|2026|all, mv=table|gantt, cell=«месяц~мех» (раскрытая ячейка).
 */
export function MonthsMode({ items, filters, my, years, mv, href, cell, cardHref, today, gall, gpage }: {
  items: PipeItem[]; filters: TableFilters; my: string; years: string[]; mv: "table" | "gantt"; href: HrefFn; cell: string;
  cardHref: (id: string) => string; today: string; gall: boolean; gpage: number;
}) {
  const grid = buildMonthGrid(items, filters, my);
  const prod = sumOf(grid.grand, false);
  const myTitle = my === "all" ? "за все годы" : `за ${my} год`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Год">
          <span className="text-sm text-neutral-600">Год:</span>
          {years.map((y) => <Link key={y} href={href({ my: y, cell: "", gp: "" })} className={pill(my === y)} aria-current={my === y ? "page" : undefined}>{y}</Link>)}
          <Link href={href({ my: "all", cell: "", gp: "" })} className={pill(my === "all")} aria-current={my === "all" ? "page" : undefined}>Все ({years.length > 1 ? `месяцы подряд ${years[0]}→${years[years.length - 1]}` : "месяцы подряд"})</Link>
          <span className="mx-1 hidden h-6 w-px bg-neutral-300 sm:block" />
          <span className="flex gap-1" role="group" aria-label="Вид">
            <Link href={href({ mv: "", cell: "", gp: "" })} className={pill(mv === "table")} aria-current={mv === "table" ? "page" : undefined}>Таблица</Link>
            <Link href={href({ mv: "gantt", cell: "", gp: "" })} className={pill(mv === "gantt")} aria-current={mv === "gantt" ? "page" : undefined}>График</Link>
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div className="text-sm text-neutral-600">Произведено {myTitle}: <b className="text-2xl font-semibold tabular-nums text-neutral-900">{formatQty(prod)}</b> шт.</div>
          {grand0(grid.grand.repair) && <div className="text-sm italic text-rose-700">Ремонт отдельно: <b className="tabular-nums">{formatQty(grid.grand.repair)}</b> шт.</div>}
          <InfoHint wide>
            Чтобы понять, что где: выберите год (или «Все» — месяцы идут подряд), строки — виды меха, столбцы — месяцы. У каждого меха крупно — «Всего по плану» (все изделия ТЗ месяца без ремонта; цвет фона — чем больше, тем темнее), ниже словами: Готово, В работе, План и т.д.; ремонт — отдельной строкой и в «Всего» не входит.
            Месяц — по плановой дате окончания ТЗ, иначе по дате ТЗ или старта; ТЗ без дат — в столбце «Без даты». «Произведено» — все ТЗ без отменённых и без ремонта (как на Главной за тот же год); ремонт считается отдельно. Нажмите ячейку, заголовок месяца или название меха — ниже раскроются ТЗ с ожидаемой датой и источником даты.
            Число изделий — в штуках; количество шкур в данных ТЗ отдельно не хранится, поэтому переключателя «шкуры» нет.
          </InfoHint>
        </div>
        <Legend grand={grid.grand} />
      </div>

      {grid.rows.length === 0 && <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500">Нет данных по выбранным фильтрам{my !== "all" ? ` (год ${my})` : ""}.</p>}

      {grid.rows.length > 0 && (mv === "table"
        ? <MonthTable items={items} filters={filters} my={my} href={href} cell={cell} cardHref={cardHref} />
        : <MonthGantt items={items} filters={filters} my={my} href={href} cardHref={cardHref} today={today} gall={gall} gpage={gpage} />)}
    </div>
  );
}

const grand0 = (n: number) => n > 0;

function MonthTable({ items, filters, my, href, cell, cardHref }: {
  items: PipeItem[]; filters: TableFilters; my: string; href: HrefFn; cell: string; cardHref: (id: string) => string;
}) {
  const t = buildMonthGrid(items, filters, my);
  const [cCol, cFur] = cell.includes("~") ? cell.split("~") : ["", ""];
  const link = (col: string, fur: string) => href({ cell: `${col}~${fur}` }) + "#cell";
  const max = Math.max(1, ...t.rows.flatMap((r) => t.cols.map((c) => (r.cells[c] ? sumOf(r.cells[c], false) : 0))));
  const open = cCol && cFur ? gridCellItems(items, filters, my, cCol, cFur) : [];
  const heat = (v: number) => ({ backgroundColor: `rgba(37, 99, 235, ${(0.04 + 0.36 * (v / max)).toFixed(3)})` });
  const stages = STAGE_ORDER.filter((k) => k !== "repair" && t.grand[k] > 0);
  const hasRepair = t.grand.repair > 0;
  const LBL = "sticky left-0 z-10 w-40 min-w-40 border-r border-neutral-200";
  const hd = "px-1 py-1.5 text-center text-xs font-medium text-neutral-700";
  const num = (v: number) => (v > 0 ? formatQty(v) : <span className="text-neutral-300">—</span>);
  /** Блок вида меха (или «Всего, шт.»): «Всего по плану» крупно + строки стадий словами. */
  const block = ({ title, fur, cells, total, grand }: { title: string; fur: string; cells: (c: string) => StageSums | undefined; total: StageSums; grand?: boolean }) => {
    const bg = grand ? "bg-[var(--ui-soft)]" : "bg-white";
    const cellsAll = [...t.cols.map((c) => ({ c, s: cells(c) })), { c: "*", s: total }];
    return (
      <tbody key={fur} className={grand ? "border-t-2 border-[var(--ui-accent)] text-[var(--ui-accent-text)]" : ""}>
        <tr className="border-t border-neutral-300">
          <th scope="row" className={`${LBL} ${bg} p-0 text-left`}>
            <Link href={link("*", fur)} title="Показать ТЗ за все месяцы" className="block px-2 py-2 hover:underline"><span className="block text-sm font-semibold">{title}</span><span className="block text-xs font-normal text-neutral-600">Всего по плану, шт.</span></Link>
          </th>
          {cellsAll.map(({ c, s }) => {
            const v = s ? sumOf(s, false) : 0;
            const on = cCol === c && cFur === fur;
            const tot = c === "*";
            return (
              <td key={c} className={`p-0 ${tot ? "border-l border-neutral-300 bg-neutral-100" : ""}`} style={tot || v === 0 ? undefined : heat(v)}>
                {v > 0 ? (
                  <Link href={on ? href({ cell: "" }) : link(c, fur)} title={s ? stageTitle(s) : ""} aria-expanded={on} className={`flex min-h-12 items-center justify-center text-lg font-semibold tabular-nums hover:ring-2 hover:ring-inset hover:ring-neutral-900 ${on ? "ring-2 ring-inset ring-neutral-900" : ""}`}>{formatQty(v)}</Link>
                ) : <span className="flex min-h-12 items-center justify-center text-neutral-300">—</span>}
              </td>
            );
          })}
        </tr>
        {stages.map((k) => (
          <tr key={k}>
            <th scope="row" className={`${LBL} ${bg} py-0.5 pl-5 pr-2 text-left text-xs font-medium ${STAGE_STYLES[k].text}`}><i className={`mr-1.5 inline-block size-2 rounded-full align-middle ${STAGE_STYLES[k].dot}`} />{STAGE_STYLES[k].label}</th>
            {cellsAll.map(({ c, s }) => <td key={c} className={`px-1 py-0.5 text-center text-sm tabular-nums ${c === "*" ? "border-l border-neutral-300 bg-neutral-100 font-medium" : ""} ${STAGE_STYLES[k].text}`}>{num(s?.[k] ?? 0)}</td>)}
          </tr>
        ))}
        {hasRepair && total.repair > 0 && (
          <tr>
            <th scope="row" className={`${LBL} ${bg} py-0.5 pl-5 pr-2 text-left text-xs font-medium italic text-rose-700`}><i className="mr-1.5 inline-block size-2 rounded-full bg-rose-500 align-middle" />Ремонт (отдельно)</th>
            {cellsAll.map(({ c, s }) => <td key={c} className={`px-1 py-0.5 text-center text-sm italic tabular-nums text-rose-700 ${c === "*" ? "border-l border-neutral-300 bg-neutral-100" : ""}`}>{num(s?.repair ?? 0)}</td>)}
          </tr>
        )}
      </tbody>
    );
  };
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-xs text-neutral-500">Таблица прокручивается вправо и вниз внутри рамки — листайте <span aria-hidden>→</span>. Названия строк и шапка с месяцами остаются на месте. Нажмите число, месяц или название меха — ниже раскроются ТЗ.</p>
      <div className="max-h-[75vh] max-w-full overflow-auto rounded-lg border border-neutral-200 bg-white">
        <table className="border-separate border-spacing-0 text-sm" style={{ minWidth: 160 + (t.cols.length + 1) * COL_W }}>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 w-40 min-w-40 border-b border-r border-neutral-200 bg-neutral-50 px-2 py-1.5 text-left text-xs font-medium text-neutral-600">Вид меха / стадия</th>
              {t.cols.map((c) => (
                <th key={c} className="sticky top-0 z-20 border-b border-neutral-200 bg-neutral-50 p-0" style={{ minWidth: COL_W }}>
                  <Link href={link(c, "*")} title="Показать все ТЗ месяца" className={`${hd} block hover:underline ${cCol === c && cFur === "*" ? "bg-neutral-200" : ""}`}>
                    {c === NO_DATE ? "Без даты" : <>{monthText(c).split(" ")[0]}<span className="block text-neutral-500">{monthText(c).split(" ")[1]}</span></>}
                  </Link>
                </th>
              ))}
              <th className="sticky top-0 z-20 border-b border-l border-neutral-300 bg-neutral-100 p-0" style={{ minWidth: COL_W }}>
                <Link href={link("*", "*")} className={`${hd} block hover:underline`}>Всего, шт.</Link>
              </th>
            </tr>
          </thead>
          {t.rows.map((r) => block({ title: r.fur, fur: r.fur, cells: (c) => r.cells[c], total: r.total }))}
          {block({ title: "Всего, шт.", fur: "*", cells: (c) => t.colTotals[c], total: t.grand, grand: true })}
        </table>
      </div>
      {open.length > 0 && (
        <div id="cell" className="flex scroll-mt-4 flex-col gap-1.5 rounded-lg border border-neutral-300 bg-neutral-50 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-neutral-800">
            {cCol === "*" ? "Все месяцы" : monthText(cCol, true)} · {cFur === "*" ? "все виды меха" : cFur}
            <span className="font-normal text-neutral-600">{open.length} ТЗ · {formatQty(open.reduce((a, p) => a + sumOf(p.units as StageSums, false), 0))} шт.</span>
            <Link href={href({ cell: "" })} className="ml-auto text-xs font-normal text-neutral-500 hover:underline">Свернуть</Link>
          </div>
          {open.map((p) => <PipeRow key={p.id} p={p} cardHref={cardHref(p.id)} />)}
        </div>
      )}
    </div>
  );
}

// ───── График (лента Ганта) ─────
const dayFrac = (date: string, cols: string[]): number | null => {
  const idx = cols.indexOf(date.slice(0, 7));
  if (idx < 0) return null;
  const [y, m, d] = date.split("-").map(Number);
  return (idx + (d - 1) / new Date(Date.UTC(y, m, 0)).getUTCDate()) / cols.length;
};
const clampFrac = (date: string, cols: string[]): number => {
  const f = dayFrac(date, cols);
  if (f != null) return f;
  return date.slice(0, 7) < cols[0] ? 0 : 1;
};
const BAR_DARK_TEXT: Stage[] = ["plan", "work"];

function MonthGantt({ items, filters, my, href, cardHref, today, gall, gpage }: {
  items: PipeItem[]; filters: TableFilters; my: string; href: HrefFn; cardHref: (id: string) => string; today: string; gall: boolean; gpage: number;
}) {
  const allRows = buildMonthGrid(items, filters, my);
  const total = allRows.rows.reduce((a, r) => a + r.items.length, 0);
  // Много ТЗ — по умолчанию только план / сырьё / в работе и страницы по 60, пока не нажато «Показать все».
  const auto = !gall && !filters.stage.length && total > GANTT_AUTO_LIMIT;
  const f = auto ? { ...filters, stage: ["plan", "raw", "work"] } : filters;
  const g = auto ? buildMonthGrid(items, f, my) : allRows;
  const cols = g.cols.filter((c) => c !== NO_DATE);
  const n = cols.length;
  const flat: { fur: string; p: PipeItem }[] = g.rows.flatMap((r) => [...r.items].sort((a, b) => a.articleLabel.localeCompare(b.articleLabel, "ru") || a.number.localeCompare(b.number)).map((p) => ({ fur: r.fur, p })));
  const dated = flat.filter(({ p }) => bounds(p) != null);
  const undated = flat.filter(({ p }) => bounds(p) == null);
  const pages = Math.max(1, Math.ceil(dated.length / GANTT_PAGE));
  const page = Math.min(Math.max(1, gpage), pages);
  const shown = gall ? dated : dated.slice((page - 1) * GANTT_PAGE, page * GANTT_PAGE);
  const paginated = !gall && dated.length > GANTT_PAGE;

  function bounds(p: PipeItem): { s: string; e: string; approx: boolean; why: string } | null {
    const s0 = p.startDate ?? p.workOrderDate;
    const e0 = p.expected?.date ?? p.endDate;
    if (!s0 && !e0) return null;
    const s = s0 ?? e0!;
    const e = e0 ?? s0!;
    const exactEnd = p.expected != null && (p.expected.source === "по плану ТЗ" || p.expected.source === "факт: окончание ТЗ");
    return { s: s < e ? s : e, e: s < e ? e : s, approx: !(s0 && e0 && exactEnd), why: !s0 || !e0 ? "одна из дат неизвестна" : exactEnd ? "" : `конец — ${p.expected?.source ?? "приблизительно"}` };
  }
  const todayF = dayFrac(today, cols);
  const grid = n > 0 ? { backgroundImage: "linear-gradient(to right, #e5e5e5 1px, transparent 1px)", backgroundSize: `${100 / n}% 100%` } : undefined;
  const LABEL = "w-40 sm:w-60 shrink-0";

  let lastFur = "";
  const rows: React.ReactNode[] = [];
  for (const { fur, p } of shown) {
    if (fur !== lastFur) {
      lastFur = fur;
      const fr = g.rows.find((r) => r.fur === fur)!;
      rows.push(
        <div key={`h-${fur}`} className="flex border-b border-neutral-200 bg-neutral-100">
          <div className={`sticky left-0 z-10 ${LABEL} border-r border-neutral-200 bg-neutral-100 px-2 py-1.5 text-sm font-semibold`}>{fur}</div>
          <div className="flex-1 px-2 py-1.5 text-xs text-neutral-600">{formatQty(sumOf(fr.total, false))} шт. · {fr.items.length} ТЗ</div>
        </div>,
      );
    }
    const b = bounds(p)!;
    const clipped = n > 0 && (b.e.slice(0, 7) < cols[0] || b.s.slice(0, 7) > cols[n - 1]);
    let l = n > 0 ? clampFrac(b.s, cols) : 0;
    let r = n > 0 ? clampFrac(b.e, cols) : 0;
    let approx = b.approx;
    if (clipped && p.bucket && cols.includes(p.bucket.slice(0, 7))) { const i = cols.indexOf(p.bucket.slice(0, 7)); l = i / n; r = (i + 1) / n; approx = true; }
    const dayW = 1 / (n * 30);
    if (r - l < dayW) r = l + dayW;
    const st = STAGE_STYLES[p.stage];
    const tip = `${pipeTitle(p)} · ${p.articleLabel} · ${formatQty(p.qty)} шт.\n${p.fur} · ${p.stageWord}\n${b.s === b.e ? fmtRu(b.s) : `${fmtRu(b.s)} → ${fmtRu(b.e)}`}${p.expected ? `\nОжидаем: ${fmtRu(p.expected.date)} (${p.expected.source})` : ""}${approx ? `\nДаты приблизительные${b.why ? `: ${b.why}` : ""}` : ""}${p.overdue ? "\nПросрочено" : ""}`;
    rows.push(
      <div key={p.id} className="flex border-b border-neutral-100">
        <div className={`sticky left-0 z-10 ${LABEL} truncate border-r border-neutral-200 bg-white px-2 py-1.5 text-xs`} title={`${pipeTitle(p)} · ${p.articleLabel} · ${formatQty(p.qty)} шт.`}>
          <span className="font-medium">{p.wo ? `№${p.wo}` : p.number}</span> · {p.articleLabel} · {formatQty(p.qty)} шт.
        </div>
        <div className="relative h-9 flex-1" style={{ ...grid, minWidth: n * COL_W }}>
          {todayF != null && <i className="absolute inset-y-0 z-[5] w-0.5 bg-red-500" style={{ left: `${todayF * 100}%` }} aria-hidden />}
          <Link href={cardHref(p.id)} title={tip}
            className={`absolute top-1.5 flex h-6 min-w-3.5 items-center overflow-hidden whitespace-nowrap rounded px-1 text-xs font-medium ${st.dot} ${BAR_DARK_TEXT.includes(p.stage) ? "text-neutral-900" : "text-white"} ${p.overdue ? "ring-2 ring-red-600 ring-offset-1" : ""}`}
            style={{ left: `${l * 100}%`, width: `${(r - l) * 100}%` }}>
            {approx ? "? " : ""}{st.short}
          </Link>
        </div>
      </div>,
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600">
        <span>Каждая строка — одно ТЗ; полоса от начала до окончания (цвет — стадия). «?» — даты приблизительные, красная рамка — просрочено, красная линия — сегодня. Листайте таблицу <span aria-hidden>→</span>, клик по полосе откроет карточку ТЗ.</span>
        <InfoHint wide>
          Начало полосы — дата старта (или дата ТЗ), конец — ожидаемая дата окончания (по плану ТЗ, событию календаря, поставке сырья или плану поставок; источник виден в подсказке при наведении). Если известна только одна дата, показана короткая отметка со знаком «?». ТЗ без дат собраны ниже в блоке «Без даты».
        </InfoHint>
      </div>
      {auto && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ТЗ много ({total}): показаны только «План», «Сырьё» и «В работе» — {flat.length}.
          <Link href={href({ gall: "1", gp: "" })} className="font-medium underline">Показать все {total}</Link>
        </div>
      )}
      <div className="max-h-[75vh] max-w-full overflow-auto rounded-lg border border-neutral-200 bg-white">
        <div style={{ minWidth: 240 + n * COL_W }} className="min-w-full">
          <div className="sticky top-0 z-20 flex border-b border-neutral-300 bg-neutral-50">
            <div className={`sticky left-0 z-30 ${LABEL} border-r border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs font-medium text-neutral-600`}>№ТЗ · артикул · шт.</div>
            <div className="flex flex-1" style={{ minWidth: n * COL_W }}>
              {cols.map((c) => (
                <div key={c} className="flex-1 border-l border-neutral-200 px-1 py-1.5 text-center text-xs font-medium text-neutral-700" style={{ minWidth: COL_W }}>
                  {monthText(c).split(" ")[0]}<span className="block text-neutral-500">{c.slice(0, 4)}</span>
                </div>
              ))}
            </div>
          </div>
          {rows}
          {shown.length === 0 && <p className="p-4 text-center text-sm text-neutral-500">Нет ТЗ с датами по выбранным фильтрам.</p>}
        </div>
      </div>
      {(paginated || (gall && dated.length > GANTT_PAGE)) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {paginated && <>
            {page > 1 ? <Link href={href({ gp: String(page - 1) })} className={pill(false)}>‹ Назад</Link> : null}
            <span className="text-neutral-600">Страница {page} из {pages} · ТЗ {formatQty((page - 1) * GANTT_PAGE + 1)}–{formatQty(Math.min(page * GANTT_PAGE, dated.length))} из {formatQty(dated.length)}</span>
            {page < pages ? <Link href={href({ gp: String(page + 1) })} className={pill(false)}>Дальше ›</Link> : null}
            <Link href={href({ gall: "1", gp: "" })} className="text-blue-700 hover:underline">Показать все на одной странице</Link>
          </>}
          {gall && <Link href={href({ gall: "", gp: "" })} className="text-blue-700 hover:underline">Свернуть до страниц по {GANTT_PAGE}</Link>}
        </div>
      )}
      {undated.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-neutral-300 bg-neutral-50 p-3">
          <div className="text-sm font-semibold text-neutral-800">Без даты <span className="font-normal text-neutral-600">{undated.length} ТЗ — ни старта, ни срока в данных нет</span></div>
          {undated.slice(0, gall ? undefined : 40).map(({ p }) => <PipeRow key={p.id} p={p} cardHref={cardHref(p.id)} />)}
          {!gall && undated.length > 40 && <Link href={href({ gall: "1", gp: "" })} className="text-xs text-blue-700 hover:underline">Показать все {undated.length}</Link>}
        </div>
      )}
    </div>
  );
}

export { inScope, unitsFor };
