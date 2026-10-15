#!/bin/sh
# Создаёт файл .env для сервера: случайные пароли и секреты подставляются сами.
# Запуск из папки проекта:  sh deploy/setup-env.sh          (боевой/тестовый сервер с доменом или sslip.io)
#                           sh deploy/setup-env.sh tunnel   (временный доступ с ноутбука через туннель)
# Печатает только то, что нужно записать: логин и пароль общего замка. Секреты базы и входа остаются в .env.
set -eu
MODE="${1:-server}"
[ -f .env ] && { echo "Файл .env уже есть — не перезаписываю. Удалите или переименуйте его, если нужен новый."; exit 1; }
command -v docker >/dev/null || { echo "Нужен Docker (https://docs.docker.com/get-docker/)"; exit 1; }
command -v openssl >/dev/null || { echo "Нужен openssl"; exit 1; }

if [ "$MODE" = "tunnel" ]; then
  DOMAIN="localhost"; PROFILE="tunnel"
else
  DOMAIN="${DOMAIN_PRESET:-}"
  [ -n "$DOMAIN" ] || { printf "Адрес сайта без https:// (например 185-12-34-56.sslip.io или erp.вашдомен.ru): "; read DOMAIN; }
  [ -n "$DOMAIN" ] || { echo "Адрес не введён"; exit 1; }
  PROFILE="server"
fi
printf "Логин общего замка (латиницей, например tester): "; read BASIC_USER
[ -n "$BASIC_USER" ] || { echo "Логин не введён"; exit 1; }
BASIC_PASS=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
BASIC_HASH=$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$BASIC_PASS")

umask 077
cat > .env <<ENV
DOMAIN=$DOMAIN
DB_PASSWORD=$(openssl rand -hex 16)
AUTH_SECRET=$(openssl rand -base64 32)
BASIC_USER=$BASIC_USER
BASIC_HASH='$BASIC_HASH'
COMPOSE_PROFILES=$PROFILE
ALLOW_REGISTRATION=false
ALLOW_DEMO_LOGIN=false
ALLOW_ROLE_SWITCH=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
DEMO_BUILD=false
ENV
chmod 600 .env
echo
echo "Готово: файл .env создан (права 600)."
echo "Общий замок сайта — ЗАПИШИТЕ (показывается один раз):"
echo "   логин:  $BASIC_USER"
echo "   пароль: $BASIC_PASS"
echo "Передавайте тестировщикам логин и пароль замка РАЗНЫМИ сообщениями."
