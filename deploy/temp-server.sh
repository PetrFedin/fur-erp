#!/bin/sh
# Временный стенд на чистом сервере Ubuntu одной командой.
# Перед запуском в /root лежат три файла: fur-erp-src.tgz (код), fur_erp.sql.gz (база), uploads.tgz (документы).
# Запуск:  sh /root/temp-server.sh   (скрипт сам спросит логин и пароль для общего замка на сайт)
set -eu
cd /root
[ -f fur-erp-src.tgz ] && [ -f fur_erp.sql.gz ] && [ -f uploads.tgz ] || { echo "Нет одного из файлов в /root: fur-erp-src.tgz, fur_erp.sql.gz, uploads.tgz"; exit 1; }

echo "== 1/7 Защита и Docker"
apt-get update -y && apt-get install -y ufw curl
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

echo "== 2/7 Код"
rm -rf /root/fur-erp && mkdir /root/fur-erp && tar xzf fur-erp-src.tgz -C /root/fur-erp
cd /root/fur-erp

echo "== 3/7 Адрес и секреты"
IP=$(curl -4 -s https://ifconfig.me)
DOMAIN="$(echo "$IP" | tr . -).sslip.io"
printf "Логин для общего замка на сайт: "; read BASIC_USER
printf "Пароль для общего замка: "; stty -echo; read BASIC_PASS; stty echo; echo
BASIC_HASH=$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$BASIC_PASS" | sed 's/\$/$$/g')
cat > .env <<ENV
DOMAIN=$DOMAIN
DB_PASSWORD=$(openssl rand -hex 16)
AUTH_SECRET=$(openssl rand -base64 32)
ALLOW_REGISTRATION=false
DEMO_LOGIN_EMAIL=
DEMO_LOGIN_PASSWORD=
BASIC_USER=$BASIC_USER
BASIC_HASH=$BASIC_HASH
ENV
chmod 600 .env
cat > deploy/Caddyfile <<'CADDY'
{$DOMAIN} {
	encode gzip
	request_body {
		max_size 30MB
	}
	basic_auth {
		{$BASIC_USER} {$BASIC_HASH}
	}
	reverse_proxy app:3000
}
CADDY

echo "== 4/7 База"
docker compose -f docker-compose.prod.yml up -d db
sleep 20
gunzip -c /root/fur_erp.sql.gz | docker compose -f docker-compose.prod.yml exec -T db psql -U fur_erp -d fur_erp -v ON_ERROR_STOP=1 >/dev/null

echo "== 5/7 Приложение (сборка 5–10 минут)"
docker compose -f docker-compose.prod.yml up -d --build

echo "== 6/7 Документы"
docker run --rm -v fur-erp_fur_erp_uploads:/data -v /root:/in alpine sh -c "cd /data && tar xzf /in/uploads.tgz"
docker compose -f docker-compose.prod.yml restart app

echo "== 7/7 Готово"
docker compose -f docker-compose.prod.yml ps
echo
echo "Адрес сайта: https://$DOMAIN"
echo "Общий замок: логин $BASIC_USER и пароль, который вы ввели. Затем вход в приложение."
echo "Убрать стенд целиком: cd /root/fur-erp && docker compose -f docker-compose.prod.yml down -v   (и удалить сервер в панели Timeweb)"
