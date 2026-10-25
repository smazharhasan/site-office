"""The dashboard: today's figures as tiles, what needs attention (grouped), and panels for
payments, budget by category, labour on site, stage status and material released.
Money appears only for the owner and the project accountant (and people with money rights)."""

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, getdate, nowdate

from mimaar.field import _company, _only, _project, _psql, _store, caps, dashboard as old_dashboard


def _sql1(q, a=None):
	v = frappe.db.sql(q, a or {})
	return flt(v[0][0]) if v and v[0][0] is not None else 0.0


@frappe.whitelist()
def overview():
	c = caps()
	partner = c.get("partner")
	from mimaar import petty

	full_money = petty.approver() or c["money"]
	today = nowdate()
	base = old_dashboard()  # the existing figures and the to-do list
	k = base["kpi"]
	tiles = {}
	co = _company()
	pq = _psql()
	if full_money:
		tiles["paid"] = {"paid": k["paid"], "committed": k["committed"], "due_now": k["due_now"]}
		tiles["budget"] = {"budget": k["budget"], "committed": k["committed"]}
	if (c["store"] or c["site"]) and not partner:
		from mimaar import stores

		bins, received, released, returned, on_order, reorder = stores._figures(_store())
		low = [code for code, q in bins.items() if reorder.get(code) and q <= reorder[code]]
		out = [code for code in received if bins.get(code, 0) <= 0]
		tiles["stock"] = {"low": len(low), "out": len(out)}
		w = frappe.db.sql(f"""select count(*), sum(gallons) from `tabWater Tanker` where docstatus = 1 and date = %s and water_type != 'Brackish (rejected)'{pq}""", today)[0]
		wk = _sql1(f"""select sum(gallons) from `tabWater Tanker` where docstatus = 1 and date >= %s and water_type != 'Brackish (rejected)'{pq}""", add_days(today, -6))
		tiles["water"] = {"tankers": cint(w[0]), "gallons": flt(w[1]), "week": wk}
	if c["site"]:
		ncr = frappe.db.sql(f"""select count(distinct i.name) from `tabSite Inspection` i join `tabSite Inspection Action` a on a.parent = i.name
			left join `tabSite Snag` s on s.name = a.snag where i.docstatus = 1 and i.result = 'Fail' and (s.name is null or s.status != 'Closed'){_psql('i')}""")[0][0]
		tiles["ncr"] = {"open": cint(ncr), "waiting": frappe.db.count("Site Inspection", _only({"docstatus": 0}))}
		overdue = frappe.db.count("Site Snag", _only({"status": ["in", ["Open", "In progress"]], "target_date": ["<", today]}))
		tiles["snags"] = {"open": k["snags_open"], "overdue": overdue}
	if (c["people"] or c["site"]) and not partner:
		att = frappe.db.get_value("Site Attendance", _only({"date": today, "docstatus": ["<", 2]}), "name")
		now = left = 0
		if att:
			for r in frappe.get_all("Site Attendance Row", filters={"parent": att, "status": ["!=", "Absent"]}, fields=["time_in", "time_out"]):
				if r.time_out:
					left += 1
				else:
					now += 1
		tiles["onsite"] = {"now": now, "left": left, "registered": k["workers"]}
	if petty.approver():
		w = frappe.db.sql("""select count(*), sum(amount) from `tabPetty Cash Entry` where docstatus = 0 and status = 'Waiting for owner'""")[0]
		tiles["petty"] = {"waiting": cint(w[0]), "amount": flt(w[1])}
	photos = cint(frappe.db.sql("""select count(*) from `tabFile` where is_folder = 0 and date(creation) = %s and (file_name like '%%.jpg' or file_name like '%%.jpeg' or file_name like '%%.png' or file_name like '%%.webp')""", today)[0][0])
	ai = cint(frappe.db.sql("select count(*) from `tabIdentity Check` where date(checked_at) = %s and result != 'Not checked'", today)[0][0])
	ai += cint(frappe.db.sql(f"select count(*) from `tabWater Tanker` where date = %s and ai_verdict not in ('', 'Not checked'){pq}", today)[0][0])
	ai += cint(frappe.db.sql(f"select count(*) from `tabWater Tank Reading` where date = %s and ai_verdict not in ('', 'Not checked'){pq}", today)[0][0])
	tiles["photos"] = {"today": photos, "ai": ai}

	# what needs attention, grouped
	acts = []
	for a in base["acts"]:
		g = {"quote": "Buying", "order": "Buying", "receive": "Stores", "bill": "Money", "billnew": "Money", "snag": "Quality", "task": "Build", "worker": "People"}.get(a["go"][0], "Other")
		acts.append(dict(a, g=g))
	if (c["store"] or c["site"]) and not partner:
		from mimaar import water

		read = {r for r in frappe.get_all("Water Tank Reading", filters=_only({"date": today}), pluck="tank")}
		missing = [t.name for t in water._level_tanks() if t.name not in read]
		if missing:
			acts.append({"k": "warn", "t": _("Read today's water level: {0}").format(", ".join(_(m) for m in missing)), "go": ["water", ""], "g": "Water"})
		for t in frappe.get_all("Water Tanker", filters=_only({"docstatus": 1, "date": [">=", add_days(today, -2)], "ai_verdict": "Mismatch"}), fields=["name", "vehicle_no"]):
			acts.append({"k": "bad", "t": _("AI found a mismatch on water tanker {0}").format(t.vehicle_no), "go": ["water", t.name], "g": "Water"})
		for code in out[:5] if tiles.get("stock") else []:
			acts.append({"k": "warn", "t": _("Out of stock: {0}").format(frappe.db.get_value("Item", code, "item_name")), "go": ["item", code], "g": "Stores"})
	if petty.approver():
		for e in frappe.get_all("Petty Cash Entry", filters={"docstatus": 0, "status": "Waiting for owner"}, fields=["name", "holder_name", "amount", "category"], order_by="date asc", limit=10):
			acts.append({"k": "warn", "t": _("Check petty cash: Rs {0} by {1} ({2})").format(frappe.format(e.amount, {"fieldtype": "Float", "precision": 0}), e.holder_name, _(e.category or "")),
				"go": ["petty", e.name], "g": "Money"})
	if c["site"]:
		from mimaar import build

		for s in [s for s in build._stage_rows() if s["state"] == "behind"][:5]:
			acts.append({"k": "bad", "t": _("Behind plan: {0} ({1}% built, {2}% planned)").format(s["title"], round(s["built"]), round(s["planned"])), "go": ["stage", s["name"]], "g": "Build"})
	for r in frappe.get_all("Identity Check", filters={"result": "No match", "checked_at": [">=", add_days(today, -2)]}, fields=["name", "person_name", "action"], limit=5) if petty.approver() else []:
		acts.append({"k": "bad", "t": _("Face did not match: {0} ({1})").format(r.person_name, _(r.action)), "go": ["worker", ""], "g": "People"})

	panels = {}
	if full_money:
		panels["paid"] = frappe.db.sql(f"""select coalesce(nullif(s.supplier_group, ''), %(other)s) grp,
				sum(case when x.kind = 'paid' then x.amt else 0 end) paid, sum(case when x.kind = 'po' then x.amt else 0 end) committed
			from (select party sup, base_paid_amount amt, 'paid' kind from `tabPayment Entry` where docstatus = 1 and payment_type = 'Pay' and party_type = 'Supplier' and company = %(co)s{pq}
				union all select supplier, base_grand_total, 'po' from `tabPurchase Order` where docstatus = 1 and status != 'Closed' and company = %(co)s{pq}) x
			left join `tabSupplier` s on s.name = x.sup group by grp order by committed desc""", {"co": co, "other": _("Other")}, as_dict=True)
		panels["budget"] = budget_by_category()
	if (c["people"] or c["site"]) and not partner:
		panels["labour"] = labour_today()
	if c["site"] or c["owner"]:
		from mimaar import build

		s = build.stages()
		panels["stages"] = {"counts": s["counts"], "now": s["now"], "next": s["next"], "built": s["built"], "planned": s["planned"],
			"phases": [{"name": p["name"], "start": p["start"], "end": p["end"], "built": p["built"], "planned": p["planned"]} for p in s["phases"]]}
	if (c["store"] or c["site"]) and not partner:
		rel = frappe.db.sql(f"""select s.posting_date d, count(distinct s.name) n, sum(x.transfer_qty) q from `tabStock Entry` s join `tabStock Entry Detail` x on x.parent = s.name
			where s.docstatus = 1 and s.stock_entry_type = 'Material Issue' and ifnull(s.mimaar_water_ref, '') = '' and s.posting_date >= %s{_psql('s')} group by s.posting_date""", add_days(today, -13), as_dict=True)
		m = {str(r.d): cint(r.n) for r in rel}
		days = [str(add_days(today, -i)) for i in range(13, -1, -1)]
		panels["released"] = {"days": days, "count": [m.get(d, 0) for d in days]}
	return {"tiles": tiles, "acts": acts, "panels": panels, "kpi": k, "money": bool(full_money)}


def budget_by_category():
	"""Budget, booked (spent) and ordered-but-not-yet-billed, by budget category."""
	co = _company()
	rows = frappe.db.sql(f"""select coalesce(nullif(a.mimaar_budget_category, ''), 'Other') cat, b.account, sum(b.budget_amount) budget
		from `tabBudget` b join `tabAccount` a on a.name = b.account where b.docstatus = 1 and b.company = %s{_psql('b')} group by cat, b.account""", co, as_dict=True)
	spent = dict(frappe.db.sql(f"select account, sum(debit - credit) from `tabGL Entry` where is_cancelled = 0 and company = %s{_psql()} group by account", co))
	ordered = dict(frappe.db.sql(f"""select i.expense_account, sum(i.base_net_amount * (1 - least(1, coalesce(p.per_billed, 0) / 100))) from `tabPurchase Order Item` i
		join `tabPurchase Order` p on p.name = i.parent where p.docstatus = 1 and p.status != 'Closed' and p.company = %s{_psql('p')} group by i.expense_account""", co))
	out = {}
	for r in rows:
		o = out.setdefault(r.cat, {"category": r.cat, "budget": 0.0, "spent": 0.0, "committed": 0.0, "lines": 0})
		o["budget"] += flt(r.budget)
		o["spent"] += flt(spent.get(r.account))
		o["committed"] += flt(ordered.get(r.account))
		o["lines"] += 1
	order = ["Design & approvals", "Service charges", "Grey labour", "Grey materials", "Finishing labour", "Finishing materials", "Contingency", "Site running costs", "Other"]
	return sorted(out.values(), key=lambda x: order.index(x["category"]) if x["category"] in order else 99)


def labour_today():
	"""Workers registered (active) and present today, by who they work for."""
	today = nowdate()
	att = frappe.db.get_value("Site Attendance", _only({"date": today, "docstatus": ["<", 2]}), "name")
	present = {}
	if att:
		for r in frappe.db.sql("""select coalesce(w.contractor, '') c, count(*) n from `tabSite Attendance Row` r join `tabSite Worker` w on w.name = r.worker
			where r.parent = %s and r.status != 'Absent' group by c""", att, as_dict=True):
			present[r.c] = cint(r.n)
	rows = []
	for r in frappe.db.sql("""select coalesce(contractor, '') c, count(*) n from `tabSite Worker` where status = 'Active' and worker_type in ('Labour', 'Mistri', 'Group head')
		group by c order by n desc""", as_dict=True):
		rows.append({"name": frappe.db.get_value("Supplier", r.c, "supplier_name") if r.c else _("Own workers"), "registered": cint(r.n), "present": present.get(r.c, 0)})
	return rows
