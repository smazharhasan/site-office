"""Store items, water (tankers, tank levels) and petty cash. Run: bench --site <site> run-tests --app buildiary"""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import flt

from buildiary import identity, petty, stores, water
from buildiary.tests.test_identity import MATCH, person
from buildiary.tests.test_procurement import a_file

WATER_AI = "/opt/bench/fake_water.json"
IDENTIFY_AI = "/opt/bench/fake_identify.json"


def gl(account):
	return flt(frappe.db.sql("select sum(debit - credit) from `tabGL Entry` where is_cancelled = 0 and account = %s", account)[0][0])


class TestStage2(IntegrationTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		frappe.local.conf["buildiary_fake_face_file"] = MATCH
		frappe.local.conf["buildiary_fake_ai_file"] = WATER_AI
		frappe.db.set_single_value("Buildiary Settings", "face_check", "Required")
		frappe.clear_document_cache("Buildiary Settings", "Buildiary Settings")

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.local.conf.pop("buildiary_fake_face_file", None)
		# identity.verify() commits, so put the owner's controls back as they were
		frappe.db.set_single_value("Buildiary Settings", {"card_for_receiving": 1, "petty_needs_budget": 1})
		frappe.db.commit()

	# ------------------------------------------------------------ store
	def test_store_items_and_item_page(self):
		d = stores.items()
		self.assertTrue(d["rows"])
		self.assertNotIn("WATER", [r["code"] for r in d["rows"]])
		self.assertTrue(all(r["state"] in ("none", "out", "low", "in") for r in d["rows"]))
		code = stores.item_save({"item_name": "Test Shuttering Ply 18mm", "item_group": "Construction Materials", "uom": "Nos", "reorder": 5, "image": a_file("ply.png")})
		it = stores.item(code)
		self.assertEqual(it["name"], "Test Shuttering Ply 18mm")
		self.assertEqual(flt(it["reorder"]), 5)
		self.assertEqual(it["state"], "none")
		stores.item_save({"code": code, "item_name": "Test Shuttering Ply 18 mm", "item_group": "Construction Materials", "reorder": 0})
		self.assertEqual(frappe.db.get_value("Item", code, "item_name"), "Test Shuttering Ply 18 mm")
		self.assertFalse(frappe.get_all("Item Reorder", filters={"parent": code}))

	def test_identify_from_photo(self):
		frappe.local.conf["buildiary_fake_ai_file"] = IDENTIFY_AI
		cement = frappe.db.get_value("Item", {"item_name": "Cement, OPC"}, "name")
		r = stores.identify(a_file("bag.png"))
		self.assertEqual(r["what"], "A bag of OPC cement, 50 kg")
		if cement:
			self.assertEqual(r["matches"][0]["code"], cement)
		self.assertEqual(r["suggested"]["uom"], "Bag")

	# ------------------------------------------------------------ water
	def test_tanker_and_daily_levels(self):
		frappe.db.set_single_value("Buildiary Settings", "card_for_receiving", 0)
		frappe.clear_document_cache("Buildiary Settings", "Buildiary Settings")
		before = water.in_books()
		r = water.tanker_save({"vehicle_no": "tla-123", "gallons": 3000, "water_type": "Sweet (construction & curing)", "tds_ppm": 640, "cost": 6000,
			"emptied_into": "Underground tank", "tanker_photo": a_file("tanker.png"), "bill_scan": a_file("slip.png")})
		tk = frappe.get_doc("Water Tanker", r["name"])
		self.assertEqual(tk.docstatus, 1)
		self.assertEqual(tk.vehicle_no, "TLA-123")
		self.assertTrue(tk.stock_entry)
		self.assertEqual(tk.ai_verdict, "Verified")  # the AI check runs at once in tests
		self.assertAlmostEqual(water.in_books(), before + 3000)
		# bad water is flagged; rejected water never enters the books
		r2 = water.tanker_save({"vehicle_no": "KHI-9", "gallons": 2000, "water_type": "Brackish (rejected)", "tanker_photo": a_file("t2.png")})
		self.assertFalse(frappe.db.get_value("Water Tanker", r2["name"], "stock_entry"))
		self.assertAlmostEqual(water.in_books(), before + 3000)
		w = water.tanker_save({"vehicle_no": "KHI-10", "gallons": 1000, "tds_ppm": 1500, "tanker_photo": a_file("t3.png"), "bill_scan": a_file("s3.png"), "emptied_into": "Overhead tank"})
		self.assertTrue(w["warnings"])
		with self.assertRaises(frappe.ValidationError):
			water.tanker_save({"vehicle_no": "KHI-11", "gallons": 1000, "tanker_photo": a_file("t4.png")})  # no bill
		# levels: every tank read, the books follow the tanks
		for t, lv in (("Underground tank", 40), ("Overhead tank", 50), ("Site drums / curing", 20)):
			res = water.reading_save(t, lv, a_file(f"{t}.png"))
		have, missing = water.in_tanks()
		self.assertFalse(missing)
		self.assertAlmostEqual(water.in_books(), have, delta=0.01 * 6500 + 1)
		used_before = water.in_books()
		res = water.reading_save("Underground tank", 30, a_file("ug2.png"))
		self.assertAlmostEqual(res["used"], 500, delta=1)
		self.assertAlmostEqual(water.in_books(), used_before - 500, delta=1)
		rd = frappe.get_doc("Water Tank Reading", res["name"])
		self.assertEqual(flt(rd.ai_level_pct), 55)
		self.assertEqual(rd.ai_verdict, "Mismatch")  # 55% seen, 30% recorded
		o = water.overview()
		self.assertTrue(o["tankers"] and o["readings"])
		# a tanker entered by mistake is cancelled: its water leaves the books
		books = water.in_books()
		x = water.tanker_save({"vehicle_no": "MISTAKE-1", "gallons": 1500, "tanker_photo": a_file("m.png"), "bill_scan": a_file("ms.png"), "emptied_into": "Underground tank"})
		self.assertAlmostEqual(water.in_books(), books + 1500)
		frappe.get_doc("Water Tanker", x["name"]).cancel()
		self.assertAlmostEqual(water.in_books(), books)

	# ------------------------------------------------------------ petty cash
	def test_petty_cash_flow(self):
		sup = person("Petty Test Supervisor", worker_type="Supervisor")
		sup.app_access = "Site supervisor"
		sup.save()
		user = frappe.db.get_value("Site Worker", sup.name, "user")
		code = identity.card_code(sup.name)
		cat = "Canteen & food"
		acc = frappe.db.get_value("Petty Cash Category", cat, "expense_account")
		cash = frappe.db.get_single_value("Buildiary Settings", "petty_cash_account")
		# the owner gives cash by site card + face: approved and booked at once
		chk = identity.verify(code, a_file("face-now.png"), "Petty cash")["check"]
		g = petty.entry_save({"entry_type": "Cash given", "holder": sup.name, "amount": 10000, "method": "Cash in hand"}, chk)
		self.assertEqual(g["status"], "Approved")
		self.assertTrue(frappe.db.get_value("Petty Cash Entry", g["name"], "journal_entry"))
		cash0, acc0 = gl(cash), gl(acc)
		if not petty.budget_of(acc)["has_budget"]:
			petty.budget_add(cat, 50000)
		self.assertTrue(petty.budget_of(acc)["has_budget"])
		# the supervisor spends: waits for the owner
		frappe.set_user(user)
		with self.assertRaises(frappe.ValidationError):
			petty.entry_save({"entry_type": "Expense", "amount": 500, "category": cat, "paid_to": "Ali tea stall"})  # no bill photo
		e = petty.entry_save({"entry_type": "Expense", "amount": 500, "category": cat, "paid_to": "Ali tea stall", "bill_photo": a_file("bill.png")})
		self.assertEqual(e["status"], "Waiting for owner")
		with self.assertRaises(frappe.ValidationError):
			petty.entry_save({"entry_type": "Expense", "amount": 50000, "category": cat, "paid_to": "Too much", "bill_photo": a_file("b2.png")})
		with self.assertRaises(frappe.PermissionError):
			petty.entry_save({"entry_type": "Cash given", "holder": sup.name, "amount": 100})
		with self.assertRaises(frappe.PermissionError):
			petty.decide(e["name"], "Approved")
		mine = petty.overview()
		self.assertFalse(mine["full"])
		self.assertTrue(all(x.holder == sup.name for x in mine["entries"]))
		self.assertAlmostEqual(mine["in_hand"], 9500)
		frappe.set_user("Administrator")
		self.assertEqual(gl(acc), acc0)  # nothing booked before the owner's check
		petty.decide(e["name"], "Approved")
		self.assertAlmostEqual(gl(acc), acc0 + 500)
		self.assertAlmostEqual(gl(cash), cash0 - 500)
		# a rejected expense goes back into the holder's hand
		frappe.set_user(user)
		e2 = petty.entry_save({"entry_type": "Expense", "amount": 300, "category": cat, "paid_to": "Shop", "bill_photo": a_file("b3.png")})
		frappe.set_user("Administrator")
		with self.assertRaises(frappe.ValidationError):
			petty.decide(e2["name"], "Rejected")  # needs a reason
		petty.decide(e2["name"], "Rejected", "No bill number")
		self.assertAlmostEqual(petty._in_hand(sup.name), 9500)
		# paying a worker by card: the face check must be the worker's
		lab = person("Petty Test Labour", worker_type="Labour")
		lchk = identity.verify(identity.card_code(lab.name), a_file("lab.png"), "Petty cash")["check"]
		if not petty.budget_of(frappe.db.get_value("Petty Cash Category", "Labour advance", "expense_account"))["has_budget"]:
			petty.budget_add("Labour advance", 100000)
		with self.assertRaises(frappe.ValidationError):  # someone else's face check
			petty.entry_save({"entry_type": "Expense", "holder": sup.name, "amount": 1000, "category": "Labour advance", "paid_to_person": sup.name}, lchk)
		p = petty.entry_save({"entry_type": "Expense", "holder": sup.name, "amount": 1000, "category": "Labour advance", "paid_to_person": lab.name}, lchk)
		self.assertEqual(frappe.db.get_value("Petty Cash Entry", p["name"], "paid_to"), "Petty Test Labour")
		# no budget yet for a line: refused
		frappe.db.set_single_value("Buildiary Settings", "petty_needs_budget", 1)
		frappe.clear_document_cache("Buildiary Settings", "Buildiary Settings")
		nob = next((c.name for c in frappe.get_all("Petty Cash Category", fields=["name", "expense_account"]) if not petty.budget_of(c.expense_account)["has_budget"]), None)
		if nob:
			with self.assertRaises(frappe.ValidationError):
				petty.entry_save({"entry_type": "Expense", "holder": sup.name, "amount": 10, "category": nob, "paid_to": "x", "bill_photo": a_file("b4.png")})
		# cash returned with a proof
		back = petty.entry_save({"entry_type": "Cash returned", "holder": sup.name, "amount": 2000, "method": "Cash in hand", "proof_1": a_file("receipt.png")})
		self.assertEqual(back["status"], "Approved")
		self.assertAlmostEqual(petty._in_hand(sup.name), 9500 - 1000 - 2000)

	def test_tanker_paid_from_petty_cash(self):
		frappe.db.set_single_value("Buildiary Settings", "card_for_receiving", 0)
		frappe.clear_document_cache("Buildiary Settings", "Buildiary Settings")
		sup = person("Water Test Supervisor", worker_type="Supervisor")
		sup.app_access = "Site supervisor"
		sup.save()
		chk = identity.verify(identity.card_code(sup.name), a_file("f.png"), "Petty cash")["check"]
		petty.entry_save({"entry_type": "Cash given", "holder": sup.name, "amount": 5000, "method": "Cash in hand"}, chk)
		r = water.tanker_save({"vehicle_no": "TLB-77", "gallons": 2000, "cost": 4000, "paid_from_petty_cash": 1, "holder": sup.name,
			"tanker_photo": a_file("t.png"), "bill_scan": a_file("s.png"), "emptied_into": "Underground tank"})
		pc = frappe.db.get_value("Water Tanker", r["name"], "petty_cash_entry")
		self.assertTrue(pc)
		self.assertEqual(frappe.db.get_value("Petty Cash Entry", pc, "status"), "Approved")  # the owner recorded it
		self.assertAlmostEqual(petty._in_hand(sup.name), 1000)
		with self.assertRaises(frappe.ValidationError):
			water.tanker_save({"vehicle_no": "TLB-78", "gallons": 2000, "cost": 4000, "paid_from_petty_cash": 1, "holder": sup.name,
				"tanker_photo": a_file("t.png"), "bill_scan": a_file("s.png")})
