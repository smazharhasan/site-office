"""Turning a site into the Mabni console, and registering workspaces made outside sign-up.

    bench --site my.<domain> execute mimaar.saas.console.setup_console --kwargs "{'base': '<domain>'}"
    bench --site my.<domain> execute mimaar.saas.console.register_site --kwargs "{'host': 'x.<domain>', 'company': 'Villa 31', 'email': '...'}"
"""

import frappe
from frappe.installer import update_site_config
from frappe.utils import now_datetime, nowdate

PLANS = [
	{"plan_name": "Owner", "mode": "Owner", "sort_order": 1, "price_month_usd": 15, "price_year_usd": 150, "max_projects": 2, "max_users": 10, "storage_gb": 10,
		"summary_en": "For a family building its own home: one site, the builder and the site staff on your phone.",
		"summary_ur": "اپنا گھر بنانے والے خاندان کے لیے: سائٹ، بلڈر اور سائٹ کا عملہ، سب آپ کے فون پر۔",
		"summary_ar": "للعائلة التي تبني بيتها: الموقع والمقاول وفريق العمل، كلها على جوالك."},
	{"plan_name": "Builder", "mode": "Builder", "sort_order": 2, "price_month_usd": 49, "price_year_usd": 490, "max_projects": 10, "max_users": 40, "storage_gb": 50,
		"summary_en": "For builders and contractors: several client sites, crews, stores and money in one place.",
		"summary_ur": "بلڈرز اور ٹھیکیداروں کے لیے: کئی کلائنٹ سائٹس، عملہ، اسٹور اور حساب ایک جگہ۔",
		"summary_ar": "للمقاولين: عدة مواقع للعملاء والعمّال والمخازن والحسابات في مكان واحد."},
]


def setup_console(base=None, control=None, company="SMH Global Services", country="Saudi Arabia", support_email="info@smhglobal.com.pk"):
	update_site_config("mabni_control", 1)
	frappe.local.conf.mabni_control = 1
	if not frappe.is_setup_complete():
		from frappe.desk.page.setup_wizard.setup_wizard import setup_complete

		from mimaar.saas.tenant import _abbr, _fy
		from mimaar.saas.common import country_info

		ci = country_info(country)
		fy = _fy(ci["fy_month"])
		frappe.local.lang = "en"
		setup_complete({"language": "English", "country": country, "timezone": ci["time_zone"], "currency": "USD", "full_name": "Mabni Admin",
			"company_name": company, "company_abbr": _abbr(company), "chart_of_accounts": "Standard", "fy_start_date": fy[0], "fy_end_date": fy[1], "setup_demo": 0})
		frappe.db.commit()
	s = frappe.get_single("Mabni Settings")
	if base:
		s.base_domain = base
	s.control_host = control or s.control_host or f"my.{s.base_domain}"
	s.support_email = s.support_email or support_email
	s.website_url = s.website_url or f"https://{s.base_domain}"
	s.terms_url = s.terms_url or f"https://{s.base_domain}/terms/"
	s.privacy_url = s.privacy_url or f"https://{s.base_domain}/privacy/"
	for f in ("trial_days", "grace_days", "pool_size", "usd_to_pkr", "usd_to_sar", "usd_to_aed", "round_pkr", "round_sar", "round_aed", "signups_open"):
		if s.get(f) in (None, 0, ""):
			s.set(f, s.meta.get_field(f).default)
	if not s.reserved_names:
		s.reserved_names = s.meta.get_field("reserved_names").default
	s.save(ignore_permissions=True)
	for p in PLANS:
		if not frappe.db.exists("Mabni Plan", p["plan_name"]):
			frappe.get_doc(dict(p, doctype="Mabni Plan", is_active=1)).insert(ignore_permissions=True)
	ws = frappe.get_single("Website Settings")
	ws.home_page = "start"
	ws.app_name = "Mabni"
	ws.app_logo = "/assets/mimaar/images/mabni-logo.svg"
	ws.disable_signup = 1
	ws.save(ignore_permissions=True)
	admin = frappe.get_doc("User", "Administrator")
	if "Mabni Admin" not in [r.role for r in admin.roles]:
		admin.append_roles("Mabni Admin")
		admin.save(ignore_permissions=True)
	frappe.db.commit()
	print("MABNI CONSOLE READY", s.control_host, s.base_domain)


def register_site(host, company, email, contact_name="Owner", sub=None, internal=1, mode="Owner", country="Pakistan", language="en"):
	"""A workspace made outside sign-up (e.g. SMH Global's own) joins the console."""
	from mimaar.saas.common import push

	sub = sub or host.split(".")[0]
	t = frappe.get_doc("Mabni Tenant", sub) if frappe.db.exists("Mabni Tenant", sub) else frappe.new_doc("Mabni Tenant")
	t.update({"subdomain": sub, "site_host": host, "company_name": company, "contact_name": contact_name, "email": email, "country": country, "language": language,
		"mode": mode, "plan": frappe.db.get_value("Mabni Plan", {"mode": mode}, "name"), "is_internal": int(internal), "status": "Active",
		"signed_up_on": t.signed_up_on or now_datetime(), "trial_ends": t.trial_ends or nowdate()})
	if not t.get("tenant_key"):
		t.tenant_key = frappe.generate_hash(length=40)
	t.save(ignore_permissions=True)
	push(t)
	frappe.db.commit()
	print("REGISTERED", host)
