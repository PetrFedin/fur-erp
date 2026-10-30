#!/bin/bash
# Двойной щелчок в Finder: поднимает базу в Docker, запускает fur-erp и открывает его в браузере.
# Остановить: закрыть это окно Терминала (или нажать Ctrl+C).
cd "$(dirname "$0")/01_КОД_ПРОЕКТА" || { echo "Нет ярлыка 01_КОД_ПРОЕКТА"; read -r; exit 1; }
URL="http://localhost:3200"
echo "== fur-erp: запуск из $(pwd -P)"

# 1. Docker с базой. База живёт в Docker Desktop (контейнер fur-erp-db-1).
DOCKER="docker"
for ctx in desktop-linux orbstack default; do
  if docker --context "$ctx" ps -a --format '{{.Names}}' 2>/dev/null | grep -qx fur-erp-db-1; then DOCKER="docker --context $ctx"; break; fi
done
if ! $DOCKER info >/dev/null 2>&1; then
  echo "== Запускаю Docker Desktop (до 2 минут)…"; open -a Docker
  for i in $(seq 1 60); do $DOCKER info >/dev/null 2>&1 && break; sleep 2; done
fi
$DOCKER compose up -d db || { echo "!! Docker не запустился. Откройте Docker Desktop вручную и запустите этот файл снова."; read -r; exit 1; }
echo "== Жду базу…"
for i in $(seq 1 30); do $DOCKER exec fur-erp-db-1 pg_isready -U fur_erp -d fur_erp >/dev/null 2>&1 && break; sleep 2; done

# 2. Если сервер уже работает — просто открываем браузер
if lsof -nP -iTCP:3200 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "== Сервер уже запущен, открываю $URL"; open "$URL"; exit 0
fi

# 3. Зависимости (один раз, ~1 ГБ) и запуск
[ -d node_modules ] || { echo "== Ставлю зависимости (npm ci), это 2–5 минут…"; npm ci || { read -r; exit 1; }; }
( for i in $(seq 1 90); do curl -s -o /dev/null "$URL/login" && { open "$URL"; break; }; sleep 2; done ) &
echo "== Запускаю сервер на $URL (первая загрузка страницы ~10–20 секунд)"
PORT=3200 npm run dev
