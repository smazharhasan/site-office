import frappe
from frappe import _
from frappe.model.document import Document

from buildiary.saas.common import to_usd


class BuildiaryPayment(Document):
	def validate(self):
		self.amount_usd = to_usd(self.amount, self.currency)
		before = self.get_doc_before_save()
		if before and before.status == "Verified" and self.status != "Verified":
			frappe.throw(_("A checked payment can't be changed. Change the customer's 'Paid until' date instead."))
		if self.status == "Rejected" and not (self.reject_reason or "").strip():
			frappe.throw(_("Write why the payment is rejected; the customer sees it."))
		if self.status == "Verified" and (not before or before.status != "Verified"):
			if self.method == "Bank transfer" and not self.proof:
				frappe.throw(_("Attach the receipt of the bank transfer (bank slip, screenshot or statement) before confirming."))
			if not self.paid_on:
				frappe.throw(_("Enter the date the money was received."))
			if not self.plan:
				frappe.throw(_("Choose the plan the customer paid for."))

	def on_update(self):
		from buildiary.saas.billing import apply_payment, reject_payment

		before = self.get_doc_before_save()
		was = before.status if before else None
		if self.status == "Verified" and was != "Verified":
			apply_payment(self)
		elif self.status == "Rejected" and was != "Rejected":
			reject_payment(self)
