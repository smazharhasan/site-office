"""Days worked by each worker in a period, and the wages due at their daily rate."""

import frappe
from frappe import _
from frappe.utils import flt


def execute(filters=None):
	f = frappe._dict(filters or {})
	cond, args = ["a.docstatus = 1", "a.date between %(from_date)s and %(to_date)s"], dict(f)
	if f.get("project"):
		cond.append("a.project = %(project)s")
	if f.get("contractor"):
		cond.append("w.contractor = %(contractor)s")
	if f.get("worker"):
		cond.append("r.worker = %(worker)s")
	rows = frappe.db.sql(
		f"""select r.worker, w.full_name, w.trade, w.contractor, w.daily_wage,
			sum(r.status = 'Present') present, sum(r.status = 'Half day') half_day, sum(r.status = 'Absent') absent
		from `tabSite Attendance Row` r
		join `tabSite Attendance` a on a.name = r.parent
		join `tabSite Worker` w on w.name = r.worker
		where {' and '.join(cond)}
		group by r.worker order by w.contractor, w.full_name""",
		args,
		as_dict=True,
	)
	for r in rows:
		r.days = flt(r.present) + flt(r.half_day) / 2
		r.wages = r.days * flt(r.daily_wage)
	columns = [
		{"fieldname": "worker", "label": _("Worker"), "fieldtype": "Link", "options": "Site Worker", "width": 110},
		{"fieldname": "full_name", "label": _("Name"), "fieldtype": "Data", "width": 180},
		{"fieldname": "trade", "label": _("Trade"), "fieldtype": "Data", "width": 110},
		{"fieldname": "contractor", "label": _("Contractor / supplier"), "fieldtype": "Link", "options": "Supplier", "width": 170},
		{"fieldname": "present", "label": _("Present"), "fieldtype": "Int", "width": 80},
		{"fieldname": "half_day", "label": _("Half day"), "fieldtype": "Int", "width": 80},
		{"fieldname": "absent", "label": _("Absent"), "fieldtype": "Int", "width": 80},
		{"fieldname": "days", "label": _("Days worked"), "fieldtype": "Float", "precision": 1, "width": 100},
		{"fieldname": "daily_wage", "label": _("Daily wage"), "fieldtype": "Currency", "width": 110},
		{"fieldname": "wages", "label": _("Wages"), "fieldtype": "Currency", "width": 120},
	]
	return columns, rows
