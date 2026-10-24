"""The console's money side: a checked payment extends the customer's plan; every day the
console updates each customer's status (trial → payment due → suspended), sends reminders
and reads each workspace's usage."""

import frappe
from frappe.utils import add_days, add_months, date_diff, escape_html, get_datetime, getdate, now_datetime, nowdate

from mimaar.saas.common import call_site, is_control, notify_admins, push, settings, tenant_state


def _send(t, subject, body):
	if not t.email:
		return
	s = settings()
	foot = f"<p style='color:#667'>Mabni · SMH Global Services<br>{escape_html(s.support_email or '')} {escape_html(s.support_whatsapp or '')}</p>"
	try:
		frappe.sendmail(recipients=[t.email], subject=subject, message=body + foot, delayed=True, reference_doctype="Mabni Tenant", reference_name=t.name)
	except Exception:
		frappe.log_error(f"Mabni: could not queue the email '{subject}'")


def welcome(t):
	url = f"https://{t.site_host}"
	_send(t, "Your Mabni workspace is ready", f"""<p>Assalam-o-Alaikum {escape_html(t.contact_name)},</p>
<p>Your workspace <b>{escape_html(t.company_name)}</b> is ready at <a href="{url}">{url}</a>.</p>
<p>Sign in with <b>{escape_html(t.email)}</b> and the password you chose. Your free trial runs until <b>{frappe.format(t.trial_ends, 'Date')}</b>.</p>
<p>On your phone, open the address in the browser and choose <i>Add to Home Screen</i>, or install the Mabni app and type <b>{escape_html(t.subdomain)}</b>.</p>""")
	notify_admins(f"Mabni: new customer {t.company_name}", f"{escape_html(t.contact_name)} ({escape_html(t.email)}, {escape_html(t.phone or '')}, {escape_html(t.country or '')}) started a {t.mode} trial at {url}.")


# ---------------------------------------------------------------- a checked payment
def apply_payment(p):
	"""Mabni Payment set to Verified: the customer's paid time is extended from where it ends."""
	t = frappe.get_doc("Mabni Tenant", p.tenant)
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
	plan = frappe.get_doc("Mabni Plan", p.plan)
	t.plan = plan.name
	t.mode = plan.mode
	t.billing_period = p.billing_period
	t.paid_until = end
	t.status = "Active"
	t.suspended_on = None
	t.save(ignore_permissions=True)
	_send(t, "Payment received – thank you", f"""<p>Dear {escape_html(t.contact_name)},</p>
<p>We have received your payment of <b>{escape_html(p.currency)} {frappe.format(p.amount, 'Float')}</b> (reference {escape_html(p.reference or p.name)}).</p>
<p>Your <b>{escape_html(plan.name)}</b> plan is active until <b>{frappe.format(end, 'Date')}</b>.</p>""")


def reject_payment(p):
	t = frappe.get_doc("Mabni Tenant", p.tenant)
	p.db_set({"checked_by": frappe.session.user, "checked_on": now_datetime()})
	_send(t, "We couldn't confirm your payment", f"""<p>Dear {escape_html(t.contact_name)},</p>
<p>We couldn't confirm the payment you reported ({escape_html(p.currency)} {frappe.format(p.amount, 'Float')}, reference {escape_html(p.reference or '-')}).</p>
<p>{escape_html(p.reject_reason or '')}</p><p>Please check and send it again from Plan &amp; billing in your workspace, or reply to this email.</p>""")


# ---------------------------------------------------------------- every day
def daily():
	if not is_control():
		return
	for name in frappe.get_all("Mabni Tenant", filters={"status": ["in", ["Trial", "Active", "Payment due", "Suspended"]]}, pluck="name"):
		try:
			check_tenant(frappe.get_doc("Mabni Tenant", name))
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(f"Mabni: daily check failed for {name}")


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
	end = t.paid_until or t.trial_ends
	if not end:
		return
	left = date_diff(end, nowdate())
	key = None
	what = "trial" if not t.paid_until else "plan"
	url = f"https://{t.site_host}/billing"
	if t.status in ("Trial", "Active") and left in (7, 2) and (what == "plan" or left == 2):
		key, subject, body = f"{end}:{left}", f"Your Mabni {what} ends in {left} days", f"<p>Your {what} for <b>{escape_html(t.company_name)}</b> ends on <b>{frappe.format(end, 'Date')}</b>. Choose a plan and pay by bank transfer in <a href='{url}'>Plan &amp; billing</a> so your team can keep working.</p>"
	elif t.status == "Payment due":
		key, subject, body = f"{end}:due", f"Your Mabni {what} has ended", f"<p>Your {what} for <b>{escape_html(t.company_name)}</b> ended on <b>{frappe.format(end, 'Date')}</b>. Your workspace stays open for a few more days. Pay in <a href='{url}'>Plan &amp; billing</a> to keep it running.</p>"
	elif t.status == "Suspended":
		key, subject, body = f"{end}:stop", "Your Mabni workspace is paused", f"<p>The workspace for <b>{escape_html(t.company_name)}</b> is paused because the {what} ended. Your data is safe. Sign in and open <a href='{url}'>Plan &amp; billing</a> to pay and open it again.</p>"
	if key and t.last_reminder != key:
		_send(t, subject, body)
		t.db_set("last_reminder", key, update_modified=False)


def refresh_usage(t):
	if not t.site_host or t.status in ("Waiting", "Setting up", "Failed", "Verifying email"):
		return
	key = t.get_password("tenant_key", raise_exception=False)
	if not key:
		return
	try:
		u = call_site(t.site_host, "mimaar.saas.tenant.usage", {"key": key}, timeout=60) or {}
	except Exception:
		return
	t.db_set({"users": u.get("users") or 0, "projects": u.get("projects") or 0, "storage_mb": u.get("storage_mb") or 0,
		"last_active": get_datetime(u["last_active"]) if u.get("last_active") else None, "usage_on": now_datetime()}, update_modified=False)
