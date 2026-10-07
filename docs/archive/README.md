# Архив незавершённой работы

## fur-erp-live-wip-2026-10-07.patch
Снимок (07.10.2026, 19:20) незакоммиченных изменений отдельного клона `/Users/petr/Projects/fur-erp-live`
(ветка `data/drive-reconciliation-2026-10-06`, база — коммит `a0faed0`), который редактировала другая сессия.
Затрагивает: lots/*, production, purchases, documents, login/demo-login.tsx и login-form.tsx, drive-doc-list.ts,
production-doc-checklist.ts, verification.ts, e2e/auction.spec.ts, e2e/regress-columns.spec.ts.
В `main` НЕ внесён: на момент слияния клон активно правился (dev-сервер :4174, Playwright), а изменения пересекаются с
единым форматом фильтров (`filter-panel`) в тех же файлах. Применять так, на свежем `main`:
`git apply --3way docs/archive/fur-erp-live-wip-2026-10-07.patch` (с разбором конфликтов вручную).
Полный архив клона (включая untracked: `scripts/mark-general-drive-docs.ts`, `src/app/(app)/loading.tsx`) —
`~/Backups/folders-2026-10-07/fur-erp-live.tgz`.
