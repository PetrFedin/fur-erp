#!/bin/bash
# Двойной щелчок в Finder: сразу снимает копию базы и файлов, обновляет весь реестр
# и (по вашему «y») сохраняет несохранённые правки кода в GitHub.
cd "$(dirname "$0")/01_КОД_ПРОЕКТА" || { echo "Нет ярлыка 01_КОД_ПРОЕКТА"; read -r; exit 1; }
echo "== 1/3 Копия базы и файлов в ~/Backups/fur-erp"
bash scripts/backup.sh || echo "!! копия базы не снята: запущен ли Docker? (сначала ЗАПУСТИТЬ.command)"
echo "== 2/3 Обновляю реестр на рабочем столе"
bash scripts/hub-sync.sh --now && echo "   готово"
echo "== 3/3 Код"
if [ -n "$(git status --porcelain)" ]; then
  git status --short
  printf "Есть несохранённые правки кода. Сохранить их в GitHub? (y/n): "; read -r ans
  if [ "$ans" = "y" ]; then
    git add -A && git commit -m "Сохранение правок $(date '+%d.%m.%Y %H:%M')" && git push origin HEAD \
      && echo "   отправлено в GitHub" || echo "!! не удалось, правки остались на месте"
  fi
else
  git fetch -q origin 2>/dev/null
  git status -sb | head -1 | grep -q ahead && { echo "   есть неотправленные коммиты, отправляю"; git push origin HEAD; } || echo "   всё уже сохранено в GitHub"
fi
echo; echo "Готово. Окно можно закрыть."; read -r
