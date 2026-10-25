"""One time only: the records of a site made before the product took the single name Buildiary.

Runs before the document types are synced (pre_model_sync), after patches/rename_pre.py has
renamed the app and its modules. Renames document types, roles, role profiles and the custom
fields' columns; removes the old workspace, sidebar and app icon (synced again under the new name).
Safe to run on a new site: there is nothing to rename. Delete this file and rename_pre.py once
every server has moved.
"""

import frappe
from frappe.model.rename_doc import rename_doc

DOCTYPES = {
	"Mabni Settings": "Buildiary Cloud Settings",  # before its child table
	"Mabni Bank Account": "Buildiary Bank Account",
	"Mabni Tenant": "Buildiary Tenant",
	"Mabni Plan": "Buildiary Plan",
	"Mabni Payment": "Buildiary Payment",
	"Mimaar Settings": "Buildiary Settings",
}
ROLES = {"Mimaar Partner": "Buildiary Partner", "Mabni Admin": "Buildiary Admin"}
PROFILES = {
	"Mimaar Owner": "Buildiary Owner",
	"Mimaar Site Supervisor": "Buildiary Site Supervisor",
	"Mimaar Owner Supervisor": "Buildiary Owner Supervisor",
	"Mimaar Partner": "Buildiary Partner",
	"Mimaar Store Keeper": "Buildiary Store Keeper",
	"Mimaar Accountant": "Buildiary Accountant",
}
OLD_PAGES = ("Mimaar", "Mabni Cloud")
PREFIXES = ("mimaar_", "mabni_")
OLD_ASSETS = "/assets/mimaar/"


def _rename(doctype, old, new):
	if not frappe.db.exists(doctype, old):
		return
	# the new role may exist already (the app creates its roles before every migrate): merge into it
	merge = bool(frappe.db.exists(doctype, new))
	rename_doc(doctype, old, new, force=True, merge=merge, ignore_permissions=True, show_alert=False, rebuild_search=False)
	print(f"  {doctype}: {old} -> {new}" + (" (merged)" if merge else ""))


def _new_field(name):
	for p in PREFIXES:
		if name and name.startswith(p):
			return "buildiary_" + name[len(p):]
	return name


def custom_fields():
	"""Custom fields keep their data: the column is renamed, then the Custom Field record."""
	rows = frappe.db.sql(
		"select name, dt, fieldname, fieldtype from `tabCustom Field` where fieldname like 'mimaar\\_%%' or fieldname like 'mabni\\_%%'", as_dict=True)
	for r in rows:
		new = _new_field(r.fieldname)
		if frappe.db.has_column(r.dt, r.fieldname) and not frappe.db.has_column(r.dt, new):
			frappe.db.rename_column(r.dt, r.fieldname, new)
		if frappe.db.exists("Custom Field", f"{r.dt}-{new}"):
			frappe.db.delete("Custom Field", {"name": r.name})
		else:
			frappe.db.sql("update `tabCustom Field` set name=%s, fieldname=%s where name=%s", (f"{r.dt}-{new}", new, r.name))
	for p in PREFIXES:
		like = p.replace("_", "\\_") + "%"
		frappe.db.sql(f"update `tabCustom Field` set insert_after=concat('buildiary_', substring(insert_after, {len(p) + 1})) where insert_after like %s", (like,))
		frappe.db.sql(f"update `tabProperty Setter` set field_name=concat('buildiary_', substring(field_name, {len(p) + 1})), name=replace(name, %s, 'buildiary_') where field_name like %s", (p, like))
		frappe.db.sql("update `__UserSettings` set data=replace(data, %s, 'buildiary_')", (p,))
	if rows:
		print(f"  {len(rows)} custom fields renamed")


def execute():
	for old, new in DOCTYPES.items():
		_rename("DocType", old, new)
	for old, new in ROLES.items():
		_rename("Role", old, new)
	for old, new in PROFILES.items():
		_rename("Role Profile", old, new)
	custom_fields()
	# the old workspace, sidebar and app icon; the app's files bring them back under the new name
	for doctype in ("Workspace", "Workspace Sidebar", "Sidebar", "Desktop Icon"):
		if frappe.db.table_exists(doctype):
			for name in OLD_PAGES:
				if frappe.db.exists(doctype, name):
					frappe.delete_doc(doctype, name, force=True, ignore_permissions=True, ignore_missing=True)
	for name in frappe.get_all("Desktop Icon", filters={"label": ["in", OLD_PAGES]}, pluck="name") if frappe.db.table_exists("Desktop Icon") else []:
		frappe.delete_doc("Desktop Icon", name, force=True, ignore_permissions=True, ignore_missing=True)
	# names kept in settings: the reserved workspace names and the product name shown on the sign-in page
	if frappe.db.table_exists("Buildiary Cloud Settings") or frappe.db.exists("DocType", "Buildiary Cloud Settings"):
		names = (frappe.db.get_single_value("Buildiary Cloud Settings", "reserved_names") or "").split("\n")
		if any(n in ("mimaar", "mabni") for n in names):
			keep = []
			for n in ["buildiary" if n in ("mimaar", "mabni") else n for n in names]:
				if n and n not in keep:
					keep.append(n)
			frappe.db.set_single_value("Buildiary Cloud Settings", "reserved_names", "\n".join(keep))
	for doctype in ("Website Settings", "System Settings", "Navbar Settings"):
		try:
			if (frappe.db.get_single_value(doctype, "app_name") or "") in ("Mimaar", "Mabni", "Mimaar ERP"):
				frappe.db.set_single_value(doctype, "app_name", "Buildiary")
		except Exception:
			pass
	# the logo in the browser tab and on the sign-in page
	for doctype in ("Website Settings", "Navbar Settings"):
		for field in ("app_logo", "favicon", "splash_image", "brand_html"):
			try:
				v = frappe.db.get_single_value(doctype, field)
			except Exception:
				continue
			if v and OLD_ASSETS in v:
				frappe.db.set_single_value(doctype, field, "/assets/buildiary/images/buildiary-logo.svg" if field != "brand_html" else "")
	frappe.db.commit()
