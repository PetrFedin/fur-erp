#!/bin/sh
# Временный стенд на чистом сервере Ubuntu одной командой (с ОБЕЗЛИЧЕННОЙ демо-базой — не с боевой!).
# Перед запуском в /root лежат три файла: fur-erp-src.tgz (код), fur_erp.sql.gz (дамп демо-базы), uploads.tgz (заглушка документов).
# Запуск:  sh /root/temp-server.sh   (спросит логин общего замка; пароль замка сгенерирует и покажет один раз)
set -eu
cd /root
[ -f fur-erp-src.tgz ] && [ -f fur_erp.sql.gz ] && [ -f uploads.tgz ] || { echo "Нет одного из файлов в /root: fur-erp-src.tgz, fur_erp.sql.gz, uploads.tgz"; exit 1; }

echo "== 1/7 Защита и Docker"
apt-get update -y && apt-get install -y ufw curl openssl
ufw default deny incoming && ufw default allow outgoing
ufw limit 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

echo "== 2/7 Код"
rm -rf /root/fur-erp && mkdir /root/fur-erp && tar xzf fur-erp-src.tgz -C /root/fur-erp
cd /root/fur-erp

echo "== 3/7 Адрес и секреты"
IP=$(curl -4 -s https://ifconfig.me)
DOMAIN="$(echo "$IP" | tr . -).sslip.io"
DOMAIN_PRESET="$DOMAIN" sh deploy/setup-env.sh   # спросит только логин общего замка
sed -i 's/^DEMO_BUILD=.*/DEMO_BUILD=true/' .env

echo "== 4/7 База"
docker compose -f docker-compose.prod.yml up -d db
sleep 20
gunzip -c /root/fur_erp.sql.gz | docker compose -f docker-compose.prod.yml exec -T db psql -U fur_erp -d fur_erp -v ON_ERROR_STOP=1 >/dev/null

echo "== 5/7 Приложение (сборка 5–10 минут)"
docker compose -f docker-compose.prod.yml up -d --build

echo "== 6/7 Документы-заглушки"
docker run --rm -v fur-erp_fur_erp_uploads:/data -v /root:/in alpine sh -c "cd /data && tar xzf /in/uploads.tgz"
docker compose -f docker-compose.prod.yml restart app

echo "== 7/7 Готово"
docker compose -f docker-compose.prod.yml ps
echo
echo "Адрес сайта: https://$DOMAIN"
echo "Общий замок: логин и пароль показаны выше (один раз). Затем вход в приложение — логины демо-пользователей из файла demo-logins.txt."
echo "Убрать стенд целиком: cd /root/fur-erp && docker compose -f docker-compose.prod.yml down -v   (и удалить сервер в панели Timeweb)"
