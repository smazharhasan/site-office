"""/start on the Buildiary console: the public sign-up page (English, Urdu, Arabic)."""

import json

import frappe
from frappe.utils import cint, flt

no_cache = 1
sitemap = 0


def _cached(key, build):
	v = frappe.cache.get_value(key)
	if v is None:
		v = build()
		frappe.cache.set_value(key, v, expires_in_sec=86400)
	return v


def _countries():
	"""Every country with its flag code, calling code, a sample mobile number and the money it pays in.
	Pakistan and the Gulf first, then the rest by name. Cached for a day."""
	from buildiary.saas.common import TOP_COUNTRIES, currency_for, phone_example

	def build():
		rows = {r.name: r.code for r in frappe.get_all("Country", fields=["name", "code"], limit_page_length=500) if r.code}
		names = [c for c in TOP_COUNTRIES if c in rows] + sorted(c for c in rows if c not in TOP_COUNTRIES)
		out = []
		for name in names:
			ex, dial = phone_example(rows[name])
			out.append({"n": name, "c": rows[name], "d": dial, "e": ex, "m": currency_for(name)})
		return out

	return _cached("buildiary:signup-countries", build)


def _zones():
	"""Time zone → country code, to pre-select the visitor's country."""
	from frappe.geo.country_info import get_all

	def build():
		codes = {r.name: r.code for r in frappe.get_all("Country", fields=["name", "code"], limit_page_length=500) if r.code}
		out = {}
		for name, info in get_all().items():
			for z in info.get("timezones") or []:
				if name in codes and z not in out:
					out[z] = codes[name]
		return out

	return _cached("buildiary:signup-zones", build)


def get_context(context):
	from buildiary.saas.common import COUNTRY_CURRENCY, TOP_COUNTRIES, is_control, plan_price, settings

	if not is_control():
		raise frappe.DoesNotExistError
	s = settings()
	plans = []
	for p in frappe.get_all("Buildiary Plan", filters={"is_active": 1}, fields=["*"], order_by="sort_order asc"):
		local = {cur: plan_price(p, "Monthly", country)["amount"] for country, cur in COUNTRY_CURRENCY.items()}
		plans.append({"name": p.name, "mode": p.mode, "month": flt(p.price_month_usd), "year": flt(p.price_year_usd), "local": local})
	lang = frappe.form_dict.get("lang") or (frappe.request.cookies.get("preferred_language") if frappe.request else None) or ""
	context.no_cache = 1
	context.lang = lang if lang in ("en", "ur", "ar") else ""
	context.cfg = json.dumps({
		"base": s.base_domain, "trial": cint(s.trial_days) or 7, "terms": s.terms_url or "", "privacy": s.privacy_url or "", "open": bool(s.signups_open),
		"countries": _countries(), "top": len(TOP_COUNTRIES), "zones": _zones(), "plans": plans,
		"website": s.website_url or "", "support": s.support_email or "", "country": (frappe.form_dict.get("country") or "")[:60],
	}, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
	return context
