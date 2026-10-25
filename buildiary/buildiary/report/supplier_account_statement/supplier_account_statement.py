import frappe
from frappe import _

from mimaar.api import statement_rows


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = [
		{"label": _("Date"), "fieldname": "date", "fieldtype": "Date", "width": 100},
		{"label": _("Document type"), "fieldname": "voucher_type", "fieldtype": "Data", "width": 140},
		{"label": _("Document"), "fieldname": "voucher_no", "fieldtype": "Dynamic Link", "options": "voucher_type", "width": 170},
		{"label": _("Their no."), "fieldname": "ref", "fieldtype": "Data", "width": 110},
		{"label": _("Billed"), "fieldname": "billed", "fieldtype": "Currency", "width": 130},
		{"label": _("Paid"), "fieldname": "paid", "fieldtype": "Currency", "width": 130},
		{"label": _("Balance"), "fieldname": "balance", "fieldtype": "Currency", "width": 140},
	]
	if not filters.supplier:
		return columns, [], None, None, []
	d = statement_rows(filters.supplier, filters.from_date, filters.to_date, filters.company)
	rows = []
	if d["opening"]:
		rows.append({"voucher_type": _("Opening balance"), "balance": d["opening"]})
	rows += d["rows"]
	summary = [
		{"label": _("Ordered"), "value": d["ordered"], "datatype": "Currency"},
		{"label": _("Received at site"), "value": d["received"], "datatype": "Currency"},
		{"label": _("Billed"), "value": d["billed"], "datatype": "Currency"},
		{"label": _("Paid"), "value": d["paid"], "datatype": "Currency"},
		{"label": _("Due to supplier") if d["balance"] >= 0 else _("Advance with supplier"), "value": abs(d["balance"]), "datatype": "Currency", "indicator": "Red" if d["balance"] > 0 else "Green"},
	]
	return columns, rows, None, None, summary
