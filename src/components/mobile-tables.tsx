"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Общий механизм «таблица → карточки» для телефона (<768px). Монтируется один раз в макете приложения.
 * Для каждой таблицы с шапкой (кроме .table-keep) проставляет data-cards у <table>, data-label у <td> (из заголовков столбцов,
 * с учётом rowspan/colspan и группы-надзаголовка), data-empty у пустых «—», data-title у главного идентификатора строки.
 * Сам вид карточек — CSS в globals.css под @media (max-width: 767px); на десктопе атрибуты ничего не меняют.
 * Сортировка: шапка на телефоне скрыта, поэтому над таблицей появляется «Сортировка» (select + кнопка направления),
 * которая нажимает те же ссылки/кнопки заголовков, то есть те же URL-параметры и та же логика.
 */

const EMPTY = /^[\s —–-]*$/;

function textOf(el: Element): string {
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      const t = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) parts.push(t);
    } else if (n.nodeType === 1) {
      const e = n as Element;
      if (e.getAttribute("aria-hidden") === "true" || e.classList.contains("info-i") || e.tagName === "svg" || e.tagName === "SCRIPT" || e.tagName === "STYLE") return;
      n.childNodes.forEach(walk);
    }
  };
  walk(el);
  return parts.join(" ").replace(/[▲▼]/g, "").replace(/\s+/g, " ").trim();
}

/** Подписи столбцов: низший заголовок над колонкой; если над ним группа, шире одной колонки, — «Группа · подпись». */
function columnLabels(table: HTMLTableElement): string[] {
  const head = table.tHead;
  if (!head) return [];
  const grid: (HTMLTableCellElement | null)[][] = [];
  Array.from(head.rows).forEach((row, r) => {
    grid[r] ??= [];
    let c = 0;
    Array.from(row.cells).forEach((cell) => {
      while (grid[r][c]) c++;
      for (let dr = 0; dr < Math.max(1, cell.rowSpan); dr++) {
        for (let dc = 0; dc < Math.max(1, cell.colSpan); dc++) {
          (grid[r + dr] ??= [])[c + dc] = cell;
        }
      }
      c += Math.max(1, cell.colSpan);
    });
  });
  const width = Math.max(0, ...grid.map((g) => g.length));
  const labels: string[] = [];
  for (let c = 0; c < width; c++) {
    const chain: string[] = [];
    let last: HTMLTableCellElement | null = null;
    for (let r = 0; r < grid.length; r++) {
      const cell = grid[r][c];
      if (!cell || cell === last) continue;
      last = cell;
      const t = textOf(cell);
      if (t && !chain.includes(t)) chain.push(t);
    }
    labels[c] = chain.join(" · ");
  }
  return labels;
}

function hasControl(el: Element) {
  return Boolean(el.querySelector("button, input, select, textarea, [role=button]"));
}

function processTable(table: HTMLTableElement) {
  if (table.classList.contains("table-keep") || table.closest(".table-keep")) {
    table.removeAttribute("data-cards");
    return;
  }
  const head = table.tHead;
  if (!head || !head.querySelector("th")) {
    table.removeAttribute("data-cards");
    return;
  }
  const labels = columnLabels(table);
  const bodies = Array.from(table.tBodies).concat(table.tFoot ? [table.tFoot] : []);
  let rows = 0;
  for (const body of bodies) {
    for (const tr of Array.from(body.rows)) {
      rows++;
      let col = 0;
      let titleSet = false;
      const cells = Array.from(tr.cells);
      for (const cell of cells) {
        const span = Math.max(1, cell.colSpan);
        const text = textOf(cell);
        const interactive = hasControl(cell) || Boolean(cell.querySelector("a[href]"));
        const label = span === 1 ? labels[col] ?? "" : "";
        if (label) cell.setAttribute("data-label", label);
        else cell.removeAttribute("data-label");
        if (EMPTY.test(text) && !interactive) cell.setAttribute("data-empty", "");
        else cell.removeAttribute("data-empty");
        // Управляющий элемент без текста (шеврон «раскрыть», флажок): в углу карточки, а не отдельной строкой.
        if (!text && hasControl(cell)) cell.setAttribute("data-ctl", "");
        else cell.removeAttribute("data-ctl");
        // Главный идентификатор — первая ячейка с текстом; в строке-группе (colspan) она же и есть заголовок.
        if (!titleSet && text && !EMPTY.test(text)) {
          cell.setAttribute("data-title", "");
          cell.removeAttribute("data-label");
          titleSet = true;
        } else cell.removeAttribute("data-title");
        col += span;
      }
      if (cells.length === 1) tr.setAttribute("data-solo", "");
      else tr.removeAttribute("data-solo");
    }
  }
  table.setAttribute("data-cards", "");
  table.setAttribute("data-rows", String(rows));
}

/** Строка «Сортировка» над таблицей: те же ссылки/кнопки заголовков, нажимаемые программно. */
function syncSort(table: HTMLTableElement, id: string) {
  const wrap = table.closest<HTMLElement>(".table-scroll") ?? table;
  const old = document.querySelector<HTMLElement>(`[data-mobile-sort="${id}"]`);
  const ths = table.tHead && table.hasAttribute("data-cards")
    ? Array.from(table.tHead.querySelectorAll<HTMLElement>("th")).filter((th) => th.querySelector("a[href], button"))
    : [];
  if (!ths.length) {
    old?.remove();
    return;
  }
  const sig = ths.map((th) => textOf(th) + (th.getAttribute("aria-sort") ?? "")).join("|");
  if (old && old.getAttribute("data-sig") === sig && old.nextElementSibling === wrap) return;
  old?.remove();
  const box = document.createElement("div");
  box.setAttribute("data-mobile-sort", id);
  box.setAttribute("data-sig", sig);
  box.className = "mobile-sort";
  const lab = document.createElement("label");
  lab.textContent = "Сортировка";
  const sel = document.createElement("select");
  sel.setAttribute("aria-label", "Сортировка");
  const target = (th: HTMLElement) => th.querySelector<HTMLElement>("a[href], button");
  let activeIdx = -1;
  ths.forEach((th, i) => {
    const o = document.createElement("option");
    const dir = th.getAttribute("aria-sort");
    o.value = String(i);
    o.textContent = textOf(th) || `Столбец ${i + 1}`;
    if (dir === "ascending" || dir === "descending") activeIdx = i;
    sel.appendChild(o);
  });
  const none = document.createElement("option");
  none.value = "-1";
  none.textContent = "–";
  sel.insertBefore(none, sel.firstChild);
  sel.value = String(activeIdx);
  sel.addEventListener("change", () => {
    const i = Number(sel.value);
    if (i >= 0) target(ths[i])?.click();
  });
  lab.appendChild(sel);
  box.appendChild(lab);
  if (activeIdx >= 0) {
    const asc = ths[activeIdx].getAttribute("aria-sort") === "ascending";
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", asc ? "По возрастанию, нажмите для обратного порядка" : "По убыванию, нажмите для обратного порядка");
    b.textContent = asc ? "▲" : "▼";
    b.addEventListener("click", () => target(ths[activeIdx])?.click());
    box.appendChild(b);
  }
  wrap.parentElement?.insertBefore(box, wrap);
}

let seq = 0;
function run(root: ParentNode) {
  if (!window.matchMedia("(max-width: 767px)").matches) {
    document.querySelectorAll("[data-mobile-sort]").forEach((b) => b.remove());
    return;
  }
  root.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
    // table-keep остаются таблицами: ничего на них не ставим, иначе React увидит расхождение при гидратации.
    if (table.classList.contains("table-keep") || table.closest(".table-keep")) return;
    // Таблица в блоке «hidden md:block» (ResponsiveRows) на телефоне скрыта, там вместо неё карточки: её не трогаем, иначе React увидит расхождение.
    if (table.closest(".hidden")) return;
    const rows = table.rows.length;
    const sig = `${rows}:${table.tHead?.textContent?.length ?? 0}:${table.textContent?.length ?? 0}`;
    if (table.getAttribute("data-sig") !== sig) {
      processTable(table);
      table.setAttribute("data-sig", sig);
    }
    let id = table.getAttribute("data-mt-id");
    if (!id) {
      id = String(++seq);
      table.setAttribute("data-mt-id", id);
    }
    syncSort(table, id);
  });
  // Сироты: «Сортировка» от таблиц, которых уже нет на странице.
  document.querySelectorAll<HTMLElement>("[data-mobile-sort]").forEach((box) => {
    if (!document.querySelector(`table[data-mt-id="${box.getAttribute("data-mobile-sort")}"]`)) box.remove();
  });
}

export function MobileTables() {
  const pathname = usePathname();
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    let raf = 0;
    // До окончания гидратации DOM не трогаем: подмена атрибутов и блока «Сортировка» ломает сверку React.
    let ready = false;
    const schedule = () => {
      if (!ready) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => run(document));
    };
    const start = () => {
      timer = window.setTimeout(() => {
        ready = true;
        schedule();
      }, 600);
    };
    let timer = 0;
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    const main = document.querySelector("main") ?? document.body;
    const mo = new MutationObserver(schedule);
    mo.observe(main, { childList: true, subtree: true, characterData: true });
    mq.addEventListener("change", schedule);
    return () => {
      window.removeEventListener("load", start);
      clearTimeout(timer);
      mo.disconnect();
      mq.removeEventListener("change", schedule);
      cancelAnimationFrame(raf);
    };
  }, [pathname]);
  return null;
}
