import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class WaterTank(Document):
	def validate(self):
		if flt(self.capacity_gallons) < 0:
			frappe.throw(_("The size can't be below zero."))
