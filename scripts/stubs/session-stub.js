// Заглушка @/lib/session: «текущий пользователь» задаётся глобально (globalThis.__TEST_SESSION) — для scripts/test-editability.ts.
const ROLES = (allowed) => {
  const s = globalThis.__TEST_SESSION;
  if (!s) throw new Error("no session");
  if (allowed.length && !allowed.includes(s.user.role)) throw new Error("FORBIDDEN:" + s.user.role);
  return s;
};
module.exports = {
  getFreshSession: async () => globalThis.__TEST_SESSION ?? null,
  requireSession: async () => ROLES([]),
  requireRole: async (...allowed) => ROLES(allowed),
};
