#!/bin/bash
# The Buildiary website (WordPress, English / Urdu / Arabic) on the Buildiary server, behind Caddy.
#
#   bash deploy/website/setup.sh            first set-up, or update the theme and the pages
#   bash deploy/website/setup.sh --force    also overwrite pages that were edited in WordPress
#
# The site answers at https://$MABNI_BASE and https://www.$MABNI_BASE (from /opt/mimaar/.env).
# The WordPress admin password is saved in Parameter Store: /mabni/wordpress-admin-password.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
FORCE=""; [ "${1:-}" = "--force" ] && FORCE="force"
set -a; . /opt/mimaar/.env; set +a
BASE="${MABNI_BASE:?MABNI_BASE missing in /opt/mimaar/.env}"
CONSOLE="${MABNI_CONSOLE:-my.$BASE}"
W=/opt/website
mkdir -p "$W"
cd "$W"
if [ ! -f .env ]; then
  gen() { tr -dc 'A-HJ-NP-Za-km-z2-9' </dev/urandom | head -c "$1"; }
  printf 'DB_PASSWORD=%s\nDB_ROOT_PASSWORD=%s\nWP_ADMIN_PASSWORD=Mabni-%s\n' "$(gen 24)" "$(gen 28)" "$(gen 14)" > .env
  chmod 600 .env
fi
set -a; . ./.env; set +a

# the theme, the site plugin and the pages, from the repository (the folders are emptied and
# refilled, not replaced, so the running WordPress container sees the new files)
for d in theme mu-plugins content; do mkdir -p "$d"; find "$d" -mindepth 1 -delete; done
cp -r "$SRC/theme/mabni/." theme/
cp -r "$SRC/mu-plugins/." mu-plugins/
cp -r "$SRC/content/." content/
cat "$SRC/import.php" > import.php

cat > compose.yml <<'EOF'
# The Buildiary website. Passwords are in .env (root only).
name: website
x-db-env: &dbenv
  WORDPRESS_DB_HOST: db
  WORDPRESS_DB_USER: wordpress
  WORDPRESS_DB_PASSWORD: ${DB_PASSWORD}
  WORDPRESS_DB_NAME: wordpress
services:
  db:
    image: mariadb:11.8
    restart: unless-stopped
    command: ["--innodb-buffer-pool-size=128M", "--character-set-server=utf8mb4", "--collation-server=utf8mb4_unicode_ci"]
    environment:
      MARIADB_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
      MARIADB_DATABASE: wordpress
      MARIADB_USER: wordpress
      MARIADB_PASSWORD: ${DB_PASSWORD}
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 5s
      timeout: 5s
      retries: 30
    volumes: [db:/var/lib/mysql]
  wordpress:
    image: wordpress:php8.3-apache
    restart: unless-stopped
    depends_on:
      db: { condition: service_healthy }
    environment:
      <<: *dbenv
      WORDPRESS_CONFIG_EXTRA: |
        define('MABNI_CONSOLE', getenv('MABNI_CONSOLE'));
        define('MABNI_CONSOLE_INTERNAL', 'http://mimaar-frontend:8080');
        define('MABNI_SUPPORT_EMAIL', getenv('MABNI_SUPPORT_EMAIL') ?: 'info@smhglobal.com.pk');
        define('MABNI_WHATSAPP', getenv('MABNI_WHATSAPP') ?: '');
        if (($$_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') { $$_SERVER['HTTPS'] = 'on'; }
        define('DISALLOW_FILE_EDIT', true);
        define('WP_AUTO_UPDATE_CORE', 'minor');
      MABNI_CONSOLE: ${MABNI_CONSOLE}
      MABNI_SUPPORT_EMAIL: ${MABNI_SUPPORT_EMAIL:-info@smhglobal.com.pk}
      MABNI_WHATSAPP: ${MABNI_WHATSAPP:-}
    volumes:
      - wp:/var/www/html
      - ./theme:/var/www/html/wp-content/themes/mabni:ro
      - ./mu-plugins:/var/www/html/wp-content/mu-plugins:ro
    networks:
      default:
      web:
        aliases: [website-wp]
  cli:
    image: wordpress:cli-php8.3
    profiles: ["cli"]
    user: "33:33"
    depends_on:
      db: { condition: service_healthy }
    environment:
      <<: *dbenv
      MABNI_CONSOLE: ${MABNI_CONSOLE}
    volumes:
      - wp:/var/www/html
      - ./theme:/var/www/html/wp-content/themes/mabni:ro
      - ./mu-plugins:/var/www/html/wp-content/mu-plugins:ro
      - ./content:/content:ro
      - ./import.php:/import.php:ro
networks:
  web: { external: true }
volumes:
  db:
  wp:
EOF
grep -q '^MABNI_CONSOLE=' .env || echo "MABNI_CONSOLE=$CONSOLE" >> .env
docker compose pull -q
docker compose up -d
wp() { docker compose run --rm -T --entrypoint wp cli "$@"; }
for i in $(seq 1 30); do [ -f "$(docker volume inspect website_wp -f '{{.Mountpoint}}')/wp-config.php" ] && break; sleep 3; done
if ! wp core is-installed 2>/dev/null; then
  wp core install --url="https://$BASE" --title="Buildiary" --admin_user=mabni-admin --admin_password="$WP_ADMIN_PASSWORD" --admin_email="${MABNI_OWN_EMAIL:-info@smhglobal.com.pk}" --skip-email
  wp option update blogdescription "Construction site management"
  wp option update timezone_string "Asia/Karachi"
  # a temporary address is kept out of search engines; switched on when the real domain is in place
  case "$BASE" in *sslip.io|*nip.io) wp option update blog_public 0 ;; *) wp option update blog_public 1 ;; esac
  export PATH="$PATH:/snap/bin"
  REGION="$(curl -s -H "X-aws-ec2-metadata-token: $(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')" http://169.254.169.254/latest/meta-data/placement/region || true)"
  [ -n "$REGION" ] && aws ssm put-parameter --region "$REGION" --name /mabni/wordpress-admin-password --type SecureString --value "$WP_ADMIN_PASSWORD" --overwrite >/dev/null \
    && echo "WordPress admin password saved in Parameter Store (/mabni/wordpress-admin-password)" || true
fi
wp theme activate mabni
wp option update blogname "Buildiary" >/dev/null
wp option update blogdescription "Construction site management app for home owners and builders" >/dev/null
wp language core install ur ar >/dev/null 2>&1 || echo "Language packs not installed (no internet?)"
wp eval-file /import.php /content $FORCE
wp rewrite structure '/%postname%/' >/dev/null
wp cache flush >/dev/null 2>&1 || true

# the front door
cat > /opt/edge/sites/website.caddy <<EOF
$BASE, www.$BASE {
	encode zstd gzip
	@www host www.$BASE
	redir @www https://$BASE{uri} permanent
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		-X-Powered-By
	}
	# theme files, images and fonts: kept by browsers for a week (pages themselves are always fresh)
	@static path /wp-content/themes/* /wp-content/uploads/* /wp-includes/*
	header @static Cache-Control "public, max-age=604800"
	reverse_proxy website-wp:80
}
EOF
docker compose -f /opt/edge/compose.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile
echo "WEBSITE READY: https://$BASE (admin: https://$BASE/wp-admin, user mabni-admin)"
