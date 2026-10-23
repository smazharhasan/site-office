"""The Mimaar field app (/field): everything a supervisor, store keeper or the owner
does on site, on a phone, in English or Urdu.

The app is only a simpler face. Every action below goes through the standard ERPNext
documents (Purchase Receipt, Stock Entry, Payment Entry, Supplier Quotation ...), so
the owner's rules in mimaar.procurement and ERPNext's own checks apply exactly as in
the full ERPNext screens.
"""

import json

import frappe
from frappe import _
from frappe.utils import add_days, cint, cstr, flt, get_fullname, getdate, now_datetime, nowdate, nowtime

LANGS = ("en", "ur")


# ---------------------------------------------------------------- helpers
def _settings():
	return frappe.get_cached_doc("Mimaar Settings")


def _company():
	return frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company") or frappe.get_all("Company", pluck="name", limit=1)[0]


def _project():
	return _settings().default_project or frappe.db.get_value("Project", {"status": "Open"}, "name")


def _store():
	s = _settings().site_warehouse
	if s:
		return s
	return frappe.db.get_value("Warehouse", {"company": _company(), "is_group": 0, "warehouse_name": "Stores"}) or frappe.db.get_value("Warehouse", {"company": _company(), "is_group": 0})


def _parse(v):
	if isinstance(v, str):
		try:
			return json.loads(v)
		except ValueError:
			return v
	return v


def _roles():
	return set(frappe.get_roles())


def caps():
	"""What this person can do in the field app (the server still checks every action)."""
	r = _roles()
	owner = "System Manager" in r
	return {
		"owner": owner,
		"buy": owner or bool(r & {"Purchase User", "Purchase Manager"}),
		"suppliers": owner or bool(r & {"Purchase User", "Purchase Manager", "Purchase Master Manager", "Accounts User"}),
		"money": owner or bool(r & {"Accounts User", "Accounts Manager"}),
		"store": owner or bool(r & {"Stock User", "Stock Manager"}),
		"site": owner or bool(r & {"Site Supervisor", "Projects User", "Projects Manager"}),
		"people": owner or bool(r & {"Site Supervisor", "Projects Manager"}),
		"new_supplier": owner or "Purchase Master Manager" in r,
		"new_item": owner or "Item Manager" in r,
		"accountant": bool(r & {"Accounts User", "Accounts Manager"}),
	}


def _need(cap):
	if not caps().get(cap):
		frappe.throw(_("You don't have access to this. Ask the owner."), frappe.PermissionError)


def _photo_ok(url):
	return bool(url) and isinstance(url, str) and url.startswith(("/files/", "/private/files/"))


# ---------------------------------------------------------------- start
@frappe.whitelist()
def boot():
	user = frappe.session.user
	u = frappe.db.get_value("User", user, ["full_name", "user_image", "language"], as_dict=True) or {}
	s = _settings()
	project = _project()
	return {
		"user": user,
		"full_name": u.get("full_name") or user,
		"image": u.get("user_image"),
		"lang": u.get("language") if u.get("language") in LANGS else "en",
		"caps": caps(),
		"company": _company(),
		"currency": frappe.db.get_value("Company", _company(), "default_currency") or "PKR",
		"project": project,
		"project_name": frappe.db.get_value("Project", project, "project_name") if project else "",
		"store": _store(),
		"ai": bool((s.ai_provider and s.ai_provider != "Off") or frappe.conf.get("mimaar_fake_ai_file")),
		"rules": {k: cint(s.get(k)) for k in ("require_dn_scan", "require_receiver_photo", "require_bill_scan", "require_payment_proof", "require_attendance_photo",
			"card_for_store", "card_for_receiving", "card_for_petty_cash")},
		"face_check": s.face_check or "Required",
		"today": nowdate(),
		"ui": _ui(),
		"person": _me(),
	}


def _ui():
	try:
		return json.loads(frappe.defaults.get_user_default("mimaar_ui") or "{}")
	except ValueError:
		return {}


def _me():
	from mimaar.identity import my_person

	p = my_person()
	if not p:
		return None
	d = frappe.db.get_value("Site Worker", p, ["name", "full_name", "full_name_ur", "worker_type", "status", "photo", "entry_card_no", "app_access", "store_keeper"], as_dict=True)
	d.pin_set = cint(frappe.db.get_value("Site Card", {"person": p}, "pin_set"))
	return d


@frappe.whitelist()
def ui_save(ui):
	"""My settings (theme, fonts, text size): kept with the user, so they follow them to any phone."""
	u = _parse(ui) or {}
	keep = {k: str(u[k])[:40] for k in ("skin", "mode", "ur", "en", "size") if u.get(k)}
	frappe.defaults.set_user_default("mimaar_ui", json.dumps(keep))
	return keep


@frappe.whitelist()
def set_language(lang):
	if lang not in LANGS:
		frappe.throw(_("Choose English or Urdu."))
	frappe.db.set_value("User", frappe.session.user, "language", lang)
	frappe.clear_cache(user=frappe.session.user)
	return lang


# ---------------------------------------------------------------- dashboard
def _sum(sql, args=None):
	v = frappe.db.sql(sql, args or {})
	return flt(v[0][0]) if v and v[0][0] is not None else 0.0


@frappe.whitelist()
def dashboard():
	c = caps()
	co, today = _company(), nowdate()
	project = _project()
	k = {}
	k["budget"] = _sum("select sum(budget_amount) from `tabBudget` where docstatus = 1 and company = %(co)s", {"co": co})
	k["committed"] = _sum("select sum(base_grand_total) from `tabPurchase Order` where docstatus = 1 and company = %(co)s and status != 'Closed'", {"co": co})
	k["paid"] = _sum("select sum(base_paid_amount) from `tabPayment Entry` where docstatus = 1 and payment_type = 'Pay' and party_type = 'Supplier' and company = %(co)s", {"co": co})
	k["due"] = _sum("select sum(outstanding_amount) from `tabPurchase Invoice` where docstatus = 1 and company = %(co)s and outstanding_amount > 0", {"co": co})
	k["due_now"] = _sum("select sum(outstanding_amount) from `tabPurchase Invoice` where docstatus = 1 and company = %(co)s and outstanding_amount > 0 and coalesce(due_date, posting_date) <= %(t)s", {"co": co, "t": today})
	att = frappe.db.get_value("Site Attendance", {"date": today, "docstatus": ["<", 2]}, ["present", "half_day"], as_dict=True) or {}
	k["on_site"] = cint(att.get("present")) + cint(att.get("half_day"))
	k["workers"] = frappe.db.count("Site Worker", {"status": "Active"})
	k["snags_open"] = frappe.db.count("Site Snag", {"status": ["in", ["Open", "In progress"]]})
	k["to_receive"] = frappe.db.count("Purchase Order", {"docstatus": 1, "status": ["in", ["To Receive and Bill", "To Receive"]]})
	k["stock_items"] = frappe.db.count("Bin", {"warehouse": _store(), "actual_qty": [">", 0]})
	tasks = frappe.get_all("Task", filters={"project": project} if project else {}, fields=["progress", "exp_end_date", "status"])
	k["progress"] = round(sum(flt(t.progress) for t in tasks) / len(tasks), 1) if tasks else 0
	k["late_tasks"] = sum(1 for t in tasks if t.status not in ("Completed", "Cancelled") and t.exp_end_date and getdate(t.exp_end_date) < getdate(today))

	acts = []

	def add(kind, text, go, n=None):
		acts.append({"k": kind, "t": text, "go": go, "n": n})

	if c["buy"]:
		for q in frappe.get_list("Supplier Quotation", filters={"docstatus": 0}, fields=["name", "supplier_name"], limit=10, order_by="creation desc"):
			add("warn", _("Confirm quotation {0} from {1}").format(q.name, q.supplier_name), ["quote", q.name])
		for q in frappe.get_list("Supplier Quotation", filters={"docstatus": 1, "mimaar_final": 0, "status": ["!=", "Expired"]}, fields=["name", "supplier_name"], limit=10, order_by="creation desc"):
			if not frappe.db.exists("Supplier Quotation", {"amended_from": q.name, "docstatus": ["<", 2]}):
				add("info", _("Lock the agreed quotation {0} ({1}) as final, or revise it").format(q.name, q.supplier_name), ["quote", q.name])
		for q in frappe.get_list("Supplier Quotation", filters={"docstatus": 1, "mimaar_final": 1}, fields=["name", "supplier_name"], limit=20, order_by="creation desc"):
			if not frappe.db.exists("Purchase Order Item", {"supplier_quotation": q.name, "docstatus": ["<", 2]}):
				add("warn", _("Raise the purchase order from final quotation {0} ({1})").format(q.name, q.supplier_name), ["quote", q.name])
		for p in frappe.get_list("Purchase Order", filters={"docstatus": 0}, fields=["name", "supplier_name"], limit=10, order_by="creation desc"):
			add("warn", _("Purchase order {0} ({1}) is a draft: check it and lock it").format(p.name, p.supplier_name), ["order", p.name])
	if c["store"] or c["buy"]:
		for p in frappe.get_list("Purchase Order", filters={"docstatus": 1, "status": ["in", ["To Receive and Bill", "To Receive"]]}, fields=["name", "supplier_name", "per_received", "schedule_date"], limit=10, order_by="schedule_date asc"):
			late = p.schedule_date and getdate(p.schedule_date) < getdate(today)
			add("bad" if late else "info", _("Delivery expected: {0} from {1} ({2}% received)").format(p.name, p.supplier_name, round(flt(p.per_received))), ["receive", p.name])
	if c["money"]:
		for b in frappe.get_list("Purchase Invoice", filters={"docstatus": 1, "outstanding_amount": [">", 0]}, fields=["name", "supplier_name", "outstanding_amount", "due_date"], limit=10, order_by="due_date asc"):
			due = not b.due_date or getdate(b.due_date) <= getdate(today)
			add("bad" if due else "info", _("Pay {0}: bill {1} ({2})").format(b.supplier_name, b.name, frappe.utils.fmt_money(b.outstanding_amount, currency="PKR")), ["bill", b.name])
		for r in frappe.get_list("Purchase Receipt", filters={"docstatus": 1, "status": "To Bill"}, fields=["name", "supplier_name"], limit=10, order_by="posting_date asc"):
			add("info", _("Record the supplier's bill for goods received {0} ({1})").format(r.name, r.supplier_name), ["billnew", r.name])
	if c["site"]:
		for s in frappe.get_list("Site Snag", filters={"status": ["in", ["Open", "In progress"]], "target_date": ["<", today]}, fields=["name", "description"], limit=10):
			add("bad", _("Snag past its target date: {0}").format(cstr(s.description)[:80]), ["snag", s.name])
		for t in frappe.get_list("Task", filters={"project": project, "status": ["not in", ["Completed", "Cancelled"]], "exp_end_date": ["<", today]} if project else {"name": ""}, fields=["name", "subject", "progress"], limit=8, order_by="exp_end_date asc"):
			add("warn", _("Running late: {0} ({1}% done)").format(t.subject, round(flt(t.progress))), ["task", t.name])
	if c["people"]:
		for w in frappe.get_list("Site Worker", filters={"status": "Active"}, fields=["name", "full_name", "cnic_expiry", "entry_card_expiry", "police_verification"], limit=500):
			bad = [x for x, d in ((_("CNIC"), w.cnic_expiry), (_("entry card"), w.entry_card_expiry)) if d and getdate(d) < getdate(today)]
			if bad:
				add("bad", _("{0}: {1} expired").format(w.full_name, ", ".join(bad)), ["worker", w.name])
	return {"kpi": k, "acts": acts}


# ---------------------------------------------------------------- schedule
@frappe.whitelist()
def tasks():
	project = _project()
	rows = frappe.get_list(
		"Task",
		filters={"project": project} if project else {},
		fields=["name", "subject", "status", "progress", "exp_start_date", "exp_end_date", "description"],
		order_by="exp_start_date asc, creation asc",
		limit_page_length=500,
	)
	today = getdate(nowdate())
	for r in rows:
		r.late = bool(r.status not in ("Completed", "Cancelled") and r.exp_end_date and getdate(r.exp_end_date) < today)
	return rows


@frappe.whitelist()
def task_progress(name, progress, note=None, photo=None):
	_need("site")
	t = frappe.get_doc("Task", name)
	t.check_permission("write")
	p = max(0, min(100, flt(progress)))
	t.progress = p
	if p >= 100:
		t.status = "Completed"
		t.completed_on = t.completed_on or nowdate()
	elif p > 0 and t.status in ("Open", "Overdue", "Pending Review"):
		t.status = "Working"
	t.save()
	text = _("Progress {0}%").format(round(p)) + (f": {frappe.utils.escape_html(note)}" if note else "")
	if _photo_ok(photo):
		_attach(photo, "Task", t.name)
		text += f'<br><img src="{photo}" style="max-width:320px">'
	t.add_comment("Comment", text)
	return {"name": t.name, "progress": t.progress, "status": t.status}


def _attach(url, doctype, name):
	f = frappe.db.get_value("File", {"file_url": url}, ["name", "attached_to_name"], as_dict=True)
	if f and not f.attached_to_name:
		frappe.db.set_value("File", f.name, {"attached_to_doctype": doctype, "attached_to_name": name})


@frappe.whitelist()
def task_history(name):
	frappe.get_doc("Task", name).check_permission("read")
	return frappe.get_all("Comment", filters={"reference_doctype": "Task", "reference_name": name, "comment_type": "Comment"}, fields=["content", "owner", "creation"], order_by="creation desc", limit=20)


# ---------------------------------------------------------------- site diary
@frappe.whitelist()
def diary(limit=30):
	return frappe.get_list("Site Diary", fields=["name", "date", "weather", "workers", "work_done", "issues", "photo_1", "photo_2", "recorded_by"], order_by="date desc, creation desc", limit_page_length=cint(limit))


@frappe.whitelist()
def diary_save(data):
	_need("site")
	d = _parse(data) or {}
	doc = frappe.get_doc({
		"doctype": "Site Diary", "date": d.get("date") or nowdate(), "project": _project(), "weather": d.get("weather"),
		"workers": cint(d.get("workers")), "work_done": d.get("work_done"), "materials_used": d.get("materials_used"),
		"issues": d.get("issues"), "visitors": d.get("visitors"),
	})
	for i, p in enumerate((d.get("photos") or [])[:4], start=1):
		if _photo_ok(p):
			doc.set(f"photo_{i}", p)
	doc.insert()
	return doc.name


# ---------------------------------------------------------------- inspections and snags
INSPECTION_TYPES = None


@frappe.whitelist()
def inspections(limit=30):
	rows = frappe.get_list("Site Inspection", fields=["name", "date", "inspection_type", "location", "result", "docstatus", "supplier"], order_by="date desc, creation desc", limit_page_length=cint(limit))
	return {"rows": rows, "types": frappe.get_meta("Site Inspection").get_field("inspection_type").options.split("\n")}


@frappe.whitelist()
def inspection_save(data, submit=0):
	_need("site")
	d = _parse(data) or {}
	doc = frappe.get_doc({
		"doctype": "Site Inspection", "date": d.get("date") or nowdate(), "project": _project(), "task": d.get("task"),
		"inspection_type": d.get("inspection_type"), "location": d.get("location"), "supplier": d.get("supplier"),
		"inspector": d.get("inspector") or get_fullname(frappe.session.user), "result": d.get("result"), "remarks": d.get("remarks"),
		"photo_1": d.get("photo_1") if _photo_ok(d.get("photo_1")) else None, "photo_2": d.get("photo_2") if _photo_ok(d.get("photo_2")) else None,
		"checks": [{"check": c.get("check"), "result": c.get("result") or "OK", "remarks": c.get("remarks"), "photo": c.get("photo") if _photo_ok(c.get("photo")) else None} for c in d.get("checks") or [] if c.get("check")],
		"actions": [{"issue": a.get("issue"), "action": a.get("action"), "supplier": a.get("supplier"), "responsible_person": a.get("responsible_person"),
			"target_date": a.get("target_date") or add_days(nowdate(), 3), "photo": a.get("photo") if _photo_ok(a.get("photo")) else None} for a in d.get("actions") or [] if a.get("issue")],
	})
	doc.insert()
	if cint(submit):
		doc.submit()
	return doc.name


@frappe.whitelist()
def snags(status="open"):
	f = {"status": ["in", ["Open", "In progress"]]} if status == "open" else {"status": ["in", ["Fixed", "Closed"]]} if status == "done" else {}
	rows = frappe.get_list("Site Snag", filters=f, fields=["name", "description", "location", "status", "supplier", "responsible_person", "target_date", "photo", "fixed_photo", "source_inspection"], order_by="target_date asc, creation desc", limit_page_length=200)
	today = getdate(nowdate())
	for r in rows:
		r.late = bool(r.status in ("Open", "In progress") and r.target_date and getdate(r.target_date) < today)
	return rows


@frappe.whitelist()
def snag_save(data):
	_need("site")
	d = _parse(data) or {}
	if d.get("name"):
		doc = frappe.get_doc("Site Snag", d["name"])
		for k in ("status", "fixed_photo", "responsible_person", "target_date", "supplier"):
			if d.get(k) is not None:
				doc.set(k, d[k])
		doc.save()
		if d.get("note"):
			doc.add_comment("Comment", frappe.utils.escape_html(d["note"]))
		return doc.name
	doc = frappe.get_doc({
		"doctype": "Site Snag", "description": d.get("description"), "location": d.get("location"), "project": _project(),
		"photo": d.get("photo") if _photo_ok(d.get("photo")) else None, "supplier": d.get("supplier"),
		"responsible_person": d.get("responsible_person"), "target_date": d.get("target_date"), "status": "Open",
	})
	doc.insert()
	return doc.name


# ---------------------------------------------------------------- stores
@frappe.whitelist()
def stock(q=None):
	_need("store") if not caps()["site"] else None
	wh = _store()
	cond, args = ["b.warehouse = %(wh)s"], {"wh": wh}
	if q:
		cond.append("(i.item_name like %(q)s or i.name like %(q)s)")
		args["q"] = f"%{q}%"
	rows = frappe.db.sql(
		f"""select i.name item_code, i.item_name, i.stock_uom uom, i.item_group, b.actual_qty qty,
			(select r.warehouse_reorder_level from `tabItem Reorder` r where r.parent = i.name and r.warehouse = b.warehouse limit 1) reorder
		from `tabBin` b join `tabItem` i on i.name = b.item_code
		where {' and '.join(cond)} order by i.item_group, i.item_name limit 500""",
		args,
		as_dict=True,
	)
	if q:
		have = {r.item_code for r in rows}
		for i in frappe.get_list("Item", filters={"disabled": 0, "is_stock_item": 1}, or_filters={"item_name": ["like", f"%{q}%"], "name": ["like", f"%{q}%"]}, fields=["name", "item_name", "stock_uom", "item_group"], limit_page_length=50):
			if i.name not in have:
				rows.append(frappe._dict(item_code=i.name, item_name=i.item_name, uom=i.stock_uom, item_group=i.item_group, qty=0, reorder=None))
	for r in rows:
		r.low = bool(r.reorder and flt(r.qty) <= flt(r.reorder))
	return {"store": wh, "rows": rows}


@frappe.whitelist()
def to_receive():
	_need("store")
	rows = frappe.get_list(
		"Purchase Order",
		filters={"docstatus": 1, "status": ["in", ["To Receive and Bill", "To Receive"]]},
		fields=["name", "supplier", "supplier_name", "transaction_date", "schedule_date", "per_received"],
		order_by="schedule_date asc",
		limit_page_length=100,
	)
	for r in rows:
		r.lines = frappe.db.count("Purchase Order Item", {"parent": r.name})
	return rows


@frappe.whitelist()
def order_lines(po):
	doc = frappe.get_doc("Purchase Order", po)
	doc.check_permission("read")
	show_rates = caps()["buy"] or caps()["money"]
	return {
		"name": doc.name, "supplier": doc.supplier, "supplier_name": doc.supplier_name, "per_received": doc.per_received,
		"lines": [{
			"po_detail": r.name, "item_code": r.item_code, "item_name": r.item_name, "uom": r.uom, "qty": flt(r.qty),
			"received": flt(r.received_qty), "pending": max(0, flt(r.qty) - flt(r.received_qty)), "rate": flt(r.rate) if show_rates else None,
		} for r in doc.items],
	}


@frappe.whitelist()
def read_challan(po, file_url):
	"""AI reads the delivery note against the order's lines (only the quantities are used)."""
	_need("store")
	from mimaar import ai

	doc = frappe.get_doc("Purchase Order", po)
	doc.check_permission("read")
	lines = [f"{i}: {r.item_name or r.item_code} ({r.uom}), ordered {flt(r.qty)}, already received {flt(r.received_qty)}" for i, r in enumerate(doc.items)]
	d = ai.ask(
		f"This is a supplier's delivery note, challan or bill for goods delivered to a house under construction in Pakistan. {ai.URDU} "
		f"It should be against purchase order {doc.name} from {doc.supplier_name}. The lines we expect are:\n" + "\n".join(lines) +
		f"\nRead every line on the document and give lineIndex = the number of the matching expected line (or null). Reply with only JSON of this shape:\n{ai.DELIVERY_SHAPE}",
		file_url,
	)
	return ai._with_index(d, doc)


@frappe.whitelist()
def receive(po, lines, dn_no=None, dn_scan=None, receiver_photo=None, goods_photo=None, vehicle=None, received_by=None, location=None, check=None):
	"""Goods arrive at site against a purchase order. Part deliveries keep the order open.
	The receiver is identified by their site card and a face check (when the owner requires it)."""
	_need("store")
	from mimaar.identity import needs_card, use_check

	if needs_card("card_for_receiving") and not check:
		frappe.throw(_("Scan the receiver's site card and take their photo first."), title=_("Receiver's site card"))
	from erpnext.buying.doctype.purchase_order.purchase_order import make_purchase_receipt

	want = {x.get("po_detail"): flt(x.get("qty")) for x in _parse(lines) or []}
	pr = make_purchase_receipt(po)
	keep = []
	for r in pr.items:
		q = want.get(r.purchase_order_item, 0)
		if q > 0:
			r.qty = r.received_qty = q
			r.rejected_qty = 0
			r.warehouse = r.warehouse or _store()
			keep.append(r)
	if not keep:
		frappe.throw(_("Enter the quantity received for at least one item."))
	pr.items = keep
	pr.set_warehouse = pr.set_warehouse or _store()
	pr.supplier_delivery_note = (dn_no or "").strip()
	pr.mimaar_dn_scan = dn_scan if _photo_ok(dn_scan) else None
	pr.mimaar_receiver_photo = receiver_photo if _photo_ok(receiver_photo) else None
	pr.mimaar_goods_photo = goods_photo if _photo_ok(goods_photo) else None
	pr.mimaar_vehicle = vehicle
	pr.mimaar_received_by = received_by or get_fullname(frappe.session.user)
	if location:
		pr.remarks = _("Received at {0}").format(location)
	idc = frappe.get_doc("Identity Check", check) if check else None
	if idc:
		pr.mimaar_receiver = idc.person
		pr.mimaar_received_by = idc.person_name
		pr.mimaar_receiver_photo = pr.mimaar_receiver_photo or idc.live_photo
	pr.insert()
	if idc:
		use_check(idc.name, "Receiving goods", "Purchase Receipt", pr.name, idc.person)
		pr.db_set("mimaar_identity_check", idc.name)
	try:
		pr.submit()
	except Exception:
		frappe.db.rollback()
		raise
	return {"name": pr.name, "po_status": frappe.db.get_value("Purchase Order", po, ["status", "per_received"], as_dict=True)}


def _stock_entry(kind, items, check=None, issued_to=None, work_area=None, photo=None, remarks=None):
	"""Material released from the store to the work, or returned from the work to the store."""
	_need("store")
	from mimaar.identity import needs_card, use_check

	action = "Store issue" if kind == "issue" else "Store return"
	if needs_card("card_for_store") and not check:
		frappe.throw(_("Scan the site card of the person taking or returning the material, and take their photo."), title=_("Site card"))
	rows = [x for x in _parse(items) or [] if flt(x.get("qty")) > 0 and x.get("item_code")]
	if not rows:
		frappe.throw(_("Add at least one item and its quantity."))
	idc = frappe.get_doc("Identity Check", check) if check else None
	wh = _store()
	if kind == "issue":
		short = []
		for x in rows:
			have = flt(frappe.db.get_value("Bin", {"item_code": x["item_code"], "warehouse": wh}, "actual_qty"))
			if flt(x["qty"]) > have:
				short.append(_("{0}: only {1} in the store").format(frappe.db.get_value("Item", x["item_code"], "item_name") or x["item_code"], frappe.format(have, {"fieldtype": "Float"})))
		if short:
			frappe.throw("<br>".join(short), title=_("Not enough in the store"))
	d = {"doctype": "Stock Entry", "company": _company(), "project": _project(), "remarks": remarks,
		"mimaar_issued_to": idc.person_name if idc else issued_to, "mimaar_person": idc.person if idc else None,
		"mimaar_work_area": work_area, "mimaar_photo": photo if _photo_ok(photo) else (idc.live_photo if idc else None)}
	if kind == "issue":
		d.update({"stock_entry_type": "Material Issue", "from_warehouse": wh, "items": [{"item_code": x["item_code"], "qty": flt(x["qty"]), "s_warehouse": wh} for x in rows]})
	else:
		d.update({"stock_entry_type": "Material Receipt", "to_warehouse": wh, "mimaar_is_return": 1, "items": [{
			"item_code": x["item_code"], "qty": flt(x["qty"]), "t_warehouse": wh, "allow_zero_valuation_rate": 1,
			"basic_rate": flt(frappe.db.get_value("Bin", {"item_code": x["item_code"], "warehouse": wh}, "valuation_rate")) or flt(frappe.db.get_value("Item", x["item_code"], "valuation_rate")),
		} for x in rows]})
	if not d["mimaar_issued_to"]:
		frappe.throw(_("Enter who takes or returns the material (mistri or group head)."))
	se = frappe.get_doc(d)
	se.insert()
	if idc:
		use_check(idc.name, action, "Stock Entry", se.name, idc.person)
		se.mimaar_identity_check = idc.name
	try:
		se.submit()
	except Exception:
		frappe.db.rollback()
		raise
	return se.name


@frappe.whitelist()
def release(items, issued_to=None, work_area=None, photo=None, remarks=None, check=None):
	"""Material leaves the site store for the work, named to the mistri or group head (site card + face)."""
	return _stock_entry("issue", items, check, issued_to, work_area, photo, remarks)


@frappe.whitelist()
def return_to_store(items, check=None, returned_by=None, work_area=None, photo=None, remarks=None):
	"""Unused material comes back from the work into the store (site card + face of who returns it)."""
	return _stock_entry("return", items, check, returned_by, work_area, photo, remarks)


@frappe.whitelist()
def movements(limit=40):
	_need("store") if not caps()["site"] else None
	pr = frappe.get_list("Purchase Receipt", filters={"docstatus": 1}, fields=["name", "posting_date", "supplier_name", "supplier_delivery_note", "mimaar_received_by"], order_by="posting_date desc, creation desc", limit_page_length=cint(limit))
	se = frappe.get_list("Stock Entry", filters={"docstatus": 1, "stock_entry_type": ["in", ["Material Issue", "Material Receipt"]]}, fields=["name", "posting_date", "mimaar_issued_to", "mimaar_work_area", "stock_entry_type", "mimaar_is_return", "mimaar_identity_check"], order_by="posting_date desc, creation desc", limit_page_length=cint(limit))
	out = []
	for r in pr:
		items = frappe.get_all("Purchase Receipt Item", filters={"parent": r.name}, fields=["item_name", "qty", "uom"], order_by="idx")
		out.append({"kind": "in", "name": r.name, "date": r.posting_date, "who": r.supplier_name, "ref": r.supplier_delivery_note, "items": items})
	for s in se:
		if s.stock_entry_type == "Material Receipt" and not s.mimaar_is_return:
			continue
		items = frappe.get_all("Stock Entry Detail", filters={"parent": s.name}, fields=["item_name", "qty", "uom"], order_by="idx")
		out.append({"kind": "back" if s.stock_entry_type == "Material Receipt" else "out", "name": s.name, "date": s.posting_date, "who": s.mimaar_issued_to, "ref": s.mimaar_work_area, "items": items, "face": bool(s.mimaar_identity_check)})
	out.sort(key=lambda x: (str(x["date"]), x["name"]), reverse=True)
	return out[: cint(limit)]


# ---------------------------------------------------------------- attendance and workers
def _hhmm(t):
	p = cstr(t).split(":")
	return f"{int(p[0]):02d}:{p[1]}" if len(p) >= 2 and p[0].isdigit() else ""


@frappe.whitelist()
def attendance_today():
	_need("people")
	name = frappe.db.get_value("Site Attendance", {"date": nowdate(), "project": _project(), "docstatus": ["<", 2]})
	if not name:
		return None
	d = frappe.get_doc("Site Attendance", name)
	d.check_permission("read")
	return {
		"name": d.name, "docstatus": d.docstatus, "date": d.date, "location": d.location, "group_photo": d.group_photo, "present": d.present, "half_day": d.half_day,
		"rows": [{"worker": r.worker, "worker_name": r.worker_name, "trade": r.trade, "status": r.status, "time_in": _hhmm(r.time_in), "time_out": _hhmm(r.time_out),
			"photo": r.photo, "scanned": r.scanned, "identity_check": r.identity_check, "face": frappe.db.get_value("Identity Check", r.identity_check, "result") if r.identity_check else None,
			"worker_photo": frappe.db.get_value("Site Worker", r.worker, "photo")} for r in d.rows],
	}


@frappe.whitelist()
def attendance_save(rows, group_photo=None, location=None, submit=0):
	_need("people")
	rows = [r for r in _parse(rows) or [] if r.get("worker")]
	name = frappe.db.get_value("Site Attendance", {"date": nowdate(), "project": _project(), "docstatus": 0})
	if frappe.db.exists("Site Attendance", {"date": nowdate(), "project": _project(), "docstatus": 1}):
		frappe.throw(_("Today's attendance is already submitted."))
	doc = frappe.get_doc("Site Attendance", name) if name else frappe.new_doc("Site Attendance")
	doc.date = nowdate()
	doc.project = _project()
	if _photo_ok(group_photo):
		doc.group_photo = group_photo
	if location:
		doc.location = location
	keep = {r.worker: r for r in doc.rows}  # what the card scans recorded stays as it was
	doc.set("rows", [])
	for r in rows:
		old = keep.get(r["worker"])
		doc.append("rows", {"worker": r["worker"], "status": r.get("status") or "Present", "time_in": (old and old.time_in) or r.get("time_in") or nowtime(),
			"time_out": (old and old.time_out) or r.get("time_out") or None, "photo": (old and old.photo) or (r.get("photo") if _photo_ok(r.get("photo")) else None),
			"scanned": (old and old.scanned) or cint(r.get("scanned")), "identity_check": old and old.identity_check})
	doc.save()
	if cint(submit):
		doc.submit()
	return {"name": doc.name, "docstatus": doc.docstatus}


@frappe.whitelist()
def attendance_card(check, mode="in"):
	"""Attendance by site card: the card was scanned and the face checked; mark time in or time out."""
	_need("people")
	from mimaar.identity import use_check

	idc = frappe.get_doc("Identity Check", check)
	done = frappe.db.get_value("Site Attendance", {"date": nowdate(), "project": _project(), "docstatus": 1})
	if done:
		# the day's list is submitted in the morning; people still leave in the evening: time out only
		if mode != "out":
			frappe.throw(_("Today's attendance is already submitted. Only time out can be marked now."))
		row = frappe.db.get_value("Site Attendance Row", {"parent": done, "parenttype": "Site Attendance", "worker": idc.person}, ["name", "time_in", "time_out"], as_dict=True)
		if not row or not row.time_in:
			frappe.throw(_("{0} has no time in today.").format(idc.person_name))
		now = nowtime()
		frappe.db.set_value("Site Attendance Row", row.name, "time_out", now)
		use_check(idc.name, "Attendance", "Site Attendance", done, idc.person)
		return {"name": done, "worker": idc.person, "full_name": idc.person_name, "mode": mode, "time": _hhmm(now)}
	name = frappe.db.get_value("Site Attendance", {"date": nowdate(), "project": _project(), "docstatus": 0})
	doc = frappe.get_doc("Site Attendance", name) if name else frappe.new_doc("Site Attendance")
	doc.date, doc.project = nowdate(), _project()
	row = next((r for r in doc.rows if r.worker == idc.person), None)
	now = nowtime()
	if mode == "out":
		if not row or not row.time_in:
			frappe.throw(_("{0} has no time in today.").format(idc.person_name))
		row.time_out = now
	else:
		if row and row.time_in and not row.time_out:
			frappe.throw(_("{0} is already marked in at {1}.").format(idc.person_name, _hhmm(row.time_in)))
		if not row:
			row = doc.append("rows", {"worker": idc.person, "status": "Present"})
		row.time_in, row.time_out, row.status = row.time_in or now, None if not row.time_out else row.time_out, row.status or "Present"
	row.scanned = cint(idc.card_scanned)
	row.photo = idc.live_photo
	row.identity_check = idc.name
	doc.save()
	use_check(idc.name, "Attendance", "Site Attendance", doc.name, idc.person)
	return {"name": doc.name, "worker": idc.person, "full_name": idc.person_name, "mode": mode, "time": _hhmm(now)}


# ---------------------------------------------------------------- people and access
PERSON_FIELDS = ("full_name", "full_name_ur", "father_name", "father_name_ur", "worker_type", "trade", "contractor", "gang", "status", "phone", "joined_on",
	"cnic", "cnic_expiry", "entry_card_no", "entry_card_expiry", "police_verification", "address", "address_ur", "emergency_contact", "notes")
PERSON_DOCS = ("photo", "cnic_front", "cnic_back", "entry_card_photo", "police_document")


def _on_site_today():
	name = frappe.db.get_value("Site Attendance", {"date": nowdate(), "project": _project(), "docstatus": ["<", 2]})
	if not name:
		return {}
	return {r.worker: r for r in frappe.get_all("Site Attendance Row", filters={"parent": name}, fields=["worker", "status", "time_in", "time_out"])}


@frappe.whitelist()
def workers(q=None, status="Active"):
	"""The people register (for pickers and the People screen)."""
	_need("people")
	f = {"status": status} if status else {}
	of = {"full_name": ["like", f"%{q}%"], "full_name_ur": ["like", f"%{q}%"], "cnic": ["like", f"%{q}%"], "name": ["like", f"%{q}%"], "phone": ["like", f"%{q}%"], "entry_card_no": ["like", f"%{q}%"]} if q else None
	fields = ["name", "full_name", "full_name_ur", "father_name", "worker_type", "trade", "contractor", "gang", "status", "photo", "phone", "cnic", "cnic_expiry",
		"entry_card_no", "entry_card_expiry", "police_verification", "app_access", "store_keeper", "user"]
	if caps()["money"]:
		fields.append("daily_wage")
	rows = frappe.get_list("Site Worker", filters=f, or_filters=of, fields=fields, order_by="full_name asc", limit_page_length=1000)
	here = _on_site_today()
	for r in rows:
		a = here.get(r.name)
		r.on_site = bool(a and a.status != "Absent" and a.time_in and not a.time_out)
		r.contractor_name = frappe.db.get_value("Supplier", r.contractor, "supplier_name") if r.contractor else None
	return rows


@frappe.whitelist()
def person(name):
	_need("people")
	d = frappe.get_doc("Site Worker", name)
	d.check_permission("read")
	out = {k: d.get(k) for k in ("name",) + PERSON_FIELDS + PERSON_DOCS + ("app_access", "store_keeper", "user", "verified_by", "verified_on", "modified")}
	if caps()["money"]:
		out["daily_wage"] = d.daily_wage
	out["warnings"] = d.warnings()
	out["contractor_name"] = frappe.db.get_value("Supplier", d.contractor, "supplier_name") if d.contractor else None
	if caps()["owner"]:
		from mimaar.identity import card_info

		out["card"] = card_info(d.name)
	out["checks"] = frappe.get_all("Identity Check", filters={"person": d.name}, fields=["name", "action", "result", "score", "checked_at", "live_photo"], order_by="creation desc", limit=10) \
		if (caps()["owner"] or caps()["money"] or "Site Supervisor" in _roles()) else []
	out["days"] = frappe.db.count("Site Attendance Row", {"worker": d.name, "status": ["!=", "Absent"], "docstatus": 1})
	return out


@frappe.whitelist()
def worker_save(data):
	"""Add or update a person, with their documents (any staff with the People screen); access only by the owner."""
	_need("people")
	d = _parse(data) or {}
	doc = frappe.get_doc("Site Worker", d["name"]) if d.get("name") else frappe.new_doc("Site Worker")
	for k in PERSON_FIELDS:
		if k in d:
			doc.set(k, d[k] if d[k] != "" else None)
	for k in PERSON_DOCS:
		if _photo_ok(d.get(k)):
			doc.set(k, d[k])
	c = caps()
	if c["money"] and "daily_wage" in d:
		doc.daily_wage = flt(d["daily_wage"]) or None
	if c["owner"]:
		if d.get("app_access"):
			doc.app_access = d["app_access"]
		if "store_keeper" in d:
			doc.store_keeper = cint(d["store_keeper"])
	doc.save()
	return {"name": doc.name, "warnings": doc.warnings()}


@frappe.whitelist()
def people_summary():
	_need("people")
	here = _on_site_today()
	return {"total": frappe.db.count("Site Worker", {"status": "Active"}), "on_site": sum(1 for a in here.values() if a.status != "Absent" and a.time_in and not a.time_out),
		"marked": len(here)}


# ---------------------------------------------------------------- suppliers
@frappe.whitelist()
def suppliers(q=None):
	_need("suppliers")
	of = {"supplier_name": ["like", f"%{q}%"], "name": ["like", f"%{q}%"]} if q else None
	rows = frappe.get_list("Supplier", filters={"disabled": 0}, or_filters=of, fields=["name", "supplier_name", "supplier_group", "mimaar_work_area", "mobile_no"], order_by="supplier_name asc", limit_page_length=500)
	if caps()["money"]:
		due = dict(frappe.db.sql("select supplier, sum(outstanding_amount) from `tabPurchase Invoice` where docstatus = 1 group by supplier"))
		for r in rows:
			r.due = flt(due.get(r.name))
	return rows


@frappe.whitelist()
def supplier(name):
	_need("suppliers")
	from mimaar.api import _phone, statement_rows

	s = frappe.get_doc("Supplier", name)
	s.check_permission("read")
	out = {"name": s.name, "supplier_name": s.supplier_name, "work_area": s.get("mimaar_work_area"), "phone": _phone(s.name), "payment_terms": s.get("mimaar_payment_terms"), "delivery_time": s.get("mimaar_delivery_time")}
	if caps()["money"] or caps()["buy"]:
		st = statement_rows(s.name)
		out["summary"] = {k: st.get(k) for k in ("ordered", "received", "billed", "paid", "balance", "due", "advance") if k in st}
		out["rows"] = (st.get("rows") or [])[-30:]
	out["quotes"] = frappe.get_list("Supplier Quotation", filters={"supplier": s.name, "docstatus": ["<", 2]}, fields=["name", "transaction_date", "grand_total", "docstatus", "mimaar_final"], order_by="creation desc", limit_page_length=10)
	out["orders"] = frappe.get_list("Purchase Order", filters={"supplier": s.name, "docstatus": ["<", 2]}, fields=["name", "transaction_date", "grand_total", "status", "per_received"], order_by="creation desc", limit_page_length=10)
	return out


@frappe.whitelist()
def supplier_new(data):
	from mimaar.api import register_supplier

	d = _parse(data) or {}
	return register_supplier(d.get("name"), phone=d.get("phone"), contact=d.get("contact"), email=d.get("email"), address=d.get("address"), ntn=d.get("ntn"), work_area=d.get("work_area"), payment_terms=d.get("payment_terms"), delivery_time=d.get("delivery_time"))


# ---------------------------------------------------------------- quotations
def _q_state(q):
	if q.docstatus == 0:
		return "Draft"
	if q.docstatus == 2:
		return "Replaced" if frappe.db.exists("Supplier Quotation", {"amended_from": q.name}) else "Cancelled"
	return "Final" if cint(q.mimaar_final) else "Confirmed"


@frappe.whitelist()
def quotations(state=None):
	_need("buy")
	rows = frappe.get_list("Supplier Quotation", filters={"docstatus": ["<", 2]}, fields=["name", "supplier", "supplier_name", "transaction_date", "grand_total", "docstatus", "mimaar_final", "mimaar_revision", "quotation_number"], order_by="creation desc", limit_page_length=200)
	for r in rows:
		r.state = _q_state(r)
		r.has_po = bool(frappe.db.exists("Purchase Order Item", {"supplier_quotation": r.name, "docstatus": ["<", 2]}))
	return [r for r in rows if not state or r.state == state]


@frappe.whitelist()
def quotation(name):
	_need("buy")
	q = frappe.get_doc("Supplier Quotation", name)
	q.check_permission("read")
	po = frappe.db.get_value("Purchase Order Item", {"supplier_quotation": q.name, "docstatus": ["<", 2]}, "parent")
	return {
		"name": q.name, "state": _q_state(q), "docstatus": q.docstatus, "supplier": q.supplier, "supplier_name": q.supplier_name,
		"date": q.transaction_date, "valid_till": q.valid_till, "number": q.quotation_number, "revision": q.mimaar_revision, "revision_note": q.mimaar_revision_note,
		"amended_from": q.amended_from, "final_on": q.mimaar_final_on, "document": q.mimaar_document,
		"payment_terms": q.mimaar_payment_terms, "advance_percent": q.mimaar_advance_percent, "delivery_time": q.mimaar_delivery_time,
		"total": q.total, "discount": q.discount_amount, "taxes": q.total_taxes_and_charges, "grand_total": q.grand_total, "po": po,
		"lines": [{"name": r.name, "item_code": r.item_code, "item_name": r.item_name, "uom": r.uom, "qty": r.qty, "rate": r.rate, "amount": r.amount, "discount_percentage": r.discount_percentage} for r in q.items],
	}


@frappe.whitelist()
def quotation_read(file_url):
	"""AI reads a scanned quotation. The person checks the lines before anything is saved."""
	_need("buy")
	from mimaar.ai import read_quotation

	d = read_quotation(file_url)
	d["file_url"] = file_url
	for x in d.get("lines") or []:
		if x.get("item_code"):
			x["item_name"], x["stock_uom"] = frappe.db.get_value("Item", x["item_code"], ["item_name", "stock_uom"]) or ("", "")
			x["uom"] = x.get("uom") if x.get("uom") and frappe.db.exists("UOM", x["uom"]) else x["stock_uom"]
	if d.get("supplier"):
		d["supplier_name"] = frappe.db.get_value("Supplier", d["supplier"], "supplier_name")
	return d


@frappe.whitelist()
def item_search(q=None, limit=20):
	of = {"item_name": ["like", f"%{q}%"], "name": ["like", f"%{q}%"]} if q else None
	return frappe.get_list("Item", filters={"disabled": 0}, or_filters=of, fields=["name", "item_name", "stock_uom"], order_by="item_name asc", limit_page_length=cint(limit))


@frappe.whitelist()
def quotation_save(data):
	"""Create a draft quotation (from a scan or typed), or update a draft's lines and terms."""
	_need("buy")
	from mimaar.api import new_item

	d = _parse(data) or {}
	if d.get("name"):
		q = frappe.get_doc("Supplier Quotation", d["name"])
		if q.docstatus != 0:
			frappe.throw(_("Only a draft quotation can be changed. Revise it to make a new version."))
	else:
		q = frappe.new_doc("Supplier Quotation")
		q.company = _company()
	supplier = d.get("supplier")
	if not supplier and d.get("new_supplier"):
		_need("new_supplier")
		supplier = supplier_new(d["new_supplier"])
	if supplier:
		q.supplier = supplier
	for k, f in (("number", "quotation_number"), ("date", "transaction_date"), ("valid_till", "valid_till"), ("payment_terms", "mimaar_payment_terms"),
		("advance_percent", "mimaar_advance_percent"), ("delivery_time", "mimaar_delivery_time"), ("revision_note", "mimaar_revision_note"), ("terms", "terms")):
		if d.get(k) not in (None, ""):
			q.set(f, d[k])
	if _photo_ok(d.get("document")):
		q.mimaar_document = d["document"]
	if "lines" in d:
		q.set("items", [])
		for x in d["lines"]:
			code = x.get("item_code")
			if not code and x.get("new_item"):
				_need("new_item")
				code = new_item(x["new_item"], uom=x.get("uom") or "Nos")
			if not code:
				frappe.throw(_("Line {0}: choose the item, or add it as a new item.").format(x.get("text") or ""))
			row = {"item_code": code, "qty": flt(x.get("qty")) or 1, "rate": flt(x.get("rate")), "discount_percentage": flt(x.get("discount_percentage")), "warehouse": _store()}
			if x.get("uom") and frappe.db.exists("UOM", x["uom"]):
				row["uom"] = x["uom"]
			q.append("items", row)
	if d.get("discount_amount"):
		q.apply_discount_on = "Net Total"
		q.discount_amount = flt(d["discount_amount"])
	q.save() if q.name and not q.is_new() else q.insert()
	return q.name


@frappe.whitelist()
def quotation_confirm(name):
	_need("buy")
	q = frappe.get_doc("Supplier Quotation", name)
	q.submit()
	return _q_state(q)


@frappe.whitelist()
def quotation_lock(name):
	_need("buy")
	from mimaar.procurement import mark_final

	mark_final(name)
	return "Final"


@frappe.whitelist()
def quotation_revise(name, note):
	"""A confirmed quotation can't change: the change is a new revision (the old one is kept)."""
	_need("buy")
	q = frappe.get_doc("Supplier Quotation", name)
	if not (note or "").strip():
		frappe.throw(_("Write what changed in this revision (price, discount or items)."))
	q.cancel()
	new = frappe.copy_doc(q)
	new.amended_from = q.name
	new.docstatus = 0
	new.mimaar_revision_note = note
	new.insert()
	return new.name


# ---------------------------------------------------------------- purchase orders
@frappe.whitelist()
def orders(state=None):
	_need("buy") if not caps()["money"] else None
	rows = frappe.get_list("Purchase Order", filters={"docstatus": ["<", 2]}, fields=["name", "supplier", "supplier_name", "transaction_date", "schedule_date", "grand_total", "status", "per_received", "per_billed", "docstatus", "advance_paid", "mimaar_advance_percent"], order_by="creation desc", limit_page_length=200)
	return [r for r in rows if not state or r.status == state]


@frappe.whitelist()
def order(name):
	from mimaar.procurement import advance_limit

	po = frappe.get_doc("Purchase Order", name)
	po.check_permission("read")
	show_rates = caps()["buy"] or caps()["money"]
	limit = advance_limit(po) if po.docstatus == 1 else 0
	return {
		"name": po.name, "docstatus": po.docstatus, "status": po.status, "supplier": po.supplier, "supplier_name": po.supplier_name,
		"date": po.transaction_date, "schedule_date": po.schedule_date, "per_received": po.per_received, "per_billed": po.per_billed,
		"grand_total": po.grand_total if show_rates else None, "payment_terms": po.get("mimaar_payment_terms"), "advance_percent": po.get("mimaar_advance_percent"),
		"delivery_time": po.get("mimaar_delivery_time"), "advance_limit": limit, "advance_paid": po.advance_paid, "advance_left": max(0, limit - flt(po.advance_paid)),
		"quotation": po.items[0].supplier_quotation if po.items else None,
		"lines": [{"item_name": r.item_name, "item_code": r.item_code, "uom": r.uom, "qty": r.qty, "received": r.received_qty, "rate": r.rate if show_rates else None, "amount": r.amount if show_rates else None} for r in po.items],
	}


@frappe.whitelist()
def order_from_quotation(quotation, schedule_date=None):
	_need("buy")
	from erpnext.buying.doctype.supplier_quotation.supplier_quotation import make_purchase_order

	po = make_purchase_order(quotation)
	sd = schedule_date or add_days(nowdate(), 7)
	po.schedule_date = sd
	for r in po.items:
		r.schedule_date = r.schedule_date or sd
		r.warehouse = r.warehouse or _store()
	po.set_warehouse = po.set_warehouse or _store()
	po.insert()
	return po.name


@frappe.whitelist()
def order_lock(name):
	_need("buy")
	po = frappe.get_doc("Purchase Order", name)
	po.submit()
	return po.status


@frappe.whitelist()
def share(doctype, name):
	if doctype not in ("Purchase Order", "Request for Quotation", "Supplier Quotation"):
		frappe.throw(_("This can't be shared."))
	from mimaar.api import share_link

	return share_link(doctype, name)


@frappe.whitelist()
def statement_share(supplier):
	from mimaar.api import supplier_statement_pdf

	return supplier_statement_pdf(supplier, share=1)


# ---------------------------------------------------------------- bills and payments
@frappe.whitelist()
def bills():
	_need("money")
	open_ = frappe.get_list("Purchase Invoice", filters={"docstatus": 1, "outstanding_amount": [">", 0]}, fields=["name", "supplier", "supplier_name", "bill_no", "posting_date", "due_date", "grand_total", "outstanding_amount"], order_by="due_date asc", limit_page_length=200)
	today = getdate(nowdate())
	for b in open_:
		b.due_now = not b.due_date or getdate(b.due_date) <= today
	to_bill = frappe.get_list("Purchase Receipt", filters={"docstatus": 1, "status": "To Bill"}, fields=["name", "supplier", "supplier_name", "posting_date", "grand_total", "supplier_delivery_note"], order_by="posting_date asc", limit_page_length=200)
	advances = []
	from mimaar.procurement import advance_limit

	for p in frappe.get_list("Purchase Order", filters={"docstatus": 1, "status": ["not in", ["Closed", "Completed"]], "mimaar_advance_percent": [">", 0]}, fields=["name"], limit_page_length=100):
		po = frappe.get_doc("Purchase Order", p.name)
		left = advance_limit(po) - flt(po.advance_paid)
		if left > 1:
			advances.append({"name": po.name, "supplier": po.supplier, "supplier_name": po.supplier_name, "left": left, "percent": po.mimaar_advance_percent, "grand_total": po.grand_total})
	paid = frappe.get_list("Payment Entry", filters={"docstatus": 1, "payment_type": "Pay", "party_type": "Supplier"}, fields=["name", "party_name", "posting_date", "paid_amount", "mode_of_payment", "reference_no"], order_by="posting_date desc, creation desc", limit_page_length=30)
	return {"open": open_, "to_bill": to_bill, "advances": advances, "paid": paid}


@frappe.whitelist()
def bill_from_receipt(receipt, bill_no, bill_date=None, bill_scan=None, due_date=None):
	_need("money")
	from erpnext.stock.doctype.purchase_receipt.purchase_receipt import make_purchase_invoice

	pi = make_purchase_invoice(receipt)
	pi.bill_no = (bill_no or "").strip()
	pi.bill_date = bill_date or nowdate()
	if due_date:
		pi.due_date = due_date
	pi.mimaar_bill_scan = bill_scan if _photo_ok(bill_scan) else None
	pi.insert()
	try:
		pi.submit()
	except Exception:
		frappe.db.rollback()
		raise
	return {"name": pi.name, "outstanding": pi.outstanding_amount}


def _bank_account(mode):
	co = _company()
	if mode == "Cash":
		return frappe.db.get_value("Company", co, "default_cash_account")
	acc = frappe.db.get_value("Company", co, "default_bank_account")
	if not acc:
		frappe.throw(_("No bank account is set up. Pay in cash, or ask the owner to add the bank account in ERPNext."))
	return acc


@frappe.whitelist()
def pay(doctype, name, amount, mode="Cash", reference_no=None, reference_date=None, proof=None, proof_2=None):
	"""Pay a supplier: a bill that is due, or the agreed advance on a purchase order."""
	_need("money")
	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

	if doctype not in ("Purchase Invoice", "Purchase Order"):
		frappe.throw(_("Pay only against a bill or a purchase order advance."))
	pe = get_payment_entry(doctype, name, party_amount=flt(amount))
	modes = {"Cash": "Cash", "Bank": "Wire Transfer", "Cheque": "Cheque"}
	pe.mode_of_payment = modes.get(mode, "Cash")
	acc = _bank_account("Cash" if mode == "Cash" else "Bank")
	if acc and pe.paid_from != acc:
		pe.paid_from = acc
		pe.paid_from_account_currency = frappe.db.get_value("Account", acc, "account_currency")
	pe.reference_no = (reference_no or "").strip() or (None if mode == "Cash" else None)
	pe.reference_date = reference_date or nowdate()
	if mode != "Cash" and not pe.reference_no:
		frappe.throw(_("Enter the transaction or cheque number."))
	pe.mimaar_proof = proof if _photo_ok(proof) else None
	pe.mimaar_proof_2 = proof_2 if _photo_ok(proof_2) else None
	pe.insert()
	try:
		pe.submit()
	except Exception:
		frappe.db.rollback()
		raise
	return pe.name


# ---------------------------------------------------------------- budget
@frappe.whitelist()
def budget():
	"""Each budget line against what is ordered (locked purchase orders) and billed so far."""
	_need("money")
	co = _company()
	rows = frappe.db.sql(
		"""select account, sum(budget_amount) budget from `tabBudget` where docstatus = 1 and company = %(co)s
		group by account order by account""",
		{"co": co},
		as_dict=True,
	)
	ordered = dict(frappe.db.sql(
		"""select i.expense_account, sum(i.base_net_amount) from `tabPurchase Order Item` i join `tabPurchase Order` p on p.name = i.parent
		where p.docstatus = 1 and p.company = %(co)s and p.status != 'Closed' group by i.expense_account""",
		{"co": co},
	))
	billed = dict(frappe.db.sql(
		"""select coalesce(poi.expense_account, i.expense_account) acc, sum(i.base_net_amount) from `tabPurchase Invoice Item` i
		join `tabPurchase Invoice` p on p.name = i.parent left join `tabPurchase Order Item` poi on poi.name = i.po_detail
		where p.docstatus = 1 and p.company = %(co)s group by acc""",
		{"co": co},
	))
	for r in rows:
		r.name = frappe.db.get_value("Account", r.account, "account_name")
		r.actual = flt(billed.get(r.account))
		r.ordered = flt(ordered.get(r.account))
	return rows


# ---------------------------------------------------------------- search everything
@frappe.whitelist()
def search(q):
	"""One search box for workers, suppliers, store items, purchase orders and quotations."""
	q = (q or "").strip()
	if len(q) < 2:
		return {}
	c, like, out = caps(), f"%{q}%", {}
	if c["people"]:
		out["workers"] = frappe.get_list("Site Worker", or_filters={"full_name": ["like", like], "cnic": ["like", like], "name": ["like", like], "entry_card_no": ["like", like]}, fields=["name", "full_name", "trade", "photo"], limit_page_length=8)
	if c["suppliers"]:
		out["suppliers"] = frappe.get_list("Supplier", filters={"disabled": 0}, or_filters={"supplier_name": ["like", like], "name": ["like", like], "mobile_no": ["like", like]}, fields=["name", "supplier_name", "mimaar_work_area"], limit_page_length=8)
	if c["store"] or c["site"]:
		rows = stock(q)["rows"]
		out["items"] = (sorted(rows, key=lambda r: -flt(r.qty)))[:8]
	if c["buy"] or c["money"]:
		out["orders"] = frappe.get_list("Purchase Order", filters={"docstatus": ["<", 2]}, or_filters={"name": ["like", like], "supplier_name": ["like", like]}, fields=["name", "supplier_name"], order_by="creation desc", limit_page_length=8)
	if c["buy"]:
		out["quotes"] = frappe.get_list("Supplier Quotation", filters={"docstatus": ["<", 2]}, or_filters={"name": ["like", like], "supplier_name": ["like", like], "quotation_number": ["like", like]}, fields=["name", "supplier_name"], order_by="creation desc", limit_page_length=8)
	return out


# ---------------------------------------------------------------- connecting a phone (laptop test set-up)
@frappe.whitelist(allow_guest=True)
def qr(text):
	"""QR code image for the 'connect a phone' page."""
	from mimaar.api import qr_code

	if len(text or "") > 300:
		frappe.throw("Too long")
	return qr_code(text)
