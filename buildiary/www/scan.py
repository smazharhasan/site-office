"""/scan?k=<key> on a workspace: a phone becomes the QR scanner for a computer or tablet.
No sign-in: the key in the link (shown as a QR on the computer) is the pass. See buildiary.scan."""

import json

import frappe

no_cache = 1
sitemap = 0


def get_context(context):
	from buildiary.scan import get

	k = (frappe.form_dict.get("k") or "").strip()
	d = get(k)
	lang = (d or {}).get("lang") or (frappe.form_dict.get("lang") if frappe.form_dict.get("lang") in ("en", "ur", "ar") else "en")
	context.no_cache = 1
	context.lang = lang
	context.dir = "ltr" if lang == "en" else "rtl"
	context.cfg = json.dumps({"key": k if d else "", "lang": lang}, separators=(",", ":")).replace("</", "<\\/")
	return context
