#!/bin/bash
# One time only: the server takes the single name Buildiary. On the server, as root, after
# one-name-aws.sh has run in CloudShell and the new image (…/buildiary:16) has been built:
#
#   bash one-name.sh            the switch (the apps are offline for about 10 minutes)
#   bash one-name.sh --undo     back to the old set-up (only before --finish; the old data was copied, not moved)
#   bash one-name.sh --finish   once everything is checked: removes the old folders, data copies and images
#   bash one-name.sh --resume   continues a switch that stopped after the data was copied (from the rename step)
#
# What changes: /opt/mimaar becomes /opt/buildiary (Docker project "buildiary", its data volumes copied),
# the app and its records take the name Buildiary (patches/rename_pre.py, then migrate), SMH Global's own
# Villa 31 workspace moves to https://villa31.<domain> (the old address redirects), the old web app
# (/opt/office) is retired, the website's theme, settings and admin user take the new name, the
# Administrator and WordPress admin passwords are renewed (Parameter Store /buildiary/...), and the
# scheduled jobs, logs and backups (new bucket) use the new name. Log: /var/log/buildiary-one-name.log
set -uo pipefail
export PATH="$PATH:/snap/bin"
OLD=/opt/mimaar; NEW=/opt/buildiary; KEEP=/root/one-name
MODE="${1:-}"
exec > >(tee -a /var/log/buildiary-one-name.log) 2>&1
say() { printf '\n== %s  %s\n' "$(date '+%T')" "$*"; }
die() { echo "STOPPED: $*"; exit 1; }
gen() { tr -dc 'A-HJ-NP-Za-km-z2-9' </dev/urandom | head -c "$1"; }
VOLS="db-data redis-queue-data sites logs"
W() { docker compose -f /opt/website/compose.yml --project-directory /opt/website run --rm --no-deps -T --entrypoint wp cli "$@"; }
[ "$(id -u)" = 0 ] || die "run as root"

# ---------------------------------------------------------------- back to the old set-up
if [ "$MODE" = "--undo" ]; then
  [ -f "$KEEP/before.tar.gz" ] || die "nothing to undo ($KEEP/before.tar.gz is missing)"
  say "Stopping Buildiary"
  [ -f "$NEW/compose.yml" ] && (cd "$NEW" && docker compose down)
  say "Old settings, front door, website files and scheduled jobs back"
  rm -f /opt/edge/sites/buildiary.caddy /opt/edge/sites/zz-buildiary.caddy /etc/cron.d/buildiary-*
  tar -xzf "$KEEP/before.tar.gz" -C /
  [ -d "$KEEP/office" ] && [ ! -d /opt/office ] && mv "$KEEP/office" /opt/office
  say "Website database back"
  (cd /opt/website && docker compose up -d db && sleep 8 \
    && docker compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" wordpress' < "$KEEP/wordpress.sql" && docker compose up -d)
  say "Old apps starting"
  (cd "$OLD" && docker compose up -d)
  [ -d /opt/office ] && (cd /opt/office && docker compose up -d)
  docker compose -f /opt/edge/compose.yml restart caddy
  echo "UNDONE: the old set-up is running again (the Buildiary folder and data copies are left in place)"
  exit 0
fi

# ---------------------------------------------------------------- tidy up after the checks
if [ "$MODE" = "--finish" ]; then
  [ -f "$NEW/.env" ] && (cd "$NEW" && docker compose ps -q backend | grep -q .) || die "Buildiary is not running: not removing anything"
  say "Removing the old folders, the old data copies (a backup is in S3) and old images"
  rm -rf "$OLD" /opt/office "$KEEP"
  for v in $VOLS; do docker volume rm "mimaar_$v" 2>/dev/null && echo "removed mimaar_$v"; done
  docker image prune -af >/dev/null 2>&1 || true
  docker volume prune -f >/dev/null 2>&1 || true
  echo "FINISHED: only Buildiary is left ($(df -h --output=avail / | tail -1 | tr -d ' ') free)"
  exit 0
fi

# ---------------------------------------------------------------- the switch
[ -f "$OLD/.env" ] || die "$OLD/.env not found (already switched?)"
mkdir -p "$KEEP" && chmod 700 "$KEEP"
set -a; . "$OLD/.env"; set +a
REG="${ECR:-${IMAGE%%/*}}"; ACCOUNT="${REG%%.*}"; REGION="${REGION:-ap-south-1}"
BASE="${MABNI_BASE:?MABNI_BASE missing}"; CONSOLE="${MABNI_CONSOLE:-my.$BASE}"
OLDSITE="$SITE"; NEWSITE="villa31.$BASE"
NEWIMG="$REG/buildiary:16"; NEWBUCKET="buildiary-backups-$ACCOUNT-$REGION"
OFFICE=$(awk 'NR==1{print $1}' /opt/edge/sites/office.caddy 2>/dev/null)
echo "Villa 31: $OLDSITE -> $NEWSITE; console $CONSOLE; image $NEWIMG; backups $NEWBUCKET"

block() { awk -v f="$1" 'BEGIN{h="cat > " f " <<\047EOF\047"} $0==h{p=1;next} p&&$0=="EOF"{exit} p' "$KEEP/bootstrap.sh"; }
if [ "$MODE" != "--resume" ]; then
say "Checks (nothing is changed yet)"
aws s3api head-bucket --bucket "$NEWBUCKET" --region "$REGION" || die "bucket $NEWBUCKET not reachable: run one-name-aws.sh in CloudShell first"
"$OLD/ecr-login.sh" || die "could not sign in to the image store"
docker pull -q "$NEWIMG" >/dev/null || die "could not download $NEWIMG (is the new image built?)"
APP=/home/frappe/frappe-bench/apps/buildiary
docker run --rm --entrypoint test "$NEWIMG" -f "$APP/buildiary/patches/rename_pre.py" || die "the image has no rename step: build it from the latest code"
docker run --rm --entrypoint cat "$NEWIMG" "$APP/deploy/aws/bootstrap.sh" > "$KEEP/bootstrap.sh" || die "no bootstrap.sh in the image"
IP=$(curl -s -H "X-aws-ec2-metadata-token: $(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')" http://169.254.169.254/latest/meta-data/public-ipv4)
[ "$(getent ahostsv4 "$NEWSITE" | awk '{print $1; exit}')" = "$IP" ] || die "$NEWSITE does not point at this server ($IP)"
NEED=$(du -sm /var/lib/docker/volumes/mimaar_db-data/_data | cut -f1); FREE=$(df --output=avail -BM / | tail -1 | tr -dc 0-9)
[ "$FREE" -gt $((NEED * 2 + 3000)) ] || die "not enough free disk for the data copy (${FREE} MB free, data ${NEED} MB)"
# the new install script holds the helper scripts: each quoted block "cat > NAME <<'EOF'" ... "EOF"
for f in compose.yml sites.sh backup.sh update.sh buildiary-console.sh autoupdate.sh /opt/edge/sites/zz-buildiary.caddy /opt/website/update.sh; do
  [ -n "$(block "$f")" ] || die "$f not found in the new bootstrap.sh"
done

say "Waiting for any update in progress, then a backup of every site to $NEWBUCKET"
exec 9>/run/mimaar-update.lock; flock -w 1800 9 || die "an update is still running"
cd "$OLD"
VOL="$(docker volume inspect mimaar_sites -f '{{.Mountpoint}}')"
for S in $(./sites.sh); do
  docker compose exec -T backend bench --site "$S" backup --with-files --compress >/dev/null || die "backup of $S failed"
  aws s3 sync "$VOL/$S/private/backups" "s3://$NEWBUCKET/sites/$S/" --region "$REGION" --only-show-errors || die "upload of $S failed"
  echo "$S backed up"
done
docker compose -f /opt/website/compose.yml --project-directory /opt/website exec -T db sh -c 'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction wordpress' > "$KEEP/wordpress.sql" \
  && [ -s "$KEEP/wordpress.sql" ] || die "website database backup failed"
gzip -c "$KEEP/wordpress.sql" | aws s3 cp - "s3://$NEWBUCKET/website/wordpress-$(date +%F).sql.gz" --region "$REGION" --only-show-errors || die "website backup upload failed"
tar --ignore-failed-read -czf "$KEEP/before.tar.gz" -C / opt/mimaar opt/edge opt/website/.env opt/website/compose.yml opt/website/update.sh opt/website/theme \
  opt/website/mu-plugins opt/website/content opt/website/import.php $(cd / && ls -d etc/cron.d/mimaar-* etc/cron.d/mabni-* etc/sysctl.d/*mimaar* 2>/dev/null) || die "could not save the old settings"
echo "old settings saved in $KEEP/before.tar.gz"

say "Stopping the old apps (offline from here)"
for c in /etc/cron.d/mimaar-* /etc/cron.d/mabni-*; do [ -f "$c" ] && rm -f "$c"; done
docker compose down || die "could not stop the old apps"
[ -d /opt/office ] && (cd /opt/office && docker compose down) && mv /opt/office "$KEEP/office"

say "Copying the data to the new name"
for v in $VOLS; do
  if docker volume inspect "buildiary_$v" >/dev/null 2>&1; then echo "buildiary_$v already there"; continue; fi
  docker volume create --label com.docker.compose.project=buildiary --label com.docker.compose.volume="$v" "buildiary_$v" >/dev/null
  docker run --rm --user 0 --entrypoint sh -v "mimaar_$v:/from:ro" -v "buildiary_$v:/to" "$NEWIMG" -c 'cp -a /from/. /to/' \
    || { docker volume rm "buildiary_$v" >/dev/null; die "copy of $v failed"; }
  echo "buildiary_$v ($(du -sh "/var/lib/docker/volumes/buildiary_$v/_data" | cut -f1))"
done

say "The new folder $NEW"
mkdir -p "$NEW/data"
[ -f "$OLD/data/mimaar-data.json" ] && cp "$OLD/data/mimaar-data.json" "$NEW/data/buildiary-data.json"
sed -e "s|^SITE=.*|SITE=$NEWSITE|" -e "s|^IMAGE=.*|IMAGE=$NEWIMG|" -e "s|^BUCKET=.*|BUCKET=$NEWBUCKET|" \
    -e 's/^MABNI_/BUILDIARY_/' -e 's/^MIMAAR_/BUILDIARY_/' "$OLD/.env" > "$NEW/.env"
chmod 600 "$NEW/.env"
cp "$OLD/ecr-login.sh" "$NEW/ecr-login.sh"
for f in compose.yml sites.sh backup.sh update.sh buildiary-console.sh autoupdate.sh; do block "$f" > "$NEW/$f"; done
block /opt/edge/sites/zz-buildiary.caddy > "$KEEP/zz-buildiary.caddy"
chmod 700 "$NEW"/*.sh
fi
# from here on the new settings count (the old ones were loaded above for the backup and the paths)
cd "$NEW" || die "$NEW missing"
set -a; . "$NEW/.env"; set +a

say "Renaming the app in every site's records, then updating each site (migrate)"
docker compose up -d --wait db redis-cache redis-queue || die "database did not start"
docker compose run --rm --no-deps -T -e OLDSITE="$OLDSITE" -e NEWSITE="$NEWSITE" -e CONSOLE="$CONSOLE" --entrypoint bash backend -c '
  set -u; cd /home/frappe/frappe-bench
  ls -1 apps > sites/apps.txt
  env/bin/python - <<PY
import json, os
p = "sites/apps.json"
if os.path.exists(p):
    a = json.load(open(p))
    for old in ("mimaar", "mabni"):
        if old in a: a["buildiary"] = a.pop(old)
    json.dump(a, open(p, "w"), indent=1)
PY
  cd sites
  ALL=$(for d in */; do d=${d%/}; [ -f "$d/site_config.json" ] && echo "$d"; done)
  rm -f */locks/*.lock
  /home/frappe/frappe-bench/env/bin/python ../apps/buildiary/buildiary/patches/rename_pre.py $ALL || exit 1
  [ -d "$OLDSITE" ] && [ ! -e "$NEWSITE" ] && mv "$OLDSITE" "$NEWSITE"
  cd ..
  bench --site "$NEWSITE" set-config host_name "https://$NEWSITE"
  grep -q "\"default_site\": \"$OLDSITE\"" sites/common_site_config.json && bench set-config -g default_site "$NEWSITE"
  FAIL=0
  for S in $(cd sites && for d in */; do d=${d%/}; [ -f "$d/site_config.json" ] && echo "$d"; done); do
    echo "-- $S"; bench --site "$S" migrate > /tmp/migrate.log 2>&1 && echo "   migrated" || { tail -25 /tmp/migrate.log; FAIL=1; }
  done
  bench --site "$CONSOLE" execute buildiary.saas.console.move_site --kwargs "{\"old\": \"$OLDSITE\", \"new\": \"$NEWSITE\"}" || FAIL=1
  exit $FAIL' || die "renaming or migrate failed: see above. To go back: bash one-name.sh --undo"

say "Starting Buildiary"
docker compose up -d || die "could not start Buildiary"
CODE=$(docker wait "$(docker compose ps -a -q create-site)")
[ "$CODE" = "0" ] || { docker compose logs --tail 40 create-site; echo "WARNING: the first-site step ended with code $CODE"; }
for S in $(./sites.sh) $(docker compose exec -T backend bash -c 'cd sites && ls -d pool-* 2>/dev/null'); do
  docker compose exec -T backend bench --site "$S" clear-cache >/dev/null 2>&1 || true
done

say "Front door: new names, Villa 31 at https://$NEWSITE, old addresses redirect"
cat > /tmp/Caddyfile.new <<EOF
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
cat /tmp/Caddyfile.new > /opt/edge/Caddyfile   # in place: the Caddy container has this very file mounted
cat > /opt/edge/sites/buildiary.caddy <<EOF
$NEWSITE {
	encode zstd gzip
	header X-Robots-Tag "noindex, nofollow"
	reverse_proxy buildiary-frontend:8080
}
EOF
cp "$KEEP/zz-buildiary.caddy" /opt/edge/sites/zz-buildiary.caddy
rm -f /opt/edge/sites/mimaar.caddy /opt/edge/sites/zz-mabni.caddy /opt/edge/sites/office.caddy
OA=/opt/edge/sites/old-addresses.caddy
grep -q "^$OLDSITE " "$OA" 2>/dev/null || printf '%s {\n\tredir https://%s{uri} 308\n}\n' "$OLDSITE" "$NEWSITE" >> "$OA"
[ -z "$OFFICE" ] || grep -q "^$OFFICE " "$OA" || printf '%s {\n\tredir https://%s/field 302\n}\n' "$OFFICE" "$NEWSITE" >> "$OA"
sed -i 's/Mabni/Buildiary/g; s/Mimaar/Buildiary/g' "$OA" /opt/edge/sites/website.caddy 2>/dev/null || true
docker compose -f /opt/edge/compose.yml restart caddy

say "Website: settings, admin user and theme under the new name"
sed -i 's/^MABNI_/BUILDIARY_/; s/^MIMAAR_/BUILDIARY_/' /opt/website/.env
block /opt/website/update.sh > /opt/website/update.sh && chmod 700 /opt/website/update.sh
W db query "UPDATE IGNORE wp_options SET option_name=CONCAT('buildiary_', SUBSTRING(option_name, 7)) WHERE option_name LIKE 'mabni\_%'"
W db query "UPDATE IGNORE wp_options SET option_name='theme_mods_buildiary' WHERE option_name='theme_mods_mabni'"
W db query "DELETE FROM wp_options WHERE option_name LIKE 'mabni\_%' OR option_name LIKE '\_transient\_%mabni\_%' OR option_name='theme_mods_mabni'"
W db query "UPDATE wp_postmeta SET meta_key=CONCAT('_buildiary_', SUBSTRING(meta_key, 8)) WHERE meta_key LIKE '\_mabni\_%'"
W db query "UPDATE wp_users SET user_login='buildiary-admin', user_nicename='buildiary-admin', display_name=IF(display_name='mabni-admin','buildiary-admin',display_name) WHERE user_login='mabni-admin'"
W db query "UPDATE wp_usermeta SET meta_value='buildiary-admin' WHERE meta_key='nickname' AND meta_value='mabni-admin'"
/opt/website/update.sh >> /var/log/buildiary-website.log 2>&1 || { tail -20 /var/log/buildiary-website.log; echo "WARNING: website update failed"; }
tail -2 /var/log/buildiary-website.log
W search-replace 'wp-content/themes/mabni/' 'wp-content/themes/buildiary/' --all-tables --skip-columns=guid --quiet || true
W cache flush >/dev/null 2>&1 || true
echo "website theme: $(W option get template 2>/dev/null); admin user: $(W user list --field=user_login 2>/dev/null | tr '\n' ' ')"

say "New passwords (read them in Systems Manager > Parameter Store)"
. "$NEW/.env"
if [[ "$ADMIN_PASSWORD" =~ ^(Mimaar|Mabni)- ]]; then
  P="Buildiary-$(gen 12)"; OK=1
  for S in "$NEWSITE" "$CONSOLE"; do docker compose exec -T backend bench --site "$S" set-admin-password "$P" >/dev/null || OK=0; done
  [ "$OK" = 1 ] && sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$P|" "$NEW/.env" && ADMIN_PASSWORD="$P" && echo "Administrator password renewed (Villa 31 and the console)"
fi
aws ssm put-parameter --region "$REGION" --name /buildiary/administrator-password --type SecureString --value "$ADMIN_PASSWORD" --overwrite >/dev/null \
  && echo "saved: /buildiary/administrator-password" || echo "WARNING: could not save /buildiary/administrator-password (it is in $NEW/.env)"
WPP=$(grep '^WP_ADMIN_PASSWORD=' /opt/website/.env | cut -d= -f2-)
if [[ "$WPP" =~ ^(Mimaar|Mabni)- ]]; then
  P="Buildiary-$(gen 14)"
  W user update buildiary-admin --user_pass="$P" --skip-email >/dev/null && sed -i "s|^WP_ADMIN_PASSWORD=.*|WP_ADMIN_PASSWORD=$P|" /opt/website/.env && WPP="$P" \
    && echo "WordPress admin password renewed (user buildiary-admin)"
fi
aws ssm put-parameter --region "$REGION" --name /buildiary/wordpress-admin-password --type SecureString --value "$WPP" --overwrite >/dev/null \
  && echo "saved: /buildiary/wordpress-admin-password" || echo "WARNING: could not save /buildiary/wordpress-admin-password (it is in /opt/website/.env)"
unset P WPP

say "Scheduled jobs, logs and system settings under the new name"
echo "*/15 * * * * root /opt/buildiary/autoupdate.sh >> /var/log/buildiary-update.log 2>&1" > /etc/cron.d/buildiary-autoupdate
echo "30 2 * * * root /opt/buildiary/backup.sh >> /var/log/buildiary-backup.log 2>&1" > /etc/cron.d/buildiary-backup
for f in /var/log/mimaar-*.log /var/log/mabni-*.log; do
  [ -f "$f" ] || continue
  n="${f/mimaar-/buildiary-}"; n="${n/mabni-/buildiary-}"
  if [ -f "$n" ]; then cat "$f" "$n" > "$n.tmp" && mv "$n.tmp" "$n" && rm -f "$f"; else mv "$f" "$n"; fi
done
for f in /etc/sysctl.d/*mimaar*; do [ -f "$f" ] && mv "$f" /etc/sysctl.d/90-buildiary.conf; done
docker image rm "$REG/mabni-office:latest" >/dev/null 2>&1 || true

say "Checks"
B() { docker compose exec -T backend "$@"; }
for S in $(./sites.sh); do
  n=$(B bench --site "$S" mariadb -N -e "select count(*) from tabDocType where name like '%Mabni%' or name like '%Mimaar%' or module like '%Mabni%' or module like '%Mimaar%'" 2>/dev/null | tr -dc 0-9)
  echo "$S: old names left in the records: ${n:-?}"
done
sleep 5
for u in "https://$NEWSITE/api/method/ping" "https://$CONSOLE/start" "https://$BASE/" "https://$NEWSITE/field"; do
  echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' --max-time 90 "$u")"
done
echo "https://$OLDSITE/app -> $(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 60 "https://$OLDSITE/app")"
docker ps --format '{{.Names}}' | sort | tr '\n' ' '; echo
echo "SWITCHED: Villa 31 is at https://$NEWSITE. When all is well: bash one-name.sh --finish"
