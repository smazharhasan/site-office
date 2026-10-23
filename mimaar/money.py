"""Money > Budget for the owner and the project accountant: every budget line against what is
contracted (purchase orders) and paid, the full project cost by phase, and the projected cash
flow month by month. Budget lines are ERPNext Budgets on expense accounts; their category
(Account > Budget category) groups them by phase."""

import frappe
from frappe import _
from frappe.utils import add_months, cint, flt, get_first_day, getdate, nowdate

from mimaar.field import _company, _project, caps

PHASE_ORDER = ["Design & approvals", "Grey structure", "Finishing", "Contingency", "Site running costs", "Other"]
TASK_PHASES = {"Design & approvals": ("Design", "Approvals"), "Grey structure": ("Grey structure",), "Finishing": ("Finishing", "Handover")}


def _need_money():
	from mimaar import petty

	if not (petty.approver() or caps()["money"]):
		frappe.throw(_("Only the owner and the project accountant see the budget."), frappe.PermissionError)


def phase_of(cat, name):
	n = (name or "").lower()
	if cat == "Design & approvals":
		return "Design & approvals"
	if cat in ("Grey labour", "Grey materials"):
		return "Grey structure"
	if cat in ("Finishing labour", "Finishing materials"):
		return "Finishing"
	if cat == "Service charges":
		return "Finishing" if "finish" in n else "Grey structure"
	if cat in ("Contingency", "Site running costs"):
		return cat
	return "Other"


def _lines():
	co = _company()
	rows = frappe.db.sql("""select b.account, a.account_name name, coalesce(nullif(a.mimaar_budget_category, ''), 'Other') cat, sum(b.budget_amount) budget
		from `tabBudget` b join `tabAccount` a on a.name = b.account where b.docstatus = 1 and b.company = %s group by b.account order by a.account_name""", co, as_dict=True)
	committed = dict(frappe.db.sql("""select i.expense_account, sum(i.base_net_amount) from `tabPurchase Order Item` i join `tabPurchase Order` p on p.name = i.parent
		where p.docstatus = 1 and p.status != 'Closed' and p.company = %s group by i.expense_account""", co))
	booked = dict(frappe.db.sql("select account, sum(debit - credit) from `tabGL Entry` where is_cancelled = 0 and company = %s group by account", co))
	# paid against each line: supplier payments allocated to the line's orders and bills (pro rata), plus direct postings (petty cash, journals)
	paid_po = dict(frappe.db.sql("""select poi.expense_account, sum(r.allocated_amount * poi.base_net_amount / nullif(po.base_net_total, 0))
		from `tabPayment Entry Reference` r join `tabPayment Entry` pe on pe.name = r.parent join `tabPurchase Order` po on po.name = r.reference_name
		join `tabPurchase Order Item` poi on poi.parent = po.name
		where pe.docstatus = 1 and r.reference_doctype = 'Purchase Order' and pe.company = %s group by poi.expense_account""", co))
	paid_pi = dict(frappe.db.sql("""select pii.expense_account, sum(r.allocated_amount * pii.base_net_amount / nullif(pi.base_net_total, 0))
		from `tabPayment Entry Reference` r join `tabPayment Entry` pe on pe.name = r.parent join `tabPurchase Invoice` pi on pi.name = r.reference_name
		join `tabPurchase Invoice Item` pii on pii.parent = pi.name
		where pe.docstatus = 1 and r.reference_doctype = 'Purchase Invoice' and pe.company = %s group by pii.expense_account""", co))
	direct = dict(frappe.db.sql("""select account, sum(debit - credit) from `tabGL Entry` where is_cancelled = 0 and company = %s and voucher_type = 'Journal Entry' group by account""", co))
	out = []
	for r in rows:
		c = flt(committed.get(r.account))
		paid = flt(paid_po.get(r.account)) + flt(paid_pi.get(r.account)) + flt(direct.get(r.account))
		used = max(c, flt(booked.get(r.account)))
		out.append({"account": r.account, "name": r.name, "category": r.cat, "phase": phase_of(r.cat, r.name), "budget": flt(r.budget), "committed": c,
			"paid": paid, "booked": flt(booked.get(r.account)), "left": flt(r.budget) - used, "over": used > flt(r.budget) + 0.5})
	return out


def _windows():
	"""When each phase's money is needed: from the schedule's stages of that phase."""
	project = _project()
	p = frappe.db.get_value("Project", project, ["expected_start_date", "expected_end_date"], as_dict=True) if project else None
	start, end = (p and p.expected_start_date) or nowdate(), (p and p.expected_end_date) or add_months(nowdate(), 18)
	out = {"Contingency": (start, end), "Site running costs": (start, end), "Other": (start, end)}
	for phase, task_phases in TASK_PHASES.items():
		r = frappe.db.sql("""select min(exp_start_date), max(exp_end_date) from `tabTask` where project = %s and mimaar_phase in %s""", (project, task_phases))
		out[phase] = (r[0][0] or start, r[0][1] or end) if r else (start, end)
	return out


def _month(d):
	return str(get_first_day(getdate(d)))[:7]


def cash_flow(lines):
	"""Projected payments per month: what is still to pay on the orders (on their payment dates),
	and the budget not yet ordered, spread over the months its phase runs."""
	co = _company()
	this = _month(nowdate())
	sched, proj = {}, {}
	for po in frappe.get_all("Purchase Order", filters={"docstatus": 1, "status": ["not in", ["Closed", "Completed"]], "company": co}, fields=["name", "base_grand_total", "advance_paid", "per_billed"]):
		paid = flt(po.advance_paid) + flt(frappe.db.sql("""select sum(pi.base_grand_total - pi.outstanding_amount) from `tabPurchase Invoice` pi
			where pi.docstatus = 1 and exists (select 1 from `tabPurchase Invoice Item` x where x.parent = pi.name and x.purchase_order = %s)""", po.name)[0][0])
		left = max(0.0, flt(po.base_grand_total) - paid)
		if left <= 0:
			continue
		rows = frappe.get_all("Payment Schedule", filters={"parenttype": "Purchase Order", "parent": po.name}, fields=["due_date", "payment_amount"])
		total = sum(flt(r.payment_amount) for r in rows) or 1
		for r in rows or [frappe._dict(due_date=nowdate(), payment_amount=1)]:
			m = max(this, _month(r.due_date or nowdate()))
			sched[m] = sched.get(m, 0) + left * flt(r.payment_amount) / (total if rows else 1)
	win = _windows()
	for ln in lines:
		rest = max(0.0, ln["budget"] - max(ln["committed"], ln["booked"]))
		if rest <= 0:
			continue
		s, e = win.get(ln["phase"], win["Other"])
		s, e = max(this, _month(s)), max(this, _month(e))
		months = []
		d = getdate(s + "-01")
		while _month(d) <= e and len(months) < 60:
			months.append(_month(d))
			d = add_months(d, 1)
		for m in months:
			proj[m] = proj.get(m, 0) + rest / len(months)
	keys = sorted(set(sched) | set(proj))
	return {"months": keys, "scheduled": [round(sched.get(k, 0)) for k in keys], "projected": [round(proj.get(k, 0)) for k in keys]}


@frappe.whitelist()
def budget_overview():
	_need_money()
	lines = _lines()
	tot = lambda k: sum(x[k] for x in lines)  # noqa: E731
	phases = []
	for ph in PHASE_ORDER:
		ls = [x for x in lines if x["phase"] == ph]
		if ls:
			phases.append({"phase": ph, "budget": sum(x["budget"] for x in ls), "committed": sum(x["committed"] for x in ls), "paid": sum(x["paid"] for x in ls),
				"left": sum(x["left"] for x in ls), "over": sum(1 for x in ls if x["over"]), "lines": sorted(ls, key=lambda x: -x["budget"])})
	cf = cash_flow(lines)
	busiest = max(range(len(cf["months"])), key=lambda i: cf["scheduled"][i] + cf["projected"][i]) if cf["months"] else None
	quarters = {}
	for i, m in enumerate(cf["months"]):
		q = f"{m[:4]} Q{(int(m[5:7]) - 1) // 3 + 1}"
		quarters[q] = quarters.get(q, 0) + cf["scheduled"][i] + cf["projected"][i]
	heavy = max(quarters.items(), key=lambda x: x[1]) if quarters else None
	return {"budget": tot("budget"), "committed": tot("committed"), "paid": tot("paid"), "left": tot("budget") - tot("paid"), "still_owed": max(0, tot("committed") - tot("paid")),
		"over": sum(1 for x in lines if x["over"]), "within": sum(1 for x in lines if not x["over"]), "phases": phases, "cash": cf,
		"busiest": busiest is not None and {"month": cf["months"][busiest], "amount": cf["scheduled"][busiest] + cf["projected"][busiest]} or None,
		"heavy": heavy and {"quarter": heavy[0], "amount": heavy[1]}, "total_projected": sum(cf["scheduled"]) + sum(cf["projected"]),
		"categories": [x for x in frappe.get_meta("Account").get_field("mimaar_budget_category").options.split("\n") if x] if frappe.get_meta("Account").get_field("mimaar_budget_category") else [],
		"owner": caps()["owner"]}


@frappe.whitelist()
def budget_line(account):
	"""One budget line: its orders and payments."""
	_need_money()
	ln = next((x for x in _lines() if x["account"] == account), None)
	if not ln:
		frappe.throw(_("This budget line was not found."))
	orders = frappe.db.sql("""select p.name, p.supplier_name, p.transaction_date, p.status, sum(i.base_net_amount) amount, p.per_billed, p.per_received
		from `tabPurchase Order Item` i join `tabPurchase Order` p on p.name = i.parent where p.docstatus = 1 and i.expense_account = %s group by p.name order by p.transaction_date desc""", account, as_dict=True)
	payments = frappe.db.sql("""select g.voucher_type, g.voucher_no, g.posting_date, sum(g.debit - g.credit) amount, g.remarks from `tabGL Entry` g
		where g.is_cancelled = 0 and g.account = %s group by g.voucher_type, g.voucher_no order by g.posting_date desc limit 50""", account, as_dict=True)
	return {"line": ln, "orders": orders, "postings": payments}


@frappe.whitelist()
def budget_line_add(name, category, amount):
	"""A new budget line from the phone (owner): an expense account in the project's group, with its budget."""
	if not caps()["owner"]:
		frappe.throw(_("Only the owner adds budget lines."), frappe.PermissionError)
	name = (name or "").strip()
	amt = flt(amount)
	if not name or amt <= 0:
		frappe.throw(_("Enter the budget line's name and amount."))
	co = _company()
	abbr = frappe.db.get_value("Company", co, "abbr")
	acc = f"{name} - {abbr}"
	if frappe.db.exists("Account", acc):
		if frappe.db.exists("Budget", {"account": acc, "docstatus": 1}):
			frappe.throw(_("{0} already has a budget.").format(name))
	else:
		any_line = frappe.db.get_value("Budget", {"company": co, "docstatus": 1}, "account")
		parent = (frappe.db.get_value("Account", any_line, "parent_account") if any_line else None) or frappe.db.get_value("Account", {"company": co, "account_name": "Direct Expenses", "is_group": 1}, "name")
		acc = frappe.get_doc({"doctype": "Account", "account_name": name, "parent_account": parent, "company": co, "is_group": 0, "account_type": "Expense Account",
			"mimaar_budget_category": category or "Other"}).insert(ignore_permissions=True).name
	if category:
		frappe.db.set_value("Account", acc, "mimaar_budget_category", category)
	from erpnext.accounts.utils import get_fiscal_year

	fy = get_fiscal_year(nowdate(), company=co)[0]
	b = frappe.get_doc({"doctype": "Budget", "company": co, "budget_against": "Project", "project": _project(), "account": acc, "budget_amount": amt,
		"from_fiscal_year": fy, "to_fiscal_year": fy, "applicable_on_purchase_order": 1, "action_if_annual_budget_exceeded_on_po": "Warn",
		"applicable_on_booking_actual_expenses": 1, "action_if_annual_budget_exceeded": "Warn", "action_if_accumulated_monthly_budget_exceeded": "Ignore",
		"action_if_accumulated_monthly_budget_exceeded_on_po": "Ignore"})
	b.flags.ignore_permissions = True
	b.insert()
	b.submit()
	return acc


@frappe.whitelist()
def budget_line_category(account, category):
	if not caps()["owner"]:
		frappe.throw(_("Only the owner changes budget lines."), frappe.PermissionError)
	frappe.db.set_value("Account", account, "mimaar_budget_category", category)
	return category
