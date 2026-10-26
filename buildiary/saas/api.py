"""The console's endpoints for workspaces (signed with each workspace's key) and for the web
server's certificate check."""

import base64
import hmac
import json

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate

from buildiary.saas.common import (COUNTRY_CURRENCY, bank_accounts, base_domain, currency_for, is_control, local_price, notify_admins, plan_price, plans, settings,
	site_dir, tenant_state, to_usd)


def _tenant(tenant, key):
	if not is_control() or not tenant or not key:
		raise frappe.PermissionError
	t = frappe.get_doc("Buildiary Tenant", tenant) if frappe.db.exists("Buildiary Tenant", tenant) else None
	mine = t.get_password("tenant_key", raise_exception=False) if t else None
	if not (mine and hmac.compare_digest(str(mine), str(key))):
		raise frappe.PermissionError
	return t


@frappe.whitelist(allow_guest=True)
def tls_ask(domain=None):
	"""Caddy asks before getting a certificate for a new address: only real workspaces get one."""
	import os

	d = (domain or "").strip().lower().rstrip(".")
	s = settings()
	ok = bool(d) and (d == (s.control_host or "").lower() or d == base_domain() or d == f"www.{base_domain()}")
	if not ok and d.endswith("." + base_domain()):
		ok = bool(frappe.db.get_value("Buildiary Tenant", {"site_host": d, "status": ["not in", ["Failed", "Cancelled"]]}, "name")) or (
			os.path.isdir(site_dir(d)) and not d.startswith("pool-"))
	if not ok:
		raise frappe.DoesNotExistError
	return "ok"


@frappe.whitelist(allow_guest=True, methods=["POST"])
def account(tenant=None, key=None):
	"""Everything the workspace's Plan & billing page shows."""
	t = _tenant(tenant, key)
	s = settings()
	cur = local_price(1, t.country)["currency"]
	banks = [{k: b.get(k) for k in ("country", "currency", "bank_name", "account_title", "account_number", "iban", "swift", "branch")}
		for b in bank_accounts(t.country)]
	pays = frappe.get_all("Buildiary Payment", filters={"tenant": t.name}, fields=["name", "creation", "plan", "billing_period", "periods", "currency", "amount", "status",
		"period_from", "period_to", "reference", "reject_reason"], order_by="creation desc", limit=20)
	return {
		"tenant": t.name, "company": t.company_name, "country": t.country, "currency": cur, "plan": t.plan, "mode": t.mode, "billing_period": t.billing_period,
		"status": tenant_state(t), "trial_ends": t.trial_ends, "paid_until": t.paid_until,
		"plans": plans(t.country), "banks": banks, "payments": pays,
		"support": {"email": s.support_email, "whatsapp": s.support_whatsapp}, "terms_url": s.terms_url,
	}


@frappe.whitelist(allow_guest=True, methods=["POST"])
def payment_submit(tenant=None, key=None, data=None):
	"""The owner reported a bank transfer: kept for us to check."""
	t = _tenant(tenant, key)
	d = frappe._dict(json.loads(data) if isinstance(data, str) else (data or {}))
	if not frappe.db.exists("Buildiary Plan", d.plan):
		frappe.throw(_("Choose a plan."))
	if frappe.db.count("Buildiary Payment", {"tenant": t.name, "status": "Waiting for check"}) >= 5:
		frappe.throw(_("We are still checking your earlier payments. Please wait for them first."))
	cur = d.currency if d.currency in ("USD", *COUNTRY_CURRENCY.values()) else "USD"
	p = frappe.get_doc({
		"doctype": "Buildiary Payment", "tenant": t.name, "plan": d.plan, "billing_period": d.billing_period, "periods": max(1, min(cint(d.periods) or 1, 36)),
		"currency": cur, "amount": flt(d.amount), "amount_usd": to_usd(d.amount, cur), "method": "Bank transfer", "paid_to": (d.paid_to or "")[:140],
		"reference": (d.reference or "")[:140], "paid_on": getdate(d.paid_on) if d.paid_on else None, "submitted_by": (d.submitted_by or "")[:140],
		"note": (d.note or "")[:1000], "status": "Waiting for check",
	}).insert(ignore_permissions=True)
	if d.proof and isinstance(d.proof, str) and d.proof.startswith("data:image/"):
		head, b64 = d.proof.split(",", 1)
		ext = {"jpeg": "jpg", "jpg": "jpg", "png": "png", "webp": "webp"}.get(head.split("/")[1].split(";")[0], "jpg")
		f = frappe.get_doc({"doctype": "File", "file_name": f"{p.name}-proof.{ext}", "is_private": 1, "attached_to_doctype": "Buildiary Payment",
			"attached_to_name": p.name, "attached_to_field": "proof", "content": base64.b64decode(b64)}).insert(ignore_permissions=True)
		p.db_set("proof", f.file_url)
	notify_admins(f"Buildiary: payment to check from {t.company_name}", f"{p.currency} {p.amount} for {p.plan} ({p.billing_period}). Open Buildiary Payment {p.name} in the console.")
	from buildiary.saas import mail

	mail.payment_received(t, p)
	return {"name": p.name}


@frappe.whitelist(allow_guest=True)
def public_plans():
	"""Plans and prices for the website (USD, with each local currency: PKR, SAR, AED, QAR)."""
	if not is_control():
		raise frappe.PermissionError
	s = settings()
	out = []
	for p in frappe.get_all("Buildiary Plan", filters={"is_active": 1}, fields=["*"], order_by="sort_order asc"):
		row = {"name": p.name, "mode": p.mode, "max_projects": p.max_projects, "max_users": p.max_users, "storage_gb": p.storage_gb,
			"summary": {"en": p.summary_en, "ur": p.summary_ur, "ar": p.summary_ar}, "usd": {"month": p.price_month_usd, "year": p.price_year_usd}}
		for country, cur in COUNTRY_CURRENCY.items():
			row[cur] = {"month": plan_price(p, "Monthly", country)["amount"], "year": plan_price(p, "Yearly", country)["amount"]}
		out.append(row)
	return {"plans": out, "trial_days": s.trial_days, "signup": f"https://{s.control_host}/start", "currencies": COUNTRY_CURRENCY}


@frappe.whitelist()
def payment_defaults(tenant, plan=None, billing_period=None, periods=1):
	"""For the console's payment form: what this customer owes for the plan, in their money, and our account they pay into."""
	frappe.only_for(("System Manager", "Buildiary Admin"))
	t = frappe.get_doc("Buildiary Tenant", tenant)
	plan = plan or t.plan
	period = billing_period or t.billing_period or "Monthly"
	price = plan_price(plan, period, t.country) if plan else {"currency": currency_for(t.country), "amount": 0}
	banks = bank_accounts(t.country)
	paid_to = ""
	if banks:
		b = banks[0]
		paid_to = ", ".join(x for x in (b.bank_name, b.account_title, b.iban or b.account_number) if x)
	return {"currency": price["currency"], "amount": flt(price["amount"]) * max(1, cint(periods) or 1), "paid_to": paid_to[:140],
		"plan": plan, "billing_period": period, "country": t.country}
