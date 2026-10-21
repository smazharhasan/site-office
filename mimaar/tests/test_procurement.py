"""The owner's procurement rules, end to end, on a real ERPNext site:
quotation → revision → final → PO → advance → partial receipts → invoice → payment → statement,
plus store release and inspections. Run with: bench --site <site> run-tests --app mimaar"""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, flt, nowdate

from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
from erpnext.buying.doctype.purchase_order.purchase_order import make_purchase_invoice as po_to_pi
from erpnext.buying.doctype.purchase_order.purchase_order import make_purchase_receipt
from erpnext.buying.doctype.supplier_quotation.supplier_quotation import make_purchase_order
from erpnext.stock.doctype.purchase_receipt.purchase_receipt import make_purchase_invoice

from mimaar.api import register_supplier, statement_rows
from mimaar.procurement import mark_final


def company():
	return frappe.db.get_single_value("Global Defaults", "default_company") or frappe.get_all("Company", pluck="name")[0]


def a_file(name="test-scan.png"):
	f = frappe.get_doc({"doctype": "File", "file_name": f"{frappe.generate_hash(length=6)}-{name}", "content": b"\x89PNG\r\n\x1a\n" + b"0" * 64, "is_private": 1}).insert(ignore_permissions=True)
	return f.file_url


def item(code, uom="Nos", stock=1):
	if not frappe.db.exists("UOM", uom):
		frappe.get_doc({"doctype": "UOM", "uom_name": uom}).insert()
	if not frappe.db.exists("Item", code):
		frappe.get_doc({"doctype": "Item", "item_code": code, "item_name": code.title(), "item_group": "Construction Materials", "stock_uom": uom, "is_stock_item": stock}).insert()
	return code


def warehouse():
	return frappe.db.get_value("Warehouse", {"company": company(), "is_group": 0, "warehouse_name": ["like", "Stores%"]}) or frappe.db.get_value("Warehouse", {"company": company(), "is_group": 0})


class TestProcurement(IntegrationTestCase):
	def assertRule(self, fn, *args):
		frappe.db.savepoint("mimaar_rule")
		with self.assertRaises(frappe.ValidationError) as cm:
			fn(*args)
		frappe.db.rollback(save_point="mimaar_rule")  # as a real request would
		self.assertNotIsInstance(cm.exception, frappe.DocstatusTransitionError)
		print("  refused as expected:", frappe.utils.strip_html(str(cm.exception))[:140])

	def setUp(self):
		frappe.set_user("Administrator")
		self.co = company()
		self.wh = warehouse()
		self.cement, self.sand = item("TEST-CEMENT", "Bag"), item("TEST-SAND", "Cft")
		self.sup = register_supplier("Test Cement Traders " + frappe.generate_hash(length=4), phone="0321-5551234", contact="Bilal", payment_terms="30% advance", delivery_time="7 days")

	def quotation(self, rate=1450):
		sq = frappe.get_doc({"doctype": "Supplier Quotation", "supplier": self.sup, "company": self.co, "transaction_date": nowdate(), "quotation_number": "Q-778",
			"mimaar_payment_terms": "30% advance, balance on delivery", "mimaar_advance_percent": 30, "mimaar_delivery_time": "7 days",
			"items": [{"item_code": self.cement, "qty": 500, "rate": rate, "uom": "Bag", "warehouse": self.wh}, {"item_code": self.sand, "qty": 1000, "rate": 95, "uom": "Cft", "warehouse": self.wh}]})
		sq.insert(); sq.submit()
		return sq

	def revise(self, sq, rate, note="Rs 50 off cement"):
		sq.reload(); sq.cancel()
		new = frappe.copy_doc(sq); new.docstatus = 0; new.amended_from = sq.name; new.items[0].rate = rate; new.mimaar_revision_note = note
		new.insert(); new.submit()
		return new

	def test_full_flow(self):
		sq = self.quotation()
		# a revision needs a note, and gets the next revision number
		sq.reload(); sq.cancel()
		bad = frappe.copy_doc(sq); bad.docstatus = 0; bad.amended_from = sq.name; bad.mimaar_revision_note = ""
		self.assertRule(bad.insert)
		sq2 = frappe.copy_doc(sq); sq2.docstatus = 0; sq2.amended_from = sq.name; sq2.items[0].rate = 1400; sq2.mimaar_revision_note = "Rs 50 off cement"
		sq2.insert(); sq2.submit()
		self.assertEqual(sq2.mimaar_revision, 1)
		self.assertTrue(sq2.name.endswith("-1"))

		# no purchase order before the quotation is locked as final
		po = make_purchase_order(sq2.name); po.schedule_date = add_days(nowdate(), 7)
		for r in po.items: r.schedule_date = po.schedule_date
		self.assertRule(po.insert)

		mark_final(sq2.name); sq2.reload()
		self.assertEqual(sq2.mimaar_final, 1)
		self.assertRule(sq2.cancel)
		again = frappe.copy_doc(sq2); again.docstatus = 0; again.amended_from = sq2.name; again.mimaar_revision_note = "x"
		self.assertRule(again.insert)

		# purchase order from the final quotation, never above the quoted rate
		po = make_purchase_order(sq2.name); po.schedule_date = add_days(nowdate(), 7)
		for r in po.items: r.schedule_date = po.schedule_date
		po.items[1].qty = 600
		po.items[0].rate = 1500
		self.assertRule(po.insert)
		po.items[0].rate = 1400
		po.insert()
		self.assertEqual(flt(po.mimaar_advance_percent), 30)
		po.submit()
		self.assertEqual(flt(po.grand_total), 500 * 1400 + 600 * 95)
		self.assertRule(po.cancel)  # locked
		from mimaar.procurement import update_items
		row = po.items[0]
		self.assertRule(update_items, "Purchase Order", frappe.as_json([{"docname": row.name, "item_code": row.item_code, "qty": row.qty, "rate": 1}]), po.name)
		self.assertEqual(frappe.get_hooks("override_whitelisted_methods").get("erpnext.controllers.accounts_controller.update_child_qty_rate"), ["mimaar.procurement.update_items"])

		# advance: limited to 30%, needs proof
		limit = flt(po.grand_total) * 0.3
		pe = get_payment_entry("Purchase Order", po.name, party_amount=limit + 1000)
		pe.reference_no, pe.reference_date = "TRX-1", nowdate()
		self.assertRule(pe.insert)
		pe = get_payment_entry("Purchase Order", po.name, party_amount=limit)
		pe.reference_no, pe.reference_date = "TRX-1", nowdate()
		pe.insert()
		self.assertRule(pe.submit)  # no proof
		pe.reload(); pe.mimaar_proof = a_file("proof.png"); pe.save(); pe.submit()
		po.reload()
		self.assertAlmostEqual(flt(po.advance_paid), limit, 0)

		# a payment not set against anything is refused
		loose = frappe.get_doc({"doctype": "Payment Entry", "payment_type": "Pay", "party_type": "Supplier", "party": self.sup, "company": self.co, "paid_amount": 1000, "received_amount": 1000,
			"paid_from": pe.paid_from, "paid_to": pe.paid_to, "reference_no": "X", "reference_date": nowdate(), "mimaar_proof": a_file()})
		self.assertRule(loose.insert)

		# receiving: only with the delivery note number, its scan and the receiver's photo; part delivery keeps the PO open
		pr = make_purchase_receipt(po.name)
		pr.items = [r for r in pr.items if r.item_code == self.cement]
		pr.items[0].qty = pr.items[0].received_qty = 300
		pr.insert()
		self.assertRule(pr.submit)
		pr.reload(); pr.supplier_delivery_note = "DN-4471"; pr.mimaar_dn_scan = a_file("dn.png"); pr.save()
		self.assertRule(pr.submit)  # no receiver photo
		pr.reload(); pr.mimaar_receiver_photo = a_file("face.png"); pr.save(); pr.submit()
		po.reload()
		self.assertTrue(0 < flt(po.per_received) < 100)
		self.assertIn(po.status, ("To Receive and Bill", "To Receive"))
		# more than ordered is refused
		pr2 = make_purchase_receipt(po.name)
		cem = [r for r in pr2.items if r.item_code == self.cement][0]
		self.assertEqual(flt(cem.qty), 200)
		pr2.items = [cem]; cem.qty = cem.received_qty = 250
		pr2.supplier_delivery_note = "DN-4480"; pr2.mimaar_dn_scan = a_file(); pr2.mimaar_receiver_photo = a_file()
		pr2.insert()
		self.assertRule(pr2.submit)

		# invoice: against the receipt, needs bill number and scan; advance set against it
		pi = make_purchase_invoice(pr.name)
		pi.bill_no, pi.bill_date = "B-123", nowdate()
		pi.insert()
		self.assertRule(pi.submit)  # no scan
		pi.reload(); pi.mimaar_bill_scan = a_file("bill.png"); pi.set_advances(); pi.save(); pi.submit()
		self.assertAlmostEqual(flt(pi.grand_total), 300 * 1400, 0)
		self.assertAlmostEqual(flt(pi.outstanding_amount), max(0, 300 * 1400 - limit), 0)

		# billing more than received is refused (receipt required)
		pi_bad = po_to_pi(po.name)
		pi_bad.bill_no = "B-999"; pi_bad.mimaar_bill_scan = a_file()
		self.assertRule(lambda: (pi_bad.insert(), pi_bad.submit()))

		# pay what is due
		pay = get_payment_entry("Purchase Invoice", pi.name)
		pay.reference_no, pay.reference_date, pay.mimaar_proof = "TRX-2", nowdate(), a_file()
		pay.insert(); pay.submit()
		pi.reload()
		self.assertEqual(flt(pi.outstanding_amount), 0)

		st = statement_rows(self.sup, company=self.co)
		self.assertAlmostEqual(st["billed"], 300 * 1400, 0)
		self.assertAlmostEqual(st["paid"], 300 * 1400, 0)
		self.assertAlmostEqual(st["balance"], 0, 0)

		# store: release only what is in stock, to a named person
		se = frappe.get_doc({"doctype": "Stock Entry", "stock_entry_type": "Material Issue", "company": self.co, "items": [{"item_code": self.cement, "qty": 400, "s_warehouse": self.wh}]})
		se.mimaar_issued_to = "Ustad Rafiq"
		se.insert()
		self.assertRule(se.submit)
		se2 = frappe.get_doc({"doctype": "Stock Entry", "stock_entry_type": "Material Issue", "company": self.co, "items": [{"item_code": self.cement, "qty": 100, "s_warehouse": self.wh}]})
		se2.insert()
		self.assertRule(se2.submit)  # nobody named
		se3 = frappe.get_doc({"doctype": "Stock Entry", "stock_entry_type": "Material Issue", "company": self.co, "mimaar_issued_to": "Ustad Rafiq", "items": [{"item_code": self.cement, "qty": 100, "s_warehouse": self.wh}]})
		se3.insert(); se3.submit()

	def test_inspection_makes_snags(self):
		ins = frappe.get_doc({"doctype": "Site Inspection", "inspection_type": "Steel before concrete", "location": "GF slab", "result": "Fail",
			"checks": [{"check": "Cover blocks in place", "result": "Not OK"}]})
		self.assertRule(ins.insert)
		ins.append("actions", {"issue": "No cover blocks", "action": "Place 25 mm cover blocks", "supplier": self.sup, "target_date": add_days(nowdate(), 2)})
		ins.insert(); ins.submit()
		ins.reload()
		self.assertTrue(ins.actions[0].snag)
		snag = frappe.get_doc("Site Snag", ins.actions[0].snag)
		self.assertEqual(snag.status, "Open")
		snag.status = "Closed"
		self.assertRule(snag.save)
		snag.reload(); snag.fixed_photo = a_file(); snag.status = "Closed"; snag.save()
		self.assertTrue(snag.closed_on)

	def test_attendance(self):
		from mimaar.api import find_worker
		from mimaar.mimaar.report.labour_attendance_summary.labour_attendance_summary import execute

		def worker(name, cnic, **kw):
			existing = frappe.db.get_value("Site Worker", {"cnic": cnic})
			if existing:
				return frappe.get_doc("Site Worker", existing)
			return frappe.get_doc(dict({"doctype": "Site Worker", "full_name": name, "cnic": cnic, "trade": "Mason", "daily_wage": 2500, "contractor": self.sup}, **kw)).insert()

		w1 = worker("Test Mason One", "4210112345671")
		self.assertEqual(w1.cnic, "42101-1234567-1")  # formatted
		dup = frappe.get_doc({"doctype": "Site Worker", "full_name": "Copy", "cnic": "42101-1234567-1"})
		self.assertRule(dup.insert)  # same CNIC twice
		w2 = worker("Test Helper Two", "4210176543211", trade="Helper", daily_wage=1800, entry_card_no="BTK-TEST-9")
		w3 = worker("Test Left Three", "4210199999991", status="Left the site")
		self.assertEqual(find_worker(w1.name).name, w1.name)
		self.assertEqual(find_worker("https://x/y?c=" + w1.name.lower()).name, w1.name)  # QR with a link
		self.assertEqual(find_worker("42101 7654321 1").name, w2.name)  # CNIC typed
		self.assertEqual(find_worker("BTK-TEST-9").name, w2.name)  # society card
		self.assertIsNone(find_worker("nothing"))

		day = add_days(nowdate(), -400)
		frappe.db.delete("Site Attendance", {"date": day})
		att = frappe.get_doc({"doctype": "Site Attendance", "date": day, "rows": [{"worker": w1.name}, {"worker": w2.name, "status": "Half day"}, {"worker": w3.name}]})
		self.assertRule(att.insert)  # a worker who has left can't be present
		att = frappe.get_doc({"doctype": "Site Attendance", "date": day, "rows": [{"worker": w1.name}, {"worker": w2.name, "status": "Half day"}, {"worker": w3.name, "status": "Absent"}]})
		att.insert()
		self.assertEqual((att.present, att.half_day), (1, 1))
		again = frappe.get_doc({"doctype": "Site Attendance", "date": day, "rows": [{"worker": w1.name}]})
		self.assertRule(again.insert)  # one sheet per day
		self.assertRule(att.submit)  # no team photo / location
		att.reload(); att.group_photo = a_file(); att.location = "24.9, 67.1 (±10 m)"; att.save(); att.submit()
		cols, rows = execute({"from_date": day, "to_date": day})
		got = {r.worker: (r.days, r.wages) for r in rows}
		self.assertEqual(got[w1.name], (1, 2500))
		self.assertEqual(got[w2.name], (0.5, 900))
		html = frappe.get_print("Site Worker", w1.name, "Site Worker Card")
		self.assertIn("data:image/svg+xml;base64", html)
		self.assertIn(w1.name, html)
