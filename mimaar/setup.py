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
		F("mimaar_section", "Section Break", "Release to work", "stock_entry_type", depends_on="eval:doc.stock_entry_type=='Material Issue'"),
		F("mimaar_issued_to", "Data", "Released to (mistri or group head)", "mimaar_section"),
		F("mimaar_work_area", "Data", "Area / activity", "mimaar_issued_to"),
		F("mimaar_col", "Column Break", "", "mimaar_work_area"),
		F("mimaar_photo", "Attach Image", "Photo", "mimaar_col"),
	],
}

TRACKED = ["Supplier", "Supplier Quotation", "Request for Quotation", "Purchase Order", "Purchase Receipt", "Purchase Invoice", "Payment Entry", "Stock Entry", "Item", "Project", "Task", "Budget"]


def before_install():
	"""Roles the Mimaar doctypes refer to; created before the doctypes are synced."""
	for role in ("Site Supervisor",):
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(ignore_permissions=True)


def after_install():
	create_custom_fields(CUSTOM_FIELDS, update=True)
	after_migrate()


def after_migrate():
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
	_single("Buying Settings", {"po_required": "Yes", "pr_required": "Yes", "maintain_same_rate": 1, "maintain_same_rate_action": "Stop", "supp_master_name": "Supplier Name", "allow_multiple_items": 1, "over_order_allowance": 0, "bill_for_rejected_quantity_in_purchase_invoice": 0})
	_single("Stock Settings", {"allow_negative_stock": 0, "over_delivery_receipt_allowance": 0, "item_naming_by": "Item Code", "stock_uom": "Nos"})
	_single("Accounts Settings", {"over_billing_allowance": 0, "check_supplier_invoice_uniqueness": 1, "unlink_payment_on_cancellation_of_invoice": 0, "automatically_fetch_payment_terms": 0})
	_single("Print Settings", {"allow_print_for_draft": 0, "allow_print_for_cancelled": 0, "send_print_as_pdf": 1})
	_single("System Settings", {"date_format": "dd-mm-yyyy", "country": "Pakistan", "time_zone": "Asia/Karachi", "float_precision": "3", "currency_precision": "2"})
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


def enable_urdu():
	if frappe.db.exists("Language", "ur"):
		frappe.db.set_value("Language", "ur", "enabled", 1)
	else:
		frappe.get_doc({"doctype": "Language", "language_code": "ur", "language_name": "اردو", "enabled": 1}).insert(ignore_permissions=True)
