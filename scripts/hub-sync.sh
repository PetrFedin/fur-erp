#!/usr/bin/env bash
# Реестр проекта на рабочем столе: одна папка, где лежит ВСЁ по fur-erp.
#   bash scripts/hub-sync.sh            обновить реестр (быстро; база — не чаще раза в 30 минут)
#   bash scripts/hub-sync.sh --now      обновить всё сразу, включая свежую копию базы и файлов
# Вызывается хуком Stop после каждого ответа Claude (.claude/settings.json) и кнопкой «СОХРАНИТЬ_СЕЙЧАС».
# Папка реестра: $FUR_HUB или ~/Desktop/FUR_ERP. Сам код остаётся в ~/Projects/fur-erp (вне iCloud),
# в реестре на него ярлык 01_КОД_ПРОЕКТА. Устройство реестра: scripts/hub/ПРОЧТИ_МЕНЯ.md.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 0
PROJ="$PWD"
HUB="${FUR_HUB:-$HOME/Desktop/FUR_ERP}"
NOW=0; [ "${1:-}" = "--now" ] && NOW=1
LOG="$HUB/.sync.log"
mkdir -p "$HUB"

# один запуск за раз
LOCK="$HUB/.sync.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  # замок старше 15 минут считаем брошенным
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then rm -rf "$LOCK"; mkdir "$LOCK" || exit 0; else exit 0; fi
fi
trap 'rm -rf "$LOCK"' EXIT
ts="$(date +%Y%m%d_%H%M%S)"
say() { echo "$(date '+%d.%m %H:%M:%S') $*" >> "$LOG"; }

D_DB="$HUB/02_БАЗА_ДАННЫХ"; D_UP="$HUB/03_ЗАГРУЖЕННЫЕ_ФАЙЛЫ"; D_DOC="$HUB/04_ДОКУМЕНТАЦИЯ"
D_SRC="$HUB/05_ИСХОДНЫЕ_ДАННЫЕ"; D_CHG="$HUB/06_ЖУРНАЛ_ИЗМЕНЕНИЙ"; D_REQ="$HUB/07_ЖУРНАЛ_ЗАПРОСОВ"
D_MEM="$HUB/09_ПАМЯТЬ_CLAUDE"; D_CFG="$HUB/10_НАСТРОЙКИ_CLAUDE"; D_GIT="$HUB/11_ПОЛНАЯ_КОПИЯ_КОДА"
D_REP="$HUB/12_ОТЧЁТЫ"
mkdir -p "$D_DB" "$D_UP" "$D_DOC" "$D_SRC" "$D_CHG" "$D_REQ" "$D_MEM" "$D_CFG" "$D_GIT" "$D_REP" "$HUB/99_АРХИВ"
# Отчёты и выгрузки для владельца (Excel и т. п.): docs-inventory/reports → 12_ОТЧЁТЫ; спорные вопросы — туда же
[ -d docs-inventory/reports ] && rsync -a docs-inventory/reports/ "$D_REP/" 2>>"$LOG"
for f in docs-inventory/pending-decisions-*.md; do [ -f "$f" ] && cp -f "$f" "$D_REP/"; done

# 1. Ярлыки: код и все автокопии
[ -L "$HUB/01_КОД_ПРОЕКТА" ] || ln -s "$PROJ" "$HUB/01_КОД_ПРОЕКТА"
[ -e "$D_DB/все_автокопии_Backups" ] || ln -s "$HOME/Backups/fur-erp" "$D_DB/все_автокопии_Backups"

# 2. Постоянные инструкции и кнопки (лежат в git: scripts/hub/)
cp -f scripts/hub/ПРОЧТИ_МЕНЯ.md "$HUB/00_ПРОЧТИ_МЕНЯ.md"
cp -f scripts/hub/ПОДКЛЮЧЕНИЯ.md "$HUB/08_ПОДКЛЮЧЕНИЯ_И_ДОСТУПЫ.md"
cp -f scripts/hub/КАК_ВОССТАНОВИТЬ.md "$D_DB/КАК_ВОССТАНОВИТЬ.md"
for c in ЗАПУСТИТЬ СОХРАНИТЬ_СЕЙЧАС; do
  cp -f "scripts/hub/$c.command" "$HUB/$c.command"; chmod +x "$HUB/$c.command"
done

# 3. Копия базы (раз в 30 минут или --now), проверяется распаковкой
last_db="$(ls -1t "$D_DB"/fur_erp_*.sql.gz 2>/dev/null | head -1)"
if [ $NOW = 1 ] || [ -z "$last_db" ] || [ -n "$(find "$last_db" -mmin +30 2>/dev/null)" ]; then
  if [ -f .env ] && command -v pg_dump >/dev/null 2>&1; then
    url="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')"
    out="$D_DB/fur_erp_$ts.sql.gz"
    if pg_dump --no-owner "$url" 2>>"$LOG" | gzip > "$out.tmp" && [ -s "$out.tmp" ] && gunzip -t "$out.tmp" 2>/dev/null \
       && [ "$(gunzip -c "$out.tmp" | head -c 2000000 | grep -c 'PostgreSQL database dump')" -ge 1 ]; then
      # одинаковую базу второй раз не храним
      if [ -n "$last_db" ] && cmp -s <(gunzip -c "$out.tmp" | grep -v '^-- Dumped\|^\\restrict\|^\\unrestrict') \
                                     <(gunzip -c "$last_db" | grep -v '^-- Dumped\|^\\restrict\|^\\unrestrict'); then
        rm -f "$out.tmp"; touch "$last_db"
      else
        mv "$out.tmp" "$out"; say "база: $(basename "$out")"
      fi
    else
      rm -f "$out.tmp"; say "ОШИБКА: копия базы не снята (запущен ли Docker с базой fur-erp-db-1?)"
    fi
  fi
  ls -1t "$D_DB"/fur_erp_*.sql.gz 2>/dev/null | tail -n +21 | while read -r f; do rm -f "$f"; done
fi

# 4. Загруженные файлы (документы закупок, фото): новый архив только если что-то изменилось
UPD="${UPLOAD_DIR:-./uploads}"
if [ -d "$UPD" ]; then
  last_up="$(ls -1t "$D_UP"/uploads_*.tar.gz 2>/dev/null | head -1)"
  if [ -z "$last_up" ] || [ -n "$(find "$UPD" -newer "$last_up" -type f 2>/dev/null | head -1)" ]; then
    if tar -czf "$D_UP/uploads_$ts.tar.gz.tmp" -C "$UPD" . 2>>"$LOG"; then
      mv "$D_UP/uploads_$ts.tar.gz.tmp" "$D_UP/uploads_$ts.tar.gz"; say "файлы: uploads_$ts.tar.gz"
    else rm -f "$D_UP/uploads_$ts.tar.gz.tmp"; fi
    ls -1t "$D_UP"/uploads_*.tar.gz 2>/dev/null | tail -n +4 | while read -r f; do rm -f "$f"; done
  fi
fi

# 5. Документация проекта (копия для чтения; править — в 01_КОД_ПРОЕКТА)
rsync -a --delete docs/ "$D_DOC/docs/" 2>>"$LOG"
for f in README.md PRODUCT.md AGENTS.md CLAUDE.md DESIGN.md; do [ -f "$f" ] && cp -f "$f" "$D_DOC/$f"; done

# 6. Исходные Excel-файлы, лежавшие рядом с проектом
for f in "$HOME"/Documents/claude/fur-erp-*.xlsx; do [ -f "$f" ] && rsync -a "$f" "$D_SRC/"; done
# docs-inventory не лежит в git (выгрузки Google Drive «мех», журналы исправлений данных, сверки) —
# копия здесь единственная кроме самого Mac
[ -d docs-inventory ] && rsync -a docs-inventory/ "$D_SRC/docs-inventory/" 2>>"$LOG"

# 7. Журнал изменений кода (все коммиты всех веток) и несохранённое
{
  echo "# Журнал изменений кода fur-erp"; echo
  echo "Каждая строка — одно сохранённое изменение (коммит). Новые сверху. Обновлено: $(date '+%d.%m.%Y %H:%M')."; echo
  echo "Текущая ветка: \`$(git branch --show-current)\`; GitHub: $(git status -sb | head -1 | sed 's/^## //')"; echo
  git log --all --date=format:'%d.%m.%Y %H:%M' --pretty='- %ad · `%h` · %s%d'
} > "$D_CHG/ЖУРНАЛ_ИЗМЕНЕНИЙ.md"
git for-each-ref --format='- %(refname:short) · %(committerdate:format:%d.%m.%Y) · %(subject)' refs/heads refs/remotes \
  > "$D_CHG/ВЕТКИ.md"
dirty="$(git status --porcelain | wc -l | tr -d ' ')"
if [ "$dirty" != "0" ]; then
  { git status --short; echo; git diff; } > "$D_CHG/НЕСОХРАНЁННЫЕ_ПРАВКИ.diff"
else
  rm -f "$D_CHG/НЕСОХРАНЁННЫЕ_ПРАВКИ.diff"
fi

# 8. Полная копия репозитория (все ветки, история, отложенные правки) — одним файлом
refs_now="$(git for-each-ref --format='%(objectname) %(refname)' | shasum | cut -c1-12)"
if [ ! -f "$D_GIT/fur-erp.bundle" ] || [ "$(cat "$D_GIT/.refs" 2>/dev/null)" != "$refs_now" ]; then
  if git bundle create "$D_GIT/fur-erp.bundle.tmp" --all >/dev/null 2>>"$LOG"; then
    mv "$D_GIT/fur-erp.bundle.tmp" "$D_GIT/fur-erp.bundle"; echo "$refs_now" > "$D_GIT/.refs"; say "код: bundle обновлён"
  fi
fi
cp -f scripts/hub/КОПИЯ_КОДА.md "$D_GIT/КАК_ВОССТАНОВИТЬ_КОД.md"

# 9. Журнал запросов (история сессий Claude)
python3 -I scripts/hub/prompts.py "$D_REQ" 2>>"$LOG"

# 10. Заметки памяти Claude о проекте и настройки (чтобы не зависеть от Claude)
MEMDIR="$HOME/.claude/projects/-Users-petr-Documents-claude/memory"
for f in "$MEMDIR"/*.md; do
  case "$(basename "$f")" in MEMORY.md) continue;; esac
  if grep -qiE 'fur-erp|мехучёт|МехУчет|THE FUR' "$f" 2>/dev/null; then cp -f "$f" "$D_MEM/"; fi
done
grep -iE 'fur-erp|мех|ym' "$MEMDIR/MEMORY.md" > "$D_MEM/_ОГЛАВЛЕНИЕ.md" 2>/dev/null
rsync -a --delete --exclude 'settings.local.json' .claude/ "$D_CFG/проект_.claude/" 2>>"$LOG"
mkdir -p "$D_CFG/хуки"
for h in guard-data-loss.js verify-on-stop.js autobackup.sh read-budget.js; do
  [ -f "$HOME/.claude/hooks/$h" ] && cp -f "$HOME/.claude/hooks/$h" "$D_CFG/хуки/"
done
cp -f "$HOME/.claude/CLAUDE.md" "$D_CFG/глобальные_правила_CLAUDE.md" 2>/dev/null
# локальные настройки запуска (не в git): .env только для локальной работы, держим закрытым
[ -f .env ] && { cp -f .env "$D_CFG/env_копия_настроек.txt"; chmod 600 "$D_CFG/env_копия_настроек.txt"; }
[ -d .impeccable ] && rsync -a .impeccable/ "$D_CFG/impeccable/" 2>>"$LOG"
cp -f .claude/launch.json "$D_CFG/launch.json" 2>/dev/null

# 11. Сводка состояния
{
  echo "# Состояние проекта на $(date '+%d.%m.%Y %H:%M')"; echo
  echo "- Код: \`$PROJ\` (ярлык 01_КОД_ПРОЕКТА), ветка \`$(git branch --show-current)\`, последнее изменение: $(git log -1 --date=format:'%d.%m.%Y %H:%M' --pretty='%ad — %s')"
  echo "- Отправлено в GitHub: $(git status -sb | head -1 | grep -q 'ahead' && echo 'НЕТ, есть неотправленные коммиты' || echo 'да')"
  echo "- Несохранённых правок в коде: $dirty$( [ "$dirty" != 0 ] && echo ' (список и сами правки: 06_ЖУРНАЛ_ИЗМЕНЕНИЙ/НЕСОХРАНЁННЫЕ_ПРАВКИ.diff)')"
  echo "- Последняя копия базы: $(basename "$(ls -1t "$D_DB"/fur_erp_*.sql.gz 2>/dev/null | head -1)" 2>/dev/null)"
  echo "- Последний архив файлов: $(basename "$(ls -1t "$D_UP"/uploads_*.tar.gz 2>/dev/null | head -1)" 2>/dev/null)"
  echo "- Сессий Claude в журнале запросов: $(ls "$D_REQ"/2*.md 2>/dev/null | wc -l | tr -d ' ')"
  echo "- Последние ошибки синхронизации: $(grep -c 'ОШИБКА' "$LOG" 2>/dev/null || true) (подробно: .sync.log)"
} > "$HUB/00_СОСТОЯНИЕ.md"
exit 0
