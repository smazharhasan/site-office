"""Feedback and feature requests from customers (the /feedback page on the console)."""

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import cint, escape_html, validate_email_address

from buildiary.saas.common import is_control, notify_admins

KINDS = ("Feedback", "Feature request", "Problem", "Question")


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=10, seconds=3600)
def submit(data=None):
	if not is_control():
		raise frappe.PermissionError
	d = frappe._dict(frappe.parse_json(data) or {})
	if d.website:  # a field people don't see; robots fill it
		frappe.throw(_("Please try again."))
	message = (d.message or "").strip()
	email = (d.email or "").strip().lower()
	if len(message) < 3:
		frappe.throw(_("Please write a few words."))
	if not validate_email_address(email):
		frappe.throw(_("Enter a valid email address."))
	tenant = (d.workspace or "").strip().lower()
	if tenant and not frappe.db.exists("Buildiary Tenant", tenant):
		tenant = None
	tenant = tenant or frappe.db.get_value("Buildiary Tenant", {"email": email}, "name", order_by="creation desc")
	lang = d.language if d.language in ("en", "ur", "ar") else "en"
	fb = frappe.get_doc({
		"doctype": "Buildiary Feedback", "kind": d.kind if d.kind in KINDS else "Feedback", "rating": max(0, min(cint(d.rating), 5)) or None,
		"message": message[:5000], "contact_name": (d.name or "").strip()[:120], "email": email[:140], "tenant": tenant, "language": lang,
		"submitted_ip": (frappe.local.request_ip or "")[:60],
	}).insert(ignore_permissions=True)
	notify_admins(f"Buildiary: {fb.kind.lower()} from {fb.contact_name or email}",
		f"<p><b>{escape_html(fb.kind)}</b>{f' · {fb.rating}/5' if fb.rating else ''} · {escape_html(fb.contact_name or '')} &lt;{escape_html(email)}&gt;"
		f"{f' · workspace {escape_html(tenant)}' if tenant else ''}</p><p>{escape_html(message).replace(chr(10), '<br>')}</p><p>Open Buildiary Feedback {fb.name} in the console.</p>")
	from buildiary.saas import mail

	mail.feedback_thanks(fb)
	return {"ok": True, "name": fb.name}
