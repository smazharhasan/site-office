"""/billing on a customer's workspace: the plan, the days left, and paying by bank transfer.
It stays open when the plan has ended, so the owner can always pay."""

import json

import frappe

no_cache = 1
sitemap = 0


def get_context(context):
	from buildiary.saas.tenant import buildiary, state

	if not buildiary():
		raise frappe.DoesNotExistError
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/billing"
		raise frappe.Redirect
	u = frappe.db.get_value("User", frappe.session.user, ["full_name", "language"], as_dict=True) or {}
	lang = u.get("language") if u.get("language") in ("en", "ur", "ar") else "en"
	co = frappe.db.get_single_value("Global Defaults", "default_company") or buildiary().get("company") or ""
	context.no_cache = 1
	context.lang = lang
	context.dir = "ltr" if lang == "en" else "rtl"
	context.cfg = json.dumps({
		"lang": lang, "company": co, "owner": "System Manager" in frappe.get_roles(), "user": u.get("full_name") or frappe.session.user,
		"state": state(), "today": frappe.utils.nowdate(),
	}, default=str, ensure_ascii=False).replace("</", "<\\/")
	return context
