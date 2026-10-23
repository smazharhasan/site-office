"""/field: the Mimaar field app (phone screens in the earlier Mimaar design, on ERPNext)."""

import json
import os
import re

import frappe

no_cache = 1
sitemap = 0

JS = os.path.join(os.path.dirname(os.path.dirname(__file__)), "public", "field", "field.js")
# words the screens show that come from the data rather than from field.js
EXTRA = (
	"Open", "In progress", "Fixed", "Closed", "Present", "Half day", "Absent", "Active", "Left the site", "Blocked",
	"Draft", "Completed", "Working", "Overdue", "Pending Review", "Cancelled", "To Receive and Bill", "To Receive", "To Bill", "To Pay",
	"Labour", "Mistri", "Group head", "Supervisor", "Supplier staff", "Other", "Not done", "Applied", "Verified",
	"Purchase Invoice", "Payment Entry", "Journal Entry", "Purchase Receipt", "Pass", "Pass with remarks", "Fail",
)


def _ur():
	v = os.path.getmtime(JS)
	key = f"mimaar_field_ur_{v}"
	cached = frappe.cache.get_value(key)
	if cached:
		return cached
	from frappe.translate import get_all_translations

	tr = get_all_translations("ur")
	src = open(JS, encoding="utf-8").read()
	# every stretch between two quote marks (both pairings), so strings inside HTML templates are found too
	words = set(re.findall(r'(?=("([^"\n]{2,200})"))', src))
	words = {w[1] for w in words} | set(re.findall(r"`([^`$\n]{2,200})`", src)) | set(EXTRA) | {f"status:{x}" for x in EXTRA}
	for dt in ("Item Group", "UOM"):
		words.update(frappe.get_all(dt, pluck="name"))
	for dt, f in (("Site Inspection", "inspection_type"), ("Site Worker", "trade"), ("Site Worker", "worker_type"), ("Supplier", "mimaar_work_area")):
		df = frappe.get_meta(dt).get_field(f)
		if df and df.options and df.fieldtype == "Select":
			words.update(x for x in df.options.split("\n") if x)
	out = {w: tr[w] for w in words if tr.get(w) and tr[w] != w}
	frappe.cache.set_value(key, out, expires_in_sec=86400)
	return out


def _json(x):
	return json.dumps(x, default=str, ensure_ascii=False).replace("</", "<\\/")


def get_context(context):
	context.no_cache = 1
	b = None
	if frappe.session.user != "Guest":
		from mimaar.field import boot

		b = boot()
	lang = (b or {}).get("lang") or ("ur" if (frappe.request and frappe.request.cookies.get("preferred_language") == "ur") else "en")
	context.lang = lang
	context.v = int(os.path.getmtime(JS))
	context.boot_json = _json({"boot": b, "lang": lang, "card_sign_in": bool(frappe.db.get_single_value("Mimaar Settings", "card_sign_in"))})
	context.ur_json = _json(_ur())
	return context
