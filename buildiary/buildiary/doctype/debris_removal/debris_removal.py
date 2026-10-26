import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt


class DebrisRemoval(Document):
	def validate(self):
		if not (self.supplier or self.container):
			frappe.throw(_("Choose the skip or the supplier."))
		if self.container and not self.supplier:
			self.supplier = frappe.db.get_value("Debris Container", self.container, "supplier")
		if flt(self.cost) < 0:
			frappe.throw(_("The cost can't be below zero."))
		if cint(self.loads) < 1:
			self.loads = 1
