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
			"language": t.language, "mode": t.mode, "password": t.get_password("first_password", raise_exception=False) or frappe.generate_hash(length=16),
			"sample": t.trial_data == "Sample data"}, f)
	_log(t, "Setting up the company and the owner's sign-in")
	code, out = _bench(["--site", host, "execute", "buildiary.saas.tenant.setup", "--kwargs", json.dumps({"payload": payload})], timeout=1800)
	if os.path.exists(payload):
		os.remove(payload)
	if code != 0 or "BUILDIARY SETUP OK" not in out:
		raise Exception("Set-up did not finish:\n" + out[-2500:])
	if t.trial_data == "Sample data":
		_sample(t, host)
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


# ---------------------------------------------------------------- sample data, and a fresh start
def _sample(t, host):
	"""The sample project for the customer's country (a minute or two). If it fails, the trial goes on with their own data."""
	_log(t, "Adding the sample project")
	code, out = _bench(["--site", host, "execute", "buildiary.saas.demo.make_cli", "--kwargs", json.dumps({"country": t.country, "lang": t.language or "en"})], timeout=1800)
	if code != 0 or "SAMPLE PROJECT READY" not in out:
		_log(t, "The sample project could not be added; the trial starts empty:\n" + out[-1500:])
		t.db_set("trial_data", "Own data")
		frappe.db.commit()
		code, out = _bench(["--site", host, "execute", "buildiary.saas.tenant.first_project"], timeout=600)


def fresh_start_due(t):
	"""At the paid subscription: sample data is always cleared; the customer's own data only if they chose a fresh start."""
	return (t.trial_data == "Sample data" or t.at_subscription == "Start fresh") and t.data_reset not in ("Waiting", "Running", "Done")


def queue_reset(t, why=""):
	t.db_set({"data_reset": "Waiting"})
	_log(t, f"Fresh start asked for{(': ' + why) if why else ''}")
	frappe.db.commit()
	frappe.enqueue("buildiary.saas.provision.reset", queue="long", timeout=3600, tenant=t.name, job_id=f"buildiary-reset-{t.name}", deduplicate=True, enqueue_after_commit=True)


def reset(tenant):
	"""A fresh start: the workspace is replaced by a new one at the same address, with the same company, the same
	people and their passwords. The old one is archived on the server (a full backup), not deleted."""
	if not is_control():
		return
	t = frappe.get_doc("Buildiary Tenant", tenant)
	if not t.site_host or t.data_reset != "Waiting":
		return
	with _Lock("provision"):
		t.reload()
		if t.data_reset != "Waiting":
			return
		t.db_set("data_reset", "Running")
		frappe.db.commit()
		try:
			_reset(t, t.site_host)
		except Exception:
			frappe.db.rollback()
			t.reload()
			_log(t, "Fresh start failed:\n" + frappe.get_traceback()[-3000:])
			t.db_set("data_reset", "Failed")
			frappe.db.commit()
			from buildiary.saas.common import notify_admins

			notify_admins(f"Buildiary: fresh start failed for {t.company_name}", f"The workspace {t.site_host} could not be started fresh. It is unchanged unless the log says the old one was archived. Open the customer in the console.")
			return
	frappe.enqueue("buildiary.saas.provision.fill_pool", queue="long", timeout=3600, job_id="buildiary-fill-pool", deduplicate=True)


def _reset(t, host):
	if not os.path.isdir(site_dir(host)):
		raise Exception(f"No workspace at {host}")
	# 1. the people and their passwords, from the old workspace
	people_file = os.path.join(site_dir(host), "private", "buildiary-people.json")
	code, out = _bench(["--site", host, "execute", "buildiary.saas.tenant.export_people", "--kwargs", json.dumps({"path": people_file})], timeout=600)
	if code != 0 or "PEOPLE OK" not in out:
		raise Exception("Could not read the people:\n" + out[-1500:])
	with open(people_file, encoding="utf-8") as f:
		people = json.load(f)
	os.remove(people_file)
	_log(t, f"Kept {len(people)} sign-in(s)")
	# 2. a new workspace, set up while it still has its pool name
	pool = pool_sites()
	new = pool[0] if pool else make_pool_site()
	if not new:
		raise Exception("Could not create the site")
	try:
		os.remove(os.path.join(site_dir(new), READY))
	except OSError:
		pass
	update_site_config(new, "host_name", f"https://{host}")
	key = frappe.generate_hash(length=40)
	update_site_config(new, "buildiary_key", key)
	payload = os.path.join(site_dir(new), "private", "buildiary-setup.json")
	os.makedirs(os.path.dirname(payload), exist_ok=True)
	with open(os.open(payload, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as f:
		json.dump({"company_name": t.company_name, "contact_name": t.contact_name, "email": t.email, "phone": t.phone, "country": t.country,
			"language": t.language, "mode": t.mode, "password": frappe.generate_hash(length=16), "people": people}, f)
	_log(t, f"Setting up the new workspace ({new})")
	code, out = _bench(["--site", new, "execute", "buildiary.saas.tenant.setup", "--kwargs", json.dumps({"payload": payload})], timeout=1800)
	if os.path.exists(payload):
		os.remove(payload)
	if code != 0 or "BUILDIARY SETUP OK" not in out:
		_drop(new)
		raise Exception("Set-up of the new workspace did not finish:\n" + out[-2500:])
	# 3. the old workspace is archived (backed up and moved aside), the new one takes its address
	_archive(host)
	os.rename(site_dir(new), site_dir(host))
	t.reload()
	t.tenant_key = key
	t.pool_site = new
	t.trial_data = "Own data"
	t.at_subscription = "Keep my data"
	t.data_reset = "Done"
	t.reset_on = now_datetime()
	t.save(ignore_permissions=True)
	update_site_config(host, "buildiary", conf_block(t))
	_log(t, f"Fresh start ready: https://{host}")
	frappe.db.commit()


def _archive(site):
	"""bench drop-site with its backup: the database and files are saved, and the folder moves to sites/.archived."""
	pw = _db_root_password()
	if not pw:
		raise Exception("No database root password (DB_ROOT_PASSWORD)")
	keep = os.path.join(sites_path(), ".archived")  # on the sites volume, so it outlives a new server image
	os.makedirs(keep, exist_ok=True)
	code, out = _bench(["drop-site", site, "--db-root-username", "root", "--db-root-password", pw, "--force", "--archived-sites-path", keep], timeout=1800)
	if code != 0 or os.path.isdir(site_dir(site)):
		raise Exception("Could not archive the old workspace:\n" + out.replace(pw, "***")[-1500:])
