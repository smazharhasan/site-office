# Mimaar ERP on AWS

One Ubuntu 24.04 server runs everything in Docker:

- **edge**: Caddy, the front door with automatic https certificates. Each app or website gets
  one file in `/opt/edge/sites/` (e.g. `shop.caddy`), so more apps and websites can sit beside Mimaar.
- **mimaar**: Frappe 16 + ERPNext 16 + Mimaar (image `ghcr.io/smazharhasan/mimaar-erpnext:16`),
  its MariaDB database and Redis, in `/opt/mimaar` (settings in `/opt/mimaar/.env`, root only).
- Daily backup at 02:30 (Pakistan time) to the private S3 bucket `mimaar-backups-<account>-<region>`.
- The Administrator password is in Systems Manager > Parameter Store > `/mimaar/administrator-password`.
- Admin access through Systems Manager Session Manager (no SSH port is open).

Set-up: in AWS CloudShell, put `mimaar-data.json.gz.b64` (the old app's data, gzip + base64)
next to `launch.sh`, then `bash launch.sh`.

Updates are automatic: every 15 minutes the server checks for a newer image (built by GitHub
Actions on each push to `erpnext-app`) and applies it with `/opt/mimaar/update.sh` (backup first,
then migrate). Log: `/var/log/mimaar-update.log`. A server set up before this existed is switched
over once with `deploy/aws/enable-auto-update.sh`.
