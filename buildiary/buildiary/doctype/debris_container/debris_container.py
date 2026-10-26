import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_days, cint, flt, getdate, nowdate


class DebrisContainer(Document):
	def validate(self):
		self.container_no = (self.container_no or "").strip().upper()
		if flt(self.size_m3) < 0:
			frappe.throw(_("The size can't be below zero."))
		if cint(self.every_days) < 0:
			self.every_days = 0
		if cint(self.every_days) and self.status != "Removed" and not self.next_collection:
			self.next_collection = add_days(getdate(self.placed_on or nowdate()), cint(self.every_days))
		if not cint(self.every_days):
			self.next_collection = None
