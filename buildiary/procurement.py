"""Procurement rules for a construction project, on top of standard ERPNext.

Standard ERPNext already locks a document once it is submitted and keeps every
earlier revision when a submitted document is cancelled and amended. These hooks
add the owner's rules:

* a supplier quotation is confirmed by submitting it; a change is a new revision
  (cancel + amend) with a note of what changed; the agreed one is locked as final
  and can't be revised again;
* a purchase order is raised only from the supplier's final quotation, never above
  the quoted rate, and once submitted it can't be cancelled or revised;
* only submitted documents can be printed, e-mailed or shared;
* goods are received only with the supplier's delivery note number, its scan and
  the receiver's photo; invoices need the bill scan;
* suppliers are paid only against invoices that are due, or as an advance against a
  purchase order whose terms include one, never more than that advance; every
  payment carries a proof.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, now_datetime


def settings():
	return frappe.get_cached_doc("Mimaar Settings")


def on(flag):
	return cint(settings().get(flag))


def skip(doc):
	return bool(doc.flags.get("mimaar_migration") or frappe.flags.get("mimaar_migration") or frappe.flags.in_install)


# ---------------------------------------------------------------- Supplier Quotation
def revision_of(doctype, name):
	return cint(frappe.db.get_value(doctype, name, "mimaar_revision")) if name else 0


def sq_validate(doc, method=None):
	if skip(doc):
		return
	if doc.amended_from:
		prev = frappe.db.get_value("Supplier Quotation", doc.amended_from, ["mimaar_final", "supplier"], as_dict=True)
		if prev and cint(prev.mimaar_final):
			frappe.throw(_("Quotation {0} is locked as final. No more revisions can be made.").format(doc.amended_from))
		doc.mimaar_revision = revision_of("Supplier Quotation", doc.amended_from) + 1
		if not (doc.mimaar_revision_note or "").strip():
			frappe.throw(_("Write what changed in this revision (price, discount or items)."), title=_("Revision note needed"))
	if doc.docstatus == 0:
		doc.mimaar_final = 0
	for row in doc.items:
		if flt(row.qty) <= 0:
			frappe.throw(_("Row {0}: quantity must be more than 0.").format(row.idx))
		if flt(row.rate) <= 0:
			frappe.throw(_("Row {0}: rate must be more than 0.").format(row.idx))
	if flt(doc.mimaar_advance_percent) < 0 or flt(doc.mimaar_advance_percent) > 100:
		frappe.throw(_("Advance must be between 0 and 100 percent."))


def sq_before_cancel(doc, method=None):
	if skip(doc):
		return
	if cint(doc.mimaar_final):
		frappe.throw(_("This quotation is locked as final. It can't be cancelled or revised."))


@frappe.whitelist()
def mark_final(name):
	doc = frappe.get_doc("Supplier Quotation", name)
	doc.check_permission("submit")
	if doc.docstatus != 1:
		frappe.throw(_("Submit (confirm) the quotation before locking it as final."))
	if cint(doc.mimaar_final):
		return
	doc.db_set({"mimaar_final": 1, "mimaar_final_on": now_datetime()})
	doc.add_comment("Info", _("Locked as the final quotation. No more revisions."))
	return True


@frappe.whitelist()
def request_contract(name):
	doc = frappe.get_doc("Supplier Quotation", name)
	doc.check_permission("submit")
	if not cint(doc.mimaar_final):
		frappe.throw(_("Lock the quotation as final first."))
	doc.db_set("mimaar_contract_requested", 1)
	doc.add_comment("Info", _("Asked the supplier for their contract instead of a purchase order."))
	return True


# ---------------------------------------------------------------- Purchase Order
def po_validate(doc, method=None):
	if skip(doc) or not on("po_needs_final_quotation"):
		return
	for row in doc.items:
		if not row.supplier_quotation:
			frappe.throw(
				_("Row {0} ({1}): a purchase order is raised only from the supplier's final quotation. Open the locked quotation and use Create → Purchase Order.").format(row.idx, row.item_code),
				title=_("Final quotation needed"),
			)
		sq = frappe.db.get_value("Supplier Quotation", row.supplier_quotation, ["supplier", "mimaar_final", "docstatus"], as_dict=True)
		if not sq or sq.docstatus != 1 or not cint(sq.mimaar_final):
			frappe.throw(_("Row {0}: quotation {1} is not locked as final.").format(row.idx, row.supplier_quotation), title=_("Final quotation needed"))
		if sq.supplier != doc.supplier:
			frappe.throw(_("Row {0}: quotation {1} is from another supplier.").format(row.idx, row.supplier_quotation))
		if row.supplier_quotation_item:
			quoted = frappe.db.get_value("Supplier Quotation Item", row.supplier_quotation_item, "rate")
			if quoted is not None and flt(row.rate) > flt(quoted) + 0.005:
				frappe.throw(_("Row {0}: rate {1} is above the quoted rate {2}.").format(row.idx, frappe.format(row.rate, {"fieldtype": "Currency"}), frappe.format(quoted, {"fieldtype": "Currency"})))
	first = doc.items[0].supplier_quotation if doc.items else None
	if first and not doc.get("mimaar_payment_terms"):
		q = frappe.db.get_value("Supplier Quotation", first, ["mimaar_payment_terms", "mimaar_advance_percent", "mimaar_delivery_time"], as_dict=True) or {}
		doc.mimaar_payment_terms = q.get("mimaar_payment_terms")
		if not doc.get("mimaar_advance_percent"):
			doc.mimaar_advance_percent = q.get("mimaar_advance_percent")
		doc.mimaar_delivery_time = doc.get("mimaar_delivery_time") or q.get("mimaar_delivery_time")
	if flt(doc.get("mimaar_advance_percent")) < 0 or flt(doc.get("mimaar_advance_percent")) > 100:
		frappe.throw(_("Advance must be between 0 and 100 percent."))


def po_before_cancel(doc, method=None):
	if skip(doc) or not on("lock_submitted_po"):
		return
	frappe.throw(
		_("A submitted purchase order is locked and can't be cancelled or revised. If it is no longer needed, set its status to Closed."),
		title=_("Purchase order is locked"),
	)


@frappe.whitelist()
def update_items(parent_doctype, trans_items, parent_doctype_name, child_docname="items"):
	"""Standard "Update Items" on a submitted order, except that a locked purchase order can't be changed."""
	from erpnext.controllers.accounts_controller import update_child_qty_rate

	if parent_doctype == "Purchase Order" and on("lock_submitted_po"):
		frappe.throw(
			_("A submitted purchase order is locked: its items, quantities and rates can't be changed. For a change, get a revised quotation from the supplier and raise a new purchase order; close this one if it is no longer needed."),
			title=_("Purchase order is locked"),
		)
	return update_child_qty_rate(parent_doctype, trans_items, parent_doctype_name, child_docname)


# ---------------------------------------------------------------- printing, e-mail
LOCKED_SEND = ("Purchase Order", "Request for Quotation")


def comm_before_insert(doc, method=None):
	if doc.communication_type != "Communication" or doc.sent_or_received != "Sent":
		return
	if doc.reference_doctype in LOCKED_SEND and doc.reference_name:
		if frappe.db.get_value(doc.reference_doctype, doc.reference_name, "docstatus") != 1:
			frappe.throw(_("Only a submitted (locked) {0} can be sent.").format(_(doc.reference_doctype)))


# ---------------------------------------------------------------- receiving and billing
def pr_before_submit(doc, method=None):
	if skip(doc) or doc.is_return:
		return
	if not (doc.supplier_delivery_note or "").strip():
		frappe.throw(_("Enter the supplier's delivery note / challan number."), title=_("Delivery note needed"))
	if on("require_dn_scan") and not doc.get("mimaar_dn_scan"):
		frappe.throw(_("Scan or photograph the supplier's delivery note or bill."), title=_("Delivery note needed"))
	if on("require_receiver_photo") and not doc.get("mimaar_receiver_photo"):
		frappe.throw(_("Take the photo of the person receiving the goods."), title=_("Receiver's photo needed"))
	if not (doc.get("mimaar_received_by") or "").strip():
		doc.mimaar_received_by = frappe.utils.get_fullname(frappe.session.user)
	for row in doc.items:
		if not row.purchase_order:
			frappe.throw(_("Row {0} ({1}): goods are received only against a purchase order.").format(row.idx, row.item_code))


def pi_before_submit(doc, method=None):
	if skip(doc) or doc.is_return:
		return
	if not (doc.bill_no or "").strip():
		frappe.throw(_("Enter the supplier's invoice / bill number."), title=_("Bill number needed"))
	if on("require_bill_scan") and not doc.get("mimaar_bill_scan"):
		frappe.throw(_("Scan or photograph the supplier's bill."), title=_("Bill scan needed"))
	for row in doc.items:
		if not row.purchase_order:
			frappe.throw(_("Row {0} ({1}): supplier invoices are recorded only against a purchase order.").format(row.idx, row.item_code))


# ---------------------------------------------------------------- paying suppliers
def advance_limit(po):
	"""How much may be paid in advance on a purchase order."""
	pct = flt(po.get("mimaar_advance_percent"))
	if pct <= 0 and po.get("payment_schedule"):
		# a payment schedule due on or before the order date counts as an advance
		pct = sum(flt(r.invoice_portion) for r in po.payment_schedule if r.due_date and po.transaction_date and getdate(r.due_date) <= getdate(po.transaction_date))
	return flt(po.grand_total) * pct / 100.0


def advance_paid(po_name, exclude=None):
	rows = frappe.db.sql(
		"""select coalesce(sum(r.allocated_amount), 0) from `tabPayment Entry Reference` r
		join `tabPayment Entry` p on p.name = r.parent
		where r.reference_doctype = 'Purchase Order' and r.reference_name = %s and p.docstatus = 1 and p.name != %s""",
		(po_name, exclude or ""),
	)
	return flt(rows[0][0]) if rows else 0.0


def pe_validate(doc, method=None):
	if skip(doc) or doc.payment_type != "Pay" or doc.party_type != "Supplier" or not on("pay_only_due"):
		return
	if flt(doc.unallocated_amount) > 0.5:
		frappe.throw(
			_("Rs {0} of this payment is not set against any invoice. Suppliers are paid only against invoices that are due, or as an advance against a purchase order.").format(frappe.utils.fmt_money(doc.unallocated_amount)),
			title=_("Pay only what is due"),
		)
	for r in doc.references:
		if r.reference_doctype != "Purchase Order" or not flt(r.allocated_amount):
			continue
		po = frappe.get_doc("Purchase Order", r.reference_name)
		limit = advance_limit(po)
		if limit <= 0:
			frappe.throw(_("The terms of purchase order {0} don't include an advance.").format(po.name), title=_("No advance in the terms"))
		already = advance_paid(po.name, doc.name)
		if already + flt(r.allocated_amount) > limit + 1:
			frappe.throw(
				_("Advance on {0} can't be more than {1} ({2}% of the order). Already paid: {3}.").format(
					po.name, frappe.utils.fmt_money(limit), flt(po.get("mimaar_advance_percent")), frappe.utils.fmt_money(already)
				),
				title=_("Advance limit"),
			)


def pe_before_submit(doc, method=None):
	if skip(doc) or doc.payment_type != "Pay" or doc.party_type != "Supplier":
		return
	if on("require_payment_proof") and not doc.get("mimaar_proof"):
		frappe.throw(_("Attach the proof of payment (transfer screenshot, cheque photo or receipt)."), title=_("Proof needed"))


# ---------------------------------------------------------------- stores
def se_before_submit(doc, method=None):
	if skip(doc):
		return
	if doc.stock_entry_type == "Material Issue" and not doc.get("mimaar_water_ref") and not (doc.get("mimaar_issued_to") or "").strip():
		frappe.throw(_("Enter who the material is released to (mistri or group head)."), title=_("Released to"))
