"""Petty cash on site.

Cash holders are people on site (supervisors, the store keeper). The owner or the accountant
gives them cash (Cash given); they spend it on small daily costs (Expense, with the bill photo,
or paid to a worker identified by site card and face) and hand back what is left (Cash returned).
Every expense waits for the owner's check; when approved it is booked in ERPNext:

    Cash given      Dr Petty Cash          Cr Cash / Bank
    Expense         Dr <budget line>       Cr Petty Cash     (with the project)
    Cash returned   Dr Cash / Bank         Cr Petty Cash

Each expense category is an expense account; the owner budgets it in the ERP (Accounting >
Budget) first, and the phone shows what is left before money is spent.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt, get_first_day, getdate, now_datetime, nowdate

from mimaar.field import _company, _parse, _photo_ok, _project, _roles, _settings, caps

TYPES = ("Expense", "Cash given", "Cash returned")
METHODS = ("Cash in hand", "Bank transfer", "Cheque", "JazzCash / Easypaisa", "Raast")


# ---------------------------------------------------------------- who may do what
def approver():
	"""The owner and the project accountant see every holder's cash and check the expenses."""
	r = _roles()
	return "System Manager" in r or "Accounts Manager" in r


def _can():
	c = caps()
	if c.get("partner") or not (approver() or c["money"] or c["site"] or c["store"]):
		frappe.throw(_("You don't have access to petty cash. Ask the owner."), frappe.PermissionError)
	return c


def _me():
	from mimaar.identity import my_person

	return my_person()


def holders():
	"""People who may hold the site's cash: staff who sign in (supervisor, store keeper, accountant, owner)."""
	rows = frappe.get_all("Site Worker", filters={"status": "Active"}, or_filters=[["app_access", "!=", "No sign-in"], ["store_keeper", "=", 1],
		["worker_type", "in", ["Supervisor", "Engineer", "Store keeper", "Accountant", "Owner"]]],
		fields=["name", "full_name", "full_name_ur", "photo", "worker_type", "trade"], order_by="full_name asc", limit_page_length=200)
	return rows


# ---------------------------------------------------------------- money
def _cash_account():
	acc = _settings().petty_cash_account
	if not acc:
		from mimaar.setup import petty_setup

		petty_setup()
		frappe.clear_document_cache("Mimaar Settings", "Mimaar Settings")
		acc = frappe.db.get_single_value("Mimaar Settings", "petty_cash_account")
	if not acc:
		frappe.throw(_("The petty cash account isn't set up. Open Mimaar Settings and choose it."))
	return acc


def _source_account(method):
	co = _company()
	if (method or "Cash in hand") == "Cash in hand":
		return frappe.db.get_value("Company", co, "default_cash_account") or frappe.db.get_value("Account", {"company": co, "account_type": "Cash", "is_group": 0, "name": ["!=", _cash_account()]})
	return frappe.db.get_value("Company", co, "default_bank_account") or frappe.db.get_value("Account", {"company": co, "account_type": "Bank", "is_group": 0})


def budget_of(account):
	"""The budget line behind an expense account: budget, booked so far, waiting for the owner, left."""
	if not account:
		return None
	b = flt(frappe.db.sql("select sum(budget_amount) from `tabBudget` where docstatus = 1 and account = %s", account)[0][0])
	used = flt(frappe.db.sql("select sum(debit - credit) from `tabGL Entry` where is_cancelled = 0 and account = %s", account)[0][0])
	waiting = flt(frappe.db.sql("""select sum(p.amount) from `tabPetty Cash Entry` p join `tabPetty Cash Category` c on c.name = p.category
		where p.docstatus = 0 and p.status = 'Waiting for owner' and p.entry_type = 'Expense' and c.expense_account = %s""", account)[0][0])
	return {"account": account, "has_budget": b > 0, "budget": b, "used": used, "waiting": waiting, "left": b - used - waiting}


def balances(holder=None):
	"""Cash with each holder: given − spent (approved or waiting) − returned."""
	cond, args = "", {}
	if holder:
		cond, args = " and holder = %(h)s", {"h": holder}
	rows = frappe.db.sql(f"""select holder, holder_name,
			sum(case when entry_type = 'Cash given' and docstatus = 1 then amount else 0 end) given,
			sum(case when entry_type = 'Expense' and docstatus = 1 then amount else 0 end) spent,
			sum(case when entry_type = 'Expense' and docstatus = 0 and status = 'Waiting for owner' then amount else 0 end) waiting,
			sum(case when entry_type = 'Cash returned' and docstatus < 2 and status != 'Rejected' then amount else 0 end) returned
		from `tabPetty Cash Entry` where docstatus < 2 {cond} group by holder, holder_name order by holder_name""", args, as_dict=True)
	for r in rows:
		r.in_hand = flt(r.given) - flt(r.spent) - flt(r.waiting) - flt(r.returned)
	return rows


def _in_hand(holder, skip=None):
	q = frappe.db.sql("""select
			sum(case when entry_type = 'Cash given' and docstatus = 1 then amount else 0 end)
			- sum(case when entry_type = 'Expense' and (docstatus = 1 or (docstatus = 0 and status = 'Waiting for owner')) then amount else 0 end)
			- sum(case when entry_type = 'Cash returned' and docstatus < 2 and status != 'Rejected' then amount else 0 end)
		from `tabPetty Cash Entry` where holder = %s and docstatus < 2 and name != %s""", (holder, skip or ""))
	return flt(q[0][0])


def post(doc):
	"""The journal entry for an approved petty cash entry (called on submit)."""
	cash = _cash_account()
	co = _company()
	cc = frappe.db.get_value("Company", co, "cost_center")
	amt = flt(doc.amount)
	if doc.entry_type == "Expense":
		acc = doc.expense_account or frappe.db.get_value("Petty Cash Category", doc.category, "expense_account")
		if not acc:
			frappe.throw(_("Choose what the money was spent on."))
		lines = [{"account": acc, "debit_in_account_currency": amt, "cost_center": cc, "project": doc.project or _project()},
			{"account": cash, "credit_in_account_currency": amt, "cost_center": cc}]
		remark = _("Petty cash: {0} paid to {1} by {2}").format(doc.category, doc.paid_to or "", doc.holder_name)
	elif doc.entry_type == "Cash given":
		lines = [{"account": cash, "debit_in_account_currency": amt, "cost_center": cc}, {"account": _source_account(doc.method), "credit_in_account_currency": amt, "cost_center": cc}]
		remark = _("Petty cash given to {0} ({1})").format(doc.holder_name, doc.method or "")
	else:
		lines = [{"account": _source_account(doc.method), "debit_in_account_currency": amt, "cost_center": cc}, {"account": cash, "credit_in_account_currency": amt, "cost_center": cc}]
		remark = _("Petty cash returned by {0} ({1})").format(doc.holder_name, doc.method or "")
	je = frappe.get_doc({"doctype": "Journal Entry", "voucher_type": "Cash Entry", "company": co,
		"posting_date": doc.date, "user_remark": f"{remark} [{doc.name}]", "cheque_no": doc.reference or doc.bill_no or None,
		"cheque_date": doc.date if (doc.reference or doc.bill_no) else None, "accounts": lines})
	je.flags.ignore_permissions = True
	je.insert()
	je.submit()
	return je.name


def unpost(doc):
	if doc.journal_entry and frappe.db.get_value("Journal Entry", doc.journal_entry, "docstatus") == 1:
		je = frappe.get_doc("Journal Entry", doc.journal_entry)
		je.flags.ignore_permissions = True
		je.cancel()


# ---------------------------------------------------------------- the petty cash screen
@frappe.whitelist()
def overview():
	c = _can()
	full = approver()
	me = _me()
	if not full and not me:
		return {"full": False, "me": None, "holders": [], "entries": [], "categories": _categories(False), "no_person": True}
	filters = {} if full else {"holder": me}
	entries = frappe.get_all("Petty Cash Entry", filters=dict(filters, docstatus=["<", 2]),
		fields=["name", "entry_type", "date", "holder", "holder_name", "amount", "status", "category", "paid_to", "paid_to_person", "bill_no", "method", "reference", "witness",
			"bill_photo", "proof_1", "proof_2", "proof_3", "identity_check", "notes", "check_note", "checked_by", "docstatus", "water_tanker", "creation"],
		order_by="date desc, creation desc", limit_page_length=300)
	faces = {}
	ids = [e.identity_check for e in entries if e.identity_check]
	if ids:
		faces = dict(frappe.get_all("Identity Check", filters={"name": ["in", ids]}, fields=["name", "result"], as_list=True))
	for e in entries:
		e.face = faces.get(e.identity_check)
	month0 = get_first_day(getdate(nowdate()))
	spent_month = [e for e in entries if e.entry_type == "Expense" and e.status != "Rejected" and getdate(e.date) >= month0]
	by_cat = {}
	for e in spent_month:
		by_cat[e.category or "Other"] = by_cat.get(e.category or "Other", 0) + flt(e.amount)
	waiting = [e for e in entries if e.docstatus == 0 and e.status == "Waiting for owner"]
	bal = balances(None if full else me)
	return {
		"full": full, "me": me, "can_give": full, "holders": bal if full else bal, "holder_list": holders() if full else [],
		"in_hand": sum(flt(b.in_hand) for b in bal), "spent_month": sum(flt(e.amount) for e in spent_month), "bills_month": len(spent_month),
		"waiting": len(waiting), "waiting_amount": sum(flt(e.amount) for e in waiting), "by_category": sorted(by_cat.items(), key=lambda x: -x[1]),
		"entries": entries[:150], "categories": _categories(full),
		"rules": {"bill": cint(_settings().petty_bill_required), "budget": cint(_settings().petty_needs_budget), "card": cint(_settings().card_for_petty_cash)},
	}


def _categories(full):
	out = []
	for cat in frappe.get_all("Petty Cash Category", filters={"is_active": 1}, fields=["name", "expense_account", "for_wages"], order_by="sort_order asc, name asc"):
		b = budget_of(cat.expense_account) or {}
		row = {"name": cat.name, "for_wages": cat.for_wages, "has_budget": bool(b.get("has_budget")), "over": bool(b.get("has_budget")) and flt(b.get("left")) < 0}
		if full:
			row.update({"account": cat.expense_account, "budget": b.get("budget"), "used": b.get("used"), "waiting": b.get("waiting"), "left": b.get("left")})
		out.append(row)
	return out


@frappe.whitelist()
def entry(name):
	_can()
	doc = frappe.get_doc("Petty Cash Entry", name)
	if not approver() and doc.holder != _me():
		frappe.throw(_("This entry belongs to another cash holder."), frappe.PermissionError)
	d = doc.as_dict()
	if doc.identity_check:
		d.face = frappe.db.get_value("Identity Check", doc.identity_check, ["result", "score", "live_photo", "registered_photo", "person_name"], as_dict=True)
	if doc.category and approver():
		d.budget = budget_of(doc.expense_account or frappe.db.get_value("Petty Cash Category", doc.category, "expense_account"))
	return d


@frappe.whitelist()
def entry_save(data, check=None):
	"""Record an expense, cash given or cash returned. The owner's own entries are approved at once."""
	_can()
	from mimaar.identity import needs_card, use_check

	d = frappe._dict(_parse(data) or {})
	typ = d.entry_type or "Expense"
	if typ not in TYPES:
		frappe.throw(_("Choose the kind of entry."))
	full = approver()
	me = _me()
	if typ == "Cash given" and not full:
		frappe.throw(_("Only the owner or the accountant records cash given."), frappe.PermissionError)
	holder = d.holder if full and d.holder else me
	if not holder:
		frappe.throw(_("Your sign-in isn't linked to a person on site, so you can't hold petty cash. Ask the owner."))
	amt = flt(d.amount)
	if amt <= 0:
		frappe.throw(_("Enter the amount."))
	s = _settings()
	idc = frappe.get_doc("Identity Check", check) if check else None
	doc = frappe.new_doc("Petty Cash Entry")
	doc.update({"entry_type": typ, "date": nowdate(), "holder": holder, "amount": amt, "project": _project(), "notes": d.notes})
	if typ == "Expense":
		if not d.category or not frappe.db.exists("Petty Cash Category", d.category):
			frappe.throw(_("Choose what the money was spent on."))
		acc = frappe.db.get_value("Petty Cash Category", d.category, "expense_account")
		b = budget_of(acc)
		if cint(s.petty_needs_budget) and not (b and b["has_budget"]):
			frappe.throw(_("There is no budget for {0} yet. Every expense is budgeted first: the owner adds it in the ERP (Accounting > Budget) or on the phone.").format(_(d.category)),
				title=_("No budget"))
		if d.paid_to_person:
			if cint(s.card_for_petty_cash) and needs_card("card_for_petty_cash") and not idc:
				frappe.throw(_("Scan the site card of the person being paid and take their photo."), title=_("Site card"))
			if idc and idc.person != d.paid_to_person:
				frappe.throw(_("The face check is for someone else."))
			doc.paid_to_person = d.paid_to_person
			doc.paid_to = frappe.db.get_value("Site Worker", d.paid_to_person, "full_name")
		else:
			doc.paid_to = (d.paid_to or "").strip()
			if not doc.paid_to:
				frappe.throw(_("Enter who was paid (the shop or the person)."))
			if cint(s.petty_bill_required) and not _photo_ok(d.bill_photo):
				frappe.throw(_("Take a photo of the bill or receipt."), title=_("Bill needed"))
		doc.update({"category": d.category, "expense_account": acc, "bill_no": d.bill_no, "bill_photo": d.bill_photo if _photo_ok(d.bill_photo) else (idc.live_photo if idc else None)})
		have = _in_hand(holder)
		if amt > have + 0.5:
			frappe.throw(_("{0} has only Rs {1} of petty cash in hand. The owner gives more cash first.").format(frappe.db.get_value("Site Worker", holder, "full_name"),
				frappe.format(max(have, 0), {"fieldtype": "Float", "precision": 0})), title=_("Not enough cash"))
	else:
		if typ == "Cash given" and cint(s.card_for_petty_cash) and needs_card("card_for_petty_cash") and not idc:
			frappe.throw(_("Scan the site card of the person receiving the cash and take their photo."), title=_("Site card"))
		if idc and idc.person != holder:
			frappe.throw(_("The face check is for someone else."))
		proofs = [p for p in (d.proof_1, d.proof_2, d.proof_3) if _photo_ok(p)]
		if not proofs and not idc:
			frappe.throw(_("Add at least one proof of the handover (signed receipt, photo, transfer screenshot or cheque)."), title=_("Proof needed"))
		doc.update({"method": d.method if d.method in METHODS else "Cash in hand", "reference": d.reference, "witness": d.witness,
			"proof_1": d.proof_1 if _photo_ok(d.proof_1) else (idc.live_photo if idc else None), "proof_2": d.proof_2 if _photo_ok(d.proof_2) else None,
			"proof_3": d.proof_3 if _photo_ok(d.proof_3) else None})
		if typ == "Cash returned" and amt > _in_hand(holder) + 0.5:
			frappe.throw(_("{0} has only Rs {1} of petty cash in hand.").format(frappe.db.get_value("Site Worker", holder, "full_name"),
				frappe.format(max(_in_hand(holder), 0), {"fieldtype": "Float", "precision": 0})))
	doc.identity_check = idc.name if idc else None
	doc.status = "Waiting for owner"
	doc.insert(ignore_permissions=True)
	if idc:
		use_check(idc.name, "Petty cash", "Petty Cash Entry", doc.name, idc.person)
	if full:
		_approve(doc, _("Recorded by the owner"))
	return {"name": doc.name, "status": doc.status}


def _approve(doc, note=None):
	doc.status = "Approved"
	doc.checked_by = frappe.session.user
	doc.checked_at = now_datetime()
	doc.check_note = note
	doc.flags.ignore_permissions = True
	doc.submit()


@frappe.whitelist()
def decide(name, status, note=None):
	"""The owner's check of an entry: Approved (booked in the accounts) or Rejected."""
	if not approver():
		frappe.throw(_("Only the owner or the accountant checks petty cash."), frappe.PermissionError)
	doc = frappe.get_doc("Petty Cash Entry", name)
	if doc.docstatus != 0 or doc.status != "Waiting for owner":
		frappe.throw(_("This entry has already been checked."))
	if status == "Approved":
		_approve(doc, note)
	elif status == "Rejected":
		if not (note or "").strip():
			frappe.throw(_("Write why it is rejected."))
		doc.status = "Rejected"
		doc.checked_by = frappe.session.user
		doc.checked_at = now_datetime()
		doc.check_note = note
		doc.flags.ignore_permissions = True
		doc.flags.mimaar_deciding = True
		doc.save()
	else:
		frappe.throw(_("Approve or reject."))
	return {"name": doc.name, "status": doc.status}


@frappe.whitelist()
def budget_add(category, amount):
	"""The owner budgets a petty cash line from the phone (an ERPNext Budget for its account)."""
	if not caps()["owner"]:
		frappe.throw(_("Only the owner sets budgets."), frappe.PermissionError)
	acc = frappe.db.get_value("Petty Cash Category", category, "expense_account")
	if not acc:
		frappe.throw(_("Choose what the money is spent on."))
	amt = flt(amount)
	if amt <= 0:
		frappe.throw(_("Enter the budget amount."))
	co = _company()
	from erpnext.accounts.utils import get_fiscal_year

	fy = get_fiscal_year(nowdate(), company=co)[0]
	ex = frappe.db.get_value("Budget", {"account": acc, "docstatus": 1, "company": co}, "name")
	if ex:
		b = frappe.get_doc("Budget", ex)
		new = frappe.copy_doc(b)
		new.budget_amount = flt(b.budget_amount) + amt
		new.amended_from = None
		b.flags.ignore_permissions = True
		b.cancel()
		new.flags.ignore_permissions = True
		new.insert()
		new.submit()
		return new.name
	b = frappe.get_doc({"doctype": "Budget", "company": co, "budget_against": "Project", "project": _project(), "account": acc, "budget_amount": amt,
		"from_fiscal_year": fy, "to_fiscal_year": fy, "applicable_on_booking_actual_expenses": 1, "action_if_annual_budget_exceeded": "Warn",
		"action_if_accumulated_monthly_budget_exceeded": "Ignore"})
	b.flags.ignore_permissions = True
	b.insert()
	b.submit()
	return b.name


def holder_for(holder=None):
	"""Whose petty cash pays: the owner or accountant may choose; everyone else pays from their own."""
	return holder if (approver() and holder) else _me()


def water_expense(tanker, holder=None):
	"""A water tanker paid in cash on site: a petty cash expense on the "Water tanker" line, waiting for the owner."""
	holder = holder_for(holder)
	if not holder:
		return None
	cat = frappe.db.get_value("Petty Cash Category", {"category_name": "Water tanker"}, "name") or frappe.db.get_value("Petty Cash Category", {"is_active": 1}, "name")
	if not cat:
		return None
	doc = frappe.get_doc({"doctype": "Petty Cash Entry", "entry_type": "Expense", "date": tanker.date, "holder": holder, "amount": flt(tanker.cost),
		"category": cat, "expense_account": frappe.db.get_value("Petty Cash Category", cat, "expense_account"), "paid_to": tanker.supplier_text or tanker.vehicle_no,
		"bill_no": tanker.bill_no, "bill_photo": tanker.bill_scan or tanker.tanker_photo, "notes": _("Water tanker {0}, {1} gallons").format(tanker.vehicle_no, flt(tanker.gallons)),
		"project": tanker.project, "water_tanker": tanker.name, "status": "Waiting for owner"})
	doc.insert(ignore_permissions=True)
	if approver():
		_approve(doc, _("Recorded by the owner"))
	return doc.name
