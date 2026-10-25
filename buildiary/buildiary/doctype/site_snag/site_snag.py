import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import today


class SiteSnag(Document):
	def validate(self):
		if self.status in ("Fixed", "Closed") and not self.fixed_photo:
			frappe.throw(_("Add a photo after fixing before marking the snag {0}.").format(_(self.status)))
		if self.status == "Closed" and not self.closed_on:
			self.closed_on = today()
			self.closed_by = frappe.session.user
		if self.status != "Closed":
			self.closed_on = None
			self.closed_by = None
