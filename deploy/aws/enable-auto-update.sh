#!/bin/bash
# For a Mimaar server set up before automatic updates existed: installs the update scripts
# (the same as bootstrap.sh writes) and applies the latest image now. Run on the server as root.
set -e
cd /opt/mimaar
cat > update.sh <<'EOF'
#!/bin/bash
# Gets the latest Mimaar ERP image and applies it to the site, keeping all data (backup first).
exec 9>/run/mimaar-update.lock; flock 9
cd /opt/mimaar && set -a && . ./.env && set +a
./backup.sh || echo "Backup failed; continuing"
docker compose pull && docker compose up -d || exit 1
CODE=$(docker wait "$(docker compose ps -a -q create-site)")
[ "$CODE" = "0" ] || { docker compose logs --tail 60 create-site; exit 1; }
docker compose exec -T backend bench --site "$SITE" migrate && docker compose exec -T backend bench --site "$SITE" clear-cache && echo "MIMAAR UPDATED"
EOF
cat > autoupdate.sh <<'EOF'
#!/bin/bash
# Every 15 minutes: when a newer Mimaar ERP image has been published, apply it (update.sh backs up first).
exec 9>/run/mimaar-update.lock; flock -n 9 || exit 0
cd /opt/mimaar && set -a && . ./.env && set +a
docker pull -q "$IMAGE" >/dev/null 2>&1 || exit 0
NEW=$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null)
RUNNING=$(docker inspect -f '{{.Image}}' "$(docker compose ps -q backend)" 2>/dev/null)
[ -n "$NEW" ] && [ "$NEW" != "$RUNNING" ] || exit 0
echo "$(date '+%F %T') new image $(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE")"
exec 9>&-
/opt/mimaar/update.sh
EOF
chmod 700 backup.sh update.sh autoupdate.sh
echo "*/15 * * * * root /opt/mimaar/autoupdate.sh >> /var/log/mimaar-update.log 2>&1" > /etc/cron.d/mimaar-autoupdate
echo "Automatic updates are on (every 15 minutes)."
/opt/mimaar/update.sh
