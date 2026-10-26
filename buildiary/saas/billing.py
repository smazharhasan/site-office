"""The console's money side: a checked payment extends the customer's plan; every day the
console updates each customer's status (trial → payment due → suspended), sends reminders
and reads each workspace's usage."""

import frappe
from frappe import _
from frappe.utils import add_days, add_months, escape_html, get_datetime, getdate, now_datetime, nowdate

from buildiary.saas.common import call_site, is_control, notify_admins, push, tenant_state


def welcome(t):
	from buildiary.saas import mail

	mail.welcome(t)
	url = f"https://{t.site_host}"
	notify_admins(f"Buildiary: new customer {t.company_name}", f"{escape_html(t.contact_name)} ({escape_html(t.email)}, {escape_html(t.phone or '')}, {escape_html(t.country or '')}) started a {t.mode} trial at {url}.")


# ---------------------------------------------------------------- a checked payment
def apply_payment(p):
	"""Buildiary Payment set to Verified: the customer's paid time is extended from where it ends."""
	t = frappe.get_doc("Buildiary Tenant", p.tenant)
	today = getdate(nowdate())
	if t.paid_until and getdate(t.paid_until) >= today:
		base = getdate(t.paid_until)
	elif t.trial_ends and getdate(t.trial_ends) >= today and not t.paid_until:
		base = getdate(t.trial_ends)
	else:
		base = add_days(today, -1)
	start = add_days(base, 1)
	months = int(p.periods or 1) * (12 if p.billing_period == "Yearly" else 1)
	end = add_days(add_months(start, months), -1)
	p.db_set({"period_from": start, "period_to": end, "checked_by": frappe.session.user, "checked_on": now_datetime()})
	plan = frappe.get_doc("Buildiary Plan", p.plan)
	t.plan = plan.name
	t.mode = plan.mode
	t.billing_period = p.billing_period
	t.paid_until = end
	t.status = "Active"
	t.suspended_on = None
	t.save(ignore_permissions=True)
	frappe.msgprint(_("{0}'s {1} licence is active until {2}. The customer has been emailed.").format(
		frappe.bold(t.company_name), plan.name, frappe.bold(frappe.format(end, "Date"))), title=_("Licence activated"), indicator="green")
	from buildiary.saas import mail
	from buildiary.saas.provision import fresh_start_due, queue_reset

	fresh = fresh_start_due(t)
	if fresh:
		queue_reset(t, "the paid subscription started")
	p.reload()
	mail.payment_confirmed(t, p, fresh=fresh)


def reject_payment(p):
	t = frappe.get_doc("Buildiary Tenant", p.tenant)
	p.db_set({"checked_by": frappe.session.user, "checked_on": now_datetime()})
	from buildiary.saas import mail

	mail.payment_rejected(t, p)


# ---------------------------------------------------------------- every day
def daily():
	if not is_control():
		return
	for name in frappe.get_all("Buildiary Tenant", filters={"status": ["in", ["Trial", "Active", "Payment due", "Suspended"]]}, pluck="name"):
		try:
			check_tenant(frappe.get_doc("Buildiary Tenant", name))
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(f"Buildiary: daily check failed for {name}")


def push_all():
	"""Write every workspace's plan, dates and the AI settings into its site."""
	if not is_control():
		return
	for name in frappe.get_all("Buildiary Tenant", filters={"status": ["in", ["Trial", "Active", "Payment due", "Suspended"]]}, pluck="name"):
		try:
			push(frappe.get_doc("Buildiary Tenant", name))
		except Exception:
			frappe.log_error(f"Buildiary: could not update {name}")


def check_tenant(t, reminders=True):
	new = tenant_state(t)
	if new != t.status:
		t.status = new
		if new == "Suspended":
			t.suspended_on = nowdate()
		t.save(ignore_permissions=True)
	else:
		push(t)
	if reminders and not t.is_internal:
		_remind(t)
	refresh_usage(t)


def _remind(t):
	"""The follow-up email due today, if any (mail.follow_up keeps track of what was sent)."""
	from buildiary.saas import mail

	try:
		mail.follow_up(t)
	except Exception:
		frappe.log_error(f"Buildiary: follow-up email failed for {t.name}")


def refresh_usage(t):
	if not t.site_host or t.status in ("Waiting", "Setting up", "Failed", "Verifying email"):
		return
	key = t.get_password("tenant_key", raise_exception=False)
	if not key:
		return
	try:
		u = call_site(t.site_host, "buildiary.saas.tenant.usage", {"key": key}, timeout=60) or {}
	except Exception:
		return
	t.db_set({"users": u.get("users") or 0, "projects": u.get("projects") or 0, "storage_mb": u.get("storage_mb") or 0,
		"last_active": get_datetime(u["last_active"]) if u.get("last_active") else None, "usage_on": now_datetime()}, update_modified=False)
