#!/bin/bash
# On the Mabni server (as root), once the private image stores exist (private-images.sh):
#  - new versions come from the private image store in AWS (ECR) instead of public GitHub; the server
#    signs in with its own AWS role (download only), no password is stored;
#  - the website (theme and pages) is refreshed from the files inside the same image after each update;
#  - the old Mimaar web app is served at https://office.$MABNI_BASE/site-office/ from its own private
#    image, checked every 15 minutes.
# Safe to run again.
set -euo pipefail
export PATH="$PATH:/snap/bin"
cd /opt/mimaar
set -a; . ./.env; set +a
REGION="${REGION:-ap-south-1}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REG="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
say() { printf '\n== %s\n' "$*"; }

say "Signing in to the private image store"
cat > ecr-login.sh <<EOF
#!/bin/bash
# Signs Docker in to the private image store with the server's own AWS role (valid 12 hours).
export PATH="\$PATH:/snap/bin"
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $REG >/dev/null
EOF
chmod 700 ecr-login.sh
./ecr-login.sh
docker pull -q "$REG/mabni:16" >/dev/null || { echo "No image in $REG/mabni yet: build it first"; exit 1; }

say "Updates come from $REG/mabni:16"
sed -i "s|^IMAGE=.*|IMAGE=$REG/mabni:16|" .env
grep -q '^ECR=' .env || echo "ECR=$REG" >> .env
for f in update.sh autoupdate.sh; do
  grep -q ecr-login.sh "$f" || sed -i 's|^cd /opt/mimaar && set -a && . ./.env && set +a$|&\n/opt/mimaar/ecr-login.sh \|\| echo "Could not sign in to the image store"|' "$f"
done
grep -q website/update.sh autoupdate.sh || cat >> autoupdate.sh <<'EOF'
# the website's theme and pages travel in the same image
[ -x /opt/website/update.sh ] && /opt/website/update.sh >> /var/log/mabni-website.log 2>&1 || true
EOF

say "Website updates from the image"
mkdir -p /opt/website
cat > /opt/website/update.sh <<'EOF'
#!/bin/bash
# Refreshes the website (theme and pages) from the files inside the running Mabni image.
#   /opt/website/update.sh            (pages edited in WordPress are kept)
#   /opt/website/update.sh --force    (also overwrite pages edited in WordPress)
set -euo pipefail
cd /opt/mimaar && set -a && . ./.env && set +a
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
docker run --rm --entrypoint tar "$IMAGE" -C /home/frappe/frappe-bench/apps/mimaar/deploy -cf - website | tar -xf - -C "$T"
echo "$(date '+%F %T') website from $(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE" | cut -c1-8)"
bash "$T/website/setup.sh" "$@"
EOF
chmod 700 /opt/website/update.sh

say "The old Mimaar web app at https://office.$MABNI_BASE/site-office/"
mkdir -p /opt/office
cat > /opt/office/compose.yml <<EOF
# The old Mimaar web app (Site Office and its field app), from the private image store.
name: office
services:
  web:
    image: $REG/mabni-office:latest
    restart: unless-stopped
    networks:
      web:
        aliases: [office-web]
networks:
  web: { external: true }
EOF
cat > /opt/office/update.sh <<'EOF'
#!/bin/bash
# Every 15 minutes: start or update the old Mimaar web app when a newer image is there.
cd /opt/office || exit 0
/opt/mimaar/ecr-login.sh || exit 0
docker compose pull -q 2>/dev/null || exit 0
docker compose up -d --remove-orphans 2>&1 | grep -E "Recreat|Creat|Start" | sed "s/^/$(date '+%F %T') /" || true
EOF
chmod 700 /opt/office/update.sh
echo "*/15 * * * * root /opt/office/update.sh >> /var/log/mabni-office.log 2>&1" > /etc/cron.d/mabni-office
cat > /opt/edge/sites/office.caddy <<EOF
office.$MABNI_BASE {
	encode zstd gzip
	@root path /
	redir @root /site-office/
	reverse_proxy office-web:80
}
EOF
/opt/office/update.sh || true
docker compose -f /opt/edge/compose.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || echo "Caddy reload failed"

say "Applying the image from the private store now (backup first)"
./autoupdate.sh >> /var/log/mimaar-update.log 2>&1 || true
tail -3 /var/log/mimaar-update.log
echo "PRIVATE IMAGES IN USE: $(grep '^IMAGE=' .env)"
# "office" is now taken on this server: customers can't use it as their workspace name
docker compose exec -T backend bench --site "$MABNI_CONSOLE" execute mimaar.saas.console.reserve --kwargs "{'names': 'office mimaar'}" || true
