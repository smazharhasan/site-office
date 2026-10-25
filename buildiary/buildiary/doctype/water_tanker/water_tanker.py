import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class WaterTanker(Document):
	def validate(self):
		if flt(self.gallons) <= 0:
			frappe.throw(_("Enter the tanker size in gallons."))
		self.vehicle_no = (self.vehicle_no or "").strip().upper()

	def on_submit(self):
		from mimaar import water

		water.tanker_submitted(self)

	def on_cancel(self):
		from mimaar import water

		self.ignore_linked_doctypes = ("Petty Cash Entry", "Stock Entry", "Identity Check")
		water.tanker_cancelled(self)
