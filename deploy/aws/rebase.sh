#!/bin/bash
# Moves Buildiary from its temporary address to its own domain. On the server, as root:
#   bash rebase.sh buildiary.app [buildiaryapp.com]
# - the console my.<old> becomes my.<new>; customers' workspaces <name>.<old> become <name>.<new>
#   (site folders renamed, data untouched, backup first);
# - the website moves to https://<new> (and www.<new>), open to search engines;
# - the old addresses redirect to the new ones; the extra domain (if given) redirects to <new>;
# - SMH Global's own Mimaar site and the old Mimaar web app keep their addresses.
# DNS must already point <new>, *.<new> (and the extra domain) at this server (domain-dns.sh).
set -euo pipefail
NEW="${1:?the new domain, e.g. buildiary.app}"; EXTRA="${2:-}"
export PATH="$PATH:/snap/bin"
cd /opt/mimaar; set -a; . ./.env; set +a
OLD="$MABNI_BASE"; OLD_C="$MABNI_CONSOLE"; NEW_C="my.$NEW"
[ "$OLD" != "$NEW" ] || { echo "Already on $NEW"; exit 0; }
TOK=$(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOK" http://169.254.169.254/latest/meta-data/public-ipv4)
for h in "$NEW" "www.$NEW" "$NEW_C" "dns-check.$NEW" ${EXTRA:+"$EXTRA"}; do
  got=$(getent ahostsv4 "$h" | awk '{print $1; exit}')
  [ "$got" = "$IP" ] || { echo "DNS: $h points to '${got:-nothing}', not $IP. Set the DNS first (domain-dns.sh)."; exit 1; }
done
echo "== backup"; ./backup.sh || { echo "Backup failed: stopping"; exit 1; }
B() { docker compose exec -T backend "$@"; }
echo "== console $OLD_C -> $NEW_C"
if B test -d "sites/$OLD_C" && ! B test -e "sites/$NEW_C"; then B mv "sites/$OLD_C" "sites/$NEW_C"; fi
B bench --site "$NEW_C" set-config host_name "https://$NEW_C"
B bench --site "$NEW_C" execute mimaar.saas.console.rebase --kwargs "{'base': '$NEW'}" | tee /tmp/rebase.out
grep -q "^BASE .* -> $NEW" /tmp/rebase.out || { echo "The console did not take the new address: stopping"; exit 1; }
sed -i "s|^MABNI_BASE=.*|MABNI_BASE=$NEW|; s|^MABNI_CONSOLE=.*|MABNI_CONSOLE=$NEW_C|" .env
sed -i "s|header_up Host $OLD_C|header_up Host $NEW_C|" /opt/edge/Caddyfile
echo "== website"
sed -i "s|^MABNI_CONSOLE=.*|MABNI_CONSOLE=$NEW_C|" /opt/website/.env
W() { docker compose -f /opt/website/compose.yml --project-directory /opt/website run --rm -T --entrypoint wp cli "$@"; }
W search-replace "https://$OLD" "https://$NEW" --all-tables --skip-columns=guid --quiet || true
W option update home "https://$NEW" >/dev/null; W option update siteurl "https://$NEW" >/dev/null; W option update blog_public 1 >/dev/null
/opt/website/update.sh   # new website.caddy for the new address, Caddy reloaded
echo "== the old addresses redirect"
{
  printf '%s, www.%s {\n\tredir https://%s{uri} permanent\n}\n' "$OLD" "$OLD" "$NEW"
  printf '%s {\n\tredir https://%s{uri} permanent\n}\n' "$OLD_C" "$NEW_C"
  grep '^MOVED ' /tmp/rebase.out | while read -r _ a b; do printf '%s {\n\tredir https://%s{uri} permanent\n}\n' "$a" "$b"; done
  [ -z "$EXTRA" ] || printf '%s, www.%s {\n\tredir https://%s{uri} permanent\n}\n' "$EXTRA" "$EXTRA" "$NEW"
} > /opt/edge/sites/old-addresses.caddy
docker compose -f /opt/edge/compose.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile
for s in $(./sites.sh); do B bench --site "$s" clear-cache >/dev/null 2>&1 || true; done
echo "== check (the first visit to each address fetches its certificate)"
for u in "https://$NEW/" "https://$NEW_C/api/method/ping" "https://$NEW_C/start"; do
  echo "$u -> $(curl -s -o /dev/null -w '%{http_code}' --max-time 90 "$u")"
done
echo "REBASED: $OLD -> $NEW"
