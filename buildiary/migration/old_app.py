"""Bring a project's set-up in from a project data file (first used for Villa 31; also the demo workspace).

What comes across: the material catalogue (131 items), the 34 budget lines (as expense
accounts with a project budget), the master schedule (15 milestones as project tasks with
their links), the suppliers, and the agreed payment plans of Syed Brothers and MESCOMM as
draft supplier quotations to review, confirm and lock.

What doesn't: the test records made while trying the first app (test contract, test supplier,
INS-001, test snags, RFQ-001/002 and PO-001).

The project data is not kept in this code (the code is public, the data is not). It is a
file kept outside the code. It is safe to run again: anything already there is left alone.
"""

import json
import os
import re

import frappe
from frappe.utils import flt, getdate

from buildiary.api import register_supplier

HERE = os.path.dirname(__file__)
SERVICES = {
	"Design fee": ("DESIGN-FEE", "bud-01"),
	"MEP design": ("MEP-DESIGN", "bud-02"),
	"Grey service charges": ("GREY-SERVICE", "bud-03"),
	"Finishing service charges": ("FINISH-SERVICE", "bud-04"),
	"Grey labour": ("GREY-LABOUR", "bud-05"),
}
KIND_GROUP = {"Grey materials": "Grey materials", "Finishing materials": "Finishing materials", "Tools and equipment": "Tools and equipment", "Site consumables": "Site consumables", "Safety (PPE)": "Safety (PPE)", "Canteen and food": "Canteen and food", "Services and labour": "Services and labour"}


LOG = []
NEEDED = ("project", "items", "budget", "milestones", "suppliers", "payment_plan", "units")


def log(*a):
	LOG.append(" ".join(str(x) for x in a))
	print("  ", *a)


@frappe.whitelist()
def import_file(file_url):
	"""Called from Buildiary Settings with the file exported from the old app."""
	frappe.only_for("System Manager")
	f = frappe.get_doc("File", {"file_url": file_url})
	try:
		data = json.loads(f.get_content())
	except Exception:
		frappe.throw(frappe._("This is not a Buildiary project data file."))
	if not isinstance(data, dict) or any(k not in data for k in NEEDED):
		frappe.throw(frappe._("This is not a Buildiary project data file."))
	frappe.enqueue(run_job, queue="long", timeout=1800, data=data, user=frappe.session.user, file_name=f.name, now=frappe.flags.in_test)
	return True


def run_job(data, user, file_name=None):
	try:
		run(data=data)
		msg = frappe._("The project data has been brought in.") + "<br><br>" + "<br>".join(frappe.utils.escape_html(x) for x in LOG[-40:])
		frappe.publish_realtime("msgprint", {"message": msg, "title": frappe._("Data brought across"), "indicator": "green"}, user=user)
	except Exception:
		frappe.db.rollback()
		frappe.log_error("Buildiary: bringing data across")
		frappe.publish_realtime("msgprint", {"message": frappe._("Bringing the data across stopped with an error. Nothing half-done was kept; see Error Log."), "title": frappe._("Data not brought across"), "indicator": "red"}, user=user)


def run(company=None, data=None):
	frappe.flags.buildiary_migration = True
	LOG.clear()
	try:
		if data is None:
			data = json.load(open(frappe.conf.get("buildiary_old_app_file") or os.path.join(HERE, "villa31.json"), encoding="utf-8"))
		company = company or frappe.db.get_single_value("Global Defaults", "default_company") or frappe.get_all("Company", pluck="name")[0]
		abbr = frappe.db.get_value("Company", company, "abbr")
		fiscal_years(data["project"]["start"], data["project"]["end"], company)
		uoms(data["units"])
		groups = item_groups(data["items"])
		accts = accounts(company, abbr, data["budget"], data["project"]["name"])
		wh = frappe.db.get_value("Warehouse", {"company": company, "is_group": 0, "warehouse_name": "Stores"}) or frappe.db.get_value("Warehouse", {"company": company, "is_group": 0})
		cc = frappe.db.get_value("Company", company, "cost_center")
		codes = items(data, company, groups, accts, wh, cc)
		project = make_project(company, data, cc)
		tasks(project, data["milestones"])
		budgets(company, project, data["budget"], accts)
		sups = suppliers(data["suppliers"], codes)
		plans(company, project, wh, data["payment_plan"], sups)
		s = frappe.get_single("Buildiary Settings")
		s.default_project = project
		s.site_warehouse = wh
		s.flags.ignore_permissions = True
		s.save()
		frappe.db.commit()
		log("Done:", data["project"].get("name") or project)
	finally:
		frappe.flags.buildiary_migration = False


def fiscal_years(start, end, company):
	s, e = getdate(start), getdate(end)
	y = s.year - 1 if s.month < 7 else s.year
	while True:
		fy_start = getdate(f"{y}-07-01")
		if fy_start > e:
			break
		name = f"{y}-{y + 1}"
		if not frappe.db.exists("Fiscal Year", name) and not frappe.db.sql("select name from `tabFiscal Year` where %s between year_start_date and year_end_date", fy_start):
			frappe.get_doc({"doctype": "Fiscal Year", "year": name, "year_start_date": fy_start, "year_end_date": getdate(f"{y + 1}-06-30"), "companies": [{"company": company}]}).insert(ignore_permissions=True)
			log("fiscal year", name)
		y += 1


def uoms(units):
	for u in set(units.values()):
		if not frappe.db.exists("UOM", u):
			frappe.get_doc({"doctype": "UOM", "uom_name": u, "must_be_whole_number": 0}).insert(ignore_permissions=True)
	for u in ("Bag", "Nos", "Set", "Pair", "Box", "Coil", "Roll"):
		frappe.db.set_value("UOM", u, "must_be_whole_number", 1 if u in ("Nos", "Bag", "Set", "Pair", "Box", "Coil", "Roll") else 0)


def item_groups(items):
	root = frappe.db.get_value("Item Group", {"is_group": 1, "parent_item_group": ["in", ["", None]]}) or "All Item Groups"
	out = {}
	for kind in sorted({i["kind"] for i in items} | {"Services and labour"}):
		if not frappe.db.exists("Item Group", kind):
			frappe.get_doc({"doctype": "Item Group", "item_group_name": kind, "parent_item_group": root, "is_group": 1}).insert(ignore_permissions=True)
		else:
			frappe.db.set_value("Item Group", kind, "is_group", 1)
	for i in items:
		cat = i["category"]
		name = cat if not frappe.db.exists("Item Group", cat) or frappe.db.get_value("Item Group", cat, "parent_item_group") == i["kind"] else f"{cat} ({i['kind']})"
		if not frappe.db.exists("Item Group", name):
			frappe.get_doc({"doctype": "Item Group", "item_group_name": name, "parent_item_group": i["kind"], "is_group": 0}).insert(ignore_permissions=True)
		out[(i["kind"], cat)] = name
	return out


def accounts(company, abbr, budget, project_name="Villa 31"):
	parent = frappe.db.get_value("Account", {"company": company, "account_name": "Direct Expenses", "is_group": 1})
	group = f"{project_name} Construction - {abbr}"
	if not frappe.db.exists("Account", group):
		frappe.get_doc({"doctype": "Account", "account_name": f"{project_name} Construction", "parent_account": parent, "company": company, "is_group": 1, "root_type": "Expense", "report_type": "Profit and Loss"}).insert(ignore_permissions=True)
	out = {}
	for b in budget:
		name = f"{b['name']} - {abbr}"
		if not frappe.db.exists("Account", name):
			frappe.get_doc({"doctype": "Account", "account_name": b["name"], "parent_account": group, "company": company, "is_group": 0, "account_type": "Expense Account", "root_type": "Expense", "report_type": "Profit and Loss"}).insert(ignore_permissions=True)
		out[b["id"]] = name
	log("accounts", len(out))
	return out


def code_for(i):
	if i["code"]:
		return i["code"]
	c = re.sub(r"[^A-Za-z0-9]+", "-", i["name"].replace("½", "HALF").replace("¾", "3Q").replace('"', "IN")).strip("-").upper()
	return c[:60]


def items(data, company, groups, accts, wh, cc):
	codes = {}
	n = 0
	for i in data["items"]:
		code = code_for(i)
		codes[i["code"] or i["name"]] = code
		if frappe.db.exists("Item", code):
			continue
		bud = data["category_budget"].get(i["category"])
		doc = frappe.get_doc({
			"doctype": "Item", "item_code": code, "item_name": i["name"], "item_group": groups[(i["kind"], i["category"])],
			"stock_uom": data["units"].get(i["unit"], "Nos"), "is_stock_item": 0 if i["kind"] == "Services and labour" else 1,
			"description": i["spec"] or i["name"], "include_item_in_manufacturing": 0, "valuation_rate": flt(i.get("rate")),
			"item_defaults": [{"company": company, "default_warehouse": wh, "buying_cost_center": cc, "expense_account": accts.get(bud) if bud else None}],
		})
		doc.insert(ignore_permissions=True)
		n += 1
	for label, (code, bud) in SERVICES.items():
		if not frappe.db.exists("Item", code):
			frappe.get_doc({"doctype": "Item", "item_code": code, "item_name": label, "item_group": "Services and labour", "stock_uom": "Nos", "is_stock_item": 0, "include_item_in_manufacturing": 0,
				"item_defaults": [{"company": company, "buying_cost_center": cc, "expense_account": accts[bud]}]}).insert(ignore_permissions=True)
			n += 1
	log("items", n)
	return codes


def make_project(company, data, cc):
	p = data["project"]
	name = frappe.db.get_value("Project", {"project_name": p["name"]})
	if name:
		return name
	doc = frappe.get_doc({"doctype": "Project", "project_name": p["name"], "company": company, "expected_start_date": p["start"], "expected_end_date": p["end"], "status": "Open",
		"percent_complete_method": "Task Weight", "estimated_costing": sum(flt(b["amount"]) for b in data["budget"]), "cost_center": cc, "notes": p["address"]})
	doc.insert(ignore_permissions=True)
	log("project", doc.name)
	return doc.name


def tasks(project, milestones):
	names = {}
	weight = {"Design": 2, "Approval": 1, "Grey": 6, "Finishing": 9, "Handover": 3}
	for m in milestones:
		subj = f"{m['code']} {m['name']}"
		ex = frappe.db.get_value("Task", {"project": project, "subject": subj})
		if ex:
			names[m["code"]] = ex
			continue
		t = frappe.get_doc({"doctype": "Task", "subject": subj, "project": project, "exp_start_date": m["start"], "exp_end_date": m["end"], "status": "Open", "task_weight": weight.get(m["phase"], 1),
			"description": f"{m['phase']} · {m['ur']}"})
		t.insert(ignore_permissions=True)
		names[m["code"]] = t.name
	for m in milestones:
		t = frappe.get_doc("Task", names[m["code"]])
		have = {d.task for d in t.depends_on}
		for a in m["after"]:
			if names.get(a) and names[a] not in have:
				t.append("depends_on", {"task": names[a]})
		if len(t.depends_on) != len(have):
			t.flags.ignore_permissions = True
			t.save()
	log("tasks", len(names))


def budgets(company, project, budget, accts):
	fys = frappe.db.sql("select name from `tabFiscal Year` where year_end_date >= %s order by year_start_date", frappe.db.get_value("Project", project, "expected_start_date"), pluck=True)
	end = frappe.db.get_value("Project", project, "expected_end_date")
	fys_to = frappe.db.sql("select name from `tabFiscal Year` where %s between year_start_date and year_end_date", end, pluck=True)
	if not fys or not fys_to:
		log("budgets skipped: no fiscal year for the project dates")
		return
	n = 0
	for b in budget:
		acc = accts[b["id"]]
		if frappe.db.exists("Budget", {"project": project, "account": acc, "docstatus": ["<", 2]}):
			continue
		doc = frappe.get_doc({"doctype": "Budget", "budget_against": "Project", "project": project, "company": company, "account": acc, "budget_amount": b["amount"],
			"from_fiscal_year": fys[0], "to_fiscal_year": fys_to[0], "distribute_equally": 1, "distribution_frequency": "Monthly",
			"applicable_on_purchase_order": 1, "action_if_annual_budget_exceeded_on_po": "Warn", "action_if_accumulated_monthly_budget_exceeded_on_po": "Ignore",
			"applicable_on_booking_actual_expenses": 1, "action_if_annual_budget_exceeded": "Warn", "action_if_accumulated_monthly_budget_exceeded": "Ignore"})
		doc.insert(ignore_permissions=True)
		doc.submit()
		n += 1
	log("budgets", n)


def suppliers(sups, codes):
	out = {}
	for s in sups:
		name = register_supplier(s["name"], phone=s.get("phone"), contact=s.get("contact"), work_area=s.get("work"))
		out[s["name"]] = name
		for code in s.get("items", []):
			it = codes.get(code, code)
			if frappe.db.exists("Item", it) and not frappe.db.exists("Item Supplier", {"parent": it, "supplier": name}):
				doc = frappe.get_doc("Item", it)
				doc.append("supplier_items", {"supplier": name})
				doc.flags.ignore_permissions = True
				doc.save()
	log("suppliers", len(out))
	return out


def plans(company, project, wh, plan, sups):
	groups = {}
	for p in plan:
		groups.setdefault((p["supplier"], p["service"]), []).append(p)
	n = 0
	for (sup, service), rows in groups.items():
		supplier = sups.get(sup)
		code = SERVICES[service][0]
		if not supplier or frappe.db.exists("Supplier Quotation Item", {"item_code": code, "docstatus": ["<", 2], "parent": ["in", frappe.get_all("Supplier Quotation", filters={"supplier": supplier}, pluck="name") or [""]]}):
			continue
		total = sum(flt(r["amount"]) for r in rows)
		terms = "\n".join(f"{i}. {r['stage']}: Rs {flt(r['amount']):,.0f}, due about {getdate(r['due']).strftime('%d %b %Y')}" for i, r in enumerate(rows, 1))
		advance = 100 if "advance at signing" in rows[0]["stage"].lower() and len(rows) == 1 else 0
		sq = frappe.get_doc({"doctype": "Supplier Quotation", "supplier": supplier, "company": company, "transaction_date": frappe.utils.nowdate(), "project": project,
			"quotation_number": f"Agreed plan: {service}", "buildiary_payment_terms": terms, "buildiary_advance_percent": advance, "buildiary_delivery_time": "As per the master schedule",
			"terms": f"Payment plan brought in from the project data file. Review it, submit to confirm, then lock it as final to raise the purchase order.\n\n{terms}",
			"items": [{"item_code": code, "qty": 1, "rate": total, "uom": "Nos", "warehouse": wh, "project": project}]})
		sq.insert(ignore_permissions=True)
		n += 1
	log("draft quotations", n)
