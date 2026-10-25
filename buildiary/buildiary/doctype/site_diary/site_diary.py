import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, today


class SiteDiary(Document):
	def validate(self):
		if getdate(self.date) > getdate(today()):
			frappe.throw(_("The diary date can't be in the future."))
		if self.workers is not None and self.workers < 0:
			frappe.throw(_("Workers can't be negative."))
