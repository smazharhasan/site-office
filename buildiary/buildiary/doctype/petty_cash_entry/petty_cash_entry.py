import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, now_datetime


class PettyCashEntry(Document):
	def validate(self):
		if flt(self.amount) <= 0:
			frappe.throw(_("Enter the amount."))
		if self.entry_type == "Expense":
			if self.category and not self.expense_account:
				self.expense_account = frappe.db.get_value("Petty Cash Category", self.category, "expense_account")
		prev = self.get_doc_before_save()
		if prev and self.docstatus == 0 and prev.status in ("Approved", "Rejected") and not self.flags.buildiary_deciding:
			frappe.throw(_("This entry has been checked by the owner and can't be changed."))

	def before_submit(self):
		if self.status != "Approved":  # submitted from the ERP screens: the person submitting approves it
			self.status = "Approved"
			self.checked_by = frappe.session.user
			self.checked_at = now_datetime()

	def on_submit(self):
		from buildiary import petty

		self.db_set("journal_entry", petty.post(self))

	def on_cancel(self):
		from buildiary import petty

		petty.unpost(self)
