"""The site store on the phone: every item as a card (photo or category picture, quantity, state),
an item's own page (in store, received, released, returned, on order, its movements), finding an
item from a photo with the AI, and adding or editing an item.
"""

import re

import frappe
from frappe import _
from frappe.utils import cint, flt

from buildiary.field import _hhmm, _need, _parse, _photo_ok, _psql, _store, caps

WATER = "WATER"


def _can():
	c = caps()
	if c.get("partner") or not (c["store"] or c["site"] or c["buy"]):
		frappe.throw(_("You don't have access to this. Ask the owner."), frappe.PermissionError)
	return c


# ---------------------------------------------------------------- item groups with plain names
def _groups():
	"""Item group → (plain name, top category). The ERP keeps names like "Paint (Finishing materials)"
	unique; the phone shows "Paint" under "Finishing materials"."""
	rows = frappe.get_all("Item Group", fields=["name", "parent_item_group", "is_group"], limit_page_length=1000)
	parent = {r.name: r.parent_item_group for r in rows}
	out = {}
	for r in rows:
		label = r.name
		p = r.parent_item_group or ""
		m = re.match(r"^(.*\S)\s*\(([^()]*(?:\([^()]*\))?[^()]*)\)$", label)
		if m and p and m.group(2).strip().lower() == p.strip().lower():
			label = m.group(1)
		top = r.name
		seen = 0
		while parent.get(top) and parent.get(top) not in ("All Item Groups", None, "") and seen < 6:
			top = parent[top]
			seen += 1
		out[r.name] = (label, top if top != r.name else "")
	return out


def _sum_by_item(sql, args):
	return {k: flt(v) for k, v in frappe.db.sql(sql, args)}


def _figures(wh, item=None):
	cond = " and x.item_code = %(item)s" if item else ""
	args = {"wh": wh, "item": item}
	bins = _sum_by_item(f"select x.item_code, x.actual_qty from `tabBin` x where x.warehouse = %(wh)s{cond}", args)
	received = _sum_by_item(f"""select x.item_code, sum(x.stock_qty) from `tabPurchase Receipt Item` x join `tabPurchase Receipt` p on p.name = x.parent
		where p.docstatus = 1 and x.warehouse = %(wh)s{cond} group by x.item_code""", args)
	released = _sum_by_item(f"""select x.item_code, sum(x.transfer_qty) from `tabStock Entry Detail` x join `tabStock Entry` s on s.name = x.parent
		where s.docstatus = 1 and s.stock_entry_type = 'Material Issue' and x.s_warehouse = %(wh)s{cond} group by x.item_code""", args)
	returned = _sum_by_item(f"""select x.item_code, sum(x.transfer_qty) from `tabStock Entry Detail` x join `tabStock Entry` s on s.name = x.parent
		where s.docstatus = 1 and s.stock_entry_type = 'Material Receipt' and s.buildiary_is_return = 1 and x.t_warehouse = %(wh)s{cond} group by x.item_code""", args)
	on_order = _sum_by_item(f"""select x.item_code, sum(greatest(x.qty - x.received_qty, 0) * x.conversion_factor) from `tabPurchase Order Item` x
		join `tabPurchase Order` p on p.name = x.parent where p.docstatus = 1 and p.status not in ('Closed', 'Completed', 'On Hold'){cond}{_psql('p')} group by x.item_code""", args)
	reorder = _sum_by_item(f"""select x.parent, x.warehouse_reorder_level from `tabItem Reorder` x where x.warehouse = %(wh)s{cond.replace('item_code', 'parent')}""", args)
	return bins, received, released, returned, on_order, reorder


def _state(qty, received, reorder):
	if qty <= 0 and received <= 0:
		return "none"  # not received yet
	if qty <= 0:
		return "out"
	if reorder and qty <= reorder:
		return "low"
	return "in"


@frappe.whitelist()
def items():
	"""Every stock item of the site store with its figures (the phone filters and searches)."""
	c = _can()
	wh = _store()
	G = _groups()
	bins, received, released, returned, on_order, reorder = _figures(wh)
	rows = []
	for i in frappe.get_all("Item", filters={"disabled": 0, "is_stock_item": 1, "name": ["!=", WATER]},
		fields=["name", "item_name", "item_group", "stock_uom", "image"], order_by="item_name asc", limit_page_length=3000):
		label, top = G.get(i.item_group, (i.item_group, ""))
		q = bins.get(i.name, 0)
		rows.append({"code": i.name, "name": i.item_name, "group": label, "top": G.get(top, (top, ""))[0] if top else "", "uom": i.stock_uom, "image": i.image,
			"qty": q, "received": received.get(i.name, 0), "released": released.get(i.name, 0), "returned": returned.get(i.name, 0),
			"on_order": on_order.get(i.name, 0), "reorder": reorder.get(i.name, 0), "state": _state(q, received.get(i.name, 0), reorder.get(i.name, 0))})
	return {"store": wh, "rows": rows, "new_item": c["new_item"]}


@frappe.whitelist()
def item(code):
	"""One item: its figures, the orders still to come, and every movement in and out of the store."""
	c = _can()
	wh = _store()
	it = frappe.get_doc("Item", code)
	G = _groups()
	label, top = G.get(it.item_group, (it.item_group, ""))
	bins, received, released, returned, on_order, reorder = _figures(wh, code)
	q = bins.get(code, 0)
	money = c["money"] or c["owner"]
	rate = flt(frappe.db.get_value("Bin", {"item_code": code, "warehouse": wh}, "valuation_rate")) if money else None
	moves = []
	for r in frappe.db.sql("""select p.name, p.posting_date d, p.posting_time t, p.supplier_name who, p.supplier_delivery_note ref, x.stock_qty qty, p.buildiary_identity_check idc
		from `tabPurchase Receipt Item` x join `tabPurchase Receipt` p on p.name = x.parent
		where p.docstatus = 1 and x.item_code = %s and x.warehouse = %s order by p.posting_date desc, p.creation desc limit 60""", (code, wh), as_dict=True):
		moves.append({"kind": "in", "name": r.name, "date": r.d, "time": _hhmm(r.t), "who": r.who, "ref": r.ref, "qty": flt(r.qty), "face": bool(r.idc)})
	for r in frappe.db.sql("""select s.name, s.posting_date d, s.posting_time t, s.stock_entry_type typ, s.buildiary_is_return ret, s.buildiary_issued_to who, s.buildiary_work_area ref,
			x.transfer_qty qty, s.buildiary_identity_check idc, s.buildiary_photo photo
		from `tabStock Entry Detail` x join `tabStock Entry` s on s.name = x.parent
		where s.docstatus = 1 and x.item_code = %s and (x.s_warehouse = %s or x.t_warehouse = %s) order by s.posting_date desc, s.creation desc limit 60""", (code, wh, wh), as_dict=True):
		kind = "out" if r.typ == "Material Issue" else "back" if r.ret else "adj"
		moves.append({"kind": kind, "name": r.name, "date": r.d, "time": _hhmm(r.t), "who": r.who, "ref": r.ref, "qty": flt(r.qty), "face": bool(r.idc), "photo": r.photo})
	moves.sort(key=lambda m: (str(m["date"]), m["time"], m["name"]), reverse=True)
	orders = frappe.db.sql(f"""select p.name, p.supplier_name, p.schedule_date, (x.qty - x.received_qty) * x.conversion_factor pending
		from `tabPurchase Order Item` x join `tabPurchase Order` p on p.name = x.parent
		where p.docstatus = 1 and p.status not in ('Closed', 'Completed', 'On Hold') and x.item_code = %s and x.qty > x.received_qty{_psql('p')} order by p.schedule_date""", code, as_dict=True)
	return {
		"code": code, "name": it.item_name, "group": label, "top": G.get(top, (top, ""))[0] if top else "", "item_group": it.item_group, "uom": it.stock_uom,
		"image": it.image, "description": it.description if it.description and it.description != it.item_name else "",
		"qty": q, "received": received.get(code, 0), "released": released.get(code, 0), "returned": returned.get(code, 0), "on_order": on_order.get(code, 0),
		"reorder": reorder.get(code, 0), "state": _state(q, received.get(code, 0), reorder.get(code, 0)),
		"value": q * rate if money and rate else None, "rate": rate, "moves": moves[:80], "orders": orders, "can_edit": c["new_item"],
	}


@frappe.whitelist()
def identify(file_url):
	"""Which store item is in this photo? The AI looks at the photo and picks from the item list."""
	_can()
	from buildiary import ai

	G = _groups()
	cat = frappe.get_all("Item", filters={"disabled": 0, "is_stock_item": 1, "name": ["!=", WATER]}, fields=["name", "item_name", "item_group", "stock_uom"], limit_page_length=600)
	lines = "\n".join(f"{i.name} | {i.item_name} | {G.get(i.item_group, (i.item_group, ''))[0]} | {i.stock_uom}" for i in cat)
	groups = sorted({G.get(i.item_group, (i.item_group, ""))[0] for i in cat})
	r = ai.ask(
		"This photo was taken in the store of a house under construction in Pakistan. Say what material, tool or item it shows, "
		"then pick the matching items from the store's list below (code | name | category | unit). Pick only real matches, best first, at most 3. "
		"If it is not in the list, suggest a short name, a category from the list of categories and a unit for a new item.\n"
		f"Store list:\n{lines}\nCategories: {', '.join(groups)}\n"
		'Reply with only JSON: {"what": "short description", "matches": [{"code": string, "confidence": 0-100, "why": "few words"}], '
		'"suggested_name": string, "suggested_category": string, "suggested_unit": string, "count_visible": number|null, "condition": "new"|"used"|"damaged"|"unclear"}',
		file_url,
	)
	known = {i.name: i for i in cat}
	matches = []
	for m in r.get("matches") or []:
		code = str(m.get("code") or "").strip()
		if code not in known:
			hit = ai.match_item(code)
			code = hit if hit in known else None
		if code and code not in [x["code"] for x in matches]:
			matches.append({"code": code, "name": known[code].item_name, "uom": known[code].stock_uom, "confidence": cint(m.get("confidence")), "why": m.get("why") or ""})
	group = None
	sc = str(r.get("suggested_category") or "").strip().lower()
	for name, (label, _top) in G.items():
		if label.lower() == sc:
			group = name
			break
	return {"what": r.get("what") or "", "matches": matches[:3], "suggested": {"name": r.get("suggested_name") or "", "group": group, "uom": r.get("suggested_unit") or ""},
		"count": r.get("count_visible"), "condition": r.get("condition") or ""}


@frappe.whitelist()
def groups():
	"""Item categories for the item form (plain names)."""
	G = _groups()
	rows = frappe.get_all("Item Group", filters={"is_group": 0}, fields=["name"], limit_page_length=1000)
	return sorted([{"name": r.name, "label": G[r.name][0], "top": G.get(G[r.name][1], ("", ""))[0] if G[r.name][1] else ""} for r in rows], key=lambda x: (x["top"], x["label"]))


@frappe.whitelist()
def item_save(data):
	"""Add a new store item or change one (name, category, unit, photo, reorder level)."""
	_need("new_item")
	d = frappe._dict(_parse(data) or {})
	name = (d.item_name or "").strip()
	if not name:
		frappe.throw(_("Enter the item name."))
	if d.item_group and not frappe.db.exists("Item Group", d.item_group):
		frappe.throw(_("Choose the category."))
	if d.code:
		it = frappe.get_doc("Item", d.code)
		it.item_name = name
		if d.item_group:
			it.item_group = d.item_group
	else:
		from buildiary.api import new_item

		it = frappe.get_doc("Item", new_item(name, uom=d.uom or "Nos", item_group=d.item_group or None))
	if _photo_ok(d.image):
		it.image = d.image
	if d.description is not None:
		it.description = d.description
	wh = _store()
	lvl = flt(d.reorder)
	row = next((r for r in it.get("reorder_levels") or [] if r.warehouse == wh), None)
	if lvl > 0:
		if not row:
			row = it.append("reorder_levels", {"warehouse": wh, "material_request_type": "Purchase"})
		row.warehouse_reorder_level = lvl
		row.warehouse_reorder_qty = flt(d.reorder_qty) or lvl
	elif row:
		it.remove(row)
	it.save()
	return it.name
