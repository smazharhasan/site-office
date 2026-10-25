"""Install and migrate: custom fields, the recommended ERPNext settings, the
Urdu."""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.custom.doctype.property_setter.property_setter import make_property_setter

WORK_AREAS = "Materials\nGrey structure\nFinishing\nDesign\nTesting & verification\nServices"


def F(fieldname, fieldtype, label, insert_after, **kw):
	d = {"fieldname": fieldname, "fieldtype": fieldtype, "label": label, "insert_after": insert_after}
	d.update(kw)
	return d


CUSTOM_FIELDS = {
	"Supplier": [
		F("mimaar_section", "Section Break", "Supply terms", "country", collapsible=0),
		F("mimaar_work_area", "Select", "Work area", "mimaar_section", options=WORK_AREAS, default="Materials", in_standard_filter=1, in_list_view=1),
		F("mimaar_payment_terms", "Small Text", "Payment terms", "mimaar_work_area"),
		F("mimaar_col", "Column Break", "", "mimaar_payment_terms"),
		F("mimaar_delivery_time", "Data", "Delivery time", "mimaar_col"),
	],
	"Supplier Quotation": [
		F("mimaar_section", "Section Break", "Confirmation", "supplier_name"),
		F("mimaar_final", "Check", "Locked as final", "mimaar_section", allow_on_submit=1, read_only=1, in_list_view=1, in_standard_filter=1, no_copy=1),
		F("mimaar_final_on", "Datetime", "Locked on", "mimaar_final", allow_on_submit=1, read_only=1, no_copy=1),
		F("mimaar_revision", "Int", "Revision", "mimaar_final_on", read_only=1, no_copy=1, default="0", in_list_view=1),
		F("mimaar_revision_note", "Small Text", "What changed in this revision", "mimaar_revision", no_copy=1, depends_on="eval:doc.amended_from"),
		F("mimaar_col", "Column Break", "", "mimaar_revision_note"),
		F("mimaar_document", "Attach", "Supplier's document (scan)", "mimaar_col"),
		F("mimaar_contract_requested", "Check", "Contract asked from the supplier", "mimaar_document", allow_on_submit=1, read_only=1, no_copy=1),
		F("mimaar_terms_section", "Section Break", "Supplier's terms", "taxes"),
		F("mimaar_payment_terms", "Small Text", "Payment terms", "mimaar_terms_section", reqd=1),
		F("mimaar_advance_percent", "Percent", "Advance asked (% of total)", "mimaar_payment_terms"),
		F("mimaar_col2", "Column Break", "", "mimaar_advance_percent"),
		F("mimaar_delivery_time", "Data", "Delivery / completion time", "mimaar_col2", reqd=1),
	],
	"Purchase Order": [
		F("mimaar_section", "Section Break", "Terms agreed", "taxes"),
		F("mimaar_payment_terms", "Small Text", "Payment terms", "mimaar_section"),
		F("mimaar_advance_percent", "Percent", "Advance (% of PO total)", "mimaar_payment_terms"),
		F("mimaar_col", "Column Break", "", "mimaar_advance_percent"),
		F("mimaar_delivery_time", "Data", "Delivery / completion time", "mimaar_col"),
		F("mimaar_site_address", "Small Text", "Deliver to (site address)", "mimaar_delivery_time"),
	],
	"Purchase Receipt": [
		F("mimaar_section", "Section Break", "Receiving at site", "supplier_delivery_note"),
		F("mimaar_dn_scan", "Attach Image", "Delivery note / bill scan", "mimaar_section"),
		F("mimaar_receiver_photo", "Attach Image", "Receiver's photo", "mimaar_dn_scan"),
		F("mimaar_col", "Column Break", "", "mimaar_receiver_photo"),
		F("mimaar_received_by", "Data", "Received by", "mimaar_col"),
		F("mimaar_vehicle", "Data", "Vehicle no.", "mimaar_received_by"),
		F("mimaar_goods_photo", "Attach Image", "Photo of the material", "mimaar_vehicle"),
		F("mimaar_receiver", "Link", "Receiver (site card)", "mimaar_goods_photo", options="Site Worker"),
		F("mimaar_identity_check", "Link", "Receiver's face check", "mimaar_receiver", options="Identity Check", read_only=1),
	],
	"Purchase Invoice": [
		F("mimaar_bill_scan", "Attach", "Bill / invoice scan", "bill_date"),
	],
	"Payment Entry": [
		F("mimaar_section", "Section Break", "Proof of payment", "reference_date"),
		F("mimaar_proof", "Attach Image", "Proof of payment", "mimaar_section"),
		F("mimaar_col", "Column Break", "", "mimaar_proof"),
		F("mimaar_proof_2", "Attach Image", "Second proof (receipt from the supplier)", "mimaar_col"),
	],
	"Stock Entry": [
		F("mimaar_section", "Section Break", "Release to work / return to store", "stock_entry_type", depends_on="eval:in_list(['Material Issue','Material Receipt'], doc.stock_entry_type)"),
		F("mimaar_issued_to", "Data", "Released to / returned by (mistri or group head)", "mimaar_section"),
		F("mimaar_person", "Link", "Person (site card)", "mimaar_issued_to", options="Site Worker"),
		F("mimaar_work_area", "Data", "Area / activity", "mimaar_person"),
		F("mimaar_col", "Column Break", "", "mimaar_work_area"),
		F("mimaar_photo", "Attach Image", "Photo", "mimaar_col"),
		F("mimaar_identity_check", "Link", "Face check", "mimaar_photo", options="Identity Check", read_only=1),
		F("mimaar_is_return", "Check", "Returned from work to the store", "mimaar_identity_check", read_only=1),
		F("mimaar_water_ref", "Data", "Water tanker / tank reading", "mimaar_is_return", read_only=1),
	],
}

PHASES = "Design\nApprovals\nGrey structure\nFinishing\nHandover"
BUDGET_CATEGORIES = "\nDesign & approvals\nService charges\nGrey labour\nGrey materials\nFinishing labour\nFinishing materials\nContingency\nSite running costs\nOther"
CUSTOM_FIELDS["Task"] = [
	F("mimaar_section", "Section Break", "Build progress (Mimaar)", "description"),
	F("mimaar_phase", "Select", "Phase", "mimaar_section", options=PHASES),
	F("mimaar_reported", "Percent", "Reported (%)", "mimaar_phase", read_only=1, description="The latest progress reported from site."),
	F("mimaar_col", "Column Break", "", "mimaar_reported"),
	F("mimaar_verified", "Percent", "Verified by the owner's side (%)", "mimaar_col", read_only=1),
	F("mimaar_verified_by", "Link", "Verified by", "mimaar_verified", options="User", read_only=1),
	F("mimaar_verified_on", "Date", "Verified on", "mimaar_verified_by", read_only=1),
]
CUSTOM_FIELDS["Project"] = [
	F("mabni_store", "Link", "Store (warehouse)", "company", options="Warehouse",
		description="Where this project's materials are kept. Each project has its own store."),
]
CUSTOM_FIELDS["Account"] = [
	F("mimaar_budget_category", "Select", "Budget category (Mimaar)", "account_type", options=BUDGET_CATEGORIES,
		description="Groups the budget lines on the phone (Design, Grey, Finishing, Contingency ...)."),
]

TRACKED = ["Supplier", "Supplier Quotation", "Request for Quotation", "Purchase Order", "Purchase Receipt", "Purchase Invoice", "Payment Entry", "Stock Entry", "Item", "Project", "Task", "Budget"]


def before_install():
	"""Roles the Mimaar doctypes refer to; created before the doctypes are synced."""
	for role in ("Site Supervisor", "Mimaar Partner", "Mabni Admin"):
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(ignore_permissions=True)


def after_install():
	create_custom_fields(CUSTOM_FIELDS, update=True)
	after_migrate()


def after_migrate():
	before_install()
	create_custom_fields(CUSTOM_FIELDS, update=True)
	for dt in TRACKED:
		if frappe.db.exists("DocType", dt) and not frappe.db.get_value("DocType", dt, "track_changes"):
			make_property_setter(dt, None, "track_changes", 1, "Check", for_doctype=True, validate_fields_for_doctype=False)
	enable_urdu()
	role_profiles()
	settings_defaults()
	if frappe.is_setup_complete():
		apply_settings()
	frappe.clear_cache()


def brand():
	"""The product's name and logo on the sign-in page and in the browser tab."""
	if (frappe.db.get_single_value("Website Settings", "app_name") or "") in ("", "Frappe", "ERPNext", "Mimaar", "Mabni"):
		frappe.db.set_single_value("Website Settings", "app_name", "Buildiary")
	if (frappe.db.get_single_value("Website Settings", "app_logo") or "") in ("", "/assets/mimaar/images/mabni-logo.svg"):
		frappe.db.set_single_value("Website Settings", "app_logo", "/assets/mimaar/images/buildiary-logo.svg")


def after_setup(args=None):
	apply_settings()


def _single(doctype, values):
	doc = frappe.get_single(doctype)
	changed = False
	for k, v in values.items():
		if doc.meta.has_field(k) and doc.get(k) != v:
			doc.set(k, v)
			changed = True
	if changed:
		doc.flags.ignore_permissions = True
		doc.flags.ignore_mandatory = True
		doc.save()


def apply_settings():
	"""The ERPNext settings that carry the owner's rules. Safe to run again."""
	bank_account()
	water_setup()
	petty_setup()
	task_phases()
	budget_categories()
	_single("Buying Settings", {"po_required": "Yes", "pr_required": "Yes", "maintain_same_rate": 1, "maintain_same_rate_action": "Stop", "supp_master_name": "Supplier Name", "allow_multiple_items": 1, "over_order_allowance": 0, "bill_for_rejected_quantity_in_purchase_invoice": 0})
	_single("Stock Settings", {"allow_negative_stock": 0, "over_delivery_receipt_allowance": 0, "item_naming_by": "Item Code", "stock_uom": "Nos"})
	_single("Accounts Settings", {"over_billing_allowance": 0, "check_supplier_invoice_uniqueness": 1, "unlink_payment_on_cancellation_of_invoice": 0, "automatically_fetch_payment_terms": 0})
	_single("Print Settings", {"allow_print_for_draft": 0, "allow_print_for_cancelled": 0, "send_print_as_pdf": 1})
	brand()
	ss = {"date_format": "dd-mm-yyyy", "float_precision": "3", "currency_precision": "2"}
	if not frappe.db.get_single_value("System Settings", "country"):
		ss.update(country="Pakistan", time_zone="Asia/Karachi")
	_single("System Settings", ss)
	if not frappe.db.exists("Item Group", "Construction Materials"):
		root = frappe.db.get_value("Item Group", {"is_group": 1, "parent_item_group": ["in", ["", None]]}, "name") or "All Item Groups"
		for g in ("Construction Materials", "Finishing Materials", "Services and Labour", "Tools and Equipment", "Site Consumables"):
			if not frappe.db.exists("Item Group", g):
				frappe.get_doc({"doctype": "Item Group", "item_group_name": g, "parent_item_group": root, "is_group": 0}).insert(ignore_permissions=True)
	for g in ("Materials", "Grey structure", "Finishing", "Design", "Testing & verification", "Services"):
		if not frappe.db.exists("Supplier Group", g):
			root = frappe.db.get_value("Supplier Group", {"is_group": 1}, "name") or "All Supplier Groups"
			frappe.get_doc({"doctype": "Supplier Group", "supplier_group_name": g, "parent_supplier_group": root}).insert(ignore_permissions=True)


# Pick one of these on each user (User → Role Profiles); the owner signs in as the first user.
ROLE_PROFILES = {
	"Mimaar Owner": ["System Manager", "Site Supervisor", "Purchase Manager", "Purchase Master Manager", "Purchase User", "Item Manager", "Stock Manager", "Stock User", "Accounts Manager", "Accounts User", "Projects Manager", "Projects User"],
	"Mimaar Site Supervisor": ["Site Supervisor", "Purchase User", "Purchase Master Manager", "Item Manager", "Stock User", "Projects User"],
	"Mimaar Owner Supervisor": ["Site Supervisor", "Projects Manager", "Purchase User", "Purchase Master Manager", "Item Manager", "Stock User", "Projects User"],
	"Mimaar Partner": ["Mimaar Partner", "Projects User"],
	"Mimaar Store Keeper": ["Stock User", "Projects User"],
	"Mimaar Accountant": ["Accounts User", "Accounts Manager", "Purchase User", "Projects User"],
}


def settings_defaults():
	"""New controls added in an update start switched on, as on a new site."""
	have = set(frappe.db.sql_list("select field from tabSingles where doctype='Mimaar Settings'"))
	for df in frappe.get_meta("Mimaar Settings").fields:
		if df.fieldtype in ("Check", "Int", "Data", "Select") and df.default and df.fieldname not in have:
			frappe.db.set_single_value("Mimaar Settings", df.fieldname, df.default)


def role_profiles():
	for name, roles in ROLE_PROFILES.items():
		roles = [r for r in roles if frappe.db.exists("Role", r)]
		if frappe.db.exists("Role Profile", name):
			doc = frappe.get_doc("Role Profile", name)
			have = {r.role for r in doc.roles}
			if have >= set(roles):
				continue
			for r in roles:
				if r not in have:
					doc.append("roles", {"role": r}).db_insert()  # no re-save: that queues a job on every user
		else:
			frappe.get_doc({"doctype": "Role Profile", "role_profile": name, "roles": [{"role": r} for r in roles]}).insert(ignore_permissions=True)


def bank_account():
	"""A bank ledger so suppliers can be paid by transfer or cheque (cash is there already)."""
	for co in frappe.get_all("Company", fields=["name", "abbr", "default_bank_account"]):
		acc = co.default_bank_account or frappe.db.get_value("Account", {"company": co.name, "account_type": "Bank", "is_group": 0})
		if not acc:
			parent = frappe.db.get_value("Account", {"company": co.name, "account_type": "Bank", "is_group": 1}) or frappe.db.get_value("Account", {"company": co.name, "account_name": "Bank Accounts", "is_group": 1})
			if not parent:
				continue
			acc = frappe.get_doc({"doctype": "Account", "account_name": "Bank", "parent_account": parent, "company": co.name, "account_type": "Bank", "is_group": 0}).insert(ignore_permissions=True).name
		if not co.default_bank_account:
			frappe.db.set_value("Company", co.name, "default_bank_account", acc)
		for mode in ("Wire Transfer", "Cheque", "Bank Draft"):
			if not frappe.db.exists("Mode of Payment", mode):
				continue
			m = frappe.get_doc("Mode of Payment", mode)
			if not any(a.company == co.name for a in m.accounts):
				m.append("accounts", {"company": co.name, "default_account": acc})
				m.save(ignore_permissions=True)


def enable_urdu():
	if frappe.db.exists("Language", "ur"):
		frappe.db.set_value("Language", "ur", "enabled", 1)
	else:
		frappe.get_doc({"doctype": "Language", "language_code": "ur", "language_name": "اردو", "enabled": 1}).insert(ignore_permissions=True)


def local_site(data_file=None, company="Villa 31", abbr="V31"):
	"""One-step set-up for a laptop or test site: the setup wizard with Pakistan defaults
	(the owner signs in as Administrator), then the project data from the old app's file.
	Safe to run again.

	    bench --site <site> execute mimaar.setup.local_site --kwargs "{'data_file': '/data/mimaar-data.json'}"
	"""
	import json
	import os

	if not frappe.is_setup_complete():
		from frappe.desk.page.setup_wizard.setup_wizard import setup_complete

		frappe.local.lang = "en"
		result = setup_complete({
			"language": "English", "country": "Pakistan", "timezone": "Asia/Karachi", "currency": "PKR",
			"full_name": "Owner", "company_name": company, "company_abbr": abbr, "chart_of_accounts": "Standard",
			"fy_start_date": "2026-07-01", "fy_end_date": "2027-06-30", "setup_demo": 0,
		})
		if (result or {}).get("status") != "ok":
			raise Exception(f"Setup wizard did not finish: {result}")
		frappe.db.commit()
		print("Set-up done:", company)
	if data_file and os.path.exists(data_file):
		from mimaar.migration.old_app import run

		data = json.load(open(data_file, encoding="utf-8"))
		run(data=data)
		keep_old_app_data(data)
	elif data_file:
		print("No data file at", data_file)
	frappe.db.commit()


def _main_company():
	return frappe.db.get_single_value("Global Defaults", "default_company") or (frappe.get_all("Company", pluck="name", limit=1) or [None])[0]


DEF_TANKS = [("Underground tank", "Underground", 5000), ("Overhead tank", "Overhead", 1000), ("Site drums / curing", "Drums", 500), ("Direct use on slab", "Direct use", 0)]


def water_setup():
	"""Water is kept as stock: the item Water (gallons) in its own store, and the site's tanks."""
	co = _main_company()
	if not co:
		return
	abbr = frappe.db.get_value("Company", co, "abbr")
	if not frappe.db.get_single_value("Mimaar Settings", "water_warehouse"):
		name = f"Water tanks - {abbr}"
		if not frappe.db.exists("Warehouse", name):
			parent = frappe.db.get_value("Warehouse", {"company": co, "is_group": 1}, "name")
			name = frappe.get_doc({"doctype": "Warehouse", "warehouse_name": "Water tanks", "company": co, "parent_warehouse": parent, "is_group": 0}).insert(ignore_permissions=True).name
		frappe.db.set_single_value("Mimaar Settings", "water_warehouse", name)
	if not frappe.db.exists("UOM", "Gallon"):
		frappe.get_doc({"doctype": "UOM", "uom_name": "Gallon"}).insert(ignore_permissions=True)
	if not frappe.db.exists("Item", "WATER"):
		group = "Site Consumables" if frappe.db.exists("Item Group", "Site Consumables") else frappe.db.get_value("Item Group", {"is_group": 0}, "name")
		frappe.get_doc({"doctype": "Item", "item_code": "WATER", "item_name": "Water", "item_group": group, "stock_uom": "Gallon", "is_stock_item": 1,
			"include_item_in_manufacturing": 0, "description": "Water from tankers, kept in the site's tanks (gallons)."}).insert(ignore_permissions=True)
	if not frappe.db.count("Water Tank"):
		for i, (name, kind, cap) in enumerate(DEF_TANKS):
			frappe.get_doc({"doctype": "Water Tank", "tank_name": name, "kind": kind, "capacity_gallons": cap, "sort_order": i + 1, "is_active": 1}).insert(ignore_permissions=True)


PC_CATEGORIES = [("Canteen & food", 0), ("Water tanker", 0), ("Transport & fuel", 0), ("Small tools & hardware", 0), ("Labour advance", 1),
	("Repairs & maintenance", 0), ("Stationery & phone", 0), ("Other site expenses", 0)]


def petty_setup():
	"""Petty cash: one cash account for the cash held on site, and what it is spent on, each
	booked to its own expense account (a budget line the owner sets in Accounting > Budget)."""
	co = _main_company()
	if not co:
		return
	abbr = frappe.db.get_value("Company", co, "abbr")
	if not frappe.db.get_single_value("Mimaar Settings", "petty_cash_account"):
		name = f"Petty Cash - {abbr}"
		if not frappe.db.exists("Account", name):
			parent = frappe.db.get_value("Account", {"company": co, "account_type": "Cash", "is_group": 1}, "name")
			if not parent:
				return
			name = frappe.get_doc({"doctype": "Account", "account_name": "Petty Cash", "parent_account": parent, "company": co, "account_type": "Cash", "is_group": 0}).insert(ignore_permissions=True).name
		frappe.db.set_single_value("Mimaar Settings", "petty_cash_account", name)
	if frappe.db.count("Petty Cash Category"):
		return
	budgeted = frappe.db.get_value("Budget", {"company": co, "docstatus": 1}, "account")
	top = (frappe.db.get_value("Account", budgeted, "parent_account") if budgeted else None) or frappe.db.get_value("Account", {"company": co, "account_name": "Direct Expenses", "is_group": 1}, "name")
	if not top:
		return
	grp = f"Site running costs - {abbr}"
	if not frappe.db.exists("Account", grp):
		grp = frappe.get_doc({"doctype": "Account", "account_name": "Site running costs", "parent_account": top, "company": co, "is_group": 1, "root_type": "Expense"}).insert(ignore_permissions=True).name
	for i, (cat, wages) in enumerate(PC_CATEGORIES):
		acc = f"{cat} - {abbr}"
		if not frappe.db.exists("Account", acc):
			acc = frappe.get_doc({"doctype": "Account", "account_name": cat, "parent_account": grp, "company": co, "account_type": "Expense Account", "is_group": 0}).insert(ignore_permissions=True).name
		frappe.get_doc({"doctype": "Petty Cash Category", "category_name": cat, "expense_account": acc, "is_active": 1, "for_wages": wages, "sort_order": i + 1}).insert(ignore_permissions=True)


OLD_APP_FILE = "mimaar-old-app.json"


def keep_old_app_data(data):
	"""A copy of the old app's file in the site's private folder (not served on the web):
	later updates use it to fill in details the first import did not keep (e.g. budget categories)."""
	import json

	keep = {k: data.get(k) for k in ("project", "budget", "milestones") if data.get(k) is not None}
	with open(frappe.get_site_path("private", OLD_APP_FILE), "w", encoding="utf-8") as f:
		json.dump(keep, f, ensure_ascii=False)


def _old_app_data():
	import json
	import os

	p = frappe.get_site_path("private", OLD_APP_FILE)
	if os.path.exists(p):
		try:
			return json.load(open(p, encoding="utf-8"))
		except ValueError:
			return {}
	return {}


PHASE_OF_CODE = {"D": "Design", "A": "Approvals", "G": "Grey structure", "F": "Finishing", "H": "Handover"}
PHASE_OF_NAME = {"design": "Design", "approval": "Approvals", "grey": "Grey structure", "finishing": "Finishing", "handover": "Handover"}


def task_phases():
	"""Each schedule stage gets its phase (from the stage code D1, G2 ... or the description)."""
	if not frappe.db.has_column("Task", "mimaar_phase"):
		return
	for t in frappe.get_all("Task", filters={"mimaar_phase": ["in", ["", None]]}, fields=["name", "subject", "description"], limit_page_length=2000):
		ph = None
		desc = (t.description or "").lower()
		for k, v in PHASE_OF_NAME.items():
			if desc.startswith(k):
				ph = v
				break
		if not ph and t.subject and len(t.subject) > 1 and t.subject[0] in PHASE_OF_CODE and t.subject[1].isdigit():
			ph = PHASE_OF_CODE[t.subject[0]]
		if ph:
			frappe.db.set_value("Task", t.name, "mimaar_phase", ph, update_modified=False)


def _guess_category(name):
	n = (name or "").lower()
	if "contingen" in n:
		return "Contingency"
	if "design" in n or "approval" in n or "consult" in n:
		return "Design & approvals"
	if "service charge" in n:
		return "Service charges"
	grey = any(w in n for w in ("grey", "steel", "cement", "block", "sand", "crush", "brick", "concrete", "excavat", "shutter"))
	labour = any(w in n for w in ("labour", "labor", "polish work", "mason"))
	if labour:
		return "Grey labour" if grey else "Finishing labour"
	return "Grey materials" if grey else "Finishing materials"


def budget_categories():
	"""Budget lines grouped for the phone: from the old app's file when there is one, else from the line's name."""
	if not frappe.db.has_column("Account", "mimaar_budget_category"):
		return
	known = {b.get("name"): b.get("category") for b in (_old_app_data().get("budget") or [])}
	pc = set(frappe.get_all("Petty Cash Category", pluck="expense_account")) if frappe.db.exists("DocType", "Petty Cash Category") else set()
	opts = set(BUDGET_CATEGORIES.split("\n"))
	accounts = set(frappe.db.sql_list("select distinct account from `tabBudget` where docstatus = 1")) | pc
	for acc in accounts:
		a = frappe.db.get_value("Account", acc, ["account_name", "mimaar_budget_category"], as_dict=True)
		if not a or a.mimaar_budget_category:
			continue
		cat = "Site running costs" if acc in pc else known.get(a.account_name) or _guess_category(a.account_name)
		if cat not in opts:
			cat = "Other"
		frappe.db.set_value("Account", acc, "mimaar_budget_category", cat, update_modified=False)
