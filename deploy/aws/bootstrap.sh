#!/bin/bash
# Buildiary on one AWS server (Ubuntu 24.04): Docker, a Caddy front door with automatic
# https (more apps and websites can be added beside it), the first ERP site, the Buildiary Cloud
# set-up (one site per customer, picked by the address; certificates on demand) and daily
# backups of every site to S3.
#
# Run as root, e.g. from EC2 user data:
#   BUILDIARY_DOMAIN=buildiary.1-2-3-4.sslip.io BUILDIARY_DATA_FILE=/root/buildiary-data.json bash bootstrap.sh
# Customers' workspaces are <name>.$BUILDIARY_BASE (default: BUILDIARY_DOMAIN without its first part);
# the console (sign-up page, customers, payments) is $BUILDIARY_CONSOLE (default my.$BUILDIARY_BASE),
# created with /opt/buildiary/buildiary-console.sh.
# Safe to run again: it keeps the sites, the data and the passwords.
set -uo pipefail
exec > >(tee -a /var/log/buildiary-setup.log) 2>&1
echo "== Buildiary setup $(date -u)"

DOMAIN="${BUILDIARY_DOMAIN:?set BUILDIARY_DOMAIN}"
DATA_FILE="${BUILDIARY_DATA_FILE:-/root/buildiary-data.json}"
BASE="${BUILDIARY_BASE:-${DOMAIN#*.}}"
CONSOLE="${BUILDIARY_CONSOLE:-my.$BASE}"
export DEBIAN_FRONTEND=noninteractive

tok() { curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 300'; }
idoc() { curl -s -H "X-aws-ec2-metadata-token: $(tok)" http://169.254.169.254/latest/dynamic/instance-identity/document; }
REGION="$(idoc | sed -n 's/.*"region" *: *"\([^"]*\)".*/\1/p')"
ACCOUNT="$(idoc | sed -n 's/.*"accountId" *: *"\([^"]*\)".*/\1/p')"
BUCKET="${BUILDIARY_BACKUP_BUCKET:-buildiary-backups-$ACCOUNT-$REGION}"
# the private image store in this account (deploy/aws/private-images.sh)
IMAGE="${BUILDIARY_IMAGE:-$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/buildiary:16}"

# ---- 1. memory safety net and time zone
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/90-buildiary.conf && sysctl -q -p /etc/sysctl.d/90-buildiary.conf
timedatectl set-timezone Asia/Karachi || true

# ---- 2. Docker and the AWS command line
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
command -v aws >/dev/null || snap install aws-cli --classic
export PATH="$PATH:/snap/bin"
docker network inspect web >/dev/null 2>&1 || docker network create web
# private images (Amazon ECR): Docker signs in with the server's own AWS role, no stored password
mkdir -p /opt/buildiary
if [[ "$IMAGE" == *.dkr.ecr.* ]]; then
  cat > /opt/buildiary/ecr-login.sh <<EOF
#!/bin/bash
# Signs Docker in to the private image store with the server's own AWS role (valid 12 hours).
export PATH="\$PATH:/snap/bin"
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin ${IMAGE%%/*} >/dev/null
EOF
else
  printf '#!/bin/bash\ntrue\n' > /opt/buildiary/ecr-login.sh
fi
chmod 700 /opt/buildiary/ecr-login.sh
/opt/buildiary/ecr-login.sh || echo "Could not sign in to the image store"

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
cat > /opt/edge/Caddyfile <<EOF
# One file per app or website in /opt/edge/sites/ ; after a change:
#   docker compose -f /opt/edge/compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
{
	# certificates for customers' workspaces are fetched on first visit, only for addresses
	# the Buildiary console knows (the :5555 block below asks it)
	on_demand_tls {
		ask http://localhost:5555/check
	}
	servers {
		strict_sni_host on
	}
}

http://localhost:5555 {
	bind 127.0.0.1
	rewrite * /api/method/buildiary.saas.api.tls_ask?{query}
	reverse_proxy buildiary-frontend:8080 {
		header_up Host $CONSOLE
	}
}

import /etc/caddy/sites/*.caddy
EOF
cat > /opt/edge/sites/buildiary.caddy <<EOF
$DOMAIN {
	encode zstd gzip
	header X-Robots-Tag "noindex, nofollow"
	reverse_proxy buildiary-frontend:8080
}
EOF
cat > /opt/edge/sites/zz-buildiary.caddy <<'EOF'
# Buildiary Cloud: every other address (customers' workspaces, the console) goes to the ERP,
# which picks the site by the address. Sites named in other files win over this one.
https:// {
	tls {
		on_demand
	}
	encode zstd gzip
	# workspaces are private: never in search results
	header X-Robots-Tag "noindex, nofollow"
	reverse_proxy buildiary-frontend:8080
}
http:// {
	redir https://{host}{uri} permanent
}
EOF
docker compose -f /opt/edge/compose.yml up -d
docker compose -f /opt/edge/compose.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile || true

# ---- 4. Buildiary
mkdir -p /opt/buildiary/data
cd /opt/buildiary || exit 1
if [ ! -f .env ]; then
  gen() { tr -dc 'A-HJ-NP-Za-km-z2-9' </dev/urandom | head -c "$1"; }
  printf 'SITE=%s\nIMAGE=%s\nADMIN_PASSWORD=Buildiary-%s\nDB_ROOT_PASSWORD=%s\nBUCKET=%s\nREGION=%s\n' \
    "$DOMAIN" "$IMAGE" "$(gen 12)" "$(gen 28)" "$BUCKET" "$REGION" > .env
  chmod 600 .env
fi
grep -q '^BUILDIARY_BASE=' .env || printf 'BUILDIARY_BASE=%s\nBUILDIARY_CONSOLE=%s\nBUILDIARY_OWN_COMPANY="%s"\nBUILDIARY_OWN_EMAIL=%s\n' \
  "$BASE" "$CONSOLE" "${BUILDIARY_OWN_COMPANY:-Villa 31}" "${BUILDIARY_OWN_EMAIL:-info@smhglobal.com.pk}" >> .env
set -a; . ./.env; set +a
[ -f "$DATA_FILE" ] && cp "$DATA_FILE" data/buildiary-data.json

# the owner reads the Administrator password in the AWS console (Systems Manager > Parameter Store)
aws ssm put-parameter --region "$REGION" --name /buildiary/administrator-password --type SecureString \
  --value "$ADMIN_PASSWORD" --overwrite >/dev/null && echo "Administrator password saved in Parameter Store" \
  || echo "Could not save the password in Parameter Store (it is in /opt/buildiary/.env)"

cat > compose.yml <<'EOF'
# Buildiary: Frappe 16 + ERPNext 16 + Buildiary. Settings are in .env (root only).
name: buildiary

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
        if [ -d "sites/$$SITE" ]; then echo "Site already there"; else bench new-site --mariadb-user-host-login-scope='%' --admin-password="$$ADMIN_PASSWORD" --db-root-username=root --db-root-password="$$DB_ROOT_PASSWORD" --install-app erpnext --install-app buildiary --set-default "$$SITE" || exit 1; fi;
        bench --site "$$SITE" set-config host_name "https://$$SITE";
        if [ -f /data/buildiary-data.json ]; then bench --site "$$SITE" execute buildiary.setup.local_site --kwargs "{'data_file': '/data/buildiary-data.json'}" || exit 1; else bench --site "$$SITE" execute buildiary.setup.local_site || exit 1; fi;
        bench --site "$$SITE" clear-cache;
        echo "BUILDIARY READY: https://$$SITE"
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
      # one site per address (customers' workspaces, the console, the first site)
      FRAPPE_SITE_NAME_HEADER: $$host
      SOCKETIO: websocket:9000
      UPSTREAM_REAL_IP_ADDRESS: 172.16.0.0/12
      UPSTREAM_REAL_IP_HEADER: X-Forwarded-For
      UPSTREAM_REAL_IP_RECURSIVE: "off"
      PROXY_READ_TIMEOUT: 120
      CLIENT_MAX_BODY_SIZE: 50m
    networks:
      default:
      web:
        aliases: [buildiary-frontend]
    depends_on:
      - backend
      - websocket

  queue-long:
    <<: *app
    command: ["bench", "worker", "--queue", "long,default,short"]
    environment:
      <<: *redis-env
      # Buildiary Cloud prepares new customers' sites in this worker
      DB_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
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

# ---- 5. Helper scripts: backup (daily, to S3) and update (new version of Buildiary)
cat > sites.sh <<'EOF'
#!/bin/bash
# Lists the real sites (not the blank ones kept ready for new customers).
cd /opt/buildiary
docker compose exec -T backend bash -c 'cd sites && for d in */; do d=${d%/}; [ -f "$d/site_config.json" ] || continue; case "$d" in pool-*) ;; *) echo "$d";; esac; done'
EOF
cat > backup.sh <<'EOF'
#!/bin/bash
# Full backup (database and files) of every site, kept 14 days on the server and 60 days in S3.
cd /opt/buildiary && set -a && . ./.env && set +a
export PATH="$PATH:/snap/bin"
VOL="$(docker volume inspect buildiary_sites -f '{{.Mountpoint}}')"
FAIL=0
for S in $(./sites.sh); do
  if docker compose exec -T backend bench --site "$S" backup --with-files --compress >/dev/null; then
    docker compose exec -T backend bash -c "find sites/$S/private/backups -type f -mtime +14 -delete"
    aws s3 sync "$VOL/$S/private/backups" "s3://$BUCKET/sites/$S/" --region "$REGION" --only-show-errors && echo "$(date '+%F %T') $S backed up"
  else
    echo "$(date '+%F %T') $S backup FAILED"; FAIL=1
  fi
done
exit $FAIL
EOF
cat > update.sh <<'EOF'
#!/bin/bash
# Gets the latest Buildiary image and applies it to the site, keeping all data (backup first).
exec 9>/run/buildiary-update.lock; flock 9
cd /opt/buildiary && set -a && . ./.env && set +a
/opt/buildiary/ecr-login.sh || echo "Could not sign in to the image store"
./backup.sh || echo "Backup failed; continuing"
docker compose pull && docker compose up -d || exit 1
CODE=$(docker wait "$(docker compose ps -a -q create-site)")
[ "$CODE" = "0" ] || { docker compose logs --tail 60 create-site; exit 1; }
OK=1
for S in $(./sites.sh) $(docker compose exec -T backend bash -c 'cd sites && ls -d pool-* 2>/dev/null'); do
  docker compose exec -T backend bench --site "$S" migrate >/dev/null && docker compose exec -T backend bench --site "$S" clear-cache || { echo "$S: migrate FAILED"; OK=0; }
done
docker image prune -af >/dev/null 2>&1 || true   # old versions no container uses (about 4.5 GB each)
[ "$OK" = 1 ] && echo "BUILDIARY UPDATED"
EOF
cat > buildiary-console.sh <<'EOF'
#!/bin/bash
# Creates the Buildiary console (sign-up page, customers, payments) at https://$BUILDIARY_CONSOLE and
# registers the first site as SMH Global's own (free) workspace. Safe to run again.
cd /opt/buildiary && set -a && . ./.env && set +a
C="$BUILDIARY_CONSOLE"
if ! docker compose exec -T backend test -f "sites/$C/site_config.json"; then
  docker compose exec -T backend bench new-site "$C" --mariadb-user-host-login-scope='%' --admin-password="$ADMIN_PASSWORD" \
    --db-root-username=root --db-root-password="$DB_ROOT_PASSWORD" --install-app erpnext --install-app buildiary || exit 1
fi
docker compose exec -T backend bench --site "$C" set-config host_name "https://$C"
docker compose exec -T backend bench --site "$C" execute buildiary.saas.console.setup_console --kwargs "{'base': '$BUILDIARY_BASE', 'control': '$C'}" || exit 1
docker compose exec -T backend bench --site "$C" execute buildiary.saas.console.register_site --kwargs "{'host': '$SITE', 'company': '$BUILDIARY_OWN_COMPANY', 'email': '$BUILDIARY_OWN_EMAIL'}" || exit 1
docker compose exec -T backend bench --site "$C" enable-scheduler
docker compose exec -T backend bench --site "$C" clear-cache
echo "BUILDIARY CONSOLE READY: https://$C (sign in as Administrator)"
EOF
cat > autoupdate.sh <<'EOF'
#!/bin/bash
# Every 15 minutes: when a newer Buildiary image has been published, apply it (update.sh backs up first).
exec 9>/run/buildiary-update.lock; flock -n 9 || exit 0
cd /opt/buildiary && set -a && . ./.env && set +a
/opt/buildiary/ecr-login.sh || echo "Could not sign in to the image store"
# a new version needs about 5 GB free: clear old versions first if the disk is getting full
[ "$(df --output=avail -BG / | tail -1 | tr -dc 0-9)" -ge 8 ] || docker image prune -af >/dev/null 2>&1
docker pull -q "$IMAGE" >/dev/null 2>&1 || { echo "$(date '+%F %T') could not download $IMAGE ($(df -h --output=avail / | tail -1 | tr -d ' ') free)"; exit 0; }
NEW=$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null)
RUNNING=$(docker inspect -f '{{.Image}}' "$(docker compose ps -q backend)" 2>/dev/null)
[ -n "$NEW" ] && [ "$NEW" != "$RUNNING" ] || exit 0
echo "$(date '+%F %T') new image $(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE")"
exec 9>&-
/opt/buildiary/update.sh
# the website's theme and pages travel in the same image
[ -x /opt/website/update.sh ] && /opt/website/update.sh >> /var/log/buildiary-website.log 2>&1 || true
EOF
chmod 700 backup.sh update.sh autoupdate.sh sites.sh buildiary-console.sh
mkdir -p /opt/website
cat > /opt/website/update.sh <<'EOF'
#!/bin/bash
# Refreshes the website (theme and pages) from the files inside the running Buildiary image. The first
# run installs it (deploy/website/setup.sh).
#   /opt/website/update.sh            (pages edited in WordPress are kept)
#   /opt/website/update.sh --force    (also overwrite pages edited in WordPress)
set -euo pipefail
cd /opt/buildiary && set -a && . ./.env && set +a
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
docker run --rm --entrypoint tar "$IMAGE" -C /home/frappe/frappe-bench/apps/buildiary/deploy -cf - website | tar -xf - -C "$T"
echo "$(date '+%F %T') website from $(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE" | cut -c1-8)"
bash "$T/website/setup.sh" "$@"
EOF
chmod 700 /opt/website/update.sh
echo "*/15 * * * * root /opt/buildiary/autoupdate.sh >> /var/log/buildiary-update.log 2>&1" > /etc/cron.d/buildiary-autoupdate
echo "30 2 * * * root /opt/buildiary/backup.sh >> /var/log/buildiary-backup.log 2>&1" > /etc/cron.d/buildiary-backup

# S3 bucket for backups (private, encrypted, old backups removed after 60 days)
if ! aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null \
    && aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true \
    && aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{"Rules":[{"ID":"expire-old-backups","Status":"Enabled","Filter":{"Prefix":""},"Expiration":{"Days":60}}]}' \
    && echo "Backup bucket $BUCKET ready" || echo "Could not create the backup bucket $BUCKET"
fi

# ---- 6. Start Buildiary
docker compose pull -q
docker compose up -d
CODE=$(docker wait "$(docker compose ps -a -q create-site)")
docker compose logs --no-log-prefix --tail 30 create-site
if [ "$CODE" = "0" ]; then echo "== BUILDIARY READY: https://$SITE"; else echo "== BUILDIARY SETUP FAILED (code $CODE)"; fi
