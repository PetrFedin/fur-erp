import "server-only";

/**
 * Готовый расчёт из витрины (снимок), а если витрины нет или она устарела — тот же расчёт вживую.
 * Во время сборки витрины (buildSnapshots) снимки не читаются: считаем заново, чтобы в новую витрину не попали старые числа.
 */
let building = 0;
export async function whileBuildingMart<T>(fn: () => Promise<T>): Promise<T> {
  building++;
  try { return await fn(); } finally { building--; }
}

export async function martCached<T>(orgId: string, key: string, compute: () => Promise<T>): Promise<T> {
  if (building === 0) {
    const { readSnapshot } = await import("@/lib/mart/snapshots");
    const snap = await readSnapshot<T>(orgId, key);
    if (snap !== null) return snap;
  }
  return compute();
}
