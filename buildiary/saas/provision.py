"""Preparing customers' workspaces (runs on the console, in the background workers).

A new site with ERPNext takes a few minutes to create, so the console keeps a small pool of
blank sites ready (named pool-xxxxxx). When a customer signs up, a pool site is renamed to
their address and set up for them (company, sign-in, language): about a minute.
"""

import fcntl
import json
import os
import shutil
import subprocess
import time

import frappe
from frappe.utils import add_days, now_datetime, nowdate

from buildiary.saas.common import base_domain, bench_path, conf_block, host_for, is_control, push, settings, site_dir, sites_path, update_site_config

READY = ".buildiary-ready"


def _db_root_password():
	return os.environ.get("DB_ROOT_PASSWORD") or frappe.conf.get("buildiary_db_root_password")


def _bench(args, timeout=1800):
	env = dict(os.environ)
	env.pop("DB_ROOT_PASSWORD", None)  # passed only where needed, never logged
	p = subprocess.run(["bench", *args], cwd=bench_path(), capture_output=True, text=True, timeout=timeout, env=env)
	out = (p.stdout or "")[-4000:] + (p.stderr or "")[-4000:]
	return p.returncode, out


class _Lock:
	"""One pool or set-up job at a time on this bench."""

	def __init__(self, name, wait=True):
		self.path = os.path.join(sites_path(), f".buildiary-{name}.lock")
		self.wait = wait

	def __enter__(self):
		self.f = open(self.path, "w")
		try:
			fcntl.flock(self.f, fcntl.LOCK_EX | (0 if self.wait else fcntl.LOCK_NB))
		except BlockingIOError:
			self.f.close()
			return None
		return self

	def __exit__(self, *a):
		try:
			fcntl.flock(self.f, fcntl.LOCK_UN)
			self.f.close()
		except Exception:
			pass


def pool_sites(ready_only=True):
	out = []
	for d in sorted(os.listdir(sites_path())):
		if d.startswith("pool-") and os.path.isdir(site_dir(d)):
			if not ready_only or os.path.exists(os.path.join(site_dir(d), READY)):
				out.append(d)
	return out


def make_pool_site():
	"""Create one blank site with ERPNext and Buildiary (a few minutes)."""
	pw = _db_root_password()
	if not pw:
		frappe.log_error("Buildiary: no database root password for new workspaces (DB_ROOT_PASSWORD)")
		return None
	name = "pool-" + frappe.generate_hash(length=8).lower()
	admin = frappe.generate_hash(length=24)
	code, out = _bench(["new-site", name, "--db-root-username", "root", "--db-root-password", pw, "--admin-password", admin,
		"--install-app", "erpnext", "--install-app", "buildiary", "--mariadb-user-host-login-scope=%"], timeout=3000)
	if code != 0 or not os.path.exists(os.path.join(site_dir(name), "site_config.json")):
		frappe.log_error("Buildiary: could not prepare a workspace", out.replace(pw, "***"))
		return None
	open(os.path.join(site_dir(name), READY), "w").close()
	return name


def tick():
	"""Every 10 minutes on the console: keep the pool full and pick up waiting sign-ups."""
	if not is_control():
		return
	for t in frappe.get_all("Buildiary Tenant", filters={"status": "Waiting"}, pluck="name"):
		frappe.enqueue("buildiary.saas.provision.provision", queue="long", timeout=3600, tenant=t, job_id=f"buildiary-provision-{t}", deduplicate=True)
	frappe.enqueue("buildiary.saas.provision.fill_pool", queue="long", timeout=3600, job_id="buildiary-fill-pool", deduplicate=True)


def fill_pool():
	if not is_control():
		return
	with _Lock("pool", wait=False) as lock:
		if not lock:
			return
		want = max(0, int(settings().pool_size or 0))
		while len(pool_sites(ready_only=False)) < want:
			# a half-made pool site (no ready mark) older than an hour is left from a failed run
			for d in pool_sites(ready_only=False):
				if d not in pool_sites() and time.time() - os.path.getmtime(site_dir(d)) > 3600:
					_drop(d)
			if not make_pool_site():
				break


def _drop(site):
	pw = _db_root_password()
	if pw:
		_bench(["drop-site", site, "--db-root-username", "root", "--db-root-password", pw, "--no-backup", "--force"], timeout=600)
	if os.path.isdir(site_dir(site)):
		shutil.rmtree(site_dir(site), ignore_errors=True)


def _log(t, line):
	t.db_set("log", ((t.log or "") + f"{now_datetime():%Y-%m-%d %H:%M:%S}  {line}\n")[-20000:], update_modified=False)
	frappe.db.commit()


def provision(tenant):
	"""Give a signed-up customer their workspace."""
	if not is_control():
		return
	t = frappe.get_doc("Buildiary Tenant", tenant)
	if t.status not in ("Waiting", "Failed"):
		return
	with _Lock("provision"):
		t.reload()
		if t.status not in ("Waiting", "Failed"):
			return
		t.db_set("status", "Setting up")
		frappe.db.commit()
		host = host_for(t.subdomain)
		try:
			_provision(t, host)
		except Exception:
			frappe.db.rollback()
			t.reload()
			_log(t, "Failed:\n" + frappe.get_traceback()[-3000:])
			t.db_set("status", "Failed")
			frappe.db.commit()
			from buildiary.saas.common import notify_admins

			notify_admins(f"Buildiary: set-up failed for {t.company_name}", f"Workspace {host} could not be set up. Open the customer in the console and press Retry set-up.")
			return
	frappe.enqueue("buildiary.saas.provision.fill_pool", queue="long", timeout=3600, job_id="buildiary-fill-pool", deduplicate=True)


def _provision(t, host):
	if not os.path.isdir(site_dir(host)):
		pool = pool_sites()
		if pool:
			os.rename(site_dir(pool[0]), site_dir(host))
			try:
				os.remove(os.path.join(site_dir(host), READY))
			except OSError:
				pass
			t.db_set("pool_site", pool[0])
			_log(t, f"Using the prepared workspace {pool[0]}")
		else:
			_log(t, "No prepared workspace; creating one (a few minutes)")
			made = make_pool_site()
			if not made:
				raise Exception("Could not create the site")
			os.rename(site_dir(made), site_dir(host))
			os.remove(os.path.join(site_dir(host), READY))
	update_site_config(host, "host_name", f"https://{host}")
	key = frappe.generate_hash(length=40)
	t.tenant_key = key
	t.site_host = host
	t.save(ignore_permissions=True)
	update_site_config(host, "buildiary_key", key)
	payload = os.path.join(site_dir(host), "private", "buildiary-setup.json")
	os.makedirs(os.path.dirname(payload), exist_ok=True)
	with open(os.open(payload, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as f:
		json.dump({"company_name": t.company_name, "contact_name": t.contact_name, "email": t.email, "phone": t.phone, "country": t.country,
			"language": t.language, "mode": t.mode, "password": t.get_password("first_password", raise_exception=False) or frappe.generate_hash(length=16)}, f)
	_log(t, "Setting up the company and the owner's sign-in")
	code, out = _bench(["--site", host, "execute", "buildiary.saas.tenant.setup", "--kwargs", json.dumps({"payload": payload})], timeout=1800)
	if os.path.exists(payload):
		os.remove(payload)
	if code != 0 or "BUILDIARY SETUP OK" not in out:
		raise Exception("Set-up did not finish:\n" + out[-2500:])
	t.reload()
	t.status = "Trial"
	t.signed_up_on = t.signed_up_on or now_datetime()
	t.trial_ends = add_days(nowdate(), int(settings().trial_days or 7))
	t.save(ignore_permissions=True)
	from frappe.utils.password import remove_encrypted_password

	remove_encrypted_password("Buildiary Tenant", t.name, "first_password")
	update_site_config(host, "buildiary", conf_block(t))
	_log(t, f"Ready: https://{host}")
	frappe.db.commit()
	from buildiary.saas import billing

	billing.welcome(t)
