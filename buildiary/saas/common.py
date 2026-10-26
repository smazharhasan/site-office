"""Shared helpers for Buildiary Cloud.

One bench serves many sites. The console site (site_config "buildiary_control": 1) keeps the
customers, plans and payments, signs new customers up and prepares their workspaces. Each
customer's workspace is its own site; its site_config carries a "buildiary" block with its
plan, mode and dates, which the console keeps up to date.
"""

import json
import os
import re

import frappe
from frappe.utils import add_days, cint, flt, getdate, nowdate

# the month a financial year starts (January when not listed)
FY_START = {"Pakistan": 7, "India": 4, "United Kingdom": 4, "Australia": 7, "Egypt": 7, "Bangladesh": 7, "New Zealand": 4}
# customers in these countries see and pay their own money; everyone else sees USD
COUNTRY_CURRENCY = {"Pakistan": "PKR", "Saudi Arabia": "SAR", "United Arab Emirates": "AED", "Qatar": "QAR"}
LOCAL_CURRENCIES = tuple(COUNTRY_CURRENCY.values())
# first in country lists (sign-up), the rest follow by name
TOP_COUNTRIES = ["Pakistan", "Saudi Arabia", "United Arab Emirates", "Qatar", "Kuwait", "Bahrain", "Oman"]
# which of our bank accounts a customer pays into: Pakistan's, the UAE's, or the Saudi ones for everyone else
BANK_OTHERS = "Saudi Arabia and all other countries"
BANK_REGIONS = ("Pakistan", "United Arab Emirates", BANK_OTHERS)
LANG_NAME = {"en": "English", "ur": "اردو", "ar": "العربية"}
NAME_RE = re.compile(r"^[a-z][a-z0-9-]{1,28}[a-z0-9]$")


def is_control():
	return bool(frappe.conf.get("buildiary_control"))


def settings():
	return frappe.get_cached_doc("Buildiary Cloud Settings")


def base_domain():
	return (settings().base_domain or "").strip().lower().strip(".")


def host_for(sub):
	return f"{sub}.{base_domain()}"


def sites_path():
	return os.path.abspath(frappe.local.sites_path)


def site_dir(host):
	return os.path.join(sites_path(), host)


def bench_path():
	return os.path.dirname(sites_path())


def internal_url():
	"""How sites on this bench reach each other (the frontend's nginx inside Docker)."""
	return frappe.conf.get("buildiary_internal_url") or "http://frontend:8080"


def read_site_config(host):
	p = os.path.join(site_dir(host), "site_config.json")
	if not os.path.exists(p):
		return {}
	with open(p, encoding="utf-8") as f:
		return json.load(f)


def update_site_config(host, key, value):
	from frappe.installer import update_site_config as upd

	upd(key, value, site_config_path=os.path.join(site_dir(host), "site_config.json"))


def call_site(host, method, data=None, timeout=60):
	"""Call a whitelisted method on another site of this bench (server to server)."""
	import requests

	r = requests.post(f"{internal_url()}/api/method/{method}", json=data or {}, headers={"Host": host, "Accept": "application/json"}, timeout=timeout)
	try:
		body = r.json()
	except ValueError:
		body = {}
	if r.status_code >= 400:
		msg = body.get("exception") or body.get("_server_messages") or r.text[:300]
		raise frappe.ValidationError(f"{host}: {msg}")
	return body.get("message")


def country_info(country):
	"""Currency, time zone and dialling code of a country (from Frappe's country list)."""
	from frappe.geo.country_info import get_country_info

	ci = get_country_info(country) or {}
	return {"currency": ci.get("currency") or "USD", "time_zone": (ci.get("timezones") or ["UTC"])[0], "dial": (ci.get("isd") or "").lstrip("+"),
		"fy_month": FY_START.get(country, 1)}


def currency_for(country):
	return COUNTRY_CURRENCY.get(country or "", "USD")


def local_price(usd, country, fixed=None):
	"""A price in USD and in the customer's own money: the plan's fixed local price when one is set,
	otherwise converted at the console's rate and rounded the way people pay."""
	cur = currency_for(country)
	if cur == "USD":
		return {"usd": flt(usd), "currency": "USD", "amount": flt(usd)}
	if flt(fixed) > 0:
		return {"usd": flt(usd), "currency": cur, "amount": flt(fixed)}
	s = settings()
	rate = flt(s.get(f"usd_to_{cur.lower()}"))
	step = cint(s.get(f"round_{cur.lower()}")) or 1
	amount = round(flt(usd) * rate / step) * step if rate else 0
	return {"usd": flt(usd), "currency": cur if rate else "USD", "amount": amount or flt(usd)}


def plan_price(plan, period, country):
	"""What one month or one year of a plan costs a customer in this country."""
	p = plan if isinstance(plan, dict) else frappe.db.get_value("Buildiary Plan", plan, ["*"], as_dict=True)
	key = "year" if period in ("Yearly", "year") else "month"
	return local_price(p.get(f"price_{key}_usd"), country, p.get(f"price_{key}_{currency_for(country).lower()}"))


def to_usd(amount, currency):
	if currency == "USD":
		return flt(amount)
	rate = flt(settings().get(f"usd_to_{(currency or '').lower()}"))
	return round(flt(amount) / rate, 2) if rate else 0


def bank_region(country):
	return country if country in ("Pakistan", "United Arab Emirates") else BANK_OTHERS


def bank_accounts(country):
	"""The accounts a customer from this country pays into (Pakistan, the UAE, or the Saudi ones for everyone else).
	Where the region has accounts in several currencies, the one in the customer's own money comes first (Saudi
	customers see the SAR account); others see the USD account first."""
	region = bank_region(country)
	accounts = [b for b in settings().bank_accounts if b.is_active and b.country == region]
	mine = currency_for(country)
	same = [b for b in accounts if b.currency == mine]
	if same:
		return same
	return sorted(accounts, key=lambda b: (b.currency != "USD", b.idx or 0))


CURRENCY_COUNTRY = {cur: country for country, cur in COUNTRY_CURRENCY.items()}


def price_in(plan, period, currency):
	"""What a plan costs in one currency (for a bank account in that currency)."""
	p = plan if isinstance(plan, dict) else frappe.db.get_value("Buildiary Plan", plan, ["*"], as_dict=True)
	if not p:
		return 0
	if currency == "USD" or currency not in CURRENCY_COUNTRY:
		return flt(p.get("price_year_usd" if period in ("Yearly", "year") else "price_month_usd"))
	return flt(plan_price(p, period, CURRENCY_COUNTRY[currency])["amount"])


# SMH Global Services' company in each region, as written in each language
ENTITIES = {
	"Pakistan": {"en": "SMH Global Services (Private) Limited", "ur": "ایس ایم ایچ گلوبل سروسز (پرائیویٹ) لمیٹڈ",
		"ar": "إس إم إتش جلوبال سيرفيسز (برايفت) ليمتد", "place": {"en": "Karachi, Pakistan", "ur": "کراچی، پاکستان", "ar": "كراتشي، باكستان"}},
	"United Arab Emirates": {"en": "SMH Global Services L.L.C-FZ", "ur": "ایس ایم ایچ گلوبل سروسز ایل ایل سی - ایف زیڈ",
		"ar": "اس ام اتش جلوبال سيرفيسز ش.ذ.م.م - منطقة حرة", "place": {"en": "Dubai, United Arab Emirates", "ur": "دبئی، متحدہ عرب امارات", "ar": "دبي، الإمارات العربية المتحدة"}},
	BANK_OTHERS: {"en": "SMH Global Services Company", "ur": "ایس ایم ایچ گلوبل سروسز کمپنی",
		"ar": "شركة إس إم إتش جلوبال سيرفيسز", "place": {"en": "Kingdom of Saudi Arabia", "ur": "سعودی عرب", "ar": "المملكة العربية السعودية"}},
}


def entity(country, lang="en"):
	"""The SMH Global Services company a customer in this country deals with and pays."""
	e = ENTITIES[bank_region(country)]
	return e.get(lang) or e["en"]


def plans(country=None, active_only=True):
	out = []
	for p in frappe.get_all("Buildiary Plan", filters={"is_active": 1} if active_only else {}, fields=["*"], order_by="sort_order asc"):
		out.append({
			"name": p.name, "mode": p.mode, "max_projects": cint(p.max_projects), "max_users": cint(p.max_users), "storage_gb": cint(p.storage_gb),
			"summary": {"en": p.summary_en, "ur": p.summary_ur, "ar": p.summary_ar},
			"month": plan_price(p, "Monthly", country), "year": plan_price(p, "Yearly", country),
		})
	return out


def phone_check(phone, country):
	"""A mobile number in the country's own format. Returns (international format, None) or (None, problem)."""
	import phonenumbers
	from phonenumbers import PhoneNumberFormat, PhoneNumberType

	code = (frappe.db.get_value("Country", country, "code") or "").upper()
	raw = (phone or "").strip()
	if not raw:
		return None, "empty"
	try:
		n = phonenumbers.parse(raw, code or None)
	except phonenumbers.NumberParseException:
		return None, "invalid"
	if not phonenumbers.is_valid_number(n):
		return None, "invalid"
	kind = phonenumbers.number_type(n)
	if kind not in (PhoneNumberType.MOBILE, PhoneNumberType.FIXED_LINE_OR_MOBILE, PhoneNumberType.VOIP, PhoneNumberType.PERSONAL_NUMBER):
		return None, "not_mobile"
	return phonenumbers.format_number(n, PhoneNumberFormat.INTERNATIONAL), None


def phone_example(code):
	"""A sample mobile number of a country (ISO code), as people write it there, and its calling code."""
	import phonenumbers
	from phonenumbers import PhoneNumberFormat, PhoneNumberType

	try:
		n = phonenumbers.example_number_for_type(code.upper(), PhoneNumberType.MOBILE)
	except Exception:
		n = None
	dial = phonenumbers.country_code_for_region(code.upper()) if code else 0
	return (phonenumbers.format_number(n, PhoneNumberFormat.NATIONAL) if n else ""), (f"+{dial}" if dial else "")


def tenant_state(t):
	"""Where a customer stands today: trial, active, payment due (still open) or suspended."""
	if t.get("is_internal"):
		return "Active"
	if t.get("paused_by_admin"):
		return "Suspended"
	if t.get("status") in ("Cancelled", "Failed", "Verifying email", "Waiting", "Setting up"):
		return t.get("status")
	today = getdate(nowdate())
	grace = cint(settings().grace_days)
	end = getdate(t.paid_until) if t.get("paid_until") else (getdate(t.trial_ends) if t.get("trial_ends") else None)
	if not end:
		return t.get("status") or "Trial"
	if today <= end:
		return "Active" if t.get("paid_until") else "Trial"
	if today <= getdate(add_days(end, grace)):
		return "Payment due"
	return "Suspended"


def conf_block(t):
	"""The "buildiary" block written into the customer's site_config."""
	plan = frappe.get_cached_doc("Buildiary Plan", t.plan) if t.plan and frappe.db.exists("Buildiary Plan", t.plan) else None
	s = settings()
	return {
		"tenant": t.name,
		"company": t.company_name,
		"internal": 1 if t.is_internal else 0,
		"status": tenant_state(t),
		"mode": (t.mode or "Owner").lower(),
		"plan": t.plan,
		"billing_period": t.billing_period,
		"country": t.country,
		"trial_ends": str(t.trial_ends) if t.trial_ends else None,
		"paid_until": str(t.paid_until) if t.paid_until else None,
		"grace_days": cint(s.grace_days),
		"limits": {"projects": cint(plan.max_projects), "users": cint(plan.max_users), "storage_gb": cint(plan.storage_gb)} if plan else {},
		"console": s.control_host,
		"support_email": s.support_email,
		"support_whatsapp": s.support_whatsapp,
		"trial_data": t.get("trial_data") or "Own data",
		"at_subscription": t.get("at_subscription") or "Keep my data",
		"data_reset": t.get("data_reset") or "",
	}


def push(t):
	"""Write the customer's plan and dates into their workspace."""
	if not t.site_host or not os.path.isdir(site_dir(t.site_host)):
		return False
	update_site_config(t.site_host, "buildiary", conf_block(t))
	key = t.get_password("tenant_key", raise_exception=False) if t.get("tenant_key") else None
	if key:
		update_site_config(t.site_host, "buildiary_key", key)
	update_site_config(t.site_host, "buildiary_ai", ai_block())
	return True


def ai_block():
	"""The console's AI key for the workspaces (empty when off)."""
	s = settings()
	if s.ai_provider in (None, "", "Off"):
		return {}
	key = s.get_password("ai_api_key", raise_exception=False)
	return {"provider": s.ai_provider, "key": key, "model": s.ai_model or "", "daily_limit": int(s.ai_daily_limit or 0)} if key else {}


def notify_admins(subject, message):
	emails = [e.strip() for e in (settings().admin_emails or "").splitlines() if e.strip()]
	if emails:
		try:
			frappe.sendmail(recipients=emails, subject=subject, message=message, delayed=True)
		except Exception:
			frappe.log_error("Buildiary: could not queue an admin email")
