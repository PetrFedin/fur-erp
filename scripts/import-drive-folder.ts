/**
 * Импорт оригиналов документов из локальной копии папки Drive «мех» в хранилище приложения.
 * Точка входа-синоним scripts/attach-local-drive-files.ts (вся логика там):
 *   сухой прогон по умолчанию; --apply — запись; --rollback <журнал> — откат;
 *   идемпотентно: строки, у которых уже есть файл, пропускаются; в журнал пишется sha256 файла.
 *
 *   node --env-file=.env node_modules/.bin/tsx scripts/import-drive-folder.ts docs-inventory/drive-mex
 *   node --env-file=.env node_modules/.bin/tsx scripts/import-drive-folder.ts docs-inventory/drive-mex --apply
 */
import "./attach-local-drive-files";
