"""Runs on a customer's workspace (a site whose site_config has a "buildiary" block):

- setup(): the first set-up after the console prepared the site (company, the owner's
  sign-in, language, first project);
- enforce(): on every request, a workspace whose trial or paid time has run out (after the
  grace days) only opens the sign-in and the Plan & billing page;
- banner(): what the field app shows about the plan (trial days left, payment due);
- billing() / pay(): the Plan & billing page, which talks to the console;
- usage(): the console's daily look at users, projects and storage;
- the plan's limits on people and projects.

A site without the "buildiary" block (a laptop, the owner's own server) has none of this.
"""

import hmac
import json
import os

import frappe
from frappe import _
from frappe.utils import add_days, cint, date_diff, flt, getdate, nowdate
from werkzeug.exceptions import HTTPException
from werkzeug.wrappers import Response


def buildiary():
	return frappe.conf.get("buildiary") or {}


# ---------------------------------------------------------------- where the plan stands
def state(m=None):
	m = m if m is not None else buildiary()
	if not m:
		return None
	today = getdate(nowdate())
	out = {"tenant": m.get("tenant"), "plan": m.get("plan"), "mode": m.get("mode") or "owner", "internal": bool(m.get("internal")),
		"trial_data": m.get("trial_data") or "Own data", "data_reset": m.get("data_reset") or "",
		"trial_ends": m.get("trial_ends"), "paid_until": m.get("paid_until"), "status": "Active", "days_left": None, "blocked": False}
	if m.get("internal"):
		return out
	grace = cint(m.get("grace_days"))
	end = getdate(m["paid_until"]) if m.get("paid_until") else (getdate(m["trial_ends"]) if m.get("trial_ends") else None)
	if m.get("status") in ("Suspended", "Cancelled"):  # stopped by the console
		out.update(status=m["status"], blocked=True)
		return out
	if not end:
		out["status"] = m.get("status") or "Trial"
		return out
	left = date_diff(end, today)
	out["days_left"] = left
	if left >= 0:
		out["status"] = "Active" if m.get("paid_until") else "Trial"
	elif -left <= grace:
		out.update(status="Payment due", grace_left=grace + left)
	else:
		out.update(status="Suspended", blocked=True)
	return out


def banner():
	"""For the field app: the plan line on the home screen and in My settings."""
	s = state()
	if not s:
		return None
	show = s["status"] == "Trial" or s["status"] == "Payment due" or (s["status"] == "Active" and s["days_left"] is not None and s["days_left"] <= 7)
	return dict(s, show=bool(show and not s["internal"]), url="/billing")


# ---------------------------------------------------------------- the check on every request
OPEN_PATHS = (
	"/assets/", "/files/", "/billing", "/login", "/logout", "/update-password", "/favicon", "/robots.txt", "/website_script.js",
	"/api/method/login", "/api/method/logout", "/api/method/ping", "/api/method/buildiary.saas.tenant.", "/api/method/frappe.auth.get_logged_user",
	"/api/method/frappe.www.login.", "/api/method/frappe.core.doctype.user.user.reset_password", "/api/method/frappe.core.doctype.user.user.update_password",
	"/api/method/frappe.core.doctype.user.user.test_password_strength", "/api/method/buildiary.field.set_language", "/manifest.json", "/sw.js",
	"/api/method/buildiary.field.forgot_password", "/api/method/buildiary.field.qr", "/scan", "/api/method/buildiary.scan.",
)


class _Go(HTTPException):
	code = 302

	def __init__(self, url):
		super().__init__()
		self.url = url

	def get_response(self, environ=None, scope=None):
		r = Response(status=302)
		r.headers["Location"] = self.url
		return r


class _Ended(HTTPException):
	code = 402

	def get_response(self, environ=None, scope=None):
		msg = _("This workspace's plan has ended. The owner can renew it in Plan & billing.")
		body = {"exc_type": "SubscriptionEnded", "message": msg, "_server_messages": json.dumps([json.dumps({"message": msg, "indicator": "red"})])}
		return Response(json.dumps(body), status=402, content_type="application/json")


def enforce():
	m = frappe.conf.get("buildiary")
	if not m or m.get("internal"):
		return
	req = getattr(frappe.local, "request", None)
	if not req:
		return
	s = state(m)
	if not s["blocked"]:
		return
	path = req.path or "/"
	if path.startswith(OPEN_PATHS):
		return
	if path.startswith("/api/") or path.startswith("/socket.io"):
		raise _Ended()
	raise _Go("/billing")


def home_page(user=None):
	"""People on a Buildiary workspace land in the field app after signing in."""
	if buildiary() and (user or frappe.session.user) not in ("Guest", None):
		return "field"
	return None


# ---------------------------------------------------------------- plan limits
def _limit(key):
	return cint((buildiary().get("limits") or {}).get(key))


def check_users(doc, method=None):
	n = _limit("users")
	if not n or doc.user_type != "System User" or doc.name in ("Administrator", "Guest") or frappe.flags.in_install or frappe.flags.buildiary_setup:
		return
	have = frappe.db.count("User", {"user_type": "System User", "enabled": 1, "name": ["not in", ["Administrator", "Guest"]]})
	if have >= n:
		frappe.throw(_("Your plan allows {0} people to sign in, and all are in use. Turn off someone who has left, or move to a bigger plan in Plan & billing.").format(n),
			title=_("Plan limit"))


def check_projects(doc, method=None):
	n = _limit("projects")
	if not n or frappe.flags.in_install or frappe.flags.buildiary_setup:
		return
	have = frappe.db.count("Project", {"status": "Open"})
	if have >= n:
		frappe.throw(_("Your plan allows {0} open project(s). Close a finished one or move to a bigger plan in Plan & billing.").format(n), title=_("Plan limit"))


# ---------------------------------------------------------------- first set-up (run by the console)
def _abbr(name):
	words = [w for w in "".join(c if c.isalnum() or c == " " else " " for c in name).split() if w[:1].isascii() and w[:1].isalpha()]
	ab = "".join(w[0] for w in words[:4]).upper()
	if len(ab) < 2:
		ab = ("".join(c for c in name if c.isascii() and c.isalpha())[:3] or "CO").upper()
	return ab[:5]


def _fy(month):
	today = getdate(nowdate())
	year = today.year if today.month >= month else today.year - 1
	start = getdate(f"{year}-{month:02d}-01")
	end = add_days(getdate(f"{year + 1}-{month:02d}-01"), -1)
	return str(start), str(end)


def setup(payload):
	"""bench --site <workspace> execute buildiary.saas.tenant.setup --kwargs "{'payload': '<file>'}"

	The file (written by the console in the site's private folder) is read and deleted."""
	from buildiary.saas.common import country_info

	with open(payload, encoding="utf-8") as f:
		d = frappe._dict(json.load(f))
	try:
		os.remove(payload)
	except OSError:
		pass
	frappe.flags.buildiary_setup = True
	ci = country_info(d.country)
	lang = d.language if d.language in ("en", "ur", "ar") else "en"
	if not frappe.is_setup_complete():
		from frappe.desk.page.setup_wizard.setup_wizard import setup_complete

		fy_start, fy_end = _fy(ci["fy_month"])
		frappe.local.lang = "en"
		result = setup_complete({
			"language": "English", "country": d.country, "timezone": ci["time_zone"], "currency": ci["currency"],
			"full_name": d.contact_name, "company_name": d.company_name, "company_abbr": _abbr(d.company_name), "chart_of_accounts": "Standard",
			"fy_start_date": fy_start, "fy_end_date": fy_end, "setup_demo": 0,
		})
		if (result or {}).get("status") != "ok":
			raise Exception(f"Setup wizard did not finish: {result}")
		frappe.db.commit()
	# the owner's sign-in
	from frappe.desk.page.setup_wizard.setup_wizard import create_or_update_user

	create_or_update_user({"email": d.email, "full_name": d.contact_name, "password": d.password})
	u = frappe.get_doc("User", d.email)
	u.role_profile_name = "Buildiary Owner"
	u.language = lang
	u.time_zone = ci["time_zone"]
	u.mobile_no = d.phone or u.mobile_no
	u.flags.ignore_permissions = True
	u.save()
	for code in ("ur", "ar"):
		if frappe.db.exists("Language", code):
			frappe.db.set_value("Language", code, "enabled", 1)
	frappe.db.set_single_value("System Settings", "language", lang)
	# a fresh start: everyone who could sign in before, with their own passwords
	if d.people:
		_people_back(d.people)
	# the first project and the site store (with sample data, the sample project comes next instead)
	co = frappe.db.get_single_value("Global Defaults", "default_company")
	project = None if d.sample else _first_project(d.project_name or d.company_name)
	store = frappe.db.get_value("Warehouse", {"company": co, "warehouse_name": "Stores", "is_group": 0}, "name")
	from buildiary.debris import default_on

	vals = {"default_project": project, "site_warehouse": store, "country_code": ci["dial"] or "92", "debris_enabled": 1 if default_on(d.country) else 0}
	for k, v in vals.items():
		if v or k == "debris_enabled":
			frappe.db.set_single_value("Buildiary Settings", k, v)
	from buildiary.setup import apply_settings

	apply_settings()
	# the project's store, and the usual stages of building (changed later in Project > Tasks)
	from buildiary.projects import standard_schedule

	if project and store and frappe.db.has_column("Project", "buildiary_store"):
		frappe.db.set_value("Project", project, "buildiary_store", store, update_modified=False)
	if project:
		standard_schedule(project, lang=lang)
	frappe.db.commit()
	frappe.clear_cache()
	print("BUILDIARY SETUP OK", d.company_name)
	return "ok"


def _first_project(pname):
	co = frappe.db.get_single_value("Global Defaults", "default_company")
	project = frappe.db.get_value("Project", {"project_name": pname}, "name")
	if not project:
		project = frappe.get_doc({"doctype": "Project", "project_name": pname, "company": co, "status": "Open", "expected_start_date": nowdate(), "is_active": "Yes"}).insert(ignore_permissions=True).name
	return project


def first_project():
	"""bench --site <workspace> execute buildiary.saas.tenant.first_project (when the sample project could not be added)."""
	from buildiary.projects import standard_schedule

	frappe.flags.buildiary_setup = True
	co = frappe.db.get_single_value("Global Defaults", "default_company")
	project = _first_project(co)
	frappe.db.set_single_value("Buildiary Settings", "default_project", project)
	store = frappe.db.get_single_value("Buildiary Settings", "site_warehouse")
	if store and frappe.db.has_column("Project", "buildiary_store"):
		frappe.db.set_value("Project", project, "buildiary_store", store, update_modified=False)
	standard_schedule(project, lang=frappe.db.get_single_value("System Settings", "language") or "en")
	frappe.db.commit()
	print("FIRST PROJECT OK")


def export_people(path):
	"""bench --site <workspace> execute buildiary.saas.tenant.export_people: everyone who signs in, with their roles and
	password hashes, for a fresh start (the console reads the file and deletes it)."""
	rows = []
	for u in frappe.get_all("User", filters={"user_type": "System User", "name": ["not in", ["Administrator", "Guest"]]},
			fields=["name", "email", "first_name", "last_name", "enabled", "language", "mobile_no", "role_profile_name", "time_zone", "username"]):
		u.roles = frappe.get_all("Has Role", filters={"parent": u.name, "parenttype": "User"}, pluck="role")
		h = frappe.db.sql("select `password` from `__Auth` where doctype='User' and name=%s and fieldname='password' and encrypted=0", u.name)
		u.hash = h[0][0] if h else None
		rows.append(u)
	with open(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as f:
		json.dump(rows, f, default=str)
	print("PEOPLE OK", len(rows))


def _people_back(people):
	"""After a fresh start: the same sign-ins, roles and passwords (no welcome emails)."""
	for p in people:
		email = p.get("name")
		if not email or email in ("Administrator", "Guest"):
			continue
		if frappe.db.exists("User", email):
			u = frappe.get_doc("User", email)
		else:
			u = frappe.get_doc({"doctype": "User", "email": p.get("email") or email, "first_name": p.get("first_name") or email, "last_name": p.get("last_name"),
				"send_welcome_email": 0, "user_type": "System User"})
			u.flags.no_welcome_mail = True
			u.insert(ignore_permissions=True)
		u.enabled = p.get("enabled", 1)
		u.language = p.get("language") or u.language
		u.mobile_no = p.get("mobile_no") or u.mobile_no
		u.time_zone = p.get("time_zone") or u.time_zone
		if p.get("role_profile_name") and frappe.db.exists("Role Profile", p["role_profile_name"]):
			u.role_profile_name = p["role_profile_name"]
		have = {r.role for r in u.roles}
		for r in p.get("roles") or []:
			if r not in have and frappe.db.exists("Role", r) and r not in ("All", "Guest", "Desk User"):
				u.append("roles", {"role": r})
		u.flags.ignore_permissions = True
		u.save()
		if p.get("hash"):
			frappe.db.sql("""insert into `__Auth` (doctype, name, fieldname, `password`, encrypted) values ('User', %s, 'password', %s, 0)
				on duplicate key update `password` = values(`password`), encrypted = 0""", (u.name, p["hash"]))


# ---------------------------------------------------------------- the console asks
def _key_ok(key):
	mine = frappe.conf.get("buildiary_key")
	return bool(mine and key and hmac.compare_digest(str(mine), str(key)))


@frappe.whitelist(allow_guest=True, methods=["POST"])
def usage(key=None):
	"""Users, projects and storage, for the console (signed with this workspace's key)."""
	if not _key_ok(key):
		raise frappe.PermissionError
	users = frappe.db.count("User", {"user_type": "System User", "enabled": 1, "name": ["not in", ["Administrator", "Guest"]]})
	projects = frappe.db.count("Project", {"status": "Open"})
	size = 0
	for sub in ("public/files", "private/files"):
		for root, _dirs, files in os.walk(frappe.get_site_path(*sub.split("/"))):
			for f in files:
				try:
					size += os.path.getsize(os.path.join(root, f))
				except OSError:
					pass
	last = frappe.db.sql("select max(last_active) from tabUser where name not in ('Administrator', 'Guest')")[0][0]
	return {"users": users, "projects": projects, "storage_mb": round(size / 1048576, 1), "last_active": str(last) if last else None}


# ---------------------------------------------------------------- Plan & billing (the owner)
def _owner():
	if frappe.session.user == "Guest":
		raise frappe.PermissionError
	if "System Manager" not in frappe.get_roles():
		frappe.throw(_("Only the owner can see the plan and pay. Ask the owner."), frappe.PermissionError)


def _console(method, data):
	from buildiary.saas.common import call_site

	m = buildiary()
	if not m.get("console"):
		frappe.throw(_("This workspace isn't connected to Buildiary."))
	return call_site(m["console"], method, dict(data, tenant=m.get("tenant"), key=frappe.conf.get("buildiary_key")))


@frappe.whitelist()
def billing():
	_owner()
	info = _console("buildiary.saas.api.account", {}) or {}
	info["state"] = state()
	info["me"] = {"name": frappe.utils.get_fullname(frappe.session.user), "email": frappe.session.user}
	return info


@frappe.whitelist(methods=["POST"])
def pay(data):
	"""The owner reports a bank transfer (with a photo of the receipt); the console checks it."""
	_owner()
	d = frappe._dict(json.loads(data) if isinstance(data, str) else data)
	if not d.plan or d.billing_period not in ("Monthly", "Yearly"):
		frappe.throw(_("Choose the plan and how often you pay."))
	if flt(d.amount) <= 0:
		frappe.throw(_("Enter the amount you paid."))
	if not (d.reference or "").strip() and not d.proof:
		frappe.throw(_("Enter the transaction reference or add a photo of the receipt."))
	if d.proof and len(d.proof) > 7_000_000:
		frappe.throw(_("The photo is too large. Send a smaller one (under 5 MB)."))
	d.submitted_by = f"{frappe.utils.get_fullname(frappe.session.user)} <{frappe.session.user}>"
	return _console("buildiary.saas.api.payment_submit", {"data": d})


@frappe.whitelist(methods=["POST"])
def trial_choice(choice):
	"""The owner: keep the trial data, or start fresh, when the subscription starts."""
	_owner()
	return _console("buildiary.saas.api.trial_choice", {"choice": choice})


@frappe.whitelist(methods=["POST"])
def fresh_start(confirm=None):
	"""The owner clears the sample data now (typing the workspace name to confirm)."""
	_owner()
	if (confirm or "").strip().lower() != str(buildiary().get("tenant") or "").lower():
		frappe.throw(_("Type the workspace name exactly."))
	return _console("buildiary.saas.api.fresh_start", {})

