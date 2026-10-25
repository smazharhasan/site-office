import frappe
from frappe import _
from frappe.model.document import Document


class SiteInspection(Document):
	def validate(self):
		if self.result == "Fail" and not self.actions:
			frappe.throw(_("A failed inspection needs at least one corrective action."))
		if any(c.result == "Not OK" for c in self.checks) and not self.actions:
			frappe.throw(_("Some checks are not OK: add the corrective actions."))

	def on_submit(self):
		for a in self.actions:
			if a.snag:
				continue
			snag = frappe.get_doc(
				{
					"doctype": "Site Snag",
					"description": f"{a.issue} — {a.action}",
					"location": self.location,
					"project": self.project,
					"photo": a.photo,
					"supplier": a.supplier or self.supplier,
					"responsible_person": a.responsible_person,
					"target_date": a.target_date,
					"source_inspection": self.name,
					"status": "Open",
				}
			).insert(ignore_permissions=True)
			a.db_set("snag", snag.name)
