"""Debris removal: the skips (dump boxes) on site, how full they are, and every collection.

Where sites keep debris in a skip from a skip company (common in the Gulf), the supervisor marks how
full it is with a photo and asks the company to exchange or take it away: Buildiary writes the
message, opens WhatsApp on the phone with it ready to send, and emails the company too. A skip can
also be collected on a regular day (every 3 days, weekly ...): the morning check asks for those by
itself. Where debris goes by truck or tractor-trolley without a skip (common in Pakistan), each trip
is recorded the same way. On when Buildiary Settings > Track debris removal is ticked (on by default
for workspaces in the Gulf, available everywhere)."""

import frappe
from frappe import _
from frappe.utils import add_days, cint, escape_html, flt, get_fullname, getdate, now_datetime, nowdate, validate_email_address

from buildiary.field import _company, _only, _parse, _photo_ok, _project, _psql, _settings, caps

KINDS = ("Exchange (full for empty)", "Take away", "Truck / trolley trip", "New skip delivered")
FILLS = ("Empty", "Half full", "Nearly full", "Full")
GULF = ("Saudi Arabia", "United Arab Emirates", "Qatar", "Kuwait", "Bahrain", "Oman")


def enabled():
	return bool(cint(frappe.db.get_single_value("Buildiary Settings", "debris_enabled")))


def _can():
	c = caps()
	if c.get("partner") or not (c["site"] or c["store"]):
		frappe.throw(_("You don't have access to this. Ask the owner."), frappe.PermissionError)
	return c


def _owner():
	if not caps()["owner"]:
		frappe.throw(_("Only the owner changes this."), frappe.PermissionError)


def default_on(country):
	"""Skips are the usual way in the Gulf; elsewhere the owner turns it on when they need it."""
	return country in GULF


# ---------------------------------------------------------------- the supplier: phone, email, message
def supplier_contact(supplier):
	from buildiary.api import _phone

	if not supplier:
		return {"phone": "", "email": ""}
	email = frappe.db.get_value("Supplier", supplier, "email_id") or ""
	if not email:
		c = frappe.db.get_value("Supplier", supplier, "supplier_primary_contact")
		email = frappe.db.get_value("Contact", c, "email_id") if c else ""
	return {"phone": _phone(supplier), "email": email if validate_email_address(email or "") else ""}


def _site_address():
	p = _project()
	addr = (frappe.db.get_value("Project", p, "notes") or "").strip() if p else ""
	name = frappe.db.get_value("Project", p, "project_name") if p else ""
	return name, addr


def message(r):
	"""The words to the skip company, in the language of the person asking."""
	co = _company()
	name, addr = _site_address()
	sup = frappe.db.get_value("Supplier", r.supplier, "supplier_name") if r.supplier else ""
	c = frappe.db.get_value("Debris Container", r.container, ["container_no", "size_m3", "location"], as_dict=True) if r.container else None
	skip = (c.container_no + (f" ({flt(c.size_m3):g} m³)" if flt(c.size_m3) else "")) if c else ""
	ask = {
		"Exchange (full for empty)": _("Please exchange the full skip no. {0} for an empty one."),
		"Take away": _("Please take away skip no. {0}; we don't need it any more."),
		"Truck / trolley trip": _("Please send a truck to take away the debris."),
		"New skip delivered": _("Please bring a new skip."),
	}[r.kind].format(skip)
	lines = [(_("Hello {0},").format(sup) if sup else _("Hello,")), ask, _("Site: {0}").format(", ".join(x for x in (name, addr) if x) or co)]
	if c and c.location:
		lines.append(_("The skip is at: {0}").format(c.location))
	if r.reason == "Scheduled":
		lines.append(_("This is the regular collection."))
	if r.notes:
		lines.append(r.notes)
	who = r.requested_by or frappe.session.user
	if who in ("Administrator", "Guest"):
		lines.append(_("Thank you. {0}").format(co))
	else:
		mobile = frappe.db.get_value("User", who, "mobile_no") or ""
		lines.append(_("Thank you. {0}, {1}").format(get_fullname(who), co) + (f" ({mobile})" if mobile else ""))
	return "\n".join(lines)


def _email(r, text):
	s = _settings()
	if not cint(s.get("debris_email_supplier")):
		return False
	to = supplier_contact(r.supplier)["email"]
	if not to:
		return False
	sender_addr = frappe.conf.get("auto_email_id")
	reply = frappe.db.get_value("User", r.requested_by or frappe.session.user, "email")
	try:
		q = frappe.sendmail(recipients=[to], subject=_("Debris collection: {0}").format(_site_address()[0] or _company()),
			message=escape_html(text).replace("\n", "<br>"), sender=f'"{_company()}" <{sender_addr}>' if sender_addr else None,
			reply_to=reply if reply and validate_email_address(reply) else None, reference_doctype="Debris Removal", reference_name=r.name)
		from buildiary.saas.mail import send_soon

		send_soon(q)
		return True
	except Exception:
		frappe.log_error("Buildiary: the debris email to the supplier failed")
		return False


def _wa_link(r, text):
	phone = supplier_contact(r.supplier)["phone"]
	from urllib.parse import quote

	return f"https://wa.me/{phone}?text={quote(text)}" if phone else f"https://wa.me/?text={quote(text)}"


# ---------------------------------------------------------------- the screen
@frappe.whitelist()
def overview():
	c = _can()
	today = getdate(nowdate())
	skips = frappe.get_all("Debris Container", filters=_only({"status": ["!=", "Removed"]}),
		fields=["name", "container_no", "supplier", "size_m3", "location", "status", "fill", "fill_on", "fill_photo", "placed_on", "every_days", "next_collection",
			"permit_no", "permit_expires"], order_by="placed_on asc, creation asc")
	names = {s.supplier for s in skips if s.supplier}
	rows = frappe.get_all("Debris Removal", filters=_only({"date": [">=", add_days(today, -120)]}),
		fields=["name", "date", "kind", "status", "container", "container_no", "supplier", "reason", "requested_on", "notified", "done_on", "vehicle_no", "loads",
			"slip_no", "cost", "photo_full", "photo_done", "slip_scan", "received_by_name", "notes"],
		order_by="date desc, creation desc", limit_page_length=300)
	names |= {r.supplier for r in rows if r.supplier}
	sname = {n: frappe.db.get_value("Supplier", n, "supplier_name") for n in names}
	for s in skips:
		s.supplier_name = sname.get(s.supplier) or ""
		s.days = (today - getdate(s.placed_on)).days if s.placed_on else None
		s.permit_left = (getdate(s.permit_expires) - today).days if s.permit_expires else None
		s.open = frappe.db.get_value("Debris Removal", {"container": s.name, "status": "Requested"}, "name")
	for r in rows:
		r.supplier_name = sname.get(r.supplier) or ""
		if not c["money"]:
			r.cost = None
	month0 = today.replace(day=1)
	done = [r for r in rows if r.status == "Done"]
	m = [r for r in done if getdate(r.date) >= month0]
	sups = frappe.get_all("Supplier", filters={"disabled": 0}, fields=["name", "supplier_name", "buildiary_work_area"], order_by="supplier_name asc", limit_page_length=500)
	sups.sort(key=lambda x: (x.buildiary_work_area != "Waste removal", x.supplier_name or ""))
	return {
		"enabled": enabled(), "owner": c["owner"], "money": c["money"], "skips": skips,
		"open": [r for r in rows if r.status == "Requested"], "done": done[:80],
		"month": {"trips": sum(cint(r.loads) or 1 for r in m), "cost": sum(flt(r.cost) for r in m) if c["money"] else None},
		"suppliers": [{"name": x.name, "title": x.supplier_name, "waste": x.buildiary_work_area == "Waste removal"} for x in sups],
		"default_supplier": _settings().get("debris_supplier"),
		"kinds": KINDS, "fills": FILLS,
	}


@frappe.whitelist()
def turn_on(on=1):
	"""The owner turns debris removal on or off for this workspace."""
	_owner()
	frappe.db.set_single_value("Buildiary Settings", "debris_enabled", 1 if cint(on) else 0)
	return enabled()


@frappe.whitelist()
def skip_save(data):
	"""A skip placed on site (or its details changed)."""
	_can()
	d = frappe._dict(_parse(data) or {})
	if d.name and frappe.db.exists("Debris Container", d.name):
		doc = frappe.get_doc("Debris Container", d.name)
	else:
		doc = frappe.new_doc("Debris Container")
		doc.project = _project()
		doc.placed_on = d.placed_on or nowdate()
	if not (d.container_no or doc.container_no or "").strip():
		frappe.throw(_("Enter the skip's number (painted on it)."))
	no = (d.container_no or doc.container_no or "").strip().upper()
	same = frappe.db.get_value("Debris Container", {"container_no": no, "status": ["!=", "Removed"], "name": ["!=", doc.name or ""]}, "name")
	if same:
		frappe.throw(_("Skip {0} is already on site.").format(no))
	for k in ("container_no", "supplier", "location", "permit_no", "notes"):
		if d.get(k) is not None:
			doc.set(k, (d.get(k) or "").strip() if isinstance(d.get(k), str) else d.get(k))
	if d.get("size_m3") is not None:
		doc.size_m3 = flt(d.size_m3)
	if d.get("permit_expires") is not None:
		doc.permit_expires = d.permit_expires or None
	if d.get("every_days") is not None:
		every = cint(d.every_days)
		if every != cint(doc.every_days):
			doc.every_days = every
			doc.next_collection = add_days(nowdate(), every) if every else None
	if not doc.supplier:
		doc.supplier = _settings().get("debris_supplier")
	if not doc.supplier:
		frappe.throw(_("Choose the skip company."))
	doc.save() if not doc.is_new() else doc.insert()
	return doc.name


@frappe.whitelist()
def fill_save(container, fill, photo=None):
	"""How full a skip is now (with a photo). A full or nearly full skip is offered for collection."""
	_can()
	if fill not in FILLS:
		frappe.throw(_("Choose how full it is."))
	doc = frappe.get_doc("Debris Container", container)
	doc.fill = fill
	doc.fill_on = now_datetime()
	if _photo_ok(photo):
		doc.fill_photo = photo
	doc.save()
	return {"suggest": fill in ("Nearly full", "Full") and not frappe.db.exists("Debris Removal", {"container": container, "status": "Requested"})}


@frappe.whitelist()
def request(data):
	"""Ask the skip company (or the debris contractor) to come. Returns the WhatsApp link with the message ready."""
	_can()
	d = frappe._dict(_parse(data) or {})
	kind = d.kind if d.kind in KINDS else "Exchange (full for empty)"
	container = d.container if d.container and frappe.db.exists("Debris Container", d.container) else None
	if kind in ("Exchange (full for empty)", "Take away") and not container:
		frappe.throw(_("Choose the skip."))
	supplier = d.supplier or (frappe.db.get_value("Debris Container", container, "supplier") if container else None) or _settings().get("debris_supplier")
	if not supplier:
		frappe.throw(_("Choose the skip company or the debris contractor."))
	if container:
		already = frappe.db.get_value("Debris Removal", {"container": container, "status": "Requested"}, "name")
		if already:
			frappe.throw(_("A collection for this skip is already asked for ({0}). Mark it collected when the company comes.").format(already))
	r = frappe.get_doc({
		"doctype": "Debris Removal", "date": nowdate(), "kind": kind, "status": "Requested", "container": container, "supplier": supplier,
		"reason": d.reason if d.reason in ("Full", "Scheduled", "Site clean-up", "Other") else "Full", "requested_on": now_datetime(),
		"requested_by": frappe.session.user, "photo_full": d.photo_full if _photo_ok(d.photo_full) else None, "notes": (d.notes or "").strip()[:1000],
		"location": (d.location or "")[:140], "project": _project(),
	})
	r.insert()
	text = message(r)
	emailed = _email(r, text)
	r.db_set({"message": text, "notified": "WhatsApp, Email" if emailed else "WhatsApp"})
	if container:
		frappe.db.set_value("Debris Container", container, "status", "Collection requested")
	return {"name": r.name, "message": text, "whatsapp": _wa_link(r, text), "emailed": emailed, "has_phone": bool(supplier_contact(supplier)["phone"])}


@frappe.whitelist()
def resend(name):
	"""The message again (to send it on WhatsApp once more)."""
	_can()
	r = frappe.get_doc("Debris Removal", name)
	text = r.message or message(r)
	return {"message": text, "whatsapp": _wa_link(r, text)}


@frappe.whitelist()
def done(data):
	"""The company came: the vehicle, the slip or dumping ticket, photos, the cost. The skip is empty again (or gone)."""
	c = _can()
	d = frappe._dict(_parse(data) or {})
	if d.name:
		r = frappe.get_doc("Debris Removal", d.name)
		if r.status == "Done":
			frappe.throw(_("This collection is already marked done."))
	else:
		# a trip nobody asked for in the app (the trolley came on its own): recorded straight away
		kind = d.kind if d.kind in KINDS else "Truck / trolley trip"
		supplier = d.supplier or (frappe.db.get_value("Debris Container", d.container, "supplier") if d.container else None) or _settings().get("debris_supplier")
		if not supplier:
			frappe.throw(_("Choose the skip company or the debris contractor."))
		r = frappe.get_doc({"doctype": "Debris Removal", "date": nowdate(), "kind": kind, "status": "Requested", "container": d.container or None,
			"supplier": supplier, "reason": "Other", "requested_on": now_datetime(), "requested_by": frappe.session.user, "project": _project()})
		r.insert()
	if not _photo_ok(d.photo_done) and not _photo_ok(r.photo_done):
		frappe.throw(_("Take a photo after the collection (the site, or the new skip)."), title=_("Photo needed"))
	r.update({
		"status": "Done", "done_on": now_datetime(), "date": nowdate(), "vehicle_no": (d.vehicle_no or "").strip().upper()[:40], "loads": max(1, cint(d.loads) or 1),
		"slip_no": (d.slip_no or "").strip()[:80], "received_by_name": get_fullname(frappe.session.user),
		"photo_done": d.photo_done if _photo_ok(d.photo_done) else r.photo_done, "slip_scan": d.slip_scan if _photo_ok(d.slip_scan) else r.slip_scan,
		"photo_full": d.photo_full if _photo_ok(d.photo_full) else r.photo_full, "location": (d.location or r.location or "")[:140],
	})
	if d.notes:
		r.notes = ((r.notes or "") + "\n" + d.notes.strip()).strip()[:1000]
	if c["money"] or c["owner"]:
		r.cost = flt(d.cost)
	r.save()
	if r.container:
		k = frappe.get_doc("Debris Container", r.container)
		if r.kind == "Take away":
			k.status, k.removed_on, k.next_collection = "Removed", nowdate(), None
		else:
			k.status, k.fill, k.fill_on = "On site", "Empty", now_datetime()
			k.next_collection = add_days(nowdate(), cint(k.every_days)) if cint(k.every_days) else None
		k.save()
	return r.name


@frappe.whitelist()
def cancel(name):
	_can()
	r = frappe.get_doc("Debris Removal", name)
	if r.status != "Requested":
		frappe.throw(_("Only a collection that is still waiting can be cancelled."))
	r.status = "Cancelled"
	r.save()
	if r.container and frappe.db.get_value("Debris Container", r.container, "status") == "Collection requested":
		frappe.db.set_value("Debris Container", r.container, "status", "On site")
	return r.name


# ---------------------------------------------------------------- every morning
def daily():
	"""Skips on a regular collection: ask the company on the day (by email; the dashboard shows the WhatsApp button)."""
	if not enabled():
		return
	today = getdate(nowdate())
	for k in frappe.get_all("Debris Container", filters={"status": "On site", "every_days": [">", 0], "next_collection": ["<=", today]},
			fields=["name", "supplier", "project"]):
		if frappe.db.exists("Debris Removal", {"container": k.name, "status": "Requested"}) or not k.supplier:
			continue
		try:
			r = frappe.get_doc({"doctype": "Debris Removal", "date": today, "kind": "Exchange (full for empty)", "status": "Requested", "container": k.name,
				"supplier": k.supplier, "reason": "Scheduled", "requested_on": now_datetime(), "requested_by": "Administrator", "project": k.project})
			r.insert(ignore_permissions=True)
			text = message(r)
			told = ["Email"] if _email(r, text) else []
			r.db_set({"message": text, "notified": ", ".join(told)})
			frappe.db.set_value("Debris Container", k.name, "status", "Collection requested")
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(f"Buildiary: the regular debris collection for {k.name} could not be asked for")


def attention(today=None):
	"""For the dashboard: full skips with no collection asked for, collections waiting since yesterday, permits running out."""
	if not enabled():
		return []
	today = getdate(today or nowdate())
	out = []
	for k in frappe.get_all("Debris Container", filters=_only({"status": "On site", "fill": ["in", ["Nearly full", "Full"]]}), fields=["name", "container_no", "fill"]):
		out.append({"k": "bad" if k.fill == "Full" else "warn", "t": _("Skip {0} is {1}: ask the company to collect it").format(k.container_no, _(k.fill).lower()), "go": ["debris", k.name], "g": "Debris"})
	for r in frappe.get_all("Debris Removal", filters=_only({"status": "Requested", "date": ["<", today]}), fields=["name", "container_no", "kind", "date"]):
		out.append({"k": "warn", "t": _("Collection asked for on {0} has not come yet: {1}").format(frappe.format(r.date, "Date"), r.container_no or _(r.kind)), "go": ["debris", r.name], "g": "Debris"})
	for k in frappe.get_all("Debris Container", filters=_only({"status": ["!=", "Removed"], "permit_expires": ["is", "set"]}), fields=["name", "container_no", "permit_expires"]):
		if getdate(k.permit_expires) > add_days(today, 3):
			continue
		out.append({"k": "bad" if getdate(k.permit_expires) < today else "warn", "t": _("Road permit for skip {0} ends on {1}").format(k.container_no, frappe.format(k.permit_expires, "Date")), "go": ["debris", k.name], "g": "Debris"})
	return out


def tile():
	if not enabled():
		return None
	today = getdate(nowdate())
	on = frappe.get_all("Debris Container", filters=_only({"status": ["!=", "Removed"]}), fields=["fill", "status"])
	month = frappe.db.sql(f"""select coalesce(sum(loads), 0) from `tabDebris Removal` where status = 'Done' and date >= %s{_psql()}""", today.replace(day=1))[0][0]
	return {"skips": len(on), "full": sum(1 for x in on if x.fill in ("Nearly full", "Full")), "asked": sum(1 for x in on if x.status == "Collection requested"), "month": cint(month)}
