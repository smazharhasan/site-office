"""Public sign-up on the console (my.<domain>/start): a new customer picks a workspace name,
optionally confirms their email with a code, and gets a workspace with a free trial."""

import hashlib
import re

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import add_to_date, cint, get_datetime, now_datetime, validate_email_address

from mimaar.saas.common import NAME_RE, host_for, is_control, notify_admins, settings, site_dir


def _need_control():
	if not is_control():
		raise frappe.PermissionError


def _reserved():
	return {x.strip().lower() for x in (settings().reserved_names or "").split() if x.strip()}


def _name_problem(sub):
	import os

	sub = (sub or "").strip().lower()
	if not NAME_RE.match(sub):
		return _("Use 3 to 30 letters, numbers or dashes, starting with a letter.")
	if sub in _reserved() or sub.startswith("pool-") or "--" in sub:
		return _("This name is reserved. Try another.")
	if frappe.db.exists("Mabni Tenant", sub) or os.path.isdir(site_dir(host_for(sub))):
		return _("This name is taken. Try another.")
	return None


def suggest(company):
	base = re.sub(r"[^a-z0-9]+", "-", (company or "").lower()).strip("-")[:24].strip("-")
	if not base or not base[0].isalpha():
		base = "site-" + base if base else "site"
	for i in range(0, 50):
		cand = base if i == 0 else f"{base}-{i + 1}"
		if not _name_problem(cand):
			return cand
	return base + "-" + frappe.generate_hash(length=4).lower()


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=60, seconds=600)
def check(name=None, company=None):
	_need_control()
	if company and not name:
		s = suggest(company)
		return {"ok": True, "name": s, "host": host_for(s)}
	p = _name_problem(name)
	return {"ok": not p, "message": p, "name": (name or "").lower(), "host": host_for((name or "").lower())}


def _hash(code):
	return hashlib.sha256(f"{frappe.local.site}:{code}".encode()).hexdigest()


def _send_code(t):
	import secrets

	code = f"{secrets.randbelow(1000000):06d}"
	t.db_set({"verify_code": _hash(code), "verify_expires": add_to_date(now_datetime(), minutes=30), "verify_tries": 0})
	frappe.sendmail(recipients=[t.email], subject=f"{code} is your Mabni code",
		message=f"<p>Your code to start Mabni is</p><p style='font-size:28px;font-weight:700;letter-spacing:4px'>{code}</p><p>It works for 30 minutes.</p>", now=True)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=8, seconds=3600)
def start(data=None):
	"""Sign up. Returns a token the page uses to follow the set-up."""
	_need_control()
	s = settings()
	if not s.signups_open:
		frappe.throw(_("New sign-ups are closed for now. Please contact us."))
	d = frappe._dict(frappe.parse_json(data) or {})
	if d.website:  # a field people don't see; robots fill it
		frappe.throw(_("Please try again."))
	for k in ("contact_name", "email", "company_name", "subdomain", "password", "country", "mode"):
		if not (d.get(k) or "").strip():
			frappe.throw(_("Please fill in every field."))
	if not cint(d.agree):
		frappe.throw(_("Please accept the terms to continue."))
	email = d.email.strip().lower()
	if not validate_email_address(email):
		frappe.throw(_("Enter a valid email address."))
	if len(d.password) < 8 or not re.search(r"[A-Za-z]", d.password) or not re.search(r"\d", d.password):
		frappe.throw(_("Use a password of at least 8 characters with letters and numbers."))
	sub = d.subdomain.strip().lower()
	p = _name_problem(sub)
	if p:
		frappe.throw(p)
	if not frappe.db.exists("Country", d.country):
		frappe.throw(_("Choose your country."))
	mode = "Builder" if d.mode == "Builder" else "Owner"
	have = frappe.db.get_value("Mabni Tenant", {"email": email, "status": ["not in", ["Failed", "Cancelled", "Verifying email"]]}, ["name", "site_host"], as_dict=True)
	if have:
		frappe.throw(_("This email already has a workspace at {0}. Sign in there, or contact us for another one.").format(have.site_host or have.name))
	plan = frappe.db.get_value("Mabni Plan", {"mode": mode, "is_active": 1}, "name", order_by="sort_order asc")
	verify = bool(s.require_email_verification)
	t = frappe.get_doc({
		"doctype": "Mabni Tenant", "subdomain": sub, "company_name": d.company_name.strip()[:120], "contact_name": d.contact_name.strip()[:120], "email": email,
		"phone": (d.phone or "").strip()[:40], "country": d.country, "city": (d.city or "").strip()[:80], "language": d.language if d.language in ("en", "ur", "ar") else "en",
		"mode": mode, "plan": plan, "billing_period": "Monthly", "status": "Verifying email" if verify else "Waiting", "signed_up_on": now_datetime(),
		"signup_ip": (frappe.local.request_ip or "")[:60], "signup_token": frappe.generate_hash(length=32), "first_password": d.password,
	}).insert(ignore_permissions=True)
	frappe.db.commit()
	if verify:
		_send_code(t)
	else:
		_queue(t)
	return {"token": t.signup_token, "verify": verify, "email": email, "host": host_for(sub)}


def _queue(t):
	t.db_set("email_verified", 1 if t.status == "Verifying email" else t.email_verified)
	t.db_set("status", "Waiting")
	frappe.db.commit()
	frappe.enqueue("mimaar.saas.provision.provision", queue="long", timeout=3600, tenant=t.name, job_id=f"mabni-provision-{t.name}", deduplicate=True, enqueue_after_commit=False)


def _by_token(token):
	name = frappe.db.get_value("Mabni Tenant", {"signup_token": token}, "name") if token else None
	if not name:
		frappe.throw(_("This sign-up has expired. Please start again."), frappe.DoesNotExistError)
	return frappe.get_doc("Mabni Tenant", name)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=20, seconds=3600)
def verify(token=None, code=None):
	_need_control()
	t = _by_token(token)
	if t.status != "Verifying email":
		return {"ok": True}
	if cint(t.verify_tries) >= 5 or not t.verify_expires or get_datetime(t.verify_expires) < now_datetime():
		frappe.throw(_("This code has expired. Ask for a new one."))
	if _hash((code or "").strip()) != t.verify_code:
		t.db_set("verify_tries", cint(t.verify_tries) + 1)
		frappe.db.commit()
		frappe.throw(_("That code is not right. Check the email and try again."))
	_queue(t)
	return {"ok": True}


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=5, seconds=3600)
def resend(token=None):
	_need_control()
	t = _by_token(token)
	if t.status == "Verifying email":
		_send_code(t)
	return {"ok": True}


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=300, seconds=600)
def status(token=None):
	_need_control()
	t = _by_token(token)
	out = {"status": t.status, "host": t.site_host or host_for(t.name), "email": t.email}
	if t.status == "Trial" or t.status == "Active":
		out["url"] = f"https://{t.site_host}/login"
	if t.status == "Failed":
		out["message"] = _("Something went wrong while setting up. We have been told and will email you shortly.")
	return out
