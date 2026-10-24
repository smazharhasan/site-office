"""/start on the Mabni console: the public sign-up page (English, Urdu, Arabic)."""

import json

import frappe
from frappe.utils import cint, flt

no_cache = 1
sitemap = 0


def get_context(context):
	from mimaar.saas.common import is_control, settings

	if not is_control():
		raise frappe.DoesNotExistError
	s = settings()
	top = ["Pakistan", "Saudi Arabia", "United Arab Emirates"]
	rest = [c for c in frappe.get_all("Country", pluck="name", order_by="name asc", limit_page_length=400) if c not in top]
	plans = [{"name": p.name, "mode": p.mode, "month": flt(p.price_month_usd), "year": flt(p.price_year_usd)}
		for p in frappe.get_all("Mabni Plan", filters={"is_active": 1}, fields=["name", "mode", "price_month_usd", "price_year_usd"], order_by="sort_order asc")]
	rates = {"PKR": [flt(s.usd_to_pkr), cint(s.round_pkr) or 1], "SAR": [flt(s.usd_to_sar), cint(s.round_sar) or 1], "AED": [flt(s.usd_to_aed), cint(s.round_aed) or 1]}
	lang = frappe.form_dict.get("lang") or (frappe.request.cookies.get("preferred_language") if frappe.request else None) or ""
	context.no_cache = 1
	context.lang = lang if lang in ("en", "ur", "ar") else ""
	context.cfg = json.dumps({
		"base": s.base_domain, "trial": cint(s.trial_days) or 7, "terms": s.terms_url or "", "privacy": s.privacy_url or "", "open": bool(s.signups_open),
		"countries": top + rest, "plans": plans, "rates": rates, "website": s.website_url or "", "support": s.support_email or "",
	}, ensure_ascii=False).replace("</", "<\\/")
	return context
