/**
 * Блоки страницы, к которым можно привязать комментарий.
 *  1) явные: атрибут data-comment-anchor="filters" (необязательно data-comment-label="Фильтры");
 *  2) автоматические: контейнер с заголовком h2/h3 («h:название») и таблицы («table:N»).
 * Один и тот же разбор используют режим «Указать блок», метки-счётчики и подсветка при «Открыть место».
 */
export type AnchorInfo = { id: string; label: string; el: HTMLElement; explicit: boolean };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

const inUi = (el: Element) => !!el.closest("[data-comment-ui]");

export function collectAnchors(root: ParentNode = document): Map<string, AnchorInfo> {
  const scope = (root.querySelector?.("main") as HTMLElement | null) ?? (root as unknown as HTMLElement);
  const map = new Map<string, AnchorInfo>();
  const used = new Set<HTMLElement>();
  const add = (id: string, label: string, el: HTMLElement, explicit: boolean) => {
    if (!id || map.has(id) || used.has(el)) return;
    map.set(id, { id, label: label || id, el, explicit });
    used.add(el);
  };

  scope.querySelectorAll<HTMLElement>("[data-comment-anchor]").forEach((el) => {
    if (inUi(el)) return;
    const id = el.getAttribute("data-comment-anchor") ?? "";
    const label = el.getAttribute("data-comment-label") || text(el.querySelector("h1,h2,h3,h4,[data-comment-title]")) || id;
    add(id, label, el, true);
  });

  // Заголовок страницы (h1 и то, что рядом: кнопки, подпись).
  const h1 = scope.querySelector<HTMLElement>("h1");
  if (h1 && !inUi(h1)) {
    const box = h1.closest<HTMLElement>("[data-comment-anchor]") ? null : h1.parentElement?.parentElement && h1.parentElement.parentElement !== scope ? (h1.parentElement.tagName === "DIV" ? h1.parentElement : null) : h1.parentElement;
    if (box && box !== scope && !box.contains(scope)) add("page-header", `Заголовок: ${text(h1)}`, box, false);
  }

  // Плитки Сводки и похожие блоки: заголовок с атрибутом data-comment-title.
  scope.querySelectorAll<HTMLElement>("[data-comment-title]").forEach((t) => {
    if (inUi(t) || t.closest("[data-comment-anchor]") !== null) return;
    const s = slug(text(t));
    if (!s) return;
    let p: HTMLElement | null = t.parentElement;
    for (let i = 0; i < 3 && p && p !== scope; i++, p = p.parentElement) {
      if (/(^|\s)(rounded|border)(-|\s|$)/.test(p.className?.toString() ?? "")) break;
    }
    if (!p || p === scope) return;
    let id = `tile:${s}`;
    for (let n = 2; map.has(id); n++) id = `tile:${s}-${n}`;
    add(id, text(t), p, false);
  });

  scope.querySelectorAll<HTMLElement>("h2, h3").forEach((h) => {
    if (inUi(h)) return;
    const t = text(h);
    const s = slug(t);
    if (!s) return;
    let container = h.closest("section, article, details, fieldset") as HTMLElement | null;
    if (!container) {
      // Карточка: поднимаемся до ближайшей рамки (rounded/border), не выше 4 уровней.
      let p: HTMLElement | null = h.parentElement;
      for (let i = 0; i < 4 && p && p !== scope; i++, p = p.parentElement) {
        if (/(^|\s)(rounded|border)(-|\s|$)/.test(p.className?.toString() ?? "")) {
          container = p;
          break;
        }
      }
      if (!container && h.parentElement && h.parentElement !== scope) container = h.parentElement;
    }
    if (!container || container === scope || container.contains(scope)) return;
    let id = `h:${s}`;
    for (let n = 2; map.has(id); n++) id = `h:${s}-${n}`;
    add(id, t, container, false);
  });

  let tn = 0;
  scope.querySelectorAll<HTMLElement>("table").forEach((tb) => {
    if (inUi(tb)) return;
    tn += 1;
    const wrap = (tb.closest("div.overflow-x-auto") as HTMLElement | null) ?? tb;
    // Ближайший заголовок выше таблицы — для понятной подписи.
    let prev: Element | null = wrap;
    let head = "";
    for (let i = 0; i < 6 && prev && !head; i++) {
      let sib: Element | null = prev.previousElementSibling;
      while (sib && !head) {
        head = /^H[1-4]$/.test(sib.tagName) ? text(sib) : text(sib.querySelector("h2,h3,h4"));
        sib = sib.previousElementSibling;
      }
      prev = prev.parentElement;
      if (prev === scope) break;
    }
    add(`table:${tn}`, head ? `Таблица «${head}»` : `Таблица ${tn}`, wrap, false);
  });
  return map;
}

/** Самый вложенный блок, содержащий узел. */
export function innermost(map: Map<string, AnchorInfo>, node: Node | null): AnchorInfo | null {
  if (!node) return null;
  let best: AnchorInfo | null = null;
  for (const a of map.values()) {
    if (!a.el.contains(node)) continue;
    if (!best || best.el.contains(a.el)) best = a;
  }
  return best;
}

let flashTimer: ReturnType<typeof setTimeout> | null = null;
/** Прокручивает к блоку и подсвечивает его на несколько секунд. */
export function flashElement(el: HTMLElement) {
  try {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  } catch {
    el.scrollIntoView();
  }
  document.querySelectorAll("[data-comment-flash]").forEach((n) => n.removeAttribute("data-comment-flash"));
  el.setAttribute("data-comment-flash", "1");
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.removeAttribute("data-comment-flash"), 4000);
}
