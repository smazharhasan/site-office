import frappe
from frappe.model.document import Document
from frappe.utils import flt


class WaterTankReading(Document):
	def validate(self):
		cap = flt(frappe.db.get_value("Water Tank", self.tank, "capacity_gallons"))
		self.gallons = cap * flt(self.level_pct) / 100

	def on_trash(self):
		from buildiary import water

		water.cancel_entries(self.name)
