import "server-only";

// Простая защита от перебора пароля: счётчик неудач в памяти процесса.
// MAX_FAILURES неудачных попыток за WINDOW_MS на пару email+IP — блокировка
// на LOCK_MS. Без внешних зависимостей; при нескольких инстансах каждый
// считает отдельно (для перебора этого достаточно как первый рубеж).

const WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 10;
const LOCK_MS = 10 * 60_000;
const MAX_KEYS = 10_000;

type Entry = { failures: number[]; lockedUntil: number };
const store = new Map<string, Entry>();

function prune(now: number) {
  if (store.size < MAX_KEYS) return;
  for (const [k, e] of store) {
    if (e.lockedUntil <= now && e.failures.every((t) => now - t > WINDOW_MS)) store.delete(k);
  }
  // Если всё ещё слишком много — сбрасываем самые старые ключи.
  while (store.size >= MAX_KEYS) {
    const first = store.keys().next().value;
    if (first === undefined) break;
    store.delete(first);
  }
}

export function loginKey(email: string, ip: string) {
  return `${email.trim().toLowerCase().slice(0, 254)}|${ip}`;
}

/** Секунд до конца блокировки или 0, если вход разрешён. */
export function lockedSeconds(key: string, now = Date.now()): number {
  const e = store.get(key);
  if (!e || e.lockedUntil <= now) return 0;
  return Math.ceil((e.lockedUntil - now) / 1000);
}

export function recordFailure(key: string, now = Date.now()) {
  prune(now);
  const e = store.get(key) ?? { failures: [], lockedUntil: 0 };
  e.failures = e.failures.filter((t) => now - t <= WINDOW_MS);
  e.failures.push(now);
  if (e.failures.length >= MAX_FAILURES) {
    e.lockedUntil = now + LOCK_MS;
    e.failures = [];
  }
  store.set(key, e);
}

export function recordSuccess(key: string) {
  store.delete(key);
}
