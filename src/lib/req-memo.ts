import * as React from "react";

/**
 * Дедупликация тяжёлых загрузок В РАМКАХ ОДНОГО ЗАПРОСА (React cache): страница, плитки и вложенные расчёты просят одни и те же
 * данные (ТЗ, лоты, долг поставщику, оплаты) по нескольку раз — на стенде с 0,1 ЦП и удалённой базой каждый повтор стоит секунды.
 * Между запросами ничего не хранится (это не кэш процесса), вне запроса (скрипты, тесты) функция работает как раньше.
 * Любая запись в БД (расширение prisma.ts) сбрасывает память запроса, поэтому «прочитал → записал → перечитал» видит новое.
 * Результат общий для всех вызывающих: менять его на месте нельзя (копируйте перед sort/push).
 */
const reactCache: <T extends (...a: never[]) => unknown>(f: T) => T = (React as unknown as { cache?: <T>(f: T) => T }).cache ?? ((f) => f);

const requestStore = reactCache(() => ({ map: new Map<string, unknown>() }));

// ───────── Общий кэш между запросами (демо-стенд) ─────────
// Включается переменной PAGE_CACHE_SECONDS (секунды жизни записи); по умолчанию — 90 с на демо-стенде (задан GATE_USER), иначе выключен.
// Любая запись в БД через наш клиент (prisma.ts → invalidateRequestMemo) поднимает «поколение», и все записи кэша становятся устаревшими.
// Правки в БД из других процессов (скрипты) кэш не видит — поэтому вне демо-стенда он выключен. Результат общий: менять на месте нельзя.
const SHARED_TTL_MS = (() => {
  const v = Number(process.env.PAGE_CACHE_SECONDS ?? (process.env.GATE_USER ? "90" : "0"));
  return Number.isFinite(v) && v > 0 ? v * 1000 : 0;
})();
const SHARED_MAX = Number(process.env.PAGE_CACHE_MAX ?? 16);
let sharedGen = 0;
const shared = new Map<string, { gen: number; at: number; p: Promise<unknown> }>();

/** Сброс памяти запроса и общего кэша (вызывается после любой записи в БД). */
export function invalidateRequestMemo() {
  sharedGen += 1;
  shared.clear();
  try {
    requestStore().map.clear();
  } catch {
    // вне запроса памяти нет
  }
}

/**
 * Обёртка: одинаковый ключ в одном запросе — один вызов `fn` (параллельные вызовы делят один promise).
 * key вернул null — не запоминать (например, вызов внутри транзакции).
 */
export function memoRequest<F extends (...a: any[]) => Promise<any>>(name: string, fn: F, key: (...a: Parameters<F>) => string | null, opts: { shared?: boolean } = {}): F { // eslint-disable-line @typescript-eslint/no-explicit-any
  return ((...a: Parameters<F>) => {
    const k = key(...a);
    if (k === null) return fn(...a);
    const map = requestStore().map;
    const full = `${name}|${k}`;
    const hit = map.get(full) as ReturnType<F> | undefined;
    if (hit) return hit;
    // Общий кэш между запросами: только для загрузчиков с простыми ключами (opts.shared) и когда он включён.
    if (opts.shared && SHARED_TTL_MS > 0) {
      const s = shared.get(full);
      if (s && s.gen === sharedGen && Date.now() - s.at < SHARED_TTL_MS) { map.set(full, s.p); return s.p as ReturnType<F>; }
      const gen = sharedGen;
      const sp = fn(...a) as ReturnType<F>;
      if (shared.size >= SHARED_MAX) shared.delete(shared.keys().next().value as string);
      shared.set(full, { gen, at: Date.now(), p: sp });
      map.set(full, sp);
      sp.catch(() => { if (shared.get(full)?.p === sp) shared.delete(full); if (map.get(full) === sp) map.delete(full); });
      return sp;
    }
    const p = fn(...a) as ReturnType<F>;
    map.set(full, p);
    p.catch(() => {
      if (map.get(full) === p) map.delete(full);
    });
    return p;
  }) as F;
}

/** Ключ из JSON-совместимых значений (Set/Map/Date/функции сводятся к тексту). */
export function jsonKey(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x instanceof Set ? ["Set", ...x] : x instanceof Map ? ["Map", ...x] : typeof x === "function" ? "fn" : x));
}

const ids = new WeakMap<object, number>();
let nextId = 1;
/** Короткий номер объекта (клиент БД, индекс меха) для ключа: разные объекты — разные ключи. undefined/null — "0". */
export function objId(o: object | null | undefined): string {
  if (!o) return "0";
  let id = ids.get(o);
  if (id === undefined) ids.set(o, (id = nextId++));
  return String(id);
}

