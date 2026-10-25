"""Site cards, PIN, face checks and the entries that need them. Run: bench --site <site> run-tests --app mimaar"""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import flt, nowdate

from mimaar import field, identity
from mimaar.tests.test_procurement import a_file, item, warehouse

MATCH = "/opt/bench/fake_face_match.json"
NOMATCH = "/opt/bench/fake_face_nomatch.json"


def person(name="Card Test Mistri", **kw):
	d = {"doctype": "Site Worker", "full_name": name, "worker_type": "Mistri", "trade": "Mason", "photo": a_file("face.png")}
	d.update(kw)
	return frappe.get_doc(d).insert()


class TestIdentity(IntegrationTestCase):
	def setUp(self):
		frappe.local.conf["mimaar_fake_face_file"] = MATCH
		frappe.db.set_single_value("Mimaar Settings", "face_check", "Required")
		frappe.clear_document_cache("Mimaar Settings", "Mimaar Settings")

	def tearDown(self):
		frappe.local.conf.pop("mimaar_fake_face_file", None)

	def test_card_code_and_lookup(self):
		p = person()
		code = identity.card_code(p.name)
		self.assertTrue(code.startswith("MMR1:"))
		self.assertEqual(identity.person_from_code(code), (p.name, True))
		self.assertEqual(identity.person_from_code(p.name), (p.name, False))
		old = code
		identity.new_card(p.name)
		self.assertNotEqual(identity.card_code(p.name), old)
		self.assertEqual(identity.person_from_code(old), (None, False))

	def test_face_check_match_and_block(self):
		p = person()
		code = identity.card_code(p.name)
		r = identity.verify(code, a_file("live.png"), "Store issue")
		self.assertTrue(r["ok"])
		self.assertEqual(r["result"], "Match")
		frappe.local.conf["mimaar_fake_face_file"] = NOMATCH
		r2 = identity.verify(code, a_file("live2.png"), "Store issue")
		self.assertFalse(r2["ok"])
		self.assertEqual(r2["result"], "No match")
		with self.assertRaises(frappe.ValidationError):
			identity.use_check(r2["check"], "Store issue")
		with self.assertRaises(frappe.ValidationError):  # typed number is not a card scan
			identity.verify(p.name, a_file("live3.png"), "Store issue")

	def test_issue_and_return_with_card(self):
		code_item = item("CARD-TEST-CEMENT", "Bag")
		wh = warehouse()
		frappe.get_doc({"doctype": "Stock Entry", "stock_entry_type": "Material Receipt", "company": field._company(),
			"items": [{"item_code": code_item, "qty": 50, "t_warehouse": wh, "basic_rate": 1400}]}).insert().submit()
		frappe.db.set_single_value("Mimaar Settings", "site_warehouse", wh)
		frappe.clear_document_cache("Mimaar Settings", "Mimaar Settings")
		before = flt(frappe.db.get_value("Bin", {"item_code": code_item, "warehouse": wh}, "actual_qty"))
		p = person("Card Test Mason")
		code = identity.card_code(p.name)
		with self.assertRaises(frappe.ValidationError):  # card needed
			field.release([{"item_code": code_item, "qty": 2}], issued_to="Someone")
		chk = identity.verify(code, a_file("l.png"), "Store issue")["check"]
		se = field.release([{"item_code": code_item, "qty": 5}], check=chk, work_area="Walls")
		self.assertEqual(frappe.db.get_value("Stock Entry", se, "mimaar_person"), p.name)
		with self.assertRaises(frappe.ValidationError):  # a check is used once
			field.release([{"item_code": code_item, "qty": 1}], check=chk)
		chk2 = identity.verify(code, a_file("l2.png"), "Store return")["check"]
		back = field.return_to_store([{"item_code": code_item, "qty": 2}], check=chk2)
		doc = frappe.get_doc("Stock Entry", back)
		self.assertEqual((doc.docstatus, doc.mimaar_is_return, doc.stock_entry_type), (1, 1, "Material Receipt"))
		self.assertEqual(flt(frappe.db.get_value("Bin", {"item_code": code_item, "warehouse": wh}, "actual_qty")), before - 5 + 2)

	def test_attendance_by_card_in_and_out(self):
		for n in frappe.get_all("Site Attendance", filters={"date": nowdate(), "docstatus": 1}, pluck="name"):
			frappe.get_doc("Site Attendance", n).cancel()
		p = person("Card Test Labour", worker_type="Labour")
		code = identity.card_code(p.name)
		r = field.attendance_card(identity.verify(code, a_file("a.png"), "Attendance")["check"], "in")
		self.assertEqual(r["mode"], "in")
		with self.assertRaises(frappe.ValidationError):
			field.attendance_card(identity.verify(code, a_file("b.png"), "Attendance")["check"], "in")
		r = field.attendance_card(identity.verify(code, a_file("c.png"), "Attendance")["check"], "out")
		row = frappe.db.get_value("Site Attendance Row", {"parent": r["name"], "worker": p.name}, ["time_in", "time_out", "identity_check"], as_dict=True)
		self.assertTrue(row.time_in and row.time_out and row.identity_check)
		# after the day's list is submitted: time in is refused, time out still works
		d = frappe.get_doc("Site Attendance", r["name"])
		d.group_photo, d.location = a_file("team.png"), "24.95,67.12"
		d.submit()
		with self.assertRaises(frappe.ValidationError):
			field.attendance_card(identity.verify(code, a_file("d.png"), "Attendance")["check"], "in")
		frappe.db.set_value("Site Attendance Row", {"parent": d.name, "worker": p.name}, "time_out", None)
		r = field.attendance_card(identity.verify(code, a_file("e.png"), "Attendance")["check"], "out")
		self.assertEqual(r["name"], d.name)
		self.assertTrue(frappe.db.get_value("Site Attendance Row", {"parent": d.name, "worker": p.name}, "time_out"))
		d.reload()
		d.cancel()

	def test_pin_and_access(self):
		p = person("Card Test Supervisor", worker_type="Supervisor")
		p.app_access = "Site supervisor"
		p.save()
		user = frappe.db.get_value("Site Worker", p.name, "user")
		self.assertTrue(user)
		self.assertIn("Site Supervisor", frappe.get_roles(user))
		with self.assertRaises(frappe.ValidationError):
			identity.set_card_pin(p.name, "12")
		info = identity.set_card_pin(p.name, "4321")
		self.assertTrue(info["pin_set"] and info["sign_in_enabled"])
		card = frappe.get_doc("Site Card", {"person": p.name})
		self.assertNotIn("4321", card.pin_hash or "")
		p.reload()
		p.status = "Left the site"
		p.save()
		self.assertEqual(frappe.db.get_value("User", user, "enabled"), 0)
