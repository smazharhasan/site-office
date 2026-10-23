import frappe
from frappe import _
from frappe.model.document import Document


class PettyCashCategory(Document):
	def validate(self):
		a = frappe.db.get_value("Account", self.expense_account, ["is_group", "root_type"], as_dict=True)
		if not a or a.is_group or a.root_type != "Expense":
			frappe.throw(_("Choose an expense account (a budget line), not a group."))
