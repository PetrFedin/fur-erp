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

/** Сброс памяти запроса (вызывается после любой записи в БД). */
export function invalidateRequestMemo() {
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
export function memoRequest<F extends (...a: any[]) => Promise<any>>(name: string, fn: F, key: (...a: Parameters<F>) => string | null): F { // eslint-disable-line @typescript-eslint/no-explicit-any
  return ((...a: Parameters<F>) => {
    const k = key(...a);
    if (k === null) return fn(...a);
    const map = requestStore().map;
    const full = `${name}|${k}`;
    const hit = map.get(full) as ReturnType<F> | undefined;
    if (hit) return hit;
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

