"""Water on site: the tanks, their daily level, and the tankers that fill them.

Water is kept as stock (item WATER, in gallons, in the water store set in Buildiary Settings):
- a tanker adds water: Stock Entry (Material Receipt) at the tanker's cost;
- each level reading turns the tanks' levels into gallons; when the tanks hold less than the
  books, the difference is booked as used (Stock Entry, Material Issue to the project).
The tanker's cost is booked to the "Water tanker" budget line (the same line petty cash uses),
so the cost of the water shows against the budget as it is used.
"""

import json

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, get_first_day, getdate, nowdate, nowtime

from buildiary.field import _company, _hhmm, _need, _only, _parse, _photo_ok, _project, _psql, _settings, caps, money_text

ITEM = "WATER"
REJECTED = "Brackish (rejected)"


# ---------------------------------------------------------------- helpers
def _can():
	c = caps()
	if c.get("partner") or not (c["site"] or c["store"]):
		frappe.throw(_("You don't have access to this. Ask the owner."), frappe.PermissionError)
	return c


def _wh():
	wh = _settings().water_warehouse
	if not wh:
		from buildiary.setup import water_setup

		water_setup()
		frappe.clear_document_cache("Buildiary Settings", "Buildiary Settings")
		wh = frappe.db.get_single_value("Buildiary Settings", "water_warehouse")
	return wh


def _tds_limit():
	return cint(_settings().tds_limit) or 1000


def water_account():
	"""The budget line water is booked to (the petty cash category "Water tanker"), if there is one."""
	return frappe.db.get_value("Petty Cash Category", {"category_name": "Water tanker"}, "expense_account")


def _tanks(active=True):
	return frappe.get_all("Water Tank", filters=_only({"is_active": 1} if active else {}), fields=["name", "tank_name", "kind", "capacity_gallons", "sort_order"],
		order_by="sort_order asc, tank_name asc")


def _level_tanks():
	return [t for t in _tanks() if t.kind != "Direct use" and flt(t.capacity_gallons) > 0]


def _latest(tank):
	return frappe.db.get_value("Water Tank Reading", {"tank": tank}, ["name", "date", "time", "level_pct", "gallons", "ai_level_pct", "ai_verdict", "ai_clarity", "photo"],
		order_by="date desc, time desc, creation desc", as_dict=True)


def in_tanks():
	"""Gallons in the tanks now (each tank's latest reading), and the tanks never read yet."""
	total, missing = 0.0, []
	for t in _level_tanks():
		r = _latest(t.name)
		if r:
			total += flt(r.level_pct) * flt(t.capacity_gallons) / 100
		else:
			missing.append(t.tank_name)
	return total, missing


def in_books():
	return flt(frappe.db.get_value("Bin", {"item_code": ITEM, "warehouse": _wh()}, "actual_qty"))


def _stock_entry(kind, gallons, ref, rate=0, remarks=None, project=None):
	wh = _wh()
	row = {"item_code": ITEM, "qty": flt(gallons, 2)}
	acc = water_account()
	if acc:
		row["expense_account"] = acc
	if kind == "in":
		row.update({"t_warehouse": wh, "basic_rate": flt(rate), "allow_zero_valuation_rate": 0 if flt(rate) else 1})
		d = {"stock_entry_type": "Material Receipt", "to_warehouse": wh}
	else:
		row.update({"s_warehouse": wh})
		d = {"stock_entry_type": "Material Issue", "from_warehouse": wh, "buildiary_issued_to": _("Site work (water used)")}
	se = frappe.get_doc(dict(d, doctype="Stock Entry", company=_company(), project=project or _project(), remarks=remarks, buildiary_water_ref=ref, items=[row]))
	se.flags.ignore_permissions = True
	se.insert()
	se.submit()
	return se.name


def cancel_entries(ref):
	for n in frappe.get_all("Stock Entry", filters={"buildiary_water_ref": ref, "docstatus": 1}, pluck="name", order_by="creation desc"):
		se = frappe.get_doc("Stock Entry", n)
		se.flags.ignore_permissions = True
		se.cancel()


# ---------------------------------------------------------------- document events (called by the controllers)
def tanker_submitted(doc):
	"""A tanker emptied on site: the water goes into the books (rejected water does not)."""
	if doc.water_type == REJECTED:
		return
	rate = flt(doc.cost) / flt(doc.gallons) if flt(doc.cost) and flt(doc.gallons) else 0
	name = _stock_entry("in", doc.gallons, doc.name, rate, _("Water tanker {0} ({1} gallons)").format(doc.vehicle_no, flt(doc.gallons)), doc.project)
	doc.db_set("stock_entry", name)
	if doc.emptied_into and frappe.db.get_value("Water Tank", doc.emptied_into, "kind") == "Direct use":
		_stock_entry("out", doc.gallons, doc.name, remarks=_("Used straight from tanker {0}").format(doc.vehicle_no), project=doc.project)


def tanker_cancelled(doc):
	if doc.stock_entry and doc.water_type != REJECTED and in_books() + 0.01 < flt(doc.gallons):
		frappe.throw(_("This tanker's water has already been counted as used by later tank readings, so it can't be cancelled here. "
			"Correct the water stock in the ERP (Stock Reconciliation)."), title=_("Water already used"))
	cancel_entries(doc.name)
	if doc.petty_cash_entry:
		pc = frappe.get_doc("Petty Cash Entry", doc.petty_cash_entry)
		if pc.docstatus == 0:
			pc.flags.ignore_permissions = True
			pc.delete()
		elif pc.docstatus == 1:
			pc.flags.ignore_permissions = True
			pc.cancel()


def book_usage(reading):
	"""After a level reading: water the tanks no longer hold has been used. Returns (used, warning)."""
	have, missing = in_tanks()
	if missing:
		return 0, _("Read the level of every tank once ({0}) to work out the water used.").format(", ".join(missing))
	books = in_books()
	cap = sum(flt(t.capacity_gallons) for t in _level_tanks()) or 1
	diff = books - have
	if diff > max(1, cap * 0.005):
		name = _stock_entry("out", diff, reading, remarks=_("Water used (tank levels, {0})").format(reading))
		frappe.db.set_value("Water Tank Reading", reading, "stock_entry", name, update_modified=False)
		return diff, None
	if -diff > cap * 0.05:
		return 0, _("The tanks hold about {0} gallons more than the tankers recorded. Was a tanker not entered?").format(frappe.format(-diff, {"fieldtype": "Float", "precision": 0}))
	return 0, None


# ---------------------------------------------------------------- the water screen
@frappe.whitelist()
def overview():
	c = _can()
	money = c["money"]
	tanks = []
	for t in _tanks():
		r = _latest(t.name) if t.kind != "Direct use" else None
		tanks.append({
			"name": t.name, "kind": t.kind, "capacity": flt(t.capacity_gallons),
			"level": flt(r.level_pct) if r else None, "gallons": flt(r.level_pct) * flt(t.capacity_gallons) / 100 if r else None,
			"date": r.date if r else None, "time": _hhmm(r.time) if r else "", "ai_level": r.ai_level_pct if r and r.ai_verdict not in (None, "", "Not checked") else None,
			"ai_verdict": r.ai_verdict if r else None, "photo": r.photo if r else None,
		})
	today = getdate(nowdate())
	week0, month0 = add_days(today, -today.weekday()), get_first_day(today)
	rows = frappe.get_all("Water Tanker", filters=_only({"docstatus": 1, "date": [">=", add_days(today, -120)]}),
		fields=["name", "date", "time", "vehicle_no", "supplier_text", "gallons", "water_type", "tds_ppm", "cost", "emptied_into", "received_by_name", "tanker_photo",
			"tds_photo", "bill_scan", "ai_verdict", "ai_summary", "identity_check", "bill_no"],
		order_by="date desc, time desc, creation desc", limit_page_length=500)
	limit = _tds_limit()

	def span(d0):
		x = [r for r in rows if getdate(r.date) >= d0 and r.water_type != REJECTED]
		return {"count": len(x), "gallons": sum(flt(r.gallons) for r in x), "cost": sum(flt(r.cost) for r in x) if money else None}

	bad = [r for r in rows if r.water_type == REJECTED or cint(r.tds_ppm) > limit]
	used = frappe.db.sql(
		f"""select se.posting_date d, sum(sed.transfer_qty) q from `tabStock Entry Detail` sed join `tabStock Entry` se on se.name = sed.parent
		where se.docstatus = 1 and se.stock_entry_type = 'Material Issue' and sed.item_code = %(item)s and se.posting_date >= %(d)s{_psql('se')}
		group by se.posting_date order by se.posting_date""",
		{"item": ITEM, "d": add_days(today, -13)}, as_dict=True)
	got = frappe.db.sql(
		f"""select date d, sum(gallons) q from `tabWater Tanker` where docstatus = 1 and water_type != %(rej)s and date >= %(d)s{_psql()} group by date""",
		{"rej": REJECTED, "d": add_days(today, -13)}, as_dict=True)
	u, g = {str(x.d): flt(x.q) for x in used}, {str(x.d): flt(x.q) for x in got}
	days = [str(add_days(today, -i)) for i in range(13, -1, -1)]
	have, missing = in_tanks()
	readings = frappe.get_all("Water Tank Reading", filters=_only(), fields=["name", "date", "time", "tank", "level_pct", "gallons", "ai_level_pct", "ai_verdict", "ai_clarity", "ai_summary", "photo", "notes"],
		order_by="date desc, time desc, creation desc", limit_page_length=40)
	for r in readings + rows:
		r.time = _hhmm(r.time)
	for r in readings:
		if r.ai_verdict in (None, "", "Not checked"):
			r.ai_level_pct = None
	if not money:
		for r in rows:
			r.cost = None
	return {
		"tanks": tanks, "today": span(today), "week": span(week0), "month": span(month0), "bad": len(bad), "tds_limit": limit,
		"tankers": rows[:60], "readings": readings, "days": days, "used": [u.get(d, 0) for d in days], "received": [g.get(d, 0) for d in days],
		"in_tanks": have, "in_books": in_books(), "missing": missing, "money": money, "owner": c["owner"],
		"read_today": [t["name"] for t in tanks if t["date"] and str(t["date"]) == str(today)],
	}


# ---------------------------------------------------------------- entries
@frappe.whitelist()
def reading_save(tank, level_pct, photo=None, notes=None, location=None):
	"""The level of a tank (% full), with a photo inside the tank; the AI estimates the level from the photo."""
	_can()
	t = frappe.get_doc("Water Tank", tank)
	if t.kind == "Direct use":
		frappe.throw(_("{0} has no level to read.").format(t.tank_name))
	lv = flt(level_pct)
	if lv < 0 or lv > 100:
		frappe.throw(_("The level is a percentage from 0 (empty) to 100 (full)."))
	if not _photo_ok(photo):
		frappe.throw(_("Take a photo inside the tank (through the manhole)."), title=_("Photo needed"))
	doc = frappe.get_doc({"doctype": "Water Tank Reading", "date": nowdate(), "time": nowtime(), "tank": tank, "level_pct": lv,
		"gallons": flt(t.capacity_gallons) * lv / 100, "photo": photo, "notes": notes, "location": location, "project": _project()})
	doc.insert()
	used, warning = book_usage(doc.name)
	_queue("buildiary.water.check_reading", name=doc.name)
	return {"name": doc.name, "gallons": doc.gallons, "used": used, "warning": warning}


@frappe.whitelist()
def tanker_save(data, check=None):
	"""A water tanker at the gate: number plate, size, water type, TDS, bill; the receiver by site card and face."""
	c = _can()
	from buildiary.identity import needs_card, use_check

	d = frappe._dict(_parse(data) or {})
	if needs_card("card_for_receiving") and not check:
		frappe.throw(_("Scan the receiver's site card and take their photo first."), title=_("Receiver's site card"))
	if not (d.vehicle_no or "").strip():
		frappe.throw(_("Enter the tanker's vehicle number."))
	if flt(d.gallons) <= 0:
		frappe.throw(_("Enter the tanker size in gallons."))
	if not _photo_ok(d.tanker_photo):
		frappe.throw(_("Take a photo of the tanker with its number plate."), title=_("Photo needed"))
	rejected = d.water_type == REJECTED
	if not rejected and not _photo_ok(d.bill_scan):
		frappe.throw(_("Scan the tanker's bill or slip."), title=_("Bill needed"))
	tank = d.emptied_into or None
	if tank and not frappe.db.exists("Water Tank", tank):
		frappe.throw(_("Choose the tank it was emptied into."))
	if cint(d.paid_from_petty_cash) and not rejected and flt(d.cost) > 0:
		from buildiary import petty

		h = petty.holder_for(d.holder)
		if not h:
			frappe.throw(_("Your sign-in isn't linked to a person on site, so you can't pay from petty cash. Ask the owner."))
		if flt(d.cost) > petty._in_hand(h) + 0.5:
			frappe.throw(_("{0} has only {1} of petty cash in hand.").format(frappe.db.get_value("Site Worker", h, "full_name"),
				money_text(max(petty._in_hand(h), 0))), title=_("Not enough cash"))
	idc = frappe.get_doc("Identity Check", check) if check else None
	doc = frappe.get_doc({
		"doctype": "Water Tanker", "date": nowdate(), "time": d.time or nowtime(), "vehicle_no": d.vehicle_no.strip().upper(), "supplier_text": d.supplier_text,
		"gallons": flt(d.gallons), "water_type": d.water_type or "Sweet (construction & curing)", "tds_ppm": cint(d.tds_ppm) or None,
		"cost": flt(d.cost) if c["money"] or d.paid_from_petty_cash else 0, "emptied_into": None if rejected else tank, "bill_no": d.bill_no,
		"tanker_photo": d.tanker_photo, "bill_scan": d.bill_scan if _photo_ok(d.bill_scan) else None, "tds_photo": d.tds_photo if _photo_ok(d.tds_photo) else None,
		"notes": d.notes, "location": d.location, "project": _project(), "paid_from_petty_cash": cint(d.paid_from_petty_cash) if not rejected else 0,
		"received_by": idc.person if idc else d.received_by, "identity_check": idc.name if idc else None,
	})
	doc.insert()
	if idc:
		use_check(idc.name, "Receiving goods", "Water Tanker", doc.name, idc.person)
	doc.submit()
	warnings = []
	if not rejected and cint(d.tds_ppm) > _tds_limit():
		warnings.append(_("TDS {0} ppm is above {1}: not fit for concrete or curing.").format(cint(d.tds_ppm), _tds_limit()))
	if doc.paid_from_petty_cash and flt(doc.cost) > 0:
		from buildiary import petty

		pc = petty.water_expense(doc, d.holder)
		doc.db_set("petty_cash_entry", pc)
	_queue("buildiary.water.check_tanker", name=doc.name)
	return {"name": doc.name, "warnings": warnings}


@frappe.whitelist()
def tank_save(data):
	"""The owner sets the site's tanks and their sizes."""
	if not caps()["owner"]:
		frappe.throw(_("Only the owner changes the tanks."), frappe.PermissionError)
	d = frappe._dict(_parse(data) or {})
	if d.name and frappe.db.exists("Water Tank", d.name):
		t = frappe.get_doc("Water Tank", d.name)
	else:
		if not (d.tank_name or "").strip():
			frappe.throw(_("Enter the tank's name."))
		t = frappe.new_doc("Water Tank")
		t.tank_name = d.tank_name.strip()
		t.sort_order = (frappe.db.sql("select max(sort_order) from `tabWater Tank`")[0][0] or 0) + 1
	t.kind = d.kind or t.kind or "Overhead"
	t.capacity_gallons = flt(d.capacity_gallons)
	t.is_active = cint(d.is_active) if d.is_active is not None else 1
	t.save()
	return t.name


# ---------------------------------------------------------------- AI checks (run in the background after saving)
def _queue(method, **kw):
	s = _settings()
	from buildiary.ai import available

	if not available():
		return
	if frappe.flags.in_test:
		frappe.get_attr(method)(**kw)
		return
	frappe.enqueue(method, queue="short", enqueue_after_commit=True, **kw)


def _verdict(v):
	v = str(v or "").lower()
	return "Verified" if v.startswith("verif") else "Mismatch" if v.startswith("mis") else "Check" if v else "Not checked"


def _tanker_prompt(d):
	return (
		f"Verify a water tanker delivery at a house construction site {__import__('buildiary.ai', fromlist=['where']).where()}. "
		f"Recorded: tanker {d.get('vehicle_no') or '?'}, {flt(d.get('gallons'))} gallons, {d.get('water_type') or ''}, TDS {d.get('tds_ppm') or 'not recorded'} ppm, "
		f"emptied into {d.get('emptied_into') or '?'}, bill no. {d.get('bill_no') or '?'}, cost {flt(d.get('cost')) or '?'} {__import__('buildiary.ai', fromlist=['money_name']).money_name()}. "
		"The images are: the tanker with its number plate; if present, a TDS meter or water sample; and the tanker's bill or slip. "
		f"Water above about {_tds_limit()} ppm TDS is unsuitable for concrete and curing. "
		'Reply with only JSON: {"verdict": "verified"|"check"|"mismatch", "summary": "one or two short sentences", "plateRead": string, '
		'"plateMatches": "yes"|"no"|"unclear", "tankerSizeEstimateGallons": number, "tdsReadingSeen": string, "billMatches": "yes"|"no"|"unclear", "concerns": [string]}'
	)


def _tanker_result(r):
	summary = " ".join([str(r.get("summary") or "")] + [str(x) for x in (r.get("concerns") or [])][:3]).strip()
	return {"ai_verdict": _verdict(r.get("verdict")), "ai_summary": summary[:1000], "ai_plate": str(r.get("plateRead") or "")[:140],
		"ai_gallons": flt(r.get("tankerSizeEstimateGallons")), "ai_tds_seen": str(r.get("tdsReadingSeen") or "")[:140]}


def check_tanker(name):
	from buildiary import ai

	doc = frappe.get_doc("Water Tanker", name)
	files = [f for f in (doc.tanker_photo, doc.tds_photo, doc.bill_scan) if f]
	try:
		r = ai.ask_many(_tanker_prompt(doc.as_dict()), files)
	except Exception as e:
		doc.db_set({"ai_verdict": "Not checked", "ai_summary": str(e)[:300]})
		return
	doc.db_set(_tanker_result(r))


@frappe.whitelist()
def verify_draft(data):
	"""Verify with AI before saving: the tanker photo (number plate), the TDS photo and the bill."""
	_can()
	from buildiary import ai

	d = frappe._dict(_parse(data) or {})
	files = [f for f in (d.tanker_photo, d.tds_photo, d.bill_scan) if _photo_ok(f)]
	if not files:
		frappe.throw(_("Take a photo of the tanker with its number plate."))
	fake = frappe.conf.get("buildiary_fake_ai_file")
	if fake:
		r = ai.ask_many(_tanker_prompt(d), files)
	else:
		r = ai._call(_tanker_prompt(d), [ai._file(f) for f in files], max_tokens=2048)
	x = _tanker_result(r)
	return {"verdict": x["ai_verdict"], "summary": x["ai_summary"], "plate": x["ai_plate"], "gallons": x["ai_gallons"], "tds": x["ai_tds_seen"]}


def check_reading(name):
	from buildiary import ai

	doc = frappe.get_doc("Water Tank Reading", name)
	if not doc.photo:
		return
	prompt = (
		f"Estimate the water level in the {doc.tank} at a house construction site from this photo taken through the manhole or of the tank. "
		f"Recorded level: {flt(doc.level_pct)}% full. "
		'Reply with only JSON: {"verdict": "verified"|"check"|"mismatch", "summary": "one short sentence", "estimatedLevelPct": number, '
		'"levelConsistent": "yes"|"no"|"unclear", "waterClarity": "clear"|"slightly turbid"|"turbid"|"not visible", "contamination": [string]}'
	)
	try:
		r = ai.ask_many(prompt, [doc.photo])
	except Exception as e:
		doc.db_set({"ai_verdict": "Not checked", "ai_summary": str(e)[:300]}, update_modified=False)
		return
	est = r.get("estimatedLevelPct")
	verdict = _verdict(r.get("verdict"))
	if est is not None and abs(flt(est) - flt(doc.level_pct)) > 20:
		verdict = "Mismatch"
	summary = " ".join([str(r.get("summary") or "")] + [str(x) for x in (r.get("contamination") or [])][:2]).strip()
	doc.db_set({"ai_verdict": verdict, "ai_level_pct": flt(est) if est is not None else None, "ai_clarity": str(r.get("waterClarity") or "")[:60], "ai_summary": summary[:1000]},
		update_modified=False)


@frappe.whitelist()
def recheck(doctype, name):
	"""Run the AI check again (e.g. after the API key is added)."""
	_can()
	if doctype == "Water Tanker":
		check_tanker(name)
		return frappe.db.get_value("Water Tanker", name, ["ai_verdict", "ai_summary"], as_dict=True)
	if doctype == "Water Tank Reading":
		check_reading(name)
		return frappe.db.get_value("Water Tank Reading", name, ["ai_verdict", "ai_summary", "ai_level_pct"], as_dict=True)
	frappe.throw(_("Not a water record."))
