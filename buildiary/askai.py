"""Ask the project: questions answered by the AI from the project's live records.

The server gathers a short summary of the live records the person may see (money only for the
owner and the project accountant), and the AI answers from that data alone."""

import json

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, getdate, nowdate

from buildiary.field import _company, _project, _psql, _store, caps


def _rows(q, a=None):
	return frappe.db.sql(q, a or {}, as_dict=True)


def gather(money):
	today = nowdate()
	week = add_days(today, -6)
	project = _project()
	p = frappe.db.get_value("Project", project, ["project_name", "expected_start_date", "expected_end_date", "notes"], as_dict=True) if project else {}
	out = {"today": today, "project": p}
	from buildiary import build

	out["schedule"] = [{k: s[k] for k in ("code", "title", "phase", "start", "end", "built", "reported", "verified", "planned", "state")} for s in build._stage_rows()]
	pq = lambda a="": _psql(a)  # noqa: E731  (only the chosen project, when there are several)
	out["recent_progress_reports"] = _rows(f"""select u.date, t.subject, u.kind, u.pct, u.note from `tabStage Update` u join `tabTask` t on t.name = u.task
		where u.date >= %(d)s{pq('t')} order by u.date desc limit 30""", {"d": add_days(today, -13)})
	from buildiary import stores

	wh = _store()
	bins, received, released, returned, on_order, reorder = stores._figures(wh)
	names = {i.name: (i.item_name, i.stock_uom) for i in frappe.get_all("Item", fields=["name", "item_name", "stock_uom"], limit_page_length=3000)}
	out["store_now"] = sorted([{"item": names.get(c, (c, ""))[0], "in_store": q, "unit": names.get(c, ("", ""))[1], "low": bool(reorder.get(c) and q <= reorder[c])}
		for c, q in bins.items() if q or c in received], key=lambda x: -x["in_store"])[:80]
	out["on_order"] = [{"item": names.get(c, (c, ""))[0], "pending": q, "unit": names.get(c, ("", ""))[1]} for c, q in on_order.items() if q > 0][:60]
	out["released_this_week"] = _rows(f"""select s.posting_date date, x.item_name item, x.transfer_qty qty, x.stock_uom unit, s.buildiary_issued_to released_to, s.buildiary_work_area area
		from `tabStock Entry` s join `tabStock Entry Detail` x on x.parent = s.name where s.docstatus = 1 and s.stock_entry_type = 'Material Issue'
		and ifnull(s.buildiary_water_ref, '') = '' and s.posting_date >= %(d)s{pq('s')} order by s.posting_date desc limit 80""", {"d": week})
	out["received_this_week"] = _rows(f"""select p.posting_date date, x.item_name item, x.qty, x.uom unit, p.supplier_name supplier from `tabPurchase Receipt` p
		join `tabPurchase Receipt Item` x on x.parent = p.name where p.docstatus = 1 and p.posting_date >= %(d)s{pq('p')} order by p.posting_date desc limit 60""", {"d": week})
	out["water"] = {"tankers_this_week": _rows(f"""select date, vehicle_no, gallons, water_type, tds_ppm, ai_verdict from `tabWater Tanker` where docstatus = 1 and date >= %(d)s{pq()}
		order by date desc limit 30""", {"d": week}), "latest_levels": _rows(f"""select r.tank, r.level_pct, r.gallons, r.date from `tabWater Tank Reading` r
		where r.creation = (select max(x.creation) from `tabWater Tank Reading` x where x.tank = r.tank){pq('r')}""")}
	att = _rows(f"""select a.date, a.present, a.half_day from `tabSite Attendance` a where a.date >= %(d)s and a.docstatus < 2{pq('a')} order by a.date""", {"d": week})
	out["people"] = {"registered_active": frappe.db.count("Site Worker", {"status": "Active"}), "attendance_this_week": att,
		"by_trade": _rows("select trade, worker_type, count(*) n from `tabSite Worker` where status = 'Active' group by trade, worker_type")}
	out["open_snags"] = _rows(f"""select description, location, status, target_date, responsible_person from `tabSite Snag` where status in ('Open', 'In progress', 'Fixed'){pq()} order by target_date limit 40""")
	out["inspections"] = _rows(f"""select date, inspection_type, location, result from `tabSite Inspection` where docstatus < 2{pq()} order by date desc limit 20""")
	out["open_ncrs"] = _rows(f"""select i.date, i.inspection_type, a.issue, a.action, a.target_date, s.status from `tabSite Inspection` i join `tabSite Inspection Action` a on a.parent = i.name
		left join `tabSite Snag` s on s.name = a.snag where i.docstatus = 1 and i.result = 'Fail' and (s.name is null or s.status != 'Closed'){pq('i')} limit 30""")
	out["site_diary"] = _rows(f"""select date, weather, workers, work_done, issues, materials_used from `tabSite Diary` where date >= %(d)s{pq()} order by date desc limit 14""", {"d": add_days(today, -13)})
	po_cols = "p.name, p.supplier_name, p.transaction_date, p.schedule_date, p.status, p.per_received, p.per_billed" + (", p.base_grand_total total, p.advance_paid" if money else "")
	out["purchase_orders"] = _rows(f"select {po_cols} from `tabPurchase Order` p where p.docstatus = 1 and p.status not in ('Closed', 'Completed'){pq('p')} order by p.schedule_date limit 40")
	if money:
		from buildiary import money as m, petty

		b = m.budget_overview()
		out["budget"] = {"budget": b["budget"], "committed": b["committed"], "paid": b["paid"], "still_owed_on_contracts": b["still_owed"],
			"by_phase": [{k: x[k] for k in ("phase", "budget", "committed", "paid", "left", "over")} for x in b["phases"]],
			"over_budget_lines": [{k: ln[k] for k in ("name", "budget", "committed", "paid")} for ph in b["phases"] for ln in ph["lines"] if ln["over"]],
			"cash_flow_next_months": [{"month": mo, "scheduled": b["cash"]["scheduled"][i], "projected": b["cash"]["projected"][i]} for i, mo in enumerate(b["cash"]["months"][:6])]}
		out["bills_to_pay"] = _rows(f"""select supplier_name, name, posting_date, due_date, outstanding_amount from `tabPurchase Invoice` where docstatus = 1 and outstanding_amount > 0{pq()} order by due_date limit 30""")
		out["payment_schedule_due"] = _rows(f"""select p.supplier_name, ps.due_date, ps.payment_amount, ps.description from `tabPayment Schedule` ps join `tabPurchase Order` p on p.name = ps.parent
			where ps.parenttype = 'Purchase Order' and p.docstatus = 1 and p.status not in ('Closed', 'Completed'){pq('p')} order by ps.due_date limit 30""")
		out["petty_cash"] = {"holders": petty.balances(), "this_month": _rows(f"""select category, sum(amount) amount from `tabPetty Cash Entry` where entry_type = 'Expense' and status != 'Rejected'
			and docstatus < 2 and date >= %(d)s{pq()} group by category""", {"d": str(getdate(today).replace(day=1))})}
	return out


@frappe.whitelist()
def ask(question):
	"""Answer a question about the project from its live records."""
	c = caps()
	if not (c["site"] or c["store"] or c["money"] or c["owner"] or c["people"]):
		frappe.throw(_("You don't have access to this. Ask the owner."), frappe.PermissionError)
	q = (question or "").strip()
	if len(q) < 3:
		frappe.throw(_("Write your question."))
	from buildiary import ai, petty

	money = petty.approver() or c["money"]
	data = gather(money)
	lang = "Urdu (simple, everyday words; numbers in English digits)" if (frappe.local.lang == "ur" or frappe.db.get_value("User", frappe.session.user, "language") == "ur") else "English"
	who = "the owner" if c["owner"] else "the project accountant" if money else "a site supervisor or store keeper"
	prompt = (
		f"You help run a house construction project in Pakistan. You are answering {who}. Use ONLY the project's live records below "
		f"(from its ERP, as of {data['today']}); if they don't show something, say so plainly instead of guessing. "
		"Be short and practical: a direct answer first, then a few bullet points with the numbers (units, dates; money in Rs, large amounts in lac). "
		"For a report, use short headed sections. "
		+ ("" if money else "This person must not see money amounts: do not mention prices, costs, budgets or payments. ")
		+ f"Write the answer in {lang}. "
		'Reply with only JSON: {"answer": "the answer, using **bold**, lines starting with - for bullets and lines starting with ## for headings", "followups": ["up to 3 short follow-up questions"]}\n\n'
		f"QUESTION: {q}\n\nPROJECT RECORDS (JSON):\n{json.dumps(data, default=str, ensure_ascii=False)[:60000]}"
	)
	fake = frappe.conf.get("buildiary_fake_ai_file")
	if fake:
		r = ai.ask_many(prompt, [])
	else:
		r = ai._call(prompt, [], max_tokens=4096)
	return {"answer": str(r.get("answer") or ""), "followups": [str(x) for x in (r.get("followups") or [])][:3]}
