"""Turning a site into the Buildiary console, and registering workspaces made outside sign-up.

    bench --site my.<domain> execute buildiary.saas.console.setup_console --kwargs "{'base': '<domain>'}"
    bench --site my.<domain> execute buildiary.saas.console.register_site --kwargs "{'host': 'x.<domain>', 'company': 'Villa 31', 'email': '...'}"
"""

import frappe
from frappe.installer import update_site_config
from frappe.utils import cint, now_datetime, nowdate

PLANS = [
	{"plan_name": "Owner", "mode": "Owner", "sort_order": 1, "price_month_usd": 15, "price_year_usd": 150, "max_projects": 2, "max_users": 10, "storage_gb": 10,
		"summary_en": "For a family building its own home: your site, your builder and your site staff, on your phone.",
		"summary_ur": "اپنا گھر بنانے والے خاندان کے لیے: آپ کی سائٹ، آپ کا بلڈر اور سائٹ کا عملہ، سب آپ کے فون پر۔",
		"summary_ar": "للعائلة التي تبني بيتها: الموقع والمقاول وفريق العمل، كلها على جوالك."},
	{"plan_name": "Builder", "mode": "Builder", "sort_order": 2, "price_month_usd": 49, "price_year_usd": 490, "max_projects": 10, "max_users": 40, "storage_gb": 50,
		"summary_en": "For builders and contractors: several client sites, crews, stores and money in one place.",
		"summary_ur": "بلڈرز اور ٹھیکیداروں کے لیے: کئی کلائنٹ سائٹس، عملہ، اسٹور اور حساب ایک جگہ۔",
		"summary_ar": "للمقاولين: عدة مواقع للعملاء والعمّال والمخازن والحسابات في مكان واحد."},
]


def setup_console(base=None, control=None, company="SMH Global Services", country="Saudi Arabia", support_email="info@smhglobal.com.pk"):
	update_site_config("buildiary_control", 1)
	frappe.local.conf.buildiary_control = 1
	if not frappe.is_setup_complete():
		from frappe.desk.page.setup_wizard.setup_wizard import setup_complete

		from buildiary.saas.tenant import _abbr, _fy
		from buildiary.saas.common import country_info

		ci = country_info(country)
		fy = _fy(ci["fy_month"])
		frappe.local.lang = "en"
		setup_complete({"language": "English", "country": country, "timezone": ci["time_zone"], "currency": "USD", "full_name": "Buildiary Admin",
			"company_name": company, "company_abbr": _abbr(company), "chart_of_accounts": "Standard", "fy_start_date": fy[0], "fy_end_date": fy[1], "setup_demo": 0})
		frappe.db.commit()
	s = frappe.get_single("Buildiary Cloud Settings")
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
		if not frappe.db.exists("Buildiary Plan", p["plan_name"]):
			frappe.get_doc(dict(p, doctype="Buildiary Plan", is_active=1)).insert(ignore_permissions=True)
		elif frappe.db.get_value("Buildiary Plan", p["plan_name"], "summary_en") == "For a family building its own home: one site, the builder and the site staff on your phone.":
			frappe.db.set_value("Buildiary Plan", p["plan_name"], {k: p[k] for k in ("summary_en", "summary_ur", "summary_ar")})
	ws = frappe.get_single("Website Settings")
	ws.home_page = "start"
	ws.app_name = "Buildiary"
	ws.app_logo = "/assets/buildiary/images/buildiary-logo.svg"
	ws.disable_signup = 1
	ws.save(ignore_permissions=True)
	admin = frappe.get_doc("User", "Administrator")
	if "Buildiary Admin" not in [r.role for r in admin.roles]:
		admin.append_roles("Buildiary Admin")
		admin.save(ignore_permissions=True)
	frappe.db.commit()
	print("BUILDIARY CONSOLE READY", s.control_host, s.base_domain)


def rebase(base, dry_run=0):
	"""Moves the platform to a new main address, e.g. from the temporary sslip.io address to
	buildiary.app. Run on the console after its own folder was renamed to my.<new> (deploy/aws/rebase.sh):
	the settings take the new address, and each customer's workspace <name>.<old> becomes
	<name>.<new> (the site folder is renamed; the data stays). SMH Global's own registered sites keep
	their addresses. Prints "MOVED <old> <new>" for each workspace (the script adds redirects)."""
	import os

	from buildiary.saas.common import push, site_dir, update_site_config

	base = (base or "").strip().lower().strip(".")
	if not base:
		frappe.throw("Give the new main address, e.g. buildiary.app")
	s = frappe.get_single("Buildiary Cloud Settings")
	old = (s.base_domain or "").strip().lower()
	moved = []
	for name in frappe.get_all("Buildiary Tenant", pluck="name"):
		t = frappe.get_doc("Buildiary Tenant", name)
		host = (t.site_host or "").lower()
		if t.is_internal or not old or not host.endswith("." + old):
			continue
		new = host[: -len(old)] + base
		if not cint(dry_run):
			if os.path.isdir(site_dir(host)) and not os.path.exists(site_dir(new)):
				os.rename(site_dir(host), site_dir(new))
			if os.path.isdir(site_dir(new)):
				update_site_config(new, "host_name", f"https://{new}")
			frappe.db.set_value("Buildiary Tenant", t.name, "site_host", new, update_modified=False)
		moved.append((host, new))
	if not cint(dry_run):
		s.base_domain = base
		s.control_host = f"my.{base}"
		if s.meta.has_field("website_url"):
			s.website_url = f"https://{base}"
		s.flags.ignore_permissions = True
		s.save()
		frappe.db.commit()
		for name in frappe.get_all("Buildiary Tenant", pluck="name"):
			push(frappe.get_doc("Buildiary Tenant", name))
		frappe.db.commit()
	for a, b in moved:
		print("MOVED", a, b)
	print("BASE", old, "->", base, "(dry run)" if cint(dry_run) else "")


def move_site(old, new):
	"""Moves one workspace to a new address (and its record to the new sub-name), keeping its data.
	Run on the console, e.g. bench --site my.buildiary.app execute buildiary.saas.console.move_site
	--kwargs "{'old': 'a.example.com', 'new': 'b.buildiary.app'}". Prints "MOVED <old> <new>"."""
	import os

	from frappe.model.rename_doc import rename_doc

	from buildiary.saas.common import push, site_dir, update_site_config

	old, new = (old or "").strip().lower(), (new or "").strip().lower()
	if not old or not new or old == new:
		frappe.throw("Give the old and the new address")
	if os.path.isdir(site_dir(old)) and not os.path.exists(site_dir(new)):
		os.rename(site_dir(old), site_dir(new))
	if os.path.isdir(site_dir(new)):
		update_site_config(new, "host_name", f"https://{new}")
	name = frappe.db.get_value("Buildiary Tenant", {"site_host": old}, "name") or frappe.db.get_value("Buildiary Tenant", {"site_host": new}, "name")
	if name:
		sub = new.split(".")[0]
		if name != sub and not frappe.db.exists("Buildiary Tenant", sub):
			rename_doc("Buildiary Tenant", name, sub, force=True, ignore_permissions=True, show_alert=False)
			name = sub
		frappe.db.set_value("Buildiary Tenant", name, {"site_host": new, "subdomain": sub}, update_modified=False)
		frappe.db.commit()
		push(frappe.get_doc("Buildiary Tenant", name))
		frappe.db.commit()
	print("MOVED", old, new)


def reserve(names):
	"""Adds names customers can't take for their workspace (e.g. a name used by another app on the server)."""
	s = frappe.get_single("Buildiary Cloud Settings")
	have = [x.strip().lower() for x in (s.reserved_names or "").split() if x.strip()]
	add = [n for n in str(names).lower().split() if n and n not in have]
	if add:
		s.reserved_names = "\n".join(have + add)
		s.flags.ignore_permissions = True
		s.save()
		frappe.db.commit()
	print("RESERVED", " ".join(have + add))


def register_site(host, company, email, contact_name="Owner", sub=None, internal=1, mode="Owner", country="Pakistan", language="en"):
	"""A workspace made outside sign-up (e.g. SMH Global's own) joins the console."""
	from buildiary.saas.common import push

	sub = sub or host.split(".")[0]
	t = frappe.get_doc("Buildiary Tenant", sub) if frappe.db.exists("Buildiary Tenant", sub) else frappe.new_doc("Buildiary Tenant")
	t.update({"subdomain": sub, "site_host": host, "company_name": company, "contact_name": contact_name, "email": email, "country": country, "language": language,
		"mode": mode, "plan": frappe.db.get_value("Buildiary Plan", {"mode": mode}, "name"), "is_internal": int(internal), "status": "Active",
		"signed_up_on": t.signed_up_on or now_datetime(), "trial_ends": t.trial_ends or nowdate()})
	if not t.get("tenant_key"):
		t.tenant_key = frappe.generate_hash(length=40)
	t.save(ignore_permissions=True)
	push(t)
	frappe.db.commit()
	print("REGISTERED", host)
