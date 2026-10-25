"""One time only: the last records of a workspace that still carried the product's earlier names.

- people who sign in with a site card: their user ids <id>@staff.mimaar become <id>@staff.buildiary
  (their history follows; they sign in again with the card);
- files attached to the renamed custom fields point at the new field names;
- role profiles show their new names;
- the note on payment plans imported from the old app, and the kept copy of the old app's data.
Safe to run on any site: there is nothing to do on new ones.
"""

import os

import frappe
from frappe.model.rename_doc import rename_doc

OLD_DOMAINS = ("@staff.mimaar", "@staff.mabni")


def execute():
	for old_domain in OLD_DOMAINS:
		for old in frappe.get_all("User", filters={"name": ["like", f"%{old_domain}"]}, pluck="name"):
			new = old[: -len(old_domain)] + "@staff.buildiary"
			if frappe.db.exists("User", new):
				continue
			rename_doc("User", old, new, force=True, ignore_permissions=True, show_alert=False, rebuild_search=False)
			frappe.db.sql("update tabDefaultValue set parent=%s where parent=%s", (new, old))
			frappe.db.sql("update `tabIdentity Check` set checked_by=%s where checked_by=%s", (new, old))
			frappe.db.sql("update `tabSite Attendance` set marked_by=%s where marked_by=%s", (new, old))
	for prefix in ("mimaar_", "mabni_"):
		frappe.db.sql(
			f"update tabFile set attached_to_field=concat('buildiary_', substring(attached_to_field, {len(prefix) + 1})) where attached_to_field like %s",
			(prefix.replace("_", "\\_") + "%",))
	for rp in frappe.get_all("Role Profile", fields=["name", "role_profile"]):
		if rp.role_profile != rp.name and rp.name.startswith("Buildiary "):
			frappe.db.set_value("Role Profile", rp.name, "role_profile", rp.name, update_modified=False)
	frappe.db.sql("""update `tabSupplier Quotation` set terms=replace(terms, 'brought across from the old Mimaar app', 'brought in from the project data file')
		where terms like '%%old Mimaar app%%'""")
	# the kept copy of the old app's data (now buildiary-old-app.json) and the imported file
	priv = frappe.get_site_path("private")
	old, new = os.path.join(priv, "mimaar-old-app.json"), os.path.join(priv, "buildiary-old-app.json")
	if os.path.exists(old):
		if os.path.exists(new):
			os.remove(old)
		else:
			os.rename(old, new)
	f = frappe.db.get_value("File", {"file_url": "/private/files/mimaar-data.json"}, "name")
	if f:
		src, dst = frappe.get_site_path("private", "files", "mimaar-data.json"), frappe.get_site_path("private", "files", "buildiary-data.json")
		if os.path.exists(src) and not os.path.exists(dst):
			os.rename(src, dst)
		if os.path.exists(dst):
			frappe.db.set_value("File", f, {"file_name": "buildiary-data.json", "file_url": "/private/files/buildiary-data.json"}, update_modified=False)
	frappe.db.commit()
