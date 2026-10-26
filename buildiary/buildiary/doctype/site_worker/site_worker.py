import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, today


def _country():
	co = frappe.db.get_single_value("Global Defaults", "default_company")
	return (frappe.db.get_value("Company", co, "country") if co else None) or frappe.db.get_single_value("System Settings", "country")


class SiteWorker(Document):
	def validate(self):
		self.full_name = (self.full_name or "").strip()
		if self.cnic:
			if _country() == "Pakistan":
				digits = re.sub(r"\D", "", self.cnic)
				if len(digits) != 13:
					frappe.throw(_("CNIC must have 13 digits, e.g. 42101-1234567-1."))
				self.cnic = f"{digits[:5]}-{digits[5:12]}-{digits[12]}"
			else:
				# any country's ID card, residence permit or passport number
				self.cnic = re.sub(r"\s+", " ", self.cnic).strip().upper()
				if len(re.sub(r"[^0-9A-Z]", "", self.cnic)) < 4:
					frappe.throw(_("Enter the full ID card number."))
			other = frappe.db.get_value("Site Worker", {"cnic": self.cnic, "name": ["!=", self.name]}, ["name", "full_name"], as_dict=True)
			if other:
				frappe.throw(_("This ID card is already registered for {0} ({1}).").format(other.full_name, other.name))
		if self.police_verification == "Verified" and not self.verified_by:
			self.verified_by, self.verified_on = frappe.session.user, today()
		elif self.police_verification != "Verified":
			self.verified_by = self.verified_on = None

	def warnings(self):
		out = []
		for label, d in ((_("CNIC") if _country() == "Pakistan" else _("ID card"), self.cnic_expiry), (_("Entry card"), self.entry_card_expiry)):
			if d and getdate(d) < getdate(today()):
				out.append(_("{0} expired on {1}").format(label, frappe.format(d, "Date")))
		if self.police_verification != "Verified" and _country() == "Pakistan":
			out.append(_("Police verification: {0}").format(_(self.police_verification or "Not done")))
		return out
