import "server-only";

// Защита от перебора пароля: счётчики неудач в памяти процесса (один сервер — один счётчик).
// Три независимых замка, чтобы подмена IP-заголовка или перебор по многим почтам не помогали:
//   • пара почта+IP:  10 неудач за 10 минут → блок на 10 минут;
//   • только IP:      40 неудач за 10 минут → блок на 10 минут (перебор многих почт с одного адреса);
//   • только почта:   30 неудач за 10 минут → блок на 10 минут (перебор с многих адресов).

const WINDOW_MS = 10 * 60_000;
const LOCK_MS = 10 * 60_000;
const MAX_KEYS = 10_000;

type Entry = { failures: number[]; lockedUntil: number };
const store = new Map<string, Entry>();

const LIMITS: Record<string, number> = { pair: 10, ip: 40, email: 30 };

function prune(now: number) {
  if (store.size < MAX_KEYS) return;
  for (const [k, e] of store) {
    if (e.lockedUntil <= now && e.failures.every((t) => now - t > WINDOW_MS)) store.delete(k);
  }
  while (store.size >= MAX_KEYS) {
    const first = store.keys().next().value;
    if (first === undefined) break;
    store.delete(first);
  }
}

/** Ключ пары почта+IP (совместим со старым API). */
export function loginKey(email: string, ip: string) {
  return `pair:${email.trim().toLowerCase().slice(0, 254)}|${ip}`;
}

/** Все ключи одной попытки входа. */
export function loginKeys(email: string, ip: string): string[] {
  const e = email.trim().toLowerCase().slice(0, 254);
  return [`pair:${e}|${ip}`, `ip:${ip}`, `email:${e}`];
}

const limitOf = (key: string) => LIMITS[key.slice(0, key.indexOf(":"))] ?? 10;

/** Секунд до конца блокировки или 0, если вход разрешён. Для набора ключей — максимум. */
export function lockedSeconds(key: string | string[], now = Date.now()): number {
  let max = 0;
  for (const k of Array.isArray(key) ? key : [key]) {
    const e = store.get(k);
    if (e && e.lockedUntil > now) max = Math.max(max, Math.ceil((e.lockedUntil - now) / 1000));
  }
  return max;
}

export function recordFailure(key: string | string[], now = Date.now()) {
  prune(now);
  for (const k of Array.isArray(key) ? key : [key]) {
    const e = store.get(k) ?? { failures: [], lockedUntil: 0 };
    e.failures = e.failures.filter((t) => now - t <= WINDOW_MS);
    e.failures.push(now);
    if (e.failures.length >= limitOf(k)) {
      e.lockedUntil = now + LOCK_MS;
      e.failures = [];
    }
    store.set(k, e);
  }
}

/** Успешный вход сбрасывает только пару «почта+IP» (общие счётчики IP и почты затухают сами). */
export function recordSuccess(key: string | string[]) {
  const keys = Array.isArray(key) ? key : [key];
  for (const k of keys) if (k.startsWith("pair:")) store.delete(k);
}

/** IP клиента из заголовков обратного прокси (Caddy перезаписывает X-Forwarded-For адресом клиента). */
export function clientIpFrom(h: { get(name: string): string | null }): string {
  const fwd = h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip");
  return (fwd || "unknown").slice(0, 64);
}
