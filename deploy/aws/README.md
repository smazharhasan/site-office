# Mabni (Mimaar ERP) on AWS

One Ubuntu 24.04 server runs everything in Docker:

- **edge**: Caddy, the front door with automatic https certificates. Each app or website gets
  one file in `/opt/edge/sites/` (e.g. `shop.caddy`), so more apps and websites can sit beside Mabni.
- **mimaar**: Frappe 16 + ERPNext 16 + Mabni, one site per customer workspace plus the console,
  its MariaDB database and Redis, in `/opt/mimaar` (settings in `/opt/mimaar/.env`, root only).
- **website**: the Mabni website (WordPress) in `/opt/website`.
- **office**: the old Mimaar web app at `https://office.<base>/site-office/`, in `/opt/office`.
- Daily backup of every site at 02:30 (Pakistan time) to the private S3 bucket `mimaar-backups-<account>-<region>`.
- The Administrator password is in Systems Manager > Parameter Store > `/mimaar/administrator-password`;
  the WordPress admin password in `/mabni/wordpress-admin-password`.
- Admin access through Systems Manager Session Manager (no SSH port is open).

## Private images

The GitHub repository can be private. GitHub Actions builds the images and puts them in this AWS
account's private image store (Amazon ECR); nothing on GitHub needs to be public:

| Image | Built from | Uploaded by (GitHub role) | Used for |
|---|---|---|---|
| `<account>.dkr.ecr.<region>.amazonaws.com/mabni:16` | branch `erpnext-app` | `mabni-github-server` | the server (and the website files) |
| `<account>.dkr.ecr.<region>.amazonaws.com/mabni-office:latest` | branch `main` | `mabni-github-office` | the old Mimaar web app |

GitHub signs in to AWS with OpenID Connect: no password or key is stored in GitHub. Each role
trusts one branch of one repository and may only upload to its own store. The server (role
`mimaar-server`) may only download. Set up once in CloudShell with `bash private-images.sh`;
an existing server is switched over once with `use-private-images.sh` (run as root on the server).

## Set-up and updates

New server: in AWS CloudShell, from a copy of this folder, put `mimaar-data.json.gz.b64` (the old
app's data, gzip + base64) beside `launch.sh`, run `bash private-images.sh` and then `bash launch.sh`.

Updates are automatic: every 15 minutes the server checks for a newer image and applies it with
`/opt/mimaar/update.sh` (backup first, then migrate every site), then refreshes the website from the
same image. Logs: `/var/log/mimaar-update.log`, `/var/log/mabni-website.log`, `/var/log/mabni-office.log`.

## Moving to the product's own domain

1. Register the domain (e.g. buildiary.app) at a registrar.
2. In CloudShell: `bash domain-dns.sh buildiary.app buildiaryapp.com` creates the Route 53 zones
   (the domain and *.domain point at the server) and prints the nameservers to set at the registrar.
3. Once the names resolve, on the server as root: `bash rebase.sh buildiary.app buildiaryapp.com`.
   It backs up, moves the console and every customer's workspace to the new domain, moves the
   website, and makes the old addresses redirect to the new ones.
