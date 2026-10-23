#!/bin/bash
# Mimaar ERP on one AWS server (Ubuntu 24.04): Docker, a Caddy front door with automatic
# https (more apps and websites can be added beside Mimaar), the Mimaar ERP site, and
# daily backups to S3.
#
# Run as root, e.g. from EC2 user data:
#   MIMAAR_DOMAIN=mimaar.1-2-3-4.sslip.io MIMAAR_DATA_FILE=/root/mimaar-data.json bash bootstrap.sh
# Safe to run again: it keeps the site, the data and the passwords.
set -uo pipefail
exec > >(tee -a /var/log/mimaar-setup.log) 2>&1
echo "== Mimaar setup $(date -u)"

DOMAIN="${MIMAAR_DOMAIN:?set MIMAAR_DOMAIN}"
DATA_FILE="${MIMAAR_DATA_FILE:-/root/mimaar-data.json}"
IMAGE="${MIMAAR_IMAGE:-ghcr.io/smazharhasan/mimaar-erpnext:16}"
export DEBIAN_FRONTEND=noninteractive

tok() { curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 300'; }
idoc() { curl -s -H "X-aws-ec2-metadata-token: $(tok)" http://169.254.169.254/latest/dynamic/instance-identity/document; }
REGION="$(idoc | sed -n 's/.*"region" *: *"\([^"]*\)".*/\1/p')"
ACCOUNT="$(idoc | sed -n 's/.*"accountId" *: *"\([^"]*\)".*/\1/p')"
BUCKET="${MIMAAR_BACKUP_BUCKET:-mimaar-backups-$ACCOUNT-$REGION}"

# ---- 1. memory safety net and time zone
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/90-mimaar.conf && sysctl -q -p /etc/sysctl.d/90-mimaar.conf
timedatectl set-timezone Asia/Karachi || true

# ---- 2. Docker and the AWS command line
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
command -v aws >/dev/null || snap install aws-cli --classic
export PATH="$PATH:/snap/bin"
docker network inspect web >/dev/null 2>&1 || docker network create web

# ---- 3. The front door: Caddy, automatic https. One file per app or website in /opt/edge/sites
mkdir -p /opt/edge/sites /opt/edge/www
cat > /opt/edge/compose.yml <<'EOF'
# The front door of this server: https for every app and website (Let's Encrypt certificates).
name: edge
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./sites:/etc/caddy/sites:ro
      - ./www:/srv/www:ro
      - caddy-data:/data
      - caddy-config:/config
    networks: [web]
networks:
  web: { external: true }
volumes:
  caddy-data:
  caddy-config:
EOF
cat > /opt/edge/Caddyfile <<'EOF'
# One file per app or website in /opt/edge/sites/ ; after a change:
#   docker compose -f /opt/edge/compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
import /etc/caddy/sites/*.caddy
EOF
cat > /opt/edge/sites/mimaar.caddy <<EOF
$DOMAIN {
	encode zstd gzip
	reverse_proxy mimaar-frontend:8080
}
EOF
docker compose -f /opt/edge/compose.yml up -d

# ---- 4. Mimaar ERP
mkdir -p /opt/mimaar/data
cd /opt/mimaar || exit 1
if [ ! -f .env ]; then
  gen() { tr -dc 'A-HJ-NP-Za-km-z2-9' </dev/urandom | head -c "$1"; }
  printf 'SITE=%s\nIMAGE=%s\nADMIN_PASSWORD=Mimaar-%s\nDB_ROOT_PASSWORD=%s\nBUCKET=%s\nREGION=%s\n' \
    "$DOMAIN" "$IMAGE" "$(gen 12)" "$(gen 28)" "$BUCKET" "$REGION" > .env
  chmod 600 .env
fi
set -a; . ./.env; set +a
[ -f "$DATA_FILE" ] && cp "$DATA_FILE" data/mimaar-data.json

# the owner reads the Administrator password in the AWS console (Systems Manager > Parameter Store)
aws ssm put-parameter --region "$REGION" --name /mimaar/administrator-password --type SecureString \
  --value "$ADMIN_PASSWORD" --overwrite >/dev/null && echo "Administrator password saved in Parameter Store" \
  || echo "Could not save the password in Parameter Store (it is in /opt/mimaar/.env)"

cat > compose.yml <<'EOF'
# Mimaar ERP: Frappe 16 + ERPNext 16 + Mimaar. Settings are in .env (root only).
name: mimaar

x-app: &app
  image: ${IMAGE}
  restart: unless-stopped
  volumes:
    - sites:/home/frappe/frappe-bench/sites
    - logs:/home/frappe/frappe-bench/logs

x-redis-env: &redis-env
  FRAPPE_REDIS_CACHE: redis://redis-cache:6379
  FRAPPE_REDIS_QUEUE: redis://redis-queue:6379

services:
  backend:
    <<: *app
    environment:
      DB_HOST: db
      DB_PORT: "3306"
    depends_on:
      configurator:
        condition: service_completed_successfully

  configurator:
    <<: *app
    restart: "no"
    entrypoint: ["bash", "-c"]
    command:
      - >
        ls -1 apps > sites/apps.txt;
        bench set-config -g db_host $$DB_HOST;
        bench set-config -gp db_port $$DB_PORT;
        bench set-config -g redis_cache "redis://$$REDIS_CACHE";
        bench set-config -g redis_queue "redis://$$REDIS_QUEUE";
        bench set-config -g redis_socketio "redis://$$REDIS_QUEUE";
        bench set-config -gp socketio_port $$SOCKETIO_PORT;
    environment:
      DB_HOST: db
      DB_PORT: "3306"
      REDIS_CACHE: redis-cache:6379
      REDIS_QUEUE: redis-queue:6379
      SOCKETIO_PORT: "9000"
    depends_on:
      db:
        condition: service_healthy

  create-site:
    <<: *app
    restart: "no"
    volumes:
      - sites:/home/frappe/frappe-bench/sites
      - logs:/home/frappe/frappe-bench/logs
      - ./data:/data:ro
    entrypoint: ["bash", "-c"]
    environment:
      SITE: ${SITE}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      DB_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
    command:
      - >
        wait-for-it -t 180 db:3306;
        wait-for-it -t 120 redis-cache:6379;
        wait-for-it -t 120 redis-queue:6379;
        export start=`date +%s`;
        until [[ -n `grep -hs ^ sites/common_site_config.json | jq -r ".db_host // empty"` ]] && [[ -n `grep -hs ^ sites/common_site_config.json | jq -r ".redis_cache // empty"` ]] && [[ -n `grep -hs ^ sites/common_site_config.json | jq -r ".redis_queue // empty"` ]];
        do echo "Waiting for the configuration"; sleep 5; if (( `date +%s`-start > 180 )); then echo "No configuration found"; exit 1; fi; done;
        if [ -d "sites/$$SITE" ]; then echo "Site already there"; else bench new-site --mariadb-user-host-login-scope='%' --admin-password="$$ADMIN_PASSWORD" --db-root-username=root --db-root-password="$$DB_ROOT_PASSWORD" --install-app erpnext --install-app mimaar --set-default "$$SITE" || exit 1; fi;
        bench --site "$$SITE" set-config host_name "https://$$SITE";
        if [ -f /data/mimaar-data.json ]; then bench --site "$$SITE" execute mimaar.setup.local_site --kwargs "{'data_file': '/data/mimaar-data.json'}" || exit 1; else bench --site "$$SITE" execute mimaar.setup.local_site || exit 1; fi;
        bench --site "$$SITE" clear-cache;
        echo "MIMAAR READY: https://$$SITE"
    depends_on:
      configurator:
        condition: service_completed_successfully

  db:
    image: mariadb:11.8
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      start_period: 5s
      interval: 5s
      timeout: 5s
      retries: 20
    command:
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
      - --skip-character-set-client-handshake
      - --innodb-buffer-pool-size=1G
    environment:
      MARIADB_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
    volumes:
      - db-data:/var/lib/mysql

  frontend:
    <<: *app
    command: ["nginx-entrypoint.sh"]
    environment:
      BACKEND: backend:8000
      FRAPPE_SITE_NAME_HEADER: ${SITE}
      SOCKETIO: websocket:9000
      UPSTREAM_REAL_IP_ADDRESS: 172.16.0.0/12
      UPSTREAM_REAL_IP_HEADER: X-Forwarded-For
      UPSTREAM_REAL_IP_RECURSIVE: "off"
      PROXY_READ_TIMEOUT: 120
      CLIENT_MAX_BODY_SIZE: 50m
    networks:
      default:
      web:
        aliases: [mimaar-frontend]
    depends_on:
      - backend
      - websocket

  queue-long:
    <<: *app
    command: ["bench", "worker", "--queue", "long,default,short"]
    environment: *redis-env
    depends_on:
      configurator:
        condition: service_completed_successfully

  queue-short:
    <<: *app
    command: ["bench", "worker", "--queue", "short,default"]
    environment: *redis-env
    depends_on:
      configurator:
        condition: service_completed_successfully

  scheduler:
    <<: *app
    command: ["bench", "schedule"]
    depends_on:
      configurator:
        condition: service_completed_successfully

  websocket:
    <<: *app
    command: ["node", "/home/frappe/frappe-bench/apps/frappe/socketio.js"]
    environment: *redis-env
    depends_on:
      configurator:
        condition: service_completed_successfully

  redis-queue:
    image: redis:6.2-alpine
    restart: unless-stopped
    volumes:
      - redis-queue-data:/data

  redis-cache:
    image: redis:6.2-alpine
    restart: unless-stopped

networks:
  web: { external: true }

volumes:
  db-data:
  redis-queue-data:
  sites:
  logs:
EOF

# ---- 5. Helper scripts: backup (daily, to S3) and update (new version of Mimaar)
cat > backup.sh <<'EOF'
#!/bin/bash
# Full backup (database and files) kept 14 days on the server and 60 days in S3.
cd /opt/mimaar && set -a && . ./.env && set +a
export PATH="$PATH:/snap/bin"
docker compose exec -T backend bench --site "$SITE" backup --with-files --compress || exit 1
docker compose exec -T backend bash -c "find sites/$SITE/private/backups -type f -mtime +14 -delete"
DIR="$(docker volume inspect mimaar_sites -f '{{.Mountpoint}}')/$SITE/private/backups"
aws s3 sync "$DIR" "s3://$BUCKET/mimaar/" --region "$REGION" --only-show-errors && echo "Backup copied to s3://$BUCKET/mimaar/"
EOF
cat > update.sh <<'EOF'
#!/bin/bash
# Gets the latest Mimaar ERP image and applies it to the site, keeping all data (backup first).
cd /opt/mimaar && set -a && . ./.env && set +a
./backup.sh || echo "Backup failed; continuing"
docker compose pull && docker compose up -d || exit 1
CODE=$(docker wait "$(docker compose ps -a -q create-site)")
[ "$CODE" = "0" ] || { docker compose logs --tail 60 create-site; exit 1; }
docker compose exec -T backend bench --site "$SITE" migrate && docker compose exec -T backend bench --site "$SITE" clear-cache && echo "MIMAAR UPDATED"
EOF
chmod 700 backup.sh update.sh
echo "30 2 * * * root /opt/mimaar/backup.sh >> /var/log/mimaar-backup.log 2>&1" > /etc/cron.d/mimaar-backup

# S3 bucket for backups (private, encrypted, old backups removed after 60 days)
if ! aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null \
    && aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true \
    && aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{"Rules":[{"ID":"expire-old-backups","Status":"Enabled","Filter":{"Prefix":""},"Expiration":{"Days":60}}]}' \
    && echo "Backup bucket $BUCKET ready" || echo "Could not create the backup bucket $BUCKET"
fi

# ---- 6. Start Mimaar ERP
docker compose pull -q
docker compose up -d
CODE=$(docker wait "$(docker compose ps -a -q create-site)")
docker compose logs --no-log-prefix --tail 30 create-site
if [ "$CODE" = "0" ]; then echo "== MIMAAR READY: https://$SITE"; else echo "== MIMAAR SETUP FAILED (code $CODE)"; fi
