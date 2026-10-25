"""Small server calls used by the forms."""

import re
from urllib.parse import quote, urlencode

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, get_url, getdate, nowdate

WORK_AREAS = ["Materials", "Grey structure", "Finishing", "Design", "Testing & verification", "Services"]


# ---------------------------------------------------------------- suppliers
@frappe.whitelist()
def register_supplier(name, phone=None, contact=None, email=None, address=None, ntn=None, work_area=None, payment_terms=None, delivery_time=None):
	frappe.has_permission("Supplier", "create", throw=True)
	name = (name or "").strip()
	if not name:
		frappe.throw(_("Enter the supplier's name."))
	digits = re.sub(r"\D", "", phone or "")
	if phone and len(digits) < 10:
		frappe.throw(_("Enter a full phone number like 0300-1234567."))
	existing = frappe.db.get_value("Supplier", {"supplier_name": name})
	if existing:
		return existing
	work_area = work_area if work_area in WORK_AREAS else "Materials"
	group = work_area if frappe.db.exists("Supplier Group", work_area) else (frappe.db.get_value("Supplier Group", {"is_group": 0}, "name") or "All Supplier Groups")
	sup = frappe.get_doc(
		{
			"doctype": "Supplier",
			"supplier_name": name,
			"supplier_group": group,
			"supplier_type": "Company",
			"country": "Pakistan",
			"tax_id": ntn or None,
			"buildiary_work_area": work_area,
			"buildiary_payment_terms": payment_terms,
			"buildiary_delivery_time": delivery_time,
		}
	).insert()
	if phone or email or contact:
		first, _sp, last = (contact or name).partition(" ")
		c = frappe.get_doc({"doctype": "Contact", "first_name": first, "last_name": last, "links": [{"link_doctype": "Supplier", "link_name": sup.name}], "is_primary_contact": 1})
		if phone:
			c.append("phone_nos", {"phone": phone, "is_primary_mobile_no": 1})
		if email:
			c.append("email_ids", {"email_id": email, "is_primary": 1})
		c.insert()
		sup.db_set({"mobile_no": phone, "email_id": email, "supplier_primary_contact": c.name})
	if address:
		frappe.get_doc({"doctype": "Address", "address_title": name, "address_type": "Billing", "address_line1": address[:140], "city": "Karachi", "country": "Pakistan", "links": [{"link_doctype": "Supplier", "link_name": sup.name}]}).insert()
	return sup.name


@frappe.whitelist()
def new_item(item_name, uom="Nos", item_group=None, is_stock_item=1):
	frappe.has_permission("Item", "create", throw=True)
	item_name = (item_name or "").strip()
	if not item_name:
		frappe.throw(_("Enter the item name."))
	ex = frappe.db.get_value("Item", {"item_name": item_name}, ["name", "disabled"], as_dict=True)
	if ex:
		if ex.disabled:
			frappe.db.set_value("Item", ex.name, "disabled", 0)
		return ex.name
	if not frappe.db.exists("UOM", uom):
		frappe.get_doc({"doctype": "UOM", "uom_name": uom}).insert(ignore_permissions=True)
	group = item_group or ("Construction Materials" if frappe.db.exists("Item Group", "Construction Materials") else frappe.db.get_value("Item Group", {"is_group": 0}, "name"))
	code = re.sub(r"[^A-Za-z0-9]+", "-", item_name).strip("-").upper()[:40] or "ITEM"
	if frappe.db.exists("Item", code):
		code = f"{code}-{frappe.generate_hash(length=4).upper()}"
	return frappe.get_doc({"doctype": "Item", "item_code": code, "item_name": item_name, "item_group": group, "stock_uom": uom, "is_stock_item": cint(is_stock_item), "include_item_in_manufacturing": 0}).insert().name


# ---------------------------------------------------------------- sharing (WhatsApp, link to the PDF)
def _phone(supplier):
	if not supplier:
		return ""
	ph = frappe.db.get_value("Supplier", supplier, "mobile_no") or ""
	if not ph:
		c = frappe.db.get_value("Supplier", supplier, "supplier_primary_contact")
		ph = frappe.db.get_value("Contact", c, "mobile_no") if c else ""
	d = re.sub(r"\D", "", ph or "")
	cc = frappe.db.get_single_value("Buildiary Settings", "country_code") or "92"
	if d.startswith("0"):
		d = cc + d[1:]
	return d if len(d) >= 11 else ""


@frappe.whitelist()
def share_link(doctype, name, supplier=None, print_format=None):
	"""A time-limited link to the document's PDF and a WhatsApp message for the supplier."""
	if doctype not in ("Purchase Order", "Request for Quotation", "Supplier Quotation", "Purchase Receipt", "Purchase Invoice", "Payment Entry", "Site Inspection"):
		frappe.throw(_("This document can't be shared."))
	doc = frappe.get_doc(doctype, name)
	doc.check_permission("print")
	if doc.docstatus != 1:
		frappe.throw(_("Only a submitted (locked) document can be sent."))
	days = cint(frappe.db.get_single_value("Buildiary Settings", "share_link_days")) or 30
	key = doc.get_document_share_key(expires_on=add_days(nowdate(), days))
	q = {"doctype": doctype, "name": name, "key": key}
	if print_format:
		q["format"] = print_format
	pdf = f"{get_url()}/api/method/frappe.utils.print_format.download_pdf?{urlencode(q)}"
	sup = supplier or doc.get("supplier")
	title = _(doctype)
	company = doc.get("company") or frappe.defaults.get_user_default("Company") or ""
	text = _("Assalam-o-Alaikum. {0} {1} from {2}.").format(title, name, company)
	if doctype == "Purchase Order":
		text += " " + _("Total {0}. Please quote {1} on every delivery note and invoice.").format(frappe.utils.fmt_money(doc.grand_total, currency=doc.currency), name)
	text += "\n" + _("PDF") + ": " + pdf
	doc.add_comment("Info", _("Shared by WhatsApp link{0}").format(f" ({frappe.db.get_value('Supplier', sup, 'supplier_name')})" if sup else ""))
	ph = _phone(sup)
	return {"pdf": pdf, "phone": ph, "whatsapp": f"https://wa.me/{ph}?text={quote(text)}", "text": text}


# ---------------------------------------------------------------- supplier account
def statement_rows(supplier, from_date=None, to_date=None, company=None):
	company = company or frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
	cond, vals = "", {"supplier": supplier, "company": company}
	if from_date:
		cond += " and posting_date >= %(from_date)s"
		vals["from_date"] = from_date
	if to_date:
		cond += " and posting_date <= %(to_date)s"
		vals["to_date"] = to_date
	gl = frappe.db.sql(
		f"""select posting_date, voucher_type, voucher_no, sum(credit) as credit, sum(debit) as debit,
		max(remarks) as remarks from `tabGL Entry` where party_type='Supplier' and party=%(supplier)s and company=%(company)s
		and is_cancelled=0 {cond} group by posting_date, voucher_type, voucher_no order by posting_date, creation""",
		vals,
		as_dict=True,
	)
	opening = 0.0
	if from_date:
		ob = frappe.db.sql(
			"""select coalesce(sum(credit - debit), 0) from `tabGL Entry` where party_type='Supplier' and party=%(supplier)s and company=%(company)s and is_cancelled=0 and posting_date < %(from_date)s""",
			vals,
		)
		opening = flt(ob[0][0]) if ob else 0.0
	bal, rows = opening, []
	for g in gl:
		bal += flt(g.credit) - flt(g.debit)
		ref = ""
		if g.voucher_type == "Purchase Invoice":
			ref = frappe.db.get_value("Purchase Invoice", g.voucher_no, "bill_no") or ""
		elif g.voucher_type == "Payment Entry":
			ref = frappe.db.get_value("Payment Entry", g.voucher_no, "reference_no") or ""
		rows.append({"date": g.posting_date, "voucher_type": g.voucher_type, "voucher_no": g.voucher_no, "ref": ref, "billed": flt(g.credit), "paid": flt(g.debit), "balance": bal})
	pos = frappe.get_all("Purchase Order", filters={"supplier": supplier, "docstatus": 1, "company": company}, fields=["name", "transaction_date", "grand_total", "per_received", "per_billed", "advance_paid", "status"], order_by="transaction_date")
	ordered = sum(flt(p.grand_total) for p in pos if p.status != "Closed") + sum(flt(p.grand_total) * flt(p.per_billed) / 100 for p in pos if p.status == "Closed")
	received = flt(frappe.db.sql("""select coalesce(sum(grand_total), 0) from `tabPurchase Receipt` where supplier=%s and company=%s and docstatus=1 and is_return=0""", (supplier, company))[0][0]) - flt(frappe.db.sql("""select coalesce(sum(abs(grand_total)), 0) from `tabPurchase Receipt` where supplier=%s and company=%s and docstatus=1 and is_return=1""", (supplier, company))[0][0])
	billed = sum(r["billed"] for r in rows) + max(opening, 0)
	paid = sum(r["paid"] for r in rows) + max(-opening, 0)
	return {
		"supplier": supplier, "supplier_name": frappe.db.get_value("Supplier", supplier, "supplier_name"), "company": company,
		"from_date": from_date, "to_date": to_date, "opening": opening, "rows": rows, "pos": pos,
		"ordered": ordered, "received": received, "billed": billed, "paid": paid, "balance": bal,
		"due": max(bal, 0), "advance": max(-bal, 0),
	}


@frappe.whitelist()
def supplier_statement(supplier, from_date=None, to_date=None):
	frappe.has_permission("Supplier", "read", supplier, throw=True)
	frappe.has_permission("GL Entry", "read", throw=True)
	return statement_rows(supplier, from_date, to_date)


@frappe.whitelist()
def supplier_statement_pdf(supplier, from_date=None, to_date=None, share=0):
	"""The statement as a PDF file; with share=1 also a link and WhatsApp message for the supplier."""
	data = supplier_statement(supplier, from_date, to_date)
	html = frappe.render_template("templates/buildiary_supplier_statement.html", {"d": data, "company": data["company"], "today": nowdate(), "frappe": frappe})
	from frappe.utils.pdf import get_pdf

	pdf = get_pdf(html)
	fname = f"statement-{re.sub(r'[^A-Za-z0-9]+', '-', data['supplier_name'] or supplier)[:40]}-{nowdate()}-{frappe.generate_hash(length=10)}.pdf"
	f = frappe.get_doc({"doctype": "File", "file_name": fname, "content": pdf, "is_private": 0 if cint(share) else 1, "attached_to_doctype": "Supplier", "attached_to_name": supplier}).insert(ignore_permissions=True)
	url = get_url() + f.file_url
	out = {"file_url": f.file_url, "url": url}
	if cint(share):
		ph = _phone(supplier)
		text = _("Assalam-o-Alaikum. Your account statement from {0}: billed {1}, paid {2}, balance {3}.").format(
			data["company"], frappe.utils.fmt_money(data["billed"]), frappe.utils.fmt_money(data["paid"]), frappe.utils.fmt_money(data["balance"])
		) + "\n" + _("PDF") + ": " + url
		out.update({"phone": ph, "whatsapp": f"https://wa.me/{ph}?text={quote(text)}", "text": text, "email": frappe.db.get_value("Supplier", supplier, "email_id") or ""})
	return out


@frappe.whitelist()
def procurement_trace(query):
	"""Follow an item or any document number through quotation → PO → receipt → invoice → payment."""
	frappe.has_permission("Purchase Order", "read", throw=True)
	q = (query or "").strip()
	if len(q) < 2:
		return []
	like = f"%{q}%"
	items = [r[0] for r in frappe.db.sql("select name from tabItem where name like %s or item_name like %s limit 50", (like, like))]
	pos = set()
	pos.update(r[0] for r in frappe.db.sql("select name from `tabPurchase Order` where docstatus<2 and (name like %s or supplier_name like %s)", (like, like)))
	if items:
		pos.update(r[0] for r in frappe.db.sql("select distinct parent from `tabPurchase Order Item` where item_code in %s", (items,)))
	pos.update(r[0] for r in frappe.db.sql("select distinct i.purchase_order from `tabPurchase Receipt Item` i join `tabPurchase Receipt` p on p.name=i.parent where (p.name like %s or p.supplier_delivery_note like %s) and i.purchase_order is not null", (like, like)))
	pos.update(r[0] for r in frappe.db.sql("select distinct i.purchase_order from `tabPurchase Invoice Item` i join `tabPurchase Invoice` p on p.name=i.parent where (p.name like %s or p.bill_no like %s) and i.purchase_order is not null", (like, like)))
	pos.update(r[0] for r in frappe.db.sql("select distinct i.parent from `tabPurchase Order Item` i where i.supplier_quotation like %s", (like,)))
	pos.update(r[0] for r in frappe.db.sql("select distinct r.reference_name from `tabPayment Entry Reference` r join `tabPayment Entry` p on p.name=r.parent where r.reference_doctype='Purchase Order' and (p.name like %s or p.reference_no like %s)", (like, like)))
	out = []
	for po in sorted(x for x in pos if x):
		d = frappe.db.get_value("Purchase Order", po, ["name", "supplier_name", "transaction_date", "grand_total", "status", "per_received", "per_billed", "docstatus"], as_dict=True)
		if not d:
			continue
		d.lines = frappe.db.sql("select item_code, item_name, qty, received_qty, uom, supplier_quotation from `tabPurchase Order Item` where parent=%s order by idx", po, as_dict=True)
		d.quotations = sorted({i.supplier_quotation for i in d.lines if i.supplier_quotation})
		d.receipts = frappe.db.sql("select distinct p.name, p.posting_date, p.supplier_delivery_note, p.buildiary_received_by from `tabPurchase Receipt` p join `tabPurchase Receipt Item` i on i.parent=p.name where i.purchase_order=%s and p.docstatus=1 order by p.posting_date", po, as_dict=True)
		d.invoices = frappe.db.sql("select distinct p.name, p.posting_date, p.bill_no, p.grand_total, p.outstanding_amount, p.status from `tabPurchase Invoice` p join `tabPurchase Invoice Item` i on i.parent=p.name where i.purchase_order=%s and p.docstatus=1 order by p.posting_date", po, as_dict=True)
		inv = [i.name for i in d.invoices] or ["-"]
		d.payments = frappe.db.sql("select distinct p.name, p.posting_date, p.reference_no, r.allocated_amount, r.reference_doctype from `tabPayment Entry` p join `tabPayment Entry Reference` r on r.parent=p.name where p.docstatus=1 and ((r.reference_doctype='Purchase Order' and r.reference_name=%s) or (r.reference_doctype='Purchase Invoice' and r.reference_name in %s)) order by p.posting_date", (po, tuple(inv)), as_dict=True)
		out.append(d)
	return out


@frappe.whitelist()
def suppliers_for_items(items):
	"""Suppliers who quoted, were ordered or are listed for any of these items."""
	frappe.has_permission("Supplier", "read", throw=True)
	items = frappe.parse_json(items) if isinstance(items, str) else items
	items = tuple(i for i in (items or []) if i)
	if not items:
		return []
	out = set()
	out.update(r[0] for r in frappe.db.sql("select distinct p.supplier from `tabSupplier Quotation` p join `tabSupplier Quotation Item` i on i.parent=p.name where p.docstatus=1 and i.item_code in %s", (items,)))
	out.update(r[0] for r in frappe.db.sql("select distinct p.supplier from `tabPurchase Order` p join `tabPurchase Order Item` i on i.parent=p.name where p.docstatus=1 and i.item_code in %s", (items,)))
	out.update(r[0] for r in frappe.db.sql("select distinct supplier from `tabItem Supplier` where parent in %s", (items,)))
	out.update(r[0] for r in frappe.db.sql("select distinct default_supplier from `tabItem Default` where parent in %s and ifnull(default_supplier,'')!=''", (items,)))
	disabled = {r[0] for r in frappe.db.sql("select name from tabSupplier where disabled=1")}
	return sorted(s for s in out if s and s not in disabled)


# ---------------------------------------------------------------- site workers and attendance
@frappe.whitelist()
def find_worker(code):
	"""A scanned site card, or a typed worker number, CNIC or society entry card number → the worker."""
	frappe.has_permission("Site Worker", "read", throw=True)
	from buildiary.identity import person_from_code

	name, scanned = person_from_code(code)
	if not name:
		return None
	d = frappe.db.get_value("Site Worker", name, ["name", "full_name", "full_name_ur", "trade", "status", "contractor", "photo", "worker_type"], as_dict=True)
	d.card_scanned = scanned
	return d


def qr_code(value):
	"""QR code as an image source, for the printed site card."""
	from frappe.utils.print_format_generator import get_qr_code

	return get_qr_code(str(value))


@frappe.whitelist()
def worker_warnings(name):
	doc = frappe.get_doc("Site Worker", name)
	doc.check_permission("read")
	return doc.warnings()
